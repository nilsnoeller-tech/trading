// ─── N-Capital Market Data Proxy + Full Index Scanner (Cloudflare Worker) ───
// Routes: /api/chart, /api/batch, /api/push/*, /api/scan/*, /api/briefing/*
// Cron: Chunked scan of S&P 500 + DAX 40 (alle 5 Min ein Chunk, voller Scan ~45 Min)
// KV-Optimized: consolidated scan:state (1R+1W per invocation instead of 5R+6W)
// Deployment: cd proxy && npx wrangler deploy

import { buildPushHTTPRequest } from "@pushforge/builder";

// ─── S&P 500 Symbols (~507 Aktien) ───

const SP500_SYMBOLS = [
  "A","AAPL","ABBV","ABNB","ABT","ACGL","ACN","ADBE","ADI","ADM","ADP","ADSK","AEE","AEP","AES",
  "AFL","AIG","AIZ","AJG","AKAM","ALB","ALGN","ALL","ALLE","AMAT","AMCR","AMD","AME","AMGN","AMP",
  "AMT","AMZN","ANET","AON","AOS","APA","APD","APH","APO","APP","APTV","ARE","ARES","ATO","AVB",
  "AVGO","AVY","AWK","AXON","AXP","AZO","BA","BAC","BALL","BAX","BBWI","BBY","BDX","BEN","BF.B",
  "BG","BIIB","BK","BKNG","BKR","BLDR","BLK","BMY","BR","BRK.B","BRO","BSX","BX","BXP","C","CAG",
  "CAH","CARR","CAT","CB","CBOE","CBRE","CCI","CCL","CDNS","CDW","CEG","CF","CFG","CHD","CHRW",
  "CHTR","CI","CIEN","CINF","CL","CLX","CMCSA","CME","CMG","CMI","CMS","CNC","CNP","COF","COIN",
  "COO","COP","COR","COST","CPAY","CPB","CPRT","CPT","CRH","CRL","CRM","CRWD","CSCO","CSGP","CSX",
  "CTAS","CTRA","CTSH","CTVA","CVNA","CVS","CVX","D","DAL","DASH","DD","DDOG","DE","DECK","DELL",
  "DG","DGX","DHI","DHR","DIS","DLR","DLTR","DOV","DOW","DPZ","DRI","DTE","DUK","DVA","DVN","DXCM",
  "EA","EBAY","ECL","ED","EFX","EG","EIX","EL","ELV","EME","EMN","EMR","EOG","EPAM","EQIX","EQR",
  "EQT","ERIE","ES","ESS","ETN","ETR","EVRG","EW","EXC","EXE","EXPD","EXPE","EXR","F","FANG","FAST",
  "FCX","FDS","FDX","FE","FFIV","FI","FICO","FIS","FISV","FITB","FIX","FLT","FMC","FOX","FOXA","FRT",
  "FSLR","FTNT","FTV","GD","GDDY","GE","GEHC","GEN","GEV","GILD","GIS","GL","GLW","GM","GNRC","GOOG",
  "GOOGL","GPC","GPN","GRMN","GS","GWW","HAL","HAS","HBAN","HCA","HD","HIG","HII","HLT","HOLX","HON",
  "HOOD","HPE","HPQ","HRL","HST","HSY","HUBB","HUM","HWM","IBKR","IBM","ICE","IDXX","IEX","IFF",
  "INCY","INTC","INTU","INVH","IP","IQV","IR","IRM","ISRG","IT","ITW","IVZ","JBHT","JBL","JCI",
  "JKHY","JNJ","JPM","K","KDP","KEY","KEYS","KHC","KIM","KKR","KLAC","KMB","KMI","KO","KR","KVUE",
  "L","LDOS","LEN","LH","LHX","LII","LIN","LLY","LMT","LNT","LOW","LRCX","LULU","LUV","LVS","LW",
  "LYB","LYV","MA","MAA","MAR","MAS","MCD","MCHP","MCK","MCO","MDLZ","MDT","MET","META","MGM","MKC",
  "MLM","MMC","MMM","MNST","MO","MOH","MOS","MPC","MPWR","MRK","MRNA","MRSH","MS","MSCI","MSFT",
  "MSI","MTB","MTCH","MTD","MU","NCLH","NDAQ","NDSN","NEE","NEM","NFLX","NI","NKE","NOC","NOW","NRG",
  "NSC","NTAP","NTRS","NUE","NVDA","NVR","NWS","NWSA","NXPI","O","ODFL","OKE","OMC","ON","ORCL",
  "ORLY","OTIS","OXY","PANW","PARA","PAYC","PAYX","PCAR","PCG","PEG","PEP","PFE","PFG","PG","PGR",
  "PH","PHM","PKG","PLD","PLTR","PM","PNC","PNR","PNW","PODD","POOL","PPG","PPL","PRU","PSA","PSX",
  "PTC","PWR","PXD","PYPL","Q","QCOM","RCL","REG","REGN","RF","RJF","RL","RMD","ROK","ROL","ROP",
  "ROST","RSG","RTX","RVTY","SBAC","SBUX","SCHW","SHW","SJM","SLB","SMCI","SNA","SNPS","SO","SOLV",
  "SPG","SPGI","SRE","STE","STLD","STT","STX","STZ","SW","SWK","SWKS","SYF","SYK","SYY","T","TAP",
  "TDG","TDY","TECH","TEL","TER","TFC","TGT","TJX","TKO","TMO","TMUS","TPL","TPR","TRGP","TRMB",
  "TROW","TRV","TSCO","TSLA","TSN","TT","TTD","TTWO","TXN","TXT","TYL","UAL","UBER","UDR","UHS",
  "ULTA","UNH","UNP","UPS","URI","USB","V","VICI","VLO","VLTO","VMC","VRSK","VRSN","VRTX","VST",
  "VTR","VTRS","VZ","WAB","WAT","WBD","WDAY","WDC","WEC","WELL","WFC","WM","WMB","WMT","WRB","WRK",
  "WSM","WST","WTW","WY","WYNN","XEL","XOM","XYL","YUM","ZBH","ZBRA","ZTS",
];

// ─── DAX 40 Symbols (Yahoo Finance .DE Suffix) ───

