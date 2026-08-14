const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Point = { lat: number; lon: number; name: string };

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
  });
}

function isGoogleMapsUrl(url: URL) {
  const host = url.hostname.toLowerCase();
  if (host === "maps.app.goo.gl") return true;
  if (host === "goo.gl") return url.pathname.startsWith("/maps/");
  return host === "google.com" || host.endsWith(".google.com") ||
    host === "google.co.jp" || host.endsWith(".google.co.jp");
}

function decodePlace(value: string) {
  try {
    return decodeURIComponent(value.replace(/\+/g, " ")).trim();
  } catch {
    return value.replace(/\+/g, " ").trim();
  }
}

function pointFromCoordinate(value: string, name = "経由地"): Point | null {
  const match = decodePlace(value).match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
  if (!match) return null;
  const lat = Number(match[1]);
  const lon = Number(match[2]);
  return Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180
    ? { lat, lon, name }
    : null;
}

async function fetchWithTimeout(url: string, init: RequestInit = {}, timeout = 12000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function expandGoogleUrl(input: URL) {
  let current = input;
  for (let count = 0; count < 6; count++) {
    if (!isGoogleMapsUrl(current)) throw new Error("Googleマップ以外のリンクには移動できません");
    const response = await fetchWithTimeout(current.toString(), {
      method: "GET",
      redirect: "manual",
      headers: { "User-Agent": "AMBR-Ride-App/1.0" },
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) break;
      current = new URL(location, current);
      continue;
    }
    const finalUrl = new URL(response.url || current.toString());
    if (!isGoogleMapsUrl(finalUrl)) throw new Error("Googleマップ以外のリンクには移動できません");
    return finalUrl;
  }
  return current;
}

function extractPlaces(url: URL) {
  const params = url.searchParams;
  const apiPlaces = [
    params.get("origin") || "",
    ...(params.get("waypoints") || "").split("|").filter(Boolean),
    params.get("destination") || "",
  ].map(decodePlace).filter(Boolean);
  if (apiPlaces.length) return apiPlaces;

  const marker = "/maps/dir/";
  const index = url.pathname.indexOf(marker);
  if (index < 0) return [];
  return url.pathname.slice(index + marker.length).split("/")
    .map(decodePlace)
    .filter((part) => part && !part.startsWith("data=") && !part.startsWith("@") && part !== "maps");
}

function extractEmbeddedCoordinates(url: URL): Point[] {
  const points: Point[] = [];
  const text = decodePlace(url.toString());
  const pattern = /!1d(-?\d+(?:\.\d+)?)!2d(-?\d+(?:\.\d+)?)/g;
  for (const match of text.matchAll(pattern)) {
    const lon = Number(match[1]);
    const lat = Number(match[2]);
    if (Number.isFinite(lat) && Number.isFinite(lon)) points.push({ lat, lon, name: "経由地" });
  }
  return points;
}

function extractPlaceLabel(url: URL) {
  const query = url.searchParams.get("query") || url.searchParams.get("q") ||
    url.searchParams.get("destination") || "";
  if (query && !pointFromCoordinate(query)) return decodePlace(query);
  const marker = "/maps/place/";
  const index = url.pathname.indexOf(marker);
  if (index < 0) return "目的地";
  return decodePlace(url.pathname.slice(index + marker.length).split("/")[0] || "") || "目的地";
}

function isPlaceholderPlace(value: string) {
  const normalized = decodePlace(value).replace(/[\s　]/g, "").toLowerCase();
  return !normalized || ["目的地", "出発地", "現在地", "現在の場所", "destination", "yourlocation"].includes(normalized);
}

async function tryGeocode(place: string) {
  if (isPlaceholderPlace(place)) return null;
  try {
    return await geocode(place);
  } catch {
    return null;
  }
}

function extractSingleDestination(url: URL): Point | null {
  const text = decodePlace(url.toString());
  const dataMatch = text.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/);
  if (dataMatch) return pointFromCoordinate(`${dataMatch[1]},${dataMatch[2]}`, extractPlaceLabel(url));
  const atMatch = text.match(/\/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
  if (atMatch) return pointFromCoordinate(`${atMatch[1]},${atMatch[2]}`, extractPlaceLabel(url));
  const query = url.searchParams.get("query") || url.searchParams.get("q") || url.searchParams.get("destination") || "";
  return pointFromCoordinate(query, extractPlaceLabel(url));
}

async function geocode(place: string): Promise<Point> {
  const coordinate = pointFromCoordinate(place, place);
  if (coordinate) return coordinate;
  const response = await fetchWithTimeout(
    `https://msearch.gsi.go.jp/address-search/AddressSearch?q=${encodeURIComponent(place)}`,
  );
  if (!response.ok) throw new Error(`「${place}」を検索できませんでした`);
  const results = await response.json();
  const first = Array.isArray(results) ? results[0] : null;
  const coordinates = first?.geometry?.coordinates;
  if (!Array.isArray(coordinates) || coordinates.length < 2) {
    throw new Error(`「${place}」の場所を特定できませんでした。Googleマップで経路を開き直して共有してください`);
  }
  return {
    lon: Number(coordinates[0]),
    lat: Number(coordinates[1]),
    name: first?.properties?.title || place,
  };
}

function deduplicate(points: Point[]) {
  return points.filter((point, index) => {
    const previous = points[index - 1];
    return !previous || Math.abs(point.lat - previous.lat) > 0.00001 || Math.abs(point.lon - previous.lon) > 0.00001;
  });
}

function escapeXml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;",
  })[character] || character);
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "POSTで送信してください" }, 405);

  try {
    const body = await request.json();
    const input = String(body?.url || "").trim();
    const startInput = String(body?.start || "").trim().slice(0, 120);
    if (!input || input.length > 4096) return json({ error: "Googleマップのリンクを貼り付けてください" }, 400);

    let url: URL;
    try {
      url = new URL(input);
    } catch {
      return json({ error: "Googleマップの正しいリンクを貼り付けてください" }, 400);
    }
    if (url.protocol !== "https:" || !isGoogleMapsUrl(url)) {
      return json({ error: "Googleマップの共有リンクだけ読み込めます" }, 400);
    }

    const resolved = await expandGoogleUrl(url);
    let placeNames = extractPlaces(resolved);
    let points = extractEmbeddedCoordinates(resolved);
    if (points.length < 2 && placeNames.length >= 2) {
      points = await Promise.all(placeNames.slice(0, 10).map(geocode));
    }
    if (points.length < 2 && startInput) {
      const destinationLabel = placeNames.at(-1) || extractPlaceLabel(resolved);
      const destination = points[0] || extractSingleDestination(resolved) || await tryGeocode(destinationLabel);
      if (!destination) {
        return json({
          error: "このリンクから目的地を読み取れませんでした。Googleマップで店・施設を開き、「共有」→「リンクをコピー」をやり直してください",
        }, 422);
      }
      points = [await geocode(startInput), destination];
      placeNames = [startInput, destination.name || destinationLabel];
    }
    points = deduplicate(points);
    if (points.length < 2) {
      return json({ error: "このリンクは店・施設など場所だけのリンクです。画面の「出発地」を入力して、もう一度ルートを確認してください" }, 422);
    }
    if (points.length > 10) return json({ error: "経由地は8か所以内にしてください" }, 422);

    const coordinates = points.map((point) => `${point.lon},${point.lat}`).join(";");
    const routeResponse = await fetchWithTimeout(
      `https://router.project-osrm.org/route/v1/driving/${coordinates}?overview=full&geometries=geojson&steps=false`,
      { headers: { "User-Agent": "AMBR-Ride-App/1.0 (GitHub Pages)" } },
      15000,
    );
    if (!routeResponse.ok) throw new Error("道路ルートを作成できませんでした。少し待ってからもう一度お試しください");
    const routeData = await routeResponse.json();
    const route = routeData?.routes?.[0];
    const routeCoordinates = route?.geometry?.coordinates;
    if (routeData?.code !== "Ok" || !Array.isArray(routeCoordinates) || routeCoordinates.length < 2) {
      throw new Error("この出発地・目的地では道路ルートを作成できませんでした");
    }

    const names = placeNames.length >= 2 ? placeNames : points.map((point) => point.name);
    const routeName = `${names[0] || "出発地"} → ${names.at(-1) || "目的地"}`.slice(0, 80);
    const trackPoints = routeCoordinates.map(([lon, lat]: [number, number]) =>
      `<trkpt lat="${Number(lat).toFixed(6)}" lon="${Number(lon).toFixed(6)}"></trkpt>`
    ).join("");
    const gpx = `<?xml version="1.0" encoding="UTF-8"?><gpx version="1.1" creator="AMBR" xmlns="http://www.topografix.com/GPX/1/1"><metadata><name>${escapeXml(routeName)}</name><link href="${escapeXml(resolved.toString())}"><text>Googleマップ共有リンク</text></link><desc>共有地点をもとにAMBRで再計算した予定ルート</desc></metadata><trk><name>${escapeXml(routeName)}</name><trkseg>${trackPoints}</trkseg></trk></gpx>`;

    return json({
      gpx,
      routeName,
      distanceKm: Number(route.distance) / 1000,
      durationMinutes: Math.round(Number(route.duration) / 60),
      pointsCount: routeCoordinates.length,
      resolvedUrl: resolved.toString(),
      source: "google-maps-plan",
    });
  } catch (error) {
    const message = error instanceof Error && error.name === "AbortError"
      ? "経路の読み込みがタイムアウトしました。通信状態を確認してください"
      : error instanceof Error ? error.message : "経路を読み込めませんでした";
    return json({ error: message }, 500);
  }
});
