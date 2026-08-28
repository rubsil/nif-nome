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

function validName(value: string | null, legalName: string | null): string | null {
  if (!value) return null;
  const v = decodeHtml(value).replace(/\s+/g, " ").replace(/^[\-–—:|]+|[\-–—:|]+$/g, "").trim();
  if (!v || v.length < 3 || v.length > 120) return null;
  if (legalName && keyOf(v) === keyOf(legalName)) return null;
  if (/^(nif|nipc|morada|atividade|código postal|codigo postal|designação comercial|denominação|razão social)$/i.test(v)) return null;
  return v;
}

function extractNameFromText(text: string, legalName: string | null): string | null {
  // 1. Procura na estrutura HTML exata (<td class="td-datos-externos">)
  const regexExact = /Designa(?:ção|cao)\s+comercial[\s\S]*?<td[^>]*class=["'][^"']*td-datos-externos[^"']*["'][^>]*>([\s\S]*?)<\/td>/i;
  const matchExact = text.match(regexExact);
  if (matchExact && matchExact[1]) {
    const candidate = validName(clean(matchExact[1]), legalName);
    if (candidate) return candidate;
  }

  // 2. Procura em formato Markdown/Texto plano
  const regexText = /Designa(?:ção|cao)\s+comercial\s*[:|]\s*([^\r\n|]{3,100})/i;
  const matchText = text.match(regexText);
  if (matchText && matchText[1]) {
    const candidate = validName(clean(matchText[1]), legalName);
    if (candidate) return candidate;
  }

  return null;
}

// Procura no DuckDuckGo o URL exato do Empresite para este NIF
async function findEmpresiteUrlByNif(nif: string): Promise<string | null> {
  try {
    const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(`"${nif}" site:empresite.jornaldenegocios.pt`)}`;
    const res = await fetch(searchUrl, {
      headers: { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36" }
    });
    if (!res.ok) return null;
    const html = await res.text();
    
    const match = html.match(/href=["']([^"']*empresite\.jornaldenegocios\.pt\/[^"']+\.html)["']/i);
    if (match && match[1]) {
      const rawUrl = match[1];
      const uddg = new URL(rawUrl, "https://html.duckduckgo.com").searchParams.get("uddg");
      return uddg ? decodeURIComponent(uddg) : rawUrl;
    }
  } catch {}
  return null;
}

export async function findByNif(nif: string, legalName: string | null): Promise<EmpresiteResult | null> {
  // 1. Encontra o URL direto do perfil da empresa usando o NIF
  let targetUrl = await findEmpresiteUrlByNif(nif);

  // Fallback de URL se a pesquisa falhar e tivermos legalName
  if (!targetUrl && legalName) {
    const cleanLegal = legalName.replace(/,?\s+(unipessoal|sociedade|lda|sa|s\.a\.).*$/i, "").trim();
    const sClean = cleanLegal.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9]+/g, "-").toUpperCase();
    targetUrl = `https://empresite.jornaldenegocios.pt/${sClean}.html`;
  }

  if (!targetUrl) return null;

  // 2. Usa o Jina Reader para extrair o conteúdo contornando bloqueios de bots
  try {
    const jinaRes = await fetch(`https://r.jina.ai/${targetUrl}`, {
      headers: { "user-agent": "Mozilla/5.0", accept: "text/plain" }
    });
    
    if (jinaRes.ok) {
      const text = await jinaRes.text();
      const publicName = extractNameFromText(text, legalName);
      if (publicName) {
        return {
          source: "empresite",
          legalName,
          publicNames: [publicName],
          address: null,
          sourceUrl: targetUrl
        };
      }
    }
  } catch {}

  return null;
}
