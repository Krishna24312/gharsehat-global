"""In-memory + JSON-file persistence for caregiver-submitted check-ins.

Single-user hackathon demo: no database and no concurrency locking. Submitted
check-ins live in an in-memory list (rebuilt from checkins.json on import) and
are saved back atomically (.tmp then os.replace). Uploaded photos are written
under uploads/patient_<id>/. This stores caregiver-reported data only; it never
diagnoses.
"""

import json
import os
import uuid
from datetime import datetime, timezone

from werkzeug.datastructures import FileStorage
from werkzeug.utils import secure_filename

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
CHECKINS_FILE = os.path.join(BASE_DIR, "checkins.json")
UPLOADS_DIR = os.path.join(BASE_DIR, "uploads")
ALLOWED_EXTENSIONS = {"jpg", "jpeg", "png"}


class StorageError(Exception):
    """Raised on invalid uploads (e.g. an unsupported file extension)."""

    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.message = message


def load_submitted_checkins() -> list:
    """Load persisted check-ins; return [] if the file is missing or corrupt."""
    try:
        with open(CHECKINS_FILE, "r", encoding="utf-8") as handle:
            data = json.load(handle)
    except (OSError, json.JSONDecodeError):
        return []
    return data if isinstance(data, list) else []


# Rebuilt from disk on import; mutated in place by append_checkin.
SUBMITTED_CHECKINS: list = load_submitted_checkins()


def save_submitted_checkins(checkins: list) -> None:
    """Persist check-ins atomically (write .tmp, then os.replace)."""
    tmp_path = CHECKINS_FILE + ".tmp"
    with open(tmp_path, "w", encoding="utf-8") as handle:
        json.dump(checkins, handle, ensure_ascii=False, indent=2)
    os.replace(tmp_path, CHECKINS_FILE)


def append_checkin(entry: dict) -> None:
    """Append a check-in to the in-memory list and persist it."""
    SUBMITTED_CHECKINS.append(entry)
    save_submitted_checkins(SUBMITTED_CHECKINS)


# --- Doctor reviews (same local JSON style as check-ins above) ---
REVIEWS_FILE = os.path.join(BASE_DIR, "doctor_reviews.json")


def load_doctor_reviews() -> list:
    """Load persisted doctor reviews; return [] if the file is missing or corrupt."""
    try:
        with open(REVIEWS_FILE, "r", encoding="utf-8") as handle:
            data = json.load(handle)
    except (OSError, json.JSONDecodeError):
        return []
    return data if isinstance(data, list) else []


# Rebuilt from disk on import; mutated in place by append_review.
DOCTOR_REVIEWS: list = load_doctor_reviews()


def save_doctor_reviews(reviews: list) -> None:
    """Persist doctor reviews atomically (write .tmp, then os.replace)."""
    tmp_path = REVIEWS_FILE + ".tmp"
    with open(tmp_path, "w", encoding="utf-8") as handle:
        json.dump(reviews, handle, ensure_ascii=False, indent=2)
    os.replace(tmp_path, REVIEWS_FILE)


def append_review(entry: dict) -> None:
    """Append a doctor review to the in-memory list and persist it."""
    DOCTOR_REVIEWS.append(entry)
    save_doctor_reviews(DOCTOR_REVIEWS)


def get_reviews_for_patient(patient_id: str) -> list:
    """All doctor reviews for a patient, sorted by reviewed_at ascending."""
    items = [r for r in DOCTOR_REVIEWS if r.get("patient_id") == patient_id]
    return sorted(items, key=lambda r: r.get("reviewed_at", ""))


def get_latest_review_for_patient(patient_id: str) -> dict | None:
    """The most recent doctor review for a patient, or None."""
    items = get_reviews_for_patient(patient_id)
    return items[-1] if items else None


def safe_extension(filename: str) -> str:
    """Return a lowercase jpg/jpeg/png extension, or raise StorageError.

    secure_filename is used only to extract the extension safely from the
    original upload name.
    """
    cleaned = secure_filename(filename or "")
    extension = cleaned.rsplit(".", 1)[-1].lower() if "." in cleaned else ""
    if extension not in ALLOWED_EXTENSIONS:
        raise StorageError("Unsupported image type. Please upload a JPG or PNG image.")
    return extension


def save_uploaded_image(file_storage: FileStorage, patient_id: str) -> str:
    """Save an uploaded image under uploads/patient_<id>/ and return its URL.

    The saved filename is f"{timestamp}_{short_uuid}.{ext}" — it never contains
    the patient's name or any identifier from the original file.
    """
    extension = safe_extension(file_storage.filename)
    patient_dir = os.path.join(UPLOADS_DIR, f"patient_{patient_id}")
    os.makedirs(patient_dir, exist_ok=True)
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S")
    filename = f"{timestamp}_{uuid.uuid4().hex[:8]}.{extension}"
    file_storage.save(os.path.join(patient_dir, filename))
    return f"/uploads/patient_{patient_id}/{filename}"


def get_checkins_for_patient(patient_id: str) -> list:
    """All submitted check-ins for a patient, sorted by created_at ascending."""
    items = [c for c in SUBMITTED_CHECKINS if c.get("patient_id") == patient_id]
    return sorted(items, key=lambda c: c.get("created_at", ""))


def get_latest_checkin_for_patient(patient_id: str) -> dict | None:
    """The most recent submitted check-in for a patient, or None."""
    items = get_checkins_for_patient(patient_id)
    return items[-1] if items else None


def parse_float(value: object) -> float | None:
    """Parse a float, returning None if value is missing or unparseable."""
    try:
        return float(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None
