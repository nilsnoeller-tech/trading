// ─── N-Capital Market Data Proxy (Cloudflare Worker) ───
// Leitet Yahoo Finance API-Anfragen weiter und setzt CORS-Header.
// Deployment: cd proxy && npx wrangler deploy

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};

const YAHOO_HOSTS = [
  "query1.finance.yahoo.com",
  "query2.finance.yahoo.com",
];

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

async function fetchFromYahoo(symbol, params) {
  const searchParams = new URLSearchParams(params);
  let lastError = null;

  for (const host of YAHOO_HOSTS) {
    try {
      const url = `https://${host}/v8/finance/chart/${encodeURIComponent(symbol)}?${searchParams.toString()}`;
      const resp = await fetch(url, {
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "application/json",
        },
      });

      if (resp.ok) {
        const body = await resp.text();
        return new Response(body, {
          status: 200,
          headers: {
            ...CORS_HEADERS,
            "Content-Type": "application/json",
            "Cache-Control": "public, max-age=300", // 5 min edge cache
          },
        });
      }
      lastError = `${host} returned ${resp.status}`;
    } catch (e) {
      lastError = `${host}: ${e.message}`;
    }
  }

  return new Response(JSON.stringify({ error: lastError }), {
    status: 502,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

export default {
  async fetch(request) {
    // CORS Preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if (request.method !== "GET") {
      return new Response("Method not allowed", {
        status: 405,
        headers: CORS_HEADERS,
      });
    }

    const url = new URL(request.url);

    // Route: /api/chart/{symbol}
    const match = url.pathname.match(/^\/api\/chart\/(.+)$/);
    if (!match) {
      return new Response(
        JSON.stringify({
          error: "Not found. Use /api/chart/{symbol}",
          example: "/api/chart/AAPL?range=1y&interval=1d",
        }),
        {
          status: 404,
          headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
        }
      );
    }

    const symbol = decodeURIComponent(match[1]);

    // Erlaubte Parameter weiterleiten
    const params = {};
    const range = url.searchParams.get("range");
    const interval = url.searchParams.get("interval");
    const period1 = url.searchParams.get("period1");
    const period2 = url.searchParams.get("period2");

    if (period1 && period2) {
      params.period1 = period1;
      params.period2 = period2;
    } else {
      params.range = range || "1y";
    }
    params.interval = interval || "1d";
    params.includeAdjustedClose = "true";

    return fetchFromYahoo(symbol, params);
  },
};
