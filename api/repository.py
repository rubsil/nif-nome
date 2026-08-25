"""Storage abstraction for the API prototype."""

from __future__ import annotations

import json
from datetime import datetime, timezone
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
    companies = _read_json(COMPANIES_FILE, {})
    now = datetime.now(timezone.utc).isoformat()

    for item in suggestions:
        if int(item.get("id", 0)) != suggestion_id or item.get("status") != "pending":
            continue

        if decision == "approve":
            nif = item["nif"]
            company = companies.get(nif)
            if company is None:
                company = {
                    "nif": nif,
                    "legalName": "NIF identificado por contribuição comunitária",
                    "publicNames": [],
                    "location": None,
                }
                companies[nif] = company

            normalized = item["name"].strip().casefold()
            existing = next(
                (name for name in company.get("publicNames", [])
                 if name.get("name", "").strip().casefold() == normalized),
                None,
            )
            if existing is None:
                company.setdefault("publicNames", []).append({
                    "name": item["name"].strip(),
                    "type": "commercial",
                    "confidence": 0.70,
                    "sources": ([{"name": "Contribuição comunitária", "url": item["source_url"]}]
                                if item.get("source_url") else []),
                })
            elif item.get("source_url"):
                sources = existing.setdefault("sources", [])
                if not any(source.get("url") == item["source_url"] for source in sources):
                    sources.append({"name": "Contribuição comunitária", "url": item["source_url"]})

            item["status"] = "approved"
            item["published"] = True
            _write_json(COMPANIES_FILE, companies)
        else:
            item["status"] = "rejected"
            item["published"] = False

        item["reviewed_at"] = now
        _write_json(SUGGESTIONS_FILE, suggestions)
        return item
    return None
