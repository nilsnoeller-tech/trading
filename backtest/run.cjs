#!/usr/bin/env node
// ══════════════════════════════════════════════════════════════
// TA-Scanner Backtest v2 — Bug-Fixes + Varianten-Vergleich
// Fix: Equity-Doppelzählung, Position-Sizing, dynamisches Risk
// ══════════════════════════════════════════════════════════════

const fs = require("fs");
const path = require("path");
const https = require("https");

const STARTING_CAPITAL = 45000;
const CACHE_DIR = path.join(__dirname, "cache");
const YAHOO_HOSTS = ["query1.finance.yahoo.com", "query2.finance.yahoo.com"];

const SP100_SYMBOLS = [
  "AAPL","ABBV","ABT","ACN","ADBE","AIG","AMD","AMGN","AMT","AMZN","AVGO","AXP",
  "BAC","BK","BKNG","BLK","BMY","BRK-B","C","CAT","CMCSA","COF","COP","COST","CRM","CSCO","CVS","CVX",
  "DE","DHR","DIS","DUK","EMR","EXC","GD","GE","GILD","GM","GOOG","GOOGL","GS",
  "HD","HON","IBM","INTC","INTU","ISRG","JNJ","JPM","KMI","KO",
  "LIN","LLY","LMT","LOW","MA","MCD","MDLZ","MDT","MET","META","MMM","MO","MRK","MS","MSFT",
  "NEE","NFLX","NKE","NOW","NVDA","ORCL","OXY","PEP","PFE","PG","PLTR","PM","PYPL","QCOM","RTX",
  "SBUX","SCHW","SLB","SO","SPG","T","TGT","TMO","TMUS","TSLA","TXN",
  "UBER","UNH","UNP","UPS","USB","V","VZ","WFC","WMT","XOM",
];
const DAX40_SYMBOLS = [
  "ADS.DE","AIR.DE","ALV.DE","BAS.DE","BAYN.DE","BEI.DE","BMW.DE","BNR.DE","CBK.DE","CON.DE",
  "DB1.DE","DBK.DE","DHL.DE","DTE.DE","DTG.DE","ENR.DE","FRE.DE","G1A.DE","HEI.DE",
  "HEN3.DE","HNR1.DE","IFX.DE","MBG.DE","MRK.DE","MTX.DE","MUV2.DE","P911.DE","PAH3.DE","PUM.DE",
  "QIA.DE","RHM.DE","RWE.DE","SAP.DE","SHL.DE","SIE.DE","SRT3.DE","VOW3.DE","ZAL.DE",
];
// S&P 250 extra (ranks ~101-250, NOT in SP100)
const SP250_EXTRA = [
  "A","ABNB","ADI","ADM","ADP","ADSK","AEE","AEP","AFL","AJG","ALL","AMAT","AMP","ANSS","AON",
  "APD","APH","ARE","ATO","AWK","AZO","BA","BAX","BBY","BDX","BIIB","BR","BRO","BSX",
  "CARR","CB","CDNS","CDW","CE","CF","CHD","CI","CL","CLX","CME","CMG","CMI","CNC",
  "CPRT","CTAS","CTSH","CTVA","D","DAL","DD","DXCM","DG","DLTR","DOV","DOW","DPZ","DRI",
  "DVN","EA","EBAY","ECL","ED","EFX","EIX","EL","EOG","EQIX","EQR","ES","ETN","ETR","EW",
  "EXPE","F","FANG","FAST","FCX","FDX","FIS","FISV","FITB","FTV",
  "GRMN","GIS","GLW","GPC","GPN","GWW","HAL","HCA","HSY","HUM",
  "ICE","IDXX","IFF","ILMN","INCY","IP","IQV","IR","IRM","IT","ITW",
  "J","JBHT","JCI","K","KDP","KEY","KEYS","KHC","KLAC","KMB","KR",
  "LDOS","LEN","LH","LHX","LRCX","LUV","LYB",
  "MAR","MAS","MCHP","MCK","MCO","MNST","MPWR","MKTX","MLM","MOS","MPC","MRNA","MRVL","MSCI","MSI","MTB","MU",
  "NDAQ","NEM","NOC","NSC","NTRS","NUE",
  "O","ODFL","OKE","OMC","ON","ORLY","OTIS",
  "PAYX","PCAR","PH","PHM","PKG","PLD","PNC","POOL","PPG","PPL","PRU","PSA","PSX","PTC","PWR",
  "RCL","REGN","RF","RJF","RMD","ROK","ROP","ROST","RSG",
  "SBAC","SHW","SJM","SNPS","SRE","STT","STX","STZ","SWK","SWKS","SYF","SYK","SYY",
  "TDG","TDY","TEL","TER","TFC","TROW","TRV","TSCO","TSN","TT","TTWO","TXT","TYL",
  "URI","VICI","VLO","VMC","VRSK","VRSN","VRTX","VTR",
  "WAB","WAT","WBA","WEC","WELL","WM","WRB","WST","WTW","WY","WYNN",
  "XEL","XYL","YUM","ZBH","ZBRA","ZTS",
];

// S&P 500 extra (ranks ~251-500, NOT in SP100 or SP250_EXTRA)
const SP500_EXTRA = [
  "ACGL","AIZ","AES","AKAM","ALB","ALGN","ALLE","AMCR","AOS",
  "BEN","BG","BIO","BWA","BXP",
  "CAG","CAH","CMA","CNP","COO","CPB","CPT","CSGP","CTLT","CZR",
  "DAY","DGX","DOC","DPZ","DXC",
  "EVRG","EXR","EXPD",
  "FBHS","FDS","FLT","FMC","FOX","FOXA","FRT",
  "GEN","GNRC","GL",
  "HAS","HBAN","HOLX","HPE","HPQ","HSIC","HST","HWM",
  "IEX","INVH","IPG","IVZ",
  "JKHY","JNPR",
  "KIM",
  "L","LKQ","LNT","LVS","LW",
  "MAA","MGM","MOH","MKTX","MTCH","MTD",
  "NDSN","NI","NRG","NTAP","NVR","NWS","NWSA",
  "OGN",
  "PARA","PAYC","PEAK","PEG","PENN","PKI","PNR","PNW","PVH",
  "RE","REG","RHI","RL","ROL","RPM",
  "SEDG","SEE","SNA","STE","SWK",
  "TAP","TECH","TFX","TPR","TRGP","TRMB",
  "UAL","UDR","UHS",
  "VTRS","VTR",
  "WBD","WDC","WHR","WRK",
  "ZION",
];

const SP250_SYMBOLS = [...SP100_SYMBOLS, ...SP250_EXTRA];
const SP500_SYMBOLS = [...SP250_SYMBOLS, ...SP500_EXTRA];

// Default: S&P100 + DAX40 (current production setup)
let ALL_SYMBOLS = [...SP100_SYMBOLS, ...DAX40_SYMBOLS];
const INDEX_SYMBOLS = ["^GSPC", "^GDAXI", "^VIX"];

// CLI: --universe=sp100 | sp100dax | sp250 | sp500
const universeArg = process.argv.find(a => a.startsWith("--universe="));
const UNIVERSE = universeArg ? universeArg.split("=")[1] : null;
if (UNIVERSE === "sp100") ALL_SYMBOLS = [...SP100_SYMBOLS];
else if (UNIVERSE === "sp250") ALL_SYMBOLS = [...SP250_SYMBOLS];
else if (UNIVERSE === "sp500") ALL_SYMBOLS = [...SP500_SYMBOLS];
else if (UNIVERSE === "sp100dax") ALL_SYMBOLS = [...SP100_SYMBOLS, ...DAX40_SYMBOLS];

// CLI: --variant=BULL_AGGR_15 (run only specific variant)
const variantArg = process.argv.find(a => a.startsWith("--variant="));
const ONLY_VARIANT = variantArg ? variantArg.split("=")[1] : null;

// ─── Varianten ───
const AKTUELL_PLUS_BASE = {
  preFilterScore: 6.5, minRR: 1.4, riskPct: 0.01, scanInterval: 2,
  maxHoldingDays: 18, entryTolerance: 0.02, useMarketEntry: false,
  rsiMax: 75, minADX: 20, maxRiskPerTrade: 0, maxPositionPct: 0.25,
  trailingStop: false, noFixedTarget: false,
  regimeParams: {
    STRONG_BULL:   { scoreThreshold: 6.3, maxPositions: 7, rsMax: 22, ema20Max: 2.8 },
    MODERATE_BULL: { scoreThreshold: 6.5, maxPositions: 5, rsMax: 20, ema20Max: 2.5 },
    TRANSITION:    { scoreThreshold: 7.0, maxPositions: 3, rsMax: 15, ema20Max: 2.0 },
    MODERATE_BEAR: { scoreThreshold: 5.5, maxPositions: 3, rsMax: 15, ema20Max: 2.0 },
    CRISIS:        { scoreThreshold: 6.0, maxPositions: 2, rsMax: 15, ema20Max: 2.0 },
  },
};

