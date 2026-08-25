"""Minimal HTTP API for the NIF -> Nome prototype."""

from __future__ import annotations

import json
import re
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from search import search_companies

ROOT = Path(__file__).resolve().parents[1]
DATA_FILE = ROOT / "web" / "data" / "companies.json"
SUGGESTIONS_FILE = ROOT / "api" / "suggestions.json"


def load_companies() -> dict:
    with DATA_FILE.open(encoding="utf-8") as file:
        return json.load(file)


def save_suggestion(payload: dict) -> None:
    suggestions = []
    if SUGGESTIONS_FILE.exists():
        with SUGGESTIONS_FILE.open(encoding="utf-8") as file:
            suggestions = json.load(file)
    suggestions.append(payload)
    with SUGGESTIONS_FILE.open("w", encoding="utf-8") as file:
        json.dump(suggestions, file, ensure_ascii=False, indent=2)
        file.write("\n")


class Handler(BaseHTTPRequestHandler):
    def send_json(self, status: int, payload: dict | list) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self) -> None:  # noqa: N802
        self.send_json(204, {})

    def do_GET(self) -> None:  # noqa: N802
        path = urlparse(self.path).path.rstrip("/")
        parts = path.split("/")

        if path == "" or path == "/health":
            self.send_json(200, {"status": "ok", "service": "nif-nome"})
            return

        if len(parts) == 4 and parts[1:3] == ["api", "company"]:
            nif = parts[3]
            if not re.fullmatch(r"\d{9}", nif):
                self.send_json(400, {"error": "NIF/NIPC inválido"})
                return
            company = load_companies().get(nif)
            if company is None:
                self.send_json(404, {"error": "NIF não encontrado", "nif": nif})
                return
            self.send_json(200, company)
            return

        if path == "/api/search":
            query = parse_qs(urlparse(self.path).query).get("q", [""])[0]
            results = search_companies(query)[:20]
            self.send_json(200, {"query": query, "count": len(results), "results": results})
            return

        self.send_json(404, {"error": "Endpoint não encontrado"})

    def do_POST(self) -> None:  # noqa: N802
        path = urlparse(self.path).path.rstrip("/")
        if path != "/api/suggestions":
            self.send_json(404, {"error": "Endpoint não encontrado"})
            return

        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length > 8192:
                self.send_json(413, {"error": "Sugestão demasiado grande"})
                return
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
        except (ValueError, json.JSONDecodeError):
            self.send_json(400, {"error": "JSON inválido"})
            return

        nif = re.sub(r"\D", "", str(payload.get("nif", "")))
        name = str(payload.get("name", "")).strip()
        source_url = str(payload.get("source_url", "")).strip()
        if not re.fullmatch(r"\d{9}", nif):
            self.send_json(400, {"error": "NIF/NIPC inválido"})
            return
        if not name or len(name) > 200:
            self.send_json(400, {"error": "Nome público inválido"})
            return
        if len(source_url) > 1000:
            self.send_json(400, {"error": "Fonte demasiado longa"})
            return

        suggestion = {
            "nif": nif,
            "name": name,
            "source_url": source_url,
            "status": "pending",
        }
        save_suggestion(suggestion)
        self.send_json(201, {"message": "Sugestão recebida", "suggestion": suggestion})


def main() -> None:
    server = ThreadingHTTPServer(("127.0.0.1", 8000), Handler)
    print("NIF → Nome API: http://127.0.0.1:8000")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
