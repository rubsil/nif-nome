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

function validCandidate(value: string, legalName: string): boolean {
  const v = normalise(value);
  if (v.length < 4 || v.length > 100) return false;
  if (v.toLocaleLowerCase() === legalName.toLocaleLowerCase()) return false;
  if (/^(?:nif|empresa|contribuinte|denomina(?:ção|cao)|morada|atividade|código postal|cnae|cae)$/i.test(v)) return false;
  if (/licenciada|líder|lider|mercado|informação para negócios|informa d&b|relatório grátis/i.test(v)) return false;
  return true;
}

export async function findPublicNames(nif: string, legalName: string | null): Promise<PublicWebResult | null> {
  const queries = [
    `"${nif}" "nome comercial"`,
    `"${nif}" restaurante`,
    `"${nif}" pizzaria`,
    `"${nif}" "marca"`,
  ];
  const found = new Map<string, { name: string; sourceUrl: string }>();

  for (const query of queries) {
    const response = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
      headers: { "user-agent": "Mozilla/5.0 (compatible; nif-nome/1.0; public business lookup)", accept: "text/html" },
    });
    if (!response.ok) continue;
    const html = await response.text();
    const text = strip(html);
    if (!text.includes(nif)) continue;

    // Public records often put the establishment name in parentheses immediately
    // beside the NIF (e.g. "Empresa X (Restaurante Y) ... NIF").
    const windowRe = new RegExp(`.{0,900}${nif}.{0,900}`, "gi");
    for (const match of text.matchAll(windowRe)) {
      const chunk = match[0];
      for (const m of chunk.matchAll(/\(([^()]{4,100})\)/g)) {
        const candidate = normalise(m[1]);
        if (!validCandidate(candidate, legalName || "")) continue;
        const key = candidate.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase();
        if (!found.has(key)) found.set(key, { name: candidate, sourceUrl: `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}` });
      }
    }
  }

  return found.size ? { source: "public-web", publicNames: [...found.values()].slice(0, 5) } : null;
}
