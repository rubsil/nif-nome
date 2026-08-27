import { findByNif as findByNifPt } from "./providers/nifpt";
import { findByNif as findByVies } from "./providers/vies";
import { findByNif as findByPublicacoes } from "./providers/publicacoes";
import { findByNif as findByEInforma } from "./providers/einforma";
import { findByNif as findByRigorBiz } from "./providers/rigorbiz";
import { findPublicNames } from "./providers/publicweb";

export interface Env { DB: D1Database; ENVIRONMENT: string; ASSETS: Fetcher; NIFPT_API_KEY?: string; }
function corsHeaders() { return { "access-control-allow-origin": "*", "access-control-allow-methods": "GET,POST,OPTIONS", "access-control-allow-headers": "content-type" }; }
function json(data: unknown, init: ResponseInit = {}) { return new Response(JSON.stringify(data), { ...init, headers: { "content-type": "application/json; charset=utf-8", ...(init.headers || {}), ...corsHeaders() } }); }

function normaliseText(value: string): string { return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim().toLocaleLowerCase(); }
function isUsablePublicName(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const v = value.trim();
  if (v.length < 3 || v.length > 100) return false;
  const n = normaliseText(v);
  // These are generic words/navigation fragments that appeared in search-result
  // snippets, not reliable establishment names.
  if (/^(english|portugues|portugal|home|menu|contactos?|contact|about|inicio|pesquisa|resultado|empresa|restaurante|pizzaria|publicacoes|publicacoes legais|relatorio gratis|relatorio)$/.test(n)) return false;
  if (/^s e public/.test(n)) return false;
  if (/licenciada|lider|mercado|informacao para negocios|informa d&b|relatorio gratis/.test(n)) return false;
  if (/^(anterior|actual|atual|empresa|sociedade|atividade|morada|endereco|telefone|email|website)$/.test(n)) return false;
  if (v.split(/\s+/).length > 12) return false;
  return true;
}
function cleanPublicName(value: unknown): string | null { return typeof value === "string" && isUsablePublicName(value) ? value.replace(/\s+/g, " ").trim() : null; }
function cleanLegalName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  let v = value.replace(/\s+/g, " ").trim();
  if (!v) return null;
  // Some public directory pages repeat the legal denomination twice in the
  // extracted text. Keep a single copy.
  if (v.length % 2 === 0) {
    const half = v.length / 2;
    const left = v.slice(0, half).trim();
    const right = v.slice(half).trim();
    if (left && normaliseText(left) === normaliseText(right)) v = left;
  }
  return v;
}
function companyPayload(row: Record<string, unknown>) { const confidence = Number(row.confidence) || 0; const publicName = cleanPublicName(row.public_name); return { nif: row.nif, legalName: cleanLegalName(row.legal_name), location: row.location, address: row.address || row.location || null, website: row.website || null, publicNames: publicName ? [{ name: publicName, type: "nome comercial", confidence, sources: [] }] : [] }; }
async function saveCompany(env: Env, nif: string, legalName: string, publicName: string | null, location: string | null, confidence: number) { await env.DB.prepare(`INSERT INTO companies (nif, legal_name, public_name, location, confidence) VALUES (?, ?, ?, ?, ?) ON CONFLICT(nif) DO UPDATE SET legal_name = CASE WHEN excluded.legal_name != '' THEN excluded.legal_name ELSE companies.legal_name END, public_name = CASE WHEN excluded.public_name IS NOT NULL THEN excluded.public_name ELSE companies.public_name END, location = COALESCE(excluded.location, companies.location), confidence = MAX(companies.confidence, excluded.confidence)`).bind(nif, legalName, publicName, location, confidence).run(); }

