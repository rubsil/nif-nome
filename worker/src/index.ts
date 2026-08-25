export interface Env {
  DB: D1Database;
  ENVIRONMENT: string;
}

function json(data: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { "content-type": "application/json; charset=utf-8", ...(init.headers || {}) },
  });
}

function corsHeaders() {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type",
  };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders() });
    if (url.pathname === "/health") return json({ ok: true, environment: env.ENVIRONMENT }, { headers: corsHeaders() });

    if (url.pathname === "/api/search" && request.method === "GET") {
      const q = (url.searchParams.get("q") || "").trim();
      if (!q) return json({ results: [] }, { headers: corsHeaders() });

      const normalized = q.replace(/\D/g, "");
      const rows = normalized.length === 9
        ? await env.DB.prepare("SELECT * FROM companies WHERE nif = ? LIMIT 1").bind(normalized).all()
        : await env.DB.prepare("SELECT * FROM companies WHERE legal_name LIKE ? OR public_name LIKE ? LIMIT 20")
            .bind(`%${q}%`, `%${q}%`).all();

      return json({ results: rows.results }, { headers: corsHeaders() });
    }

    if (url.pathname === "/api/suggestions" && request.method === "POST") {
      const body = await request.json<{ nif?: string; name?: string; source_url?: string; note?: string }>();
      const nif = (body.nif || "").replace(/\D/g, "");
      const name = (body.name || "").trim();
      if (nif.length !== 9 || name.length < 2) {
        return json({ error: "NIF e nome são obrigatórios." }, { status: 400, headers: corsHeaders() });
      }

      await env.DB.prepare(
        "INSERT INTO suggestions (nif, name, source_url, note, status, created_at) VALUES (?, ?, ?, ?, 'pending', datetime('now'))"
      ).bind(nif, name, body.source_url || null, body.note || null).run();

      return json({ ok: true, status: "pending" }, { status: 201, headers: corsHeaders() });
    }

    return json({ error: "Not found" }, { status: 404, headers: corsHeaders() });
  },
};
