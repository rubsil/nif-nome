"""Development HTTP server for the NIF -> Nome API."""
from __future__ import annotations
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse
from routes import admin_candidate_review, admin_candidates, admin_review, admin_suggestions, create_candidate, create_suggestion, lookup, search

class Handler(BaseHTTPRequestHandler):
    def send_json(self, status: int, payload: dict | list) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8"); self.send_response(status); self.send_header("Content-Type", "application/json; charset=utf-8"); self.send_header("Content-Length", str(len(body))); self.send_header("Access-Control-Allow-Origin", "*"); self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS"); self.send_header("Access-Control-Allow-Headers", "Content-Type"); self.end_headers(); self.wfile.write(body)
    def do_OPTIONS(self) -> None: self.send_json(204, {})
    def do_GET(self) -> None:
        parsed = urlparse(self.path); path = parsed.path.rstrip("/") or "/"; parts = path.split("/")
        if path in {"/", "/health"}: self.send_json(200, {"status": "ok", "service": "nif-nome"}); return
        if len(parts) == 4 and parts[1:3] == ["api", "company"]: status, payload = lookup(parts[3]); self.send_json(status, payload); return
        if path == "/api/search": status, payload = search(parse_qs(parsed.query).get("q", [""])[0]); self.send_json(status, payload); return
        if path == "/api/admin/suggestions": status, payload = admin_suggestions(); self.send_json(status, payload); return
        if path == "/api/admin/candidates": status, payload = admin_candidates(); self.send_json(status, payload); return
        self.send_json(404, {"error": "Endpoint não encontrado"})
    def do_POST(self) -> None:
        path = urlparse(self.path).path.rstrip("/"); parts = path.split("/")
        if path.startswith("/api/admin/suggestions/") and len(parts) == 6:
            try: suggestion_id = int(parts[4])
            except ValueError: self.send_json(400, {"error": "ID inválido"}); return
            status, payload = admin_review(suggestion_id, parts[5]); self.send_json(status, payload); return
        if path.startswith("/api/admin/candidates/") and len(parts) == 6:
            try: candidate_id = int(parts[4])
            except ValueError: self.send_json(400, {"error": "ID inválido"}); return
            status, payload = admin_candidate_review(candidate_id, parts[5]); self.send_json(status, payload); return
        try:
            length = int(self.headers.get("Content-Length", "0"));
            if length > 8192: self.send_json(413, {"error": "Payload demasiado grande"}); return
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
        except (ValueError, json.JSONDecodeError): self.send_json(400, {"error": "JSON inválido"}); return
        if path == "/api/suggestions": status, response = create_suggestion(payload); self.send_json(status, response); return
        if path == "/api/discovery/candidates": status, response = create_candidate(payload); self.send_json(status, response); return
        self.send_json(404, {"error": "Endpoint não encontrado"})

def main() -> None:
    server = ThreadingHTTPServer(("127.0.0.1", 8000), Handler); print("NIF → Nome API: http://127.0.0.1:8000")
    try: server.serve_forever()
    except KeyboardInterrupt: pass
    finally: server.server_close()
if __name__ == "__main__": main()