const DAX40_SYMBOLS = [
  "ADS.DE","AIR.DE","ALV.DE","BAS.DE","BAYN.DE","BEI.DE","BMW.DE","BNR.DE","CBK.DE","CON.DE",
  "DB1.DE","DBK.DE","DHL.DE","DTE.DE","DTG.DE","ENR.DE","FRE.DE","G1A.DE","HEI.DE",
  "HEN3.DE","HNR1.DE","IFX.DE","MBG.DE","MRK.DE","MTX.DE","MUV2.DE","P911.DE","PAH3.DE","PUM.DE",
  "QIA.DE","RHM.DE","RWE.DE","SAP.DE","SHL.DE","SIE.DE","SRT3.DE","VOW3.DE","ZAL.DE",
];

const ALL_INDEX_SYMBOLS = [...SP500_SYMBOLS, ...DAX40_SYMBOLS];

// ─── Macro Symbols for Market Briefing ───

const MACRO_SYMBOLS = {
  indices:     [{ symbol: "^GSPC", name: "S&P 500" }, { symbol: "^GDAXI", name: "DAX" }, { symbol: "^DJI", name: "Dow Jones" }, { symbol: "^IXIC", name: "Nasdaq" }],
  volatility:  [{ symbol: "^VIX", name: "VIX" }],
  bonds:       [{ symbol: "^TNX", name: "US 10Y Yield" }],
  commodities: [{ symbol: "GC=F", name: "Gold" }, { symbol: "CL=F", name: "WTI Öl" }],
  crypto:      [{ symbol: "BTC-USD", name: "Bitcoin" }],
  currencies:  [{ symbol: "EURUSD=X", name: "EUR/USD" }],
  futures:     [{ symbol: "ES=F", name: "S&P Futures" }, { symbol: "NQ=F", name: "Nasdaq Futures" }],
};
const ALL_MACRO_SYMBOLS = Object.values(MACRO_SYMBOLS).flat().map(m => m.symbol);

// ─── DAX Sector Mapping ───

const DAX_SECTORS = {
  "Technologie": ["SAP","IFX"],
  "Automobil": ["MBG","BMW","VOW3","PAH3","P911","CON"],
  "Finanzen": ["ALV","DBK","CBK","MUV2","DB1"],
  "Industrie": ["SIE","AIR","MTX","DHL"],
  "Ruestung": ["RHM"],
  "Chemie/Pharma": ["BAS","BAYN","MRK","FRE","SHL"],
  "Energie": ["RWE","ENR"],
  "Konsum": ["ADS","PUM","BEI","HEN3","ZAL"],
  "Telekom": ["DTE","SRT3"],
  "Bau": ["HEI"],
  "Immobilien": ["QIA"],
};

// ─── US Sector Mapping (Top-Aktien) ───

const US_SECTORS = {
  "Technologie": ["AAPL","MSFT","NVDA","AVGO","AMD","CRM","ADBE","ORCL","CSCO","INTC","QCOM","TXN","NOW","SNPS","CDNS","AMAT","LRCX","KLAC","MCHP","NXPI","CRWD","DDOG","PANW","FTNT"],
  "Finanzen": ["JPM","BAC","WFC","GS","MS","BLK","BX","SCHW","C","AXP","COF","ICE","CME","MCO","SPGI","MMC","AON","PGR","MET","AFL","AIG","TRV","CB"],
  "Gesundheit": ["UNH","LLY","JNJ","ABBV","MRK","PFE","TMO","ABT","AMGN","MDT","ISRG","BMY","GILD","VRTX","REGN","CI","ELV","HCA","BSX","SYK","DXCM","IDXX","EW"],
  "Konsum (zykl.)": ["AMZN","TSLA","HD","MCD","NKE","SBUX","TJX","COST","LOW","BKNG","CMG","ROST","ORLY","DG","DLTR","LULU","YUM","DRI"],
  "Konsum (def.)": ["PG","KO","PEP","WMT","PM","CL","MDLZ","KMB","GIS","HSY","K","KHC","STZ","MO","KR","SYY","ADM"],
  "Industrie": ["CAT","DE","HON","UNP","RTX","GE","BA","LMT","MMM","EMR","ITW","ETN","PH","ROK","FDX","UPS","WM","RSG","CARR","OTIS"],
  "Energie": ["XOM","CVX","COP","SLB","EOG","MPC","OXY","VLO","PSX","HAL","DVN","FANG","OKE","WMB","KMI"],
  "Versorger": ["NEE","DUK","SO","D","AEP","SRE","EXC","ED","WEC","ES"],
  "Kommunikation": ["META","GOOG","GOOGL","NFLX","DIS","CMCSA","TMUS","T","VZ","CHTR","EA","TTWO"],
  "Grundstoffe": ["LIN","APD","SHW","ECL","NEM","FCX","NUE","CF","DD","MLM","VMC"],
};

// ─── Seasonal Data (Hardcoded Historical Averages) ───

const MONTHLY_SEASONALITY = {
  1:  { sp500: +1.2, dax: +1.5, note: "Januar-Effekt: Small Caps oft stark" },
  2:  { sp500: -0.1, dax: +0.3, note: "Historisch schwacher Monat, oft Korrektur nach Januar-Rally" },
  3:  { sp500: +1.0, dax: +1.8, note: "Quartalsende Window-Dressing, Fonds schichten um" },
  4:  { sp500: +1.5, dax: +2.1, note: "Staerkster Monat historisch, Earnings Season beginnt" },
  5:  { sp500: +0.2, dax: -0.3, note: "Sell in May — ab Mai historisch schwaechere Phase" },
  6:  { sp500: +0.1, dax: -0.5, note: "Sommerliche Seitwaertsbewegung beginnt" },
  7:  { sp500: +1.0, dax: +0.8, note: "Sommererholung, Q2-Earnings" },
  8:  { sp500: -0.2, dax: -1.0, note: "Schwaechster Monat fuer DAX, duennes Volumen" },
  9:  { sp500: -0.5, dax: -1.2, note: "September-Effekt: Historisch schwaechster US-Monat" },
  10: { sp500: +0.9, dax: +1.2, note: "Oktober-Reversal historisch stark" },
  11: { sp500: +1.5, dax: +2.0, note: "Jahresendrally beginnt" },
  12: { sp500: +1.3, dax: +1.8, note: "Santa Rally: letzte 5 Handelstage + erste 2 Januar" },
};

