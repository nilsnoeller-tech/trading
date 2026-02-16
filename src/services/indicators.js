// ─── Technische Indikator-Berechnungen fuer Auto-Scoring ───
// Jede Funktion gibt zurueck: { optionIndex, confidence, detail, rawValue }
// optionIndex = welche Antwort-Option vorausgewaehlt wird (0-basiert)

import { RSI, EMA, SMA, BollingerBands } from "technicalindicators";

// ══════════════════════════════════════════════════════════════
// Q1: Unterstuetzungszone (Support Zone Detection)
// ══════════════════════════════════════════════════════════════

export function detectSupportZone(candles, entryPrice, tolerancePct = 0.02) {
  if (!candles || candles.length < 20 || !entryPrice) {
    return { optionIndex: 0, confidence: 0, detail: "Nicht genug Daten", rawValue: null };
  }

  const tolerance = entryPrice * tolerancePct;
  const lowerBound = entryPrice - tolerance;
  const upperBound = entryPrice + tolerance;

  // Swing Lows finden (5-Bar-Fenster: low[i] ist tiefer als 2 davor und 2 danach)
  const swingLows = [];
  for (let i = 2; i < candles.length - 2; i++) {
    const low = candles[i].low;
    if (
      low <= candles[i - 1].low &&
      low <= candles[i - 2].low &&
      low <= candles[i + 1].low &&
      low <= candles[i + 2].low
    ) {
      swingLows.push({ index: i, price: low, date: candles[i].date });
    }
  }

  // Bounces im Einstiegsbereich zaehlen
  const bouncesAtLevel = swingLows.filter(
    (sl) => sl.price >= lowerBound && sl.price <= upperBound
  );

  // Zusaetzlich: Lange untere Dochte im Bereich (Kaufdruck-Signal)
  const longWicks = candles.filter((c) => {
    const bodySize = Math.abs(c.close - c.open);
    const lowerWick = Math.min(c.open, c.close) - c.low;
    return (
      c.low >= lowerBound &&
      c.low <= upperBound &&
      lowerWick > bodySize * 1.5
    );
  });

  const bounceCount = bouncesAtLevel.length;
  const hasWickConfirmation = longWicks.length >= 2;

  let optionIndex, confidence;
  if (bounceCount >= 3 || (bounceCount >= 2 && hasWickConfirmation)) {
    optionIndex = 3; // Starke Zone + Kaufdruck
    confidence = Math.min(0.95, 0.7 + bounceCount * 0.08);
  } else if (bounceCount >= 2) {
    optionIndex = 2; // Klare Unterstuetzung
    confidence = 0.75;
  } else if (bounceCount === 1) {
    optionIndex = 1; // Schwache Zone
    confidence = 0.6;
  } else {
    optionIndex = 0; // Keine Unterstuetzung
    confidence = 0.7;
  }

  const detail =
    bounceCount > 0
      ? `${bounceCount} Swing-Low(s) im Bereich ${lowerBound.toFixed(2)}–${upperBound.toFixed(2)}${hasWickConfirmation ? " + Docht-Signale" : ""}`
      : `Keine Swing-Lows im ±${(tolerancePct * 100).toFixed(0)}% Bereich`;

  return { optionIndex, confidence, detail, rawValue: bounceCount };
}

// ══════════════════════════════════════════════════════════════
// Q2: Volumen-Profil am Level
// ══════════════════════════════════════════════════════════════

