"""Search and suggestion helpers for the prototype API."""

from __future__ import annotations

import json
import re
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA_FILE = ROOT / "web" / "data" / "companies.json"


def normalize(value: str) -> str:
    value = unicodedata.normalize("NFKD", value)
    value = "".join(c for c in value if not unicodedata.combining(c))
    value = re.sub(r"[^a-z0-9]+", " ", value.lower())
    return re.sub(r"\s+", " ", value).strip()


def load_companies() -> dict:
    with DATA_FILE.open(encoding="utf-8") as file:
        return json.load(file)


def search_companies(query: str) -> list[dict]:
    query = query.strip()
    if not query:
        return []
    normalized_query = normalize(query)
    companies = load_companies()
    results = []

    for company in companies.values():
        haystacks = [company.get("nif", ""), company.get("legalName", ""), company.get("location", "")]
        for public_name in company.get("publicNames", []):
            haystacks.append(public_name.get("name", ""))

        normalized_fields = [normalize(str(value)) for value in haystacks]
        if any(normalized_query in value for value in normalized_fields):
            results.append(company)

    return results


def validate_nif(nif: str) -> bool:
    return bool(re.fullmatch(r"\d{9}", nif))
