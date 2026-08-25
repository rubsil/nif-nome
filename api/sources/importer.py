"""Normalize externally collected source findings into discovery candidates.

The importer does not fetch websites itself. A future crawler/API adapter can
feed it public findings, keeping collection separate from validation and
publication.
"""

from __future__ import annotations

from .directories import SOURCES, finding_to_candidate
from ..discovery import normalize_nif


def import_finding(*, source_key: str, nif: str, public_name: str, url: str) -> dict:
    if source_key not in SOURCES:
        raise ValueError("Fonte não suportada")

    normalized_nif = normalize_nif(nif)
    if len(normalized_nif) != 9:
        raise ValueError("NIF inválido")
    if not public_name.strip():
        raise ValueError("Nome público vazio")
    if not url.lower().startswith(("http://", "https://")):
        raise ValueError("URL inválido")

    return finding_to_candidate(
        nif=normalized_nif,
        public_name=public_name,
        source_key=source_key,
        url=url,
    )
