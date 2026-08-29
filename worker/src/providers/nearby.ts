export interface NearbyPlace {
  name: string;
  distance_m: number;
  category: string | null;
  address: string | null;
  lat: number;
  lon: number;
}

function normalise(value: string): string {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim();
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
  const parts = [tags["addr:street"], tags["addr:housenumber"], tags["addr:postcode"], tags["addr:city"]].filter(Boolean);
  return parts.length ? parts.join(", ") : null;
}

function postcode(value: string): string {
  return value.match(/\b\d{4}-\d{3}\b/)?.[0] || "";
}

function cleanAddressForGeocoding(value: string): string {
  return value
    .replace(/\bC[oó]digo Postal\s*:\s*\d{4}-\d{3}\b/gi, "")
    .replace(/\b\d{4}-\d{3}\b/g, "")
    .replace(/\bPortugal\b/gi, "")
    .replace(/\b(?:R\/C|RC|R\.\/C\.|LOJA\s*\w*|ANDAR\s*\d*)\b/gi, "")
    .replace(/\s*,\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function locality(value: string): string {
  const match = value.match(/(?:\d{4}-\d{3})\s+(.+?)(?:\s+Portugal)?$/i);
  if (!match) return "";
  return match[1].replace(/\b(?:HRT|MAD|MADALENA)\b/gi, "").replace(/\s+/g, " ").trim();
}

async function geocode(query: string): Promise<any | null> {
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", query);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("limit", "1");
  url.searchParams.set("countrycodes", "pt");

  const response = await fetch(url.toString(), {
    headers: {
      "user-agent": "nif-nome/2.7 (public business lookup bot)",
      accept: "application/json"
    }
  });
  if (!response.ok) return null;
  const rows = await response.json<any[]>();
  return rows[0] || null;
}

export async function findNearby(address: string): Promise<{ places: NearbyPlace[]; geocoded: { display_name: string; lat: number; lon: number } | null; source: string }> {
  const raw = normalise(address);
  const pc = postcode(raw);
  const addressClean = cleanAddressForGeocoding(raw);
  const loc = locality(raw);

  let geo: any | null = null;

  // IMPORTANT: never geocode the postcode alone. A postcode can cover a
  // large area and Nominatim may resolve it to a completely different point.
  // Start with the full street + door number + postcode, then progressively
  // relax only the parts that can cause a miss. This remains nationwide.
  const candidates = [
    addressClean && pc ? `${addressClean}, ${pc}, Portugal` : "",
    addressClean && loc && pc ? `${addressClean}, ${loc}, ${pc}, Portugal` : "",
    addressClean && loc ? `${addressClean}, ${loc}, Portugal` : "",
    pc ? `${pc}, Portugal` : ""
  ].filter((v, i, arr) => v.length >= 4 && arr.indexOf(v) === i);

  for (const candidate of candidates) {
    try {
      geo = await geocode(candidate);
      if (geo) break;
    } catch {}
  }

  if (!geo) return { places: [], geocoded: null, source: "OpenStreetMap" };

  const lat = Number(geo.lat), lon = Number(geo.lon);
  const radius = 400;
  const query = `[out:json][timeout:25];(nwr(around:${radius},${lat},${lon})["name"]["amenity"];nwr(around:${radius},${lat},${lon})["name"]["shop"];nwr(around:${radius},${lat},${lon})["name"]["tourism"];nwr(around:${radius},${lat},${lon})["name"]["craft"];nwr(around:${radius},${lat},${lon})["name"]["office"];nwr(around:${radius},${lat},${lon})["name"]["leisure"];nwr(around:${radius},${lat},${lon})["name"]["healthcare"];);out center tags;`;

  const endpoints = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.private.coffee/api/interpreter"
  ];

  let payload: any = null;
  for (const endpoint of endpoints) {
    try {
      const overpass = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "text/plain; charset=utf-8", "user-agent": "nif-nome/2.7" },
        body: query
      });
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
    places.push({
      name,
      distance_m: Math.round(distanceMeters(lat, lon, center.lat, center.lon)),
      category: category(tags),
      address: addressFromTags(tags),
      lat: center.lat,
      lon: center.lon
    });
  }

  places.sort((a, b) => a.distance_m - b.distance_m);
  const unique = new Map<string, NearbyPlace>();
  for (const place of places) {
    const key = `${place.name.toLocaleLowerCase()}|${place.address || ""}`;
    if (!unique.has(key)) unique.set(key, place);
  }

  return {
    places: [...unique.values()].slice(0, 20),
    geocoded: { display_name: geo.display_name, lat, lon },
    source: "OpenStreetMap"
  };
}
