"""Audit trail helper — every sensitive action lands in AuditLog."""

from sqlalchemy.orm import Session

from .. import models


def audit(db: Session, actor: str, action: str, target: str = "", detail: str = "") -> None:
    db.add(models.AuditLog(actor=actor, action=action, target=target, detail=detail))
