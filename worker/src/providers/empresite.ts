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

function extractFromHtml(html: string, legalName: string): string | null {
  const rowRegex = /<tr\b[^>]*>[\s\S]*?<\/tr>/gi;
  for (const match of html.matchAll(rowRegex)) {
    const row = match[0];
    const rowText = clean(row);
    if (!/Designa(?:ção|cao)\s+comercial/i.test(rowText)) continue;
    
    const cells: string[] = [];
    for (const cell of row.matchAll(/<(?:th|td)\b[^>]*>([\s\S]*?)<\/(?:th|td)>/gi)) {
      cells.push(clean(cell[1]));
    }
    const labelIndex = cells.findIndex((cell) => /Designa(?:ção|cao)\s+comercial/i.test(cell));
    if (labelIndex >= 0) {
      for (let i = labelIndex + 1; i < cells.length; i++) {
        const candidate = validName(cells[i], legalName);
        if (candidate) return candidate;
      }
    }
  }
  
  // Direct Regex fallback on cleaned text
  const text = clean(html);
  const match = text.match(/Designa(?:ção|cao)\s+comercial\s*:\s*([^|.<>]{3,100})/i);
  return validName(match?.[1] || null, legalName);
}

function directUrls(legalName: string | null): string[] {
  if (!legalName) return [];
  const full = slug(legalName);
  const base = legalName.replace(/,?\s+(unipessoal|sociedade|lda|sa|s\.a\.).*$/i, "").trim();
  const s = slug(base);
  
  const urls = [
    `https://empresite.jornaldenegocios.pt/${full}.html`,
    `https://empresite.jornaldenegocios.pt/${s}.html`
  ];
  return [...new Set(urls)];
}

async function fetchPage(url: string): Promise<{ html: string; text: string } | null> {
  const response = await fetch(url, { 
    headers: { 
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36", 
      accept: "text/html,application/xhtml+xml" 
    } 
  });
  if (!response.ok) return null;
  const bytes = await response.arrayBuffer();
  const type = response.headers.get("content-type") || "";
  const charset = /charset=([^;]+)/i.exec(type)?.[1]?.trim().toLowerCase();
  const html = new TextDecoder(charset === "utf-8" ? "utf-8" : "windows-1252").decode(bytes);
  return { html, text: clean(html) };
}

export async function findByNif(nif: string, legalName: string | null): Promise<EmpresiteResult | null> {
  if (!legalName) return null;
  const visited = new Set<string>();

  // 1. Tentar os URLs diretos baseados no nome legal (Slug)
  for (const url of directUrls(legalName)) {
    if (visited.has(url)) continue;
    visited.add(url);
    try {
      const page = await fetchPage(url);
      if (!page) continue;
      const name = extractFromHtml(page.html, legalName);
      if (name) {
        return { source: "empresite", legalName, publicNames: [name], address: null, sourceUrl: url };
      }
    } catch {}
  }

  // 2. Fallback via Jina Reader (caso haja bloqueio Cloudflare no fetch direto)
  for (const url of directUrls(legalName)) {
    try {
      const jinaUrl = `https://r.jina.ai/${url}`;
      const response = await fetch(jinaUrl, { headers: { "user-agent": "nif-nome/2.5", accept: "text/plain" } });
      if (!response.ok) continue;
      const text = await response.text();
      const match = text.match(/Designa(?:ção|cao)\s+comercial\s*:\s*([^\n\r|]{3,100})/i);
      const name = validName(match?.[1] || null, legalName);
      if (name) {
        return { source: "empresite", legalName, publicNames: [name], address: null, sourceUrl: url };
      }
    } catch {}
  }

  return null;
}