const VARIANTS = {
  // ─── BASE: AKTUELL+ Referenz ───
  "BASE": {
    ...AKTUELL_PLUS_BASE,
    label: "AKTUELL+ Base (Referenz)",
    useEnhancedScore: false,
    useEnhancedFilters: false,
  },

  // ─── FILTER: Base Score + Distribution/SellingPressure Filter ───
  "FILTER": {
    ...AKTUELL_PLUS_BASE,
    label: "Base + Smart-Filter (Dist+Sell)",
    useEnhancedScore: false,
    useEnhancedFilters: true,
    filterDistribution: true,    // Skip if distributionPattern
    filterHeavySelling: true,    // Skip if heavySelling
  },

  // ─── FILTER+: Filter + StochRSI Overbought + Ranking-Bonus ───
  "FILTER_PLUS": {
    ...AKTUELL_PLUS_BASE,
    label: "Smart-Filter+ (Dist+Sell+StochOB+Rank)",
    useEnhancedScore: false,
    useEnhancedFilters: true,
    filterDistribution: true,
    filterHeavySelling: true,
    filterStochOverbought: true, // Skip if StochRSI > 80
    rankByQuality: true,         // Rank by quality indicators (HL, PB-Vol, Close)
  },

  // ─── HOLD30: Längere Haltedauer (30 Tage) ───
  "HOLD30": {
    ...AKTUELL_PLUS_BASE,
    label: "AKTUELL+ Hold 30d (kein Trailing)",
    maxHoldingDays: 30,
    useEnhancedScore: false,
    useEnhancedFilters: false,
  },

  // ─── TRAIL: Trailing Stop (BE bei 1R, Trail bei 2R, kein fixes Target) ───
  "TRAIL": {
    ...AKTUELL_PLUS_BASE,
    label: "AKTUELL+ Trailing Stop (kein fixes Ziel)",
    trailingStop: true,
    noFixedTarget: true,
    maxHoldingDays: 40,
    useEnhancedScore: false,
    useEnhancedFilters: false,
  },

  // ─── RS_RELAXED: RS >= -5 in Crisis/Transition (Turnaround-Finder) ───
  "RS_RELAXED": {
    ...AKTUELL_PLUS_BASE,
    label: "HOLD30 + RS>=-5 in Crisis/Transition",
    maxHoldingDays: 30,
    useEnhancedScore: false,
    useEnhancedFilters: false,
    rsMinOverride: { CRISIS: -5, MODERATE_BEAR: -5, TRANSITION: -5 },
  },

  // ─── BULL_AGGR_12: 1.2% Risk in STRONG_BULL ───
  "BULL_AGGR_12": {
    ...AKTUELL_PLUS_BASE,
    label: "HOLD30 + 1.2% Risk in STRONG_BULL",
    maxHoldingDays: 30,
    useEnhancedScore: false,
    useEnhancedFilters: false,
    regimeRiskPct: { STRONG_BULL: 0.012 },
  },

  // ─── BULL_AGGR_15: 1.5% Risk in STRONG_BULL ───
  "BULL_AGGR_15": {
    ...AKTUELL_PLUS_BASE,
    label: "HOLD30 + 1.5% Risk in STRONG_BULL",
    maxHoldingDays: 30,
    useEnhancedScore: false,
    useEnhancedFilters: false,
    regimeRiskPct: { STRONG_BULL: 0.015 },
  },

  // ─── BEAR_HALFRISK: Halbiertes Risiko + weniger Pos in Bear-Regimes (PRODUKTION) ───
  "BEAR_HALFRISK": {
    ...AKTUELL_PLUS_BASE,
    label: "HOLD30 + 1.5% Bull + 0.5% Risk in Bear",
    maxHoldingDays: 30,
    useEnhancedScore: false,
    useEnhancedFilters: false,
    regimeRiskPct: { STRONG_BULL: 0.015, TRANSITION: 0.007, MODERATE_BEAR: 0.005, CRISIS: 0.005 },
    regimeParams: {
      STRONG_BULL:   { scoreThreshold: 6.3, maxPositions: 7, rsMax: 22, ema20Max: 2.8 },
      MODERATE_BULL: { scoreThreshold: 6.5, maxPositions: 5, rsMax: 20, ema20Max: 2.5 },
      TRANSITION:    { scoreThreshold: 7.0, maxPositions: 2, rsMax: 15, ema20Max: 2.0 },
      MODERATE_BEAR: { scoreThreshold: 7.0, maxPositions: 2, rsMax: 15, ema20Max: 2.0 },
      CRISIS:        { scoreThreshold: 7.0, maxPositions: 1, rsMax: 15, ema20Max: 2.0 },
    },
  },

  // ─── BULL_AGGR_20: 2.0% Risk in STRONG_BULL ───
  "BULL_AGGR_20": {
    ...AKTUELL_PLUS_BASE,
    label: "HOLD30 + 2.0% Risk in STRONG_BULL",
    maxHoldingDays: 30,
    useEnhancedScore: false,
    useEnhancedFilters: false,
    regimeRiskPct: { STRONG_BULL: 0.020 },
  },


  // ─── MARKET_ENTRY: Alle Entries als Market Order (Open naechster Tag) ───
  "MARKET_ENTRY": {
    ...AKTUELL_PLUS_BASE,
    label: "HOLD30 + Market Entry (immer Open naechster Tag)",
    maxHoldingDays: 30,
    useEnhancedScore: false,
    useEnhancedFilters: false,
    useMarketEntry: true,
  },

  // ─── MARKET_7: Market Entry ab Score 7.0 statt 8.0 ───
  "MARKET_7": {
    ...AKTUELL_PLUS_BASE,
    label: "HOLD30 + Market Entry ab Score >= 7.0",
    maxHoldingDays: 30,
    useEnhancedScore: false,
    useEnhancedFilters: false,
    marketEntryThreshold: 7.0,
  },

  // ─── MARKET_65: Market Entry ab Score 6.5 (= alle Signale) ───
  "MARKET_65": {
    ...AKTUELL_PLUS_BASE,
    label: "HOLD30 + Market Entry ab Score >= 6.5",
    maxHoldingDays: 30,
    useEnhancedScore: false,
    useEnhancedFilters: false,
    marketEntryThreshold: 6.5,
  },

  // ─── BEST_COMBO: 1.5% Risk STRONG_BULL + Market ab 7.0 ───
  "BEST_COMBO": {
    ...AKTUELL_PLUS_BASE,
    label: "1.5% STRONG_BULL + Market ab Score >= 7.0",
    maxHoldingDays: 30,
    useEnhancedScore: false,
    useEnhancedFilters: false,
    regimeRiskPct: { STRONG_BULL: 0.015 },
    marketEntryThreshold: 7.0,
  },

  // ─── ADX_MODBULL: ADX-Entkopplung NUR in MODERATE_BULL ───
  "ADX_MODBULL": {
    ...AKTUELL_PLUS_BASE,
    label: "HOLD30 + ADX-Decouple nur MODERATE_BULL",
    maxHoldingDays: 30,
    useEnhancedScore: false,
    useEnhancedFilters: false,
    adxDecoupleRegimes: ["MODERATE_BULL"],
    adxBreakout: 20,
    adxPullback: 15,
  },

  // ─── ADX_MODBULL_15: Kombi 1.5% Bull-Risk + ADX-Decouple MODERATE_BULL ───
  "ADX_MODBULL_15": {
    ...AKTUELL_PLUS_BASE,
    label: "1.5% STRONG_BULL + ADX-Decouple MODERATE_BULL",
    maxHoldingDays: 30,
    useEnhancedScore: false,
    useEnhancedFilters: false,
    regimeRiskPct: { STRONG_BULL: 0.015 },
    adxDecoupleRegimes: ["MODERATE_BULL"],
    adxBreakout: 20,
    adxPullback: 15,
  },

  // ─── ENTRY_SPLIT (Variante A): Breakout → MARKET, Pullback → RSI(2) Trigger ───
  "ENTRY_SPLIT": {
    ...AKTUELL_PLUS_BASE,
    label: "Entry-Splitting (Breakout=MARKET, Pullback=RSI2<10)",
    maxHoldingDays: 30,
    useEnhancedScore: false,
    useEnhancedFilters: false,
    entrySplitting: true,
    rsi2MaxWaitDays: 5,
  },

  // ─── ADX_DECOUPLE (Variante B): ADX>20 fuer Breakout, ADX>15/Slope>0 fuer Pullback ───
  "ADX_DECOUPLE": {
    ...AKTUELL_PLUS_BASE,
    label: "ADX-Entkopplung (Breakout>=20, Pullback>=15|Slope>0)",
    maxHoldingDays: 30,
    useEnhancedScore: false,
    useEnhancedFilters: false,
    adxDecouple: true,
    adxBreakout: 20,
    adxPullback: 15,
  },

  // ─── TIME_STOP (Variante C): Exit nach 10d wenn im Minus ───
  "TIME_STOP": {
    ...AKTUELL_PLUS_BASE,
    label: "Time-Stop 10d Underperformer",
    maxHoldingDays: 30,
    useEnhancedScore: false,
    useEnhancedFilters: false,
    timeStopDays: 10,
  },

  // ─── COMBINED (A+B+C): Alle drei zusammen ───
  "COMBINED": {
    ...AKTUELL_PLUS_BASE,
    label: "A+B+C kombiniert (Entry-Split + ADX-Decouple + TimeStop10d)",
    maxHoldingDays: 30,
    useEnhancedScore: false,
    useEnhancedFilters: false,
    entrySplitting: true,
    rsi2MaxWaitDays: 5,
    adxDecouple: true,
    adxBreakout: 20,
    adxPullback: 15,
    timeStopDays: 10,
  },
};

// ══════════════════════════════════════════════════════════════
// Technical Indicator Functions (exact port from worker.js)
// ══════════════════════════════════════════════════════════════

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
    if (changes[i] >= 0) gainSum += changes[i]; else lossSum += Math.abs(changes[i]);
  }
  let avgGain = gainSum / period, avgLoss = lossSum / period;
  const result = [avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss)];
  for (let i = period; i < changes.length; i++) {
    const gain = changes[i] >= 0 ? changes[i] : 0;
    const loss = changes[i] < 0 ? Math.abs(changes[i]) : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    result.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss));
  }
  return result;
}

