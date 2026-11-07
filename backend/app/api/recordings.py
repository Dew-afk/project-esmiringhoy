"""Recording metadata + secure download. Media never enters the database.
Local dev adapter (STORAGE_PROVIDER=local) writes plaintext files — clearly
flagged, never to be confused with production encrypted object storage."""

import uuid

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from ..core.config import settings
from ..core.database import get_db
from ..core.deps import get_current_user
from ..core.security import sign_download_token, verify_download_token
from .. import models
from ..services.audit import audit
from ..services import storage

router = APIRouter(prefix="/sessions", tags=["recordings"])


def _own_session(db: Session, user: models.UserAccount, session_id: str) -> models.ExamSession:
    s = db.get(models.ExamSession, session_id)
    if s is None:
        raise HTTPException(404, "Session not found")
    if not (
        user.id == s.student_id
        or (user.role in ("proctor", "admin", "appeals") and user.institution_id == s.exam.institution_id)
    ):
        raise HTTPException(403, "Not authorized for this session")
    return s


@router.get("/{session_id}/recordings")
def list_recordings(
    session_id: str,
    user: models.UserAccount = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _own_session(db, user, session_id)
    return [
        {
            "recording_id": r.id,
            "session_id": r.session_id,
            "format": r.format,
            "size_bytes": r.size_bytes,
            "available": storage.exists(r.object_key),
            "created_at": r.created_at.isoformat(),
            "dev_local": settings.storage_is_dev_local,
        }
        for r in db.query(models.Recordings)
        .filter(models.Recordings.session_id == session_id)
        .all()
    ]


@router.post("/{session_id}/recordings", status_code=201)
async def upload_recording(
    session_id: str,
    file: UploadFile = File(...),
    user: models.UserAccount = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if user.role != "student":
        raise HTTPException(403, "Only the session owner uploads recordings")
    s = _own_session(db, user, session_id)
    if s.status != "active":
        raise HTTPException(409, "Recording uploads are only accepted for active sessions")
    if settings.storage_is_dev_local:
        data = await file.read()
        if len(data) > 200 * 1024 * 1024:
            raise HTTPException(413, "Recording too large (200 MB dev limit)")
        recording_id = f"rec_{uuid.uuid4().hex[:16]}"
        object_key = storage.put(recording_id, data)
        db.add(models.Recordings(
            id=recording_id,
            session_id=session_id,
            object_key=object_key,
            format=(file.filename or "video").rsplit(".", 1)[-1][:20] or "mp4",
            size_bytes=len(data),
            encryption_note="DEV LOCAL PLAINTEXT — production requires SSE/S3",
        ))
        audit(db, actor=user.email, action="RECORDING_UPLOAD", target=recording_id)
        db.commit()
        return {"recording_id": recording_id, "dev_local": True}
    raise HTTPException(503, "Only the local dev storage adapter is implemented")


@router.post("/recordings/{recording_id}/export")
def export_recording(
    recording_id: str,
    user: models.UserAccount = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Short-lived, scoped, signed download URL + audit (SDD §5.6)."""
    if user.role not in ("proctor", "admin", "appeals"):
        raise HTTPException(403, "Only proctors export recordings")
    r = db.get(models.Recordings, recording_id)
    if r is None:
        raise HTTPException(404, "Recording not found")
    session = db.get(models.ExamSession, r.session_id)
    if session is None or session.exam.institution_id != user.institution_id:
        raise HTTPException(403, "Not your institution")
    if session.status != "completed":
        raise HTTPException(409, "Only completed sessions can be exported")
    if not storage.exists(r.object_key):
        raise HTTPException(404, "Recording unavailable (never captured, purged, or integrity failure)")
    token = sign_download_token(r.object_key)
    audit(db, actor=user.email, action="EXPORT_RECORDING", target=recording_id)
    db.commit()
    return {"url": f"/api/v1/sessions/recordings/{recording_id}/download?token={token}",
            "expires_s": settings.download_url_ttl_s}


@router.get("/recordings/{recording_id}/download")
def download_recording(
    recording_id: str,
    token: str = "",
    user: models.UserAccount = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    r = db.get(models.Recordings, recording_id)
    if r is None:
        raise HTTPException(404, "Recording not found")
    if not verify_download_token(token, r.object_key):
        raise HTTPException(403, "Invalid or expired download link")
    path = storage.path(r.object_key)
    if path is None:
        raise HTTPException(404, "Recording unavailable")
    return FileResponse(path, media_type="application/octet-stream", filename=f"{recording_id}.{r.format}")
