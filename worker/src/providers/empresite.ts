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
  return decodeHtml(
    value
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/\s+/g, " ")
    .trim();
}

function keyOf(value: string): string {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim().toLocaleLowerCase();
}

function slug(value: string): string {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/&/g, " e ").replace(/[^a-zA-Z0-9]+/g, " ").trim().toUpperCase().replace(/\s+/g, "-");
}

function validName(value: string | null, legalName: string | null): string | null {
  if (!value) return null;
  const v = decodeHtml(value).replace(/\s+/g, " ").replace(/^[\-–—:|]+|[\-–—:|]+$/g, "").trim();
  if (!v || v.length < 3 || v.length > 120) return null;
  if (legalName && keyOf(v) === keyOf(legalName)) return null;
  if (/^(nif|nipc|morada|atividade|código postal|codigo postal|designação comercial|denominação|razão social)$/i.test(v)) return null;
  if (/^s e publicações legais\b/i.test(v)) return null;
  return v;
}

// Extrai o nome tanto de HTML bruto como de texto formatado (Jina)
function extractNameFromText(text: string, legalName: string): string | null {
  // 1. Procura pela estrutura exata no HTML (td.td-datos-externos)
  const regexExact = /Designa(?:ção|cao)\s+comercial[\s\S]*?<td[^>]*class=["'][^"']*td-datos-externos[^"']*["'][^>]*>([\s\S]*?)<\/td>/i;
  const matchExact = text.match(regexExact);
  if (matchExact && matchExact[1]) {
    const candidate = validName(clean(matchExact[1]), legalName);
    if (candidate) return candidate;
  }

  // 2. Procura em formato Markdown/Texto plano (Ex: "Designação comercial : PIZZARIA PAPA PIZZA")
  const regexText = /Designa(?:ção|cao)\s+comercial\s*[:|]\s*([^\r\n|]{3,100})/i;
  const matchText = text.match(regexText);
  if (matchText && matchText[1]) {
    const candidate = validName(clean(matchText[1]), legalName);
    if (candidate) return candidate;
  }

  return null;
}

// Gera os URLs prováveis do Empresite
function getTargetUrls(legalName: string): string[] {
  const cleanLegal = legalName.replace(/,?\s+(unipessoal|sociedade|lda|sa|s\.a\.|unipessoal\s+lda).*$/i, "").trim();
  const sClean = slug(cleanLegal);
  const full = slug(legalName);

  return [
    `https://empresite.jornaldenegocios.pt/${sClean}.html`,
    `https://empresite.jornaldenegocios.pt/${full}.html`
  ];
}

// Tenta obter o conteúdo da página ignorando o bloqueio de bots via proxy Jina Reader
async function fetchPageWithBypass(url: string): Promise<string | null> {
  // Tentativa 1: Via Jina Reader (Garante bypass aos bloqueios do Empresite)
  try {
    const jinaRes = await fetch(`https://r.jina.ai/${url}`, {
      headers: { "user-agent": "Mozilla/5.0", accept: "text/plain" }
    });
    if (jinaRes.ok) {
      const text = await jinaRes.text();
      if (text && text.length > 200) return text;
    }
  } catch {}

  // Tentativa 2: Fetch direto simples
  try {
    const directRes = await fetch(url, {
      headers: {
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36",
        accept: "text/html"
      }
    });
    if (directRes.ok) return await directRes.text();
  } catch {}

  return null;
}

export async function findByNif(nif: string, legalName: string | null): Promise<EmpresiteResult | null> {
  if (!legalName) return null;

  const targetUrls = getTargetUrls(legalName);

  for (const url of targetUrls) {
    const content = await fetchPageWithBypass(url);
    if (!content) continue;

    const publicName = extractNameFromText(content, legalName);
    if (publicName) {
      return {
        source: "empresite",
        legalName,
        publicNames: [publicName],
        address: null,
        sourceUrl: url
      };
    }
  }

  return null;
}
