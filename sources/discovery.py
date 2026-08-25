"""Utilities for turning discovered public-name evidence into records.

This module intentionally does not scrape arbitrary websites yet. It defines
the common evidence shape that future source adapters will return.
"""

from __future__ import annotations

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

    def to_dict(self) -> dict:
        result = asdict(self)
        if result["collected_at"] is None:
            result["collected_at"] = datetime.now(timezone.utc).isoformat()
        return result


def make_evidence(
    nif: str,
    name: str,
    source_name: str,
    source_url: str,
    *,
    name_type: str = "commercial",
    evidence_text: str | None = None,
    confidence: float = 0.5,
) -> NameEvidence:
    """Create a normalized evidence record.

    Confidence is constrained here so bad source adapters cannot insert
    nonsensical values into the pipeline.
    """
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
    )
