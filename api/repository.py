"""Storage abstraction for the API prototype.

JSON remains the current backend. The API can use this module without knowing
where records are stored, making the later PostgreSQL migration straightforward.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
COMPANIES_FILE = ROOT / "web" / "data" / "companies.json"
SUGGESTIONS_FILE = ROOT / "api" / "suggestions.json"


def _read_json(path: Path, default: Any) -> Any:
    if not path.exists():
        return default
    with path.open(encoding="utf-8") as file:
        return json.load(file)


def _write_json(path: Path, value: Any) -> None:
    with path.open("w", encoding="utf-8") as file:
        json.dump(value, file, ensure_ascii=False, indent=2)


def get_company(nif: str) -> dict | None:
    return _read_json(COMPANIES_FILE, {}).get(nif)


def list_companies() -> list[dict]:
    return list(_read_json(COMPANIES_FILE, {}).values())


def add_suggestion(suggestion: dict) -> dict:
    suggestions = _read_json(SUGGESTIONS_FILE, [])
    suggestion = dict(suggestion)
    suggestion["id"] = max((int(item.get("id", 0)) for item in suggestions), default=0) + 1
    suggestion["status"] = "pending"
    suggestions.append(suggestion)
    _write_json(SUGGESTIONS_FILE, suggestions)
    return suggestion


def list_pending_suggestions() -> list[dict]:
    return [item for item in _read_json(SUGGESTIONS_FILE, []) if item.get("status") == "pending"]


def review_suggestion(suggestion_id: int, decision: str) -> dict | None:
    suggestions = _read_json(SUGGESTIONS_FILE, [])
    for item in suggestions:
        if int(item.get("id", 0)) != suggestion_id or item.get("status") != "pending":
            continue
        item["status"] = "approved" if decision == "approve" else "rejected"
        item["reviewed_at"] = __import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat()
        _write_json(SUGGESTIONS_FILE, suggestions)
        return item
    return None
