import { findByNif as findByNifPt } from "./providers/nifpt";
import { findByNif as findByVies } from "./providers/vies";
import { findByNif as findByPublicacoes } from "./providers/publicacoes";

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
  const address = row.address || row.location || null;
  return {
    nif: row.nif,
    legalName: row.legal_name,
    location: row.location,
    address,
    website: row.website || null,
    publicNames: row.public_name ? [{ name: row.public_name, type: "nome comercial", confidence, sources: [] }] : [],
  };
}

async function saveCompany(env: Env, nif: string, legalName: string, publicName: string | null, location: string | null, confidence: number) {
  await env.DB.prepare(
    `INSERT INTO companies (nif, legal_name, public_name, location, confidence)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(nif) DO UPDATE SET
       legal_name = CASE WHEN companies.legal_name = '' THEN excluded.legal_name ELSE companies.legal_name END,
       public_name = COALESCE(excluded.public_name, companies.public_name),
       location = COALESCE(excluded.location, companies.location),
       confidence = MAX(companies.confidence, excluded.confidence)`
  ).bind(nif, legalName, publicName, location, confidence).run();
}

async function discoverWithNifPt(nif: string, env: Env) {
  if (!env.NIFPT_API_KEY) throw new Error("API key não configurada no Worker");
  const found = await findByNifPt(nif, env.NIFPT_API_KEY);
  if (!found) return null;
  const r = found.record;
  const location = r.place?.city || r.city || r.geo?.county || null;
  const publicName = r.alias || null;
  await saveCompany(env, nif, r.title || "", publicName, location, publicName ? 0.85 : 0.65);
  return { nif, legalName: r.title || null, publicName, location, address: r.address || r.place?.address || null, website: r.contacts?.website || null, activity: r.activity || null, cae: r.cae || null, source: "nif.pt" };
}

async function discoverWithVies(nif: string, env: Env) {
  const found = await findByVies(nif);
  if (!found) return null;
  const location = found.address || null;
  await saveCompany(env, nif, found.legalName || "", null, location, 0.75);
  return { nif, legalName: found.legalName || null, publicName: null, location, address: location, website: null, activity: null, cae: null, source: "vies", requestDate: found.requestDate || null };
}

async function discoverWithPublicacoes(nif: string, env: Env) {
  const found = await findByPublicacoes(nif);
  if (!found) return null;
  const candidates = found.publicNames.filter(name => name.replace(/\s+/g, " ").trim().length > 2);
  const publicName = candidates[0] || null;
  if (found.legalName || publicName) {
    await saveCompany(env, nif, found.legalName || "", publicName, found.address || null, publicName ? 0.80 : 0.70);
  }
  return {
    nif,
    legalName: found.legalName,
    publicName,
    location: found.address,
    address: found.address,
    website: null,
    activity: null,
    cae: null,
    source: "publicacoes.mj.pt",
    sourceUrl: found.sourceUrl,
    candidates,
  };
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

      const sourcesChecked: string[] = [];
      const providerErrors: Record<string, string> = {};

      sourcesChecked.push("nif.pt");
      try {
        const discovered = await discoverWithNifPt(nif, env);
        if (discovered) return json({ found: true, cached: false, company: discovered, sources_checked: sourcesChecked });
      } catch (error) {
        providerErrors["nif.pt"] = String(error).replace(/[\r\n]/g, " ").slice(0, 200);
        console.error(JSON.stringify({ event: "discovery_error", provider: "nif.pt", nif, error: providerErrors["nif.pt"] }));
      }

      sourcesChecked.push("vies");
      try {
        const discovered = await discoverWithVies(nif, env);
        if (discovered) return json({ found: true, cached: false, company: discovered, sources_checked: sourcesChecked });
      } catch (error) {
        providerErrors["vies"] = String(error).replace(/[\r\n]/g, " ").slice(0, 200);
        console.error(JSON.stringify({ event: "discovery_error", provider: "vies", nif, error: providerErrors["vies"] }));
      }

      sourcesChecked.push("publicacoes.mj.pt");
      try {
        const discovered = await discoverWithPublicacoes(nif, env);
        if (discovered) return json({ found: true, cached: false, company: discovered, sources_checked: sourcesChecked });
      } catch (error) {
        providerErrors["publicacoes.mj.pt"] = String(error).replace(/[\r\n]/g, " ").slice(0, 200);
        console.error(JSON.stringify({ event: "discovery_error", provider: "publicacoes.mj.pt", nif, error: providerErrors["publicacoes.mj.pt"] }));
      }

      return json({ found: false, sources_checked: sourcesChecked, ...(Object.keys(providerErrors).length ? { provider_errors: providerErrors } : {}) });
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
