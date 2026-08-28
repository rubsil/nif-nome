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

// Extrai especificamente o texto da Designação Comercial no HTML
function extractDesignacaoComercial(html: string, legalName: string | null): string | null {
  // Regex 1: Célula exata conforme o Inspector da tua imagem
  const exactRegex = /Designa(?:ção|cao)\s+comercial[\s\S]*?<td[^>]*class=["'][^"']*td-datos-externos[^"']*["'][^>]*>([\s\S]*?)<\/td>/i;
  const matchExact = html.match(exactRegex);
  if (matchExact && matchExact[1]) {
    const candidate = validName(clean(matchExact[1]), legalName);
    if (candidate) return candidate;
  }

  // Regex 2: Fallback para qualquer tag <td>/<span> a seguir a Designação comercial
  const fallbackRegex = /Designa(?:ção|cao)\s+comercial[\s\S]*?<td[^>]*>([\s\S]*?)<\/td>/i;
  const matchFallback = html.match(fallbackRegex);
  if (matchFallback && matchFallback[1]) {
    const candidate = validName(clean(matchFallback[1]), legalName);
    if (candidate) return candidate;
  }

  return null;
}

// Gera os slugs prováveis do Empresite a partir da Razão Social
function buildPossibleUrls(legalName: string): string[] {
  const norm = (str: string) => str.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/&/g, " e ").replace(/[^a-zA-Z0-9]+/g, " ").trim().toUpperCase().replace(/\s+/g, "-");

  // Nome limpo (Sem sufixos tipo UNIPESSOAL, LDA, S.A.)
  const baseName = legalName.replace(/,?\s+(unipessoal|sociedade|lda|sa|s\.a\.|unipessoal\s+lda).*$/i, "").trim();

  return [
    `https://empresite.jornaldenegocios.pt/${norm(baseName)}.html`, // ex: PIZZARIA-ISAPIPO.html
    `https://empresite.jornaldenegocios.pt/${norm(legalName)}.html` // ex: PIZZARIA-ISAPIPO-UNIPESSOAL-LDA.html
  ];
}

export async function findByNif(nif: string, legalName: string | null): Promise<EmpresiteResult | null> {
  if (!legalName) return null;

  const urls = buildPossibleUrls(legalName);

  for (const url of urls) {
    try {
      const response = await fetch(url, {
        headers: {
          "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
          "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "accept-language": "pt-PT,pt;q=0.9,en-US;q=0.8,en;q=0.7"
        }
      });

      if (!response.ok) continue;

      const buffer = await response.arrayBuffer();
      // O Empresite costuma usar iso-8859-1 (windows-1252)
      const decoder = new TextDecoder("iso-8859-1");
      const html = decoder.decode(buffer);

      const publicName = extractDesignacaoComercial(html, legalName);
      if (publicName) {
        return {
          source: "empresite",
          legalName,
          publicNames: [publicName],
          address: null,
          sourceUrl: url
        };
      }
    } catch {}
  }

  return null;
}
