"""Utilities for turning discovered public-name evidence into records."""

from __future__ import annotations

import re
import unicodedata
from dataclasses import asdict, dataclass
from datetime import datetime, timezone


@dataclass(frozen=True)
class NameEvidence:
    nif: str
    name: str
    name_type: str
    source_name: str
    source_url: str
    evidence_text: str | None = None
    confidence: float = 0.5
    collected_at: str | None = None
    source_kind: str = "web"
    direct_match: bool = False
    address_match: bool = False
    phone_match: bool = False
    community_confirmations: int = 0

    def to_dict(self) -> dict:
        result = asdict(self)
        if result["collected_at"] is None:
            result["collected_at"] = datetime.now(timezone.utc).isoformat()
        return result


def normalize_text(value: str) -> str:
    """Canonical comparison form: case, accents and punctuation insensitive."""
    value = unicodedata.normalize("NFKD", value)
    value = "".join(c for c in value if not unicodedata.combining(c))
    value = value.casefold()
    value = re.sub(r"[^\w\s]", " ", value, flags=re.UNICODE)
    return re.sub(r"\s+", " ", value).strip()


def normalize_public_name(value: str) -> str:
    return normalize_text(value)


def score_evidence(evidence: NameEvidence) -> float:
    score = 0.20
    if evidence.source_kind == "official":
        score += 0.45
    elif evidence.source_kind == "business_directory":
        score += 0.25
    elif evidence.source_kind == "company_website":
        score += 0.30
    if evidence.direct_match:
        score += 0.20
    if evidence.address_match:
        score += 0.10
    if evidence.phone_match:
        score += 0.10
    score += min(evidence.community_confirmations * 0.05, 0.20)
    return min(score, 0.99)


def aggregate_confidence(evidence: list[NameEvidence]) -> float:
    """Combine independent source observations without double-counting a source."""
    if not evidence:
        return 0.0
    best_by_source: dict[str, float] = {}
    for item in evidence:
        score = score_evidence(item)
        best_by_source[item.source_name] = max(best_by_source.get(item.source_name, 0.0), score)
    confidence = 1.0
    for score in sorted(best_by_source.values(), reverse=True):
        confidence *= 1.0 - score
    return round(1.0 - confidence, 3)


def make_evidence(
    nif: str,
    name: str,
    source_name: str,
    source_url: str,
    *,
    name_type: str = "commercial",
    evidence_text: str | None = None,
    confidence: float | None = None,
    source_kind: str = "web",
    direct_match: bool = False,
    address_match: bool = False,
    phone_match: bool = False,
    community_confirmations: int = 0,
) -> NameEvidence:
    if confidence is None:
        confidence = score_evidence(NameEvidence(
            nif=nif, name=name, name_type=name_type,
            source_name=source_name, source_url=source_url,
            source_kind=source_kind, direct_match=direct_match,
            address_match=address_match, phone_match=phone_match,
            community_confirmations=community_confirmations,
        ))
    if not 0 <= confidence <= 1:
        raise ValueError("confidence must be between 0 and 1")
    nif_digits = "".join(ch for ch in nif if ch.isdigit())
    if len(nif_digits) != 9:
        raise ValueError("NIF/NIPC must contain 9 digits")
    if not name.strip():
        raise ValueError("name cannot be empty")
    if not source_name.strip() or not source_url.strip():
        raise ValueError("source name and URL are required")
    return NameEvidence(
        nif=nif_digits,
        name=name.strip(),
        name_type=name_type,
        source_name=source_name.strip(),
        source_url=source_url.strip(),
        evidence_text=evidence_text.strip() if evidence_text else None,
        confidence=confidence,
        source_kind=source_kind,
        direct_match=direct_match,
        address_match=address_match,
        phone_match=phone_match,
        community_confirmations=community_confirmations,
    )
