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

async function fetchYahooJSON(symbol, params) {
  const searchParams = new URLSearchParams(params);
  let lastError = null;

  for (const host of YAHOO_HOSTS) {
    try {
      const url = `https://${host}/v8/finance/chart/${encodeURIComponent(symbol)}?${searchParams.toString()}`;
      const resp = await fetch(url, {
        headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      });

      if (resp.ok) {
        return await resp.json();
      }
      lastError = `${host} returned ${resp.status}`;
    } catch (e) {
      lastError = `${host}: ${e.message}`;
    }
  }

  return { error: lastError };
}

function jsonResponse(data, status = 200, cacheSeconds = 300) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...CORS_HEADERS,
      "Content-Type": "application/json",
      "Cache-Control": `public, max-age=${cacheSeconds}`,
    },
  });
}

export default {
  async fetch(request) {
    // CORS Preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if (request.method !== "GET") {
      return new Response("Method not allowed", { status: 405, headers: CORS_HEADERS });
    }

    const url = new URL(request.url);

    // ── Route: /api/batch?symbols=AAPL,MSFT&range=1y&interval=1d ──
    if (url.pathname === "/api/batch") {
      const symbolsParam = url.searchParams.get("symbols");
      if (!symbolsParam) {
        return jsonResponse({ error: "Missing 'symbols' parameter" }, 400);
      }

      const symbols = symbolsParam.split(",").slice(0, 15); // Max 15 pro Request
      const range = url.searchParams.get("range") || "1y";
      const interval = url.searchParams.get("interval") || "1d";
      const params = { range, interval, includeAdjustedClose: "true" };

      // Alle parallel fetchen
      const results = await Promise.all(
        symbols.map(async (sym) => {
          const trimmed = sym.trim();
          if (!trimmed) return null;
          const json = await fetchYahooJSON(trimmed, params);
          if (json.error) return { symbol: trimmed, error: json.error };
          return { symbol: trimmed, data: json };
        })
      );

      return jsonResponse({ results: results.filter(Boolean) }, 200, 300);
    }

    // ── Route: /api/chart/{symbol} ──
    const match = url.pathname.match(/^\/api\/chart\/(.+)$/);
    if (!match) {
      return jsonResponse({
        error: "Not found. Use /api/chart/{symbol} or /api/batch?symbols=...",
        endpoints: [
          "/api/chart/AAPL?range=1y&interval=1d",
          "/api/batch?symbols=AAPL,MSFT,NVDA&range=1y&interval=1d",
        ],
      }, 404);
    }

    const symbol = decodeURIComponent(match[1]);
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

    const json = await fetchYahooJSON(symbol, params);
    if (json.error) {
      return jsonResponse({ error: json.error }, 502);
    }
    return jsonResponse(json, 200, 300);
  },
};
