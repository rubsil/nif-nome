export interface EmpresiteResult {
  source: "empresite";
  legalName: string | null;
  publicNames: string[];
  address: string | null;
  sourceUrl: string;
}

function decodeHtml(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)));
}

function clean(value: string): string {
  return decodeHtml(value.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

function keyOf(value: string): string {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim().toLocaleLowerCase();
}

function slug(value: string): string {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/&/g, " e ").replace(/[^a-zA-Z0-9]+/g, " ").trim().toUpperCase().replace(/\s+/g, "-");
}

function cleanValue(value: string | null): string | null {
  if (!value) return null;
  const v = decodeHtml(value).replace(/\s+/g, " ").replace(/^[\-–—:|]+|[\-–—:|]+$/g, "").trim();
  return v || null;
}

function validName(value: string | null, legalName: string | null): string | null {
  const v = cleanValue(value);
  if (!v || v.length < 3 || v.length > 120) return null;
  if (legalName && keyOf(v) === keyOf(legalName)) return null;
  if (/^(nif|nipc|morada|atividade|código postal|codigo postal|designação comercial|denominação|razão social)$/i.test(v)) return null;
  if (/^s e publicações legais\b|^s e publicacoes legais\b/i.test(v)) return null;
  if (/^(relatório|relatorio|empresa|pesquisa|search|login|register|privacy|cookies)$/i.test(v)) return null;
  return v;
}

function extractCommercialName(text: string, legalName: string): string | null {
  const normalized = keyOf(text);
  const needle = keyOf(legalName);
  const index = normalized.indexOf(needle);
  if (index < 0) return null;
  const card = normalized.slice(index, index + 1800);
  const end = card.search(/\s+matches in the search\s+for\s*:/i);
  const bounded = end >= 0 ? card.slice(0, end) : card;
  const match = bounded.match(/designacao\s+comercial\s*:\s*(.+?)(?=\s+ver\s+empresa|\s+ver\s+no\s+mapa|$)/i);
  return validName(match?.[1] || null, legalName);
}

function extractSearchUrls(html: string): string[] {
  const urls = new Set<string>();
  const source = decodeHtml(html);
  for (const match of source.matchAll(/href=["']([^"']+)["']/gi)) {
    try {
      const u = new URL(match[1], "https://html.duckduckgo.com/html/");
      const redirected = u.searchParams.get("uddg");
      const candidate = redirected ? decodeURIComponent(redirected) : u.toString();
      if (/empresite\.jornaldenegocios\.pt/i.test(candidate)) urls.add(candidate);
    } catch {}
  }
  return [...urls];
}

function directUrls(legalName: string | null): string[] {
  if (!legalName) return [];
  const base = legalName.replace(/,?\s+(unipessoal|sociedade|lda|sa|s\.a\.).*$/i, "").trim();
  const s = slug(base);
  const urls = [`https://empresite.jornaldenegocios.pt/${s}.html`];
  const full = slug(legalName);
  if (full !== s) urls.push(`https://empresite.jornaldenegocios.pt/${full}.html`);
  return urls;
}

function categoryUrls(legalName: string | null): string[] {
  if (!legalName) return [];
  const n = keyOf(legalName);
  const out: string[] = [];
  if (/pizzaria|pizza/.test(n)) out.push("https://empresite.jornaldenegocios.pt/Actividade/PIZZARIA/");
  if (/restaurante|restauracao|restaura/.test(n)) out.push("https://empresite.jornaldenegocios.pt/Actividade/RESTAURANTE/");
  if (/farmacia/.test(n)) out.push("https://empresite.jornaldenegocios.pt/Actividade/FARMACIA/");
  if (/cafe|cafes/.test(n)) out.push("https://empresite.jornaldenegocios.pt/Actividade/CAFE/");
  return out;
}

async function fetchPage(url: string): Promise<{ text: string } | null> {
  const response = await fetch(url, { headers: { "user-agent": "Mozilla/5.0 (compatible; nif-nome/2.5; public business lookup)", accept: "text/html,application/xhtml+xml" } });
  if (!response.ok) return null;
  const bytes = await response.arrayBuffer();
  const type = response.headers.get("content-type") || "";
  const charset = /charset=([^;]+)/i.exec(type)?.[1]?.trim().toLowerCase();
  const html = new TextDecoder(charset === "utf-8" ? "utf-8" : "windows-1252").decode(bytes);
  return { text: clean(html) };
}

async function fetchText(url: string): Promise<string | null> {
  try { return (await fetchPage(url))?.text || null; } catch { return null; }
}

async function findOnUrl(url: string, legalName: string): Promise<EmpresiteResult | null> {
  const text = await fetchText(url);
  if (!text || !keyOf(text).includes(keyOf(legalName))) return null;
  const name = extractCommercialName(text, legalName);
  return name ? { source: "empresite", legalName, publicNames: [name], address: null, sourceUrl: url } : null;
}

async function findViaJina(url: string, legalName: string): Promise<EmpresiteResult | null> {
  try {
    const response = await fetch(`https://r.jina.ai/${url}`, { headers: { "user-agent": "nif-nome/2.5", accept: "text/plain" } });
    if (!response.ok) return null;
    const text = await response.text();
    if (!keyOf(text).includes(keyOf(legalName))) return null;
    const name = extractCommercialName(text, legalName);
    return name ? { source: "empresite", legalName, publicNames: [name], address: null, sourceUrl: url } : null;
  } catch { return null; }
}

function searchTerms(nif: string, legalName: string | null): string[] {
  const out = new Set<string>();
  out.add(`"${nif}" "Designação comercial" Empresite`);
  if (legalName) {
    out.add(`"${legalName}" "Designação comercial" Empresite`);
    out.add(`"${legalName}" Empresite`);
  }
  return [...out];
}

export async function findByNif(nif: string, legalName: string | null): Promise<EmpresiteResult | null> {
  if (!legalName) return null;
  const visited = new Set<string>();

  // 1. Exact company URL. Empresite uses a stable slug based on the company
  // name; this avoids the old page-wide category guessing entirely.
  for (const url of directUrls(legalName)) {
    if (visited.has(url)) continue;
    visited.add(url);
    const found = await findOnUrl(url, legalName);
    if (found) return found;
    const viaJina = await findViaJina(url, legalName);
    if (viaJina) return viaJina;
  }

  // 2. Category pages where the legal name itself strongly indicates the
  // activity. The extraction is bounded to the exact company card.
  for (const url of categoryUrls(legalName)) {
    if (visited.has(url)) continue;
    visited.add(url);
    const found = await findOnUrl(url, legalName);
    if (found) return found;
    const viaJina = await findViaJina(url, legalName);
    if (viaJina) return viaJina;
  }

  // 3. Search engine fallback. Only follow Empresite URLs and only accept a
  // commercial name found in the same exact legal-name block.
  for (const term of searchTerms(nif, legalName)) {
    try {
      const response = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(term)}`, { headers: { "user-agent": "Mozilla/5.0 (compatible; nif-nome/2.5)", accept: "text/html" } });
      if (!response.ok) continue;
      const urls = extractSearchUrls(await response.text()).slice(0, 15);
      for (const url of urls) {
        if (visited.has(url)) continue;
        visited.add(url);
        const found = await findOnUrl(url, legalName);
        if (found) return found;
        const viaJina = await findViaJina(url, legalName);
        if (viaJina) return viaJina;
      }
    } catch {}
  }
  return null;
}
