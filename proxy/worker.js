// ─── N-Capital Market Data Proxy + Push Scanner (Cloudflare Worker) ───
// Routes: /api/chart, /api/batch, /api/push/*
// Cron: Scannt Watchlist alle 15 Min und sendet Web Push bei hohen Scores.
// Deployment: cd proxy && npx wrangler deploy

import { buildPushHTTPRequest } from "@pushforge/builder";

// ─── Constants & CORS ───

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};

const YAHOO_HOSTS = [
  "query1.finance.yahoo.com",
  "query2.finance.yahoo.com",
];

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

// ─── Yahoo Finance Fetch ───

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

// ─── Technical Indicators (pure math, no npm) ───

function calcSMA(values, period) {
  const result = [];
  for (let i = period - 1; i < values.length; i++) {
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += values[j];
    result.push(sum / period);
  }
  return result;
}

function calcEMA(values, period) {
  if (values.length < period) return [];
  const k = 2 / (period + 1);
  let sum = 0;
  for (let i = 0; i < period; i++) sum += values[i];
  const result = [sum / period];
  for (let i = period; i < values.length; i++) {
    result.push(values[i] * k + result[result.length - 1] * (1 - k));
  }
  return result;
}

function calcRSI(closes, period = 14) {
  if (closes.length < period + 1) return [];
  const changes = [];
  for (let i = 1; i < closes.length; i++) changes.push(closes[i] - closes[i - 1]);

  let gainSum = 0, lossSum = 0;
  for (let i = 0; i < period; i++) {
    if (changes[i] >= 0) gainSum += changes[i];
    else lossSum += Math.abs(changes[i]);
  }

  let avgGain = gainSum / period;
  let avgLoss = lossSum / period;
  const result = [];
  result.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss));

  for (let i = period; i < changes.length; i++) {
    const gain = changes[i] >= 0 ? changes[i] : 0;
    const loss = changes[i] < 0 ? Math.abs(changes[i]) : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    result.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss));
  }
  return result;
}

function calcBollingerBands(closes, period = 20, stdDev = 2) {
  const result = [];
  for (let i = period - 1; i < closes.length; i++) {
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += closes[j];
    const mean = sum / period;
    let sqSum = 0;
    for (let j = i - period + 1; j <= i; j++) sqSum += (closes[j] - mean) ** 2;
    const sigma = Math.sqrt(sqSum / period);
    result.push({ upper: mean + stdDev * sigma, middle: mean, lower: mean - stdDev * sigma });
  }
  return result;
}

// ─── Scoring Functions (port from watchlistScanner.js) ───

