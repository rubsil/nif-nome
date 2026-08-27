export interface EmpresiteResult {
  source: "empresite";
  legalName: string | null;
  publicNames: string[];
  address: string | null;
  sourceUrl: string;
}

function decodeHtml(value: string): string {
  return value.replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)));
}
function clean(value: string): string { return decodeHtml(value.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim(); }
function keyOf(value: string): string { return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase(); }
function cleanValue(value: string | null): string | null { if (!value) return null; const v = value.replace(/\s+/g, " ").replace(/^[\-–—:|]+|[\-–—:|]+$/g, "").trim(); return v || null; }
function extractLabeled(text: string, label: string): string | null {
  const re = new RegExp(`${label}\\s*:\\s*([^|<>]{2,180}?)(?=\\s+(?:NIF|NIPC|Morada|Código Postal|Atividade|Forma jurídica|Razão Social|Designação comercial)\\s*:|$)`, "i");
  return cleanValue(text.match(re)?.[1] || null);
}
function extractFromPage(text: string, nif: string, legalName: string | null, sourceUrl: string): EmpresiteResult | null {
  if (!text.includes(nif)) return null;
  const publicName = extractLabeled(text, "Designação comercial");
  const address = extractLabeled(text, "Morada");
  const pageLegal = extractLabeled(text, "Razão Social");
  const candidates = publicName && (!legalName || keyOf(publicName) !== keyOf(legalName)) ? [publicName] : [];
  if (!pageLegal && !address && !candidates.length) return null;
  return { source: "empresite", legalName: pageLegal || legalName || null, publicNames: candidates, address, sourceUrl };
}
async function fetchPage(url: string): Promise<string | null> {
  const response = await fetch(url, { headers: { "user-agent": "Mozilla/5.0 (compatible; nif-nome/1.0; public business lookup)", accept: "text/html,application/xhtml+xml" } });
  if (!response.ok) return null;
  const bytes = await response.arrayBuffer();
  const contentType = response.headers.get("content-type") || "";
  const charset = /charset=([^;]+)/i.exec(contentType)?.[1]?.trim().toLowerCase();
  const decoder = new TextDecoder(charset === "utf-8" ? "utf-8" : "windows-1252");
  return clean(decoder.decode(bytes));
}
function extractSearchUrls(html: string): string[] {
  const urls = new Set<string>();
  for (const match of html.matchAll(/https?:\/\/[^\s"'<>]+/gi)) {
    let url = match[0].replace(/&amp;/g, "&");
    try { const parsed = new URL(url); const uddg = parsed.searchParams.get("uddg"); if (uddg) url = uddg; } catch {}
    if (/empresite\.jornaldenegocios\.pt/i.test(url)) urls.add(url);
  }
  return [...urls];
}
export async function findByNif(nif: string, legalName: string | null): Promise<EmpresiteResult | null> {
  const terms = [
    `"${nif}" "Designação comercial" site:empresite.jornaldenegocios.pt`,
    legalName ? `"${legalName}" "Designação comercial" site:empresite.jornaldenegocios.pt` : `"${nif}" site:empresite.jornaldenegocios.pt`,
    `"${nif}" site:empresite.jornaldenegocios.pt`
  ];
  const visited = new Set<string>();
  for (const term of terms) {
    const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(term)}`;
    const searchResponse = await fetch(searchUrl, { headers: { "user-agent": "Mozilla/5.0 (compatible; nif-nome/1.0; public business lookup)", accept: "text/html" } });
    if (!searchResponse.ok) continue;
    const urls = extractSearchUrls(await searchResponse.text()).slice(0, 8);
    for (const url of urls) {
      if (visited.has(url)) continue;
      visited.add(url);
      try {
        const page = await fetchPage(url);
        if (!page) continue;
        const result = extractFromPage(page, nif, legalName, url);
        if (result?.publicNames.length) return result;
      } catch {}
    }
  }
  return null;
}
