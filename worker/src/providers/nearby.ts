export interface NearbyPlace {
  name: string;
  distance_m: number;
  category: string | null;
  address: string | null;
  lat: number;
  lon: number;
}

function cleanText(value: string): string {
  return value
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
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
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/\s+/g, " ")
    .trim();
}

function key(value: string): string {
  return cleanText(value).normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim().toLocaleLowerCase();
}

function distanceMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const r = 6371000;
  const p1 = lat1 * Math.PI / 180, p2 = lat2 * Math.PI / 180;
  const dp = (lat2 - lat1) * Math.PI / 180, dl = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return r * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function category(tags: Record<string, string>): string | null {
  return tags.amenity || tags.shop || tags.tourism || tags.craft || tags.office || tags.leisure || tags.healthcare || null;
}

function addressFromTags(tags: Record<string, string>): string | null {
  const parts = [tags["addr:street"], tags["addr:housenumber"], tags["addr:postcode"], tags["addr:city"]].filter(Boolean).map(cleanText);
  return parts.length ? parts.join(", ") : null;
}

function postcode(value: string): string {
  return value.match(/\b\d{4}-\d{3}\b/)?.[0] || "";
}

function cleanAddressForGeocoding(value: string): string {
  return cleanText(value)
    .replace(/\bC[oó]digo Postal\s*:\s*\d{4}-\d{3}\b/gi, "")
    .replace(/\b\d{4}-\d{3}\b/g, "")
    .replace(/\bPortugal\b/gi, "")
    .replace(/\b(?:R\/C|RC|R\.\/C\.|LOJA\s*\w*|ANDAR\s*\d*)\b/gi, "")
    .replace(/\s*,\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function locality(value: string): string {
  const match = cleanText(value).match(/(?:\d{4}-\d{3})\s+(.+?)(?:\s+Portugal)?$/i);
  if (!match) return "";
  return cleanText(match[1]).replace(/\b(?:HRT|MAD|MADALENA)\b/gi, "").replace(/\s+/g, " ").trim();
}

function geoMatchesInput(geo: any, pc: string, loc: string): boolean {
  if (!geo) return false;
  const a = geo.address || {};
  const display = key(geo.display_name || "");
  const postcodeMatches = !pc || key(a.postcode || "") === key(pc) || display.includes(key(pc));
  if (!postcodeMatches) return false;
  if (!loc) return true;
  const wanted = key(loc);
  const place = key([a.city, a.town, a.village, a.municipality, a.county, a.state_district].filter(Boolean).join(" "));
  return place.includes(wanted) || wanted.includes(key(a.city || "")) || wanted.includes(key(a.town || "")) || display.includes(wanted);
}

async function geocodeCandidate(query: string, pc: string, loc: string): Promise<any | null> {
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", query);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("limit", "8");
  url.searchParams.set("countrycodes", "pt");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(url.toString(), {
      headers: {
        "user-agent": "NIF-Nome/4.0 (+https://rubsil.github.io/nif-nome/; public business lookup)",
        "referer": "https://rubsil.github.io/nif-nome/",
        accept: "application/json"
      },
      signal: controller.signal
    });
    if (!response.ok) return null;
    const rows = await response.json<any[]>();
    return rows.find(row => geoMatchesInput(row, pc, loc)) || null;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchOverpass(endpoint: string, query: string): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "user-agent": "NIF-Nome/4.0 (+https://rubsil.github.io/nif-nome/; public business lookup)",
        referer: "https://rubsil.github.io/nif-nome/"
      },
      body: query,
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`Overpass ${response.status}`);
    return await response.json<any>();
  } finally {
    clearTimeout(timer);
  }
}

export async function findNearby(address: string): Promise<{ places: NearbyPlace[]; geocoded: { display_name: string; lat: number; lon: number } | null; source: string }> {
  const raw = cleanText(address);
  const pc = postcode(raw);
  const addressClean = cleanAddressForGeocoding(raw);
  const loc = locality(raw);
  let geo: any | null = null;

  // Address + postcode is the primary lookup. The postcode is deliberately
  // retained as a validation constraint so an identically named street in a
  // different Portuguese city cannot win.
  const candidates = [
    addressClean && pc && loc ? `${addressClean}, ${pc}, ${loc}, Portugal` : "",
    addressClean && pc ? `${addressClean}, ${pc}, Portugal` : "",
    pc && loc ? `${pc}, ${loc}, Portugal` : "",
    addressClean && loc ? `${addressClean}, ${loc}, Portugal` : "",
    pc ? `${pc}, Portugal` : ""
  ].filter((v, i, arr) => v.length >= 4 && arr.indexOf(v) === i);

  for (const candidate of candidates) {
    try {
      geo = await geocodeCandidate(candidate, pc, loc);
      if (geo) break;
    } catch {}
  }

  if (!geo) return { places: [], geocoded: null, source: "OpenStreetMap" };

  const lat = Number(geo.lat), lon = Number(geo.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return { places: [], geocoded: null, source: "OpenStreetMap" };

  const radius = 300;
  const query = `[out:json][timeout:10];(nwr(around:${radius},${lat},${lon})["name"]["amenity"];nwr(around:${radius},${lat},${lon})["name"]["shop"];nwr(around:${radius},${lat},${lon})["name"]["tourism"];nwr(around:${radius},${lat},${lon})["name"]["craft"];nwr(around:${radius},${lat},${lon})["name"]["office"];nwr(around:${radius},${lat},${lon})["name"]["leisure"];nwr(around:${radius},${lat},${lon})["name"]["healthcare"];);out center tags;`;

  const endpoints = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://z.overpass-api.de/api/interpreter"
];

  let payload: any;
  try {
    // Do not start several public Overpass requests in parallel. One endpoint
    // is tried at a time, with a fallback if it is unavailable.
    let lastError: unknown = null;
    for (const endpoint of endpoints) {
      try {
        payload = await fetchOverpass(endpoint, query);
        break;
      } catch (error) {
        lastError = error;
      }
    }
    if (!payload) throw lastError || new Error("Overpass indisponível");
  } catch {
    throw new Error("Não foi possível consultar os estabelecimentos no OpenStreetMap.");
  }

  const places: NearbyPlace[] = [];
  for (const element of payload.elements || []) {
    const tags = element.tags || {};
    const name = cleanText(tags.name || "");
    if (!name) continue;
    const center = element.center || { lat: element.lat, lon: element.lon };
    if (typeof center.lat !== "number" || typeof center.lon !== "number") continue;
    places.push({
      name,
      distance_m: Math.round(distanceMeters(lat, lon, center.lat, center.lon)),
      category: cleanText(category(tags) || "") || null,
      address: addressFromTags(tags),
      lat: center.lat,
      lon: center.lon
    });
  }

  places.sort((a, b) => a.distance_m - b.distance_m);
  const unique = new Map<string, NearbyPlace>();
  for (const place of places) {
    const keyValue = `${key(place.name)}|${key(place.address || "")}`;
    if (!unique.has(keyValue)) unique.set(keyValue, place);
  }

  return { places: [...unique.values()].slice(0, 20), geocoded: { display_name: cleanText(geo.display_name || ""), lat, lon }, source: "OpenStreetMap" };
}