// US Presidential Cycle: year % 4 → 0=Election, 1=Post-Election, 2=Midterm, 3=Pre-Election
const PRESIDENTIAL_CYCLE = {
  0: { name: "Wahljahr", sp500Avg: +7.5, note: "Wahljahr: Maerkte meist positiv, Unsicherheit vor Wahl" },
  1: { name: "Post-Wahljahr", sp500Avg: +3.0, note: "Post-Wahljahr: Neue Politik wird implementiert, oft Enttaeuschung" },
  2: { name: "Midterm-Jahr", sp500Avg: +5.0, note: "Midterm: H1 oft schwach, ab Oktober starke Rally (Ø +15% H2)" },
  3: { name: "Pre-Wahljahr", sp500Avg: +12.8, note: "Pre-Wahljahr: Historisch staerkstes Jahr im Zyklus" },
};

// Key recurring events (approximate dates, month-based)
const RECURRING_EVENTS_2026 = [
  { month: 1, day: 29, name: "FOMC-Sitzung", type: "fed" },
  { month: 3, day: 19, name: "FOMC-Sitzung + Dot Plot", type: "fed" },
  { month: 3, day: 20, name: "Triple Witching (Grosser Verfall)", type: "options" },
  { month: 4, day: 14, name: "Earnings Season Q1 startet", type: "earnings" },
  { month: 5, day: 6, name: "FOMC-Sitzung", type: "fed" },
  { month: 6, day: 17, name: "FOMC-Sitzung + Dot Plot", type: "fed" },
  { month: 6, day: 19, name: "Triple Witching", type: "options" },
  { month: 7, day: 14, name: "Earnings Season Q2 startet", type: "earnings" },
  { month: 7, day: 29, name: "FOMC-Sitzung", type: "fed" },
  { month: 9, day: 16, name: "FOMC-Sitzung + Dot Plot", type: "fed" },
  { month: 9, day: 18, name: "Triple Witching", type: "options" },
  { month: 10, day: 13, name: "Earnings Season Q3 startet", type: "earnings" },
  { month: 10, day: 28, name: "FOMC-Sitzung", type: "fed" },
  { month: 11, day: 3, name: "US Midterm Elections", type: "political" },
  { month: 12, day: 16, name: "FOMC-Sitzung + Dot Plot", type: "fed" },
  { month: 12, day: 18, name: "Triple Witching", type: "options" },
];

const SCAN_DEFAULTS = {
  chunkSize: 24,         // Symbols per chunk (24 × 2 calls = 48 fetches, under 50 subrequest limit)
  parallelBatch: 5,      // Parallel fetches per batch
  threshold: 75,         // Minimum combined score to show in results
  notifyThreshold: 80,   // Minimum combined score to trigger push notification
};

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

