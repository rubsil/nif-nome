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

// Extração ultra-precisa calibrada pelo Inspector do Chrome
function extractFromHtml(html: string, legalName: string): string | null {
  // Captura a tag <td class="td-datos-externos"> logo a seguir ao <th>Designação comercial</th>
  const regexExact = /Designa(?:ção|cao)\s+comercial[\s\S]*?<td[^>]*class=["'][^"']*td-datos-externos[^"']*["'][^>]*>([\s\S]*?)<\/td>/i;
  const matchExact = html.match(regexExact);

  if (matchExact && matchExact[1]) {
    const candidate = validName(clean(matchExact[1]), legalName);
    if (candidate) return candidate;
  }

  // Fallback genérico para a mesma tabela <tr>
  const regexRow = /<tr[^>]*class=["'][^"']*tr-datos-externos[^"']*["'][^>]*>([\s\S]*?)<\/tr>/gi;
  for (const match of html.matchAll(regexRow)) {
    const rowContent = match[1];
    if (/Designa(?:ção|cao)\s+comercial/i.test(rowContent)) {
      const tdMatch = rowContent.match(/<td[^>]*>([\s\S]*?)<\/td>/i);
      if (tdMatch && tdMatch[1]) {
        const candidate = validName(clean(tdMatch[1]), legalName);
        if (candidate) return candidate;
      }
    }
  }

  return null;
}

function generatePossibleSlugs(legalName: string): string[] {
  const full = slug(legalName);
  const withoutSuffix = legalName.replace(/,?\s+(unipessoal|sociedade|lda|sa|s\.a\.|unipessoal\s+lda).*$/i, "").trim();
  const sWithoutSuffix = slug(withoutSuffix);

  return [
    `https://empresite.jornaldenegocios.pt/${sWithoutSuffix}.html`,
    `https://empresite.jornaldenegocios.pt/${full}.html`
  ];
}

async function fetchPage(url: string): Promise<string | null> {
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
  return new TextDecoder(charset === "utf-8" ? "utf-8" : "windows-1252").decode(bytes);
}

export async function findByNif(nif: string, legalName: string | null): Promise<EmpresiteResult | null> {
  if (!legalName) return null;
  const urls = generatePossibleSlugs(legalName);

  for (const url of urls) {
    try {
      const html = await fetchPage(url);
      if (!html) continue;

      const name = extractFromHtml(html, legalName);
      if (name) {
        return {
          source: "empresite",
          legalName,
          publicNames: [name],
          address: null,
          sourceUrl: url
        };
      }
    } catch {}
  }

  // Fallback via Jina Reader
  for (const url of urls) {
    try {
      const response = await fetch(`https://r.jina.ai/${url}`, {
        headers: { "user-agent": "nif-nome/2.9", accept: "text/plain" }
      });
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
