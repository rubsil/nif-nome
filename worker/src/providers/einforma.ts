export interface EInformaResult {
  source: "eInforma";
  legalName: string | null;
  publicNames: string[];
  address: string | null;
  website: string | null;
  activity: string | null;
  sourceUrl: string;
}

function decodeHtml(value: string): string {
  return value.replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">\").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)));
}

function clean(value: string): string {
  return decodeHtml(value.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

function normalise(value: string | null): string | null {
  if (!value) return null;
  const result = value.replace(/\s*\|\s*/g, " ").replace(/\s+/g, " ").trim();
  return result || null;
}

function field(text: string, labels: string[], nextLabels: string[]): string | null {
  const starts = labels.map(x => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const stops = nextLabels.map(x => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const re = new RegExp(`(?:${starts})\\s*:?\\s*(.*?)\\s*(?=${stops}|$)`, "i");
  return normalise(text.match(re)?.[1] || null);
}

function extractCommercialNames(text: string): string[] {
  const values = new Set<string>();
  const patterns = [
    /(?:Denomina(?:ção|cao)\s+Comercial|Designa(?:ção|cao)\s+Comercial|Nome\s+Comercial)\s*:?\s*([^|.;]{3,160})/gi,
    /(?:Marca|Nome\s+do\s+Estabelecimento)\s*:?\s*([^|.;]{3,160})/gi,
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const value = normalise(match[1]);
      if (value && value.length >= 3 && value.length <= 160) values.add(value);
    }
  }
  return [...values];
}

function extractFromPage(text: string, nif: string, sourceUrl: string): EInformaResult | null {
  if (!text.includes(nif)) return null;
  const legalName = field(text, ["Denominação", "Razão Social"], ["Designações anteriores", "Denominação Comercial", "Morada", "Atividade"]);
  const address = field(text, ["Morada", "Endereço"], ["Atividade", "Antiguidade", "Telefone", "Website"]);
  const activity = field(text, ["Atividade (CAE)", "Atividade"], ["Antiguidade", "Telefone", "Email", "Website"]);
  const website = field(text, ["Website"], ["Balanço disponível", "Evolução das vendas", "Últimas alterações"]);
  const publicNames = extractCommercialNames(text);
  if (!legalName && !address && !publicNames.length) return null;
  return { source: "eInforma", legalName, publicNames, address, website, activity, sourceUrl };
}

async function fetchPage(url: string): Promise<string | null> {
  const response = await fetch(url, { headers: { "user-agent": "Mozilla/5.0 (compatible; nif-nome/1.0; public business lookup)", accept: "text/html,application/xhtml+xml" } });
  if (!response.ok) return null;
  return clean(await response.text());
}

async function searchWeb(nif: string): Promise<EInformaResult | null> {
  const query = encodeURIComponent(`"${nif}" empresa Portugal`);
  const searchUrl = `https://html.duckduckgo.com/html/?q=${query}`;
  const text = await fetchPage(searchUrl);
  if (!text) return null;
  const urls = [...text.matchAll(/https?:\/\/[^\s"'<>]+/gi)].map(m => m[0].replace(/&amp;/g, "&")).filter(u => /einforma\.pt|iberinform\.pt|racius\.com/i.test(u));
  for (const url of [...new Set(urls)].slice(0, 5)) {
    try {
      const page = await fetchPage(url);
      if (!page) continue;
      const result = extractFromPage(page, nif, url);
      if (result) return result;
    } catch {
      // Continue with the next public result.
    }
  }
  return null;
}

export async function findByNif(nif: string): Promise<EInformaResult | null> {
  const urls = [
    `https://www.einforma.pt/servlet/app/portal/ENTP/prod/ETIQUETA_EMPRESA_CONTRIBUINTE/nif/${encodeURIComponent(nif)}/contribuinte/${encodeURIComponent(nif)}/`,
    `https://www.einforma.pt/servlet/app/portal/ENTP/prod/ETIQUETA_EMPRESA_CONTRIBUINTE/nif/${encodeURIComponent(nif)}/contribuinte/${encodeURIComponent(nif)}`
  ];
  for (const sourceUrl of urls) {
    try {
      const text = await fetchPage(sourceUrl);
      if (!text) continue;
      const result = extractFromPage(text, nif, sourceUrl);
      if (result) return result;
    } catch {
      // Try the next public source.
    }
  }
  return searchWeb(nif);
}
