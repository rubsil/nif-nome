"""Small client for the public NIF.pt API.

The client deliberately returns the raw useful fields instead of trying to
infer a commercial name. Name discovery is a separate layer so every name
can retain its evidence and confidence.

Set NIFPT_API_KEY in the environment before using the API.
"""

from __future__ import annotations

import argparse
import json
import os
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

BASE_URL = "https://www.nif.pt/"


def normalize_nif(value: str) -> str:
    nif = "".join(ch for ch in value if ch.isdigit())
    if len(nif) != 9:
        raise ValueError("NIF/NIPC must contain 9 digits")
    return nif


def lookup(nif: str, api_key: str | None = None, timeout: int = 15) -> dict:
    nif = normalize_nif(nif)
    key = api_key or os.environ.get("NIFPT_API_KEY")
    if not key:
        raise RuntimeError("NIFPT_API_KEY is not set")

    query = urlencode({"json": "1", "q": nif, "key": key})
    request = Request(
        f"{BASE_URL}?{query}",
        headers={"User-Agent": "nif-nome/0.1 (+https://github.com/rubsil/nif-nome)"},
    )
    try:
        with urlopen(request, timeout=timeout) as response:
            payload = json.load(response)
    except (HTTPError, URLError) as exc:
        raise RuntimeError(f"NIF.pt request failed: {exc}") from exc

    if not isinstance(payload, dict):
        raise RuntimeError("Unexpected NIF.pt response")
    if payload.get("result") != "success":
        raise RuntimeError(f"NIF.pt returned an unsuccessful response: {payload}")

    return payload


def main() -> None:
    parser = argparse.ArgumentParser(description="Look up a Portuguese NIF using NIF.pt")
    parser.add_argument("nif")
    args = parser.parse_args()
    print(json.dumps(lookup(args.nif), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
