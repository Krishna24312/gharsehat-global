"""Lightweight Flask test-client check for POST /analyze-real."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

DEFAULT_YESTERDAY = REPO_ROOT / "static/demo/ravi_day4.jpg"
DEFAULT_TODAY = REPO_ROOT / "static/demo/ravi_day5.jpg"
REQUIRED_FIELDS = {
    "change_score",
    "redness_delta",
    "border_change",
    "mock",
    "disclaimer",
    "debug",
}
REQUIRED_DEBUG_FIELDS = {"preprocessing", "color_spaces_used", "warnings"}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Test /analyze-real with two image files.")
    parser.add_argument("--yesterday", type=Path, default=DEFAULT_YESTERDAY)
    parser.add_argument("--today", type=Path, default=DEFAULT_TODAY)
    return parser.parse_args()


def resolve_image_path(path: Path) -> Path:
    return path if path.is_absolute() else REPO_ROOT / path


def build_summary(payload: dict[str, Any]) -> dict[str, Any]:
    debug = payload["debug"]
    summary: dict[str, Any] = {
        "change_score": payload["change_score"],
        "redness_delta": payload["redness_delta"],
        "border_change": payload["border_change"],
        "mock": payload["mock"],
        "preprocessing": debug.get("preprocessing"),
        "color_spaces_used": debug.get("color_spaces_used"),
        "warnings": debug.get("warnings"),
    }
    if "experimental_features" in debug:
        summary["experimental_features"] = debug["experimental_features"]
    return summary


def main() -> int:
    args = parse_args()
    yesterday_path = resolve_image_path(args.yesterday)
    today_path = resolve_image_path(args.today)

    missing_files = [str(path) for path in (yesterday_path, today_path) if not path.is_file()]
    if missing_files:
        print(f"Missing image file(s): {', '.join(missing_files)}", file=sys.stderr)
        return 1

    try:
        from app import app
    except ModuleNotFoundError as error:
        print(
            f"Cannot import the Flask app because dependency '{error.name}' is unavailable. "
            "Install the existing requirements before running this script.",
            file=sys.stderr,
        )
        return 1

    with yesterday_path.open("rb") as yesterday_file, today_path.open("rb") as today_file:
        response = app.test_client().post(
            "/analyze-real",
            data={
                "yesterday": (yesterday_file, yesterday_path.name),
                "today": (today_file, today_path.name),
            },
            content_type="multipart/form-data",
        )

    if response.status_code != 200:
        detail = response.get_json(silent=True)
        print(
            f"/analyze-real returned HTTP {response.status_code}: "
            f"{json.dumps(detail) if detail is not None else response.get_data(as_text=True)}",
            file=sys.stderr,
        )
        return 1

    payload = response.get_json(silent=True)
    if not isinstance(payload, dict):
        print("/analyze-real did not return a JSON object.", file=sys.stderr)
        return 1

    missing_fields = sorted(REQUIRED_FIELDS - payload.keys())
    if missing_fields:
        print(f"Missing required response fields: {', '.join(missing_fields)}", file=sys.stderr)
        return 1
    if not isinstance(payload["debug"], dict):
        print("Required response field 'debug' is not an object.", file=sys.stderr)
        return 1
    missing_debug_fields = sorted(REQUIRED_DEBUG_FIELDS - payload["debug"].keys())
    if missing_debug_fields:
        print(
            f"Missing required debug fields: {', '.join(missing_debug_fields)}",
            file=sys.stderr,
        )
        return 1

    print(json.dumps(build_summary(payload), indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
