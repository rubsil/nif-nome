"""Helpers for turning public web findings into reviewable candidates.

Discovery deliberately does not publish anything. It creates candidates that
an administrator can verify before they become part of the public database.
"""

from __future__ import annotations

import re
from urllib.parse import urlparse


DIRECTORY_DOMAINS = {
    "empresite.jornaldenegocios.pt": "directory",
    "racius.com": "directory",
    "einforma.pt": "directory",
}

GOVERNMENT_SUFFIXES = (".gov.pt", ".gov.azores", ".gov-madeira", ".gov")


def normalize_nif(value: str) -> str:
    return re.sub(r"\D", "", value or "")


def classify_source(url: str) -> str:
    try:
        host = urlparse(url).hostname.lower().rstrip(".")
    except (AttributeError, ValueError):
        return "other"

    if any(host == domain or host.endswith("." + domain) for domain in DIRECTORY_DOMAINS):
        return DIRECTORY_DOMAINS.get(host, "directory")
    if any(host.endswith(suffix) for suffix in GOVERNMENT_SUFFIXES):
        return "government"
    return "web"


def extract_nifs(text: str) -> list[str]:
    candidates = re.findall(r"(?<!\d)(?:\d[ .-]?){9}(?!\d)", text or "")
    result = []
    for candidate in candidates:
        nif = normalize_nif(candidate)
        if len(nif) == 9 and nif not in result:
            result.append(nif)
    return result


def candidate_from_finding(*, nif: str, name: str, url: str, title: str = "") -> dict:
    return {
        "nif": normalize_nif(nif),
        "name": name.strip(),
        "source": {
            "name": title.strip() or urlparse(url).hostname or "Fonte web",
            "url": url,
            "source_type": classify_source(url),
        },
        "status": "candidate",
    }