async function discoverWithNifPt(nif: string, env: Env) { if (!env.NIFPT_API_KEY) throw new Error("API key não configurada no Worker"); const found = await findByNifPt(nif, env.NIFPT_API_KEY); if (!found) return null; const r = found.record; const address = r.address || r.place?.address || null; const location = address || r.place?.city || r.city || r.geo?.county || null; const publicName = cleanPublicName(r.alias || ""); return { nif, legalName: cleanLegalName(r.title), publicName, location, address, website: r.contacts?.website || null, activity: r.activity || null, cae: r.cae || null, source: "nif.pt" }; }
async function discoverWithVies(nif: string) { const found = await findByVies(nif); if (!found) return null; const location = found.address || null; return { nif, legalName: cleanLegalName(found.legalName), publicName: null, location, address: location, website: null, activity: null, cae: null, source: "vies", requestDate: found.requestDate || null }; }
async function discoverWithEInforma(nif: string) { const found = await findByEInforma(nif); if (!found) return null; const publicNames = found.publicNames.map(cleanPublicName).filter((name): name is string => !!name); return { nif, legalName: cleanLegalName(found.legalName), publicName: publicNames[0] || null, publicNames: publicNames.map(name => ({ name, type: "nome comercial", confidence: 0.78, sources: [{ name: "eInforma", source_type: "directory", url: found.sourceUrl }] })), location: found.address || null, address: found.address, website: found.website, activity: found.activity, cae: null, source: "eInforma", sourceUrl: found.sourceUrl }; }
async function discoverWithPublicacoes(nif: string) { const found = await findByPublicacoes(nif); if (!found) return null; const candidates = found.publicNames.map(cleanPublicName).filter((name): name is string => !!name); return { nif, legalName: cleanLegalName(found.legalName), publicName: candidates[0] || null, publicNames: candidates.map(name => ({ name, type: "nome público", confidence: 0.80, sources: [{ name: "Publicações do Ministério da Justiça", source_type: "government", url: found.sourceUrl }] })), location: found.address || null, address: found.address, website: null, activity: null, cae: null, source: "publicacoes.mj.pt", sourceUrl: found.sourceUrl }; }
async function discoverWithRigorBiz(nif: string) { const found = await findByRigorBiz(nif); if (!found) return null; return { nif, legalName: cleanLegalName(found.legalName), publicName: null, publicNames: [], location: found.address || null, address: found.address, website: null, activity: null, cae: null, source: "rigorbiz", sourceUrl: found.sourceUrl }; }
function addNames(base: any, discovered: any) { const names = (discovered?.publicNames || (cleanPublicName(discovered?.publicName) ? [{ name: cleanPublicName(discovered.publicName), type: "nome comercial", confidence: 0.78, sources: [] }] : [])).filter((item: any) => cleanPublicName(item?.name)); const legal = cleanLegalName(base?.legalName); const filtered = names.filter((item: any) => !legal || normaliseText(item.name) !== normaliseText(legal)); return filtered.length ? { ...base, publicNames: filtered, publicName: filtered[0].name } : base; }