export function analyzeVolumeProfile(candles, entryPrice, numBins = 50) {
  if (!candles || candles.length < 20 || !entryPrice) {
    return { optionIndex: 0, confidence: 0, detail: "Nicht genug Daten", rawValue: null };
  }

  // Preis-Range bestimmen
  let minPrice = Infinity, maxPrice = -Infinity;
  for (const c of candles) {
    if (c.low < minPrice) minPrice = c.low;
    if (c.high > maxPrice) maxPrice = c.high;
  }

  const priceRange = maxPrice - minPrice;
  if (priceRange <= 0) {
    return { optionIndex: 0, confidence: 0, detail: "Kein Preisbereich", rawValue: null };
  }

  const binSize = priceRange / numBins;

  // Volume-by-Price Histogram aufbauen
  const bins = new Array(numBins).fill(0);
  for (const c of candles) {
    const candleRange = c.high - c.low || binSize;
    const binsSpanned = Math.max(1, Math.ceil(candleRange / binSize));
    const volPerBin = c.volume / binsSpanned;

    for (let b = 0; b < numBins; b++) {
      const binLow = minPrice + b * binSize;
      const binHigh = binLow + binSize;
      // Ueberlappung pruefen
      if (c.low <= binHigh && c.high >= binLow) {
        bins[b] += volPerBin;
      }
    }
  }

  // POC (Point of Control) finden
  let pocBin = 0, maxVol = 0;
  for (let b = 0; b < numBins; b++) {
    if (bins[b] > maxVol) {
      maxVol = bins[b];
      pocBin = b;
    }
  }
  const pocPrice = minPrice + (pocBin + 0.5) * binSize;

  // Entry-Bin finden
  const entryBin = Math.min(numBins - 1, Math.max(0, Math.floor((entryPrice - minPrice) / binSize)));
  const entryVol = bins[entryBin];

  // Durchschnittsvolumen berechnen
  const avgVol = bins.reduce((s, v) => s + v, 0) / numBins;

  // POC-Naehe pruefen (Entry innerhalb ±1 Bin vom POC)
  const nearPOC = Math.abs(entryBin - pocBin) <= 1;

  // Scoring
  let optionIndex, confidence;
  const ratio = avgVol > 0 ? entryVol / avgVol : 0;

  if (nearPOC) {
    optionIndex = 3; // POC / VPOC nahe Einstieg
    confidence = 0.85;
  } else if (ratio >= 1.5) {
    optionIndex = 2; // Deutlicher Volumen-Cluster
    confidence = 0.75;
  } else if (ratio >= 0.8) {
    optionIndex = 1; // Moderate Aktivitaet
    confidence = 0.65;
  } else {
    optionIndex = 0; // Kaum Volumen
    confidence = 0.7;
  }

  const detail = nearPOC
    ? `POC bei ${pocPrice.toFixed(2)} (nahe Einstieg) · Vol-Ratio: ${ratio.toFixed(1)}x`
    : `Vol am Level: ${ratio.toFixed(1)}x Durchschnitt · POC bei ${pocPrice.toFixed(2)}`;

  return { optionIndex, confidence, detail, rawValue: Math.round(ratio * 100) / 100 };
}

// ══════════════════════════════════════════════════════════════
// Q3: Kerzen-Signal (Candlestick Pattern Detection)
// ══════════════════════════════════════════════════════════════

// Eigene Pattern-Erkennung (leichtgewichtig, ohne technicalindicators-Candlestick-Modul)
function isHammer(c) {
  const body = Math.abs(c.close - c.open);
  const lowerWick = Math.min(c.open, c.close) - c.low;
  const totalRange = c.high - c.low;
  const upperWickSmall = (c.high - Math.max(c.open, c.close)) <= body * 0.5;
  return totalRange > 0 && lowerWick >= body * 2 && upperWickSmall;
}

function isBullishEngulfing(prev, curr) {
  const prevBearish = prev.close < prev.open;
  const currBullish = curr.close > curr.open;
  return prevBearish && currBullish && curr.open <= prev.close && curr.close >= prev.open;
}

function isDoji(c) {
  const body = Math.abs(c.close - c.open);
  const totalRange = c.high - c.low;
  return totalRange > 0 && body / totalRange < 0.1;
}

function isPinBar(c) {
  const body = Math.abs(c.close - c.open);
  const lowerWick = Math.min(c.open, c.close) - c.low;
  const totalRange = c.high - c.low;
  // Bullisher Pin Bar: langer unterer Docht, kleiner Koerper
  return totalRange > 0 && lowerWick >= totalRange * 0.6 && body <= totalRange * 0.25;
}

function isMorningStar(c1, c2, c3) {
  // c1 = bearish, c2 = kleiner Body (Star), c3 = bullish
  const c1Bear = c1.close < c1.open;
  const c2Small = Math.abs(c2.close - c2.open) < Math.abs(c1.close - c1.open) * 0.3;
  const c3Bull = c3.close > c3.open && c3.close > (c1.open + c1.close) / 2;
  return c1Bear && c2Small && c3Bull;
}

