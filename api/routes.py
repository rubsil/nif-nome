"""HTTP route helpers kept separate from the development server."""

from __future__ import annotations

import re
from datetime import datetime, timezone

from .repository import add_suggestion, get_company
from .search import search_companies, validate_nif


def lookup(nif: str) -> tuple[int, dict]:
    if not validate_nif(nif):
        return 400, {"error": "NIF/NIPC inválido"}
    company = get_company(nif)
    if company is None:
        return 404, {"error": "NIF não encontrado", "nif": nif}
    return 200, company


def search(query: str) -> tuple[int, dict]:
    query = query.strip()
    if len(query) < 2:
        return 400, {"error": "A pesquisa deve ter pelo menos 2 caracteres"}
    return 200, {"query": query, "results": search_companies(query)[:20]}


def create_suggestion(payload: dict) -> tuple[int, dict]:
    nif = re.sub(r"\D", "", str(payload.get("nif", "")))
    name = str(payload.get("name", "")).strip()
    source_url = str(payload.get("source_url", "")).strip()
    note = str(payload.get("note", "")).strip()

    if not validate_nif(nif):
        return 400, {"error": "NIF/NIPC inválido"}
    if not 2 <= len(name) <= 200:
        return 400, {"error": "O nome sugerido deve ter entre 2 e 200 caracteres"}
    if source_url and not re.match(r"^https?://", source_url, re.IGNORECASE):
        return 400, {"error": "A fonte deve ser um URL http(s) válido"}

    suggestion = add_suggestion({
        "nif": nif,
        "name": name,
        "source_url": source_url or None,
        "note": note or None,
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    return 201, suggestion