async function fetchYahooJSON(symbol, params, timeoutMs = 12000, singleHost = false) {
  const searchParams = new URLSearchParams(params);
  let lastError = null;

  // In scan mode (singleHost=true): use only 1 host to stay within subrequest limits
  const hosts = singleHost ? [YAHOO_HOSTS[Math.random() < 0.5 ? 0 : 1]] : YAHOO_HOSTS;

  for (const host of hosts) {
    try {
      const url = `https://${host}/v8/finance/chart/${encodeURIComponent(symbol)}?${searchParams.toString()}`;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      const resp = await fetch(url, {
        headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (resp.ok) {
        return await resp.json();
      }
      lastError = `${host} returned ${resp.status}`;
    } catch (e) {
      lastError = `${host}: ${e.name === "AbortError" ? "timeout" : e.message}`;
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
  if (rsi >= 30 && rsi <= 40) { rsiScore = 100; signals.push(`RSI ${rsi.toFixed(0)} (Kaufzone)`); }
  else if (rsi > 40 && rsi <= 55) rsiScore = 50;
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
  // singleHost=true to stay within Cloudflare subrequest limits (50 on free plan)
  const [dailyJson, intradayJson] = await Promise.all([
    fetchYahooJSON(symbol, { range: "1y", interval: "1d", includeAdjustedClose: "true" }, 12000, true),
    fetchYahooJSON(symbol, { range: "5d", interval: "15m", includeAdjustedClose: "true" }, 12000, true),
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

// ─── Time-Based Symbol Selection ───
// DAX 40:   07:30–19:00 UTC (08:30–20:00 DE)
// S&P 500:  14:00–22:00 UTC (15:00–23:00 DE)
// Overlap:  14:00–19:00 UTC (15:00–20:00 DE) → both markets

function getActiveSymbols() {
  const now = new Date();
  const utcHour = now.getUTCHours();
  const utcMinute = now.getUTCMinutes();
  const timeDecimal = utcHour + utcMinute / 60;

  const daxActive = timeDecimal >= 7.5 && timeDecimal < 19;   // 07:30–18:59 UTC
  const spActive  = timeDecimal >= 14  && timeDecimal < 22;   // 14:00–21:59 UTC

  if (daxActive && spActive) return { symbols: [...SP500_SYMBOLS, ...DAX40_SYMBOLS], mode: "both" };
  if (daxActive)             return { symbols: [...DAX40_SYMBOLS], mode: "dax-only" };
  if (spActive)              return { symbols: [...SP500_SYMBOLS], mode: "sp500-only" };
  return { symbols: [], mode: "closed" };
}

// ─── Chunked Index Scanner (State Machine) ───
// Scans active symbols in chunks per cron invocation.
// After the last chunk, merges results, filters by score, sends push notifications.

function errorResult(sym, errMsg) {
  return {
    symbol: sym, displaySymbol: sym.replace(/\.DE$/i, ""), name: sym,
    currency: sym.endsWith(".DE") ? "EUR" : "USD", price: 0, change: 0,
    swing: { total: 0, factors: [], signals: [], error: errMsg },
    intraday: { total: 0, factors: [], signals: [], error: errMsg },
    timestamp: new Date().toISOString(),
  };
}

async function runChunkedScan(env) {
  // 1. Determine which symbols to scan based on current time
  const { symbols: activeSymbols, mode: currentMode } = getActiveSymbols();

  // 2. Load consolidated state (1 KV read instead of 5)
  const state = (await env.NCAPITAL_KV.get("scan:state", "json")) || {
    pointer: 0, lastPointer: -1, retryCount: 0,
    mode: null, totalChunks: 0, totalSymbols: 0,
    lastRun: null, lastFullScan: null,
  };

  // 3. Market closed — nothing to do
  if (currentMode === "closed" || activeSymbols.length === 0) {
    console.log(`[Scan] Market closed. Skipping.`);
    state.lastRun = new Date().toISOString();
    await env.NCAPITAL_KV.put("scan:state", JSON.stringify(state));
    return { chunk: 0, totalChunks: 0, scanned: 0, mode: "closed" };
  }

  // 4. Load config and compute chunking for active symbols
  const config = (await env.NCAPITAL_KV.get("scan:config", "json")) || SCAN_DEFAULTS;
  const chunkSize = config.chunkSize || SCAN_DEFAULTS.chunkSize;
  const parallelBatch = config.parallelBatch || SCAN_DEFAULTS.parallelBatch;
  const totalChunks = Math.ceil(activeSymbols.length / chunkSize);

  // 5. Handle mode transition (e.g. dax-only → both at 14:00 UTC)
  const prevMode = state.mode;
  let pointer = state.pointer;

  if (prevMode !== null && prevMode !== currentMode) {
    console.log(`[Scan] Mode transition: ${prevMode} -> ${currentMode}. Resetting cycle.`);

    // Merge partial results from previous cycle if any chunks were completed
    if (pointer > 0 && state.totalChunks) {
      console.log(`[Scan] Merging partial results (${pointer}/${state.totalChunks} chunks from ${prevMode}).`);
      await mergeAndNotify(env, config, pointer);
      state.lastFullScan = new Date().toISOString();
    }

    // Clean stale chunk keys from previous mode
    for (let i = 0; i < (state.totalChunks || 0); i++) {
      await env.NCAPITAL_KV.delete(`scan:chunk:${i}`);
    }

    // Reset pointer for new mode
    pointer = 0;
    state.pointer = 0;
    state.retryCount = 0;
    state.lastPointer = -1;
  }

  // 6. Update mode info in state
  state.mode = currentMode;
  state.totalChunks = totalChunks;
  state.totalSymbols = activeSymbols.length;

  // 7. Stuck-pointer detection: if same pointer runs 3+ times, force advance
  if (pointer === state.lastPointer) {
    if (state.retryCount >= 2) {
      console.log(`[Scan] [${currentMode}] Chunk ${pointer + 1}/${totalChunks} stuck after ${state.retryCount + 1} attempts. Skipping.`);
      await env.NCAPITAL_KV.put(`scan:chunk:${pointer}`, JSON.stringify([]), { expirationTtl: 7200 });
      const skipNext = pointer + 1;
      if (skipNext >= totalChunks) {
        await mergeAndNotify(env, config, totalChunks);
        state.pointer = 0;
        state.lastFullScan = new Date().toISOString();
      } else {
        state.pointer = skipNext;
      }
      state.retryCount = 0;
      state.lastRun = new Date().toISOString();
      await env.NCAPITAL_KV.put("scan:state", JSON.stringify(state));
      return { chunk: pointer + 1, totalChunks, scanned: 0, skipped: true, mode: currentMode };
    }
    state.retryCount++;
  } else {
    state.retryCount = 0;
  }
  state.lastPointer = pointer;

  // 8. Determine symbols for this chunk from activeSymbols
  const start = pointer * chunkSize;
  const end = Math.min(start + chunkSize, activeSymbols.length);
  const chunkSymbols = activeSymbols.slice(start, end);

  console.log(`[Scan] [${currentMode}] Chunk ${pointer + 1}/${totalChunks}: ${chunkSymbols.length} symbols (${chunkSymbols[0]}..${chunkSymbols[chunkSymbols.length - 1]})`);

  // 9. Scan in parallel batches (with per-batch timeout safety)
  const results = [];
  const scanStart = Date.now();
  for (let i = 0; i < chunkSymbols.length; i += parallelBatch) {
    if (Date.now() - scanStart > 26000) {
      console.log(`[Scan] Time limit approaching after ${results.length} symbols. Saving partial results.`);
      break;
    }
    const batch = chunkSymbols.slice(i, i + parallelBatch);
    const batchResults = await Promise.all(
      batch.map((sym) => scanSymbolServer(sym).catch((err) => errorResult(sym, err.message)))
    );
    results.push(...batchResults);
  }

  // 10. Write chunk results to KV (TTL 2h)
  await env.NCAPITAL_KV.put(`scan:chunk:${pointer}`, JSON.stringify(results), { expirationTtl: 7200 });

  // 11. Advance pointer or merge
  const nextPointer = pointer + 1;

  if (nextPointer >= totalChunks) {
    console.log(`[Scan] [${currentMode}] All ${totalChunks} chunks done. Merging...`);
    await mergeAndNotify(env, config, totalChunks);
    state.pointer = 0;
    state.lastFullScan = new Date().toISOString();
  } else {
    state.pointer = nextPointer;
  }

  // 12. Save consolidated state (1 KV write instead of 6)
  state.lastRun = new Date().toISOString();
  await env.NCAPITAL_KV.put("scan:state", JSON.stringify(state));

  return { chunk: pointer + 1, totalChunks, scanned: results.length, mode: currentMode };
}

async function mergeAndNotify(env, config, totalChunks) {
  // Read all chunks
  const allResults = [];
  for (let i = 0; i < totalChunks; i++) {
    const chunk = await env.NCAPITAL_KV.get(`scan:chunk:${i}`, "json");
    if (chunk) allResults.push(...chunk);
  }

  // Filter + sort by SWING score (primary), keep combined for reference
  const threshold = config.threshold || SCAN_DEFAULTS.threshold;
  const notifyThreshold = config.notifyThreshold || SCAN_DEFAULTS.notifyThreshold;

  const scored = allResults.map((r) => ({
    ...r,
    combinedScore: Math.round(r.swing.total * 0.6 + r.intraday.total * 0.4),
  }));

  const filtered = scored
    .filter((r) => r.swing.total >= threshold)
    .sort((a, b) => b.swing.total - a.swing.total);

  // Compute market breadth per index
  const daxAll = allResults.filter(r => r.symbol.endsWith(".DE"));
  const spAll = allResults.filter(r => !r.symbol.endsWith(".DE"));
  const breadth = (arr) => {
    const pos = arr.filter(r => r.change > 0).length;
    const neg = arr.filter(r => r.change < 0).length;
    const unch = arr.length - pos - neg;
    const avgChg = arr.length > 0 ? arr.reduce((s, r) => s + r.change, 0) / arr.length : 0;
    return { total: arr.length, positive: pos, negative: neg, unchanged: unch, avgChange: Math.round(avgChg * 100) / 100 };
  };

  // Save merged results + stats in one combined write (saves 1 KV write)
  const stats = {
    totalScanned: allResults.length,
    hits: filtered.length,
    errors: allResults.filter((r) => r.swing.error || r.intraday.error).length,
    timestamp: new Date().toISOString(),
    breadth: { dax: breadth(daxAll), sp500: breadth(spAll) },
  };
  await Promise.all([
    env.NCAPITAL_KV.put("scan:results", JSON.stringify(filtered), { expirationTtl: 7200 }),
    env.NCAPITAL_KV.put("scan:stats", JSON.stringify(stats)),
  ]);

  console.log(`[Scan] Merged: ${allResults.length} total, ${filtered.length} hits (swing >= ${threshold}), ${stats.errors} errors`);

  // Send push notifications for high-score results
  const notifyResults = filtered.filter((r) => r.swing.total >= notifyThreshold);
  if (notifyResults.length === 0) return;

  const subscriptions = (await env.NCAPITAL_KV.get("push:subscriptions", "json")) || [];
  if (subscriptions.length === 0) return;

  // Batch-read all cooldowns in parallel (saves N sequential reads)
  const cooldownKeys = notifyResults.map((r) => `cooldown:${r.displaySymbol}`);
  const cooldownValues = await Promise.all(cooldownKeys.map((k) => env.NCAPITAL_KV.get(k)));

  const notifications = [];
  const validSubs = [...subscriptions];
  const cooldownWrites = [];

  for (let ri = 0; ri < notifyResults.length; ri++) {
    if (cooldownValues[ri]) continue; // Already notified recently
    const r = notifyResults[ri];

    const topSignals = r.swing.signals.slice(0, 3).join(" + ");
    const title = `${r.displaySymbol} Swing ${r.swing.total}`;
    const body = `${r.price.toFixed(2)} ${r.currency} — ${topSignals || "Starkes Setup"}`;
    const tag = `scan-${r.displaySymbol}`;

    let anySent = false;
    for (let si = validSubs.length - 1; si >= 0; si--) {
      const pushResult = await sendPush(validSubs[si], { title, body, tag, url: "/ncapital-app/" }, env);
      if (pushResult.sent) anySent = true;
      if (pushResult.expired) validSubs.splice(si, 1);
    }

    if (anySent) {
      cooldownWrites.push(env.NCAPITAL_KV.put(cooldownKeys[ri], "1", { expirationTtl: 3600 }));
      notifications.push({ symbol: r.displaySymbol, score: r.swing.total, title });
    }
  }

  // Batch-write all cooldowns + cleanup in parallel
  const writes = [...cooldownWrites];
  if (validSubs.length < subscriptions.length) {
    writes.push(env.NCAPITAL_KV.put("push:subscriptions", JSON.stringify(validSubs)));
  }
  if (writes.length > 0) await Promise.all(writes);

  console.log(`[Scan] Notifications sent: ${notifications.length}`);
}

// ─── Market Briefing Generation ───

function getCETHour() {
  const now = new Date();
  const cetStr = now.toLocaleString("en-US", { timeZone: "Europe/Berlin", hour: "numeric", minute: "numeric", hour12: false });
  const [h, m] = cetStr.split(":").map(Number);
  return h + m / 60;
}

async function fetchMacroData() {
  const results = {};
  const fetches = await Promise.all(
    ALL_MACRO_SYMBOLS.map(async (sym) => {
      const json = await fetchYahooJSON(sym, { range: "1y", interval: "1wk", includeAdjustedClose: "true" }, 10000, true);
      // Also fetch 5d for accurate daily change + 5d trend
      const json5d = await fetchYahooJSON(sym, { range: "5d", interval: "1d", includeAdjustedClose: "true" }, 10000, true);
      return { symbol: sym, json, json5d };
    })
  );
  for (const { symbol, json, json5d } of fetches) {
    // Daily data for price/change/trend
    const parsed5d = !json5d.error ? parseYahooCandles(json5d) : null;
    let price = 0, change = 0, prevClose = 0, high = 0, low = 0, currency = "USD", trend5d = null;
    if (parsed5d && parsed5d.candles.length >= 2) {
      const candles = parsed5d.candles;
      const last = candles[candles.length - 1];
      const prev = candles[candles.length - 2];
      price = last.close;
      change = ((price - prev.close) / prev.close) * 100;
      prevClose = prev.close;
      high = last.high;
      low = last.low;
      currency = parsed5d.meta?.currency || "USD";
      trend5d = candles.length >= 5 ? ((price - candles[0].close) / candles[0].close) * 100 : null;
    }
    // Weekly data for 52W range
    const parsed1y = !json.error ? parseYahooCandles(json) : null;
    let w52 = null;
    if (parsed1y && parsed1y.candles.length >= 4) {
      const closes = parsed1y.candles.map(c => c.close);
      const highs = parsed1y.candles.map(c => c.high);
      const lows = parsed1y.candles.map(c => c.low).filter(l => l > 0);
      const w52High = Math.max(...highs);
      const w52Low = Math.min(...lows);
      const avg = closes.reduce((a, b) => a + b, 0) / closes.length;
      const pctFromHigh = price > 0 && w52High > 0 ? ((price - w52High) / w52High) * 100 : null;
      const pctFromLow = price > 0 && w52Low > 0 ? ((price - w52Low) / w52Low) * 100 : null;
      const rangePosition = w52High > w52Low ? ((price - w52Low) / (w52High - w52Low)) * 100 : 50;
      w52 = { high: w52High, low: w52Low, avg: Math.round(avg * 100) / 100, pctFromHigh, pctFromLow, rangePosition: Math.round(rangePosition) };
    }
    results[symbol] = { price, change, prevClose, high, low, currency, trend5d, w52 };
  }
  return results;
}

async function fetchVixHistory() {
  try {
    const json = await fetchYahooJSON("^VIX", { range: "ytd", interval: "1d", includeAdjustedClose: "true" }, 10000, true);
    if (json.error) return null;
    const parsed = parseYahooCandles(json);
    if (!parsed || parsed.candles.length < 2) return null;
    const candles = parsed.candles;
    const current = candles[candles.length - 1].close;
    const ytdStart = candles[0].close;
    // 1 week ago (~5 trading days)
    const w1Idx = Math.max(0, candles.length - 6);
    const weekAgo = candles[w1Idx].close;
    // 1 month ago (~22 trading days)
    const m1Idx = Math.max(0, candles.length - 23);
    const monthAgo = candles[m1Idx].close;
    // Compute averages
    const allCloses = candles.map(c => c.close);
    const avg = arr => arr.reduce((a, b) => a + b, 0) / arr.length;
    const ytdAvg = avg(allCloses);
    const monthAvg = avg(allCloses.slice(m1Idx));
    const weekAvg = avg(allCloses.slice(w1Idx));
    // Min/Max
    const ytdHigh = Math.max(...allCloses);
    const ytdLow = Math.min(...allCloses);
    return {
      current,
      week: { close: weekAgo, change: ((current - weekAgo) / weekAgo) * 100, avg: weekAvg },
      month: { close: monthAgo, change: ((current - monthAgo) / monthAgo) * 100, avg: monthAvg },
      ytd: { open: ytdStart, change: ((current - ytdStart) / ytdStart) * 100, avg: ytdAvg, high: ytdHigh, low: ytdLow },
    };
  } catch (e) {
    console.error("[VIX History]", e.message);
    return null;
  }
}

function computeIntermarketSignals(macro) {
  const signals = [];
  const vix = macro["^VIX"];
  if (vix && !vix.error) {
    const level = vix.price >= 30 ? "Extrem hoch" : vix.price >= 20 ? "Erhoht" : vix.price >= 15 ? "Normal" : "Niedrig";
    const signal = vix.price >= 30 ? "RISIKO" : vix.price >= 20 ? "VORSICHT" : vix.price >= 15 ? "NEUTRAL" : "GIER";
    signals.push({ indicator: "VIX", value: vix.price.toFixed(2), change: vix.change.toFixed(2), interpretation: level, signal });
  }
  const gold = macro["GC=F"];
  if (gold && !gold.error) {
    signals.push({ indicator: "Gold", value: gold.price.toFixed(2), change: gold.change.toFixed(2), interpretation: gold.change > 0 ? "steigend" : "fallend", signal: gold.change > 1 ? "RISK-OFF" : gold.change < -1 ? "RISK-ON" : "NEUTRAL" });
  }
  const tnx = macro["^TNX"];
  if (tnx && !tnx.error) {
    const dir = tnx.change > 0.02 ? "steigend" : tnx.change < -0.02 ? "fallend" : "stabil";
    const sig = tnx.price > 4.5 ? "RESTRIKTIV" : tnx.price < 3.5 ? "EXPANSIV" : "NEUTRAL";
    signals.push({ indicator: "10Y Yield", value: `${tnx.price.toFixed(2)}%`, change: tnx.change.toFixed(2), interpretation: dir, signal: sig });
  }
  const oil = macro["CL=F"];
  if (oil && !oil.error) {
    signals.push({ indicator: "WTI Oel", value: oil.price.toFixed(2), change: oil.change.toFixed(2), interpretation: oil.change > 0 ? "steigend" : "fallend", signal: Math.abs(oil.change) > 3 ? (oil.change > 0 ? "INFLATIONAER" : "DEFLATIONAER") : "NEUTRAL" });
  }
  const eur = macro["EURUSD=X"];
  if (eur && !eur.error) {
    signals.push({ indicator: "EUR/USD", value: eur.price.toFixed(4), change: eur.change.toFixed(2), interpretation: eur.change > 0 ? "EUR staerker" : "USD staerker", signal: "INFO" });
  }
  const btc = macro["BTC-USD"];
  if (btc && !btc.error) {
    signals.push({ indicator: "Bitcoin", value: btc.price.toFixed(0), change: btc.change.toFixed(2), interpretation: btc.change > 0 ? "Risk-On" : "Risk-Off", signal: Math.abs(btc.change) > 5 ? "VOLATIL" : "NEUTRAL" });
  }
  return signals;
}

function computeSectorRotation(scanResults, region) {
  const sectorMap = region === "EU" ? DAX_SECTORS : US_SECTORS;
  const sectors = {};

  for (const result of scanResults) {
    const sym = result.displaySymbol;
    let sectorName = null;
    for (const [sector, syms] of Object.entries(sectorMap)) {
      if (syms.includes(sym)) { sectorName = sector; break; }
    }
    if (!sectorName) continue; // Skip unknown sectors

    if (!sectors[sectorName]) sectors[sectorName] = { count: 0, totalSwing: 0, totalChange: 0, symbols: [] };
    sectors[sectorName].count++;
    sectors[sectorName].totalSwing += result.swing.total;
    sectors[sectorName].totalChange += result.change;
    sectors[sectorName].symbols.push({ symbol: sym, swingScore: result.swing.total, change: result.change });
  }

  return Object.entries(sectors)
    .map(([name, d]) => ({
      sector: name, hitCount: d.count,
      avgSwingScore: Math.round(d.totalSwing / d.count),
      avgChange: Math.round(d.totalChange / d.count * 100) / 100,
      topSymbols: d.symbols.sort((a, b) => b.swingScore - a.swingScore).slice(0, 3),
    }))
    .sort((a, b) => b.avgSwingScore - a.avgSwingScore);
}

function generateTradeSetups(scanResults, maxSetups = 5) {
  return scanResults
    .filter(r => r.swing.total >= 65 && r.price > 0)
    .slice(0, maxSetups)
    .map(r => {
      const entry = r.price;
      const stopDist = entry * 0.05;
      const stop = Math.round((entry - stopDist) * 100) / 100;
      const risk = entry - stop;
      const target = Math.round((entry + risk * 2) * 100) / 100;
      const crv = risk > 0 ? ((target - entry) / risk).toFixed(1) : "0";
      return {
        symbol: r.displaySymbol, currency: r.currency,
        swingScore: r.swing.total, intradayScore: r.intraday.total,
        combinedScore: r.combinedScore || Math.round(r.swing.total * 0.6 + r.intraday.total * 0.4),
        price: entry, change: r.change, entry: Math.round(entry * 100) / 100, stop, target, crv,
        signals: r.swing.signals.slice(0, 3), factors: r.swing.factors,
      };
    });
}

function getSeasonalContext() {
  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();
  const day = now.getDate();
  const cycleYear = year % 4; // 0=Election, 1=Post, 2=Midterm, 3=Pre

  const monthData = MONTHLY_SEASONALITY[month] || {};
  const cycleData = PRESIDENTIAL_CYCLE[cycleYear] || {};

  // Find upcoming events (next 14 days)
  const upcomingEvents = RECURRING_EVENTS_2026
    .filter(e => {
      const eventDate = new Date(year, e.month - 1, e.day);
      const diffDays = (eventDate - now) / (1000 * 60 * 60 * 24);
      return diffDays >= -1 && diffDays <= 14;
    })
    .map(e => ({ ...e, daysUntil: Math.ceil((new Date(year, e.month - 1, e.day) - now) / (1000 * 60 * 60 * 24)) }));

  // Midterm-specific context
  let midtermNote = null;
  if (cycleYear === 2) {
    if (month <= 6) midtermNote = "Midterm H1: Historisch schwaecher (Ø -1.5% S&P). Vorsichtig positionieren.";
    else if (month <= 9) midtermNote = "Midterm Sommer: Typisches Tief kommt in Sep/Okt. Geduld fuer den Bounce.";
    else midtermNote = "Midterm Q4: Historisch starke Rally! Ø +15% H2. Beste Phase fuer Swing-Trades.";
  }

  return {
    month, year,
    monthName: ["", "Januar", "Februar", "Maerz", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"][month],
    monthPattern: { sp500Avg: monthData.sp500 || 0, daxAvg: monthData.dax || 0, note: monthData.note || "" },
    presidentialCycle: { year: cycleYear, name: cycleData.name || "", sp500Avg: cycleData.sp500Avg || 0, note: cycleData.note || "" },
    midtermNote,
    upcomingEvents,
  };
}

async function generateBriefing(env, type) {
  const startTime = Date.now();

  // 1. Fetch macro data (12 symbols) + VIX history in parallel
  const [macro, vixHistory] = await Promise.all([fetchMacroData(), fetchVixHistory()]);

  // 2. Read latest scan results (1 KV read)
  const scanResults = (await env.NCAPITAL_KV.get("scan:results", "json")) || [];

  // 3. Compute analyses
  const intermarketSignals = computeIntermarketSignals(macro);
  const seasonalContext = getSeasonalContext();

  // 4. Build macro overview
  const macroOverview = Object.entries(MACRO_SYMBOLS).map(([category, symbols]) => ({
    category,
    items: symbols.map(s => ({ name: s.name, symbol: s.symbol, ...(macro[s.symbol] || { price: 0, change: 0, error: "Keine Daten" }) })),
  }));

  // 5. Region-specific content
  let regionFocus, scannerHits, sectorRotation, tradeSetups;
  if (type === "morning") {
    regionFocus = "EU";
    const daxResults = scanResults.filter(r => r.symbol.endsWith(".DE"));
    scannerHits = daxResults.slice(0, 15);
    sectorRotation = computeSectorRotation(daxResults, "EU");
    tradeSetups = generateTradeSetups(daxResults, 5);
  } else {
    regionFocus = "US";
    const usResults = scanResults.filter(r => !r.symbol.endsWith(".DE"));
    scannerHits = usResults.slice(0, 15);
    sectorRotation = computeSectorRotation(usResults, "US");
    tradeSetups = generateTradeSetups(usResults, 5);
  }

  // 6. Assemble briefing
  const briefing = {
    type, regionFocus,
    generatedAt: new Date().toISOString(),
    generationMs: Date.now() - startTime,
    seasonalContext,
    macroOverview,
    intermarketSignals,
    sectorRotation,
    scannerHits: scannerHits.map(r => ({
      symbol: r.displaySymbol, yahooSymbol: r.symbol, currency: r.currency,
      price: r.price, change: r.change,
      swingScore: r.swing.total, intradayScore: r.intraday.total,
      combinedScore: r.combinedScore || Math.round(r.swing.total * 0.6 + r.intraday.total * 0.4),
      signals: [...r.swing.signals, ...r.intraday.signals].slice(0, 4),
      factors: r.swing.factors,
    })),
    tradeSetups,
    futures: { es: macro["ES=F"] || null, nq: macro["NQ=F"] || null },
    vixHistory: vixHistory || null,
  };

  // 7. Store in KV (TTL 12h)
  await env.NCAPITAL_KV.put(`briefing:${type}`, JSON.stringify(briefing), { expirationTtl: 43200 });

  console.log(`[Briefing] ${type} generated in ${briefing.generationMs}ms. ${scannerHits.length} hits, ${tradeSetups.length} setups.`);
  return briefing;
}

// ─── Briefing Route Handlers ───

async function handleBriefingRoutes(url, request, env) {
  const path = url.pathname;

  // GET /api/briefing/latest — returns both, auto-generates if stale
  if (path === "/api/briefing/latest" && request.method === "GET") {
    const today = new Date().toISOString().slice(0, 10);
    const ceTime = getCETHour();

    let [morning, afternoon] = await Promise.all([
      env.NCAPITAL_KV.get("briefing:morning", "json"),
      env.NCAPITAL_KV.get("briefing:afternoon", "json"),
    ]);

    // Auto-generate morning if stale and after 07:30 CET
    if ((!morning || morning.generatedAt?.slice(0, 10) !== today) && ceTime >= 7.5) {
      morning = await generateBriefing(env, "morning");
    }
    // Auto-generate afternoon if stale and after 14:00 CET
    if ((!afternoon || afternoon.generatedAt?.slice(0, 10) !== today) && ceTime >= 14) {
      afternoon = await generateBriefing(env, "afternoon");
    }

    return jsonResponse({ morning, afternoon }, 200, 120);
  }

  // GET /api/briefing/morning or /api/briefing/afternoon
  if ((path === "/api/briefing/morning" || path === "/api/briefing/afternoon") && request.method === "GET") {
    const type = path.endsWith("morning") ? "morning" : "afternoon";
    const briefing = await env.NCAPITAL_KV.get(`briefing:${type}`, "json");
    if (!briefing) return jsonResponse({ error: `Kein ${type} Briefing verfuegbar` }, 404);
    return jsonResponse(briefing, 200, 120);
  }

  // POST /api/briefing/generate — manual trigger
  if (path === "/api/briefing/generate" && request.method === "POST") {
    let body;
    try { body = await request.json(); } catch { body = {}; }
    const type = body.type === "afternoon" ? "afternoon" : "morning";
    const briefing = await generateBriefing(env, type);
    return jsonResponse({ ok: true, type, generationMs: briefing.generationMs, hits: briefing.scannerHits.length, setups: briefing.tradeSetups.length });
  }

  return null;
}

// ─── HTTP Route Handlers ───

// Migrate old single subscription to array format (one-time, skips if already done)
let migrationDone = false;
async function migrateSubscriptions(env) {
  if (migrationDone) return;
  const oldSub = await env.NCAPITAL_KV.get("push:subscription", "json");
  if (oldSub) {
    const existing = (await env.NCAPITAL_KV.get("push:subscriptions", "json")) || [];
    if (!existing.some(s => s.endpoint === oldSub.endpoint)) {
      existing.push(oldSub);
      await env.NCAPITAL_KV.put("push:subscriptions", JSON.stringify(existing));
    }
    await env.NCAPITAL_KV.delete("push:subscription");
  }
  migrationDone = true;
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
    const [subs, state] = await Promise.all([
      env.NCAPITAL_KV.get("push:subscriptions", "json"),
      env.NCAPITAL_KV.get("scan:state", "json"),
    ]);
    return jsonResponse({
      subscribed: !!(subs && subs.length > 0),
      deviceCount: subs ? subs.length : 0,
      lastRun: state?.lastRun || null,
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

// ─── Scan Routes (/api/scan/*) ───

async function handleScanRoutes(url, request, env) {
  const path = url.pathname;

  // GET /api/scan/results — filtered scan results from KV (2 reads: results + state)
  if (path === "/api/scan/results" && request.method === "GET") {
    const [results, state] = await Promise.all([
      env.NCAPITAL_KV.get("scan:results", "json"),
      env.NCAPITAL_KV.get("scan:state", "json"),
    ]);
    return jsonResponse({ results: results || [], lastFullScan: state?.lastFullScan || null, count: (results || []).length }, 200, 60);
  }

  // GET /api/scan/status — scan progress info (mode-aware, 2 KV reads instead of 7)
  if (path === "/api/scan/status" && request.method === "GET") {
    const { mode: liveMode, symbols: liveSymbols } = getActiveSymbols();
    const [state, config, stats] = await Promise.all([
      env.NCAPITAL_KV.get("scan:state", "json"),
      env.NCAPITAL_KV.get("scan:config", "json"),
      env.NCAPITAL_KV.get("scan:stats", "json"),
    ]);
    const cfg = config || SCAN_DEFAULTS;
    const s = state || { pointer: 0, mode: null, totalChunks: 0, totalSymbols: 0, lastRun: null, lastFullScan: null, retryCount: 0 };
    const chunkSize = cfg.chunkSize || SCAN_DEFAULTS.chunkSize;

    return jsonResponse({
      currentChunk: s.pointer || 0,
      totalChunks: s.totalChunks || Math.ceil(liveSymbols.length / chunkSize),
      totalSymbols: s.totalSymbols || liveSymbols.length,
      sp500Count: SP500_SYMBOLS.length,
      dax40Count: DAX40_SYMBOLS.length,
      scanMode: s.mode || liveMode,
      liveMode,
      lastRun: s.lastRun,
      lastFullScan: s.lastFullScan,
      stats: stats || null,
      config: cfg,
      retryCount: s.retryCount || 0,
    }, 200, 0);
  }

  // POST /api/scan/reset — reset scan state (1 KV write instead of 4)
  if (path === "/api/scan/reset" && request.method === "POST") {
    const state = (await env.NCAPITAL_KV.get("scan:state", "json")) || {};
    state.pointer = 0;
    state.retryCount = 0;
    state.lastPointer = -1;
    state.mode = null;
    await env.NCAPITAL_KV.put("scan:state", JSON.stringify(state));
    return jsonResponse({ ok: true, message: "Scan pointer and mode reset" });
  }

  // POST /api/scan/config — update scan thresholds
  if (path === "/api/scan/config" && request.method === "POST") {
    let body;
    try { body = await request.json(); } catch { return jsonResponse({ error: "Invalid JSON" }, 400); }
    const current = (await env.NCAPITAL_KV.get("scan:config", "json")) || SCAN_DEFAULTS;
    const updated = {
      ...current,
      ...(body.threshold != null && { threshold: Math.max(0, Math.min(100, body.threshold)) }),
      ...(body.notifyThreshold != null && { notifyThreshold: Math.max(0, Math.min(100, body.notifyThreshold)) }),
    };
    await env.NCAPITAL_KV.put("scan:config", JSON.stringify(updated));
    return jsonResponse({ ok: true, config: updated });
  }

  // GET /api/scan/debug — raw chunk data for debugging
  if (path === "/api/scan/debug" && request.method === "GET") {
    const chunk = await env.NCAPITAL_KV.get("scan:chunk:0", "json");
    if (!chunk) return jsonResponse({ error: "No chunk data" }, 404);
    const summary = chunk.map((r) => ({
      symbol: r.symbol,
      price: r.price,
      swing: r.swing.total,
      intraday: r.intraday.total,
      swingErr: r.swing.error || null,
      intradayErr: r.intraday.error || null,
    }));
    return jsonResponse({ count: chunk.length, errors: summary.filter((s) => s.swingErr || s.intradayErr).length, data: summary });
  }

  return null;
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

    // ── Scan Routes ──
    if (url.pathname.startsWith("/api/scan/")) {
      const resp = await handleScanRoutes(url, request, env);
      if (resp) return resp;
      return jsonResponse({ error: "Unknown scan endpoint" }, 404);
    }

    // ── Briefing Routes ──
    if (url.pathname.startsWith("/api/briefing/")) {
      const resp = await handleBriefingRoutes(url, request, env);
      if (resp) return resp;
      return jsonResponse({ error: "Unknown briefing endpoint" }, 404);
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
        error: "Not found. Use /api/chart/{symbol}, /api/batch, /api/push/*, /api/scan/*, or /api/briefing/*",
        endpoints: [
          "/api/chart/AAPL?range=1y&interval=1d",
          "/api/batch?symbols=AAPL,MSFT,NVDA&range=1y&interval=1d",
          "/api/push/vapid-public-key",
          "/api/push/status",
          "/api/briefing/latest",
          "/api/briefing/morning",
          "/api/briefing/afternoon",
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
    ctx.waitUntil(runChunkedScan(env));
  },
};