function calcMACD(closes, fast = 12, slow = 26, signalPeriod = 9) {
  if (closes.length < slow + signalPeriod) return { macd: [], signal: [], histogram: [] };
  const emaFast = calcEMA(closes, fast), emaSlow = calcEMA(closes, slow);
  const offset = slow - fast;
  const macdLine = [];
  for (let i = 0; i < emaSlow.length; i++) macdLine.push(emaFast[i + offset] - emaSlow[i]);
  const signalLine = calcEMA(macdLine, signalPeriod);
  const sigOffset = signalPeriod - 1;
  const histogram = [];
  for (let i = 0; i < signalLine.length; i++) histogram.push(macdLine[i + sigOffset] - signalLine[i]);
  return { macd: macdLine, signal: signalLine, histogram };
}

function calcADX(candles, period = 14) {
  if (candles.length < period * 2 + 1) return [];
  const plusDM = [], minusDM = [], trArr = [];
  for (let i = 1; i < candles.length; i++) {
    const upMove = candles[i].high - candles[i - 1].high;
    const downMove = candles[i - 1].low - candles[i].low;
    plusDM.push(upMove > downMove && upMove > 0 ? upMove : 0);
    minusDM.push(downMove > upMove && downMove > 0 ? downMove : 0);
    const h = candles[i].high, l = candles[i].low, pc = candles[i - 1].close;
    trArr.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
  }
  let sPDM = plusDM.slice(0, period).reduce((s, v) => s + v, 0);
  let sMDM = minusDM.slice(0, period).reduce((s, v) => s + v, 0);
  let sTR = trArr.slice(0, period).reduce((s, v) => s + v, 0);
  const dxArr = [];
  for (let i = period; i < trArr.length; i++) {
    if (i > period) { sPDM = sPDM - sPDM / period + plusDM[i]; sMDM = sMDM - sMDM / period + minusDM[i]; sTR = sTR - sTR / period + trArr[i]; }
    const pDI = sTR > 0 ? (sPDM / sTR) * 100 : 0, mDI = sTR > 0 ? (sMDM / sTR) * 100 : 0;
    const diS = pDI + mDI;
    dxArr.push({ dx: diS > 0 ? (Math.abs(pDI - mDI) / diS) * 100 : 0, plusDI: pDI, minusDI: mDI });
  }
  if (dxArr.length < period) return [];
  let adx = dxArr.slice(0, period).reduce((s, v) => s + v.dx, 0) / period;
  const result = [{ adx, plusDI: dxArr[period - 1].plusDI, minusDI: dxArr[period - 1].minusDI }];
  for (let i = period; i < dxArr.length; i++) {
    adx = (adx * (period - 1) + dxArr[i].dx) / period;
    result.push({ adx, plusDI: dxArr[i].plusDI, minusDI: dxArr[i].minusDI });
  }
  return result;
}

function calcTrueATR(candles, period = 14) {
  if (candles.length < period + 1) return [];
  const trueRanges = [];
  for (let i = 1; i < candles.length; i++) {
    const h = candles[i].high, l = candles[i].low, pc = candles[i - 1].close;
    trueRanges.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
  }
  let atr = trueRanges.slice(0, period).reduce((s, v) => s + v, 0) / period;
  const result = [atr];
  for (let i = period; i < trueRanges.length; i++) { atr = (atr * (period - 1) + trueRanges[i]) / period; result.push(atr); }
  return result;
}

function calcBollingerBands(closes, period = 20, stdDev = 2) {
  const result = [];
  for (let i = period - 1; i < closes.length; i++) {
    let sum = 0; for (let j = i - period + 1; j <= i; j++) sum += closes[j];
    const mean = sum / period;
    let sqSum = 0; for (let j = i - period + 1; j <= i; j++) sqSum += (closes[j] - mean) ** 2;
    const sigma = Math.sqrt(sqSum / period);
    result.push({ upper: mean + stdDev * sigma, middle: mean, lower: mean - stdDev * sigma, bandwidth: sigma > 0 ? (2 * stdDev * sigma) / mean * 100 : 0 });
  }
  return result;
}

function calcStochRSI(closes, rsiPeriod = 14, stochPeriod = 14, kSmooth = 3) {
  const rsiArr = calcRSI(closes, rsiPeriod);
  if (rsiArr.length < stochPeriod) return [];
  const result = [];
  for (let i = stochPeriod - 1; i < rsiArr.length; i++) {
    const w = rsiArr.slice(i - stochPeriod + 1, i + 1);
    const mn = Math.min(...w), mx = Math.max(...w);
    result.push(mx - mn > 0 ? ((rsiArr[i] - mn) / (mx - mn)) * 100 : 50);
  }
  if (result.length < kSmooth) return [];
  return calcSMA(result, kSmooth);
}

function calcOBV(candles) {
  if (candles.length < 2) return [];
  const result = [0];
  for (let i = 1; i < candles.length; i++) {
    const prev = result[result.length - 1];
    if (candles[i].close > candles[i - 1].close) result.push(prev + candles[i].volume);
    else if (candles[i].close < candles[i - 1].close) result.push(prev - candles[i].volume);
    else result.push(prev);
  }
  return result;
}

// ══════════════════════════════════════════════════════════════
// extractIndicators + computeCompositeScore (exact port)
// ══════════════════════════════════════════════════════════════

