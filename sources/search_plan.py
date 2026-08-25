"""Build deterministic web-search queries for NIF -> public-name discovery.

This module does not fetch search results. It produces a small, ordered set of
queries that a search adapter can execute later, keeping discovery and network
access separate.
"""

from __future__ import annotations

import re
from dataclasses import dataclass


@dataclass(frozen=True)
class CompanyIdentity:
    nif: str
    legal_name: str
    address: str | None = None
    city: str | None = None
    postal_code: str | None = None
    phone: str | None = None
    website: str | None = None


def clean(value: str | None) -> str | None:
    if not value:
        return None
    value = re.sub(r"\s+", " ", value).strip()
    return value or None


def legal_name_without_suffix(name: str) -> str:
    """Remove common Portuguese legal suffixes to improve search recall."""
    result = re.sub(
        r"\s*,?\s*(LDA|LIMITADA|SA|S\.A\.|S\.A|UNIPESSOAL|LDA\.)\s*$",
        "",
        name,
        flags=re.IGNORECASE,
    )
    return result.strip(" ,")


def build_queries(company: CompanyIdentity) -> list[str]:
    """Return ordered, de-duplicated queries from strongest to broadest."""
    nif = "".join(ch for ch in company.nif if ch.isdigit())
    if len(nif) != 9:
        raise ValueError("NIF/NIPC must contain 9 digits")
    legal = clean(company.legal_name)
    if not legal:
        raise ValueError("legal_name cannot be empty")

    short = legal_name_without_suffix(legal)
    address = clean(company.address)
    city = clean(company.city)
    phone = clean(company.phone)

    candidates = [
        f'"{nif}"',
        f'"{nif}" "designação comercial"',
        f'"{nif}" "nome comercial"',
        f'"{nif}" "{legal}"',
        f'"{short}" "{nif}"',
    ]
    if city:
        candidates += [
            f'"{legal}" "{city}"',
            f'"{short}" "{city}"',
        ]
    if address:
        candidates.append(f'"{nif}" "{address}"')
    if phone:
        candidates.append(f'"{phone}" "{short}"')

    seen: set[str] = set()
    result: list[str] = []
    for query in candidates:
        query = re.sub(r"\s+", " ", query).strip()
        if query not in seen:
            seen.add(query)
            result.append(query)
    return result


if __name__ == "__main__":
    example = CompanyIdentity(
        nif="512044821",
        legal_name="SOUSA & SILVA, LDA",
        address="Rua D. Pedro IV, 31",
        city="Horta",
        phone="292 292 968",
    )
    for query in build_queries(example):
        print(query)
