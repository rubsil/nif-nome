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

function extractDesignacaoComercial(html: string, legalName: string | null): string | null {
  // 1. Procura na classe específica onde o Empresite coloca a designação comercial
  const exactRegex = /Designa(?:ção|cao)\s+comercial[\s\S]*?<td[^>]*class=["'][^"']*td-datos-externos[^"']*["'][^>]*>([\s\S]*?)<\/td>/i;
  let match = html.match(exactRegex);

  // 2. Fallback para qualquer TD seguinte caso a classe mude
  if (!match) {
    const fallbackRegex = /Designa(?:ção|cao)\s+comercial[\s\S]*?<td[^>]*>([\s\S]*?)<\/td>/i;
    match = html.match(fallbackRegex);
  }

  if (match && match[1]) {
    const candidate = clean(match[1]);
    if (
      candidate &&
      candidate.length >= 3 &&
      candidate.length <= 120 &&
      (!legalName || keyOf(candidate) !== keyOf(legalName))
    ) {
      return candidate;
    }
  }

  return null;
}

export async function findByNif(nif: string, legalName: string | null): Promise<EmpresiteResult | null> {
  const urlsToTry: string[] = [
    `https://empresite.jornaldenegocios.pt/Buscar/${encodeURIComponent(nif)}`
  ];

  if (legalName) {
    const cleanLegal = legalName.replace(/,?\s+(unipessoal|sociedade|lda|sa|s\.a\.).*$/i, "").trim();
    const slugName = cleanLegal
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/&/g, " e ")
      .replace(/[^a-zA-Z0-9]+/g, " ")
      .trim()
      .toUpperCase()
      .replace(/\s+/g, "-");
    urlsToTry.unshift(`https://empresite.jornaldenegocios.pt/${slugName}.html`);
  }

  for (const url of urlsToTry) {
    try {
      const response = await fetch(url, {
        headers: {
          "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
          "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
        },
        redirect: "follow"
      });

      if (!response.ok) continue;

      const buffer = await response.arrayBuffer();
      // O Empresite usa a codificação ISO-8859-1 (Latin-1)
      const html = new TextDecoder("iso-8859-1").decode(buffer);

      const publicName = extractDesignacaoComercial(html, legalName);
      if (publicName) {
        return {
          source: "empresite",
          legalName: legalName || null,
          publicNames: [publicName],
          address: null,
          sourceUrl: response.url || url
        };
      }
    } catch {}
  }

  return null;
}