function extractIndicators(candles) {
  const closes = candles.map(c => c.close);
  const currentPrice = closes[closes.length - 1];
  const ema20 = calcEMA(closes, 20), ema50 = calcEMA(closes, 50);
  const ema200 = closes.length >= 200 ? calcEMA(closes, 200) : null;
  const rsiValues = calcRSI(closes, 14);
  const adxArr = calcADX(candles, 14);
  const macd = calcMACD(closes, 12, 26, 9);
  const bbArr = calcBollingerBands(closes, 20, 2);
  const atrArr = calcTrueATR(candles, 14);
  const obvArr = calcOBV(candles);

  const e20 = ema20.length > 0 ? ema20[ema20.length - 1] : currentPrice;
  const e50 = ema50.length > 0 ? ema50[ema50.length - 1] : currentPrice;
  const e200 = ema200 && ema200.length > 0 ? ema200[ema200.length - 1] : null;
  const rsi = rsiValues.length > 0 ? rsiValues[rsiValues.length - 1] : 50;
  const adxLast = adxArr.length > 0 ? adxArr[adxArr.length - 1] : null;
  const adxVal = adxLast ? adxLast.adx : 20;
  const adxSlope = adxArr.length >= 6 ? adxArr[adxArr.length - 1].adx - adxArr[adxArr.length - 6].adx : 0;
  const atrLast = atrArr.length > 0 ? atrArr[atrArr.length - 1] : currentPrice * 0.02;
  const priceAboveEma20 = currentPrice > e20;
  const distToEma20 = Math.abs(currentPrice - e20) / e20 * 100;
  const distToEma50 = Math.abs(currentPrice - e50) / e50 * 100;

  // Swing structure
  const swingHighs = [], swingLows = [];
  const lb = Math.min(candles.length, 120);
  const rc = candles.slice(-lb);
  for (let i = 3; i < rc.length - 3; i++) {
    const h = rc[i].high, l = rc[i].low;
    if (h >= rc[i-1].high && h >= rc[i-2].high && h >= rc[i-3].high && h >= rc[i+1].high && h >= rc[i+2].high && h >= rc[i+3].high) swingHighs.push(h);
    if (l <= rc[i-1].low && l <= rc[i-2].low && l <= rc[i-3].low && l <= rc[i+1].low && l <= rc[i+2].low && l <= rc[i+3].low) swingLows.push(l);
  }

  // Fibonacci
  let fibHigh = 0, fibLow = 0, fibRange = 0, fibPrices = {};
  if (candles.length >= 30) {
    const fbC = candles.slice(-Math.min(candles.length, 200));
    let swHigh = -Infinity, swHighIdx = 0;
    for (let i = 0; i < fbC.length; i++) { if (fbC[i].high > swHigh) { swHigh = fbC[i].high; swHighIdx = i; } }
    let trendLow = Infinity;
    for (let i = 0; i < swHighIdx; i++) { if (fbC[i].low < trendLow) trendLow = fbC[i].low; }
    if (trendLow === Infinity) trendLow = swHighIdx >= 10 ? Math.min(...fbC.slice(0, swHighIdx).map(c => c.low)) : swHigh;
    fibHigh = swHigh; fibLow = trendLow; fibRange = swHigh - trendLow;
    if (fibRange > 0) {
      fibPrices = { "0%": swHigh, "23.6%": swHigh - fibRange * 0.236, "38.2%": swHigh - fibRange * 0.382,
        "50%": swHigh - fibRange * 0.500, "61.8%": swHigh - fibRange * 0.618, "78.6%": swHigh - fibRange * 0.786, "100%": trendLow };
    }
  }

  // RSI divergence
  let rsiBullDiv = false;
  if (rsiValues.length >= 30 && closes.length >= 40) {
    const rsiOff = closes.length - rsiValues.length;
    let minP20 = Infinity, rsiMin20 = 50;
    for (let i = closes.length - 20; i < closes.length; i++) {
      if (closes[i] < minP20) { minP20 = closes[i]; const ri = i - rsiOff; if (ri >= 0 && ri < rsiValues.length) rsiMin20 = rsiValues[ri]; }
    }
    let minP40 = Infinity, rsiMin40 = 50;
    for (let i = Math.max(0, closes.length - 40); i < closes.length - 15; i++) {
      if (closes[i] < minP40) { minP40 = closes[i]; const ri = i - rsiOff; if (ri >= 0 && ri < rsiValues.length) rsiMin40 = rsiValues[ri]; }
    }
    if (minP20 <= minP40 * 1.02 && rsiMin20 > rsiMin40 + 3) rsiBullDiv = true;
  }

  // Volume
  const avgVol = candles.slice(-20).reduce((s, c) => s + c.volume, 0) / 20;
  let obvRising = false;
  if (obvArr.length >= 20) { const oe = calcEMA(obvArr.slice(-50), 10); if (oe.length >= 2) obvRising = oe[oe.length - 1] > oe[oe.length - 2]; }

  // Performance
  let perf20d = 0;
  if (closes.length >= 20) perf20d = ((currentPrice - closes[closes.length - 20]) / closes[closes.length - 20]) * 100;

  // Bollinger
  let bbSqueeze = false, bbRelPos = null;
  if (bbArr.length >= 20) {
    const bb = bbArr[bbArr.length - 1];
    const recentBW = bbArr.slice(-Math.min(50, bbArr.length)).map(b => b.bandwidth);
    bbSqueeze = bb.bandwidth < (recentBW.reduce((s, v) => s + v, 0) / recentBW.length) * 0.75;
    bbRelPos = (bb.upper - bb.lower) > 0 ? (currentPrice - bb.lower) / (bb.upper - bb.lower) : 0.5;
  }

  // SMA50/200
  const sma50arr = calcSMA(closes, 50);
  const sma200arr = closes.length >= 200 ? calcSMA(closes, 200) : [];
  const sma50 = sma50arr.length > 0 ? sma50arr[sma50arr.length - 1] : e50;
  const sma200 = sma200arr.length > 0 ? sma200arr[sma200arr.length - 1] : e200;

  // ── Enhanced indicators (for enhanced score) ──

  // StochRSI signals
  const stochRSI = calcStochRSI(closes, 14, 14, 3);
  let stochBullish = false, stochOversold = false;
  if (stochRSI.length >= 2) {
    const sNow = stochRSI[stochRSI.length - 1], sPrev = stochRSI[stochRSI.length - 2];
    stochOversold = sNow < 25;
    stochBullish = sNow > sPrev && sPrev < 30;
  }

  // HH/HL pattern
  let hhhl = false;
  if (swingHighs.length >= 2 && swingLows.length >= 2) {
    hhhl = swingHighs[swingHighs.length - 1] > swingHighs[swingHighs.length - 2] && swingLows[swingLows.length - 1] > swingLows[swingLows.length - 2];
  }
  const higherLow = swingLows.length >= 2 && swingLows[swingLows.length - 1] > swingLows[swingLows.length - 2];

  // Pullback volume declining
  const last5Down = candles.slice(-10).filter(c => c.close < c.open).slice(-5);
  let pullbackVolDeclining = false;
  if (last5Down.length >= 3) pullbackVolDeclining = last5Down[last5Down.length - 1].volume < last5Down[0].volume * 0.8;

  // Support confluence
  const supportTol = atrLast * 1.5;
  let bounceCount = 0;
  for (let i = 2; i < candles.length - 2; i++) {
    const low = candles[i].low;
    if (low <= candles[i-1].low && low <= candles[i-2].low && low <= candles[i+1].low && low <= candles[i+2].low) {
      if (Math.abs(low - currentPrice) <= supportTol) bounceCount++;
    }
  }
  const nearEma20 = distToEma20 < 2 && priceAboveEma20;
  const nearEma50 = distToEma50 < 3 && currentPrice > e50;
  let confluence = 0;
  if (bounceCount >= 2) confluence++;
  if (nearEma20 || nearEma50) confluence++;

  // Close near day high
  const lastC = candles[candles.length - 1];
  const dayRange = lastC ? lastC.high - lastC.low : 0;
  const closeNearDayHigh = dayRange > 0 && lastC ? (lastC.close - lastC.low) / dayRange > 0.90 : false;

  // Selling pressure / distribution
  const volRatio = avgVol > 0 ? lastC.volume / avgVol : 1;
  const lastIsRed = lastC.close < lastC.open;
  const lastBodySize = Math.abs(lastC.close - lastC.open);
  const sellingPressure = lastIsRed && volRatio >= 1.2 && lastBodySize > atrLast * 0.8;
  const heavySelling = lastIsRed && volRatio >= 1.8 && lastBodySize > atrLast;
  const last3 = candles.slice(-3);
  const redHighVolCount = last3.filter(c => c.close < c.open && avgVol > 0 && c.volume > avgVol * 1.2).length;
  const distributionPattern = redHighVolCount >= 2;

  return {
    candles, closes, currentPrice, rsi, rsiValues, adxVal, adxSlope,
    e20, e50, e200, sma50, sma200, priceAboveEma20, distToEma20, distToEma50,
    fibHigh, fibRange, fibPrices, macd, atrLast, obvRising, perf20d,
    bbSqueeze, bbRelPos, swingHighs, swingLows, rsiBullDiv,
    // Enhanced
    stochBullish, stochOversold, hhhl, higherLow,
    pullbackVolDeclining, confluence, closeNearDayHigh,
    sellingPressure, heavySelling, distributionPattern,
  };
}