export function detectCandlePattern(candles) {
  if (!candles || candles.length < 5) {
    return { optionIndex: 0, confidence: 0, detail: "Nicht genug Kerzen", rawValue: null };
  }

  const last = candles.slice(-5);
  const curr = last[4]; // Letzte Kerze
  const prev = last[3]; // Vorletzte

  // Pattern-Erkennung (Prioritaet: staerkstes zuerst)
  let pattern = "none";
  let confirmed = false;

  // Pruefen ob Pattern auf vorvorletzter Kerze + Bestaetigung
  if (isBullishEngulfing(last[2], last[3]) && curr.close > last[3].close) {
    pattern = "engulfing";
    confirmed = true;
  } else if (isMorningStar(last[1], last[2], last[3]) && curr.close > last[3].close) {
    pattern = "morningstar";
    confirmed = true;
  } else if (isHammer(prev) && curr.close > prev.close) {
    pattern = "hammer";
    confirmed = true;
  } else if (isPinBar(prev) && curr.close > prev.close) {
    pattern = "pinbar";
    confirmed = true;
  }
  // Patterns auf letzter Kerze (noch nicht bestaetigt)
  else if (isBullishEngulfing(prev, curr)) {
    pattern = "engulfing";
    confirmed = false;
  } else if (isHammer(curr)) {
    pattern = "hammer";
    confirmed = false;
  } else if (isPinBar(curr)) {
    pattern = "pinbar";
    confirmed = false;
  } else if (isDoji(curr)) {
    pattern = "doji";
    confirmed = false;
  }

  // Scoring
  const patternNames = {
    none: "Keine erkennbare Formation",
    doji: "Doji",
    hammer: "Hammer",
    pinbar: "Pin Bar",
    engulfing: "Bullish Engulfing",
    morningstar: "Morning Star",
  };

  let optionIndex, confidence;
  if (confirmed && ["engulfing", "morningstar"].includes(pattern)) {
    optionIndex = 3; // Formation + Folgekerze bestaetigt
    confidence = 0.85;
  } else if (confirmed || ["hammer", "pinbar", "engulfing"].includes(pattern)) {
    optionIndex = 2; // Hammer / Pin Bar / Engulfing
    confidence = confirmed ? 0.8 : 0.65;
  } else if (pattern === "doji") {
    optionIndex = 1; // Doji / schwache Andeutung
    confidence = 0.6;
  } else {
    optionIndex = 0; // Keine Formation
    confidence = 0.7;
  }

  const detail = pattern !== "none"
    ? `${patternNames[pattern]}${confirmed ? " (bestaetigt durch Folgekerze)" : " (noch unbestaetigt)"}`
    : "Keine Umkehr-Formation in den letzten 5 Kerzen";

  return { optionIndex, confidence, detail, rawValue: pattern };
}

// ══════════════════════════════════════════════════════════════
// Q4: Trend & Struktur
// ══════════════════════════════════════════════════════════════

