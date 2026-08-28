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

function keyOf(value: string): string {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim().toLocaleLowerCase();
}

function cleanValue(value: string | null): string | null {
  if (!value) return null;
  const v = value.replace(/\s+/g, " ").replace(/^[\-–—:|]+|[\-–—:|]+$/g, "").trim();
  return v || null;
}

function validName(value: string | null, legalName: string | null): string | null {
  const v = cleanValue(value);
  if (!v || v.length < 3 || v.length > 120) return null;
  if (legalName && keyOf(v) === keyOf(legalName)) return null;
  if (/^(nif|nipc|morada|atividade|código postal|codigo postal|designação comercial|denominação|razão social)$/i.test(v)) return null;
  if (/^(relatório|relatorio|empresa|empresa identificada|pesquisa|search|login|register|privacy|cookies)$/i.test(v)) return null;
  if (/^(s e publicações legais|s e publicacoes legais)/i.test(v)) return null;
  return v;
}

/**
 * Find the commercial designation only inside the exact company card.
 * Positions are deliberately calculated on the ORIGINAL cleaned text; using
 * an accent-normalised string for indexes makes slice() point at the wrong
 * place whenever the source contains accented characters.
 */
function extractCategoryCard(text: string, legalName: string, nif: string): string | null {
  const anchors = [legalName, nif].filter(Boolean);
  const positions: number[] = [];

  for (const anchor of anchors) {
    const exact = text.indexOf(anchor);
    if (exact >= 0) positions.push(exact);
    const normalisedAnchor = keyOf(anchor);
    if (normalisedAnchor) {
      const originalWords = text.split(/\s+/);
      // Fallback for HTML entities/case differences: find the anchor by a
      // whitespace-tolerant regexp, but still return an ORIGINAL-string index.
      const pattern = new RegExp(normalisedAnchor.split(" ").map(part => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s+"), "i");
      const match = text.match(pattern);
      if (match?.index != null) positions.push(match.index);
      void originalWords;
    }
  }

  const uniquePositions = [...new Set(positions)].sort((a, b) => a - b);
  if (!uniquePositions.length) return null;

  for (const index of uniquePositions) {
    // Empresite cards are compact. Keep the search bounded so another
    // company's designation cannot leak into this company's result.
    const start = Math.max(0, index - 500);
    const end = Math.min(text.length, index + 2200);
    const card = text.slice(start, end);
    const label = /Designa(?:ção|cao)\s+comercial\s*:\s*/i.exec(card);
    if (!label) continue;

    const after = card.slice((label.index || 0) + label[0].length);
    const candidate = after.split(/\s+(?=(?:Ver empresa|Ver no Mapa|Matches in the search|Activity categories|Pesquisar|Resultados|Pág\.?))/i)[0]
      .split(/\s+(?:Morada|NIF|NIPC|Atividade|CAE|Código Postal)\s*:/i)[0]
      .trim();
    const name = validName(candidate, legalName);
    if (name) return name;
  }

  return null;
}

function extractFromPage(text: string, nif: string, legalName: string | null, sourceUrl: string): EmpresiteResult | null {
  const hasNif = text.includes(nif);
  const hasLegalName = !!legalName && keyOf(text).includes(keyOf(legalName));
  if (!hasNif && !hasLegalName) return null;

  if (!legalName) return null;
  const categoryName = extractCategoryCard(text, legalName, nif);
  if (!categoryName) return null;

  return { source: "empresite", legalName, publicNames: [categoryName], address: null, sourceUrl };
}

function extractSearchUrls(html: string): string[] {
  const urls = new Set<string>();
  const source = decodeHtml(html);
  for (const match of source.matchAll(/href=["']([^"']+)["']/gi)) {
    try {
      const absolute = new URL(match[1], "https://html.duckduckgo.com/html/");
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

function buildSearchTerms(nif: string, legalName: string | null): string[] {
  const terms = new Set<string>();
  terms.add(`"${nif}" site:empresite.jornaldenegocios.pt`);
  terms.add(`"${nif}" "Designação comercial" site:empresite.jornaldenegocios.pt`);
  if (legalName) {
    const normal = legalName.replace(/\s+/g, " ").trim();
    const withoutSuffix = normal.replace(/,?\s+(unipessoal|sociedade|lda|sa|s\.a\.).*$/i, "").trim();
    terms.add(`"${normal}" site:empresite.jornaldenegocios.pt`);
    terms.add(`"${normal}" "Designação comercial" site:empresite.jornaldenegocios.pt`);
    if (withoutSuffix && withoutSuffix !== normal) terms.add(`"${withoutSuffix}" Empresite`);
  }
  return [...terms];
}

function buildDirectCategoryUrls(legalName: string | null): string[] {
  if (!legalName) return [];
  const n = keyOf(legalName);
  const urls: string[] = [];
  if (/pizzaria|pizza/.test(n)) urls.push("https://empresite.jornaldenegocios.pt/Actividade/PIZZARIA/");
  if (/restaurante|restauracao|restaura/.test(n)) urls.push("https://empresite.jornaldenegocios.pt/Actividade/RESTAURANTE/");
  if (/farmacia/.test(n)) urls.push("https://empresite.jornaldenegocios.pt/Actividade/FARMACIA/");
  if (/cafe|cafes/.test(n)) urls.push("https://empresite.jornaldenegocios.pt/Actividade/CAFE/");
  return urls;
}

async function fetchPage(url: string): Promise<string | null> {
  const response = await fetch(url, { headers: { "user-agent": "Mozilla/5.0 (compatible; nif-nome/2.2; public business lookup)", accept: "text/html,application/xhtml+xml" } });
  if (!response.ok) return null;
  const bytes = await response.arrayBuffer();
  const contentType = response.headers.get("content-type") || "";
  const charset = /charset=([^;]+)/i.exec(contentType)?.[1]?.trim().toLowerCase();
  const decoder = new TextDecoder(charset === "utf-8" ? "utf-8" : "windows-1252");
  return clean(decoder.decode(bytes));
}

export async function findByNif(nif: string, legalName: string | null): Promise<EmpresiteResult | null> {
  const visited = new Set<string>();
  for (const url of buildDirectCategoryUrls(legalName)) {
    if (visited.has(url)) continue;
    visited.add(url);
    try {
      const page = await fetchPage(url);
      if (!page) continue;
      const found = extractFromPage(page, nif, legalName, url);
      if (found?.publicNames.length) return found;
    } catch {}
  }
  for (const term of buildSearchTerms(nif, legalName)) {
    const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(term)}`;
    try {
      const searchResponse = await fetch(searchUrl, { headers: { "user-agent": "Mozilla/5.0 (compatible; nif-nome/2.2; public business lookup)", accept: "text/html" } });
      if (!searchResponse.ok) continue;
      const html = await searchResponse.text();
      for (const url of extractSearchUrls(html).slice(0, 30)) {
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