function computeSwingScore(candles) {
  if (!candles || candles.length < 60) {
    return { total: 0, factors: [], signals: [], error: "Zu wenig Daten" };
  }

  const closes = candles.map((c) => c.close);
  const factors = [];
  const signals = [];

  // 1. RSI (25%)
  const rsiValues = calcRSI(closes, 14);
  const rsi = rsiValues.length > 0 ? rsiValues[rsiValues.length - 1] : 50;
  let rsiScore;
  if (rsi >= 30 && rsi <= 45) { rsiScore = 100; signals.push(`RSI ${rsi.toFixed(0)} (Kaufzone)`); }
  else if (rsi > 45 && rsi <= 55) rsiScore = 60;
  else if (rsi < 30) { rsiScore = 40; signals.push(`RSI ${rsi.toFixed(0)} (ueberverkauft)`); }
  else if (rsi > 70) { rsiScore = 10; signals.push(`RSI ${rsi.toFixed(0)} (ueberkauft)`); }
  else rsiScore = 20;
  factors.push({ name: "RSI(14)", weight: 0.25, score: rsiScore, value: rsi.toFixed(1) });

  // 2. Support-Zone (20%)
  const currentPrice = closes[closes.length - 1];
  const tolerance = currentPrice * 0.03;
  let bounceCount = 0;
  for (let i = 2; i < candles.length - 2; i++) {
    const low = candles[i].low;
    if (low <= candles[i - 1].low && low <= candles[i - 2].low &&
        low <= candles[i + 1].low && low <= candles[i + 2].low) {
      if (low >= currentPrice - tolerance && low <= currentPrice + tolerance) {
        bounceCount++;
      }
    }
  }
  let supportScore;
  if (bounceCount >= 3) { supportScore = 100; signals.push(`${bounceCount} Swing-Lows als Support`); }
  else if (bounceCount === 2) supportScore = 70;
  else if (bounceCount === 1) supportScore = 40;
  else supportScore = 0;
  factors.push({ name: "Support", weight: 0.20, score: supportScore, value: `${bounceCount} Bounces` });

  // 3. EMA-Ordnung (15%)
  let emaScore = 50;
  if (closes.length >= 200) {
    const ema20 = calcEMA(closes, 20);
    const ema50 = calcEMA(closes, 50);
    const ema200 = calcEMA(closes, 200);
    if (ema20.length && ema50.length && ema200.length) {
      const e20 = ema20[ema20.length - 1];
      const e50 = ema50[ema50.length - 1];
      const e200 = ema200[ema200.length - 1];
      if (e20 > e50 && e50 > e200) { emaScore = 100; signals.push("EMA 20>50>200"); }
      else if (e20 > e200 || e50 > e200) emaScore = 60;
      else if (e200 > e50 && e50 > e20) emaScore = 0;
      else emaScore = 30;
    }
  }
  factors.push({ name: "EMA", weight: 0.15, score: emaScore, value: emaScore >= 80 ? "bullisch" : emaScore >= 40 ? "neutral" : "baerisch" });

  // 4. Bollinger Bands (15%)
  let bbScore = 30;
  const bbArr = calcBollingerBands(closes, 20, 2);
  if (bbArr.length > 0) {
    const bb = bbArr[bbArr.length - 1];
    const bandwidth = bb.upper - bb.lower;
    const relPos = bandwidth > 0 ? (currentPrice - bb.lower) / bandwidth : 0.5;
    if (currentPrice < bb.lower) { bbScore = 100; signals.push("Unter Bollinger Band"); }
    else if (relPos < 0.25) { bbScore = 70; signals.push("Nahe BB-Low"); }
    else if (relPos < 0.5) bbScore = 40;
    else bbScore = 15;
  }
  factors.push({ name: "BB", weight: 0.15, score: bbScore, value: bbScore >= 70 ? "ueberverkauft" : "neutral" });

  // 5. Volumen (15%)
  const recentVols = candles.slice(-20).map((c) => c.volume);
  const avgVol = recentVols.reduce((s, v) => s + v, 0) / recentVols.length;
  const lastVol = candles[candles.length - 1].volume;
  const volRatio = avgVol > 0 ? lastVol / avgVol : 1;
  let volScore;
  if (volRatio >= 2) { volScore = 100; signals.push(`Vol ${volRatio.toFixed(1)}x Avg`); }
  else if (volRatio >= 1.5) volScore = 70;
  else if (volRatio >= 1) volScore = 40;
  else volScore = 20;
  factors.push({ name: "Volumen", weight: 0.15, score: volScore, value: `${volRatio.toFixed(1)}x` });

  // 6. Trend-Slope (10%)
  let trendScore = 50;
  const ema50Arr = calcEMA(closes, 50);
  if (ema50Arr.length >= 10) {
    const slope = (ema50Arr[ema50Arr.length - 1] - ema50Arr[ema50Arr.length - 10]) / ema50Arr[ema50Arr.length - 10];
    if (slope > 0.03) trendScore = 100;
    else if (slope > 0.01) trendScore = 70;
    else if (slope > -0.01) trendScore = 40;
    else trendScore = 10;
  }
  factors.push({ name: "Trend", weight: 0.10, score: trendScore, value: trendScore >= 70 ? "aufwaerts" : trendScore >= 30 ? "seitwaerts" : "abwaerts" });

  const total = Math.round(factors.reduce((s, f) => s + f.score * f.weight, 0));
  return { total, factors, signals };
}

