"""Recording storage. STORAGE_PROVIDER=local is a DEVELOPMENT adapter only:
plaintext files on disk, loudly labeled, never to be confused with production
encrypted object storage (S3/SSE is the documented target)."""

from pathlib import Path
from typing import Optional

from ..core.config import settings


def _base() -> Path:
    settings.storage_dir.mkdir(parents=True, exist_ok=True)
    return settings.storage_dir


def put(recording_id: str, data: bytes) -> str:
    """Returns the object key. Dev adapter: recording file under storage/."""
    path = _base() / f"{recording_id}.bin"
    path.write_bytes(data)
    return str(path)


def exists(object_key: str) -> bool:
    return Path(object_key).is_file() if object_key else False


def path(object_key: str) -> Optional[Path]:
    p = Path(object_key)
    return p if p.is_file() else None


def delete(object_key: str) -> None:
    p = Path(object_key)
    if p.is_file():
        p.unlink()