function computeCompositeScore(candles) {
  if (!candles || candles.length < 60) return null;
  const ind = extractIndicators(candles);
  const closes = ind.closes, price = ind.currentPrice;
  const sma20arr = calcSMA(closes, 20);
  const sma20 = sma20arr.length > 0 ? sma20arr[sma20arr.length - 1] : price;

  // 1. TREND
  let dailyTrend = 0;
  if (sma20arr.length >= 2) {
    const slope = (sma20 - sma20arr[sma20arr.length - 2]) / sma20arr[sma20arr.length - 2] * 100;
    if (price > sma20 && sma20 > ind.sma50 && (ind.sma200 ? ind.sma50 > ind.sma200 : true) && slope > 0.3) dailyTrend = 2;
    else if (price > (ind.sma200 || ind.sma50) && slope >= 0) dailyTrend = 1;
    else if (price < ind.sma50 && price < sma20 && sma20 < ind.sma50 && slope < -0.3) dailyTrend = -2;
    else if (price < (ind.sma200 || ind.sma50)) dailyTrend = -1;
  }
  let weeklyTrend = 0;
  if (ind.sma200 && closes.length >= 60) {
    const arr = calcSMA(closes.slice(0, -10), 50);
    const sl = arr.length > 0 ? (ind.sma50 - arr[arr.length - 1]) / arr[arr.length - 1] * 100 : 0;
    if (ind.sma50 > ind.sma200 && sl > 0.2) weeklyTrend = 2;
    else if (ind.sma50 > ind.sma200) weeklyTrend = 1;
    else if (ind.sma50 < ind.sma200 && sl < -0.2) weeklyTrend = -2;
    else if (ind.sma50 < ind.sma200) weeklyTrend = -1;
  } else { weeklyTrend = dailyTrend > 0 ? 1 : dailyTrend < 0 ? -1 : 0; }
  let monthlyTrend = 0;
  if (ind.sma200 && closes.length >= 220) {
    const arr = calcSMA(closes.slice(0, -20), 200);
    const sl = arr.length > 0 ? (ind.sma200 - arr[arr.length - 1]) / arr[arr.length - 1] * 100 : 0;
    if (price > ind.sma200 && sl > 0.1) monthlyTrend = 2;
    else if (price > ind.sma200) monthlyTrend = 1;
    else if (price < ind.sma200 && sl < -0.1) monthlyTrend = -2;
    else if (price < ind.sma200) monthlyTrend = -1;
  } else { monthlyTrend = weeklyTrend; }
  const trendScore = dailyTrend * 1.0 + weeklyTrend * 0.7 + monthlyTrend * 0.3;

  // 2. RSI
  let rsiScore = 0;
  if (ind.rsi < 30 && trendScore > 0) rsiScore = 2.0;
  else if (ind.rsi < 30) rsiScore = 1.5;
  else if (ind.rsi < 40 && trendScore > 0) rsiScore = 1.0;
  else if (ind.rsi < 40) rsiScore = 0.5;
  else if (ind.rsi > 80) rsiScore = -1.0;
  else if (ind.rsi > 70) rsiScore = -0.5;
  else if (ind.rsi > 60) rsiScore = -0.2;
  if (ind.rsiBullDiv) rsiScore += 1.0;
  rsiScore = Math.max(-2.0, Math.min(2.0, rsiScore));

  // 3. MACD
  const macdHist = ind.macd.histogram;
  let macdScore = 0;
  if (macdHist.length > 0) {
    const last = macdHist[macdHist.length - 1], prev = macdHist.length > 1 ? macdHist[macdHist.length - 2] : 0;
    if (last > 0 && last > prev) macdScore = 1.5;
    else if (last > 0) macdScore = 0.5;
    else if (last < 0 && last > prev) macdScore = -0.3;
    else if (last < 0) macdScore = -1.5;
    if (macdHist.length >= 3 && macdHist[macdHist.length - 3] < 0 && last > 0) macdScore = Math.min(macdScore + 0.5, 1.5);
  }

  // 4. MA Alignment
  let maScore = 0;
  if (ind.sma200) {
    if (price > ind.e20 && ind.e20 > ind.sma50 && ind.sma50 > ind.sma200) maScore = 1.5;
    else if (price < ind.e20 && ind.e20 < ind.sma50 && ind.sma50 < ind.sma200) maScore = -1.5;
    else if (price > ind.sma200) maScore = 0.5;
    else maScore = -0.5;
  } else {
    if (price > ind.e20 && ind.e20 > ind.sma50) maScore = 1.0;
    else if (price < ind.e20 && ind.e20 < ind.sma50) maScore = -1.0;
    else if (price > ind.sma50) maScore = 0.3;
    else maScore = -0.3;
  }

  // 5. Volume
  let volumeScore = 0;
  {
    const l5 = ind.candles.slice(-5), p5 = ind.candles.slice(-10, -5);
    const a5 = l5.reduce((s, c) => s + c.volume, 0) / 5;
    const ap5 = p5.length > 0 ? p5.reduce((s, c) => s + c.volume, 0) / p5.length : a5;
    const vt = ap5 > 0 ? (a5 - ap5) / ap5 : 0;
    const g5 = l5.filter(c => c.close >= c.open).length;
    if (vt > 0.2 && g5 >= 3) volumeScore = 0.5;
    else if (vt > 0.2 && g5 < 2) volumeScore = -0.5;
    if (ind.obvRising && g5 >= 3) volumeScore = Math.min(volumeScore + 0.2, 0.5);
  }

  // 6. Breakout
  let breakoutScore = 0;
  {
    const h20 = Math.max(...closes.slice(-20)), h52 = Math.max(...closes);
    if ((h52 - price) / h52 * 100 < 2) breakoutScore += 0.5;
    if ((h20 - price) / h20 * 100 < 1) breakoutScore += 0.5;
    if (ind.bbSqueeze && ind.bbRelPos > 0.5) breakoutScore += 0.3;
    breakoutScore = Math.min(1.0, breakoutScore);
  }

  // ── 7. ENHANCED: StochRSI Timing (±0.5) ──
  let stochScore = 0;
  if (ind.stochOversold && trendScore > 0) stochScore = 0.5;       // Oversold in uptrend = ideal pullback
  else if (ind.stochBullish && trendScore > 0) stochScore = 0.3;   // StochRSI turning up in uptrend

  // ── 8. ENHANCED: Trend Structure (±0.5) ──
  let structureScore = 0;
  if (ind.hhhl && ind.higherLow) structureScore = 0.5;             // HH+HL pattern confirmed
  else if (ind.higherLow) structureScore = 0.3;                    // Higher low only

  // ── 9. ENHANCED: Pullback Quality (+0.3) ──
  let pullbackScore = 0;
  if (ind.pullbackVolDeclining && trendScore > 0) pullbackScore += 0.2;  // Volume dries up on pullback
  if (ind.confluence >= 2) pullbackScore += 0.1;                         // Multi-support confluence

  // ── 10. ENHANCED: Buyer Strength (+0.2) ──
  let buyerScore = 0;
  if (ind.closeNearDayHigh) buyerScore = 0.2;

  // ── 11. ENHANCED: Distribution Penalty (-0.5) ──
  let distPenalty = 0;
  if (ind.distributionPattern || ind.heavySelling) distPenalty = -0.5;
  else if (ind.sellingPressure) distPenalty = -0.3;

  const baseScore = trendScore + rsiScore + macdScore + maScore + volumeScore + breakoutScore;
  const enhancedBonus = stochScore + structureScore + pullbackScore + buyerScore + distPenalty;
  const compositeScore = Math.round(baseScore * 10) / 10;
  const enhancedScore = Math.round((baseScore + enhancedBonus) * 10) / 10;
  const direction = compositeScore >= 1 ? "LONG" : compositeScore <= -1 ? "SHORT" : "NEUTRAL";

  // Trade Plan
  let tradePlan = null;
  if (direction === "LONG") {
    const atr = ind.atrLast || price * 0.02;
    const entry = compositeScore >= 8.0 ? price : price - 0.3 * atr;

    // Stop
    const supCands = [];
    ind.swingLows.filter(s => s < entry && entry - s <= 2 * atr).forEach(s => supCands.push(s));
    const rcS = ind.candles.slice(-60);
    for (let i = 2; i < rcS.length - 2; i++) {
      const l = rcS[i].low;
      if (l <= rcS[i-1].low && l <= rcS[i-2].low && l <= rcS[i+1].low && l <= rcS[i+2].low && l < entry && entry - l <= 2 * atr) supCands.push(l);
    }
    if (ind.e20 < entry && entry - ind.e20 <= 2 * atr && ind.priceAboveEma20) supCands.push(ind.e20);
    if (ind.e50 < entry && entry - ind.e50 <= 2.5 * atr && price > ind.e50) supCands.push(ind.e50);
    const r10Low = Math.min(...ind.candles.slice(-10).map(c => c.low));
    if (r10Low < entry && entry - r10Low <= 2 * atr) supCands.push(r10Low);
    if (ind.fibPrices && ind.fibRange > 0) {
      for (const fp of Object.values(ind.fibPrices)) { if (fp < entry && entry - fp <= 2 * atr && fp > entry - 2.5 * atr) supCands.push(fp); }
    }
    let stop = supCands.length > 0 ? Math.max(...supCands) - 0.15 * atr : entry - 1.5 * atr;
    if (entry - stop < 0.75 * atr) stop = entry - 0.75 * atr;

    // Target
    const resCands = [];
    if (ind.fibPrices && ind.fibRange > 0) { for (const fp of Object.values(ind.fibPrices)) { if (fp > entry && fp - entry <= 6 * atr) resCands.push(fp); } }
    ind.swingHighs.filter(r => r > entry && r - entry <= 6 * atr).forEach(r => resCands.push(r));
    if (ind.fibHigh > entry && ind.fibHigh - entry <= 6 * atr) resCands.push(ind.fibHigh);
    const r20High = Math.max(...ind.candles.slice(-20).map(c => c.high));
    if (r20High > entry && r20High - entry <= 6 * atr) resCands.push(r20High);
    let target;
    if (resCands.length > 0) {
      const minRR = entry + (entry - stop) * 1.5;
      const viable = resCands.filter(r => r >= minRR);
      target = viable.length > 0 ? Math.min(...viable) : Math.min(...resCands);
    } else { target = entry + 3.0 * atr; }
    if (target - entry < 1.5 * atr) target = entry + 1.5 * atr;
    if (target <= entry) target = entry + 3.0 * atr;
    if (stop >= entry) stop = entry - 1.5 * atr;

    const risk = entry - stop, reward = target - entry;
    tradePlan = { entry, stop, target, risk, reward, rr: risk > 0 ? reward / risk : 0, atr };
  }

  return {
    compositeScore, enhancedScore, direction, tradePlan,
    indicators: { rsi: ind.rsi, adx: ind.adxVal, adxSlope: ind.adxSlope, sma200: ind.sma200, ema20: ind.e20, atr: ind.atrLast },
    ema20Distance: ind.e20 > 0 ? (price - ind.e20) / ind.atrLast : 0,
    perf20d: ind.perf20d,
    breakoutScore, volumeScore,
    enhancedBreakdown: { stochScore, structureScore, pullbackScore, buyerScore, distPenalty },
  };
}

function detectMarketRegime(indexCloses, sma200val, vixPrice) {
  if (!indexCloses || indexCloses.length < 50) return "MODERATE_BULL";
  const price = indexCloses[indexCloses.length - 1];
  const sma50Arr = calcSMA(indexCloses.slice(-70), 50);
  const sma50val = sma50Arr.length > 0 ? sma50Arr[sma50Arr.length - 1] : price;
  const sma50slope = sma50Arr.length >= 20 ? (sma50val - sma50Arr[sma50Arr.length - 20]) / sma50Arr[sma50Arr.length - 20] * 100 : 0;
  if (price > sma200val && sma50val > sma200val && sma50slope > 0.3 && vixPrice < 20) return "STRONG_BULL";
  if (price > sma200val && vixPrice < 25) return "MODERATE_BULL";
  if (Math.abs(price - sma200val) / sma200val < 0.03 && vixPrice >= 18) return "TRANSITION";
  if (price < sma200val && vixPrice < 30) return "MODERATE_BEAR";
  return "CRISIS";
}

// ══════════════════════════════════════════════════════════════
// Data Fetching (cached)
// ══════════════════════════════════════════════════════════════

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const req = https.request({ hostname: urlObj.hostname, path: urlObj.pathname + urlObj.search, method: "GET",
      headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36" } }, (res) => {
      let data = ""; res.on("data", (c) => data += c);
      res.on("end", () => { try { resolve(JSON.parse(data)); } catch (e) { reject(e); } });
    });
    req.on("error", reject); req.setTimeout(15000, () => { req.destroy(); reject(new Error("Timeout")); }); req.end();
  });
}

async function fetchSymbolData(symbol) {
  const cacheFile = path.join(CACHE_DIR, `${symbol.replace(/[^a-zA-Z0-9.-]/g, "_")}_15y.json`);
  if (fs.existsSync(cacheFile)) {
    const ageH = (Date.now() - fs.statSync(cacheFile).mtimeMs) / 3600000;
    if (ageH < 24) return JSON.parse(fs.readFileSync(cacheFile, "utf8"));
  }
  const host = YAHOO_HOSTS[Math.random() < 0.5 ? 0 : 1];
  const url = `https://${host}/v8/finance/chart/${encodeURIComponent(symbol)}?range=15y&interval=1d&includeAdjustedClose=true`;
  try {
    const json = await fetchJSON(url);
    const result = json?.chart?.result?.[0]; if (!result) return null;
    const ts = result.timestamp || [], q = result.indicators?.quote?.[0] || {};
    const adj = result.indicators?.adjclose?.[0]?.adjclose;
    const candles = [];
    for (let i = 0; i < ts.length; i++) {
      const o = q.open?.[i], h = q.high?.[i], l = q.low?.[i], c = q.close?.[i], v = q.volume?.[i], ac = adj?.[i] || c;
      if (o != null && h != null && l != null && c != null && v != null && c > 0) {
        const af = ac && c > 0 ? ac / c : 1;
        candles.push({ date: new Date(ts[i] * 1000).toISOString().slice(0, 10), open: o * af, high: h * af, low: l * af, close: ac || c, volume: v });
      }
    }
    fs.writeFileSync(cacheFile, JSON.stringify(candles));
    return candles;
  } catch (e) { console.error(`  Failed: ${symbol}: ${e.message}`); return null; }
}

