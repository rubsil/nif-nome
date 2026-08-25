"""Minimal HTTP API for the NIF -> Nome prototype.

Development server only for now. The JSON dataset is intentionally kept as a
simple storage layer until PostgreSQL is introduced.
"""

from __future__ import annotations

import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[1]
DATA_FILE = ROOT / "web" / "data" / "companies.json"


def load_companies() -> dict:
    with DATA_FILE.open(encoding="utf-8") as file:
        return json.load(file)


class Handler(BaseHTTPRequestHandler):
    def send_json(self, status: int, payload: dict) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:  # noqa: N802
        path = urlparse(self.path).path.rstrip("/")
        parts = path.split("/")

        if path == "" or path == "/health":
            self.send_json(200, {"status": "ok", "service": "nif-nome"})
            return

        if len(parts) == 4 and parts[1:3] == ["api", "company"]:
            nif = parts[3]
            if not nif.isdigit() or len(nif) != 9:
                self.send_json(400, {"error": "NIF/NIPC inválido"})
                return
            company = load_companies().get(nif)
            if company is None:
                self.send_json(404, {"error": "NIF não encontrado", "nif": nif})
                return
            self.send_json(200, company)
            return

        self.send_json(404, {"error": "Endpoint não encontrado"})


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
