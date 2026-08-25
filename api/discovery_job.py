"""Batch discovery pipeline.

The job creates reviewable candidates only; it never publishes data.
Actual source fetching is injected through a provider callable so each source
can use its permitted API or retrieval mechanism.
"""

from __future__ import annotations

from collections.abc import Callable, Iterable

from .discovery import normalize_nif
from .repository import add_candidate


FindingProvider = Callable[[str], Iterable[dict]]


def run_discovery(nifs: Iterable[str], providers: dict[str, FindingProvider]) -> dict:
    processed = 0
    findings = 0
    candidates = 0
    errors = []

    for raw_nif in nifs:
        nif = normalize_nif(raw_nif)
        if len(nif) != 9:
            errors.append({"nif": raw_nif, "error": "NIF inválido"})
            continue

        processed += 1
        for source_name, provider in providers.items():
            try:
                for finding in provider(nif):
                    findings += 1
                    public_name = str(finding.get("public_name", "")).strip()
                    url = str(finding.get("url", "")).strip()
                    if len(public_name) < 2 or not url.startswith(("http://", "https://")):
                        continue
                    add_candidate({
                        "nif": nif,
                        "name": public_name,
                        "source": {
                            "name": finding.get("source_name", source_name),
                            "url": url,
                            "source_type": finding.get("source_type", "directory"),
                        },
                    })
                    candidates += 1
            except Exception as exc:  # provider isolation: one source must not stop the batch
                errors.append({"nif": nif, "source": source_name, "error": str(exc)})

    return {
        "processed_nifs": processed,
        "findings": findings,
        "candidates_added": candidates,
        "errors": errors,
    }
