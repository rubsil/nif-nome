export interface NearbyPlace {
  name: string;
  distance_m: number;
  category: string | null;
  address: string | null;
  lat: number;
  lon: number;
}

function normalise(value: string): string { return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim(); }
function distanceMeters(lat1: number, lon1: number, lat2: number, lon2: number): number { const r = 6371000; const p1 = lat1 * Math.PI / 180, p2 = lat2 * Math.PI / 180; const dp = (lat2 - lat1) * Math.PI / 180, dl = (lon2 - lon1) * Math.PI / 180; const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2; return r * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)); }
function category(tags: Record<string, string>): string | null { return tags.amenity || tags.shop || tags.tourism || tags.craft || tags.office || tags.leisure || tags.healthcare || null; }
function addressFromTags(tags: Record<string, string>): string | null { const parts = [tags["addr:street"], tags["addr:housenumber"], tags["addr:postcode"], tags["addr:city"]].filter(Boolean); return parts.length ? parts.join(", ") : null; }
function postcode(value: string): string { return value.match(/\b\d{4}-\d{3}\b/)?.[0] || ""; }
function withoutPortugal(value: string): string { return value.replace(/\bPortugal\b/gi, "").replace(/\s+/g, " ").trim(); }
function streetAndNumber(value: string): string {
  return withoutPortugal(value)
    .replace(/\bC[oó]digo Postal\s*:\s*\d{4}-\d{3}\b/gi, "")
    .replace(/\b\d{4}-\d{3}\b/g, "")
    .replace(/\b(?:HRT|MAD|MADALENA|HORTA)\b/gi, "")
    .replace(/\b(?:R\/C|RC|R\.\/C\.)\b/gi, "")
    .replace(/\s*,\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();
}
function locality(value: string): string {
  const cleaned = withoutPortugal(value);
  const match = cleaned.match(/(?:\d{4}-\d{3})\s+(.+)$/i);
  if (!match) return "";
  return match[1].replace(/\b(?:HRT|MAD)\b/gi, "").replace(/\s+/g, " ").trim();
}
function splitStreetNumber(value: string): { street: string; number: string } {
  const match = value.trim().match(/^(.*?)[,\s]+(\d+[A-Za-z]?)$/);
  if (!match) return { street: value.trim(), number: "" };
  return { street: match[1].trim(), number: match[2] };
}
function resultMatchesTarget(row: any, pc: string, loc: string): boolean {
  const display = normalise(String(row?.display_name || ""));
  const addr = row?.address || {};
  const resultPc = String(addr.postcode || "");
  const resultPlace = normalise(String(addr.city || addr.town || addr.village || addr.municipality || addr.county || ""));
  const wantedLoc = normalise(loc);

  // A postcode mismatch is decisive. This prevents a street with the same
  // name on another island from being accepted.
  if (pc && resultPc && resultPc !== pc) return false;

  // If Nominatim did not return a postcode, reject known wrong-island hits.
  if (pc && !resultPc && /funchal|madeira|porto santo|ponta delgada/i.test(display) && !/madeira|sao miguel|ponta delgada/i.test(wantedLoc)) return false;

  // Nominatim can use a freguesia (e.g. Angústias) in one field and Horta in
  // another. Accept the result when the requested locality occurs anywhere in
  // the full display name, while still rejecting a clearly different city.
  if (wantedLoc && !resultPlace.includes(wantedLoc) && !display.includes(wantedLoc)) return false;
  return true;
}
async function geocode(query: string): Promise<any | null> {
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", query);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("limit", "3");
  url.searchParams.set("countrycodes", "pt");
  const response = await fetch(url.toString(), { headers: { "user-agent": "nif-nome/2.5 (public business lookup; contact via project)", accept: "application/json" } });
  if (!response.ok) return null;
  const rows = await response.json<any[]>();
  return rows[0] || null;
}
async function geocodeStructured(base: string, pc: string, loc: string): Promise<any | null> {
  const { street, number } = splitStreetNumber(base);
  const url = new URL("https://nominatim.openstreetmap.org/search");
  if (street) url.searchParams.set("street", number ? `${street} ${number}` : street);
  if (pc) url.searchParams.set("postalcode", pc);
  if (loc) url.searchParams.set("city", loc);
  url.searchParams.set("country", "Portugal");
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("limit", "3");
  url.searchParams.set("countrycodes", "pt");
  const response = await fetch(url.toString(), { headers: { "user-agent": "nif-nome/2.5 (public business lookup; contact via project)", accept: "application/json" } });
  if (!response.ok) return null;
  const rows = await response.json<any[]>();
  return rows.find(row => resultMatchesTarget(row, pc, loc)) || null;
}

export async function findNearby(address: string): Promise<{ places: NearbyPlace[]; geocoded: { display_name: string; lat: number; lon: number } | null; source: string }> {
  const raw = normalise(address);
  const pc = postcode(raw);
  const base = streetAndNumber(raw);
  const loc = locality(raw);
  const upper = raw.toUpperCase();
  const islandHint = /HORTA|CASTELO BRANCO HRT|FAIAL|9900-/.test(upper) ? "Horta, Faial" : "";

  let geo: any | null = null;

  // First use Nominatim's structured address fields. This is much less likely
  // to interpret a generic street name as an address on another island.
  if (base && pc) {
    try { geo = await geocodeStructured(base, pc, loc || "Horta"); } catch {}
  }

  // Then use complete free-text queries as fallbacks. Every candidate is still
  // validated against the requested postcode/locality before being accepted.
  const candidates = [
    base && pc && loc ? `${base}, ${pc}, ${loc}, Portugal` : "",
    base && pc && islandHint ? `${base}, ${pc}, ${islandHint}, Portugal` : "",
    raw,
    base && loc ? `${base}, ${loc}, Portugal` : "",
    base && islandHint ? `${base}, ${islandHint}, Portugal` : "",
    pc && loc ? `${pc}, ${loc}, Portugal` : "",
    pc && islandHint ? `${pc}, ${islandHint}, Portugal` : "",
    base
  ].map(v => v.trim()).filter((v, i, arr) => v.length >= 4 && arr.indexOf(v) === i);

  if (!geo) {
    for (const candidate of candidates) {
      try {
        const candidateGeo = await geocode(candidate);
        if (candidateGeo && resultMatchesTarget(candidateGeo, pc, loc)) { geo = candidateGeo; break; }
      } catch {}
    }
  }

  if (!geo) return { places: [], geocoded: null, source: "OpenStreetMap" };

  const lat = Number(geo.lat), lon = Number(geo.lon);
  const radius = 300;
  const query = `[out:json][timeout:30];(nwr(around:${radius},${lat},${lon})["name"]["amenity"];nwr(around:${radius},${lat},${lon})["name"]["shop"];nwr(around:${radius},${lat},${lon})["name"]["tourism"];nwr(around:${radius},${lat},${lon})["name"]["craft"];nwr(around:${radius},${lat},${lon})["name"]["office"];nwr(around:${radius},${lat},${lon})["name"]["leisure"];nwr(around:${radius},${lat},${lon})["name"]["healthcare"];);out center tags;`;
  const endpoints = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.private.coffee/api/interpreter"
  ];
  let payload: any = null;
  for (const endpoint of endpoints) {
    try {
      const overpass = await fetch(endpoint, { method: "POST", headers: { "content-type": "text/plain; charset=utf-8", "user-agent": "nif-nome/2.5 (public business lookup)" }, body: query });
      if (overpass.ok) { payload = await overpass.json<any>(); break; }
    } catch {}
  }
  if (!payload) throw new Error("Não foi possível consultar os estabelecimentos no OpenStreetMap.");

  const places: NearbyPlace[] = [];
  for (const element of payload.elements || []) {
    const tags = element.tags || {};
    const name = normalise(tags.name || "");
    if (!name) continue;
    const center = element.center || { lat: element.lat, lon: element.lon };
    if (typeof center.lat !== "number" || typeof center.lon !== "number") continue;
    places.push({ name, distance_m: Math.round(distanceMeters(lat, lon, center.lat, center.lon)), category: category(tags), address: addressFromTags(tags), lat: center.lat, lon: center.lon });
  }
  places.sort((a, b) => a.distance_m - b.distance_m);
  const unique = new Map<string, NearbyPlace>();
  for (const place of places) { const key = `${place.name.toLocaleLowerCase()}|${place.address || ""}`; if (!unique.has(key)) unique.set(key, place); }
  return { places: [...unique.values()].slice(0, 20), geocoded: { display_name: geo.display_name, lat, lon }, source: "OpenStreetMap" };
}