export default { async fetch(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders() });
  if (url.pathname === "/health") return json({ ok: true, environment: env.ENVIRONMENT || "production" });
  if (url.pathname === "/api/discover" && request.method === "GET") {
    const nif = (url.searchParams.get("nif") || "").replace(/\D/g, ""); if (nif.length !== 9) return json({ error: "NIF inválido." }, { status: 400 });
    const forceRefresh = url.searchParams.get("refresh") === "1"; const existing = await env.DB.prepare("SELECT * FROM companies WHERE nif = ? LIMIT 1").bind(nif).first<Record<string, unknown>>(); const cachedPublicName = cleanPublicName(existing?.public_name);
    // Old versions could cache generic search-result fragments such as "English".
    // Remove those before deciding whether the record is safe to return from cache.
    if (existing?.public_name && !cachedPublicName) { await env.DB.prepare("UPDATE companies SET public_name = NULL WHERE nif = ?").bind(nif).run(); existing.public_name = null; }
    if (existing && !forceRefresh && cachedPublicName) return json({ found: true, cached: true, company: companyPayload(existing) });
    const sourcesChecked: string[] = [], providerErrors: Record<string,string> = {}, providerResults: Record<string,string> = {};
    let base: any = existing ? { nif, legalName: cleanLegalName(existing.legal_name), publicName: null, publicNames: [], location: existing.location || null, address: existing.address || existing.location || null, website: existing.website || null, activity: null, cae: null, source: "cache" } : null;
    const run = async (name: string, fn: () => Promise<any>) => { sourcesChecked.push(name); try { const result = await fn(); providerResults[name] = result ? "found" : "not_found"; if (result) base = { ...(base || {}), ...result }; return result; } catch (error) { providerResults[name] = "error"; providerErrors[name] = String(error).replace(/[\r\n]/g, " ").slice(0, 200); return null; } };
    const finish = async () => { if (!base) return json({ found: false, sources_checked: sourcesChecked, provider_results: providerResults, ...(Object.keys(providerErrors).length ? { provider_errors: providerErrors } : {}) }); const legalName = cleanLegalName(base.legalName); const rawNames = (base.publicNames || (cleanPublicName(base.publicName) ? [{ name: cleanPublicName(base.publicName), type: "nome comercial", confidence: 0.78, sources: [] }] : [])); const names = rawNames.filter((item: any) => { const name = cleanPublicName(item?.name); return !!name && (!legalName || normaliseText(name) !== normaliseText(legalName)); }).map((item: any) => ({ ...item, name: cleanPublicName(item.name) })); const publicName = names[0]?.name || null; await saveCompany(env, nif, legalName || "", publicName, base.location || base.address || null, names.length ? Number(names[0].confidence) || 0.78 : 0.65); return json({ found: true, cached: false, company: { ...base, legalName, publicNames: names, publicName }, sources_checked: sourcesChecked, provider_results: providerResults, ...(Object.keys(providerErrors).length ? { provider_errors: providerErrors } : {}) }); };

    const nifpt = await run("nif.pt", () => discoverWithNifPt(nif, env));
    if (nifpt?.publicName) return await finish();
    await run("vies", () => discoverWithVies(nif));
    const einforma = await run("eInforma", () => discoverWithEInforma(nif)); if (einforma?.publicNames?.length) base = addNames(base, einforma);
    if (base?.publicName) return await finish();
    const mj = await run("publicacoes.mj.pt", () => discoverWithPublicacoes(nif)); if (mj?.publicNames?.length) base = addNames(base, mj);
    if (base?.publicName) return await finish();
    await run("rigorbiz", () => discoverWithRigorBiz(nif));
    sourcesChecked.push("public-web");
    try { const web = await findPublicNames(nif, base?.legalName || ""); providerResults["public-web"] = web ? "found" : "not_found"; if (web?.publicNames?.length) base = addNames(base, { publicNames: web.publicNames.map(x => ({ name: x.name, type: "nome comercial", confidence: 0.82, sources: [{ name: "Pesquisa web pública", source_type: "public_web", url: x.sourceUrl }] })) }); }
    catch (error) { providerResults["public-web"] = "error"; providerErrors["public-web"] = String(error).replace(/[\r\n]/g, " ").slice(0, 200); }
    return await finish();
  }
  if (url.pathname.startsWith("/api/company/") && request.method === "GET") { const nif = url.pathname.slice("/api/company/".length).replace(/\D/g, ""); if (nif.length !== 9) return json({ error: "NIF inválido." }, { status: 400 }); const row = await env.DB.prepare("SELECT * FROM companies WHERE nif = ? LIMIT 1").bind(nif).first<Record<string, unknown>>(); if (!row) return json({ error: "Empresa não encontrada." }, { status: 404 }); return json(companyPayload(row)); }
  if (url.pathname === "/api/search" && request.method === "GET") { const q = (url.searchParams.get("q") || "").trim(); if (!q) return json({ results: [] }); const digits = q.replace(/\D/g, ""); const rows = digits.length === 9 ? await env.DB.prepare("SELECT * FROM companies WHERE nif = ? LIMIT 1").bind(digits).all() : await env.DB.prepare("SELECT * FROM companies WHERE legal_name LIKE ? OR public_name LIKE ? OR location LIKE ? LIMIT 20").bind(`%${q}%`, `%${q}%`, `%${q}%`).all(); return json({ results: rows.results.map(companyPayload) }); }
  if (url.pathname === "/api/suggestions" && request.method === "POST") { const body = await request.json<{ nif?: string; name?: string; source_url?: string; note?: string }>(); const nif = (body.nif || "").replace(/\D/g, ""), name = (body.name || "").trim(); if (nif.length !== 9 || name.length < 2) return json({ error: "NIF e nome são obrigatórios." }, { status: 400 }); await env.DB.prepare("INSERT INTO suggestions (nif, name, source_url, note, status, created_at) VALUES (?, ?, ?, ?, 'pending', datetime('now'))").bind(nif, name, body.source_url || null, body.note || null).run(); return json({ ok: true, status: "pending" }, { status: 201 }); }
  return env.ASSETS.fetch(request);
} };
