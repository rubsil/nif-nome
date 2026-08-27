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
export async function findNearby(address: string): Promise<{ places: NearbyPlace[]; geocoded: { display_name: string; lat: number; lon: number } | null; source: string }> {
  const q = normalise(address).replace(/\bC[oó]digo Postal\s*:\s*/i, "");
  const geocodeUrl = new URL("https://nominatim.openstreetmap.org/search");
  geocodeUrl.searchParams.set("q", `${q}, Portugal`); geocodeUrl.searchParams.set("format", "jsonv2"); geocodeUrl.searchParams.set("limit", "1"); geocodeUrl.searchParams.set("countrycodes", "pt");
  const geoResponse = await fetch(geocodeUrl.toString(), { headers: { "user-agent": "nif-nome/1.0 (public business lookup)", accept: "application/json" } });
  if (!geoResponse.ok) throw new Error(`Nominatim HTTP ${geoResponse.status}`);
  const geo = await geoResponse.json<any[]>();
  if (!geo.length) return { places: [], geocoded: null, source: "OpenStreetMap" };
  const lat = Number(geo[0].lat), lon = Number(geo[0].lon);
  const query = `[out:json][timeout:10];(nwr(around:150,${lat},${lon})["name"]["amenity"];nwr(around:150,${lat},${lon})["name"]["shop"];nwr(around:150,${lat},${lon})["name"]["tourism"];nwr(around:150,${lat},${lon})["name"]["craft"];nwr(around:150,${lat},${lon})["name"]["office"];nwr(around:150,${lat},${lon})["name"]["leisure"];nwr(around:150,${lat},${lon})["name"]["healthcare"];);out center tags;`;
  const overpass = await fetch("https://overpass-api.de/api/interpreter", { method: "POST", headers: { "content-type": "text/plain; charset=utf-8", "user-agent": "nif-nome/1.0 (public business lookup)" }, body: query });
  if (!overpass.ok) throw new Error(`Overpass HTTP ${overpass.status}`);
  const payload = await overpass.json<any>();
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
  return { places: [...unique.values()].slice(0, 15), geocoded: { display_name: geo[0].display_name, lat, lon }, source: "OpenStreetMap" };
}
