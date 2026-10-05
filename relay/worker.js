// FreeRangeShows setlist relay.
// The setlist.fm key lives only in this Worker as the secret SETLIST_FM_API_KEY.
// It answers one thing: a setlist search, for pages on the allowed origins.

const ALLOWED_ORIGINS = new Set([
  "https://freerangeice.github.io",
  "http://127.0.0.1:8780",
]);
const PASS_PARAMS = ["artistName", "cityName", "date", "p"];

function cors(origin) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Accept",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function json(body, status, origin) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...(origin ? cors(origin) : {}) },
  });
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const allowed = ALLOWED_ORIGINS.has(origin);
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      if (!allowed) return new Response(null, { status: 403 });
      return new Response(null, { status: 204, headers: cors(origin) });
    }
    if (!allowed) return json({ error: "origin not allowed" }, 403, null);
    if (request.method !== "GET" || url.pathname !== "/setlists") {
      return json({ error: "not found" }, 404, origin);
    }
    if (!env.SETLIST_FM_API_KEY) return json({ error: "relay has no key" }, 500, origin);

    const out = new URLSearchParams();
    for (const name of PASS_PARAMS) {
      const value = (url.searchParams.get(name) || "").trim();
      if (!value) continue;
      if (value.length > 120) return json({ error: "too long: " + name }, 400, origin);
      out.set(name, value);
    }
    if (!out.get("artistName")) return json({ error: "artistName required" }, 400, origin);
    if (out.get("date") && !/^\d{2}-\d{2}-\d{4}$/.test(out.get("date"))) {
      return json({ error: "date must be dd-MM-yyyy" }, 400, origin);
    }
    if (out.get("p") && !/^\d{1,3}$/.test(out.get("p"))) return json({ error: "bad page" }, 400, origin);

    let upstream;
    try {
      upstream = await fetch("https://api.setlist.fm/rest/1.0/search/setlists?" + out.toString(), {
        headers: { Accept: "application/json", "x-api-key": env.SETLIST_FM_API_KEY },
      });
    } catch {
      return json({ error: "setlist.fm did not answer" }, 502, origin);
    }
    // setlist.fm answers 404 when a search has no results.
    if (upstream.status === 404) return json({ setlist: [] }, 200, origin);
    const text = await upstream.text();
    return new Response(text, {
      status: upstream.ok ? 200 : 502,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...cors(origin) },
    });
  },
};
