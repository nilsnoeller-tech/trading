// ─── Watchlist Scanner ───
// Berechnet Swing- und Intraday-Scores fuer Symbole basierend auf technischen Indikatoren.

import { RSI, EMA, SMA, BollingerBands } from "technicalindicators";
import { fetchOHLCV } from "./marketData";

// ── Swing-Score (Daily Chart, Haltezeit 2-20 Tage) ──

export function computeSwingScore(candles) {
  if (!candles || candles.length < 60) {
    return { total: 0, factors: [], signals: [], error: "Zu wenig Daten" };
  }

  const closes = candles.map((c) => c.close);
  const factors = [];
  const signals = [];

  // 1. RSI (25%)
  const rsiValues = RSI.calculate({ values: closes, period: 14 });
  const rsi = rsiValues.length > 0 ? rsiValues[rsiValues.length - 1] : 50;
  let rsiScore;
  if (rsi >= 30 && rsi <= 45) { rsiScore = 100; signals.push(`RSI ${rsi.toFixed(0)} (Kaufzone)`); }
  else if (rsi > 45 && rsi <= 55) rsiScore = 60;
  else if (rsi < 30) { rsiScore = 40; signals.push(`RSI ${rsi.toFixed(0)} (ueberverkauft)`); }
  else if (rsi > 70) { rsiScore = 10; signals.push(`RSI ${rsi.toFixed(0)} (ueberkauft)`); }
  else rsiScore = 20;
  factors.push({ name: "RSI(14)", weight: 0.25, score: rsiScore, value: rsi.toFixed(1) });

  // 2. Support-Zone (20%) — Swing Lows nahe aktuellem Kurs
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
    const ema20 = EMA.calculate({ values: closes, period: 20 });
    const ema50 = EMA.calculate({ values: closes, period: 50 });
    const ema200 = EMA.calculate({ values: closes, period: 200 });
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
  const bbArr = BollingerBands.calculate({ period: 20, stdDev: 2, values: closes });
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

  // 5. Volumen (15%) — letzte Kerze vs. 20-Tage-Durchschnitt
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
  const ema50Arr = EMA.calculate({ values: closes, period: 50 });
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

// ── Intraday-Score (15min Chart, Haltezeit Stunden) ──

export function computeIntradayScore(intradayCandles, dailyCandles) {
  if (!intradayCandles || intradayCandles.length < 10) {
    return { total: 0, factors: [], signals: [], error: "Zu wenig Intraday-Daten" };
  }

  const factors = [];
  const signals = [];

  // 1. Volume-Spike (30%) — letzte 15min vs. Durchschnitt
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

  // 2. Gap (25%) — Differenz zwischen heutigem Open und gestrigem Close
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
  factors.push({ name: "Gap", weight: 0.25, score: gapScore, value: gapScore > 0 ? `${gapScore >= 70 ? "stark" : "schwach"}` : "kein" });

  // 3. Relative Staerke (20%) — Aktie vs. Daily-Change
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

  // 4. ATR-Breakout (15%) — Intraday-Range vs. ATR(14)
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

  // 5. VWAP-Naehe (10%) — Kurs nahe typischem Preis
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

// ── Einzelnes Symbol scannen ──

export async function scanSymbol(symbol, currency = "USD") {
  let yahooSymbol = symbol.toUpperCase();
  if (currency === "EUR" && !yahooSymbol.includes(".")) {
    yahooSymbol = `${yahooSymbol}.DE`;
  }

  const [dailyResult, intradayResult] = await Promise.all([
    fetchOHLCV(yahooSymbol, "1y", "1d").catch(() => null),
    fetchOHLCV(yahooSymbol, "5d", "15m").catch(() => null),
  ]);

  const dailyCandles = dailyResult?.candles || [];
  const intradayCandles = intradayResult?.candles || [];
  const meta = dailyResult?.meta || {};

  const swing = computeSwingScore(dailyCandles);
  const intraday = computeIntradayScore(intradayCandles, dailyCandles);

  const lastCandle = dailyCandles[dailyCandles.length - 1];
  const prevCandle = dailyCandles.length >= 2 ? dailyCandles[dailyCandles.length - 2] : null;
  const price = lastCandle?.close || meta.regularMarketPrice || 0;
  const change = prevCandle ? ((price - prevCandle.close) / prevCandle.close) * 100 : 0;
  const volume = lastCandle?.volume || 0;

  return {
    symbol: yahooSymbol,
    displaySymbol: symbol.toUpperCase(),
    name: meta.symbol || symbol.toUpperCase(),
    currency: meta.currency || currency,
    price,
    change,
    volume,
    swing,
    intraday,
    stale: dailyResult?.stale || false,
    timestamp: new Date(),
  };
}

// ── Ganze Watchlist scannen ──

export async function scanWatchlist(symbols, currency, onProgress) {
  const results = [];
  const batchSize = 5; // 5 parallel

  for (let i = 0; i < symbols.length; i += batchSize) {
    const batch = symbols.slice(i, i + batchSize);
    const batchResults = await Promise.all(
      batch.map((sym) => scanSymbol(sym, currency).catch((err) => ({
        symbol: sym.toUpperCase(),
        displaySymbol: sym.toUpperCase(),
        name: sym.toUpperCase(),
        currency,
        price: 0,
        change: 0,
        volume: 0,
        swing: { total: 0, factors: [], signals: [], error: err.message },
        intraday: { total: 0, factors: [], signals: [], error: err.message },
        stale: false,
        timestamp: new Date(),
      })))
    );
    results.push(...batchResults);
    if (onProgress) onProgress(Math.min(i + batchSize, symbols.length), symbols.length);
  }

  // Nach kombiniertem Score sortieren (Swing-gewichtet)
  results.sort((a, b) => {
    const scoreA = a.swing.total * 0.6 + a.intraday.total * 0.4;
    const scoreB = b.swing.total * 0.6 + b.intraday.total * 0.4;
    return scoreB - scoreA;
  });

  return results;
}