function computeIntradayScore(intradayCandles, dailyCandles) {
  if (!intradayCandles || intradayCandles.length < 10) {
    return { total: 0, factors: [], signals: [], error: "Zu wenig Intraday-Daten" };
  }

  const factors = [];
  const signals = [];

  // 1. Volume-Spike (30%)
  const vols = intradayCandles.map((c) => c.volume);
  const avgVol = vols.reduce((s, v) => s + v, 0) / vols.length;
  const lastVol = vols[vols.length - 1];
  const volRatio = avgVol > 0 ? lastVol / avgVol : 1;
  let volScore;
  if (volRatio >= 5) { volScore = 100; signals.push(`Vol-Spike ${volRatio.toFixed(1)}x`); }
  else if (volRatio >= 3) { volScore = 80; signals.push(`Vol ${volRatio.toFixed(1)}x Avg`); }
  else if (volRatio >= 2) volScore = 50;
  else volScore = 20;
  factors.push({ name: "Vol-Spike", weight: 0.30, score: volScore, value: `${volRatio.toFixed(1)}x` });

  // 2. Gap (25%)
  let gapScore = 0;
  if (dailyCandles && dailyCandles.length >= 2) {
    const todayOpen = dailyCandles[dailyCandles.length - 1].open;
    const yesterdayClose = dailyCandles[dailyCandles.length - 2].close;
    const gapPct = Math.abs((todayOpen - yesterdayClose) / yesterdayClose) * 100;
    if (gapPct >= 3) { gapScore = 100; signals.push(`Gap ${gapPct.toFixed(1)}%`); }
    else if (gapPct >= 2) { gapScore = 70; signals.push(`Gap ${gapPct.toFixed(1)}%`); }
    else if (gapPct >= 1) gapScore = 40;
    else gapScore = 0;
  }
  factors.push({ name: "Gap", weight: 0.25, score: gapScore, value: gapScore > 0 ? (gapScore >= 70 ? "stark" : "schwach") : "kein" });

  // 3. Relative Staerke (20%)
  let relScore = 30;
  if (dailyCandles && dailyCandles.length >= 2) {
    const last = dailyCandles[dailyCandles.length - 1];
    const prev = dailyCandles[dailyCandles.length - 2];
    const chg = ((last.close - prev.close) / prev.close) * 100;
    if (chg > 2) { relScore = 100; signals.push(`+${chg.toFixed(1)}% heute`); }
    else if (chg > 1) relScore = 70;
    else if (chg > 0) relScore = 40;
    else if (chg > -1) relScore = 20;
    else relScore = 0;
  }
  factors.push({ name: "Rel.Staerke", weight: 0.20, score: relScore, value: relScore >= 70 ? "stark" : "normal" });

  // 4. ATR-Breakout (15%)
  let atrScore = 30;
  if (dailyCandles && dailyCandles.length >= 15) {
    const atrValues = dailyCandles.slice(-15).map((c) => c.high - c.low);
    const atr = atrValues.reduce((s, v) => s + v, 0) / atrValues.length;
    const todayRange = dailyCandles[dailyCandles.length - 1].high - dailyCandles[dailyCandles.length - 1].low;
    const atrRatio = atr > 0 ? todayRange / atr : 1;
    if (atrRatio >= 2) { atrScore = 100; signals.push(`ATR-Breakout ${atrRatio.toFixed(1)}x`); }
    else if (atrRatio >= 1.5) atrScore = 70;
    else if (atrRatio >= 1) atrScore = 30;
    else atrScore = 10;
  }
  factors.push({ name: "ATR", weight: 0.15, score: atrScore, value: atrScore >= 70 ? "expansion" : "normal" });

  // 5. VWAP-Naehe (10%)
  const last = intradayCandles[intradayCandles.length - 1];
  const typicalPrices = intradayCandles.map((c) => (c.high + c.low + c.close) / 3);
  const totalVol = intradayCandles.reduce((s, c) => s + c.volume, 0);
  const vwap = totalVol > 0
    ? intradayCandles.reduce((s, c, i) => s + typicalPrices[i] * c.volume, 0) / totalVol
    : last.close;
  const vwapDist = Math.abs((last.close - vwap) / vwap) * 100;
  let vwapScore;
  if (vwapDist <= 0.5) { vwapScore = 100; signals.push("Nahe VWAP"); }
  else if (vwapDist <= 1) vwapScore = 60;
  else vwapScore = 20;
  factors.push({ name: "VWAP", weight: 0.10, score: vwapScore, value: `${vwapDist.toFixed(1)}% Dist.` });

  const total = Math.round(factors.reduce((s, f) => s + f.score * f.weight, 0));
  return { total, factors, signals };
}

// ─── Yahoo Response Parser ───