export function analyzeTrend(candles) {
  if (!candles || candles.length < 60) {
    return { optionIndex: 1, confidence: 0.3, detail: "Nicht genug Daten fuer Trendanalyse", rawValue: null };
  }

  const recent = candles.slice(-60);

  // Swing Highs und Lows finden (3-Bar-Fenster)
  const swingHighs = [];
  const swingLows = [];

  for (let i = 2; i < recent.length - 2; i++) {
    if (recent[i].high >= recent[i - 1].high && recent[i].high >= recent[i - 2].high &&
        recent[i].high >= recent[i + 1].high && recent[i].high >= recent[i + 2].high) {
      swingHighs.push(recent[i].high);
    }
    if (recent[i].low <= recent[i - 1].low && recent[i].low <= recent[i - 2].low &&
        recent[i].low <= recent[i + 1].low && recent[i].low <= recent[i + 2].low) {
      swingLows.push(recent[i].low);
    }
  }

  // EMA(20) Slope als zusaetzlicher Trendindikator
  const closes = recent.map((c) => c.close);
  const ema20 = EMA.calculate({ values: closes, period: 20 });
  const emaSlope =
    ema20.length >= 10
      ? (ema20[ema20.length - 1] - ema20[ema20.length - 10]) / ema20[ema20.length - 10]
      : 0;

  // Higher Highs / Higher Lows pruefen
  let higherHighs = 0, lowerHighs = 0;
  for (let i = 1; i < swingHighs.length; i++) {
    if (swingHighs[i] > swingHighs[i - 1]) higherHighs++;
    else lowerHighs++;
  }

  let higherLows = 0, lowerLows = 0;
  for (let i = 1; i < swingLows.length; i++) {
    if (swingLows[i] > swingLows[i - 1]) higherLows++;
    else lowerLows++;
  }

  // Trend bestimmen
  const totalSwings = Math.max(1, higherHighs + lowerHighs + higherLows + lowerLows);
  const bullishRatio = (higherHighs + higherLows) / totalSwings;
  const bearishRatio = (lowerHighs + lowerLows) / totalSwings;

  let optionIndex, confidence, trendLabel;

  if (bearishRatio > 0.7 && emaSlope < -0.02) {
    optionIndex = 0; // Klarer Abwaertstrend
    confidence = 0.8;
    trendLabel = "Abwaertstrend";
  } else if (bullishRatio < 0.4 && bearishRatio < 0.4) {
    optionIndex = 1; // Seitwaerts
    confidence = 0.65;
    trendLabel = "Seitwaerts";
  } else if (bullishRatio > 0.5 && emaSlope > 0) {
    optionIndex = 2; // Leichter Aufwaertstrend
    confidence = 0.7;
    trendLabel = "leicht bullisch";
  } else if (bullishRatio > 0.7 && emaSlope > 0.02) {
    optionIndex = 3; // Klarer Aufwaertstrend
    confidence = 0.85;
    trendLabel = "klar bullisch";
  } else if (bullishRatio > 0.5) {
    optionIndex = 2;
    confidence = 0.6;
    trendLabel = "leicht bullisch";
  } else {
    optionIndex = 1;
    confidence = 0.5;
    trendLabel = "unklar";
  }

  const detail = `Trend: ${trendLabel} · HH:${higherHighs} HL:${higherLows} LH:${lowerHighs} LL:${lowerLows} · EMA-Slope: ${(emaSlope * 100).toFixed(1)}%`;

  return { optionIndex, confidence, detail, rawValue: Math.round(bullishRatio * 100) };
}

// ══════════════════════════════════════════════════════════════
// Q5: RSI & Momentum
// ══════════════════════════════════════════════════════════════

function detectBullishDivergence(candles, rsiValues) {
  // Pruefe ob Kurs tieferes Tief macht, RSI aber hoeheres Tief (letzte 20 Bars)
  if (rsiValues.length < 20 || candles.length < 20) return false;

  const lookback = 20;
  const recentCandles = candles.slice(-lookback);
  const recentRSI = rsiValues.slice(-lookback);

  // Tiefpunkte in Kurs und RSI finden
  let priceLow1 = Infinity, priceLow2 = Infinity;
  let rsiLow1 = Infinity, rsiLow2 = Infinity;

  // Erstes Tief (erste Haelfte)
  for (let i = 0; i < Math.floor(lookback / 2); i++) {
    if (recentCandles[i].low < priceLow1) {
      priceLow1 = recentCandles[i].low;
      rsiLow1 = recentRSI[i];
    }
  }

  // Zweites Tief (zweite Haelfte)
  for (let i = Math.floor(lookback / 2); i < lookback; i++) {
    if (recentCandles[i].low < priceLow2) {
      priceLow2 = recentCandles[i].low;
      rsiLow2 = recentRSI[i];
    }
  }

  // Bullische Divergenz: Kurs macht tieferes Tief, RSI hoeheres Tief
  return priceLow2 < priceLow1 && rsiLow2 > rsiLow1;
}

