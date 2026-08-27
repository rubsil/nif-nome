export interface PublicWebResult {
  source: "public-web";
  publicNames: { name: string; sourceUrl: string }[];
}

function decodeHtml(value: string): string {
  return value.replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)));
}

function strip(html: string): string {
  return decodeHtml(html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ").trim();
}

function normalise(value: string): string {
  return decodeHtml(value).replace(/\s+/g, " ").trim().replace(/^[\-–—:|]+|[\-–—:|]+$/g, "").trim();
}

function keyOf(value: string): string {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase();
}

function validCandidate(value: string, legalName: string): boolean {
  const v = normalise(value);
  if (v.length < 4 || v.length > 100) return false;
  const n = keyOf(v);
  if (n === keyOf(legalName)) return false;

  // These are languages, UI/navigation labels or generic words. Search engines
  // frequently expose them in snippets, especially in multilingual result pages.
  const generic = new Set([
    "english", "spanish", "french", "german", "italian", "portuguese", "portugues",
    "espanol", "espanhol", "francais", "deutsch", "italiano", "nederlands", "dutch",
    "home", "menu", "contactos", "contact", "about", "inicio", "pesquisa", "resultado",
    "empresa", "restaurante", "pizzaria", "publicacoes", "publicacoes legais", "relatorio gratis",
    "relatorio", "nif", "contribuinte", "denominacao", "morada", "atividade", "codigo postal",
    "cnae", "cae", "privacy", "cookies", "login", "register", "search", "next", "previous"
  ]);
  if (generic.has(n)) return false;
  if (/^(?:s|e)\s+public/.test(n)) return false;
  if (/licenciada|lider|mercado|informacao para negocios|informa d&b|relatorio gratis/.test(n)) return false;
  if (v.split(/\s+/).length > 12) return false;
  return true;
}

function addCandidate(found: Map<string, { name: string; sourceUrl: string }>, value: string, sourceUrl: string, legalName: string): void {
  const candidate = normalise(value);
  if (!validCandidate(candidate, legalName)) return;
  const key = keyOf(candidate);
  if (!found.has(key)) found.set(key, { name: candidate, sourceUrl });
}

export async function findPublicNames(nif: string, legalName: string | null): Promise<PublicWebResult | null> {
  const queries = [
    `"${nif}" "nome comercial"`,
    `"${nif}" "designação comercial"`,
    `"${nif}" "nome do estabelecimento"`,
    `"${nif}" "marca"`,
  ];
  const found = new Map<string, { name: string; sourceUrl: string }>();
  const legal = legalName || "";

  for (const query of queries) {
    const sourceUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const response = await fetch(sourceUrl, {
      headers: { "user-agent": "Mozilla/5.0 (compatible; nif-nome/1.0; public business lookup)", accept: "text/html" },
    });
    if (!response.ok) continue;
    const html = await response.text();
    const text = strip(html);
    if (!text.includes(nif)) continue;

    // IMPORTANT: Do not treat arbitrary text inside parentheses as a company
    // name. That was the source of false positives such as "English" and
    // "Spanish" from search-engine language/navigation fragments.
    const windowRe = new RegExp(`.{0,1200}${nif}.{0,1200}`, "gi");
    for (const match of text.matchAll(windowRe)) {
      const chunk = match[0];

      // Only accept a candidate when the snippet explicitly labels it as a
      // commercial name / establishment name / brand. This is deliberately
      // conservative: a false name is worse than returning no name.
      const labelledPatterns = [
        /(?:nome\s+comercial|designa(?:ção|cao)\s+comercial|nome\s+do\s+estabelecimento|marca)\s*(?:[:\-–—]|é|e|is)?\s*([^|.;<>]{3,100})/gi,
        /(?:commercial\s+name|trade\s+name|establishment\s+name|brand)\s*(?:[:\-–—]|is)?\s*([^|.;<>]{3,100})/gi,
      ];
      for (const pattern of labelledPatterns) {
        for (const m of chunk.matchAll(pattern)) addCandidate(found, m[1], sourceUrl, legal);
      }
    }
  }

  return found.size ? { source: "public-web", publicNames: [...found.values()].slice(0, 5) } : null;
}