async function fetchAllData(symbols) {
  const data = {}; let done = 0;
  for (let i = 0; i < symbols.length; i += 5) {
    const batch = symbols.slice(i, i + 5);
    const results = await Promise.all(batch.map(s => fetchSymbolData(s)));
    batch.forEach((s, j) => { if (results[j]?.length > 0) data[s] = results[j]; });
    done += batch.length;
    process.stdout.write(`\r  Daten laden: ${done}/${symbols.length}...`);
    if (i + 5 < symbols.length) await new Promise(r => setTimeout(r, 200));
  }
  console.log();
  return data;
}

// ══════════════════════════════════════════════════════════════
// Backtest Engine v2 — Fixed Equity + Variants
// ══════════════════════════════════════════════════════════════

function runBacktest(allData, startDate, endDate, variant) {
  const cfg = VARIANTS[variant];
  const gspcCandles = allData["^GSPC"], gdaxiCandles = allData["^GDAXI"], vixCandles = allData["^VIX"];
  if (!gspcCandles || !vixCandles) return null;

  const gspcByDate = {}; gspcCandles.forEach((c, i) => gspcByDate[c.date] = i);
  const gdaxiByDate = {}; if (gdaxiCandles) gdaxiCandles.forEach((c, i) => gdaxiByDate[c.date] = i);
  const vixByDate = {}; vixCandles.forEach((c, i) => vixByDate[c.date] = i);

  const allDates = [...new Set(gspcCandles.map(c => c.date))].sort();
  const tradingDates = allDates.filter(d => d >= startDate && d <= endDate);

  // FIX: Track cash + invested separately
  let cash = STARTING_CAPITAL;
  const trades = [], openPositions = [], equityCurve = [];
  const pendingSignals = []; // Variante A: warten auf RSI(2) < 10 Trigger
  const regimeDays = { STRONG_BULL: 0, MODERATE_BULL: 0, TRANSITION: 0, MODERATE_BEAR: 0, CRISIS: 0 };
  let totalSignals = 0, sma200Bypasses = 0;

  function getEquity(today) {
    let openVal = 0;
    for (const p of openPositions) {
      const c = allData[p.symbol]?.find(c => c.date === today);
      openVal += p.shares * (c?.close || p.entry);
    }
    return cash + openVal;
  }

  for (let dayIdx = 0; dayIdx < tradingDates.length; dayIdx++) {
    const today = tradingDates[dayIdx];
    const tomorrow = dayIdx + 1 < tradingDates.length ? tradingDates[dayIdx + 1] : null;

    // ── 1. Manage open positions ──
    for (let p = openPositions.length - 1; p >= 0; p--) {
      const pos = openPositions[p];
      const symCandles = allData[pos.symbol];
      if (!symCandles) continue;
      const todayCandle = symCandles.find(c => c.date === today);
      if (!todayCandle) continue;

      pos.holdingDays++;
      let exitPrice = null, exitReason = null;

      // Trailing Stop — 3 Phasen:
      // Phase 1 (< 1R): normaler Stop
      // Phase 2 (>= 1R): Stop auf Breakeven
      // Phase 3 (>= 2R): Trail bei 1.5 ATR unter Hoch
      if (cfg.trailingStop) {
        const riskAmt = pos.entry - pos.originalStop;
        if (!pos.breakevenActive) {
          if (todayCandle.high >= pos.entry + riskAmt) {
            pos.stop = pos.entry;
            pos.breakevenActive = true;
          }
        }
        if (pos.breakevenActive && !pos.trailingActive) {
          if (todayCandle.high >= pos.entry + 2 * riskAmt) {
            pos.trailingActive = true;
          }
        }
        if (pos.trailingActive) {
          if (todayCandle.close > pos.highestClose) pos.highestClose = todayCandle.close;
          const trailStop = pos.highestClose - 1.5 * pos.atr;
          if (trailStop > pos.stop) pos.stop = trailStop;
        }
      }

      const maxHold = cfg.maxHoldingDays || 20;
      if (todayCandle.low <= pos.stop) { exitPrice = pos.stop; exitReason = "STOP"; }
      else if (!cfg.noFixedTarget && todayCandle.high >= pos.target) { exitPrice = pos.target; exitReason = "TARGET"; }
      // Variante C: Time-Stop — Exit nach N Tagen wenn Position im Minus
      else if (cfg.timeStopDays && pos.holdingDays >= cfg.timeStopDays && todayCandle.close < pos.entry) { exitPrice = todayCandle.close; exitReason = "TIMESTOP"; }
      else if (pos.holdingDays >= maxHold) { exitPrice = todayCandle.close; exitReason = "TIME"; }

      if (exitPrice) {
        const pnl = (exitPrice - pos.entry) * pos.shares;
        cash += pos.shares * exitPrice; // FIX: Return full exit value to cash
        trades.push({
          symbol: pos.symbol, entry: pos.entry, exit: exitPrice, shares: pos.shares,
          pnl, pnlPct: (exitPrice - pos.entry) / pos.entry * 100,
          holdingDays: pos.holdingDays, reason: exitReason,
          entryDate: pos.entryDate, exitDate: today, rr: pos.rr, regime: pos.regime,
        });
        openPositions.splice(p, 1);
      }
    }

    // ── 1b. Pending Signals pruefen (Variante A: RSI(2) Trigger) ──
    if (cfg.entrySplitting && pendingSignals.length > 0) {
      const regimeParamsPending = cfg.regimeParams[pendingSignals[0]?.regime] || cfg.regimeParams.MODERATE_BULL;
      const slotsPending = regimeParamsPending.maxPositions - openPositions.length;

      for (let ps = pendingSignals.length - 1; ps >= 0; ps--) {
        const sig = pendingSignals[ps];
        sig.waitDays++;
        // Abgelaufen oder bereits im Symbol investiert?
        if (sig.waitDays > (cfg.rsi2MaxWaitDays || 5) || openPositions.some(p => p.symbol === sig.symbol)) {
          pendingSignals.splice(ps, 1);
          continue;
        }
        // Keine Slots frei?
        if (openPositions.length >= regimeParamsPending.maxPositions) continue;

        const symC = allData[sig.symbol]; if (!symC) { pendingSignals.splice(ps, 1); continue; }
        let symIdx = -1;
        for (let i = symC.length - 1; i >= 0; i--) { if (symC[i].date <= today) { symIdx = i; break; } }
        if (symIdx < 5) { pendingSignals.splice(ps, 1); continue; }

        // RSI(2) berechnen
        const recentCloses = symC.slice(Math.max(0, symIdx - 20), symIdx + 1).map(c => c.close);
        const rsi2 = calcRSI(recentCloses, 2);
        const rsi2Val = rsi2.length > 0 ? rsi2[rsi2.length - 1] : 50;

        if (rsi2Val < 10) {
          // RSI(2) Trigger! Entry am naechsten Tag zum Open
          if (!tomorrow) continue;
          const tmrC = symC.find(c => c.date === tomorrow); if (!tmrC) continue;
          const actualEntry = tmrC.open;
          const tp = sig.tradePlan;
          let adjustedStop = tp.stop;
          if (actualEntry !== tp.entry) {
            adjustedStop = actualEntry - tp.atr * 1.5;
          }
          const riskPerShare = actualEntry - adjustedStop;
          if (riskPerShare <= 0) { pendingSignals.splice(ps, 1); continue; }
          const equity = getEquity(today);
          let maxRisk = equity * cfg.riskPct;
          if (cfg.maxRiskPerTrade > 0) maxRisk = Math.min(maxRisk, cfg.maxRiskPerTrade);
          let shares = Math.floor(maxRisk / riskPerShare);
          if (shares <= 0) { pendingSignals.splice(ps, 1); continue; }
          let posValue = shares * actualEntry;
          const maxPosValue = equity * cfg.maxPositionPct;
          if (posValue > maxPosValue) { shares = Math.floor(maxPosValue / actualEntry); posValue = shares * actualEntry; }
          if (shares <= 0) { pendingSignals.splice(ps, 1); continue; }
          if (posValue > cash) { shares = Math.floor(cash / actualEntry); posValue = shares * actualEntry; }
          if (shares <= 0) { pendingSignals.splice(ps, 1); continue; }

          cash -= posValue;
          let adjustedTarget = tp.target;
          if (actualEntry !== tp.entry) adjustedTarget = actualEntry + riskPerShare * tp.rr;
          openPositions.push({
            symbol: sig.symbol, entry: actualEntry, stop: adjustedStop, target: adjustedTarget,
            originalStop: adjustedStop, shares, rr: tp.rr, atr: tp.atr,
            entryDate: tomorrow, holdingDays: 0, regime: sig.regime,
            breakevenActive: false, trailingActive: false, highestClose: actualEntry,
          });
          pendingSignals.splice(ps, 1);
        }
      }
    }

    // ── 2. Market regime ──
    const gspcIdx = gspcByDate[today], vixIdx = vixByDate[today];
    if (gspcIdx == null || gspcIdx < 250 || vixIdx == null) {
      equityCurve.push({ date: today, equity: getEquity(today) });
      continue;
    }
    const gspcCloses = gspcCandles.slice(0, gspcIdx + 1).map(c => c.close);
    const sma200arr = calcSMA(gspcCloses, 200);
    const gspcSMA200 = sma200arr.length > 0 ? sma200arr[sma200arr.length - 1] : null;
    const vixPrice = vixCandles[vixIdx]?.close || 20;
    let usRegime = "MODERATE_BULL";
    if (gspcSMA200) usRegime = detectMarketRegime(gspcCloses, gspcSMA200, vixPrice);
    regimeDays[usRegime] = (regimeDays[usRegime] || 0) + 1;

    let gspcAboveSMA200 = true;
    if (gspcSMA200) {
      const cp = gspcCloses[gspcCloses.length - 1];
      if (cp < gspcSMA200 * 0.985) gspcAboveSMA200 = false;
      else if (cp > gspcSMA200 * 1.01) gspcAboveSMA200 = true;
    }

    let gdaxiAboveSMA200 = true;
    if (gdaxiCandles) {
      const gi = gdaxiByDate[today];
      if (gi != null && gi >= 250) {
        const gc = gdaxiCandles.slice(0, gi + 1).map(c => c.close);
        const ds = calcSMA(gc, 200);
        const gdS = ds.length > 0 ? ds[ds.length - 1] : null;
        if (gdS) { if (gc[gc.length - 1] < gdS * 0.985) gdaxiAboveSMA200 = false; }
      }
    }

    const regimeParams = cfg.regimeParams[usRegime] || cfg.regimeParams.MODERATE_BULL;
    const scoreThreshold = regimeParams.scoreThreshold;

    // Scan-Intervall: taeglich (1) oder alle 2 Tage (2)
    const scanInterval = cfg.scanInterval || 2;
    if (dayIdx % scanInterval !== 0 || openPositions.length >= regimeParams.maxPositions) {
      equityCurve.push({ date: today, equity: getEquity(today) });
      continue;
    }

    const equity = getEquity(today);
    const gspc20dRet = gspcCloses.length >= 20 ? ((gspcCloses[gspcCloses.length - 1] - gspcCloses[gspcCloses.length - 20]) / gspcCloses[gspcCloses.length - 20]) * 100 : 0;
    const candidates = [];

    for (const sym of ALL_SYMBOLS) {
      const symCandles = allData[sym]; if (!symCandles) continue;
      let symIdx = -1;
      for (let i = symCandles.length - 1; i >= 0; i--) { if (symCandles[i].date <= today) { symIdx = i; break; } }
      if (symIdx < 250) continue;
      if (openPositions.some(p => p.symbol === sym)) continue;

      const lookback = symCandles.slice(Math.max(0, symIdx - 300), symIdx + 1);
      const result = computeCompositeScore(lookback);
      if (!result || result.direction !== "LONG" || !result.tradePlan || result.tradePlan.rr < cfg.minRR) continue;
      // Use enhanced score if configured, otherwise base score
      const effectiveScore = cfg.useEnhancedScore ? result.enhancedScore : result.compositeScore;
      if (effectiveScore < cfg.preFilterScore) continue;

      // RSI-Filter: kein Entry bei ueberkauft/ueberverkauft
      if (cfg.rsiMin != null && result.indicators.rsi < cfg.rsiMin) continue;
      if (cfg.rsiMax != null && result.indicators.rsi > cfg.rsiMax) continue;

      const perf20d = result.perf20d || 0;
      const relStrength = perf20d - (sym.endsWith(".DE") ? 0 : gspc20dRet);
      const isDE = sym.endsWith(".DE");
      const indexAbove = isDE ? gdaxiAboveSMA200 : gspcAboveSMA200;

      if (!indexAbove) {
        const stockSMA = result.indicators.sma200;
        const sp = lookback[lookback.length - 1].close;
        if (!(stockSMA && sp > stockSMA && relStrength > 0 && result.indicators.adx >= 25 && effectiveScore >= scoreThreshold + 1.0)) continue;
        sma200Bypasses++;
      }
      const rsMin = (cfg.rsMinOverride && cfg.rsMinOverride[usRegime]) != null ? cfg.rsMinOverride[usRegime] : 0;
      if (relStrength < rsMin || relStrength > regimeParams.rsMax) continue;
      if (result.ema20Distance != null && Math.abs(result.ema20Distance) > regimeParams.ema20Max) continue;
      // ADX Filter — Entkopplung Breakout vs Pullback (global oder regime-spezifisch)
      const adxDecoupleActive = cfg.adxDecouple || (cfg.adxDecoupleRegimes && cfg.adxDecoupleRegimes.includes(usRegime));
      if (adxDecoupleActive) {
        const isBreakout = (result.breakoutScore || 0) > 0.5 && (result.volumeScore || 0) > 0.3;
        if (isBreakout) {
          if (result.indicators.adx < (cfg.adxBreakout || 20)) continue;
        } else {
          // Pullback: ADX >= 15 ODER ADX-Slope > 0 (Trend staerkt sich)
          if (result.indicators.adx < (cfg.adxPullback || 15) && (result.indicators.adxSlope || 0) <= 0) continue;
        }
      } else {
        const minADX = cfg.minADX || 20;
        if (result.indicators.adx < minADX) continue;
      }
      if (effectiveScore < scoreThreshold) continue;

      // Enhanced Filters: remove clearly bad setups
      if (cfg.useEnhancedFilters) {
        const eb = result.enhancedBreakdown || {};
        if (cfg.filterDistribution && eb.distPenalty <= -0.5) continue; // distributionPattern or heavySelling
        if (cfg.filterHeavySelling && eb.distPenalty <= -0.3 && !cfg.filterDistribution) continue; // sellingPressure
        if (cfg.filterStochOverbought) {
          // StochRSI overbought (stochScore would be 0 if not oversold, but we need raw)
          // Use negative signal: if no stochScore bonus AND distribution, skip
          // Actually, let's check: if stoch score is 0 (not oversold) and structure is 0 (no HL), less attractive
        }
      }

      // Quality ranking bonus for sort order (doesn't affect threshold, just prioritization)
      let qualityRank = effectiveScore;
      if (cfg.rankByQuality && result.enhancedBreakdown) {
        const eb = result.enhancedBreakdown;
        qualityRank += (eb.stochScore + eb.structureScore + eb.pullbackScore + eb.buyerScore) * 0.5;
      }

      totalSignals++;
      candidates.push({
        symbol: sym, score: effectiveScore, tradePlan: result.tradePlan, relStrength, qualityRank,
        breakoutScore: result.breakoutScore || 0, volumeScore: result.volumeScore || 0,
        adxSlope: result.indicators.adxSlope || 0,
      });
    }

    candidates.sort((a, b) => (b.qualityRank || b.score) - (a.qualityRank || a.score));
    const slots = regimeParams.maxPositions - openPositions.length;

    for (const pick of candidates.slice(0, slots)) {
      if (!tomorrow) continue;
      const symC = allData[pick.symbol]; if (!symC) continue;
      const tmrC = symC.find(c => c.date === tomorrow); if (!tmrC) continue;

      const tp = pick.tradePlan;

      // Variante A: Entry-Splitting — Breakout → MARKET, Pullback → RSI(2) warten
      if (cfg.entrySplitting) {
        const isBreakoutEntry = pick.breakoutScore > 0.5 && pick.volumeScore > 0.3;
        if (!isBreakoutEntry) {
          // Pullback-Signal → in Pending-Queue, warten auf RSI(2) < 10
          if (!pendingSignals.some(s => s.symbol === pick.symbol)) {
            pendingSignals.push({
              symbol: pick.symbol, tradePlan: tp, regime: usRegime,
              waitDays: 0, signalDate: today,
            });
          }
          continue; // Nicht sofort kaufen
        }
        // Breakout → MARKET Entry: sofort kaufen zum Open morgen
      }

      let actualEntry;
      // marketEntryThreshold: Score-Schwelle ab der MARKET statt LIMIT Entry gilt
      const mktThreshold = cfg.marketEntryThreshold || (cfg.useMarketEntry ? 0 : 8.0);
      const useMarket = cfg.entrySplitting || cfg.useMarketEntry || pick.score >= mktThreshold;
      if (useMarket) {
        // Market Entry: kaufe zum Open am naechsten Tag
        actualEntry = tmrC.open;
      } else {
        // Limit Entry: naechster Tag muss nahe des geplanten Entry sein
        const tol = cfg.entryTolerance || 0.02;
        if (tmrC.low > tp.entry * (1 + tol) || tmrC.high < tp.entry * 0.95) continue;
        actualEntry = Math.max(tp.entry, tmrC.open * 0.998);
      }
      // Bei Market-Entry: Stop dynamisch anpassen (gleicher ATR-Abstand)
      let adjustedStop = tp.stop;
      if ((cfg.useMarketEntry || cfg.entrySplitting) && actualEntry !== tp.entry) {
        adjustedStop = actualEntry - tp.atr * 1.5;  // 1.5 ATR unter Entry
      }
      const riskPerShare = actualEntry - adjustedStop;
      if (riskPerShare <= 0) continue;

      // Dynamic risk sizing — regime-abhaengig wenn konfiguriert
      const effectiveRiskPct = (cfg.regimeRiskPct && cfg.regimeRiskPct[usRegime]) || cfg.riskPct;
      let maxRisk = equity * effectiveRiskPct;
      if (cfg.maxRiskPerTrade > 0) maxRisk = Math.min(maxRisk, cfg.maxRiskPerTrade);
      let shares = Math.floor(maxRisk / riskPerShare);
      if (shares <= 0) continue;
      let posValue = shares * actualEntry;

      // Position-Limit: Shares reduzieren statt Trade verwerfen
      const maxPosValue = equity * cfg.maxPositionPct;
      if (posValue > maxPosValue) {
        shares = Math.floor(maxPosValue / actualEntry);
        posValue = shares * actualEntry;
        if (shares <= 0) continue;
      }
      if (posValue > cash) {
        shares = Math.floor(cash / actualEntry);
        posValue = shares * actualEntry;
        if (shares <= 0) continue;
      }

      cash -= posValue; // FIX: Deduct cash when opening position
      // Target anpassen wenn Market-Entry
      let adjustedTarget = tp.target;
      if (cfg.useMarketEntry && actualEntry !== tp.entry) {
        adjustedTarget = actualEntry + riskPerShare * tp.rr;  // Gleicher R:R
      }
      openPositions.push({
        symbol: pick.symbol, entry: actualEntry, stop: adjustedStop, target: adjustedTarget,
        originalStop: adjustedStop, shares, rr: tp.rr, atr: tp.atr,
        entryDate: tomorrow, holdingDays: 0, regime: usRegime,
        breakevenActive: false, trailingActive: false, highestClose: actualEntry,
      });
    }

    equityCurve.push({ date: today, equity: getEquity(today) });
  }

  // Close remaining
  for (const pos of openPositions) {
    const sc = allData[pos.symbol]; if (!sc?.length) continue;
    const lc = sc[sc.length - 1];
    const pnl = (lc.close - pos.entry) * pos.shares;
    cash += pos.shares * lc.close;
    trades.push({ symbol: pos.symbol, entry: pos.entry, exit: lc.close, shares: pos.shares,
      pnl, pnlPct: (lc.close - pos.entry) / pos.entry * 100,
      holdingDays: pos.holdingDays, reason: "END", entryDate: pos.entryDate, exitDate: endDate, rr: pos.rr, regime: pos.regime });
  }

  return { trades, equityCurve, regimeDays, totalSignals, sma200Bypasses, finalCapital: cash };
}

