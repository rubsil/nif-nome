"""Storage abstraction for the API prototype."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from confidence import confidence_for_sources

ROOT = Path(__file__).resolve().parents[1]
COMPANIES_FILE = ROOT / "web" / "data" / "companies.json"
SUGGESTIONS_FILE = ROOT / "api" / "suggestions.json"
CANDIDATES_FILE = ROOT / "api" / "candidates.json"


def _read_json(path: Path, default: Any) -> Any:
    if not path.exists(): return default
    with path.open(encoding="utf-8") as file: return json.load(file)


def _write_json(path: Path, value: Any) -> None:
    with path.open("w", encoding="utf-8") as file: json.dump(value, file, ensure_ascii=False, indent=2)


def get_company(nif: str) -> dict | None: return _read_json(COMPANIES_FILE, {}).get(nif)

def list_companies() -> list[dict]: return list(_read_json(COMPANIES_FILE, {}).values())


def add_suggestion(suggestion: dict) -> dict:
    suggestions = _read_json(SUGGESTIONS_FILE, [])
    suggestion = dict(suggestion); suggestion["id"] = max((int(item.get("id", 0)) for item in suggestions), default=0) + 1; suggestion["status"] = "pending"
    suggestions.append(suggestion); _write_json(SUGGESTIONS_FILE, suggestions); return suggestion


def list_pending_suggestions() -> list[dict]: return [item for item in _read_json(SUGGESTIONS_FILE, []) if item.get("status") == "pending"]


def add_candidate(candidate: dict) -> dict:
    candidates = _read_json(CANDIDATES_FILE, [])
    nif = candidate.get("nif", ""); name = candidate.get("name", "").strip().casefold()
    for item in candidates:
        if item.get("status") == "candidate" and item.get("nif") == nif and item.get("name", "").strip().casefold() == name: return item
    candidate = dict(candidate); candidate["id"] = max((int(item.get("id", 0)) for item in candidates), default=0) + 1; candidate["created_at"] = datetime.now(timezone.utc).isoformat(); candidates.append(candidate)
    _write_json(CANDIDATES_FILE, candidates); return candidate


def list_candidates() -> list[dict]: return [item for item in _read_json(CANDIDATES_FILE, []) if item.get("status") == "candidate"]


def review_candidate(candidate_id: int, decision: str) -> dict | None:
    candidates = _read_json(CANDIDATES_FILE, [])
    for item in candidates:
        if int(item.get("id", 0)) != candidate_id or item.get("status") != "candidate": continue
        if decision == "approve":
            companies = _read_json(COMPANIES_FILE, {})
            company = companies.setdefault(item["nif"], {"nif": item["nif"], "legalName": "NIF identificado por descoberta web", "publicNames": [], "location": None})
            names = company.setdefault("publicNames", []); normalized = item["name"].strip().casefold()
            existing = next((n for n in names if n.get("name", "").strip().casefold() == normalized), None)
            if existing is None:
                existing = {"name": item["name"].strip(), "type": "commercial", "confidence": 0.0, "sources": []}; names.append(existing)
            source = item.get("source") or {}
            if source.get("url") and not any(s.get("url") == source["url"] for s in existing.setdefault("sources", [])): existing["sources"].append(source)
            existing["confidence"] = confidence_for_sources(existing["sources"]); _write_json(COMPANIES_FILE, companies); item["published"] = True
        else: item["published"] = False
        item["status"] = "approved" if decision == "approve" else "rejected"; item["reviewed_at"] = datetime.now(timezone.utc).isoformat(); _write_json(CANDIDATES_FILE, candidates); return item
    return None


def review_suggestion(suggestion_id: int, decision: str) -> dict | None:
    suggestions = _read_json(SUGGESTIONS_FILE, []); companies = _read_json(COMPANIES_FILE, {}); now = datetime.now(timezone.utc).isoformat()
    for item in suggestions:
        if int(item.get("id", 0)) != suggestion_id or item.get("status") != "pending": continue
        if decision == "approve":
            company = companies.setdefault(item["nif"], {"nif": item["nif"], "legalName": "NIF identificado por contribuição comunitária", "publicNames": [], "location": None})
            normalized = item["name"].strip().casefold(); existing = next((n for n in company.get("publicNames", []) if n.get("name", "").strip().casefold() == normalized), None)
            if existing is None:
                existing = {"name": item["name"].strip(), "type": "commercial", "confidence": 0.0, "sources": []}; company.setdefault("publicNames", []).append(existing)
            if item.get("source_url") and not any(s.get("url") == item["source_url"] for s in existing.setdefault("sources", [])): existing["sources"].append({"name": "Contribuição comunitária", "url": item["source_url"], "source_type": "community"})
            existing["confidence"] = confidence_for_sources(existing.get("sources", [])); item["published"] = True; _write_json(COMPANIES_FILE, companies)
        else: item["published"] = False
        item["status"] = "approved" if decision == "approve" else "rejected"; item["reviewed_at"] = now; _write_json(SUGGESTIONS_FILE, suggestions); return item
    return None
