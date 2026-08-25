"""Provider interface for permitted web-search based discovery.

The provider accepts already obtained search results rather than scraping a
site. This keeps retrieval policy/credentials outside the core pipeline.
"""

from __future__ import annotations

from collections.abc import Iterable

from ..discovery import candidate_from_finding


def findings_from_search_results(nif: str, results: Iterable[dict]) -> list[dict]:
    """Convert search-result records into normalized discovery findings.

    Expected result fields: url, title, snippet and optionally public_name.
    No result is published here.
    """
    findings = []
    for result in results:
        url = str(result.get("url", "")).strip()
        if not url.startswith(("https://", "http://")):
            continue
        name = str(result.get("public_name", "")).strip()
        if len(name) < 2:
            # Keep the finding but let a later extraction/review step decide
            # whether the title/snippet contains a usable public name.
            name = str(result.get("title", "")).strip()
        if len(name) < 2:
            continue
        findings.append(candidate_from_finding(
            nif=nif,
            name=name,
            url=url,
            title=str(result.get("title", "")).strip(),
        ))
    return findings
