import { findByNif as findByNifPt } from "./providers/nifpt";
import { findByNif as findByVies } from "./providers/vies";
import { findByNif as findByPublicacoes } from "./providers/publicacoes";
import { findByNif as findByEInforma } from "./providers/einforma";
import { findByNif as findByRigorBiz } from "./providers/rigorbiz";
import { findByNif as findByEmpresite } from "./providers/empresite";
import { findNearby } from "./providers/nearby";

export interface Env { DB: D1Database; ENVIRONMENT: string; ASSETS: Fetcher; NIFPT_API_KEY?: string; }

type Evidence = { name: string; type?: string; confidence: number; sources: { name: string; source_type?: string; url?: string }[] };

type Result = { nif: string; legalName: string | null; publicName: string | null; publicNames: Evidence[]; location: string | null; address: string | null; website: string | null; activity: unknown; cae: unknown; source: string; sourceUrl?: string; requestDate?: string };

function corsHeaders() { return { "access-control-allow-origin": "*", "access-control-allow-methods": "GET,POST,OPTIONS", "access-control-allow-headers": "content-type" }; }
function json(data: unknown, init: ResponseInit = {}) { return new Response(JSON.stringify(data), { ...init, headers: { "content-type": "application/json; charset=utf-8", ...(init.headers || {}), ...corsHeaders() } }); }
function normaliseText(v: string) { return v.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim().toLocaleLowerCase(); }
function cleanLegalName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  let v = value.replace(/\s+/g, " ").trim();
  if (!v) return null;
  const parts = v.split(/\s{2,}/);
  if (parts.length === 2 && normaliseText(parts[0]) === normaliseText(parts[1])) v = parts[0];
  const half = Math.floor(v.length / 2);
  if (v.length > 20 && v.length % 2 === 0 && normaliseText(v.slice(0, half)) === normaliseText(v.slice(half))) v = v.slice(0, half).trim();
  return v;
}
function cleanPublicName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const v = value.replace(/\s+/g, " ").trim();
  if (v.length < 3 || v.length > 120) return null;
  const n = normaliseText(v);
  // These are navigation/content fragments, not commercial names.
  if (/^s e public/.test(n) || /licenciada|lider no mercado|informacao para negocios|relatorio gratis|relatorio gratuito/.test(n)) return null;
  if (/^(english|spanish|home|search|login|register|privacy|cookies|nif|nipc|morada|atividade|designacao comercial|denominacao|razao social)$/.test(n)) return null;
  if (v.split(/\s+/).length > 15) return null;
  return v;
}
function sourceEvidence(name: string, source: string, url: string | undefined, confidence: number, type = "nome comercial"): Evidence {
  return { name, type, confidence, sources: [{ name: source, source_type: type === "nome público" ? "government" : "directory", ...(url ? { url } : {}) }] };
}
function mergeEvidence(a: Evidence[], b: Evidence[]): Evidence[] {
  const map = new Map<string, Evidence>();
  for (const item of [...a, ...b]) {
    const name = cleanPublicName(item?.name); if (!name) continue;
    const key = normaliseText(name); const old = map.get(key);
    if (!old) { map.set(key, { ...item, name, sources: [...(item.sources || [])] }); continue; }
    const sources = [...(old.sources || []), ...(item.sources || [])];
    const unique = sources.filter((s, i, arr) => i === arr.findIndex(x => x?.name === s?.name && x?.url === s?.url));
    const boost = unique.length > (old.sources || []).length ? 0.04 : 0;
    map.set(key, { ...old, ...item, name, confidence: Math.min(0.99, Math.max(old.confidence || 0, item.confidence || 0) + boost), sources: unique });
  }
  return [...map.values()].sort((x, y) => y.confidence - x.confidence);
}
function mergeResult(base: Result | null, incoming: Partial<Result> | null): Result | null {
  if (!incoming) return base;
  if (!base) return incoming as Result;
  return { ...base, ...incoming, legalName: cleanLegalName(incoming.legalName || base.legalName), publicNames: mergeEvidence(base.publicNames || [], incoming.publicNames || []), publicName: null };
}
async function saveCompany(env: Env, r: Result, evidence: Evidence[]) {
  const best = evidence[0]?.name || null;
  await env.DB.prepare(`INSERT INTO companies (nif, legal_name, public_name, location, confidence) VALUES (?, ?, ?, ?, ?) ON CONFLICT(nif) DO UPDATE SET legal_name=CASE WHEN excluded.legal_name!='' THEN excluded.legal_name ELSE companies.legal_name END, public_name=excluded.public_name, location=COALESCE(excluded.location,companies.location), confidence=excluded.confidence`).bind(r.nif, r.legalName || "", best, r.address || r.location || null, evidence.length ? evidence[0].confidence : 0.65).run();
  for (const e of evidence) {
    const row = await env.DB.prepare(`INSERT INTO public_names (nif,name,type,confidence) VALUES (?,?,?,?) ON CONFLICT(nif,name) DO UPDATE SET confidence=MAX(public_names.confidence,excluded.confidence), type=excluded.type RETURNING id`).bind(r.nif, e.name, e.type || "nome comercial", e.confidence).first<{id:number}>();
    if (!row) continue;
    for (const s of e.sources || []) await env.DB.prepare(`INSERT OR IGNORE INTO name_evidence (public_name_id,source_name,source_type,source_url,confidence) VALUES (?,?,?,?,?)`).bind(row.id,s.name,s.source_type || null,s.url || null,e.confidence).run();
  }
}
async function cachedEvidence(env: Env, nif: string): Promise<Evidence[]> {
  const rows = await env.DB.prepare(`SELECT pn.name,pn.type,pn.confidence,ne.source_name,ne.source_type,ne.source_url FROM public_names pn LEFT JOIN name_evidence ne ON ne.public_name_id=pn.id WHERE pn.nif=? ORDER BY pn.confidence DESC`).bind(nif).all<any>();
  const map = new Map<string,Evidence>();
  for (const r of rows.results || []) { const key=normaliseText(r.name); let e=map.get(key); if(!e){e={name:r.name,type:r.type,confidence:Number(r.confidence)||0,sources:[]};map.set(key,e);} if(r.source_name && !e.sources.some(s=>s.name===r.source_name&&s.url===r.source_url)) e.sources.push({name:r.source_name,source_type:r.source_type,url:r.source_url}); }
  return [...map.values()].sort((a,b)=>b.confidence-a.confidence);
}
async function discoverNifPt(nif:string,env:Env):Promise<Partial<Result>|null>{ if(!env.NIFPT_API_KEY) throw new Error("API key não configurada no Worker"); const f=await findByNifPt(nif,env.NIFPT_API_KEY); if(!f)return null; const r=f.record; const address=r.address||r.place?.address||null; return {nif,legalName:cleanLegalName(r.title),publicName:null,publicNames:(()=>{const n=cleanPublicName(r.alias);return n?[sourceEvidence(n,"nif.pt",undefined,0.85)]:[]})(),location:address||r.place?.city||r.city||r.geo?.county||null,address,website:r.contacts?.website||null,activity:r.activity||null,cae:r.cae||null,source:"nif.pt"}; }
async function discoverVies(nif:string):Promise<Partial<Result>|null>{const f=await findByVies(nif);if(!f)return null;return {nif,legalName:cleanLegalName(f.legalName),publicNames:[],location:f.address||null,address:f.address||null,website:null,activity:null,cae:null,source:"vies",requestDate:f.requestDate||null};}
async function discoverEmpresite(nif:string,legalName:string|null):Promise<Partial<Result>|null>{const f=await findByEmpresite(nif,legalName);if(!f)return null;const names=f.publicNames.map(n=>cleanPublicName(n)).filter((n):n is string=>!!n).map(n=>sourceEvidence(n,"Empresite",f.sourceUrl,0.95));return {nif,legalName:cleanLegalName(f.legalName),publicNames:names,location:f.address||null,address:f.address||null,website:null,activity:null,cae:null,source:"Empresite",sourceUrl:f.sourceUrl};}
async function discoverEInforma(nif:string):Promise<Partial<Result>|null>{const f=await findByEInforma(nif);if(!f)return null;const names=f.publicNames.map(n=>cleanPublicName(n)).filter((n):n is string=>!!n).map(n=>sourceEvidence(n,"eInforma",f.sourceUrl,0.82));return {nif,legalName:cleanLegalName(f.legalName),publicNames:names,location:f.address||null,address:f.address||null,website:f.website||null,activity:f.activity||null,cae:null,source:"eInforma",sourceUrl:f.sourceUrl};}
async function discoverPublicacoes(nif:string):Promise<Partial<Result>|null>{const f=await findByPublicacoes(nif);if(!f)return null;const names=f.publicNames.map(n=>cleanPublicName(n)).filter((n):n is string=>!!n).map(n=>sourceEvidence(n,"Publicações do Ministério da Justiça",f.sourceUrl,0.85,"nome público"));return {nif,legalName:cleanLegalName(f.legalName),publicNames:names,location:f.address||null,address:f.address||null,website:null,activity:null,cae:null,source:"publicacoes.mj.pt",sourceUrl:f.sourceUrl};}
async function discoverRigorBiz(nif:string):Promise<Partial<Result>|null>{const f=await findByRigorBiz(nif);if(!f)return null;return {nif,legalName:cleanLegalName(f.legalName),publicNames:[],location:f.address||null,address:f.address||null,website:null,activity:null,cae:null,source:"rigorbiz",sourceUrl:f.sourceUrl};}
function payload(r:Result){const legal=cleanLegalName(r.legalName);const names=mergeEvidence([],r.publicNames||[]).filter(e=>!legal||normaliseText(e.name)!==normaliseText(legal));return {nif:r.nif,legalName:legal,location:r.location,address:r.address||r.location||null,website:r.website||null,activity:r.activity||null,cae:r.cae||null,publicName:names[0]?.name||null,publicNames:names};}

