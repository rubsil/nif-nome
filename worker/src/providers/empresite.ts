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
  return decodeHtml(value
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function keyOf(value: string): string {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim().toLocaleLowerCase();
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
  if (/^(relatório|relatorio|empresa|pesquisa|search|login|register|privacy|cookies)$/i.test(v)) return null;
  if (/^s e publicações legais\b|^s e publicacoes legais\b/i.test(v)) return null;
  return v;
}

/**
 * Empresite exposes the company data in a real HTML table. The screenshot
 * supplied during debugging shows the exact structure:
 *
 *   <tr class="tr-datos-externos">
 *     ... <th>Designação comercial</th>
 *     <td class="td-datos-externos">FARMACIA LEÇO</td>
 *   </tr>
 *
 * Parse that row directly instead of searching the whole page for the label.
 * This prevents navigation words such as English/Spanish from becoming a
 * company's commercial name and keeps the value tied to the exact page.
 */
function extractCommercialNameFromHtml(html: string, legalName: string | null): string | null {
  const rowRegex = /<tr\b[^>]*>[\s\S]*?<\/tr>/gi;
  for (const match of html.matchAll(rowRegex)) {
    const row = match[0];
    const rowText = clean(row);
    if (!/Designa(?:ção|cao)\s+comercial/i.test(rowText)) continue;

    const cells: string[] = [];
    for (const cell of row.matchAll(/<(?:th|td)\b[^>]*>([\s\S]*?)<\/(?:th|td)>/gi)) {
      cells.push(clean(cell[1]));
    }

    const labelIndex = cells.findIndex(cell => /Designa(?:ção|cao)\s+comercial/i.test(cell));
    if (labelIndex < 0) continue;

    for (let i = labelIndex + 1; i < cells.length; i++) {
      const candidate = validName(cells[i], legalName);
      if (candidate) return candidate;
    }
  }

  // Some Empresite layouts omit <th> and use divs. Keep this fallback local
  // to the block containing the label; never search page-wide.
  const blockRegex = /<(?:div|li|section)\b[^>]*>[\s\S]{0,5000}?Designa(?:ção|cao)\s+comercial[\s\S]{0,5000}?<\/(?:div|li|section)>/gi;
  for (const match of html.matchAll(blockRegex)) {
    const text = clean(match[0]);
    const label = /Designa(?:ção|cao)\s+comercial\s*:?/i.exec(text);
    if (!label) continue;
    const after = text.slice((label.index || 0) + label[0].length);
    const candidate = after.split(/\s+(?:NIF|NIPC|Morada|Atividade|Forma jurídica|Razão Social|Código Postal)\s*:/i)[0].trim();
    const name = validName(candidate, legalName);
    if (name) return name;
  }

  return null;
}

function extractFromPage(html: string, text: string, nif: string, legalName: string | null, sourceUrl: string): EmpresiteResult | null {
  const hasNif = text.includes(nif);
  const hasLegalName = !!legalName && keyOf(text).includes(keyOf(legalName));
  if (!hasNif && !hasLegalName) return null;
  if (!legalName) return null;

  const commercialName = extractCommercialNameFromHtml(html, legalName);
  if (!commercialName) return null;

  return { source: "empresite", legalName, publicNames: [commercialName], address: null, sourceUrl };
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

async function fetchPage(url: string): Promise<{ html: string; text: string } | null> {
  const response = await fetch(url, { headers: { "user-agent": "Mozilla/5.0 (compatible; nif-nome/2.3; public business lookup)", accept: "text/html,application/xhtml+xml" } });
  if (!response.ok) return null;
  const bytes = await response.arrayBuffer();
  const contentType = response.headers.get("content-type") || "";
  const charset = /charset=([^;]+)/i.exec(contentType)?.[1]?.trim().toLowerCase();
  const decoder = new TextDecoder(charset === "utf-8" ? "utf-8" : "windows-1252");
  const html = decoder.decode(bytes);
  return { html, text: clean(html) };
}

export async function findByNif(nif: string, legalName: string | null): Promise<EmpresiteResult | null> {
  const visited = new Set<string>();
  for (const term of buildSearchTerms(nif, legalName)) {
    const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(term)}`;
    try {
      const searchResponse = await fetch(searchUrl, { headers: { "user-agent": "Mozilla/5.0 (compatible; nif-nome/2.3; public business lookup)", accept: "text/html" } });
      if (!searchResponse.ok) continue;
      const html = await searchResponse.text();
      for (const url of extractSearchUrls(html).slice(0, 30)) {
        if (visited.has(url)) continue;
        visited.add(url);
        try {
          const page = await fetchPage(url);
          if (!page) continue;
          const found = extractFromPage(page.html, page.text, nif, legalName, url);
          if (found?.publicNames.length) return found;
        } catch {}
      }
    } catch {}
  }
  return null;
}
