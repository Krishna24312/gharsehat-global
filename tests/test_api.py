"""Tiny smoke tests for the core API routes (/assess, /review, /checkins).

Happy + sad paths only — a fast guard for the now multi-author backend, not
exhaustive coverage. Run with: python -m pytest

Persistence is redirected to a temp dir per test, so these never touch the real
checkins.json / doctor_reviews.json / uploads/.
"""

import io
import json
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

import storage  # noqa: E402
from app import app as flask_app  # noqa: E402


@pytest.fixture
def client(tmp_path, monkeypatch):
    # Isolate all persistence to a temp dir and start from empty in-memory lists.
    monkeypatch.setattr(storage, "CHECKINS_FILE", str(tmp_path / "checkins.json"))
    monkeypatch.setattr(storage, "REVIEWS_FILE", str(tmp_path / "doctor_reviews.json"))
    monkeypatch.setattr(storage, "UPLOADS_DIR", str(tmp_path / "uploads"))
    monkeypatch.setattr(storage, "SUBMITTED_CHECKINS", [])
    monkeypatch.setattr(storage, "DOCTOR_REVIEWS", [])
    flask_app.config.update(TESTING=True)
    return flask_app.test_client()


# --- /assess ---------------------------------------------------------------
def test_assess_valid(client):
    resp = client.post("/assess", json={"change_score": 68, "symptoms": {"fever": True}})
    assert resp.status_code == 200
    body = resp.get_json()
    assert body["status"] in {"green", "amber", "red"}
    assert "final_score" in body


def test_assess_missing_change_score(client):
    assert client.post("/assess", json={}).status_code == 400


def test_assess_out_of_range(client):
    assert client.post("/assess", json={"change_score": 200}).status_code == 400


# --- /patient/<id>/review --------------------------------------------------
def test_review_valid(client):
    resp = client.post(
        "/patient/1/review",
        json={"doctor_action": "recommend_clinic_visit", "doctor_note": "Visit tomorrow."},
    )
    assert resp.status_code == 201
    assert resp.get_json()["saved"] is True


def test_review_bad_patient(client):
    resp = client.post("/patient/999/review", json={"doctor_action": "continue_home_care"})
    assert resp.status_code == 404


def test_review_bad_action(client):
    resp = client.post("/patient/1/review", json={"doctor_action": "prescribe_antibiotics"})
    assert resp.status_code == 400


def test_review_then_history_exposes_latest_review(client):
    client.post("/patient/1/review", json={"doctor_action": "escalate_urgent_review"})
    history = client.get("/patient/1/history").get_json()
    assert history["latest_review"]["doctor_action"] == "escalate_urgent_review"


# --- /checkins -------------------------------------------------------------
def test_checkin_valid(client):
    data = {
        "patient_id": "1",
        "change_score": "40",
        "final_score": "35",
        "status": "amber",
        "symptoms": json.dumps({"fever": False}),
        "today": (io.BytesIO(b"fake-image-bytes"), "today.png"),
    }
    resp = client.post("/checkins", data=data, content_type="multipart/form-data")
    assert resp.status_code == 201
    assert resp.get_json()["saved"] is True


def test_checkin_missing_today_file(client):
    data = {
        "patient_id": "1",
        "change_score": "40",
        "final_score": "35",
        "status": "amber",
        "symptoms": "{}",
    }
    resp = client.post("/checkins", data=data, content_type="multipart/form-data")
    assert resp.status_code == 400
