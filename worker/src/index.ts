import { findByNif as findByNifPt } from "./providers/nifpt";
import { findByNif as findByVies } from "./providers/vies";
import { findByNif as findByPublicacoes } from "./providers/publicacoes";
import { findByNif as findByEInforma } from "./providers/einforma";

export interface Env {
  DB: D1Database;
  ENVIRONMENT: string;
  ASSETS: Fetcher;
  NIFPT_API_KEY?: string;
}

function corsHeaders() {
  return { "access-control-allow-origin": "*", "access-control-allow-methods": "GET,POST,OPTIONS", "access-control-allow-headers": "content-type" };
}
function json(data: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(data), { ...init, headers: { "content-type": "application/json; charset=utf-8", ...(init.headers || {}), ...corsHeaders() } });
}
function companyPayload(row: Record<string, unknown>) {
  const confidence = Number(row.confidence) || 0;
  return { nif: row.nif, legalName: row.legal_name, location: row.location, address: row.address || row.location || null, website: row.website || null, publicNames: row.public_name ? [{ name: row.public_name, type: "nome comercial", confidence, sources: [] }] : [] };
}
async function saveCompany(env: Env, nif: string, legalName: string, publicName: string | null, location: string | null, confidence: number) {
  await env.DB.prepare(`INSERT INTO companies (nif, legal_name, public_name, location, confidence) VALUES (?, ?, ?, ?, ?) ON CONFLICT(nif) DO UPDATE SET legal_name = CASE WHEN companies.legal_name = '' THEN excluded.legal_name ELSE companies.legal_name END, public_name = COALESCE(excluded.public_name, companies.public_name), location = COALESCE(excluded.location, companies.location), confidence = MAX(companies.confidence, excluded.confidence)`).bind(nif, legalName, publicName, location, confidence).run();
}
function isUsablePublicName(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const v = value.trim();
  if (v.length < 3 || v.length > 100) return false;
  if (/&(?:ccedil|atilde|otilde|aacute|eacute|iacute|oacute|uacute|agrave|ecirc|ocirc|acirc);/i.test(v)) return false;
  if (/licenciada|líder|lider|mercado|informação para negócios|informacao para negocios|informa d&b/i.test(v)) return false;
  if (/^(?:s|e)\s+publica/i.test(v)) return false;
  return true;
}
async function discoverWithNifPt(nif: string, env: Env) {
  if (!env.NIFPT_API_KEY) throw new Error("API key não configurada no Worker");
  const found = await findByNifPt(nif, env.NIFPT_API_KEY);
  if (!found) return null;
  const r = found.record;
  const address = r.address || r.place?.address || null;
  const location = address || r.place?.city || r.city || r.geo?.county || null;
  const publicName = isUsablePublicName(r.alias) ? r.alias : null;
  return { nif, legalName: r.title || null, publicName, location, address, website: r.contacts?.website || null, activity: r.activity || null, cae: r.cae || null, source: "nif.pt" };
}
async function discoverWithVies(nif: string) {
  const found = await findByVies(nif);
  if (!found) return null;
  const location = found.address || null;
  return { nif, legalName: found.legalName || null, publicName: null, location, address: location, website: null, activity: null, cae: null, source: "vies", requestDate: found.requestDate || null };
}
async function discoverWithEInforma(nif: string) {
  const found = await findByEInforma(nif);
  if (!found) return null;
  const publicNames = found.publicNames.filter(isUsablePublicName);
  const publicName = publicNames[0] || null;
  const location = found.address || null;
  return { nif, legalName: found.legalName, publicName, publicNames: publicNames.map(name => ({ name, type: "nome comercial", confidence: 0.78, sources: [{ name: "eInforma", source_type: "directory", url: found.sourceUrl }] })), location, address: found.address, website: found.website, activity: found.activity, cae: null, source: "eInforma", sourceUrl: found.sourceUrl };
}
async function discoverWithPublicacoes(nif: string) {
  const found = await findByPublicacoes(nif);
  if (!found) return null;
  const candidates = found.publicNames.filter(isUsablePublicName);
  const publicName = candidates[0] || null;
  const location = found.address || null;
  return { nif, legalName: found.legalName, publicName, publicNames: candidates.map(name => ({ name, type: "nome público", confidence: 0.80, sources: [{ name: "Publicações do Ministério da Justiça", source_type: "government", url: found.sourceUrl }] })), location, address: found.address, website: null, activity: null, cae: null, source: "publicacoes.mj.pt", sourceUrl: found.sourceUrl, candidates };
}
function enrichWithPublicNames(base: any, discovered: any) {
  const names = discovered.publicNames || (discovered.publicName ? [{ name: discovered.publicName, type: "nome comercial", confidence: 0.78, sources: [] }] : []);
  if (!names.length) return base;
  return { ...base, publicNames: names, publicName: names[0].name };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders() });
    if (url.pathname === "/health") return json({ ok: true, environment: env.ENVIRONMENT || "production" });
    if (url.pathname === "/api/discover" && request.method === "GET") {
      const nif = (url.searchParams.get("nif") || "").replace(/\D/g, "");
      if (nif.length !== 9) return json({ error: "NIF inválido." }, { status: 400 });

      const forceRefresh = url.searchParams.get("refresh") === "1";
      const existing = await env.DB.prepare("SELECT * FROM companies WHERE nif = ? LIMIT 1").bind(nif).first<Record<string, unknown>>();
      const cachedPublicName = existing?.public_name;

      // A record with a valid public name can be served from cache. Records without
      // a public name are deliberately re-checked: they are exactly the records for
      // which the commercial-name discovery pipeline has not finished its job yet.
      if (existing && !forceRefresh && isUsablePublicName(cachedPublicName)) {
        return json({ found: true, cached: true, company: companyPayload(existing) });
      }

      // Remove obviously corrupt legacy values so they cannot survive forever in D1.
      if (existing && cachedPublicName && !isUsablePublicName(cachedPublicName)) {
        await env.DB.prepare("UPDATE companies SET public_name = NULL WHERE nif = ?").bind(nif).run();
        existing.public_name = null;
      }

      const sourcesChecked: string[] = [];
      const providerErrors: Record<string, string> = {};
      const providerResults: Record<string, string> = {};
      let base: any = existing ? {
        nif,
        legalName: existing.legal_name || null,
        publicName: null,
        location: existing.location || null,
        address: existing.address || existing.location || null,
        website: existing.website || null,
        activity: null,
        cae: null,
        source: "cache"
      } : null;

      sourcesChecked.push("nif.pt");
      try {
        const discovered = await discoverWithNifPt(nif, env);
        providerResults["nif.pt"] = discovered ? "found" : "not_found";
        if (discovered) {
          base = { ...(base || {}), ...discovered };
          if (discovered.publicName) {
            await saveCompany(env, nif, base.legalName || "", discovered.publicName, base.location || base.address || null, 0.85);
            return json({ found: true, cached: false, company: base, sources_checked: sourcesChecked, provider_results: providerResults });
          }
        }
      } catch (error) {
        providerResults["nif.pt"] = "error";
        providerErrors["nif.pt"] = String(error).replace(/[\r\n]/g, " ").slice(0, 200);
        console.error(JSON.stringify({ event: "discovery_error", provider: "nif.pt", nif, error: providerErrors["nif.pt"] }));
      }

      sourcesChecked.push("vies");
      try {
        const discovered = await discoverWithVies(nif);
        providerResults["vies"] = discovered ? "found" : "not_found";
        if (discovered) base = { ...(base || {}), ...discovered, publicName: base?.publicName || null };
      } catch (error) {
        providerResults["vies"] = "error";
        providerErrors["vies"] = String(error).replace(/[\r\n]/g, " ").slice(0, 200);
      }

      sourcesChecked.push("eInforma");
      try {
        const discovered = await discoverWithEInforma(nif);
        providerResults["eInforma"] = discovered ? "found" : "not_found";
        if (discovered?.publicNames?.length) base = enrichWithPublicNames({ ...(base || {}), ...discovered }, discovered);
        else if (discovered) base = { ...(base || {}), ...discovered };
      } catch (error) {
        providerResults["eInforma"] = "error";
        providerErrors["eInforma"] = String(error).replace(/[\r\n]/g, " ").slice(0, 200);
      }

      sourcesChecked.push("publicacoes.mj.pt");
      try {
        const discovered = await discoverWithPublicacoes(nif);
        providerResults["publicacoes.mj.pt"] = discovered ? "found" : "not_found";
        if (discovered?.publicNames?.length) base = enrichWithPublicNames({ ...(base || {}), ...discovered }, discovered);
        else if (discovered) base = { ...(base || {}), ...discovered };
      } catch (error) {
        providerResults["publicacoes.mj.pt"] = "error";
        providerErrors["publicacoes.mj.pt"] = String(error).replace(/[\r\n]/g, " ").slice(0, 200);
      }

      if (base) {
        const names = (base.publicNames || (isUsablePublicName(base.publicName) ? [{ name: base.publicName, type: "nome comercial", confidence: 0.85, sources: [] }] : []))
          .filter((item: any) => isUsablePublicName(item?.name));
        await saveCompany(env, nif, base.legalName || "", names[0]?.name || null, base.location || base.address || null, names.length ? Number(names[0].confidence) || 0.78 : 0.65);
        return json({ found: true, cached: false, company: { ...base, publicNames: names, publicName: names[0]?.name || null }, sources_checked: sourcesChecked, provider_results: providerResults, ...(Object.keys(providerErrors).length ? { provider_errors: providerErrors } : {}) });
      }

      return json({ found: false, sources_checked: sourcesChecked, provider_results: providerResults, ...(Object.keys(providerErrors).length ? { provider_errors: providerErrors } : {}) });
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
      const rows = digits.length === 9 ? await env.DB.prepare("SELECT * FROM companies WHERE nif = ? LIMIT 1").bind(digits).all() : await env.DB.prepare("SELECT * FROM companies WHERE legal_name LIKE ? OR public_name LIKE ? OR location LIKE ? LIMIT 20").bind(`%${q}%`, `%${q}%`, `%${q}%`).all();
      return json({ results: rows.results.map(companyPayload) });
    }
    if (url.pathname === "/api/suggestions" && request.method === "POST") {
      const body = await request.json<{ nif?: string; name?: string; source_url?: string; note?: string }>();
      const nif = (body.nif || "").replace(/\D/g, ""); const name = (body.name || "").trim();
      if (nif.length !== 9 || name.length < 2) return json({ error: "NIF e nome são obrigatórios." }, { status: 400 });
      await env.DB.prepare("INSERT INTO suggestions (nif, name, source_url, note, status, created_at) VALUES (?, ?, ?, ?, 'pending', datetime('now'))").bind(nif, name, body.source_url || null, body.note || null).run();
      return json({ ok: true, status: "pending" }, { status: 201 });
    }
    return env.ASSETS.fetch(request);
  },
};
