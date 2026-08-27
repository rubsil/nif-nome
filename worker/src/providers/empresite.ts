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
function clean(value: string): string {
  return decodeHtml(value.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}
function keyOf(value: string): string { return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim().toLocaleLowerCase(); }
function cleanValue(value: string | null): string | null { if (!value) return null; const v = value.replace(/\s+/g, " ").replace(/^[\-–—:|]+|[\-–—:|]+$/g, "").trim(); return v || null; }
function validName(value: string | null, legalName: string | null): string | null {
  const v = cleanValue(value);
  if (!v || v.length < 3 || v.length > 120) return null;
  if (legalName && keyOf(v) === keyOf(legalName)) return null;
  if (/^(nif|nipc|morada|atividade|código postal|codigo postal|designação comercial|denominação)$/i.test(v)) return null;
  return v;
}
function extractLabeled(text: string, label: string): string | null {
  const re = new RegExp(`${label}\\s*:\\s*([^|<>]{2,220}?)(?=\\s+(?:NIF|NIPC|Morada|Código Postal|Atividade|Forma jurídica|Razão Social|Designação comercial)\\s*:|$)`, "i");
  return cleanValue(text.match(re)?.[1] || null);
}
function extractFromPage(text: string, nif: string, legalName: string | null, sourceUrl: string): EmpresiteResult | null {
  if (!text.includes(nif)) return null;
  const publicName = validName(extractLabeled(text, "Designação comercial"), legalName);
  const address = extractLabeled(text, "Morada");
  const pageLegal = extractLabeled(text, "Razão Social");
  const candidates = publicName ? [publicName] : [];
  if (!pageLegal && !address && !candidates.length) return null;
  return { source: "empresite", legalName: pageLegal || legalName || null, publicNames: candidates, address, sourceUrl };
}
function extractSearchUrls(html: string): string[] {
  const urls = new Set<string>();
  const source = decodeHtml(html);
  for (const match of source.matchAll(/href=["']([^"']+)["']/gi)) {
    const href = match[1];
    try {
      const absolute = new URL(href, "https://html.duckduckgo.com/html/");
      const redirected = absolute.searchParams.get("uddg");
      const candidate = redirected ? decodeURIComponent(redirected) : absolute.toString();
      if (/empresite\.jornaldenegocios\.pt/i.test(candidate)) urls.add(candidate);
    } catch {}
  }
  for (const match of source.matchAll(/https?:\/\/[^\s"'<>]+/gi)) {
    const url = match[0].replace(/[),.;]+$/, "");
    if (/empresite\.jornaldenegocios\.pt/i.test(url)) urls.add(url);
  }
  return [...urls];
}

function extractFromSearchText(text: string, nif: string, legalName: string | null, sourceUrl: string): EmpresiteResult | null {
  const plain = clean(text);
  if (!plain.includes(nif) && !(legalName && keyOf(plain).includes(keyOf(legalName)))) return null;

  // Empresite frequently exposes the commercial designation on a listing/search page,
  // not on the individual company page returned by its search engine. Keep the
  // designation only when it occurs close to the exact NIF/legal-name match.
  const anchors = [nif, legalName || ""].filter(Boolean);
  for (const anchor of anchors) {
    const index = plain.toLocaleLowerCase().indexOf(anchor.toLocaleLowerCase());
    if (index < 0) continue;
    const window = plain.slice(Math.max(0, index - 250), Math.min(plain.length, index + 900));
    const match = window.match(/Designação\s+comercial\s*:\s*([^.!?\n]{3,120})/i);
    const candidate = validName(match?.[1] || null, legalName);
    if (candidate) return { source: "empresite", legalName, publicNames: [candidate], address: null, sourceUrl };
  }
  return null;
}

async function fetchPage(url: string): Promise<string | null> {
  const response = await fetch(url, { headers: { "user-agent": "Mozilla/5.0 (compatible; nif-nome/1.2; public business lookup)", accept: "text/html,application/xhtml+xml" } });
  if (!response.ok) return null;
  const bytes = await response.arrayBuffer();
  const contentType = response.headers.get("content-type") || "";
  const charset = /charset=([^;]+)/i.exec(contentType)?.[1]?.trim().toLowerCase();
  const decoder = new TextDecoder(charset === "utf-8" ? "utf-8" : "windows-1252");
  return clean(decoder.decode(bytes));
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
    try {
      const searchResponse = await fetch(searchUrl, { headers: { "user-agent": "Mozilla/5.0 (compatible; nif-nome/1.2; public business lookup)", accept: "text/html" } });
      if (!searchResponse.ok) continue;
      const html = await searchResponse.text();
      const searchFound = extractFromSearchText(html, nif, legalName, searchUrl);
      if (searchFound?.publicNames.length) return searchFound;
      const urls = extractSearchUrls(html).slice(0, 12);
      for (const url of urls) {
        if (visited.has(url)) continue;
        visited.add(url);
        try {
          const page = await fetchPage(url);
          if (!page) continue;
          const found = extractFromPage(page, nif, legalName, url);
          if (found?.publicNames.length) return found;
        } catch {}
      }
    } catch {}
  }
  return null;
}
