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

function baseLegalName(value: string): string {
  return value
    .replace(/,?\s+(sociedade\s+)?unipessoal\b.*$/i, "")
    .replace(/,?\s+(sociedade|lda|s\.a\.?|sa)\.?\s*$/i, "")
    .trim();
}

function slugWord(value: string): string {
  return keyOf(value).toUpperCase().replace(/\s+/g, "-").replace(/^-|-$/g, "");
}

function extractCommercialName(region: string, legalName: string): string | null {
  const text = clean(region);
  const matches = [
    /Designa(?:ção|cao)\s+comercial\s*:\s*(.+?)(?=Ver\s+empresa|Ver\s+no\s+Mapa|Matches\s+in\s+the\s+search|$)/i,
    /Designa(?:ção|cao)\s+comercial\s*[:|]\s*(.+?)(?=UNIP|LDA|SA|$)/i
  ];
  for (const re of matches) {
    const m = text.match(re);
    if (!m?.[1]) continue;
    const candidate = m[1].replace(/\s+/g, " ").trim();
    if (candidate.length < 3 || candidate.length > 120) continue;
    if (keyOf(candidate) === keyOf(legalName)) continue;
    // Do not accept page navigation/chrome accidentally captured after the label.
    if (/^(ver empresa|ver no mapa|matches in the search)/i.test(candidate)) continue;
    return candidate;
  }
  return null;
}

function extractExactCompanyCard(html: string, legalName: string, postalCode: string | null): string | null {
  const decoded = decodeHtml(html);
  const wanted = keyOf(legalName);
  const wantedBase = keyOf(baseLegalName(legalName));
  const lines = clean(decoded).split(/(?=Ver empresaVer no Mapa|Ver empresa\s+Ver no Mapa)/i);

  // Empresite search pages are lists of many companies. Restrict extraction
  // to the exact result block containing the legal name AND postcode.
  for (const block of lines) {
    const b = keyOf(block);
    if ((!b.includes(wanted) && !b.includes(wantedBase)) || (postalCode && !b.includes(keyOf(postalCode)))) continue;
    const name = extractCommercialName(block, legalName);
    if (name) return name;
  }

  // Fallback for layouts where the card separator is different: inspect only
  // a small neighbourhood around the exact legal-name occurrence.
  let from = 0;
  while (true) {
    const anchor = decoded.toLocaleLowerCase().indexOf(legalName.toLocaleLowerCase(), from);
    if (anchor < 0) break;
    from = anchor + legalName.length;
    const region = decoded.slice(Math.max(0, anchor - 1200), Math.min(decoded.length, anchor + 3000));
    const regionKey = keyOf(clean(region));
    if (!regionKey.includes(wanted) && !regionKey.includes(wantedBase)) continue;
    if (postalCode && !regionKey.includes(keyOf(postalCode))) continue;
    const name = extractCommercialName(region, legalName);
    if (name) return name;
  }
  return null;
}

async function fetchHtml(url: string): Promise<{ html: string; finalUrl: string } | null> {
  try {
    const response = await fetch(url, {
      headers: {
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122 Safari/537.36",
        "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "pt-PT,pt;q=0.9,en;q=0.5"
      },
      redirect: "follow"
    });
    if (!response.ok) return null;
    const buffer = await response.arrayBuffer();
    const utf8 = new TextDecoder("utf-8").decode(buffer);
    const html = utf8.includes("�") ? new TextDecoder("windows-1252").decode(buffer) : utf8;
    return { html, finalUrl: response.url || url };
  } catch {
    return null;
  }
}

export async function findByNif(nif: string, legalName: string | null, address: string | null = null): Promise<EmpresiteResult | null> {
  if (!legalName) return null;

  const base = baseLegalName(legalName);
  const postalCode = address?.match(/\b\d{4}-\d{3}\b/)?.[0] || null;
  const words = keyOf(base).split(" ").filter(w => w.length >= 3 && !/^(lda|sa|s|unipessoal|sociedade|limitada)$/i.test(w));

  // Empresite's free public pages often do not expose the complete NIF. The
  // reliable route is therefore: search by one or more meaningful words,
  // then require an exact legal-name + postcode match in the returned card.
  // Crucially, also try ONE word: PIZZARIA ISAPIPO is found on /Actividade/PIZZARIA/
  // whereas /Actividade/PIZZARIA-ISAPIPO/ is not a valid Empresite category.
  const searchWords = [...new Set([
    words.slice(0, 3).join("-"),
    words.slice(0, 2).join("-"),
    ...words.slice(0, 3)
  ])];

  const urls: string[] = [];
  for (const word of searchWords) {
    const s = slugWord(word);
    if (!s) continue;
    urls.push(`https://empresite.jornaldenegocios.pt/Actividade/${s}/`);
  }

  // A very useful nationwide fallback: if the company name contains a clear
  // business keyword (pizzaria, restaurante, hotel, farmacia, etc.), searching
  // that keyword can expose the exact company card.
  const keywords = ["PIZZARIA", "RESTAURANTE", "HOTEL", "CAFÉ", "CAFE", "FARMACIA", "FARMÁCIA", "BAR", "TALHO", "PADARIA", "OFICINA", "AUTO", "IMOBILIARIA", "IMOBILIÁRIA"];
  for (const w of words) if (keywords.includes(w.toUpperCase())) urls.push(`https://empresite.jornaldenegocios.pt/Actividade/${slugWord(w)}/`);

  const seen = new Set<string>();
  for (const url of urls) {
    if (seen.has(url)) continue;
    seen.add(url);
    const fetched = await fetchHtml(url);
    if (!fetched) continue;
    const publicName = extractExactCompanyCard(fetched.html, legalName, postalCode);
    if (publicName) return { source: "empresite", legalName, publicNames: [publicName], address, sourceUrl: fetched.finalUrl };
  }
  return null;
}
