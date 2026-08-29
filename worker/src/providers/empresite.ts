export interface EmpresiteResult {
  source: "empresite";
  legalName: string | null;
  publicNames: string[];
  address: string | null;
  sourceUrl: string;
}

function decodeHtml(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
    .replace(/&ccedil;/gi, "ç").replace(/&atilde;/gi, "ã").replace(/&otilde;/gi, "õ")
    .replace(/&aacute;/gi, "á").replace(/&eacute;/gi, "é").replace(/&iacute;/gi, "í")
    .replace(/&oacute;/gi, "ó").replace(/&uacute;/gi, "ú").replace(/&agrave;/gi, "à")
    .replace(/&acirc;/gi, "â").replace(/&ecirc;/gi, "ê").replace(/&ocirc;/gi, "ô").replace(/&uuml;/gi, "ü")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)));
}

function clean(value: string): string {
  return decodeHtml(value.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

function keyOf(value: string): string {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/&/g, " e ").replace(/[^a-zA-Z0-9]+/g, " ").replace(/\s+/g, " ").trim().toLocaleLowerCase();
}

function slug(value: string): string {
  return keyOf(value).toUpperCase().replace(/\b(UNIPESSOAL|SOCIEDADE|LIMITADA|LDA|S A|SA)\b/g, " ").replace(/\s+/g, "-").replace(/^-|-$/g, "");
}

function baseLegalName(value: string): string {
  return value.replace(/,?\s+(sociedade\s+)?unipessoal\b.*$/i, "").replace(/,?\s+(sociedade|lda|s\.a\.?|sa)\.?\s*$/i, "").trim();
}

function extractDesignacaoComercial(html: string, legalName: string | null): string | null {
  const decoded = decodeHtml(html);
  const row = decoded.match(/<tr[^>]*>[\s\S]*?Designa(?:ção|cao)\s+comercial[\s\S]*?<\/tr>/i)?.[0];
  if (row) {
    const match = clean(row).match(/Designa(?:ção|cao)\s+comercial\s*[:|]?\s*(.+)$/i);
    if (match?.[1]) {
      const candidate = match[1].trim();
      if (candidate.length >= 3 && candidate.length <= 120 && (!legalName || keyOf(candidate) !== keyOf(legalName))) return candidate;
    }
  }
  const match = decoded.match(/Designa(?:ção|cao)\s+comercial[\s\S]*?<td[^>]*>([\s\S]*?)<\/td>/i);
  if (match?.[1]) {
    const candidate = clean(match[1]);
    if (candidate.length >= 3 && candidate.length <= 120 && (!legalName || keyOf(candidate) !== keyOf(legalName))) return candidate;
  }
  return null;
}

function findAnchor(html: string, legalName: string): number {
  const decoded = decodeHtml(html);
  for (const candidate of [legalName, baseLegalName(legalName)]) {
    const literal = decoded.toLocaleLowerCase().indexOf(candidate.toLocaleLowerCase());
    if (literal >= 0) return literal;
  }
  return -1;
}

function extractFromMatchingCard(html: string, legalName: string, postalCode: string | null): string | null {
  const decoded = decodeHtml(html);
  const anchor = findAnchor(decoded, legalName);
  if (anchor < 0) return null;

  // Public Empresite pages contain many companies. Only inspect the card-sized
  // region around the exact legal name; never search Designação comercial on
  // the entire page (that caused the old English/Spanish false positives).
  const window = decoded.slice(Math.max(0, anchor - 1000), Math.min(decoded.length, anchor + 5000));
  const windowKey = keyOf(clean(window));
  const wanted = keyOf(legalName);
  const wantedBase = keyOf(baseLegalName(legalName));
  if (!windowKey.includes(wanted) && !windowKey.includes(wantedBase)) return null;
  if (postalCode && !windowKey.includes(keyOf(postalCode))) return null;
  return extractDesignacaoComercial(window, legalName);
}

async function fetchHtml(url: string): Promise<{ html: string; finalUrl: string } | null> {
  try {
    const response = await fetch(url, {
      headers: {
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122 Safari/537.36",
        "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "pt-PT,pt;q=0.9,en;q=0.5"
      }, redirect: "follow"
    });
    if (!response.ok) return null;
    const buffer = await response.arrayBuffer();
    const utf8 = new TextDecoder("utf-8").decode(buffer);
    return { html: utf8.includes("�") ? new TextDecoder("windows-1252").decode(buffer) : utf8, finalUrl: response.url || url };
  } catch { return null; }
}

export async function findByNif(nif: string, legalName: string | null, address: string | null = null): Promise<EmpresiteResult | null> {
  // The free Empresite pages do not provide a dependable public NIF lookup.
  // Use the legal name to reach public pages, then validate the exact company
  // card before extracting Designação comercial.
  if (!legalName) return null;

  const base = baseLegalName(legalName);
  const urls: string[] = [];
  for (const s of [slug(legalName), slug(base)]) {
    if (!s) continue;
    urls.push(`https://empresite.jornaldenegocios.pt/${s}.html`);
    urls.push(`https://empresite.jornaldenegocios.pt/Actividade/${s}/`);
  }
  const words = keyOf(base).split(" ").filter(w => w.length > 2);
  for (let count = Math.min(4, words.length); count >= 2; count--) urls.push(`https://empresite.jornaldenegocios.pt/Actividade/${words.slice(0, count).join("-").toUpperCase()}/`);

  const postalCode = address?.match(/\b\d{4}-\d{3}\b/)?.[0] || null;
  const seen = new Set<string>();
  for (const url of urls) {
    if (seen.has(url)) continue;
    seen.add(url);
    const fetched = await fetchHtml(url);
    if (!fetched) continue;
    const publicName = extractFromMatchingCard(fetched.html, legalName, postalCode);
    if (!publicName) continue;
    return { source: "empresite", legalName, publicNames: [publicName], address: null, sourceUrl: fetched.finalUrl };
  }
  return null;
}
