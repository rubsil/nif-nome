export interface NifPtRecord {
  nif: number;
  title?: string;
  address?: string;
  pc4?: string;
  pc3?: string;
  city?: string;
  activity?: string;
  status?: string;
  cae?: string;
  contacts?: { email?: string; phone?: string; website?: string; fax?: string };
  geo?: { region?: string; county?: string; parish?: string };
  place?: { address?: string; pc4?: string; pc3?: string; city?: string };
  racius?: string;
  alias?: string;
}

export interface NifPtResult {
  source: "nif.pt";
  record: NifPtRecord;
}

export async function findByNif(nif: string, apiKey: string): Promise<NifPtResult | null> {
  const url = new URL("https://www.nif.pt/");
  url.searchParams.set("json", "1");
  url.searchParams.set("q", nif);
  url.searchParams.set("key", apiKey);

  const response = await fetch(url.toString(), {
    headers: { accept: "application/json" },
  });

  if (!response.ok) throw new Error(`NIF.pt HTTP ${response.status}`);

  const payload = await response.json<{
    result?: string;
    records?: Record<string, NifPtRecord>;
    is_nif?: boolean;
  }>();

  const record = payload.records?.[nif];
  if (payload.result !== "success" || !record) return null;
  return { source: "nif.pt", record };
}