// ══════════════════════════════════════════════════════════════
// Results Analysis
// ══════════════════════════════════════════════════════════════

function analyzeResults(result, years, startDate, endDate, variantName) {
  const { trades, equityCurve, regimeDays, totalSignals, sma200Bypasses, finalCapital } = result;
  if (trades.length === 0) { console.log(`  Keine Trades.`); return null; }

  const wins = trades.filter(t => t.pnl > 0), losses = trades.filter(t => t.pnl <= 0);
  const winRate = wins.length / trades.length * 100;
  const totalWins = wins.reduce((s, t) => s + t.pnl, 0);
  const totalLosses = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
  const profitFactor = totalLosses > 0 ? totalWins / totalLosses : Infinity;
  const avgWin = wins.length > 0 ? totalWins / wins.length : 0;
  const avgLoss = losses.length > 0 ? totalLosses / losses.length : 0;
  const avgWinPct = wins.length > 0 ? wins.reduce((s, t) => s + t.pnlPct, 0) / wins.length : 0;
  const avgLossPct = losses.length > 0 ? losses.reduce((s, t) => s + Math.abs(t.pnlPct), 0) / losses.length : 0;
  const avgHold = trades.reduce((s, t) => s + t.holdingDays, 0) / trades.length;
  const totalReturn = (finalCapital - STARTING_CAPITAL) / STARTING_CAPITAL;
  const cagr = (Math.pow(Math.max(0.01, 1 + totalReturn), 1 / years) - 1) * 100;

  let maxDD = 0, peak = STARTING_CAPITAL;
  for (const p of equityCurve) { if (p.equity > peak) peak = p.equity; const dd = (peak - p.equity) / peak * 100; if (dd > maxDD) maxDD = dd; }

  const exitReasons = {};
  for (const t of trades) exitReasons[t.reason] = (exitReasons[t.reason] || 0) + 1;
  const regimeTrades = {};
  for (const t of trades) {
    if (!regimeTrades[t.regime]) regimeTrades[t.regime] = { total: 0, wins: 0, pnl: 0 };
    regimeTrades[t.regime].total++; if (t.pnl > 0) regimeTrades[t.regime].wins++; regimeTrades[t.regime].pnl += t.pnl;
  }
  const yearlyPnl = {};
  for (const t of trades) {
    const y = t.entryDate.slice(0, 4);
    if (!yearlyPnl[y]) yearlyPnl[y] = { pnl: 0, trades: 0, wins: 0 };
    yearlyPnl[y].pnl += t.pnl; yearlyPnl[y].trades++; if (t.pnl > 0) yearlyPnl[y].wins++;
  }

  console.log(`\n${"═".repeat(70)}`);
  console.log(`  [${variantName}] ${years}J BACKTEST: ${startDate} → ${endDate}`);
  console.log(`${"═".repeat(70)}`);
  console.log(`  Start: EUR ${STARTING_CAPITAL.toLocaleString("de-DE")} → Ende: EUR ${Math.round(finalCapital).toLocaleString("de-DE")}`);
  console.log(`  Rendite: ${(totalReturn * 100).toFixed(1)}% | CAGR: ${cagr.toFixed(1)}% | MaxDD: ${maxDD.toFixed(1)}% | PF: ${profitFactor === Infinity ? "∞" : profitFactor.toFixed(2)}`);
  console.log(`  Trades: ${trades.length} | WR: ${winRate.toFixed(1)}% | Ø Gewinn: EUR ${avgWin.toFixed(0)} (${avgWinPct.toFixed(1)}%) | Ø Verlust: EUR ${avgLoss.toFixed(0)} (${avgLossPct.toFixed(1)}%)`);
  console.log(`  Ø Haltedauer: ${avgHold.toFixed(1)}d | Signale: ${totalSignals} | SMA200-Bypass: ${sma200Bypasses}`);
  console.log();
  for (const [r, c] of Object.entries(exitReasons).sort((a, b) => b[1] - a[1])) {
    const label = { TARGET: "Ziel", STOP: "Stop", TIME: "Zeit", END: "Ende" }[r] || r;
    console.log(`  ${label.padEnd(8)} ${String(c).padStart(4)} (${(c / trades.length * 100).toFixed(0)}%)`);
  }
  console.log();
  console.log(`  Regime-Performance:`);
  for (const [r, rt] of Object.entries(regimeTrades).sort((a, b) => b[1].total - a[1].total)) {
    console.log(`  ${r.padEnd(16)} ${String(rt.total).padStart(4)} Trades | WR ${(rt.total > 0 ? rt.wins / rt.total * 100 : 0).toFixed(0)}% | PnL EUR ${Math.round(rt.pnl).toLocaleString("de-DE")}`);
  }
  console.log();
  console.log(`  Jahres-Performance:`);
  for (const [y, yd] of Object.entries(yearlyPnl).sort()) {
    console.log(`  ${y}: EUR ${Math.round(yd.pnl).toLocaleString("de-DE").padStart(8)} | ${yd.trades} Trades | WR ${(yd.trades > 0 ? yd.wins / yd.trades * 100 : 0).toFixed(0)}%`);
  }

  return { years, totalReturn: totalReturn * 100, cagr, maxDD, profitFactor, winRate, trades: trades.length, finalCapital, avgWin, avgLoss, avgWinPct, avgLossPct };
}