function parseYahooCandles(json) {
  try {
    const result = json?.chart?.result?.[0];
    if (!result) return null;
    const ts = result.timestamp || [];
    const q = result.indicators?.quote?.[0] || {};
    const candles = [];
    for (let i = 0; i < ts.length; i++) {
      if (q.close?.[i] != null) {
        candles.push({
          time: ts[i],
          open: q.open?.[i] ?? 0,
          high: q.high?.[i] ?? 0,
          low: q.low?.[i] ?? 0,
          close: q.close[i],
          volume: q.volume?.[i] ?? 0,
        });
      }
    }
    const meta = result.meta || {};
    return { candles, meta };
  } catch {
    return null;
  }
}

// ─── Server-Side Scanner ───

async function scanSymbolServer(symbol) {
  const [dailyJson, intradayJson] = await Promise.all([
    fetchYahooJSON(symbol, { range: "1y", interval: "1d", includeAdjustedClose: "true" }),
    fetchYahooJSON(symbol, { range: "5d", interval: "15m", includeAdjustedClose: "true" }),
  ]);

  const dailyData = !dailyJson.error ? parseYahooCandles(dailyJson) : null;
  const intradayData = !intradayJson.error ? parseYahooCandles(intradayJson) : null;

  const dailyCandles = dailyData?.candles || [];
  const intradayCandles = intradayData?.candles || [];
  const meta = dailyData?.meta || {};

  const swing = computeSwingScore(dailyCandles);
  const intraday = computeIntradayScore(intradayCandles, dailyCandles);

  const lastCandle = dailyCandles[dailyCandles.length - 1];
  const prevCandle = dailyCandles.length >= 2 ? dailyCandles[dailyCandles.length - 2] : null;
  const price = lastCandle?.close || meta.regularMarketPrice || 0;
  const change = prevCandle ? ((price - prevCandle.close) / prevCandle.close) * 100 : 0;

  // Display symbol: remove .DE suffix
  const displaySymbol = symbol.replace(/\.DE$/i, "");

  return {
    symbol,
    displaySymbol,
    name: meta.symbol || symbol,
    currency: meta.currency || "USD",
    price,
    change,
    swing,
    intraday,
    timestamp: new Date().toISOString(),
  };
}

// ─── Web Push Sending ───

async function sendPush(subscription, payload, env) {
  try {
    const privateJWK = JSON.parse(env.VAPID_PRIVATE_JWK);

    const { headers, body, endpoint } = await buildPushHTTPRequest({
      privateJWK,
      subscription,
      message: {
        payload,
        adminContact: "mailto:nils@ncapital.app",
        options: { ttl: 3600 },
      },
    });

    const resp = await fetch(endpoint, { method: "POST", headers, body });

    // 404/410 = subscription expired
    if (resp.status === 404 || resp.status === 410) {
      return { sent: false, expired: true, endpoint: subscription.endpoint };
    }

    return { sent: resp.ok, status: resp.status };
  } catch (e) {
    return { sent: false, error: e.message };
  }
}

// ─── Cron Scanner ───

