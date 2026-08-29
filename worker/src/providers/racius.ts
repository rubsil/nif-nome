export interface RaciusResult {
  source: "racius";
  legalName: string | null;
  address: string | null;
  activity: string | null;
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
    .replace(/&ccedil;/gi, "ç")
    .replace(/&atilde;/gi, "ã")
    .replace(/&otilde;/gi, "õ")
    .replace(/&aacute;/gi, "á")
    .replace(/&eacute;/gi, "é")
    .replace(/&iacute;/gi, "í")
    .replace(/&oacute;/gi, "ó")
    .replace(/&uacute;/gi, "ú")
    .replace(/&agrave;/gi, "à")
    .replace(/&acirc;/gi, "â")
    .replace(/&ecirc;/gi, "ê")
    .replace(/&ocirc;/gi, "ô")
    .replace(/&uuml;/gi, "ü")
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
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9]+/g, " ").replace(/\s+/g, " ").trim().toLocaleLowerCase();
}

function slug(value: string): string {
  return keyOf(value).replace(/\b(sociedade|por quotas)\b/g, "").replace(/\s+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
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

function extract(html: string, nif: string, fallbackLegal: string | null, sourceUrl: string): RaciusResult | null {
  const text = clean(html);
  if (!new RegExp(`\\b${nif}\\b`).test(text)) return null;

  const nameMatch = text.match(/#\s*([^#]{3,160})\s+NIF\s+\d{9}/i) || text.match(/Racius\s*-\s*Informação Empresarial\s+([^\n]{3,160})\s+NIF/i);
  const legalName = nameMatch?.[1]?.trim() || fallbackLegal;

  const addressMatch = text.match(/Morada\s+(.{5,220}?)(?=Forma Jurídica|Capital Social|Atividade|Acerca da Empresa)/i);
  const activityMatch = text.match(/Atividade\s+(.{5,500}?)(?=Acerca da Empresa|CAE|Eventos|Estado de Atividade)/i);

  return {
    source: "racius",
    legalName,
    address: addressMatch?.[1]?.trim() || null,
    activity: activityMatch?.[1]?.trim() || null,
    sourceUrl
  };
}

export async function findByNif(nif: string, legalName: string | null): Promise<RaciusResult | null> {
  if (!legalName) return null;
  const base = slug(legalName);
  if (!base) return null;

  const candidates = [...new Set([
    base,
    base.replace(/-unipessoal$/, ""),
    base.replace(/-unipessoal-lda$/, "-lda")
  ])];

  for (const candidate of candidates) {
    const url = `https://www.racius.com/${candidate}/`;
    const fetched = await fetchHtml(url);
    if (!fetched) continue;
    const result = extract(fetched.html, nif, legalName, fetched.finalUrl);
    if (result) return result;
  }
  return null;
}
