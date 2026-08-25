"""Confidence scoring for public company names.

The score is intentionally conservative: a community suggestion alone is
never treated as high-confidence evidence.
"""

SOURCE_WEIGHTS = {
    "official": 0.85,
    "government": 0.85,
    "directory": 0.55,
    "web": 0.45,
    "community": 0.30,
    "other": 0.25,
}


def confidence_for_sources(sources: list[dict]) -> float:
    if not sources:
        return 0.0

    unique = {}
    for source in sources:
        url = str(source.get("url", "")).strip()
        if not url:
            continue
        source_type = source.get("source_type", "community")
        unique[url] = max(unique.get(url, 0.0), SOURCE_WEIGHTS.get(source_type, 0.25))

    if not unique:
        return 0.0

    # Independent evidence raises confidence, but with diminishing returns.
    ordered = sorted(unique.values(), reverse=True)
    score = ordered[0]
    multiplier = 0.55
    for weight in ordered[1:]:
        score += weight * multiplier
        multiplier *= 0.55

    return round(min(score, 0.99), 3)


def confidence_label(score: float) -> str:
    if score >= 0.85:
        return "elevada"
    if score >= 0.60:
        return "provável"
    if score >= 0.35:
        return "baixa"
    return "insuficiente"
