"""HTTP route helpers kept separate from the development server."""
from __future__ import annotations
import re
from datetime import datetime, timezone
from .repository import add_candidate, add_suggestion, get_company, list_candidates, list_pending_suggestions, review_candidate, review_suggestion
from .search import search_companies, validate_nif


def lookup(nif: str) -> tuple[int, dict]:
    if not validate_nif(nif): return 400, {"error": "NIF/NIPC inválido"}
    company = get_company(nif)
    return (404, {"error": "NIF não encontrado", "nif": nif}) if company is None else (200, company)


def search(query: str) -> tuple[int, dict]:
    query = query.strip()
    if len(query) < 2: return 400, {"error": "A pesquisa deve ter pelo menos 2 caracteres"}
    return 200, {"query": query, "results": search_companies(query)[:20]}


def create_suggestion(payload: dict) -> tuple[int, dict]:
    nif = re.sub(r"\D", "", str(payload.get("nif", ""))); name = str(payload.get("name", "")).strip(); source_url = str(payload.get("source_url", "")).strip(); note = str(payload.get("note", "")).strip()
    if not validate_nif(nif): return 400, {"error": "NIF/NIPC inválido"}
    if not 2 <= len(name) <= 200: return 400, {"error": "O nome sugerido deve ter entre 2 e 200 caracteres"}
    if source_url and not re.match(r"^https?://", source_url, re.IGNORECASE): return 400, {"error": "A fonte deve ser um URL http(s) válido"}
    return 201, add_suggestion({"nif": nif, "name": name, "source_url": source_url or None, "note": note or None, "created_at": datetime.now(timezone.utc).isoformat()})


def admin_suggestions() -> tuple[int, list[dict]]: return 200, list_pending_suggestions()
def admin_candidates() -> tuple[int, list[dict]]: return 200, list_candidates()


def admin_review(suggestion_id: int, decision: str) -> tuple[int, dict]:
    if decision not in {"approve", "reject"}: return 400, {"error": "Decisão inválida"}
    updated = review_suggestion(suggestion_id, decision)
    return (404, {"error": "Sugestão não encontrada ou já revista"}) if updated is None else (200, updated)


def create_candidate(payload: dict) -> tuple[int, dict]:
    nif = re.sub(r"\D", "", str(payload.get("nif", ""))); name = str(payload.get("name", "")).strip(); source = payload.get("source") or {}
    if not validate_nif(nif): return 400, {"error": "NIF/NIPC inválido"}
    if not 2 <= len(name) <= 200: return 400, {"error": "Nome inválido"}
    if not isinstance(source, dict) or not re.match(r"^https?://", str(source.get("url", "")), re.I): return 400, {"error": "É obrigatória uma fonte web http(s)"}
    return 201, add_candidate({"nif": nif, "name": name, "source": source, "status": "candidate"})


def admin_candidate_review(candidate_id: int, decision: str) -> tuple[int, dict]:
    if decision not in {"approve", "reject"}: return 400, {"error": "Decisão inválida"}
    updated = review_candidate(candidate_id, decision)
    return (404, {"error": "Candidato não encontrado ou já revisto"}) if updated is None else (200, updated)
