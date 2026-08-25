"""Helpers for public business directories.

These adapters only build search targets and normalize findings supplied by a
crawler/import job. They do not bypass authentication, paywalls, robots rules,
or terms of service.
"""

from __future__ import annotations

from urllib.parse import quote_plus


SOURCES = {
    "racius": {
        "name": "Racius",
        "base_url": "https://www.racius.com/",
        "source_type": "directory",
    },
    "einforma": {
        "name": "eInforma",
        "base_url": "https://www.einforma.pt/",
        "source_type": "directory",
    },
    "empresite": {
        "name": "Empresite",
        "base_url": "https://empresite.jornaldenegocios.pt/",
        "source_type": "directory",
    },
}


def search_targets(nif: str) -> list[dict]:
    """Return human/crawler-readable search targets for a NIF."""
    query = quote_plus(nif.strip())
    return [
        {
            "source": key,
            "name": value["name"],
            "source_type": value["source_type"],
            "url": f"{value['base_url']}search/?q={query}",
        }
        for key, value in SOURCES.items()
    ]


def finding_to_candidate(*, nif: str, public_name: str, source_key: str, url: str) -> dict:
    source = SOURCES[source_key]
    return {
        "nif": nif,
        "name": public_name.strip(),
        "source": {
            "name": source["name"],
            "url": url,
            "source_type": source["source_type"],
        },
        "status": "candidate",
    }
