// ─── Market Data Service ───
// Holt OHLCV-Daten via Cloudflare-Proxy (Yahoo Finance) und cached in IndexedDB.

const PROXY_BASE = "https://ncapital-market-proxy.nils-noeller.workers.dev";

const DB_NAME = "ncapital-market-cache";
const DB_VERSION = 1;
const STORE_NAME = "ohlcv";
const CACHE_TTL_MS = 4 * 60 * 60 * 1000; // 4 Stunden

// ─── IndexedDB Helpers ───

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "cacheKey" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function getCached(cacheKey) {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(cacheKey);
      req.onsuccess = () => {
        const entry = req.result;
        if (entry && Date.now() - entry.timestamp < CACHE_TTL_MS) {
          resolve({ data: entry.data, timestamp: entry.timestamp, stale: false });
        } else if (entry) {
          // Abgelaufen, aber als Offline-Fallback nutzbar
          resolve({ data: entry.data, timestamp: entry.timestamp, stale: true });
        } else {
          resolve(null);
        }
      };
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

async function setCache(cacheKey, data) {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    store.put({ cacheKey, data, timestamp: Date.now() });
    await new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // Cache-Fehler sind nicht kritisch
  }
}

// ─── Yahoo Finance Response Parser ───

function parseYahooResponse(json) {
  const result = json?.chart?.result?.[0];
  if (!result || !result.timestamp) {
    throw new Error("Ungueltige Yahoo Finance Response");
  }

  const timestamps = result.timestamp;
  const quote = result.indicators?.quote?.[0];
  if (!quote) throw new Error("Keine Kursdaten in Response");

  const candles = [];
  for (let i = 0; i < timestamps.length; i++) {
    const open = quote.open?.[i];
    const high = quote.high?.[i];
    const low = quote.low?.[i];
    const close = quote.close?.[i];
    const volume = quote.volume?.[i];

    // Null-Eintraege ueberspringen (Feiertage etc.)
    if (close == null || open == null) continue;

    candles.push({
      date: new Date(timestamps[i] * 1000),
      open: Math.round(open * 100) / 100,
      high: Math.round(high * 100) / 100,
      low: Math.round(low * 100) / 100,
      close: Math.round(close * 100) / 100,
      volume: volume || 0,
    });
  }

  return {
    candles,
    meta: {
      symbol: result.meta?.symbol,
      currency: result.meta?.currency,
      exchangeName: result.meta?.exchangeName,
      regularMarketPrice: result.meta?.regularMarketPrice,
    },
  };
}

// ─── Kern-Funktionen ───

/**
 * Holt OHLCV-Daten fuer ein Symbol.
 * @param {string} symbol - Ticker (z.B. "AAPL", "SAP.DE", "^GSPC")
 * @param {string} range - Zeitraum ("1y", "6mo", "2y", etc.)
 * @param {string} interval - Intervall ("1d", "1wk", etc.)
 * @returns {Promise<{candles: Array, meta: Object, stale: boolean}>}
 */
export async function fetchOHLCV(symbol, range = "1y", interval = "1d") {
  const cacheKey = `${symbol}:${range}:${interval}`;

  // 1. Cache pruefen
  const cached = await getCached(cacheKey);
  if (cached && !cached.stale) {
    return { ...cached.data, stale: false, cachedAt: cached.timestamp };
  }

  // 2. Von Proxy laden
  try {
    const url = `${PROXY_BASE}/api/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(15000) });

    if (!resp.ok) {
      throw new Error(`Proxy-Fehler: ${resp.status}`);
    }

    const json = await resp.json();
    if (json.error) {
      throw new Error(json.error);
    }

    const parsed = parseYahooResponse(json);
    await setCache(cacheKey, parsed);
    return { ...parsed, stale: false, cachedAt: Date.now() };
  } catch (fetchError) {
    // 3. Offline-Fallback: abgelaufenen Cache verwenden
    if (cached && cached.stale) {
      console.warn(`Verwende abgelaufenen Cache fuer ${symbol}:`, fetchError.message);
      return { ...cached.data, stale: true, cachedAt: cached.timestamp };
    }
    throw new Error(`Marktdaten fuer ${symbol} nicht verfuegbar: ${fetchError.message}`);
  }
}

/**
 * Holt Leitindex-Daten basierend auf der Waehrung.
 * USD → S&P 500 (^GSPC), EUR → DAX (^GDAXI)
 */
export async function fetchIndexData(currency) {
  const symbol = currency === "USD" ? "^GSPC" : "^GDAXI";
  const indexName = currency === "USD" ? "S&P 500" : "DAX";
  const result = await fetchOHLCV(symbol, "1y", "1d");
  return { ...result, indexName, indexSymbol: symbol };
}

/**
 * Generiert die Finviz-Chart-URL fuer ein Symbol.
 * Funktioniert nur fuer US-Aktien.
 */
export function getFinvizChartUrl(symbol) {
  // Finviz verwendet nur US-Ticker ohne Suffix
  const cleanSymbol = symbol.replace(/\.(DE|F|PA|L|AS|MI|MC|BR|VI|HE|CO|ST|OL)$/i, "");
  return `https://finviz.com/chart.ashx?t=${encodeURIComponent(cleanSymbol.toUpperCase())}&ty=c&ta=1&p=d&s=l`;
}

/**
 * Prueft ob ein Symbol wahrscheinlich auf Finviz verfuegbar ist.
 * Finviz hat nur US-Boersen (NYSE, NASDAQ, AMEX).
 */
export function isFinvizAvailable(symbol) {
  // Europaeische Suffixe → kein Finviz
  return !/\.(DE|F|PA|L|AS|MI|MC|BR|VI|HE|CO|ST|OL)$/i.test(symbol);
}
