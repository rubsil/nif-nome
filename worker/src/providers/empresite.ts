export interface EinformaResult {
  source: "eInforma";
  legalName: string | null;
  publicNames: string[];
  address: string | null;
  sourceUrl: string;
}

function clean(value: string): string {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function slug(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " e ")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "-");
}

export async function findByNif(nif: string, legalName: string | null): Promise<EinformaResult | null> {
  const searchUrl = `https://www.einforma.pt/servlet/app/portal/ENTP/script/Empresa/nif/${nif}`;
  
  try {
    const res = await fetch(searchUrl, {
      headers: {
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/122.0.0.0 Safari/537.36"
      }
    });

    if (!res.ok) return null;
    const html = await res.text();

    // Captura "Designação comercial" ou marcas registadas na página do eInforma
    const match = html.match(/Designa(?:ção|cao)\s+comercial[\s\S]*?<td[^>]*>([\s\S]*?)<\/td>/i) 
               || html.match(/Nome\s+comercial[\s\S]*?<td[^>]*>([\s\S]*?)<\/td>/i);

    let foundName: string | null = null;
    if (match && match[1]) {
      const candidate = clean(match[1]);
      if (candidate && candidate.length > 2 && candidate.toLowerCase() !== legalName?.toLowerCase()) {
        foundName = candidate;
      }
    }

    return {
      source: "eInforma",
      legalName: legalName || null,
      publicNames: foundName ? [foundName] : [],
      address: null,
      sourceUrl: res.url || searchUrl
    };
  } catch {
    return null;
  }
}
