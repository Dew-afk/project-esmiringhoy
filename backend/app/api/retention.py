"""Retention admin surface. The purge itself lives in services/retention.py
and runs from the worker on a schedule or on demand here."""

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..core.database import get_db
from ..core.deps import require_roles
from .. import models
from ..services.retention import purge_expired

router = APIRouter(prefix="/admin/retention", tags=["retention"])

admin_only = require_roles("admin")


@router.post("/run")
def run_purge(user: models.UserAccount = Depends(admin_only), db: Session = Depends(get_db)):
    result = purge_expired(db, by=f"admin:{user.email}")
    db.commit()
    return result


@router.get("/log")
def retention_log(
    user: models.UserAccount = Depends(admin_only),
    db: Session = Depends(get_db),
    limit: int = 100,
):
    limit = min(max(limit, 1), 500)
    return [
        {
            "target_type": r.target_type,
            "target_id": r.target_id,
            "purged_count": r.purged_count,
            "by": r.by,
            "at": r.at.isoformat(),
        }
        for r in db.query(models.RetentionLog)
        .order_by(models.RetentionLog.at.desc())
        .limit(limit)
        .all()
    ]
