from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from ..core.database import get_db
from ..core.deps import current_consent, get_current_user
from ..core.config import settings
from ..core.limiter import limiter
from ..core.security import create_token, hash_password, verify_password
from .. import models, schemas
from ..schemas import model_to_user_out

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/login", response_model=schemas.TokenResponse)
@limiter.limit(settings.login_rate_limit)
def login(request: Request, body: schemas.LoginRequest, db: Session = Depends(get_db)):
    user = db.query(models.UserAccount).filter(models.UserAccount.email == body.email).first()
    if user is None or not user.password_hash or not verify_password(body.password, user.password_hash):
        # Same error for unknown email and bad password — no user enumeration.
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid email or password")
    if user.approval_status == "pending":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Account pending institution approval")
    return schemas.TokenResponse(
        access_token=create_token(user.id),
        user=model_to_user_out(user, current_consent(db, user.id)),
    )


@router.get("/me", response_model=schemas.UserOut)
def me(user: models.UserAccount = Depends(get_current_user), db: Session = Depends(get_db)):
    return model_to_user_out(user, current_consent(db, user.id))


@router.post("/register", response_model=schemas.TokenResponse, status_code=201)
def register(body: schemas.RegisterRequest, db: Session = Depends(get_db)):
    institution = db.get(models.Institution, body.institution_id)
    if institution is None:
        raise HTTPException(404, "Unknown institution")
    if db.query(models.UserAccount).filter(models.UserAccount.email == body.email).first():
        raise HTTPException(409, "Email already registered")
    if body.role == "student" and not body.consent:
        raise HTTPException(422, "Monitoring consent is required for students")
    user = models.UserAccount(
        id=f"u_{body.email.split('@')[0]}_{len(body.email)}",
        institution_id=body.institution_id,
        role=body.role,
        full_name=body.full_name,
        email=body.email,
        password_hash=hash_password(body.password),
        roster_id=body.roster_id or None,
        department=body.department or None,
        approval_status="pending" if body.role == "proctor" else "approved",
    )
    db.add(user)
    if body.role == "student":
        db.add(models.Consents(user_id=user.id, action="granted"))
    db.commit()
    if body.role == "proctor":
        raise HTTPException(
            status.HTTP_201_CREATED,
            detail="Proctor account registered — awaiting institution admin approval before login",
        )
    return schemas.TokenResponse(
        access_token=create_token(user.id),
        user=model_to_user_out(user, "granted"),
    )


@router.post("/consent")
def set_consent(
    body: schemas.ConsentRequest,
    user: models.UserAccount = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if user.role != "student":
        raise HTTPException(403, "Only students manage monitoring consent")
    db.add(models.Consents(user_id=user.id, action=body.action))
    db.commit()
    return {"consent_status": body.action}
