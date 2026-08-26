import { findByNif } from "./providers/nifpt";

export interface Env {
  DB: D1Database;
  ENVIRONMENT: string;
  ASSETS: Fetcher;
  NIFPT_API_KEY?: string;
}

function corsHeaders() {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type",
  };
}

function json(data: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { "content-type": "application/json; charset=utf-8", ...(init.headers || {}), ...corsHeaders() },
  });
}

function companyPayload(row: Record<string, unknown>) {
  const confidence = Number(row.confidence) || 0;
  return {
    nif: row.nif,
    legalName: row.legal_name,
    location: row.location,
    publicNames: row.public_name ? [{ name: row.public_name, type: "nome comercial", confidence, sources: [] }] : [],
  };
}

async function discoverWithNifPt(nif: string, env: Env) {
  if (!env.NIFPT_API_KEY) throw new Error("API key não configurada no Worker");
  const found = await findByNif(nif, env.NIFPT_API_KEY);
  if (!found) return null;
  const r = found.record;
  const location = r.place?.city || r.city || r.geo?.county || null;
  const publicName = r.alias || null;

  await env.DB.prepare(
    `INSERT INTO companies (nif, legal_name, public_name, location, confidence)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(nif) DO UPDATE SET
       legal_name = excluded.legal_name,
       public_name = COALESCE(excluded.public_name, companies.public_name),
       location = COALESCE(excluded.location, companies.location)`
  ).bind(nif, r.title || "", publicName, location, publicName ? 0.85 : 0).run();

  return { nif, legalName: r.title || null, publicName, location, website: r.contacts?.website || null, activity: r.activity || null, cae: r.cae || null, source: "nif.pt" };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders() });
    if (url.pathname === "/health") return json({ ok: true, environment: env.ENVIRONMENT || "production" });

    if (url.pathname === "/api/discover" && request.method === "GET") {
      const nif = (url.searchParams.get("nif") || "").replace(/\D/g, "");
      if (nif.length !== 9) return json({ error: "NIF inválido." }, { status: 400 });
      const existing = await env.DB.prepare("SELECT * FROM companies WHERE nif = ? LIMIT 1").bind(nif).first<Record<string, unknown>>();
      if (existing) return json({ found: true, cached: true, company: companyPayload(existing) });
      try {
        const discovered = await discoverWithNifPt(nif, env);
        if (discovered) return json({ found: true, cached: false, company: discovered });
      } catch (error) {
        const message = String(error).replace(/[\r\n]/g, " ").slice(0, 200);
        console.error(JSON.stringify({ event: "discovery_error", provider: "nif.pt", nif, error: message }));
        return json({ found: false, sources_checked: ["nif.pt"], provider_error: message }, { status: 502 });
      }
      return json({ found: false, sources_checked: ["nif.pt"] });
    }

    if (url.pathname.startsWith("/api/company/") && request.method === "GET") {
      const nif = url.pathname.slice("/api/company/".length).replace(/\D/g, "");
      if (nif.length !== 9) return json({ error: "NIF inválido." }, { status: 400 });
      const row = await env.DB.prepare("SELECT * FROM companies WHERE nif = ? LIMIT 1").bind(nif).first<Record<string, unknown>>();
      if (!row) return json({ error: "Empresa não encontrada." }, { status: 404 });
      return json(companyPayload(row));
    }

    if (url.pathname === "/api/search" && request.method === "GET") {
      const q = (url.searchParams.get("q") || "").trim();
      if (!q) return json({ results: [] });
      const digits = q.replace(/\D/g, "");
      const rows = digits.length === 9
        ? await env.DB.prepare("SELECT * FROM companies WHERE nif = ? LIMIT 1").bind(digits).all()
        : await env.DB.prepare("SELECT * FROM companies WHERE legal_name LIKE ? OR public_name LIKE ? OR location LIKE ? LIMIT 20").bind(`%${q}%`, `%${q}%`, `%${q}%`).all();
      return json({ results: rows.results.map(companyPayload) });
    }

    if (url.pathname === "/api/suggestions" && request.method === "POST") {
      const body = await request.json<{ nif?: string; name?: string; source_url?: string; note?: string }>();
      const nif = (body.nif || "").replace(/\D/g, "");
      const name = (body.name || "").trim();
      if (nif.length !== 9 || name.length < 2) return json({ error: "NIF e nome são obrigatórios." }, { status: 400 });
      await env.DB.prepare("INSERT INTO suggestions (nif, name, source_url, note, status, created_at) VALUES (?, ?, ?, ?, 'pending', datetime('now'))").bind(nif, name, body.source_url || null, body.note || null).run();
      return json({ ok: true, status: "pending" }, { status: 201 });
    }

    return env.ASSETS.fetch(request);
  },
};