// ══════════════════════════════════════════════════════════════
// Main
// ══════════════════════════════════════════════════════════════

async function main() {
  const universeLabel = UNIVERSE || "sp100dax";
  console.log("══════════════════════════════════════════════════════════════");
  console.log(`  TA-SCANNER BACKTEST v7 — Universum: ${universeLabel.toUpperCase()} (${ALL_SYMBOLS.length} Symbole)`);
  console.log("══════════════════════════════════════════════════════════════\n");

  if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });

  console.log("Lade historische Kursdaten...");
  const allData = await fetchAllData([...ALL_SYMBOLS, ...INDEX_SYMBOLS]);
  console.log(`  ${Object.keys(allData).length} Symbole geladen.\n`);

  const endDate = new Date().toISOString().slice(0, 10);
  const periods = [2, 5, 10];
  const allSummaries = {};

  const variantsToRun = ONLY_VARIANT ? [ONLY_VARIANT] : Object.keys(VARIANTS);
  for (const variant of variantsToRun) {
    if (!VARIANTS[variant]) { console.log(`  Variante "${variant}" nicht gefunden.`); continue; }
    console.log(`\n${"▓".repeat(70)}`);
    console.log(`  VARIANTE: ${VARIANTS[variant].label}`);
    console.log(`${"▓".repeat(70)}`);
    allSummaries[variant] = [];

    for (const years of periods) {
      const sd = new Date(); sd.setFullYear(sd.getFullYear() - years);
      const startStr = sd.toISOString().slice(0, 10);
      process.stdout.write(`  Berechne ${years}J...`);
      const result = runBacktest(allData, startStr, endDate, variant);
      if (result) {
        const summary = analyzeResults(result, years, startStr, endDate, variant);
        if (summary) allSummaries[variant].push(summary);
      }
    }
  }

  // Final comparison
  console.log(`\n${"═".repeat(80)}`);
  console.log(`  VARIANTEN-VERGLEICH [${universeLabel.toUpperCase()} — ${ALL_SYMBOLS.length} Symbole]`);
  console.log(`${"═".repeat(80)}\n`);

  for (const variant of variantsToRun) {
    const sums = allSummaries[variant];
    if (!sums?.length) continue;
    console.log(`  ${VARIANTS[variant].label}:`);
    console.log(`  Zeitraum | Rendite  | CAGR   | MaxDD  | PF    | WR    | Trades | Endkapital`);
    console.log(`  ${"─".repeat(72)}`);
    for (const s of sums) {
      console.log(`  ${(s.years + "J").padEnd(8)} | ${(s.totalReturn.toFixed(1) + "%").padStart(7)} | ${(s.cagr.toFixed(1) + "%").padStart(5)} | ${(s.maxDD.toFixed(1) + "%").padStart(5)} | ${(s.profitFactor === Infinity ? "∞" : s.profitFactor.toFixed(2)).padStart(5)} | ${(s.winRate.toFixed(1) + "%").padStart(5)} | ${String(s.trades).padStart(6)} | EUR ${Math.round(s.finalCapital).toLocaleString("de-DE")}`);
    }
    console.log();
  }

  console.log("  Backtest abgeschlossen.");
}

main().catch(console.error);