export function computeRSI(candles) {
  if (!candles || candles.length < 30) {
    return { optionIndex: 1, confidence: 0.3, detail: "Nicht genug Daten fuer RSI", rawValue: null };
  }

  const closes = candles.map((c) => c.close);
  const rsiValues = RSI.calculate({ values: closes, period: 14 });

  if (rsiValues.length === 0) {
    return { optionIndex: 1, confidence: 0.3, detail: "RSI konnte nicht berechnet werden", rawValue: null };
  }

  const currentRSI = rsiValues[rsiValues.length - 1];
  const hasDivergence = detectBullishDivergence(candles, rsiValues);

  let optionIndex, confidence;

  if (currentRSI < 40 && hasDivergence) {
    optionIndex = 3; // RSI <40 + bullische Divergenz
    confidence = 0.9;
  } else if (currentRSI >= 30 && currentRSI <= 50) {
    optionIndex = 2; // RSI im Kaufbereich (30–50)
    confidence = 0.8;
  } else if (currentRSI > 50 && currentRSI <= 70) {
    optionIndex = 1; // RSI neutral (50–70)
    confidence = 0.85;
  } else {
    // RSI > 70
    optionIndex = 0; // RSI ueberkauft
    confidence = 0.85;
  }

  const detail = `RSI(14) = ${currentRSI.toFixed(1)}${hasDivergence ? " + bullische Divergenz" : ""}`;

  return { optionIndex, confidence, detail, rawValue: Math.round(currentRSI * 10) / 10 };
}

// ══════════════════════════════════════════════════════════════
// Q6: EMA-Anordnung (20/50/200)
// ══════════════════════════════════════════════════════════════

export function analyzeEMAs(candles) {
  if (!candles || candles.length < 220) {
    return { optionIndex: 1, confidence: 0.3, detail: "Nicht genug Daten fuer EMA(200)", rawValue: null };
  }

  const closes = candles.map((c) => c.close);
  const ema20Arr = EMA.calculate({ values: closes, period: 20 });
  const ema50Arr = EMA.calculate({ values: closes, period: 50 });
  const ema200Arr = EMA.calculate({ values: closes, period: 200 });

  if (!ema20Arr.length || !ema50Arr.length || !ema200Arr.length) {
    return { optionIndex: 1, confidence: 0.3, detail: "EMA-Berechnung fehlgeschlagen", rawValue: null };
  }

  const ema20 = ema20Arr[ema20Arr.length - 1];
  const ema50 = ema50Arr[ema50Arr.length - 1];
  const ema200 = ema200Arr[ema200Arr.length - 1];

  let optionIndex, confidence, label;

  if (ema20 > ema50 && ema50 > ema200) {
    optionIndex = 3; // EMA 20 > 50 > 200 (bullisch)
    confidence = 0.9;
    label = "EMA 20 > 50 > 200 (bullisch)";
  } else if (ema200 > ema50 && ema50 > ema20) {
    optionIndex = 0; // Abwaertstrend (200 > 50 > 20)
    confidence = 0.9;
    label = "EMA 200 > 50 > 20 (baerisch)";
  } else {
    // Teilweise geordnet pruefen
    const bullishPairs = (ema20 > ema50 ? 1 : 0) + (ema50 > ema200 ? 1 : 0) + (ema20 > ema200 ? 1 : 0);
    if (bullishPairs >= 2) {
      optionIndex = 2; // Teilweise aufsteigend
      confidence = 0.75;
      label = "Teilweise bullisch";
    } else {
      optionIndex = 1; // Verschlungen / keine Ordnung
      confidence = 0.7;
      label = "Verschlungen / unklar";
    }
  }

  const detail = `${label} · EMA20: ${ema20.toFixed(2)} | EMA50: ${ema50.toFixed(2)} | EMA200: ${ema200.toFixed(2)}`;

  return { optionIndex, confidence, detail, rawValue: { ema20, ema50, ema200 } };
}

// ══════════════════════════════════════════════════════════════
// Q8: Leitindex-Check (S&P 500 / DAX vs. 50/200-MA)
// ══════════════════════════════════════════════════════════════