export default { async fetch(request:Request,env:Env):Promise<Response>{
  const url=new URL(request.url);
  if(request.method==="OPTIONS")return new Response(null,{headers:corsHeaders()});
  if(url.pathname==="/health")return json({ok:true,environment:env.ENVIRONMENT||"production"});
  if(url.pathname==="/api/nearby"&&request.method==="GET"){const address=(url.searchParams.get("address")||"").trim();if(address.length<5)return json({error:"Morada inválida."},{status:400});try{return json(await findNearby(address));}catch(e){return json({error:String(e).slice(0,200),source:"OpenStreetMap"},{status:502});}}
  if(url.pathname==="/api/discover"&&request.method==="GET"){
    const nif=(url.searchParams.get("nif")||"").replace(/\D/g,"");if(nif.length!==9)return json({error:"NIF inválido."},{status:400});
    const refresh=url.searchParams.get("refresh")==="1";
    const row=await env.DB.prepare("SELECT * FROM companies WHERE nif=? LIMIT 1").bind(nif).first<any>();
    let evid=await cachedEvidence(env,nif);
    if(row && !refresh && evid.length){return json({found:true,cached:true,company:payload({nif,legalName:row.legal_name,publicName:evid[0]?.name||null,publicNames:evid,location:row.location||null,address:row.address||row.location||null,website:row.website||null,activity:null,cae:null,source:"cache"}),sources_checked:["cache"]});}
    let result:Result|null=row?{nif,legalName:cleanLegalName(row.legal_name),publicName:null,publicNames:evid,location:row.location||null,address:row.address||row.location||null,website:row.website||null,activity:null,cae:null,source:"cache"}:null;
    const checked:string[]=[], providerResults:Record<string,string>={}, errors:Record<string,string>={};
    const run=async(name:string,fn:()=>Promise<Partial<Result>|null>)=>{checked.push(name);try{const x=await fn();providerResults[name]=x?"found":"not_found";result=mergeResult(result,x);return x;}catch(e){providerResults[name]="error";errors[name]=String(e).replace(/[\r\n]/g," ").slice(0,200);return null;}};
    await run("nif.pt",()=>discoverNifPt(nif,env));
    await run("vies",()=>discoverVies(nif));
    await run("Empresite",()=>discoverEmpresite(nif,result?.legalName||null));
    await run("eInforma",()=>discoverEInforma(nif));
    await run("publicacoes.mj.pt",()=>discoverPublicacoes(nif));
    await run("rigorbiz",()=>discoverRigorBiz(nif));
    if(!result)return json({found:false,sources_checked:checked,provider_results:providerResults,...Object.keys(errors).length?{provider_errors:errors}:{}});
    evid=mergeEvidence([],result.publicNames||[]).filter(e=>!result?.legalName||normaliseText(e.name)!==normaliseText(result.legalName!));
    result.publicNames=evid;result.publicName=evid[0]?.name||null;
    await saveCompany(env,result,evid);
    return json({found:true,cached:false,company:payload(result),sources_checked:checked,provider_results:providerResults,...Object.keys(errors).length?{provider_errors:errors}:{}});
  }
  if(url.pathname.startsWith("/api/company/")&&request.method==="GET"){const nif=url.pathname.slice(13).replace(/\D/g,"");if(nif.length!==9)return json({error:"NIF inválido."},{status:400});const row=await env.DB.prepare("SELECT * FROM companies WHERE nif=? LIMIT 1").bind(nif).first<any>();if(!row)return json({error:"Empresa não encontrada."},{status:404});const evid=await cachedEvidence(env,nif);return json(payload({nif,legalName:row.legal_name,publicName:evid[0]?.name||null,publicNames:evid,location:row.location||null,address:row.address||row.location||null,website:row.website||null,activity:null,cae:null,source:"cache"}));}
  if(url.pathname==="/api/search"&&request.method==="GET"){const q=(url.searchParams.get("q")||"").trim();if(!q)return json({results:[]});const d=q.replace(/\D/g,"");const rows=d.length===9?await env.DB.prepare("SELECT * FROM companies WHERE nif=? LIMIT 1").bind(d).all():await env.DB.prepare("SELECT * FROM companies WHERE legal_name LIKE ? OR public_name LIKE ? OR location LIKE ? LIMIT 20").bind(`%${q}%`,`%${q}%`,`%${q}%`).all();const out=[];for(const r of rows.results as any[]){const e=await cachedEvidence(env,r.nif);out.push(payload({nif:r.nif,legalName:r.legal_name,publicName:e[0]?.name||null,publicNames:e,location:r.location||null,address:r.address||r.location||null,website:r.website||null,activity:null,cae:null,source:"cache"}));}return json({results:out});}
  if(url.pathname==="/api/suggestions"&&request.method==="POST"){const body=await request.json<any>();const nif=(body.nif||"").replace(/\D/g,"");const name=(body.name||"").trim();if(nif.length!==9||name.length<2)return json({error:"NIF e nome são obrigatórios."},{status:400});await env.DB.prepare("INSERT INTO suggestions (nif,name,source_url,note,status,created_at) VALUES (?,?,?,?, 'pending',datetime('now'))").bind(nif,name,body.source_url||null,body.note||null).run();return json({ok:true,status:"pending"},{status:201});}
  return env.ASSETS.fetch(request);
} };