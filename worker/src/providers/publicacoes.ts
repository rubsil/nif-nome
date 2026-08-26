export interface PublicacaoResult {
  source: "publicacoes.mj.pt";
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

function cleanText(html: string): string {
  return decodeHtml(html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function extractNames(text: string, nif: string): string[] {
  const names = new Set<string>();
  const escaped = nif.replace(/\D/g, "");
  const windowRe = new RegExp(`.{0,500}${escaped}.{0,700}`, "gi");
  for (const match of text.matchAll(windowRe)) {
    const chunk = match[0];
    const patterns = [
      /(?:firma|denomina(?:ção|cao)|entidade|benefici[aá]rio)\s*[:\-]?\s*([^.;|]{3,160})/i,
      /(?:designa(?:ção|cao)\s+comercial|nome\s+comercial)\s*[:\-]?\s*([^.;|]{3,160})/i,
      /\((?:restaurante|pizzaria|caf[eé]|farm[aá]cia|bar|loja)[^)]{0,100}\)/i,
    ];
    for (const pattern of patterns) {
      const m = chunk.match(pattern);
      if (m?.[1]) names.add(m[1].trim());
      else if (m?.[0] && /\(/.test(m[0])) names.add(m[0].trim().replace(/^[-–—]\s*/, ""));
    }
  }
  return [...names].filter(n => n.length >= 3 && n.length <= 180);
}

export async function findByNif(nif: string): Promise<PublicacaoResult | null> {
  const sourceUrl = `https://publicacoes.mj.pt/Pesquisa.aspx?nif=${encodeURIComponent(nif)}`;
  const response = await fetch(sourceUrl, {
    headers: { "user-agent": "nif-nome/1.0 (+public business lookup)", accept: "text/html" },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const html = await response.text();
  const text = cleanText(html);
  if (!text.includes(nif)) return null;

  const publicNames = extractNames(text, nif);
  const legalMatch = text.match(/(?:Firma|Denomina(?:ção|cao)|Entidade)\s*[:\-]?\s*([^.;|]{3,180})/i);
  const addressMatch = text.match(/(?:Morada|Sede)\s*[:\-]?\s*([^.;|]{5,220})/i);

  return {
    source: "publicacoes.mj.pt",
    legalName: legalMatch?.[1]?.trim() || null,
    publicNames,
    address: addressMatch?.[1]?.trim() || null,
    sourceUrl,
  };
}