async function runCronScan(env) {
  // Read KV state
  const [subscriptions, symbolsJson, thresholdsJson] = await Promise.all([
    env.NCAPITAL_KV.get("push:subscriptions", "json"),
    env.NCAPITAL_KV.get("watchlist:symbols", "json"),
    env.NCAPITAL_KV.get("watchlist:thresholds", "json"),
  ]);

  if (!subscriptions || subscriptions.length === 0 || !symbolsJson || symbolsJson.length === 0) {
    return { skipped: true, reason: "No subscriptions or symbols" };
  }

  const symbols = symbolsJson;
  const thresholds = thresholdsJson || { swing: 70, intraday: 75 };
  const results = [];
  const notifications = [];

  // Scan in batches of 5
  for (let i = 0; i < symbols.length; i += 5) {
    const batch = symbols.slice(i, i + 5);
    const batchResults = await Promise.all(
      batch.map((sym) => scanSymbolServer(sym).catch((err) => ({
        symbol: sym, displaySymbol: sym.replace(/\.DE$/i, ""), name: sym,
        currency: "USD", price: 0, change: 0,
        swing: { total: 0, factors: [], signals: [], error: err.message },
        intraday: { total: 0, factors: [], signals: [], error: err.message },
        timestamp: new Date().toISOString(),
      })))
    );
    results.push(...batchResults);
  }

  // Check thresholds + cooldowns, send notifications
  for (const r of results) {
    let shouldNotify = false;
    let title = "";
    let body = "";
    let tag = "";

    if (r.swing.total >= thresholds.swing) {
      const topSignals = r.swing.signals.slice(0, 3).join(" + ");
      title = `${r.displaySymbol} Swing-Setup (${r.swing.total})`;
      body = `${r.price.toFixed(2)} ${r.currency} — ${topSignals || "Starkes Signal"}`;
      tag = `swing-${r.displaySymbol}`;
      shouldNotify = true;
    } else if (r.intraday.total >= thresholds.intraday) {
      const topSignals = r.intraday.signals.slice(0, 3).join(" + ");
      title = `${r.displaySymbol} Intraday (${r.intraday.total})`;
      body = `${r.price.toFixed(2)} ${r.currency} — ${topSignals || "Starkes Signal"}`;
      tag = `intraday-${r.displaySymbol}`;
      shouldNotify = true;
    }

    if (shouldNotify) {
      // Check cooldown
      const cooldownKey = `cooldown:${r.displaySymbol}`;
      const cooldown = await env.NCAPITAL_KV.get(cooldownKey);
      if (cooldown) continue; // Still in cooldown

      // Send to ALL devices
      let anySent = false;
      for (const sub of subscriptions) {
        const pushResult = await sendPush(sub, { title, body, tag, url: "/ncapital-app/" }, env);
        if (pushResult.sent) anySent = true;
      }
      if (anySent) {
        // Set 1h cooldown
        await env.NCAPITAL_KV.put(cooldownKey, new Date().toISOString(), { expirationTtl: 3600 });
        notifications.push({ symbol: r.displaySymbol, title, body });
      }
    }
  }

  // Save results + timestamp
  await Promise.all([
    env.NCAPITAL_KV.put("scan:lastResults", JSON.stringify(results)),
    env.NCAPITAL_KV.put("scan:lastRun", new Date().toISOString()),
  ]);

  return { scanned: results.length, notifications: notifications.length, results: notifications };
}

// ─── HTTP Route Handlers ───

// Migrate old single subscription to array format
async function migrateSubscriptions(env) {
  const oldSub = await env.NCAPITAL_KV.get("push:subscription", "json");
  if (oldSub) {
    const existing = (await env.NCAPITAL_KV.get("push:subscriptions", "json")) || [];
    if (!existing.some(s => s.endpoint === oldSub.endpoint)) {
      existing.push(oldSub);
      await env.NCAPITAL_KV.put("push:subscriptions", JSON.stringify(existing));
    }
    await env.NCAPITAL_KV.delete("push:subscription");
  }
}

