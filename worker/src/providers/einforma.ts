export interface EInformaResult {
  source: "eInforma";
  legalName: string | null;
  address: string | null;
  website: string | null;
  activity: string | null;
  sourceUrl: string;
}

function decodeHtml(value: string): string {
  return value.replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)));
}

function clean(value: string): string {
  return decodeHtml(value.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

function field(text: string, label: string, nextLabels: string[]): string | null {
  const stop = nextLabels.map(x => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const re = new RegExp(`${label}\\s*:?\\s*(.*?)\\s*(?=${stop}|$)`, "i");
  const match = text.match(re);
  return match?.[1]?.trim() || null;
}

export async function findByNif(nif: string): Promise<EInformaResult | null> {
  const sourceUrl = `https://www.einforma.pt/servlet/app/portal/ENTP/prod/ETIQUETA_EMPRESA_CONTRIBUINTE/nif/${encodeURIComponent(nif)}/contribuinte/${encodeURIComponent(nif)}/`;
  const response = await fetch(sourceUrl, { headers: { "user-agent": "nif-nome/1.0 (+public business lookup)", accept: "text/html" } });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const text = clean(await response.text());
  if (!text.includes(nif)) return null;

  const legalName = field(text, "Denominação", ["Designações anteriores", "Morada", "Atividade"]);
  const address = field(text, "Morada", ["Atividade", "Antiguidade", "Telefone"]);
  const activity = field(text, "Atividade \\(CAE\\)", ["Antiguidade", "Telefone", "Email"]);
  const website = field(text, "Website", ["Balanço disponível", "Evolução das vendas", "Últimas alterações"]);

  if (!legalName && !address) return null;
  return { source: "eInforma", legalName, address, website, activity, sourceUrl };
}
