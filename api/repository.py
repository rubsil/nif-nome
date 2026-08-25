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


def get_company(nif: str) -> dict | None:
    return _read_json(COMPANIES_FILE, {}).get(nif)


def list_companies() -> list[dict]:
    return list(_read_json(COMPANIES_FILE, {}).values())


def add_suggestion(suggestion: dict) -> dict:
    suggestions = _read_json(SUGGESTIONS_FILE, [])
    suggestion = dict(suggestion)
    suggestion["id"] = len(suggestions) + 1
    suggestion["status"] = "pending"
    suggestions.append(suggestion)
    with SUGGESTIONS_FILE.open("w", encoding="utf-8") as file:
        json.dump(suggestions, file, ensure_ascii=False, indent=2)
    return suggestion