export function checkLeadingIndex(indexCandles) {
  if (!indexCandles || indexCandles.length < 220) {
    return { optionIndex: 1, confidence: 0.3, detail: "Nicht genug Index-Daten", rawValue: null };
  }

  const closes = indexCandles.map((c) => c.close);
  const ma50Arr = SMA.calculate({ values: closes, period: 50 });
  const ma200Arr = SMA.calculate({ values: closes, period: 200 });

  const currentPrice = closes[closes.length - 1];
  const ma50 = ma50Arr[ma50Arr.length - 1];
  const ma200 = ma200Arr[ma200Arr.length - 1];

  let optionIndex, confidence, label;

  if (currentPrice > ma50 && currentPrice > ma200) {
    optionIndex = 3; // Ueber 50-MA UND 200-MA (Bullenmarkt)
    confidence = 0.9;
    label = "Ueber 50-MA & 200-MA";
  } else if (currentPrice > ma200 && currentPrice <= ma50) {
    optionIndex = 2; // Ueber 200-MA, nahe/unter 50-MA
    confidence = 0.8;
    label = "Ueber 200-MA, unter 50-MA";
  } else if (currentPrice > ma200 || currentPrice > ma50) {
    optionIndex = 1; // Zwischen den MAs
    confidence = 0.75;
    label = "Zwischen 50-MA und 200-MA";
  } else {
    optionIndex = 0; // Unter beiden
    confidence = 0.85;
    label = "Unter 50-MA & 200-MA";
  }

  const detail = `Index: ${label} · Kurs: ${currentPrice.toFixed(0)} | 50-MA: ${ma50.toFixed(0)} | 200-MA: ${ma200.toFixed(0)}`;

  return { optionIndex, confidence, detail, rawValue: { price: currentPrice, ma50, ma200 } };
}

// ══════════════════════════════════════════════════════════════
// Q9: Bollinger Baender (20,2)
// ══════════════════════════════════════════════════════════════

export function analyzeBollingerBands(candles) {
  if (!candles || candles.length < 30) {
    return { optionIndex: 2, confidence: 0.3, detail: "Nicht genug Daten fuer BB", rawValue: null };
  }

  const closes = candles.map((c) => c.close);
  const bbArr = BollingerBands.calculate({ period: 20, stdDev: 2, values: closes });

  if (bbArr.length < 6) {
    return { optionIndex: 2, confidence: 0.3, detail: "BB-Berechnung fehlgeschlagen", rawValue: null };
  }

  const latest = bbArr[bbArr.length - 1];
  const prev5 = bbArr[bbArr.length - 6];
  const currentPrice = closes[closes.length - 1];

  const { upper, middle, lower } = latest;
  const bandwidth = upper - lower;
  const prevBandwidth = prev5.upper - prev5.lower;

  // Squeeze erkennen: aktuelle Bandbreite < 60% der Bandbreite vor 5 Bars
  const isSqueeze = bandwidth < prevBandwidth * 0.6;
  const isBreakingUp = isSqueeze && currentPrice > upper;

  // Relative Position (0 = unteres Band, 1 = oberes Band)
  const relativePos = bandwidth > 0 ? (currentPrice - lower) / bandwidth : 0.5;

  // Umkehrsignal pruefen (letzte Kerze am unteren Band)
  const lastCandle = candles[candles.length - 1];
  const prevCandle = candles[candles.length - 2];
  const hasReversalAtLower =
    relativePos < 0.2 &&
    (isHammer(lastCandle) || isBullishEngulfing(prevCandle, lastCandle));

  let optionIndex, confidence, label;

  if (isBreakingUp) {
    optionIndex = 4; // Bollinger Squeeze + Ausbruch
    confidence = 0.85;
    label = "Squeeze + Ausbruch nach oben";
  } else if (hasReversalAtLower) {
    optionIndex = 3; // Am unteren Band + Umkehrsignal
    confidence = 0.8;
    label = "Am unteren Band + Umkehrsignal";
  } else if (currentPrice < lower) {
    optionIndex = 0; // Weit unter unterem Band
    confidence = 0.8;
    label = "Unter unterem Band (ueberverkauft)";
  } else if (relativePos < 0.25) {
    optionIndex = 1; // Nahe unterem Band, innerhalb
    confidence = 0.7;
    label = "Nahe unterem Band";
  } else {
    optionIndex = 2; // Mittig
    confidence = 0.65;
    label = "Mittig zwischen den Baendern";
  }

  const detail = `${label} · Kurs: ${currentPrice.toFixed(2)} | BB: ${lower.toFixed(2)} – ${middle.toFixed(2)} – ${upper.toFixed(2)}${isSqueeze ? " | SQUEEZE" : ""}`;

  return {
    optionIndex,
    confidence,
    detail,
    rawValue: { price: currentPrice, upper, middle, lower, relativePos: Math.round(relativePos * 100) },
  };
}
