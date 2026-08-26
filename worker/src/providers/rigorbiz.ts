export interface RigorBizResult {
  source: "rigorbiz";
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
    .replace(/&ccedil;/gi, "ç").replace(/&atilde;/gi, "ã").replace(/&otilde;/gi, "õ")
    .replace(/&aacute;/gi, "á").replace(/&eacute;/gi, "é").replace(/&iacute;/gi, "í")
    .replace(/&oacute;/gi, "ó").replace(/&uacute;/gi, "ú").replace(/&agrave;/gi, "à")
    .replace(/&ecirc;/gi, "ê").replace(/&ocirc;/gi, "ô").replace(/&acirc;/gi, "â")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)));
}

function clean(html: string): string {
  return decodeHtml(html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ").trim();
}

function normalise(value: string | null): string | null {
  if (!value) return null;
  const v = decodeHtml(value).replace(/\s+/g, " ").trim();
  return v || null;
}

async function fetchText(url: string): Promise<string | null> {
  const response = await fetch(url, {
    headers: { "user-agent": "Mozilla/5.0 (compatible; nif-nome/1.0; public business lookup)", accept: "text/html,application/xhtml+xml" },
  });
  if (!response.ok) return null;
  return clean(await response.text());
}

function extract(text: string, nif: string, sourceUrl: string): RigorBizResult | null {
  if (!text.includes(nif)) return null;
  const pos = text.indexOf(nif);
  const window = text.slice(Math.max(0, pos - 300), Math.min(text.length, pos + 500));
  const m = window.match(new RegExp(`${nif}\\s+([^|]{3,180}?)\\s+(?:${"[A-ZÁÀÃÉÊÍÓÔÕÚÇ]"}|$)`, "i"));
  const legalName = normalise(m?.[1] || null);
  const heading = text.match(new RegExp(`(?:${nif}[^A-Za-zÀ-ÿ]{1,20})([^<|]{3,140})`, "i"));
  const candidate = normalise(heading?.[1] || legalName);
  if (!candidate) return null;
  return { source: "rigorbiz", legalName: candidate, publicNames: [], address: null, sourceUrl };
}

export async function findByNif(nif: string): Promise<RigorBizResult | null> {
  const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(`"${nif}" site:rigorbiz.pt`)}`;
  const search = await fetchText(searchUrl);
  if (!search) return null;
  const urls = [...search.matchAll(/https?:\/\/[^\s"'<>]+/gi)]
    .map(m => m[0].replace(/&amp;/g, "&"))
    .filter(u => /rigorbiz\.pt/i.test(u));
  for (const url of [...new Set(urls)].slice(0, 5)) {
    const page = await fetchText(url);
    if (!page) continue;
    const result = extract(page, nif, url);
    if (result) return result;
  }
  return null;
}