async function handlePushRoutes(url, request, env) {
  const path = url.pathname;

  // One-time migration from single to multi subscription
  await migrateSubscriptions(env);

  // GET /api/push/vapid-public-key
  if (path === "/api/push/vapid-public-key" && request.method === "GET") {
    return jsonResponse({ key: env.VAPID_PUBLIC_KEY }, 200, 86400);
  }

  // GET /api/push/status
  if (path === "/api/push/status" && request.method === "GET") {
    const [subs, lastRun, lastResults] = await Promise.all([
      env.NCAPITAL_KV.get("push:subscriptions", "json"),
      env.NCAPITAL_KV.get("scan:lastRun"),
      env.NCAPITAL_KV.get("scan:lastResults", "json"),
    ]);
    return jsonResponse({
      subscribed: !!(subs && subs.length > 0),
      deviceCount: subs ? subs.length : 0,
      lastRun,
      resultCount: lastResults?.length || 0,
      results: lastResults || [],
    }, 200, 0);
  }

  // POST routes need body parsing
  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  // POST /api/push/subscribe — adds device to subscriptions array
  if (path === "/api/push/subscribe") {
    if (!body.subscription) {
      return jsonResponse({ error: "Missing subscription" }, 400);
    }
    // Load existing subscriptions
    const existing = (await env.NCAPITAL_KV.get("push:subscriptions", "json")) || [];
    // Deduplicate by endpoint
    const filtered = existing.filter(s => s.endpoint !== body.subscription.endpoint);
    filtered.push(body.subscription);
    await env.NCAPITAL_KV.put("push:subscriptions", JSON.stringify(filtered));
    // Optionally save watchlist + thresholds too
    if (body.symbols) {
      await env.NCAPITAL_KV.put("watchlist:symbols", JSON.stringify(body.symbols));
    }
    if (body.thresholds) {
      await env.NCAPITAL_KV.put("watchlist:thresholds", JSON.stringify(body.thresholds));
    }
    return jsonResponse({ ok: true, message: "Subscription saved", deviceCount: filtered.length });
  }

  // POST /api/push/unsubscribe — removes one device by endpoint
  if (path === "/api/push/unsubscribe") {
    const endpoint = body.endpoint;
    if (endpoint) {
      const existing = (await env.NCAPITAL_KV.get("push:subscriptions", "json")) || [];
      const filtered = existing.filter(s => s.endpoint !== endpoint);
      await env.NCAPITAL_KV.put("push:subscriptions", JSON.stringify(filtered));
      return jsonResponse({ ok: true, message: "Device removed", deviceCount: filtered.length });
    }
    // Fallback: remove all
    await env.NCAPITAL_KV.put("push:subscriptions", "[]");
    return jsonResponse({ ok: true, message: "All subscriptions removed" });
  }

  // POST /api/push/watchlist
  if (path === "/api/push/watchlist") {
    if (!body.symbols) {
      return jsonResponse({ error: "Missing symbols" }, 400);
    }
    await env.NCAPITAL_KV.put("watchlist:symbols", JSON.stringify(body.symbols));
    if (body.thresholds) {
      await env.NCAPITAL_KV.put("watchlist:thresholds", JSON.stringify(body.thresholds));
    }
    return jsonResponse({ ok: true, symbols: body.symbols.length });
  }

  // POST /api/push/test — sends test push to ALL devices
  if (path === "/api/push/test") {
    const subs = (await env.NCAPITAL_KV.get("push:subscriptions", "json")) || [];
    if (subs.length === 0) {
      return jsonResponse({ error: "No push subscriptions found" }, 404);
    }
    const results = [];
    const validSubs = [];
    for (const sub of subs) {
      const result = await sendPush(sub, {
        title: "N-Capital Test",
        body: `Push-Benachrichtigungen funktionieren! (${subs.length} Gerät${subs.length > 1 ? "e" : ""})`,
        tag: "test",
        url: "/ncapital-app/",
      }, env);
      results.push(result);
      if (!result.expired) validSubs.push(sub);
    }
    // Remove expired subscriptions
    if (validSubs.length < subs.length) {
      await env.NCAPITAL_KV.put("push:subscriptions", JSON.stringify(validSubs));
    }
    return jsonResponse({ sent: results.some(r => r.sent), devices: results.length, results });
  }

  return null; // Not a push route
}

// ─── Export: fetch + scheduled ───

export default {
  async fetch(request, env) {
    // CORS Preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const url = new URL(request.url);

    // ── Push Routes ──
    if (url.pathname.startsWith("/api/push/")) {
      const resp = await handlePushRoutes(url, request, env);
      if (resp) return resp;
      return jsonResponse({ error: "Unknown push endpoint" }, 404);
    }

    // ── Existing GET-only routes ──
    if (request.method !== "GET") {
      return new Response("Method not allowed", { status: 405, headers: CORS_HEADERS });
    }

    // ── Route: /api/batch?symbols=AAPL,MSFT&range=1y&interval=1d ──
    if (url.pathname === "/api/batch") {
      const symbolsParam = url.searchParams.get("symbols");
      if (!symbolsParam) {
        return jsonResponse({ error: "Missing 'symbols' parameter" }, 400);
      }

      const symbols = symbolsParam.split(",").slice(0, 15);
      const range = url.searchParams.get("range") || "1y";
      const interval = url.searchParams.get("interval") || "1d";
      const params = { range, interval, includeAdjustedClose: "true" };

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
        error: "Not found. Use /api/chart/{symbol}, /api/batch, or /api/push/*",
        endpoints: [
          "/api/chart/AAPL?range=1y&interval=1d",
          "/api/batch?symbols=AAPL,MSFT,NVDA&range=1y&interval=1d",
          "/api/push/vapid-public-key",
          "/api/push/status",
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

  async scheduled(event, env, ctx) {
    ctx.waitUntil(runCronScan(env));
  },
};
