// ─── N-Capital Market Data Proxy + Full Index Scanner (Cloudflare Worker) ───
// Routes: /api/chart, /api/batch, /api/push/*, /api/scan/*, /api/briefing/*
// Cron: Chunked scan of S&P 500 + DAX 40 (alle 5 Min ein Chunk, voller Scan ~45 Min)
// KV-Optimized: accumulator pattern — scan:live holds state+results (1R+1W per invocation)
// Deployment: cd proxy && npx wrangler deploy

import { buildPushHTTPRequest } from "@pushforge/builder";

// ─── S&P 500 Symbols (~507 Aktien) ───

// S&P 100 (OEX) — Top 100 US Large Caps by Market Cap
const SP100_SYMBOLS = [
  "AAPL","ABBV","ABT","ACN","ADBE","AIG","AMD","AMGN","AMT","AMZN","AVGO","AXP",
  "BAC","BK","BKNG","BLK","BMY","BRK-B",
  "C","CAT","CMCSA","COF","COP","COST","CRM","CSCO","CVS","CVX",
  "DE","DHR","DIS","DUK",
  "EMR","EXC",
  "GD","GE","GILD","GM","GOOG","GOOGL","GS",
  "HD","HON",
  "IBM","INTC","INTU","ISRG",
  "JNJ","JPM",
  "KMI","KO",
  "LIN","LLY","LMT","LOW",
  "MA","MCD","MDLZ","MDT","MET","META","MMM","MO","MRK","MS","MSFT",
  "NEE","NFLX","NKE","NOW","NVDA",
  "ORCL","OXY",
  "PEP","PFE","PG","PLTR","PM","PYPL",
  "QCOM",
  "RTX",
  "SBUX","SCHW","SLB","SO","SPG",
  "T","TGT","TMO","TMUS","TSLA","TXN",
  "UBER","UNH","UNP","UPS","USB",
  "V","VZ",
  "WFC","WMT","XOM",
];

// ─── DAX 40 Symbols (Yahoo Finance .DE Suffix) ───

const DAX40_SYMBOLS = [
  "ADS.DE","AIR.DE","ALV.DE","BAS.DE","BAYN.DE","BEI.DE","BMW.DE","BNR.DE","CBK.DE","CON.DE",
  "DB1.DE","DBK.DE","DHL.DE","DTE.DE","DTG.DE","ENR.DE","FRE.DE","G1A.DE","HEI.DE",
  "HEN3.DE","HNR1.DE","IFX.DE","MBG.DE","MRK.DE","MTX.DE","MUV2.DE","P911.DE","PAH3.DE","PUM.DE",
  "QIA.DE","RHM.DE","RWE.DE","SAP.DE","SHL.DE","SIE.DE","SRT3.DE","VOW3.DE","ZAL.DE",
];

const ALL_INDEX_SYMBOLS = [...SP100_SYMBOLS, ...DAX40_SYMBOLS];

// ─── Macro Symbols for Market Briefing ───

const MACRO_SYMBOLS = {
  indices:     [{ symbol: "^GSPC", name: "S&P 500" }, { symbol: "^GDAXI", name: "DAX" }, { symbol: "^DJI", name: "Dow Jones" }, { symbol: "^IXIC", name: "Nasdaq" }],
  asia:        [{ symbol: "^N225", name: "Nikkei 225" }, { symbol: "^HSI", name: "Hang Seng" }, { symbol: "000001.SS", name: "Shanghai Comp." }],
  volatility:  [{ symbol: "^VIX", name: "VIX" }],
  bonds:       [{ symbol: "^TNX", name: "US 10Y Yield" }],
  commodities: [{ symbol: "GC=F", name: "Gold" }, { symbol: "CL=F", name: "WTI Öl" }],
  crypto:      [{ symbol: "BTC-USD", name: "Bitcoin" }],
  currencies:  [{ symbol: "EURUSD=X", name: "EUR/USD" }, { symbol: "JPY=X", name: "USD/JPY" }],
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
  // ── FOMC-Sitzungen (8x/Jahr) ──
  { month: 1, day: 29, name: "FOMC-Sitzung", type: "fed", impact: "high", impactScore: 3, description: "Zinsentscheidung der US-Notenbank. Bestimmt Richtung fuer alle Asset-Klassen." },
  { month: 3, day: 18, name: "FOMC + Dot Plot", type: "fed", impact: "high", impactScore: 3, description: "Zinsentscheid mit Projektionen. Dot Plot zeigt erwarteten Zinspfad der Fed-Mitglieder." },
  { month: 5, day: 6, name: "FOMC-Sitzung", type: "fed", impact: "high", impactScore: 3, description: "Zinsentscheidung der US-Notenbank." },
  { month: 6, day: 17, name: "FOMC + Dot Plot", type: "fed", impact: "high", impactScore: 3, description: "Zinsentscheid mit aktualisierten Wirtschaftsprojektionen und Dot Plot." },
  { month: 7, day: 29, name: "FOMC-Sitzung", type: "fed", impact: "high", impactScore: 3, description: "Zinsentscheidung der US-Notenbank." },
  { month: 9, day: 16, name: "FOMC + Dot Plot", type: "fed", impact: "high", impactScore: 3, description: "Zinsentscheid mit Projektionen — oft richtungsweisend fuer Q4." },
  { month: 10, day: 28, name: "FOMC-Sitzung", type: "fed", impact: "high", impactScore: 3, description: "Zinsentscheidung der US-Notenbank." },
  { month: 12, day: 16, name: "FOMC + Dot Plot", type: "fed", impact: "high", impactScore: 3, description: "Letzte Sitzung des Jahres mit Projektionen fuer 2027." },

  // ── FOMC-Protokolle (Minutes, ~3 Wochen nach Sitzung) ──
  { month: 2, day: 19, name: "FOMC-Protokoll", type: "minutes", impact: "medium", impactScore: 2, description: "Detailliertes Protokoll der Januar-Sitzung. Gibt Einblick in interne Debatten." },
  { month: 4, day: 9, name: "FOMC-Protokoll", type: "minutes", impact: "medium", impactScore: 2, description: "Protokoll der Maerz-Sitzung mit Dot-Plot-Diskussion." },
  { month: 5, day: 28, name: "FOMC-Protokoll", type: "minutes", impact: "medium", impactScore: 2, description: "Protokoll der Mai-Sitzung." },
  { month: 7, day: 9, name: "FOMC-Protokoll", type: "minutes", impact: "medium", impactScore: 2, description: "Protokoll der Juni-Sitzung mit Projektionen." },
  { month: 8, day: 20, name: "FOMC-Protokoll", type: "minutes", impact: "medium", impactScore: 2, description: "Protokoll der Juli-Sitzung." },
  { month: 10, day: 8, name: "FOMC-Protokoll", type: "minutes", impact: "medium", impactScore: 2, description: "Protokoll der September-Sitzung." },
  { month: 11, day: 19, name: "FOMC-Protokoll", type: "minutes", impact: "medium", impactScore: 2, description: "Protokoll der Oktober-Sitzung." },

  // ── EZB-Zinsentscheide (8x/Jahr) ──
  { month: 1, day: 30, name: "EZB-Zinsentscheid", type: "ecb", impact: "high", impactScore: 3, description: "Zinsentscheidung der EZB. Direkte Auswirkung auf DAX und EUR/USD." },
  { month: 3, day: 6, name: "EZB-Zinsentscheid", type: "ecb", impact: "high", impactScore: 3, description: "EZB-Zinsentscheid mit neuen Stabsprojektionen." },
  { month: 4, day: 17, name: "EZB-Zinsentscheid", type: "ecb", impact: "high", impactScore: 3, description: "Zinsentscheidung der EZB." },
  { month: 6, day: 5, name: "EZB-Zinsentscheid", type: "ecb", impact: "high", impactScore: 3, description: "EZB-Zinsentscheid mit aktualisierten Projektionen." },
  { month: 7, day: 24, name: "EZB-Zinsentscheid", type: "ecb", impact: "high", impactScore: 3, description: "Zinsentscheidung der EZB." },
  { month: 9, day: 11, name: "EZB-Zinsentscheid", type: "ecb", impact: "high", impactScore: 3, description: "EZB-Zinsentscheid mit neuen Stabsprojektionen." },
  { month: 10, day: 30, name: "EZB-Zinsentscheid", type: "ecb", impact: "high", impactScore: 3, description: "Zinsentscheidung der EZB." },
  { month: 12, day: 18, name: "EZB-Zinsentscheid", type: "ecb", impact: "high", impactScore: 3, description: "Letzte EZB-Sitzung des Jahres mit Projektionen." },

  // ── US CPI / Inflation (monatlich, ca. 10.-15. des Folgemonats) ──
  { month: 1, day: 15, name: "US CPI (Dez)", type: "data", impact: "high", impactScore: 3, description: "Verbraucherpreisindex USA. Wichtigster Inflationsindikator, bestimmt Fed-Politik." },
  { month: 2, day: 12, name: "US CPI (Jan)", type: "data", impact: "high", impactScore: 3, description: "US-Inflationsdaten. Kernrate (ex Food & Energy) besonders beachtet." },
  { month: 3, day: 12, name: "US CPI (Feb)", type: "data", impact: "high", impactScore: 3, description: "US-Inflationsdaten — vor FOMC-Sitzung besonders wichtig." },
  { month: 4, day: 10, name: "US CPI (Mrz)", type: "data", impact: "high", impactScore: 3, description: "Verbraucherpreisindex USA." },
  { month: 5, day: 13, name: "US CPI (Apr)", type: "data", impact: "high", impactScore: 3, description: "US-Inflationsdaten." },
  { month: 6, day: 11, name: "US CPI (Mai)", type: "data", impact: "high", impactScore: 3, description: "US-Inflationsdaten — vor FOMC + Dot Plot besonders relevant." },
  { month: 7, day: 15, name: "US CPI (Jun)", type: "data", impact: "high", impactScore: 3, description: "Verbraucherpreisindex USA." },
  { month: 8, day: 12, name: "US CPI (Jul)", type: "data", impact: "high", impactScore: 3, description: "US-Inflationsdaten." },
  { month: 9, day: 10, name: "US CPI (Aug)", type: "data", impact: "high", impactScore: 3, description: "US-Inflationsdaten — vor FOMC + Dot Plot." },
  { month: 10, day: 14, name: "US CPI (Sep)", type: "data", impact: "high", impactScore: 3, description: "Verbraucherpreisindex USA." },
  { month: 11, day: 12, name: "US CPI (Okt)", type: "data", impact: "high", impactScore: 3, description: "US-Inflationsdaten." },
  { month: 12, day: 10, name: "US CPI (Nov)", type: "data", impact: "high", impactScore: 3, description: "US-Inflationsdaten — vor letzter FOMC-Sitzung des Jahres." },

  // ── Non-Farm Payrolls (erster Freitag des Monats) ──
  { month: 1, day: 10, name: "Non-Farm Payrolls (Dez)", type: "data", impact: "high", impactScore: 3, description: "US-Arbeitsmarktbericht. Staerkster Marktbeweger neben CPI. Beeinflusst Fed-Zinspfad." },
  { month: 2, day: 6, name: "Non-Farm Payrolls (Jan)", type: "data", impact: "high", impactScore: 3, description: "US-Arbeitsmarktdaten — Beschaeftigung, Arbeitslosenquote, Stundenlohn." },
  { month: 3, day: 6, name: "Non-Farm Payrolls (Feb)", type: "data", impact: "high", impactScore: 3, description: "US-Arbeitsmarktbericht." },
  { month: 4, day: 3, name: "Non-Farm Payrolls (Mrz)", type: "data", impact: "high", impactScore: 3, description: "US-Arbeitsmarktdaten." },
  { month: 5, day: 8, name: "Non-Farm Payrolls (Apr)", type: "data", impact: "high", impactScore: 3, description: "US-Arbeitsmarktbericht." },
  { month: 6, day: 5, name: "Non-Farm Payrolls (Mai)", type: "data", impact: "high", impactScore: 3, description: "US-Arbeitsmarktdaten." },
  { month: 7, day: 2, name: "Non-Farm Payrolls (Jun)", type: "data", impact: "high", impactScore: 3, description: "US-Arbeitsmarktbericht." },
  { month: 8, day: 7, name: "Non-Farm Payrolls (Jul)", type: "data", impact: "high", impactScore: 3, description: "US-Arbeitsmarktdaten." },
  { month: 9, day: 4, name: "Non-Farm Payrolls (Aug)", type: "data", impact: "high", impactScore: 3, description: "US-Arbeitsmarktbericht." },
  { month: 10, day: 2, name: "Non-Farm Payrolls (Sep)", type: "data", impact: "high", impactScore: 3, description: "US-Arbeitsmarktdaten." },
  { month: 11, day: 6, name: "Non-Farm Payrolls (Okt)", type: "data", impact: "high", impactScore: 3, description: "US-Arbeitsmarktbericht." },
  { month: 12, day: 4, name: "Non-Farm Payrolls (Nov)", type: "data", impact: "high", impactScore: 3, description: "US-Arbeitsmarktdaten." },

  // ── ISM Manufacturing PMI (erster Geschaeftstag des Monats) ──
  { month: 1, day: 3, name: "ISM Manufacturing PMI", type: "data", impact: "medium", impactScore: 2, description: "Einkaufsmanagerindex Industrie. Ueber 50 = Expansion, unter 50 = Kontraktion." },
  { month: 2, day: 3, name: "ISM Manufacturing PMI", type: "data", impact: "medium", impactScore: 2, description: "Einkaufsmanagerindex US-Industrie." },
  { month: 3, day: 2, name: "ISM Manufacturing PMI", type: "data", impact: "medium", impactScore: 2, description: "Einkaufsmanagerindex US-Industrie." },
  { month: 4, day: 1, name: "ISM Manufacturing PMI", type: "data", impact: "medium", impactScore: 2, description: "Einkaufsmanagerindex US-Industrie." },
  { month: 5, day: 1, name: "ISM Manufacturing PMI", type: "data", impact: "medium", impactScore: 2, description: "Einkaufsmanagerindex US-Industrie." },
  { month: 6, day: 1, name: "ISM Manufacturing PMI", type: "data", impact: "medium", impactScore: 2, description: "Einkaufsmanagerindex US-Industrie." },
  { month: 7, day: 1, name: "ISM Manufacturing PMI", type: "data", impact: "medium", impactScore: 2, description: "Einkaufsmanagerindex US-Industrie." },
  { month: 8, day: 3, name: "ISM Manufacturing PMI", type: "data", impact: "medium", impactScore: 2, description: "Einkaufsmanagerindex US-Industrie." },
  { month: 9, day: 2, name: "ISM Manufacturing PMI", type: "data", impact: "medium", impactScore: 2, description: "Einkaufsmanagerindex US-Industrie." },
  { month: 10, day: 1, name: "ISM Manufacturing PMI", type: "data", impact: "medium", impactScore: 2, description: "Einkaufsmanagerindex US-Industrie." },
  { month: 11, day: 2, name: "ISM Manufacturing PMI", type: "data", impact: "medium", impactScore: 2, description: "Einkaufsmanagerindex US-Industrie." },
  { month: 12, day: 1, name: "ISM Manufacturing PMI", type: "data", impact: "medium", impactScore: 2, description: "Einkaufsmanagerindex US-Industrie." },

  // ── US BIP / GDP (quartalsweise, vorlaeufig) ──
  { month: 1, day: 30, name: "US BIP Q4 (vorlaeufig)", type: "data", impact: "medium", impactScore: 2, description: "Bruttoinlandsprodukt USA. Zeigt wirtschaftliches Wachstum oder Rezessionsrisiko." },
  { month: 4, day: 29, name: "US BIP Q1 (vorlaeufig)", type: "data", impact: "medium", impactScore: 2, description: "Vorlaeufige Schaetzung des US-Wirtschaftswachstums Q1." },
  { month: 7, day: 30, name: "US BIP Q2 (vorlaeufig)", type: "data", impact: "medium", impactScore: 2, description: "Vorlaeufige Schaetzung des US-Wirtschaftswachstums Q2." },
  { month: 10, day: 29, name: "US BIP Q3 (vorlaeufig)", type: "data", impact: "medium", impactScore: 2, description: "Vorlaeufige Schaetzung des US-Wirtschaftswachstums Q3." },

  // ── Triple Witching / Grosser Verfall (3. Freitag im Quartal) ──
  { month: 3, day: 20, name: "Triple Witching (Grosser Verfall)", type: "options", impact: "high", impactScore: 3, description: "Verfall von Index-Optionen, Aktienoptionen und Futures. Erhoehte Volatilitaet und Volumen." },
  { month: 6, day: 19, name: "Triple Witching", type: "options", impact: "high", impactScore: 3, description: "Quartalsweiser Optionsverfall. Hohes Volumen und moegliche Gamma-Moves." },
  { month: 9, day: 18, name: "Triple Witching", type: "options", impact: "high", impactScore: 3, description: "Quartalsweiser Optionsverfall." },
  { month: 12, day: 18, name: "Triple Witching", type: "options", impact: "high", impactScore: 3, description: "Letzter grosser Verfall des Jahres. Oft erhoehte Volatilitaet." },

  // ── Earnings Season (Beginn, ~2 Wochen nach Quartalsende) ──
  { month: 1, day: 14, name: "Earnings Season Q4 startet", type: "earnings", impact: "medium", impactScore: 2, description: "Start der Q4-Berichtssaison. Grosse US-Banken berichten zuerst." },
  { month: 4, day: 14, name: "Earnings Season Q1 startet", type: "earnings", impact: "medium", impactScore: 2, description: "Start der Q1-Berichtssaison. Bankensektor + Tech im Fokus." },
  { month: 7, day: 14, name: "Earnings Season Q2 startet", type: "earnings", impact: "medium", impactScore: 2, description: "Start der Q2-Berichtssaison." },
  { month: 10, day: 13, name: "Earnings Season Q3 startet", type: "earnings", impact: "medium", impactScore: 2, description: "Start der Q3-Berichtssaison." },

  // ── Politische Events ──
  { month: 11, day: 3, name: "US Midterm Elections", type: "political", impact: "high", impactScore: 3, description: "Kongresswahlen. Historisch starke Rally ab dem Tiefpunkt vor Midterms." },
];

const SCAN_DEFAULTS = {
  chunkSize: 24,         // Symbols per chunk (24 × 2 calls = 48 fetches, under 50 subrequest limit)
  parallelBatch: 6,      // Parallel fetches per batch
  threshold: 78,         // Minimum swing score to show in results (Merkmalliste v2)
  notifyThreshold: 78,   // Push-Schwelle = Screener-Schwelle (identisch)
};

// ─── Constants & CORS ───

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Max-Age": "86400",
};

// ─── JWT / Auth Helpers (Web Crypto API, no npm) ───

function base64urlEncode(buf) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64urlDecode(str) {
  const padded = str.replace(/-/g, "+").replace(/_/g, "/") + "==".slice(0, (4 - (str.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function hashPassword(password, salt) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: enc.encode(salt), iterations: 100000, hash: "SHA-256" },
    keyMaterial,
    256,
  );
  return base64urlEncode(bits);
}

async function createJWT(payload, secret) {
  const header = { alg: "HS256", typ: "JWT" };
  const enc = new TextEncoder();
  const headerB64 = base64urlEncode(enc.encode(JSON.stringify(header)));
  const payloadB64 = base64urlEncode(enc.encode(JSON.stringify(payload)));
  const signingInput = `${headerB64}.${payloadB64}`;
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(signingInput));
  return `${signingInput}.${base64urlEncode(sig)}`;
}

async function verifyJWT(token, secret) {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const [headerB64, payloadB64, sigB64] = parts;
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
    const sigValid = await crypto.subtle.verify("HMAC", key, base64urlDecode(sigB64), enc.encode(`${headerB64}.${payloadB64}`));
    if (!sigValid) return null;
    const payload = JSON.parse(new TextDecoder().decode(base64urlDecode(payloadB64)));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch { return null; }
}

// ─── Auth Route Handler ───

async function handleAuthRoutes(url, request, env) {
  const path = url.pathname;

  if (request.method !== "POST" && !(request.method === "GET" && path === "/api/auth/me")) {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  // POST /api/auth/register
  if (path === "/api/auth/register" && request.method === "POST") {
    let body;
    try { body = await request.json(); } catch { return jsonResponse({ error: "Invalid JSON" }, 400); }
    const { username, password } = body;
    if (!username || !password) return jsonResponse({ error: "Username und Passwort erforderlich" }, 400);
    if (username.length < 3 || username.length > 30) return jsonResponse({ error: "Username: 3-30 Zeichen" }, 400);
    if (password.length < 6) return jsonResponse({ error: "Passwort: mindestens 6 Zeichen" }, 400);
    if (!/^[a-zA-Z0-9_-]+$/.test(username)) return jsonResponse({ error: "Username: nur Buchstaben, Zahlen, -, _" }, 400);

    const existing = await env.NCAPITAL_KV.get(`user:${username.toLowerCase()}`);
    if (existing) return jsonResponse({ error: "Username bereits vergeben" }, 409);

    const salt = base64urlEncode(crypto.getRandomValues(new Uint8Array(16)));
    const passwordHash = await hashPassword(password, salt);
    await env.NCAPITAL_KV.put(`user:${username.toLowerCase()}`, JSON.stringify({ passwordHash, salt, createdAt: new Date().toISOString() }));

    const token = await createJWT({ sub: username.toLowerCase(), iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 7 * 86400 }, env.JWT_SECRET);
    return jsonResponse({ ok: true, token, username: username.toLowerCase() });
  }

  // POST /api/auth/login
  if (path === "/api/auth/login" && request.method === "POST") {
    let body;
    try { body = await request.json(); } catch { return jsonResponse({ error: "Invalid JSON" }, 400); }
    const { username, password } = body;
    if (!username || !password) return jsonResponse({ error: "Username und Passwort erforderlich" }, 400);

    const userData = await env.NCAPITAL_KV.get(`user:${username.toLowerCase()}`, "json");
    if (!userData) return jsonResponse({ error: "Ungueltige Anmeldedaten" }, 401);

    const hash = await hashPassword(password, userData.salt);
    if (hash !== userData.passwordHash) return jsonResponse({ error: "Ungueltige Anmeldedaten" }, 401);

    const token = await createJWT({ sub: username.toLowerCase(), iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 7 * 86400 }, env.JWT_SECRET);
    return jsonResponse({ ok: true, token, username: username.toLowerCase() });
  }

  // GET /api/auth/me
  if (path === "/api/auth/me" && request.method === "GET") {
    const authHeader = request.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return jsonResponse({ error: "Nicht eingeloggt" }, 401);
    const payload = await verifyJWT(authHeader.slice(7), env.JWT_SECRET);
    if (!payload) return jsonResponse({ error: "Token ungueltig oder abgelaufen" }, 401);
    return jsonResponse({ ok: true, username: payload.sub });
  }

  // POST /api/auth/change-password (requires valid JWT)
  if (path === "/api/auth/change-password" && request.method === "POST") {
    const authHeader = request.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return jsonResponse({ error: "Nicht eingeloggt" }, 401);
    const payload = await verifyJWT(authHeader.slice(7), env.JWT_SECRET);
    if (!payload) return jsonResponse({ error: "Token ungueltig oder abgelaufen" }, 401);

    let body;
    try { body = await request.json(); } catch { return jsonResponse({ error: "Invalid JSON" }, 400); }
    const { currentPassword, newPassword } = body;
    if (!currentPassword || !newPassword) return jsonResponse({ error: "Aktuelles und neues Passwort erforderlich" }, 400);
    if (newPassword.length < 6) return jsonResponse({ error: "Neues Passwort: mindestens 6 Zeichen" }, 400);

    const userData = await env.NCAPITAL_KV.get(`user:${payload.sub}`, "json");
    if (!userData) return jsonResponse({ error: "Benutzer nicht gefunden" }, 404);

    const currentHash = await hashPassword(currentPassword, userData.salt);
    if (currentHash !== userData.passwordHash) return jsonResponse({ error: "Aktuelles Passwort ist falsch" }, 403);

    const newSalt = base64urlEncode(crypto.getRandomValues(new Uint8Array(16)));
    const newHash = await hashPassword(newPassword, newSalt);
    await env.NCAPITAL_KV.put(`user:${payload.sub}`, JSON.stringify({ ...userData, passwordHash: newHash, salt: newSalt, updatedAt: new Date().toISOString() }));

    const token = await createJWT({ sub: payload.sub, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 7 * 86400 }, env.JWT_SECRET);
    return jsonResponse({ ok: true, message: "Passwort erfolgreich geaendert", token });
  }

  return null;
}

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
    const bandwidth = sigma > 0 ? (2 * stdDev * sigma) / mean * 100 : 0; // BB Width %
    result.push({ upper: mean + stdDev * sigma, middle: mean, lower: mean - stdDev * sigma, bandwidth });
  }
  return result;
}

// ─── True ATR (Average True Range) ───

function calcTrueATR(candles, period = 14) {
  if (candles.length < period + 1) return [];
  const trueRanges = [];
  for (let i = 1; i < candles.length; i++) {
    const h = candles[i].high, l = candles[i].low, pc = candles[i - 1].close;
    trueRanges.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
  }
  // Wilder smoothed ATR
  let atr = trueRanges.slice(0, period).reduce((s, v) => s + v, 0) / period;
  const result = [atr];
  for (let i = period; i < trueRanges.length; i++) {
    atr = (atr * (period - 1) + trueRanges[i]) / period;
    result.push(atr);
  }
  return result;
}

// ─── MACD (Moving Average Convergence Divergence) ───

function calcMACD(closes, fast = 12, slow = 26, signalPeriod = 9) {
  if (closes.length < slow + signalPeriod) return { macd: [], signal: [], histogram: [] };
  const emaFast = calcEMA(closes, fast);
  const emaSlow = calcEMA(closes, slow);
  // Align: emaFast starts at index (fast-1), emaSlow at index (slow-1)
  const offset = slow - fast;
  const macdLine = [];
  for (let i = 0; i < emaSlow.length; i++) {
    macdLine.push(emaFast[i + offset] - emaSlow[i]);
  }
  const signalLine = calcEMA(macdLine, signalPeriod);
  const sigOffset = signalPeriod - 1;
  const histogram = [];
  for (let i = 0; i < signalLine.length; i++) {
    histogram.push(macdLine[i + sigOffset] - signalLine[i]);
  }
  return { macd: macdLine, signal: signalLine, histogram };
}

// ─── ADX (Average Directional Index) ───

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
  // Wilder smoothing
  let smoothPlusDM = plusDM.slice(0, period).reduce((s, v) => s + v, 0);
  let smoothMinusDM = minusDM.slice(0, period).reduce((s, v) => s + v, 0);
  let smoothTR = trArr.slice(0, period).reduce((s, v) => s + v, 0);
  const dxArr = [];
  for (let i = period; i < trArr.length; i++) {
    if (i > period) {
      smoothPlusDM = smoothPlusDM - smoothPlusDM / period + plusDM[i];
      smoothMinusDM = smoothMinusDM - smoothMinusDM / period + minusDM[i];
      smoothTR = smoothTR - smoothTR / period + trArr[i];
    }
    const plusDI = smoothTR > 0 ? (smoothPlusDM / smoothTR) * 100 : 0;
    const minusDI = smoothTR > 0 ? (smoothMinusDM / smoothTR) * 100 : 0;
    const diSum = plusDI + minusDI;
    const dx = diSum > 0 ? (Math.abs(plusDI - minusDI) / diSum) * 100 : 0;
    dxArr.push({ dx, plusDI, minusDI });
  }
  if (dxArr.length < period) return [];
  // Smooth DX into ADX
  let adx = dxArr.slice(0, period).reduce((s, v) => s + v.dx, 0) / period;
  const result = [{ adx, plusDI: dxArr[period - 1].plusDI, minusDI: dxArr[period - 1].minusDI }];
  for (let i = period; i < dxArr.length; i++) {
    adx = (adx * (period - 1) + dxArr[i].dx) / period;
    result.push({ adx, plusDI: dxArr[i].plusDI, minusDI: dxArr[i].minusDI });
  }
  return result;
}

// ─── Stochastic RSI ───

function calcStochRSI(closes, rsiPeriod = 14, stochPeriod = 14, kSmooth = 3) {
  const rsiArr = calcRSI(closes, rsiPeriod);
  if (rsiArr.length < stochPeriod) return [];
  const result = [];
  for (let i = stochPeriod - 1; i < rsiArr.length; i++) {
    const window = rsiArr.slice(i - stochPeriod + 1, i + 1);
    const min = Math.min(...window);
    const max = Math.max(...window);
    const stochRSI = max - min > 0 ? ((rsiArr[i] - min) / (max - min)) * 100 : 50;
    result.push(stochRSI);
  }
  // %K = SMA of stochRSI
  if (result.length < kSmooth) return [];
  const kLine = calcSMA(result, kSmooth);
  return kLine;
}

// ─── OBV (On-Balance Volume) ───

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

// ─── Setup-Typen mit Qualifying Conditions & Gewichten ───

const SETUP_TYPES = {
  TREND_PULLBACK: {
    key: "trend_pullback", label: "Trend-Pullback", emoji: "\ud83c\udfaf",
    subtitle: "Ruecksetzer im Aufwaertstrend",
    desc: "Kurs ueber SMA50/200 (Trend intakt). Ruecksetzer Richtung EMA20 oder letztes Tief. Pullback 0.5-1.5 ATR vom Hoch.",
    qualify: (i) => {
      const aboveSMA50 = i.currentPrice > i.sma50;
      const aboveSMA200 = i.sma200 ? i.currentPrice > i.sma200 : true;
      const trendIntakt = aboveSMA50 && aboveSMA200;
      const pullbackATR = i.pullbackATR;
      const inPullbackRange = pullbackATR >= 0.5 && pullbackATR <= 2.0;
      const nearEMA20 = i.distToEma20 < 3;
      return trendIntakt && (inPullbackRange || nearEMA20) && !i.isBearishEMA;
    },
    invalidate: (i) => {
      const underSMA50 = i.currentPrice < i.sma50;
      const tooFarBelow = !i.priceAboveEma20 && i.atrLast > 0 && (i.e20 - i.currentPrice) > i.atrLast * 2;
      return underSMA50 || tooFarBelow;
    },
    weights: { Trend: 0.25, Pullback: 0.25, Support: 0.15, Volumen: 0.10, Momentum: 0.10, "Rel.Staerke": 0.10, Volatilitaet: 0.05 },
  },
  BREAKOUT: {
    key: "breakout", label: "Breakout", emoji: "\u26a1",
    subtitle: "Ausbruch ueber Widerstand",
    desc: "Mehrere Tests am Widerstand, Seitwaerts nahe Hoch (Kompression), hoehere Tiefs. Grosse gruene Kerze ueber Widerstand.",
    qualify: (i) => {
      const compression = i.bbSqueeze || (i.fibLevel >= 0 && i.fibLevel <= 0.15);
      const momentumOK = i.rsi >= 45 && i.rsi <= 72;
      const structure = i.hhhl || (i.isPartialBullish && i.rsi >= 50);
      return (compression || structure) && momentumOK && !i.isBearishEMA;
    },
    invalidate: (i) => {
      return i.fibLevel > 0.30 && !i.priceAboveEma20;
    },
    weights: { Volatilitaet: 0.25, Volumen: 0.25, Momentum: 0.20, Trend: 0.15, "Rel.Staerke": 0.10, Support: 0.05, Pullback: 0.00 },
  },
  RANGE: {
    key: "range", label: "Range", emoji: "\u2194\ufe0f",
    subtitle: "Seitwaertsphase",
    desc: "Flache SMA50/200, mehrere Richtungswechsel, ATR niedrig. Entry nahe Unterstuetzung.",
    qualify: (i) => {
      const flatSMAs = Math.abs(i.e20 - i.e50) / (i.e50 || 1) < 0.015;
      const notTrending = i.adxVal < 25;
      const lowATR = i.atrLast < i.currentPrice * 0.015;
      const neutralRSI = i.rsi >= 35 && i.rsi <= 65;
      return (flatSMAs || notTrending || lowATR) && neutralRSI;
    },
    invalidate: (i) => {
      return i.adxVal >= 30 && (i.isBullishEMA || i.isBearishEMA);
    },
    weights: { Support: 0.25, Volatilitaet: 0.20, Pullback: 0.20, Volumen: 0.15, Momentum: 0.10, Trend: 0.05, "Rel.Staerke": 0.05 },
  },
  BOUNCE: {
    key: "bounce", label: "Bounce", emoji: "\ud83d\udd04",
    subtitle: "Kapitulation / Uebertreibung",
    desc: "Drop >= 3 ATR vom Hoch, weit unter EMA20/50, ATR stark steigend. Grosse rote Kerzen, erste gruene Umkehrkerze.",
    qualify: (i) => {
      // Merkmalliste: Drop >= 3 ATR vom Hoch ist PFLICHT
      const bigDrop = i.pullbackATR >= 3;
      if (!bigDrop) return false;
      const belowEMAs = !i.priceAboveEma20 && i.currentPrice < i.e50;
      const oversold = i.rsi < 35;
      const bbExtreme = i.bbRelPos !== null && i.bbRelPos < 0.15;
      return oversold || bbExtreme || belowEMAs;
    },
    invalidate: (i) => {
      // Neues Tief nach Bounceversuch — pruefe ob letzte Kerze neues Low macht nach gruener Kerze
      return i.newLowAfterBounce === true;
    },
    weights: { Momentum: 0.25, Pullback: 0.20, Volumen: 0.20, Volatilitaet: 0.15, Support: 0.10, Trend: 0.05, "Rel.Staerke": 0.05 },
  },
};
const SETUP_GENERAL = {
  key: "general", label: "General", emoji: "\ud83d\udcca",
  subtitle: "Kein klares Setup",
  desc: "Kein Setup qualifiziert. Gleichmaessig gewichtete Bewertung aller Faktoren.",
  weights: { Trend: 0.20, Pullback: 0.15, Momentum: 0.20, Volumen: 0.15, "Rel.Staerke": 0.10, Volatilitaet: 0.10, Support: 0.10 },
};

// ─── Scoring Functions ───

// Phase 1: Alle Indikatoren einmalig berechnen
function extractIndicators(candles) {
  const closes = candles.map(c => c.close);
  const currentPrice = closes[closes.length - 1];

  // Technische Indikatoren
  const ema20 = calcEMA(closes, 20);
  const ema50 = calcEMA(closes, 50);
  const ema200 = closes.length >= 200 ? calcEMA(closes, 200) : null;
  const rsiValues = calcRSI(closes, 14);
  const adxArr = calcADX(candles, 14);
  const macd = calcMACD(closes, 12, 26, 9);
  const stochRSI = calcStochRSI(closes, 14, 14, 3);
  const bbArr = calcBollingerBands(closes, 20, 2);
  const atrArr = calcTrueATR(candles, 14);
  const obvArr = calcOBV(candles);

  const e20 = ema20.length > 0 ? ema20[ema20.length - 1] : currentPrice;
  const e50 = ema50.length > 0 ? ema50[ema50.length - 1] : currentPrice;
  const e200 = ema200 && ema200.length > 0 ? ema200[ema200.length - 1] : null;
  const rsi = rsiValues.length > 0 ? rsiValues[rsiValues.length - 1] : 50;
  const adxLast = adxArr.length > 0 ? adxArr[adxArr.length - 1] : null;
  const adxVal = adxLast ? adxLast.adx : 20;
  const atrLast = atrArr.length > 0 ? atrArr[atrArr.length - 1] : currentPrice * 0.02;

  // Abgeleitete EMA-Signale
  // EMA-Alignment mit Mindestspread (0.3%) gegen Noise bei fast gleichen EMAs
  const emaSpread = e50 > 0 ? (e20 - e50) / e50 : 0;
  const isBullishEMA = e200 ? (e20 > e50 && e50 > e200) : (emaSpread > 0.003);
  const isPartialBullish = e200 ? (e20 > e200 || e50 > e200) : (emaSpread > 0.001);
  const isBearishEMA = e200 ? (e200 > e50 && e50 > e20) : (emaSpread < -0.003);
  const isTrending = adxVal >= 20;
  const isStrongTrend = adxVal >= 25;
  const distToEma20 = Math.abs(currentPrice - e20) / e20 * 100;
  const distToEma50 = Math.abs(currentPrice - e50) / e50 * 100;
  const priceAboveEma20 = currentPrice > e20;

  // HH/HL Swing-Struktur
  const swingHighs = [], swingLows = [];
  const lb = Math.min(candles.length, 120);
  const rc = candles.slice(-lb);
  for (let i = 3; i < rc.length - 3; i++) {
    const h = rc[i].high, l = rc[i].low;
    if (h >= rc[i-1].high && h >= rc[i-2].high && h >= rc[i-3].high && h >= rc[i+1].high && h >= rc[i+2].high && h >= rc[i+3].high) swingHighs.push(h);
    if (l <= rc[i-1].low && l <= rc[i-2].low && l <= rc[i-3].low && l <= rc[i+1].low && l <= rc[i+2].low && l <= rc[i+3].low) swingLows.push(l);
  }
  let hhhl = false;
  if (swingHighs.length >= 2 && swingLows.length >= 2) {
    hhhl = swingHighs[swingHighs.length - 1] > swingHighs[swingHighs.length - 2] && swingLows[swingLows.length - 1] > swingLows[swingLows.length - 2];
  }

  // Fibonacci — Level + konkrete Preise
  let fibLevel = -1;
  let fibHigh = 0, fibLow = 0, fibRange = 0;
  let fibPrices = {}; // Fib-Level mit konkreten Preisen
  if (candles.length >= 30) {
    const fbLb = Math.min(candles.length, 200);
    const fbC = candles.slice(-fbLb);
    let swHigh = -Infinity, swHighIdx = 0;
    for (let i = 0; i < fbC.length; i++) { if (fbC[i].high > swHigh) { swHigh = fbC[i].high; swHighIdx = i; } }
    let trendLow = Infinity;
    for (let i = 0; i < swHighIdx; i++) { if (fbC[i].low < trendLow) trendLow = fbC[i].low; }
    if (trendLow === Infinity) {
      if (swHighIdx >= 10) trendLow = Math.min(...fbC.slice(0, swHighIdx).map(c => c.low));
      else trendLow = swHigh;
    }
    fibHigh = swHigh;
    fibLow = trendLow;
    fibRange = swHigh - trendLow;
    if (fibRange > 0 && swHigh > currentPrice) fibLevel = (swHigh - currentPrice) / fibRange;
    else if (currentPrice >= swHigh) fibLevel = 0;
    // Konkrete Preise pro Fib-Level
    if (fibRange > 0) {
      fibPrices = {
        "0%": swHigh,
        "23.6%": Math.round((swHigh - fibRange * 0.236) * 100) / 100,
        "38.2%": Math.round((swHigh - fibRange * 0.382) * 100) / 100,
        "50%": Math.round((swHigh - fibRange * 0.500) * 100) / 100,
        "61.8%": Math.round((swHigh - fibRange * 0.618) * 100) / 100,
        "78.6%": Math.round((swHigh - fibRange * 0.786) * 100) / 100,
        "100%": trendLow,
      };
    }
  }
  const atFib236 = fibLevel >= 0.18 && fibLevel <= 0.30;
  const atFib382 = fibLevel >= 0.32 && fibLevel <= 0.45;
  const atFib50 = fibLevel >= 0.45 && fibLevel <= 0.55;
  const atFib618 = fibLevel >= 0.55 && fibLevel <= 0.68;
  const atFib786 = fibLevel >= 0.73 && fibLevel <= 0.85;
  const atFibZone = atFib236 || atFib382 || atFib50 || atFib618 || atFib786;
  const atDeepFib = atFib382 || atFib50 || atFib618 || atFib786;
  // priceNearEma: Richtung beachten — nahe EMA von OBEN = Support, von UNTEN ≠ Support
  const priceNearEmaAbove = (distToEma20 < 2 && priceAboveEma20) || (distToEma50 < 3 && currentPrice > e50);
  const priceNearEma = distToEma20 < 2 || distToEma50 < 3;

  // MACD-Signale
  let macdBullish = false, macdCrossing = false, macdAboveZero = false;
  if (macd.histogram.length >= 3) {
    const h = macd.histogram;
    macdBullish = h[h.length - 1] > h[h.length - 2];
    macdCrossing = (h[h.length - 2] < 0 && h[h.length - 1] > 0) || (h[h.length - 3] < 0 && h[h.length - 1] > 0);
  }
  if (macd.macd.length > 0) macdAboveZero = macd.macd[macd.macd.length - 1] > 0;

  // StochRSI-Signale
  let stochBullish = false, stochOversold = false;
  if (stochRSI.length >= 2) {
    const sNow = stochRSI[stochRSI.length - 1], sPrev = stochRSI[stochRSI.length - 2];
    stochOversold = sNow < 25;
    stochBullish = sNow > sPrev && sPrev < 30;
  }

  // RSI-Divergenz
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

  // Volumen-Signale
  const recentCandlesVol = candles.slice(-20);
  const avgVol = recentCandlesVol.reduce((s, c) => s + c.volume, 0) / recentCandlesVol.length;
  const lastCandle_ = candles[candles.length - 1];
  const volRatio = avgVol > 0 ? lastCandle_.volume / avgVol : 1;
  const lastIsRed = lastCandle_.close < lastCandle_.open;
  const lastBodySize = Math.abs(lastCandle_.close - lastCandle_.open);
  const lastIsLong = lastBodySize > (atrLast || currentPrice * 0.02) * 0.8;
  const sellingPressure = lastIsRed && volRatio >= 1.2 && lastIsLong;
  const heavySelling = lastIsRed && volRatio >= 1.8 && lastBodySize > atrLast;
  const last3 = candles.slice(-3);
  const redHighVolCount = last3.filter(c => c.close < c.open && avgVol > 0 && c.volume > avgVol * 1.2).length;
  const distributionPattern = redHighVolCount >= 2;
  const last3Green = last3.filter(c => c.close >= c.open).length;
  const last3AllRed = last3Green === 0;
  const last10 = candles.slice(-10);
  let upVol = 0, downVol = 0;
  for (const c of last10) { if (c.close >= c.open) upVol += c.volume; else downVol += c.volume; }
  const volDirection = (upVol + downVol) > 0 ? upVol / (upVol + downVol) : 0.5;
  let obvRising = false;
  if (obvArr.length >= 20) {
    const oe = calcEMA(obvArr.slice(-50), 10);
    if (oe.length >= 2) obvRising = oe[oe.length - 1] > oe[oe.length - 2];
  }
  const last5Down = candles.slice(-10).filter(c => c.close < c.open).slice(-5);
  let pullbackVolDeclining = false;
  if (last5Down.length >= 3) pullbackVolDeclining = last5Down[last5Down.length - 1].volume < last5Down[0].volume * 0.8;

  // Performance
  let perf5d = 0, perf20d = 0, perf50d = 0;
  if (closes.length >= 20) {
    perf20d = ((currentPrice - closes[closes.length - 20]) / closes[closes.length - 20]) * 100;
    perf5d = closes.length >= 5 ? ((currentPrice - closes[closes.length - 5]) / closes[closes.length - 5]) * 100 : 0;
    perf50d = closes.length >= 50 ? ((currentPrice - closes[closes.length - 50]) / closes[closes.length - 50]) * 100 : perf20d * 2;
  }

  // Bollinger-Signale
  let bbSqueeze = false, bbRelPos = null, bbBandwidth = 0;
  if (bbArr.length >= 20) {
    const bb = bbArr[bbArr.length - 1];
    bbBandwidth = bb.bandwidth;
    const recentBW = bbArr.slice(-Math.min(50, bbArr.length)).map(b => b.bandwidth);
    const avgBW = recentBW.reduce((s, v) => s + v, 0) / recentBW.length;
    bbSqueeze = bbBandwidth < avgBW * 0.75;
    bbRelPos = (bb.upper - bb.lower) > 0 ? (currentPrice - bb.lower) / (bb.upper - bb.lower) : 0.5;
  }

  // Support-Signale
  let bounceCount = 0;
  const supportTol = atrLast * 1.5;
  for (let i = 2; i < candles.length - 2; i++) {
    const low = candles[i].low;
    if (low <= candles[i-1].low && low <= candles[i-2].low && low <= candles[i+1].low && low <= candles[i+2].low) {
      if (Math.abs(low - currentPrice) <= supportTol) bounceCount++;
    }
  }
  const nearEma20 = distToEma20 < 2 && priceAboveEma20;
  const nearEma50 = distToEma50 < 3 && currentPrice > e50;
  const nearEma200 = e200 ? (Math.abs(currentPrice - e200) / e200 * 100 < 3 && currentPrice > e200) : false;
  const emaSupport = nearEma20 || nearEma50 || nearEma200;
  let confluence = 0;
  if (bounceCount >= 2) confluence++;
  if (emaSupport) confluence++;
  if (atDeepFib) confluence++;

  // ─── Merkmalliste v2: Zusaetzliche Indikatoren ───

  // SMA50/SMA200 (echt, nicht EMA)
  const sma50arr = calcSMA(closes, 50);
  const sma200arr = closes.length >= 200 ? calcSMA(closes, 200) : [];
  const sma50 = sma50arr.length > 0 ? sma50arr[sma50arr.length - 1] : e50;
  const sma200 = sma200arr.length > 0 ? sma200arr[sma200arr.length - 1] : e200;

  // Pullback-Tiefe in ATR-Einheiten
  const pullbackATR = atrLast > 0 && fibHigh > currentPrice ? (fibHigh - currentPrice) / atrLast : 0;

  // ATR-Trend: aktuelle ATR vs 10 Bars ago → "ATR stark steigend" fuer Bounce
  let atrTrend = 0;
  if (atrArr.length >= 11) {
    const atrNow = atrArr[atrArr.length - 1];
    const atr10ago = atrArr[atrArr.length - 11];
    atrTrend = atr10ago > 0 ? (atrNow - atr10ago) / atr10ago : 0;
  }

  // Inside Bar: letzte Kerze komplett innerhalb der vorherigen
  const lastC = candles[candles.length - 1];
  const prevC = candles[candles.length - 2];
  const insideBar = lastC && prevC && lastC.high <= prevC.high && lastC.low >= prevC.low;

  // Higher Low: letztes Swing-Low hoeher als vorletztes
  const higherLow = swingLows.length >= 2 && swingLows[swingLows.length - 1] > swingLows[swingLows.length - 2];

  // EMA20 Reclaim: Kurs hat EMA20 von unten nach oben durchbrochen in letzten 3 Bars
  let ema20Reclaim = false;
  if (ema20.length >= 3 && closes.length >= 3) {
    for (let i = closes.length - 3; i < closes.length; i++) {
      const eIdx = i - (closes.length - ema20.length);
      if (eIdx >= 1 && eIdx < ema20.length) {
        if (closes[i - 1] < ema20[eIdx - 1] && closes[i] > ema20[eIdx]) { ema20Reclaim = true; break; }
      }
    }
  }

  // Close nahe Tageshoch (Close > 90% der Tagesrange)
  const dayRange = lastC ? lastC.high - lastC.low : 0;
  const closeNearDayHigh = dayRange > 0 && lastC ? (lastC.close - lastC.low) / dayRange > 0.90 : false;

  // Lange untere Dochte in letzten 3 Kerzen
  const last3Candles = candles.slice(-3);
  const longLowerWicks = last3Candles.filter(c => {
    const body = Math.abs(c.close - c.open);
    const lowerWick = Math.min(c.open, c.close) - c.low;
    return body > 0 && lowerWick > body * 2;
  }).length >= 2;

  // Erste gruene Umkehrkerze nach >= 3 roten
  let firstGreenReversal = false;
  if (candles.length >= 5) {
    const recent = candles.slice(-5);
    const redCount = recent.slice(0, 4).filter(c => c.close < c.open).length;
    const lastGreen = recent[4].close > recent[4].open;
    if (redCount >= 3 && lastGreen) firstGreenReversal = true;
  }

  // Richtungswechsel in letzten 20 Kerzen (fuer Range-Erkennung)
  let directionChanges = 0;
  const dc20 = candles.slice(-20);
  for (let i = 1; i < dc20.length; i++) {
    const prevGreen = dc20[i - 1].close >= dc20[i - 1].open;
    const currGreen = dc20[i].close >= dc20[i].open;
    if (prevGreen !== currGreen) directionChanges++;
  }

  // Neues Tief nach Bounce-Versuch (fuer Bounce-Invalidierung)
  let newLowAfterBounce = false;
  if (candles.length >= 5) {
    const r5 = candles.slice(-5);
    const hadGreen = r5.slice(0, 4).some(c => c.close > c.open);
    const newLow = r5[4].low < Math.min(...r5.slice(0, 4).map(c => c.low));
    if (hadGreen && newLow) newLowAfterBounce = true;
  }

  return {
    candles, closes, currentPrice, rsi, rsiValues, adxVal,
    e20, e50, e200, isBullishEMA, isPartialBullish, isBearishEMA,
    isTrending, isStrongTrend, hhhl, priceAboveEma20,
    distToEma20, distToEma50, priceNearEma,
    fibLevel, fibHigh, fibLow, fibRange, fibPrices, atFib236, atFib382, atFib50, atFib618, atFib786, atFibZone, atDeepFib,
    priceNearEmaAbove,
    macdBullish, macdCrossing, macdAboveZero, stochBullish, stochOversold, rsiBullDiv,
    stochRSI, macd, atrLast,
    volRatio, lastIsRed, lastIsLong, lastBodySize, avgVol,
    sellingPressure, heavySelling, distributionPattern, last3AllRed, last3Green,
    volDirection, obvRising, pullbackVolDeclining,
    perf5d, perf20d, perf50d,
    bbSqueeze, bbRelPos, bbBandwidth,
    bounceCount, nearEma20, nearEma50, nearEma200, emaSupport, confluence,
    // Merkmalliste v2
    sma50, sma200, pullbackATR, atrTrend, insideBar, higherLow,
    ema20Reclaim, closeNearDayHigh, longLowerWicks, firstGreenReversal,
    directionChanges, newLowAfterBounce,
    // Swing-Struktur fuer Trade-Setup-Berechnung
    swingHighs, swingLows,
  };
}

// Phase 2: Setup-spezifisches Scoring pro Faktor (Merkmalliste v2)
function scoreForSetup(ind, setupKey) {
  const factors = [];
  const signals = [];
  const S = setupKey; // Kurzform

  // ═══ F1: TREND ═══
  let ts = 20;
  const { isStrongTrend, isBullishEMA, hhhl, isTrending, isPartialBullish, isBearishEMA, adxVal } = ind;
  const trendTier = isStrongTrend && isBullishEMA && hhhl ? 7
    : isStrongTrend && isBullishEMA ? 6
    : isTrending && isBullishEMA ? 5
    : isTrending && isPartialBullish ? 4
    : hhhl ? 3
    : !isTrending && isPartialBullish ? 2
    : isBearishEMA ? 1 : 0;

  if (S === "TREND_PULLBACK") {
    // Trend MUSS intakt sein: Kurs > SMA50/200
    const aboveSMA = ind.currentPrice > ind.sma50 && (ind.sma200 ? ind.currentPrice > ind.sma200 : true);
    if (aboveSMA && trendTier >= 6) { ts = 100; signals.push(`Trend intakt: > SMA50/200${hhhl ? ", HH/HL" : ""}`); }
    else if (aboveSMA && trendTier >= 5) { ts = 90; }
    else if (aboveSMA && trendTier >= 4) { ts = 75; }
    else if (aboveSMA) { ts = 60; }
    else if (trendTier >= 4) { ts = 40; }
    else ts = 10;
  } else if (S === "BREAKOUT") {
    // Aufbauend, noch nicht voller Trend
    ts = [25, 10, 35, 45, 50, 65, 70, 75][trendTier];
    if (ind.closeNearDayHigh) { ts = Math.min(100, ts + 10); }
  } else if (S === "RANGE") {
    // INVERTIERT: Niedriger ADX = GUT fuer Range
    if (adxVal < 15) { ts = 90; signals.push("Flache SMAs (Range)"); }
    else if (adxVal < 20) { ts = 70; }
    else if (adxVal < 25) { ts = 50; }
    else if (adxVal < 30) { ts = 30; }
    else ts = 10; // Starker Trend = schlecht fuer Range
  } else if (S === "BOUNCE") {
    // Bearish = Chance fuer Reversal
    ts = [35, 60, 40, 30, 30, 25, 20, 15][trendTier];
    if (trendTier <= 1) signals.push("Bearischer Trend (Reversal-Potential)");
  } else { // GENERAL
    ts = [20, 5, 40, 55, 60, 80, 90, 100][trendTier];
    if (trendTier >= 6) signals.push(`Starker Trend${hhhl ? ", HH/HL" : ""}`);
  }
  factors.push({ name: "Trend", score: ts, value: `${hhhl ? "HH/HL " : ""}${isBullishEMA ? "bullisch" : isBearishEMA ? "bearisch" : "neutral"}${ind.currentPrice > ind.sma50 ? ", > SMA50" : ""}` });

  // ═══ F2: PULLBACK ═══
  let ps = 20;
  const { rsi, fibLevel, atFibZone, atFib236, atFib382, atFib50, atFib618, priceNearEma } = ind;
  const fibName = atFib236 ? "23.6%" : atFib382 ? "38.2%" : atFib50 ? "50%" : atFib618 ? "61.8%" : ind.atFib786 ? "78.6%" : "";

  if (S === "TREND_PULLBACK") {
    // Kernfaktor: Pullback 0.5-1.5 ATR vom Hoch + nahe EMA20
    const pbATR = ind.pullbackATR;
    const nearEmaOben = ind.priceNearEmaAbove;
    if (pbATR >= 0.5 && pbATR <= 1.5 && nearEmaOben && atFibZone) { ps = 100; signals.push(`PB ${pbATR.toFixed(1)} ATR + EMA + Fib ${fibName}`); }
    else if (pbATR >= 0.5 && pbATR <= 1.5 && nearEmaOben) { ps = 90; signals.push(`PB ${pbATR.toFixed(1)} ATR + EMA20`); }
    else if (pbATR >= 0.5 && pbATR <= 1.5 && atFibZone) { ps = 85; signals.push(`PB ${pbATR.toFixed(1)} ATR + Fib ${fibName}`); }
    else if (pbATR >= 0.5 && pbATR <= 1.5) { ps = 75; signals.push(`PB ${pbATR.toFixed(1)} ATR`); }
    else if (pbATR > 1.5 && pbATR <= 2.0 && nearEmaOben) { ps = 60; }
    else if (ind.distToEma20 < 2) { ps = 55; }
    else if (pbATR > 2.0) { ps = 20; } // Zu weit gefallen
    else ps = 30;
    // Merkmalliste-Signale
    if (ind.insideBar) { ps = Math.min(100, ps + 5); signals.push("Inside Bar (Konsolidierung)"); }
    if (ind.higherLow) { ps = Math.min(100, ps + 5); signals.push("Higher Low"); }
    if (ind.ema20Reclaim) { ps = Math.min(100, ps + 5); signals.push("EMA20 Reclaim"); }
  } else if (S === "BREAKOUT") {
    // RSI 50-65 ideal (Momentum baut sich auf)
    if (rsi >= 50 && rsi <= 65) { ps = 75; }
    else if (rsi >= 45 && rsi < 50) ps = 55;
    else if (rsi > 65 && rsi <= 75) ps = 40;
    else ps = 20;
  } else if (S === "RANGE") {
    // Nahe Unterstuetzung (Range-Low) = Entry-Zone
    if (ind.bbRelPos !== null && ind.bbRelPos < 0.20 && ind.bounceCount >= 2) { ps = 100; signals.push("Nahe Range-Low + Support"); }
    else if (ind.bbRelPos !== null && ind.bbRelPos < 0.30 && ind.bounceCount >= 1) { ps = 80; }
    else if (ind.bbRelPos !== null && ind.bbRelPos < 0.30) { ps = 60; }
    else if (ind.bbRelPos !== null && ind.bbRelPos < 0.50) { ps = 40; }
    else ps = 15; // Obere Haelfte der Range = kein Long-Entry
  } else if (S === "BOUNCE") {
    // Drop >= 3 ATR vom Hoch = Kapitulation
    const pbATR = ind.pullbackATR;
    const distEma = ind.distToEma20;
    const deepFib = atFib50 || atFib618 || ind.atFib786 || (fibLevel >= 0.68);
    if (pbATR >= 4 && rsi < 30) { ps = 100; signals.push(`Drop ${pbATR.toFixed(1)} ATR, ueberverkauft`); }
    else if (pbATR >= 3 && rsi < 35) { ps = 90; signals.push(`Drop ${pbATR.toFixed(1)} ATR`); }
    else if (pbATR >= 3) { ps = 75; }
    else if (rsi < 30 && deepFib) { ps = 85; signals.push(`Ueberverkauft + Fib ${fibName || ">55%"}`); }
    else if (rsi < 30) { ps = 70; }
    else if (rsi < 35 && deepFib) { ps = 60; }
    else if (rsi < 35) { ps = 50; }
    else ps = 20;
    // Gummiband-Effekt
    if (distEma > 10 && !ind.priceAboveEma20) { ps = Math.min(100, ps + 10); signals.push(`${distEma.toFixed(1)}% unter EMA20 (Gummiband)`); }
    else if (distEma > 5 && !ind.priceAboveEma20) { ps = Math.min(100, ps + 5); }
  } else { // GENERAL
    if (isBullishEMA || isPartialBullish) {
      if (rsi >= 35 && rsi <= 55 && atFibZone && priceNearEma) { ps = 100; signals.push(`Pullback Fib ${fibName} + nahe EMA`); }
      else if (rsi >= 35 && rsi <= 55 && priceNearEma) { ps = 90; }
      else if (rsi >= 35 && rsi <= 55 && atFibZone) { ps = 85; }
      else if (rsi >= 35 && rsi <= 55) { ps = 70; }
      else if (rsi >= 55 && rsi <= 65) ps = 50;
      else if (rsi < 35) ps = 65;
      else if (rsi > 70) ps = 10;
      else ps = 30;
    } else {
      if (rsi < 30 && atFibZone) ps = 60;
      else if (rsi < 30) ps = 50;
      else if (rsi < 40) ps = 35;
      else if (rsi > 70) ps = 5;
      else ps = 20;
    }
  }
  // Fib-Info mit konkretem Preis
  let fibInfo = "?";
  if (fibLevel >= 0) {
    const fibPct = (fibLevel * 100).toFixed(0);
    const nearestFib = ind.atFib236 ? "23.6%" : ind.atFib382 ? "38.2%" : ind.atFib50 ? "50%" : ind.atFib618 ? "61.8%" : ind.atFib786 ? "78.6%" : "";
    const fibPrice = nearestFib && ind.fibPrices[nearestFib] ? ind.fibPrices[nearestFib] : null;
    fibInfo = nearestFib && fibPrice
      ? `${fibPct}% (${nearestFib} @ ${fibPrice >= 100 ? fibPrice.toFixed(0) : fibPrice.toFixed(2)})`
      : `${fibPct}%`;
  }
  factors.push({ name: "Pullback", score: ps, value: `Fib ${fibInfo}${ind.pullbackATR > 0 ? `, ${ind.pullbackATR.toFixed(1)} ATR` : ""}` });

  // ═══ F3: MOMENTUM ═══
  let ms = 10;
  const { macdBullish, macdCrossing, macdAboveZero, stochBullish, stochOversold, rsiBullDiv } = ind;
  const momTier = (macdCrossing && stochBullish && rsiBullDiv) ? 8
    : (rsiBullDiv && (macdBullish || stochBullish)) ? 7
    : (macdCrossing && stochBullish) ? 6
    : rsiBullDiv ? 5
    : macdCrossing ? 4
    : (macdBullish && stochBullish) ? 3
    : (macdBullish && macdAboveZero) ? 2
    : macdBullish ? 1 : 0;

  if (S === "TREND_PULLBACK") {
    // MACD ueber Null + steigend = Trend intakt
    ms = [10, 40, 75, 65, 70, 80, 90, 95, 100][momTier];
    if (momTier >= 2 && macdAboveZero) { ms = Math.max(ms, 80); signals.push("Momentum steigend"); }
  } else if (S === "BREAKOUT") {
    ms = [10, 45, 65, 75, 85, 55, 90, 70, 85][momTier];
    if (macdCrossing) signals.push("Momentum-Breakout");
  } else if (S === "RANGE") {
    // Neutral-Zone RSI = ideal, extreme Werte = Range endet
    if (rsi >= 40 && rsi <= 60) ms = 70;
    else if (rsi >= 35 && rsi <= 65) ms = 50;
    else ms = 20;
  } else if (S === "BOUNCE") {
    // RSI-Divergenz ist KRITISCH fuer Bounce
    ms = [5, 15, 20, 50, 65, 95, 80, 100, 100][momTier];
    if (rsiBullDiv) signals.push("Bullische Divergenz (Reversal)");
    else if (stochOversold && stochBullish) { ms = Math.max(ms, 60); signals.push("Momentum dreht aus Ueberverkauft"); }
    else if (stochOversold) ms = Math.max(ms, 40);
    // Erste gruene Umkehrkerze = starkes Signal
    if (ind.firstGreenReversal) { ms = Math.min(100, ms + 15); signals.push("Erste gruene Umkehrkerze"); }
  } else { // GENERAL
    ms = [10, 40, 55, 70, 75, 80, 90, 95, 100][momTier];
    if (momTier >= 7) signals.push("Starkes Momentum + Divergenz");
    else if (momTier >= 5) signals.push(rsiBullDiv ? "Bullische Divergenz" : "Momentum-Breakout");
    else if (momTier >= 3) signals.push("Momentum dreht bullisch");
  }
  factors.push({ name: "Momentum", score: ms, value: `${macdBullish ? "steigend" : "fallend"}${rsiBullDiv ? ", Divergenz" : ""}${stochOversold ? ", ueberverkauft" : ""}` });

  // ═══ F4: VOLUMEN ═══
  let vs = 30;
  let volLabel = "neutral";
  const { volRatio, lastIsRed, obvRising, pullbackVolDeclining, volDirection, last3Green, last3AllRed } = ind;

  if (S === "BOUNCE") {
    // Kapitulations-Muster: Sell-Climax → sinkendes Vol → erste gruene Kerze mit Vol
    if (ind.heavySelling && last3AllRed) { vs = 40; volLabel = "Kapitulation"; signals.push("Kapitulations-Volumen"); }
    else if (ind.heavySelling) { vs = 45; volLabel = "Sell-Climax"; signals.push("Sell-Climax (Vol-Spike)"); }
    else if (pullbackVolDeclining) { vs = 80; volLabel = "Vol sinkt"; signals.push("Volumen sinkt (Erschoepfung)"); }
    else if (!lastIsRed && volRatio >= 1.3) { vs = 95; volLabel = "Reversal-Vol"; signals.push("Gruene Kerze + hohes Vol = Reversal"); }
    else if (ind.sellingPressure) { vs = 35; volLabel = "Druck"; }
    else if (volDirection < 0.35) { vs = 50; volLabel = "Abgabe"; }
    else vs = 30;
    // Lange untere Dochte = Kaufinteresse
    if (ind.longLowerWicks) { vs = Math.min(100, vs + 10); signals.push("Lange untere Dochte"); }
  } else if (S === "BREAKOUT") {
    // Vol-Surge = Make or Break. Ohne Volumen = Fakeout!
    if (!lastIsRed && volRatio >= 1.8) { vs = 100; volLabel = "Breakout-Vol"; signals.push(`Vol ${volRatio.toFixed(1)}x Breakout`); }
    else if (!lastIsRed && volRatio >= 1.3) { vs = 85; volLabel = "Surge"; signals.push(`Vol ${volRatio.toFixed(1)}x Surge`); }
    else if (obvRising && !lastIsRed && volRatio >= 1.0) { vs = 60; volLabel = "OBV+"; }
    else if (ind.heavySelling || ind.distributionPattern) { vs = 0; volLabel = "Abbruch"; }
    else if (lastIsRed) { vs = 10; volLabel = "rot"; }
    else if (!lastIsRed && volRatio < 0.8) { vs = 10; volLabel = "Fakeout"; signals.push(`\u26a0\ufe0f Fakeout: Vol nur ${volRatio.toFixed(1)}x`); }
    else { vs = 20; volLabel = "schwach"; }
  } else if (S === "RANGE") {
    // Niedriges Volumen = typisch fuer Range
    if (volRatio < 0.7 && !lastIsRed) { vs = 70; volLabel = "ruhig"; }
    else if (volRatio < 1.0) { vs = 55; volLabel = "normal"; }
    else if (volRatio >= 1.5) { vs = 15; volLabel = "hoch"; } // Hohes Vol = Range-Bruch moeglich
    else vs = 40;
  } else {
    // TREND_PULLBACK, GENERAL
    if (ind.heavySelling && last3AllRed) { vs = 0; volLabel = "Panikverkauf"; signals.push(`\u26a0\ufe0f Panikverkauf: Vol ${volRatio.toFixed(1)}x, 3x rot`); }
    else if (ind.distributionPattern) { vs = 5; volLabel = "Distribution"; signals.push(`\u26a0\ufe0f Distribution`); }
    else if (ind.heavySelling) { vs = 15; volLabel = "Verkaufsdruck"; }
    else if (ind.sellingPressure) { vs = 25; volLabel = "leichter Druck"; }
    else if (obvRising && pullbackVolDeclining && volDirection > 0.55) {
      vs = last3Green >= 2 ? 100 : 85; volLabel = "Akkumulation";
      signals.push("Akkumulation + Pullback auf low Vol");
    }
    else if (obvRising && volRatio >= 1.5 && !lastIsRed) { vs = 90; volLabel = "Akkumulation"; }
    else if (obvRising && pullbackVolDeclining) { vs = 75; volLabel = "PB-Vol sinkt"; }
    else if (obvRising && volDirection > 0.55) { vs = 60; volLabel = "OBV+"; }
    else if (volRatio >= 1.5 && !lastIsRed) { vs = 45; volLabel = "hohes Vol"; }
    else if (volDirection < 0.4) { vs = 10; volLabel = "Distribution"; }
    else { vs = 30; volLabel = "neutral"; }
  }
  factors.push({ name: "Volumen", score: vs, value: `${volLabel}, Vol ${volRatio.toFixed(1)}x${lastIsRed ? " \ud83d\udd34" : " \ud83d\udfe2"}, Dir ${(volDirection * 100).toFixed(0)}%` });

  // ═══ F5: RELATIVE STAERKE ═══
  let rs = 40;
  const { perf20d, perf5d, perf50d } = ind;

  if (S === "TREND_PULLBACK") {
    // Stark 20d + kurzfristiger Ruecksetzer = ideal fuer Pullback im Trend
    if (perf20d > 3 && perf5d < 0 && perf5d > -5) { rs = 100; signals.push(`Rel.Staerke +${perf20d.toFixed(1)}% 20d, PB ${perf5d.toFixed(1)}%`); }
    else if (perf50d > 10 && perf20d > 0 && perf5d < 0) { rs = 90; signals.push(`50d +${perf50d.toFixed(0)}%, Pullback`); }
    else if (perf20d > 3) rs = 70;
    else if (perf20d > 0) rs = 50;
    else if (perf20d > -3) rs = 30;
    else rs = 10;
  } else if (S === "BREAKOUT") {
    if (perf20d > 3) rs = 70;
    else if (perf20d > 0) rs = 50;
    else if (perf20d > -3) rs = 35;
    else rs = 15;
  } else if (S === "RANGE") {
    // Neutral = gut fuer Range
    if (perf20d > -2 && perf20d < 2) { rs = 70; }
    else if (perf20d > -5 && perf20d < 5) { rs = 50; }
    else rs = 20; // Starke Bewegung = Range bricht
  } else if (S === "BOUNCE") {
    // Underperformance = CHANCE (Snap-Back)
    if (perf20d < -10) { rs = 70; signals.push(`Stark ueberverkauft ${perf20d.toFixed(1)}% 20d`); }
    else if (perf20d < -5) { rs = 80; signals.push(`Ueberverkauft ${perf20d.toFixed(1)}% 20d`); }
    else if (perf20d < -2) rs = 60;
    else if (perf20d < 0) rs = 40;
    else rs = 15;
  } else { // GENERAL
    if (perf20d > 3 && perf5d < 0 && perf5d > -5) { rs = 100; signals.push(`Rel.Staerke +${perf20d.toFixed(1)}% 20d, PB ${perf5d.toFixed(1)}%`); }
    else if (perf20d > 5) rs = 75;
    else if (perf20d > 2) rs = 60;
    else if (perf20d > 0) rs = 45;
    else if (perf20d > -3) rs = 30;
    else if (perf20d > -8) rs = 15;
    else rs = 5;
  }
  factors.push({ name: "Rel.Staerke", score: rs, value: `${perf20d.toFixed(1)}% 20d, ${perf5d.toFixed(1)}% 5d` });

  // ═══ F6: VOLATILITAET ═══
  let vols = 30;
  const { bbSqueeze, bbRelPos } = ind;

  if (S === "BREAKOUT") {
    // Squeeze = Kompression = KRITISCH fuer Breakout
    if (bbSqueeze && bbRelPos !== null && bbRelPos < 0.4) { vols = 100; signals.push("Kompression nahe Hoch (Ausbruch erwartet)"); }
    else if (bbSqueeze) { vols = 85; signals.push("Kompression nahe Hoch"); }
    else if (bbRelPos !== null && bbRelPos > 0.7 && !lastIsRed) { vols = 55; }
    else vols = 20;
    // ATR nimmt zu = Ausbruch bestaetigend
    if (ind.atrTrend > 0.15) { vols = Math.min(100, vols + 10); signals.push("ATR steigend"); }
  } else if (S === "BOUNCE") {
    // ATR stark steigend = Kapitulationsphase
    if (ind.atrTrend > 0.30) { vols = 90; signals.push(`ATR +${(ind.atrTrend * 100).toFixed(0)}% (Kapitulation)`); }
    else if (ind.atrTrend > 0.15) { vols = 70; signals.push("ATR steigend"); }
    else if (bbRelPos !== null && bbRelPos < 0.05) { vols = 85; signals.push("Weit unter Bandbreite (Extrem)"); }
    else if (bbRelPos !== null && bbRelPos < 0.15) { vols = 70; }
    else if (bbRelPos !== null && bbRelPos < 0.25) { vols = 55; }
    else vols = 25;
  } else if (S === "RANGE") {
    // Niedriger ATR + enge Baender = Range intakt
    const lowBW = ind.bbBandwidth < (ind.currentPrice * 0.03);
    if (lowBW && !bbSqueeze) { vols = 80; signals.push("Enge Bandbreite (Range)"); }
    else if (bbSqueeze) { vols = 40; } // Squeeze = Ausbruch steht bevor → Range endet
    else if (ind.bbBandwidth < ind.currentPrice * 0.05) { vols = 60; }
    else vols = 25;
  } else if (S === "TREND_PULLBACK") {
    // BB-Position: nahe BB-Low = Pullback-Tiefe erreicht
    if (bbSqueeze && bbRelPos !== null && bbRelPos < 0.4) { vols = 90; signals.push("Kompression am Support"); }
    else if (bbRelPos !== null && bbRelPos < 0.25) { vols = 65; signals.push("Nahe unterer Bandbreite"); }
    else if (bbSqueeze) { vols = 60; }
    else if (bbRelPos !== null && bbRelPos > 0.85) vols = 10;
    else vols = 30;
  } else { // GENERAL
    if (bbSqueeze && bbRelPos !== null && bbRelPos < 0.4) { vols = 100; signals.push("Kompression"); }
    else if (bbSqueeze) vols = 75;
    else if (bbRelPos !== null && bbRelPos < 0.15) { vols = 80; signals.push("Unter Bandbreite"); }
    else if (bbRelPos !== null && bbRelPos < 0.25) vols = 60;
    else if (bbRelPos !== null && bbRelPos > 0.85) vols = 10;
    else vols = 30;
  }
  factors.push({ name: "Volatilitaet", score: vols, value: bbSqueeze ? "Kompression" : bbRelPos !== null ? `Position ${(bbRelPos * 100).toFixed(0)}%` : "normal" });

  // ═══ F7: SUPPORT ═══
  let ss = 5;
  const { bounceCount, nearEma20, nearEma50, nearEma200, confluence } = ind;

  if (S === "TREND_PULLBACK") {
    // EMA20 als Support = klassischer Pullback-Level
    if (ind.priceNearEmaAbove && ind.isBullishEMA && atFibZone) { ss = 100; signals.push("EMA20 + Fib Support"); }
    else if (ind.priceNearEmaAbove && ind.isBullishEMA) { ss = 75; }
    else if (ind.priceAboveEma20 && ind.isBullishEMA) { ss = 60; }
    else if (nearEma50) { ss = 50; signals.push("EMA 50 Support"); }
    else if (nearEma200) { ss = 55; signals.push("EMA 200 Support"); }
    else if (bounceCount >= 2) ss = 45;
    else ss = 15;
  } else if (S === "RANGE") {
    // Bounces an Range-Raendern = KRITISCH
    if (bounceCount >= 3) { ss = 100; signals.push(`${bounceCount} Bounces an Support`); }
    else if (bounceCount >= 2 && ind.longLowerWicks) { ss = 90; signals.push("Support + Dochte"); }
    else if (bounceCount >= 2) { ss = 75; }
    else if (bounceCount >= 1 && ind.atFibZone) { ss = 60; }
    else if (bounceCount >= 1) ss = 40;
    else ss = 10;
  } else if (S === "BOUNCE") {
    // Konfluenz hilft, aber nicht primaer
    if (confluence >= 3) { ss = 100; signals.push("Konfluenz: Support + EMA + Fib"); }
    else if (confluence === 2) { ss = 85; }
    else if (bounceCount >= 3) { ss = 80; }
    else if (nearEma200) { ss = 70; signals.push("EMA 200 Support"); }
    else if (bounceCount >= 2) ss = 60;
    else if (nearEma50) ss = 50;
    else if (bounceCount === 1 || ind.atDeepFib) ss = 30;
    else ss = 5;
  } else { // BREAKOUT, GENERAL
    if (confluence >= 3) { ss = 100; signals.push("Konfluenz: Support + EMA + Fib"); }
    else if (confluence === 2) ss = 85;
    else if (bounceCount >= 3) ss = 80;
    else if (nearEma200) { ss = 70; signals.push("EMA 200 Support"); }
    else if (bounceCount >= 2) ss = 60;
    else if (nearEma50) ss = 50;
    else if (nearEma20 && isBullishEMA) ss = 45;
    else if (bounceCount === 1 || ind.atDeepFib) ss = 30;
    else ss = 5;
  }
  factors.push({ name: "Support", score: ss, value: `Konfluenz ${confluence}/3, ${bounceCount} Bounces` });

  return { factors, signals };
}

// Phase 2b: Realistische Entry/Stop/Target pro Setup-Typ berechnen
function computeTradeSetup(ind, setupKey) {
  const price = ind.currentPrice;
  const atr = ind.atrLast || price * 0.02;
  const e20 = ind.e20;
  const e50 = ind.e50;
  const swH = ind.swingHighs || [];
  const swL = ind.swingLows || [];
  const lastSwingLow = swL.length > 0 ? swL[swL.length - 1] : price - atr * 1.5;
  const lastSwingHigh = swH.length > 0 ? swH[swH.length - 1] : price + atr * 2;
  const fibHigh = ind.fibHigh || lastSwingHigh;

  let entry = price;
  let stop, target;

  if (setupKey === "TREND_PULLBACK") {
    // Stop unter EMA20 oder letztem Swing-Low (das naehere/hoehere Niveau)
    const ema20Stop = e20 - atr * 0.3; // knapp unter EMA20
    const swingStop = lastSwingLow - atr * 0.15; // knapp unter Swing-Low
    stop = Math.max(ema20Stop, swingStop); // hoeheren Stop nehmen (enger)
    // Mindestabstand: 0.5 ATR
    if (price - stop < atr * 0.5) stop = price - atr * 0.5;
    // Target: letztes Swing-Hoch / fibHigh
    target = fibHigh > price * 1.005 ? fibHigh : price + (price - stop) * 2;

  } else if (setupKey === "BREAKOUT") {
    // Stop unter Konsolidierungszone (EMA20 oder 1 ATR unter Entry)
    const emaStop = e20 - atr * 0.2;
    stop = Math.max(emaStop, price - atr * 1.2);
    if (price - stop < atr * 0.5) stop = price - atr * 0.5;
    // Target: Measured Move (Breakout-Distanz projiziert) oder 2x Risk
    const breakoutDist = fibHigh > price ? price - (fibHigh - (fibHigh - price)) : atr * 2;
    target = price + Math.max(atr * 2, (price - stop) * 2);

  } else if (setupKey === "RANGE") {
    // Stop unter Support-Zone (letztes Swing-Low)
    stop = lastSwingLow - atr * 0.2;
    if (price - stop < atr * 0.3) stop = price - atr * 0.5;
    // Target: Range-Oberkante (letztes Swing-Hoch)
    target = lastSwingHigh > price * 1.003 ? lastSwingHigh : price + (price - stop) * 1.5;

  } else if (setupKey === "BOUNCE") {
    // Stop unter dem Kapitulationstief (engster Swing-Low)
    const recentLow = swL.length > 0 ? Math.min(...swL.slice(-3)) : price - atr * 2;
    stop = recentLow - atr * 0.2;
    if (price - stop < atr * 0.5) stop = price - atr * 0.5;
    // Target: EMA20 oder EMA50 (Mean Reversion)
    const emaTarget = e20 > price * 1.01 ? e20 : e50 > price * 1.01 ? e50 : price + atr * 2;
    target = emaTarget;

  } else {
    // GENERAL Fallback
    stop = price - atr * 1.0;
    target = price + atr * 2.0;
  }

  // Sicherheitscheck: Stop muss unter Entry, Target ueber Entry
  if (stop >= price) stop = price - atr * 0.5;
  if (target <= price) target = price + atr * 1.0;

  const risk = price - stop;
  const reward = target - price;
  const crv = risk > 0 ? reward / risk : 0;

  // Risiko-Empfehlung basierend auf CRV
  let riskPct, riskLabel;
  if (crv >= 2.5) { riskPct = 1.0; riskLabel = "1.0%"; }
  else if (crv >= 2.0) { riskPct = 0.75; riskLabel = "0.75%"; }
  else if (crv >= 1.5) { riskPct = 0.5; riskLabel = "0.5%"; }
  else if (crv >= 1.0) { riskPct = 0.25; riskLabel = "0.25%"; }
  else { riskPct = 0; riskLabel = "—"; }

  return {
    entry: Math.round(entry * 100) / 100,
    stop: Math.round(stop * 100) / 100,
    target: Math.round(target * 100) / 100,
    crv: Math.round(crv * 100) / 100,
    riskPct,
    riskLabel,
    stopPct: ((risk / price) * 100).toFixed(1),
  };
}

// Phase 3: Haupt-Scoring-Funktion — evaluiert alle Setup-Typen
function computeSwingScore(candles) {
  if (!candles || candles.length < 60) {
    return { total: 0, setup: null, setupKey: null, setupEmoji: null, factors: [], signals: [], error: "Zu wenig Daten" };
  }

  const ind = extractIndicators(candles);

  // Qualifizierende Setups evaluieren (mit Invalidierungs-Check)
  const results = [];
  for (const [typeKey, setup] of Object.entries(SETUP_TYPES)) {
    try {
      if (!setup.qualify(ind)) continue;
      // Merkmalliste v2: Invalidierung pruefen
      if (setup.invalidate && setup.invalidate(ind)) continue;
    } catch (e) { continue; }

    const { factors, signals } = scoreForSetup(ind, typeKey);
    const total = Math.round(factors.reduce((s, f) => s + f.score * (setup.weights[f.name] || 0), 0));
    results.push({ total, setup: setup.label, setupKey: setup.key, setupEmoji: setup.emoji, factors, signals });
  }

  // Fallback: GENERAL wenn kein Setup qualifiziert
  if (results.length === 0) {
    const { factors, signals } = scoreForSetup(ind, "GENERAL");
    const total = Math.round(factors.reduce((s, f) => s + f.score * (SETUP_GENERAL.weights[f.name] || 0), 0));
    results.push({ total, setup: SETUP_GENERAL.label, setupKey: SETUP_GENERAL.key, setupEmoji: SETUP_GENERAL.emoji, factors, signals });
  }

  // Bestes Setup waehlen
  results.sort((a, b) => b.total - a.total);
  const best = results[0];

  // Weights in Factors einfuegen (fuer Debug/Anzeige)
  const activeSetup = Object.values(SETUP_TYPES).find(s => s.key === best.setupKey);
  const activeWeights = activeSetup ? activeSetup.weights : SETUP_GENERAL.weights;
  best.factors = best.factors.map(f => ({ ...f, weight: activeWeights[f.name] || 0 }));

  // Alle qualifizierten Setups als Signal hinzufuegen
  if (results.length > 1) {
    best.signals.push("Setups: " + results.map(r => r.setupEmoji + " " + r.setup + " " + r.total).join(", "));
  }

  // Trade-Setup berechnen (Entry/Stop/Target/CRV/Risiko)
  best.tradeSetup = computeTradeSetup(ind, best.setupKey.toUpperCase());
  best.atr = ind.atrLast;

  // Setup-Subtitle mitgeben
  const activeType = Object.values(SETUP_TYPES).find(s => s.key === best.setupKey);
  best.subtitle = activeType?.subtitle || SETUP_GENERAL.subtitle || "";

  return best;
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

  // 4. ATR-Breakout (15%) — True ATR (nicht nur High-Low)
  let atrScore = 30;
  if (dailyCandles && dailyCandles.length >= 16) {
    const atrArr = calcTrueATR(dailyCandles, 14);
    if (atrArr.length > 0) {
      const atr = atrArr[atrArr.length - 1];
      const today = dailyCandles[dailyCandles.length - 1];
      const prevClose = dailyCandles[dailyCandles.length - 2].close;
      const todayTR = Math.max(today.high - today.low, Math.abs(today.high - prevClose), Math.abs(today.low - prevClose));
      const atrRatio = atr > 0 ? todayTR / atr : 1;
      if (atrRatio >= 2) { atrScore = 100; signals.push(`ATR-Breakout ${atrRatio.toFixed(1)}x`); }
      else if (atrRatio >= 1.5) { atrScore = 70; signals.push(`ATR ${atrRatio.toFixed(1)}x`); }
      else if (atrRatio >= 1) atrScore = 30;
      else atrScore = 10;
    }
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

// ─── Composite TA Score (Citadel-Style Analysis) ───
// Mirrors the scoring from generate_pdf_report.py
// Score range: ~-11.0 to ~+11.0 (Trend D×1.5+W×1.0+M×0.5 + RSI + MACD + MA + Volume)
// Multi-timeframe trends approximated from daily data using SMA periods

function computeCompositeScore(candles) {
  if (!candles || candles.length < 60) return null;

  const ind = extractIndicators(candles);
  const closes = ind.closes;
  const price = ind.currentPrice;

  // SMA20 (not in extractIndicators, needed for daily trend + MA alignment)
  const sma20arr = calcSMA(closes, 20);
  const sma20 = sma20arr.length > 0 ? sma20arr[sma20arr.length - 1] : price;

  // ── 1. TREND (Daily×1.5 + Weekly×1.0 + Monthly×0.5, max ±6.0) ──
  let dailyTrend = 0;
  if (sma20arr.length >= 2) {
    const sma20Slope = (sma20 - sma20arr[sma20arr.length - 2]) / sma20arr[sma20arr.length - 2] * 100;
    if (price > sma20 && sma20 > ind.sma50 && (ind.sma200 ? ind.sma50 > ind.sma200 : true) && sma20Slope > 0.3) {
      dailyTrend = 2; // Strong Uptrend
    } else if (price > (ind.sma200 || ind.sma50) && sma20Slope >= 0) {
      dailyTrend = 1; // Uptrend
    } else if (price < ind.sma50 && price < sma20 && sma20 < ind.sma50 && sma20Slope < -0.3) {
      dailyTrend = -2; // Strong Downtrend
    } else if (price < (ind.sma200 || ind.sma50)) {
      dailyTrend = -1; // Downtrend
    }
  }

  // Weekly (approximated from daily): SMA50 vs SMA200 + slope
  let weeklyTrend = 0;
  if (ind.sma200 && closes.length >= 60) {
    const sma50arr10ago = calcSMA(closes.slice(0, -10), 50);
    const sma50slope = sma50arr10ago.length > 0
      ? (ind.sma50 - sma50arr10ago[sma50arr10ago.length - 1]) / sma50arr10ago[sma50arr10ago.length - 1] * 100
      : 0;
    if (ind.sma50 > ind.sma200 && sma50slope > 0.2) weeklyTrend = 2;
    else if (ind.sma50 > ind.sma200) weeklyTrend = 1;
    else if (ind.sma50 < ind.sma200 && sma50slope < -0.2) weeklyTrend = -2;
    else if (ind.sma50 < ind.sma200) weeklyTrend = -1;
  } else {
    weeklyTrend = dailyTrend > 0 ? 1 : dailyTrend < 0 ? -1 : 0;
  }

  // Monthly (approximated from daily): Price vs SMA200 + long-term slope
  let monthlyTrend = 0;
  if (ind.sma200 && closes.length >= 220) {
    const sma200arr20ago = calcSMA(closes.slice(0, -20), 200);
    const sma200slope = sma200arr20ago.length > 0
      ? (ind.sma200 - sma200arr20ago[sma200arr20ago.length - 1]) / sma200arr20ago[sma200arr20ago.length - 1] * 100
      : 0;
    if (price > ind.sma200 && sma200slope > 0.1) monthlyTrend = 2;
    else if (price > ind.sma200) monthlyTrend = 1;
    else if (price < ind.sma200 && sma200slope < -0.1) monthlyTrend = -2;
    else if (price < ind.sma200) monthlyTrend = -1;
  } else {
    monthlyTrend = weeklyTrend;
  }

  const trendScore = dailyTrend * 1.5 + weeklyTrend * 1.0 + monthlyTrend * 0.5;

  // ── 2. RSI (±1.5) ──
  let rsiScore = 0;
  if (ind.rsi < 30) rsiScore = 1.5;
  else if (ind.rsi < 40) rsiScore = 0.5;
  else if (ind.rsi > 70) rsiScore = -1.5;
  else if (ind.rsi > 60) rsiScore = -0.3;

  // ── 3. MACD Histogram (±1.0) ──
  const macdHist = ind.macd.histogram;
  let macdScore = 0;
  if (macdHist.length > 0) {
    macdScore = macdHist[macdHist.length - 1] > 0 ? 1.0 : -1.0;
  }

  // ── 4. MA Alignment (±2.0) ──
  let maScore = 0;
  if (ind.sma200) {
    if (price > sma20 && sma20 > ind.sma50 && ind.sma50 > ind.sma200) maScore = 2.0;       // Perfect Bull
    else if (price < sma20 && sma20 < ind.sma50 && ind.sma50 < ind.sma200) maScore = -2.0;  // Perfect Bear
    else if (price > ind.sma200) maScore = 0.5;
    else if (price < ind.sma200) maScore = -0.5;
  } else {
    if (price > sma20 && sma20 > ind.sma50) maScore = 1.5;
    else if (price < sma20 && sma20 < ind.sma50) maScore = -1.5;
    else if (price > ind.sma50) maScore = 0.5;
    else maScore = -0.5;
  }

  // ── 5. Volume (±1.0) ──
  let volumeScore = 0;
  if (ind.volRatio >= 1.5 && !ind.lastIsRed) volumeScore = 1.0;       // Strong buying
  else if (ind.volRatio >= 1.2 && !ind.lastIsRed) volumeScore = 0.5;
  else if (ind.volRatio >= 1.5 && ind.lastIsRed) volumeScore = -1.0;  // Strong selling
  else if (ind.volRatio >= 1.2 && ind.lastIsRed) volumeScore = -0.5;

  // ── COMPOSITE SCORE ──
  const compositeScore = Math.round((trendScore + rsiScore + macdScore + maScore + volumeScore) * 10) / 10;

  // ── CONFIDENCE RATING ──
  let confidence;
  if (compositeScore >= 5) confidence = "STRONG BUY";
  else if (compositeScore >= 2) confidence = "BUY";
  else if (compositeScore >= -2) confidence = "NEUTRAL";
  else if (compositeScore >= -5) confidence = "SELL";
  else confidence = "STRONG SELL";

  const direction = compositeScore >= 1 ? "LONG" : compositeScore <= -1 ? "SHORT" : "NEUTRAL";

  // ── ATR-BASED TRADE PLAN (LONG only, EUR 45k portfolio, EUR 450 max risk) ──
  let tradePlan = null;
  if (direction === "LONG") {
    const atr = ind.atrLast || price * 0.02;
    const entry = Math.round((price - 0.5 * atr) * 100) / 100;

    // Nearest support within 1.5 ATR for tighter stop
    const nearSupports = ind.swingLows.filter(s => s < entry && entry - s <= 1.5 * atr);
    let stop;
    if (nearSupports.length > 0) {
      stop = Math.round((Math.max(...nearSupports) - 0.15 * atr) * 100) / 100;
    } else {
      stop = Math.round((entry - 1.5 * atr) * 100) / 100;
    }

    // Nearest resistance for target, or 3 ATR default
    const nearResistances = ind.swingHighs.filter(r => r > entry && r - entry <= 5 * atr);
    let target;
    if (nearResistances.length > 0) {
      target = Math.round(Math.min(...nearResistances) * 100) / 100;
    } else {
      target = Math.round((entry + 3.0 * atr) * 100) / 100;
    }

    // Safety: target > entry, stop < entry
    if (target <= entry) target = Math.round((entry + 3.0 * atr) * 100) / 100;
    if (stop >= entry) stop = Math.round((entry - 1.5 * atr) * 100) / 100;

    const risk = entry - stop;
    const reward = target - entry;
    const rr = risk > 0 ? Math.round((reward / risk) * 10) / 10 : 0;

    // Position sizing: EUR 45,000 portfolio, EUR 450 max risk (1%)
    const shares = risk > 0 ? Math.floor(450 / risk) : 0;
    const positionValue = Math.round(shares * entry);
    const portfolioPct = Math.round((positionValue / 45000) * 1000) / 10;

    tradePlan = {
      entry, stop, target,
      risk: Math.round(risk * 100) / 100,
      reward: Math.round(reward * 100) / 100,
      rr, shares, positionValue, portfolioPct,
      atr: Math.round(atr * 100) / 100,
    };
  }

  // ── ADJUSTED SCORE (for ranking, factors in R:R quality) ──
  let adjustedScore = compositeScore;
  if (tradePlan && tradePlan.rr > 0) {
    adjustedScore = Math.round((compositeScore * (1 + 0.15 * Math.log(tradePlan.rr))) * 10) / 10;
  }

  return {
    compositeScore, adjustedScore, confidence, direction, tradePlan,
    breakdown: {
      trend: Math.round(trendScore * 10) / 10,
      rsi: rsiScore, macd: macdScore, ma: maScore, volume: volumeScore,
    },
    indicators: {
      rsi: Math.round(ind.rsi * 10) / 10,
      macdHist: macdHist.length > 0 ? Math.round(macdHist[macdHist.length - 1] * 1000) / 1000 : 0,
      sma20: Math.round(sma20 * 100) / 100,
      sma50: Math.round(ind.sma50 * 100) / 100,
      sma200: ind.sma200 ? Math.round(ind.sma200 * 100) / 100 : null,
      atr: Math.round(ind.atrLast * 100) / 100,
      dailyTrend: ["Stark Ab", "Ab", "Neutral", "Auf", "Stark Auf"][dailyTrend + 2],
      weeklyTrend: ["Stark Ab", "Ab", "Neutral", "Auf", "Stark Auf"][weeklyTrend + 2],
      monthlyTrend: ["Stark Ab", "Ab", "Neutral", "Auf", "Stark Auf"][monthlyTrend + 2],
    },
  };
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
  const composite = computeCompositeScore(dailyCandles);

  const lastCandle = dailyCandles[dailyCandles.length - 1];
  const prevCandle = dailyCandles.length >= 2 ? dailyCandles[dailyCandles.length - 2] : null;
  const price = lastCandle?.close || meta.regularMarketPrice || 0;
  const change = prevCandle ? ((price - prevCandle.close) / prevCandle.close) * 100 : 0;

  // ATR fuer Trade-Setup Stops
  const atrArr = calcTrueATR(dailyCandles, 14);
  const atr = atrArr.length > 0 ? atrArr[atrArr.length - 1] : price * 0.03;

  // Display symbol: remove .DE suffix
  const displaySymbol = symbol.replace(/\.DE$/i, "");

  return {
    symbol,
    displaySymbol,
    name: meta.symbol || symbol,
    currency: meta.currency || "USD",
    price,
    change,
    atr,
    swing,
    intraday,
    composite,
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

// ─── Telegram Bot ───

async function sendTelegram(text, env) {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) {
    console.log("[Telegram] Skipped: TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not configured.");
    return { sent: false, error: "not configured" };
  }
  try {
    const resp = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: env.TELEGRAM_CHAT_ID,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
    });
    const data = await resp.json();
    if (!data.ok) {
      console.log(`[Telegram] API error: ${data.description}`);
      return { sent: false, error: data.description };
    }
    return { sent: true };
  } catch (e) {
    console.log(`[Telegram] Send failed: ${e.message}`);
    return { sent: false, error: e.message };
  }
}

async function sendTelegramMessages(messages, env) {
  let sent = 0;
  for (const msg of messages) {
    // Split if over 4096 chars
    if (msg.length <= 4096) {
      const result = await sendTelegram(msg, env);
      if (result.sent) sent++;
    } else {
      // Split at section dividers
      const parts = [];
      let current = "";
      for (const line of msg.split("\n")) {
        if (current.length + line.length + 1 > 4000 && current.length > 0) {
          parts.push(current);
          current = line;
        } else {
          current += (current ? "\n" : "") + line;
        }
      }
      if (current) parts.push(current);
      for (const part of parts) {
        const result = await sendTelegram(part, env);
        if (result.sent) sent++;
      }
    }
    // Small delay between messages to respect rate limits
    if (messages.indexOf(msg) < messages.length - 1) {
      await new Promise(r => setTimeout(r, 400));
    }
  }
  return sent;
}

// ─── Time-Based Symbol Selection ───
// DAX 40:   09:00–19:00 UTC (10:00–20:00 CET)
// S&P 500:  14:00–22:00 UTC (15:00–23:00 CET)
// Overlap:  14:00–19:00 UTC → both markets

function getActiveSymbols() {
  const now = new Date();
  const utcHour = now.getUTCHours();
  const utcMinute = now.getUTCMinutes();
  const timeDecimal = utcHour + utcMinute / 60;

  const daxActive = timeDecimal >= 9 && timeDecimal < 19;     // 09:00–18:59 UTC
  const spActive  = timeDecimal >= 14 && timeDecimal < 22;    // 14:00–21:59 UTC

  if (daxActive && spActive) return { symbols: [...SP100_SYMBOLS, ...DAX40_SYMBOLS], mode: "both" };
  if (daxActive)             return { symbols: [...DAX40_SYMBOLS], mode: "dax-only" };
  if (spActive)              return { symbols: [...SP100_SYMBOLS], mode: "sp100-only" };
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
    composite: null,
    timestamp: new Date().toISOString(),
  };
}

async function runChunkedScan(env) {
  // 1. Determine which symbols to scan based on current time
  const { symbols: activeSymbols, mode: currentMode } = getActiveSymbols();

  // 2. Market closed — skip without writing (saves KV writes)
  if (currentMode === "closed" || activeSymbols.length === 0) {
    console.log(`[Scan] Market closed. Skipping.`);
    return { chunk: 0, totalChunks: 0, scanned: 0, mode: "closed" };
  }

  // 3. Load config + live accumulator (state + results in ONE key = 1 KV read)
  const config = (await env.NCAPITAL_KV.get("scan:config", "json")) || SCAN_DEFAULTS;
  const chunkSize = config.chunkSize || SCAN_DEFAULTS.chunkSize;
  const parallelBatch = config.parallelBatch || SCAN_DEFAULTS.parallelBatch;
  const totalChunks = Math.ceil(activeSymbols.length / chunkSize);

  const live = (await env.NCAPITAL_KV.get("scan:live", "json")) || {
    pointer: 0, lastPointer: -1, retryCount: 0,
    mode: null, totalChunks: 0, totalSymbols: 0,
    results: [], lastRun: null, lastFullScan: null,
  };

  // 4. Handle mode transition (e.g. dax-only → both at 14:00 UTC)
  let pointer = live.pointer;

  if (live.mode !== null && live.mode !== currentMode) {
    console.log(`[Scan] Mode transition: ${live.mode} -> ${currentMode}. Resetting cycle.`);
    if (pointer > 0 && live.results.length > 0) {
      console.log(`[Scan] Processing partial results (${live.results.length} symbols from ${live.mode}).`);
      await processAndNotify(env, config, live.results);
      live.lastFullScan = new Date().toISOString();
    }
    pointer = 0;
    live.pointer = 0;
    live.results = [];
    live.retryCount = 0;
    live.lastPointer = -1;
  }

  // 5. Update mode info
  live.mode = currentMode;
  live.totalChunks = totalChunks;
  live.totalSymbols = activeSymbols.length;

  // 6. Stuck-pointer detection: if same pointer runs 3+ times, force advance
  if (pointer === live.lastPointer) {
    if (live.retryCount >= 2) {
      console.log(`[Scan] [${currentMode}] Chunk ${pointer + 1}/${totalChunks} stuck after ${live.retryCount + 1} attempts. Skipping.`);
      const skipNext = pointer + 1;
      if (skipNext >= totalChunks) {
        await processAndNotify(env, config, live.results);
        live.pointer = 0;
        live.results = [];
        live.lastFullScan = new Date().toISOString();
      } else {
        live.pointer = skipNext;
      }
      live.retryCount = 0;
      live.lastRun = new Date().toISOString();
      await env.NCAPITAL_KV.put("scan:live", JSON.stringify(live));
      return { chunk: pointer + 1, totalChunks, scanned: 0, skipped: true, mode: currentMode };
    }
    live.retryCount++;
    // Persist retry state early so retryCount survives crashes
    await env.NCAPITAL_KV.put("scan:live", JSON.stringify(live));
  } else {
    live.retryCount = 0;
  }
  live.lastPointer = pointer;

  // 7. Determine symbols for this chunk
  const start = pointer * chunkSize;
  const end = Math.min(start + chunkSize, activeSymbols.length);
  const chunkSymbols = activeSymbols.slice(start, end);

  console.log(`[Scan] [${currentMode}] Chunk ${pointer + 1}/${totalChunks}: ${chunkSymbols.length} symbols (${chunkSymbols[0]}..${chunkSymbols[chunkSymbols.length - 1]})`);

  // 8. Scan in parallel batches (with per-batch timeout safety)
  const results = [];
  const scanStart = Date.now();
  for (let i = 0; i < chunkSymbols.length; i += parallelBatch) {
    if (Date.now() - scanStart > 20000) {
      console.log(`[Scan] Time limit approaching after ${results.length} symbols. Saving partial results.`);
      break;
    }
    const batch = chunkSymbols.slice(i, i + parallelBatch);
    const batchResults = await Promise.all(
      batch.map((sym) => scanSymbolServer(sym).catch((err) => errorResult(sym, err.message)))
    );
    results.push(...batchResults);
  }

  // 9. Accumulate results in live state (no separate chunk keys needed)
  live.results.push(...results);

  // 10. Advance pointer or process full cycle
  const nextPointer = pointer + 1;

  if (nextPointer >= totalChunks) {
    console.log(`[Scan] [${currentMode}] All ${totalChunks} chunks done. Processing ${live.results.length} results...`);
    await processAndNotify(env, config, live.results);
    live.pointer = 0;
    live.results = [];
    live.lastFullScan = new Date().toISOString();
  } else {
    live.pointer = nextPointer;
  }

  // 11. Single KV write: state + accumulated results in one key
  live.lastRun = new Date().toISOString();
  await env.NCAPITAL_KV.put("scan:live", JSON.stringify(live));

  return { chunk: pointer + 1, totalChunks, scanned: results.length, mode: currentMode };
}

async function processAndNotify(env, config, allResults) {
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

  // ── Composite TA Picks: LONG only with R:R >= 1.4 ──
  const taPicks = allResults
    .filter((r) => r.composite && r.composite.direction === "LONG" && r.composite.tradePlan && r.composite.tradePlan.rr >= 1.4)
    .sort((a, b) => (b.composite.adjustedScore || 0) - (a.composite.adjustedScore || 0))
    .slice(0, 20); // Top 20 picks

  // ── ±5% Daily Movers ──
  const movers = allResults
    .filter((r) => r.price > 0 && Math.abs(r.change) >= 5)
    .sort((a, b) => Math.abs(b.change) - Math.abs(a.change));

  // Save results + stats (combined into one key to save writes)
  const stats = {
    totalScanned: allResults.length,
    hits: filtered.length,
    taPicks: taPicks.length,
    movers: movers.length,
    errors: allResults.filter((r) => r.swing.error || r.intraday.error).length,
    timestamp: new Date().toISOString(),
    breadth: { dax: breadth(daxAll), sp100: breadth(spAll) },
  };

  // Save scan results + TA picks + movers (parallel KV writes)
  await Promise.all([
    env.NCAPITAL_KV.put("scan:results", JSON.stringify({ hits: filtered, stats }), { expirationTtl: 259200 }),
    env.NCAPITAL_KV.put("scan:ta-picks", JSON.stringify({
      picks: taPicks.map((r) => ({
        symbol: r.symbol, displaySymbol: r.displaySymbol, name: r.name,
        currency: r.currency, price: r.price, change: r.change, atr: r.atr,
        composite: r.composite, swing: { total: r.swing.total, setup: r.swing.setup, setupEmoji: r.swing.setupEmoji },
      })),
      movers: movers.map((r) => ({
        symbol: r.symbol, displaySymbol: r.displaySymbol, name: r.name,
        currency: r.currency, price: r.price, change: r.change,
      })),
      stats: { totalScanned: allResults.length, longPicks: taPicks.length, movers: movers.length },
      timestamp: new Date().toISOString(),
    }), { expirationTtl: 259200 }),
  ]);

  console.log(`[Scan] Merged: ${allResults.length} total, ${filtered.length} hits (swing >= ${threshold}), ${taPicks.length} TA picks (LONG R:R>=1.4), ${movers.length} movers (±5%), ${stats.errors} errors`);

  // Send Telegram scanner alerts (swing >= 78, independent from Web Push)
  await sendTelegramScannerAlerts(filtered, env);

  // Send Telegram TA picks alert (composite score LONG candidates)
  await sendTelegramTAPicksAlert(taPicks, env);

  // Send Telegram ±5% mover alerts
  await sendTelegramMoverAlerts(movers, env);

  // Send push notifications for high-score results
  const notifyResults = filtered.filter((r) => r.swing.total >= notifyThreshold);
  if (notifyResults.length === 0) return;

  // Collect subscriptions from ALL users (per-user keys + legacy global key)
  const allSubs = [];
  const subSources = []; // Track which KV key each sub came from for cleanup
  const legacySubs = (await env.NCAPITAL_KV.get("push:subscriptions", "json")) || [];
  for (const sub of legacySubs) {
    allSubs.push(sub);
    subSources.push("push:subscriptions");
  }
  const listResult = await env.NCAPITAL_KV.list({ prefix: "push:user:" });
  for (const key of listResult.keys) {
    if (!key.name.endsWith(":subscriptions")) continue;
    const userSubs = (await env.NCAPITAL_KV.get(key.name, "json")) || [];
    for (const sub of userSubs) {
      allSubs.push(sub);
      subSources.push(key.name);
    }
  }
  if (allSubs.length === 0) return;

  // Batch-read all cooldowns in parallel (saves N sequential reads)
  const cooldownKeys = notifyResults.map((r) => `cooldown:${r.displaySymbol}`);
  const cooldownValues = await Promise.all(cooldownKeys.map((k) => env.NCAPITAL_KV.get(k)));

  const notifications = [];
  const expiredIndices = new Set();
  const cooldownWrites = [];

  for (let ri = 0; ri < notifyResults.length; ri++) {
    if (cooldownValues[ri]) continue; // Already notified recently
    const r = notifyResults[ri];

    const topSignals = r.swing.signals.slice(0, 2).join(" + ");
    const setupLabel = r.swing.setupEmoji ? `${r.swing.setupEmoji} ${r.swing.setup}` : "Swing";
    const ts = r.swing.tradeSetup || {};
    const fmtP = (v) => v >= 100 ? v.toFixed(0) : v.toFixed(2);
    const title = `${r.displaySymbol} ${setupLabel} ${r.swing.total}`;
    const crvInfo = ts.crv ? `CRV ${ts.crv.toFixed(1)} · ${ts.riskLabel}` : "";
    const setupInfo = ts.entry ? `Entry ${fmtP(ts.entry)} → Ziel ${fmtP(ts.target)} · Stop ${fmtP(ts.stop)}` : "";
    const body = `${r.price.toFixed(2)} ${r.currency}${setupInfo ? " · " + setupInfo : ""}${crvInfo ? "\n" + crvInfo : ""}${topSignals ? " · " + topSignals : ""}`;
    const tag = `scan-${r.displaySymbol}`;

    let anySent = false;
    for (let si = 0; si < allSubs.length; si++) {
      const pushResult = await sendPush(allSubs[si], { title, body, tag, url: "/trading/" }, env);
      if (pushResult.sent) anySent = true;
      if (pushResult.expired) expiredIndices.add(si);
    }

    if (anySent) {
      cooldownWrites.push(env.NCAPITAL_KV.put(cooldownKeys[ri], "1", { expirationTtl: 3600 }));
      notifications.push({ symbol: r.displaySymbol, score: r.swing.total, title });
    }
  }

  // Clean up expired subscriptions — group by source key
  const writes = [...cooldownWrites];
  if (expiredIndices.size > 0) {
    const cleanupByKey = {};
    for (let i = 0; i < allSubs.length; i++) {
      const key = subSources[i];
      if (!cleanupByKey[key]) cleanupByKey[key] = [];
      if (!expiredIndices.has(i)) cleanupByKey[key].push(allSubs[i]);
    }
    for (const [key, validSubs] of Object.entries(cleanupByKey)) {
      writes.push(env.NCAPITAL_KV.put(key, JSON.stringify(validSubs)));
    }
  }
  if (writes.length > 0) await Promise.all(writes);

  console.log(`[Scan] Notifications sent: ${notifications.length} to ${allSubs.length} devices`);
}

// ── Telegram Scanner Alerts (independent from Web Push, swing >= 78) ──

async function sendTelegramScannerAlerts(filtered, env) {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) return;
  if (!filtered || filtered.length === 0) return;

  // Own cooldown per symbol (separate from push cooldown)
  const cooldownKeys = filtered.map((r) => `tg-cooldown:${r.displaySymbol}`);
  const cooldownValues = await Promise.all(cooldownKeys.map((k) => env.NCAPITAL_KV.get(k)));

  const newHits = [];
  const cooldownWrites = [];
  for (let i = 0; i < filtered.length; i++) {
    if (cooldownValues[i]) continue;
    newHits.push(filtered[i]);
    cooldownWrites.push(env.NCAPITAL_KV.put(cooldownKeys[i], "1", { expirationTtl: 3600 }));
  }
  if (newHits.length === 0) return;

  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const fmtP = (v) => v >= 100 ? v.toFixed(0) : v.toFixed(2);
  const lines = newHits.map((r) => {
    const price = `${fmtP(r.price)} ${r.currency}`;
    const sigs = r.swing.signals.slice(0, 3).map((s) => esc(s)).join(", ");
    const dot = r.change >= 0 ? "\u{1F7E2}" : "\u{1F534}";
    const chg = r.change >= 0 ? `+${r.change.toFixed(1)}%` : `${r.change.toFixed(1)}%`;
    // Trade-Setup aus computeSwingScore (realistisch pro Setup-Typ)
    const ts = r.swing.tradeSetup || {};
    const entry = ts.entry || r.price;
    const stop = ts.stop || r.price * 0.97;
    const target = ts.target || r.price * 1.05;
    const crv = ts.crv ? ts.crv.toFixed(1) : "?";
    const stopPct = ts.stopPct || "3.0";
    const riskLabel = ts.riskLabel || "—";
    const atr = r.swing.atr || r.price * 0.03;

    const setupTag = r.swing.setupEmoji ? `${r.swing.setupEmoji} ${r.swing.setup}` : "Swing";
    const subtitle = r.swing.subtitle ? ` <i>${esc(r.swing.subtitle)}</i>` : "";
    let line = `${dot} <b>${esc(r.displaySymbol)}</b>  ${setupTag} ${r.swing.total}  \u2502  ${price} (${chg})${subtitle}\n`;
    line += `   Entry ${fmtP(entry)}  \u2502  Stop ${fmtP(stop)} (-${stopPct}%)  \u2502  Ziel ${fmtP(target)}\n`;
    line += `   CRV <b>${crv}</b>  \u2502  Risiko <b>${riskLabel}</b>  \u2502  ATR ${fmtP(atr)}\n`;
    if (sigs) line += `   ${sigs}`;
    return line;
  });

  const header = newHits.length === 1
    ? "\u{1F3AF} <b>Trade-Setup</b>"
    : `\u{1F3AF} <b>${newHits.length} Trade-Setups</b>`;
  const msg = `${header}\n\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\n${lines.join("\n\n")}\n\n<i>Swing \u{2265} 78 \u{2022} Setup-basiertes CRV</i>`;
  await sendTelegram(msg, env);
  await Promise.all(cooldownWrites);
  console.log(`[Telegram] Scanner alerts sent: ${newHits.length} hits`);
}

// ── Telegram TA Picks Alert (Composite Score LONG Candidates) ──

async function sendTelegramTAPicksAlert(taPicks, env) {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) return;
  if (!taPicks || taPicks.length === 0) return;

  // Only send picks with composite score > 5 (STRONG BUY)
  const strongPicks = taPicks.filter((r) => r.composite && r.composite.compositeScore > 5);
  if (strongPicks.length === 0) return;

  // Per-symbol cooldown: skip already-alerted symbols (6 hours)
  const cooldownKeys = strongPicks.map((r) => `tg-ta:${r.displaySymbol}`);
  const cooldownValues = await Promise.all(cooldownKeys.map((k) => env.NCAPITAL_KV.get(k)));

  const newPicks = [];
  const cooldownWrites = [];
  for (let i = 0; i < strongPicks.length; i++) {
    if (cooldownValues[i]) continue; // Already alerted
    newPicks.push(strongPicks[i]);
    cooldownWrites.push(env.NCAPITAL_KV.put(cooldownKeys[i], "1", { expirationTtl: 21600 })); // 6h cooldown
  }
  if (newPicks.length === 0) return;

  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const fmtP = (v) => v >= 100 ? v.toFixed(0) : v.toFixed(2);

  const lines = newPicks.slice(0, 10).map((r, i) => {
    const c = r.composite;
    const tp = c.tradePlan;
    const dot = r.change >= 0 ? "\u{1F7E2}" : "\u{1F534}";
    const chg = r.change >= 0 ? `+${r.change.toFixed(1)}%` : `${r.change.toFixed(1)}%`;
    const confEmoji = c.confidence === "STRONG BUY" ? "\u{1F525}" : "\u{2705}";

    let line = `${i + 1}. ${dot} <b>${esc(r.displaySymbol)}</b>  ${confEmoji} ${c.confidence}  Score <b>${c.compositeScore}</b>\n`;
    line += `   ${fmtP(r.price)} ${r.currency} (${chg})\n`;
    if (tp) {
      line += `   Entry <b>${fmtP(tp.entry)}</b> \u{2502} Stop ${fmtP(tp.stop)} \u{2502} Ziel ${fmtP(tp.target)}\n`;
      line += `   R:R <b>${tp.rr}</b> \u{2502} ${tp.shares} Stk. \u{2502} ${tp.portfolioPct}% Depot`;
    }
    return line;
  });

  const header = `\u{1F4CA} <b>TA-Scanner: ${newPicks.length} STRONG BUY</b>`;
  const subheader = `<i>Score > 5 \u{2022} Depot EUR 45k \u{2022} R:R \u{2265} 1.4</i>`;
  const msg = `${header}\n${subheader}\n\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\n${lines.join("\n\n")}\n\n<i>Composite TA Score \u{2022} ATR-basierte Levels</i>`;

  await sendTelegramMessages([msg], env);
  await Promise.all(cooldownWrites);
  console.log(`[Telegram] TA picks alert sent: ${newPicks.length} STRONG BUY (filtered from ${taPicks.length} total)`);
}

// ── Telegram ±5% Mover Alerts ──

async function sendTelegramMoverAlerts(movers, env) {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) return;
  if (!movers || movers.length === 0) return;

  // Per-symbol cooldown to avoid spam (4 hours)
  const cooldownKeys = movers.map((r) => `tg-mover:${r.displaySymbol}`);
  const cooldownValues = await Promise.all(cooldownKeys.map((k) => env.NCAPITAL_KV.get(k)));

  const newMovers = [];
  const cooldownWrites = [];
  for (let i = 0; i < movers.length; i++) {
    if (cooldownValues[i]) continue;
    newMovers.push(movers[i]);
    cooldownWrites.push(env.NCAPITAL_KV.put(cooldownKeys[i], "1", { expirationTtl: 14400 }));
  }
  if (newMovers.length === 0) return;

  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const fmtP = (v) => v >= 100 ? v.toFixed(0) : v.toFixed(2);

  const gainers = newMovers.filter(r => r.change >= 5).sort((a, b) => b.change - a.change);
  const losers = newMovers.filter(r => r.change <= -5).sort((a, b) => a.change - b.change);

  const lines = [];
  if (gainers.length > 0) {
    lines.push("\u{1F4C8} <b>Top-Gewinner (\u{2265} +5%)</b>");
    for (const r of gainers) {
      lines.push(`\u{1F7E2} <b>${esc(r.displaySymbol)}</b>  ${fmtP(r.price)} ${r.currency}  <b>+${r.change.toFixed(1)}%</b>`);
    }
  }
  if (losers.length > 0) {
    if (gainers.length > 0) lines.push("");
    lines.push("\u{1F4C9} <b>Top-Verlierer (\u{2264} -5%)</b>");
    for (const r of losers) {
      lines.push(`\u{1F534} <b>${esc(r.displaySymbol)}</b>  ${fmtP(r.price)} ${r.currency}  <b>${r.change.toFixed(1)}%</b>`);
    }
  }

  const header = `\u{1F6A8} <b>${newMovers.length} Aktie${newMovers.length > 1 ? "n" : ""} mit \u{00B1}5% Bewegung</b>`;
  const msg = `${header}\n\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\u{2500}\n${lines.join("\n")}\n\n<i>Top 100 US + DAX 40 \u{2022} Tagesmover</i>`;

  await sendTelegram(msg, env);
  await Promise.all(cooldownWrites);
  console.log(`[Telegram] Mover alerts sent: ${newMovers.length} (${gainers.length} gainers, ${losers.length} losers)`);
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
    // Volume analysis for index symbols (from already-fetched data, 0 extra API calls)
    let volumeData = null;
    const VOLUME_INDICES = ["^GSPC", "^GDAXI", "^DJI", "^IXIC"];
    if (VOLUME_INDICES.includes(symbol) && parsed5d && parsed5d.candles.length >= 2) {
      const candles5d = parsed5d.candles;
      const lastCandle = candles5d[candles5d.length - 1];
      const volumes = candles5d.map(c => c.volume).filter(v => v > 0);
      if (volumes.length >= 2 && lastCandle.volume > 0) {
        const currentVol = lastCandle.volume;
        const avgVol = volumes.reduce((a, b) => a + b, 0) / volumes.length;
        const ratio = avgVol > 0 ? currentVol / avgVol : 1;
        let longTermAvg = null, longTermRatio = null;
        if (parsed1y && parsed1y.candles.length >= 4) {
          const weeklyVols = parsed1y.candles.map(c => c.volume).filter(v => v > 0);
          if (weeklyVols.length >= 4) {
            longTermAvg = Math.round((weeklyVols.reduce((a, b) => a + b, 0) / weeklyVols.length) / 5);
            longTermRatio = longTermAvg > 0 ? Math.round((currentVol / longTermAvg) * 100) / 100 : null;
          }
        }
        volumeData = {
          current: currentVol,
          avg5d: Math.round(avgVol),
          ratio: Math.round(ratio * 100) / 100,
          longTermAvg,
          longTermRatio,
        };
      }
    }
    results[symbol] = { price, change, prevClose, high, low, currency, trend5d, w52, volumeData };
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
  const jpy = macro["JPY=X"];
  if (jpy && !jpy.error) {
    const carry = jpy.change > 0.5 ? "Yen schwach → Carry-Trade intakt" : jpy.change < -0.5 ? "Yen staerker → Carry-Trade-Risiko" : "stabil";
    signals.push({ indicator: "USD/JPY", value: jpy.price.toFixed(2), change: jpy.change.toFixed(2), interpretation: carry, signal: jpy.change < -1 ? "VORSICHT" : "INFO" });
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
      // Trade-Setup aus computeSwingScore (realistisch pro Setup-Typ)
      const ts = r.swing.tradeSetup || {};
      const entry = ts.entry || r.price;
      const stop = ts.stop || Math.round((r.price * 0.97) * 100) / 100;
      const target = ts.target || Math.round((r.price * 1.05) * 100) / 100;
      const crv = ts.crv ? ts.crv.toFixed(1) : "0";
      const stopPct = ts.stopPct || "3.0";
      const riskPct = ts.riskPct || 0;
      const riskLabel = ts.riskLabel || "—";
      const atr = r.swing.atr || r.price * 0.03;
      return {
        symbol: r.displaySymbol, currency: r.currency,
        swingScore: r.swing.total, intradayScore: r.intraday.total,
        combinedScore: r.combinedScore || Math.round(r.swing.total * 0.6 + r.intraday.total * 0.4),
        setup: r.swing.setup, setupKey: r.swing.setupKey, setupEmoji: r.swing.setupEmoji,
        subtitle: r.swing.subtitle,
        price: r.price, change: r.change, atr: Math.round(atr * 100) / 100,
        entry, stop, target, crv, stopPct, riskPct, riskLabel,
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

  // Find upcoming events (next 30 days)
  const upcomingEvents = RECURRING_EVENTS_2026
    .filter(e => {
      const eventDate = new Date(year, e.month - 1, e.day);
      const diffDays = (eventDate - now) / (1000 * 60 * 60 * 24);
      return diffDays >= -1 && diffDays <= 30;
    })
    .map(e => ({ ...e, daysUntil: Math.ceil((new Date(year, e.month - 1, e.day) - now) / (1000 * 60 * 60 * 24)) }))
    .sort((a, b) => a.daysUntil - b.daysUntil || (b.impactScore || 0) - (a.impactScore || 0));

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

// ─── Telegram Briefing Formatter ───

function formatBriefingForTelegram(briefing) {
  const messages = [];
  const type = briefing.type;
  const region = type === "morning" ? "Europa" : "Wall Street";
  const emoji = type === "morning" ? "\u2600\uFE0F" : "\uD83C\uDF19";
  const now = new Date(briefing.generatedAt);
  const weekdays = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];
  const months = ["Januar", "Februar", "Maerz", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];
  const dateStr = `${weekdays[now.getDay()]}, ${now.getDate()}. ${months[now.getMonth()]} ${now.getFullYear()}`;
  const timeStr = now.toLocaleString("de-DE", { timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit" });

  // HTML-escape for Telegram (& < > must be escaped)
  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  const fmtChg = (c) => {
    if (c == null || isNaN(c)) return "\u2014";
    const v = Number(c);
    return `${v > 0 ? "+" : ""}${v.toFixed(2)}%`;
  };
  const fmtDir = (c) => {
    if (c == null || isNaN(c)) return "\u25AB\uFE0F";
    return Number(c) > 0.1 ? "\uD83D\uDFE2" : Number(c) < -0.1 ? "\uD83D\uDD34" : "\u25AB\uFE0F";
  };
  const fmtP = (p, d = 2) => p != null && !isNaN(p) ? Number(p).toFixed(d) : "\u2014";

  // Build macro lookup
  const macroMap = {};
  for (const cat of (briefing.macroOverview || [])) {
    for (const item of cat.items) {
      if (!item.error) macroMap[item.symbol] = item;
    }
  }

  // ═══════════════════════════════════════
  // NACHRICHT 1: Globaler Marktueberblick
  // ═══════════════════════════════════════
  let msg1 = `${emoji} <b>${type === "morning" ? "MORNING" : "AFTERNOON"} BRIEFING</b>\n`;
  msg1 += `\uD83D\uDCC5 ${dateStr} \u2022 ${timeStr} CET\n`;
  msg1 += `\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n`;

  // Futures => Richtung fuer den Tag
  if (briefing.futures) {
    const es = briefing.futures.es;
    const nq = briefing.futures.nq;
    if (es || nq) {
      msg1 += `\n\uD83C\uDFAF <b>Futures-Signal:</b>`;
      if (es) msg1 += ` S&amp;P <b>${fmtChg(es.change)}</b>`;
      if (es && nq) msg1 += `  \u2502  `;
      if (nq) msg1 += `Nasdaq <b>${fmtChg(nq.change)}</b>`;
      msg1 += `\n`;
    }
  }

  // Indizes — US + Europa
  const indices = briefing.macroOverview?.find(c => c.category === "indices");
  if (indices?.items?.length) {
    msg1 += `\n\uD83C\uDFE6 <b>Leitindizes</b>\n`;
    for (const idx of indices.items) {
      if (idx.error) continue;
      let context = "";
      if (idx.w52) {
        if (idx.w52.pctFromHigh != null && Math.abs(idx.w52.pctFromHigh) < 2) context = " \u2022 <i>nahe ATH</i>";
        else if (idx.w52.pctFromHigh != null) context = ` \u2022 <i>${Number(idx.w52.pctFromHigh).toFixed(1)}% v. Hoch</i>`;
      }
      const trend5d = idx.trend5d != null ? ` (5T: ${fmtChg(idx.trend5d)})` : "";
      const pd = idx.price > 1000 ? 0 : 2;
      msg1 += `${fmtDir(idx.change)} <b>${esc(idx.name)}</b>  ${fmtP(idx.price, pd)}  <b>${fmtChg(idx.change)}</b>${trend5d}${context}\n`;
    }
  }

  // Asien
  const asia = briefing.macroOverview?.find(c => c.category === "asia");
  if (asia?.items?.length) {
    msg1 += `\n\uD83C\uDF0F <b>Asien-Pazifik</b>\n`;
    for (const idx of asia.items) {
      if (idx.error) continue;
      const pd = idx.price > 1000 ? 0 : 2;
      const trend5d = idx.trend5d != null ? ` (5T: ${fmtChg(idx.trend5d)})` : "";
      msg1 += `${fmtDir(idx.change)} <b>${esc(idx.name)}</b>  ${fmtP(idx.price, pd)}  <b>${fmtChg(idx.change)}</b>${trend5d}\n`;
    }
  }

  // Makro-Dashboard — kompakt in Zeilen
  msg1 += `\n\uD83D\uDCCA <b>Makro-Dashboard</b>\n`;

  const vix = macroMap["^VIX"];
  if (vix) {
    const level = vix.price >= 30 ? "\uD83D\uDD34 Panik" : vix.price >= 20 ? "\uD83D\uDFE0 Erhoht" : vix.price >= 15 ? "\uD83D\uDFE1 Normal" : "\uD83D\uDFE2 Sorglos";
    msg1 += `VIX <b>${fmtP(vix.price)}</b> ${fmtChg(vix.change)} \u2502 ${level}`;
    if (briefing.vixHistory?.ytd?.avg) msg1 += ` \u2502 YTD-\u00D8 ${fmtP(briefing.vixHistory.ytd.avg)}`;
    msg1 += `\n`;
  }

  const tnx = macroMap["^TNX"];
  if (tnx) msg1 += `US 10Y <b>${fmtP(tnx.price)}%</b> \u2502 ${tnx.change > 0.02 ? "steigend \u2191" : tnx.change < -0.02 ? "fallend \u2193" : "stabil \u2192"}\n`;

  const gold = macroMap["GC=F"];
  const oil = macroMap["CL=F"];
  if (gold || oil) {
    let line = "";
    if (gold) line += `Gold <b>${fmtP(gold.price, 0)}$</b> ${fmtChg(gold.change)}`;
    if (gold && oil) line += `  \u2502  `;
    if (oil) line += `WTI <b>${fmtP(oil.price)}$</b> ${fmtChg(oil.change)}`;
    msg1 += `${line}\n`;
  }

  const eur = macroMap["EURUSD=X"];
  const jpy = macroMap["JPY=X"];
  if (eur || jpy) {
    let line = "";
    if (eur) line += `EUR/USD <b>${fmtP(eur.price, 4)}</b> ${fmtChg(eur.change)}`;
    if (eur && jpy) line += `  \u2502  `;
    if (jpy) line += `USD/JPY <b>${fmtP(jpy.price, 2)}</b> ${fmtChg(jpy.change)}`;
    msg1 += `${line}\n`;
  }

  const btc = macroMap["BTC-USD"];
  if (btc) msg1 += `BTC <b>${fmtP(btc.price, 0)}$</b> ${fmtChg(btc.change)}\n`;

  // Intermarket-Signale — kompakter
  if (briefing.intermarketSignals?.length) {
    msg1 += `\n\uD83D\uDD17 <b>Intermarket-Signale</b>\n`;
    const sigIcon = { GIER: "\uD83D\uDFE2", NEUTRAL: "\uD83D\uDFE1", VORSICHT: "\uD83D\uDFE0", RISIKO: "\uD83D\uDD34", "RISK-OFF": "\uD83D\uDD34", "RISK-ON": "\uD83D\uDFE2", EXPANSIV: "\uD83D\uDFE2", RESTRIKTIV: "\uD83D\uDD34", INFLATIONAER: "\uD83D\uDD34", DEFLATIONAER: "\uD83D\uDD35", VOLATIL: "\uD83D\uDFE0", INFO: "\u25AB\uFE0F" };
    for (const sig of briefing.intermarketSignals) {
      const ic = sigIcon[sig.signal] || "\u25AB\uFE0F";
      msg1 += `${ic} ${esc(sig.indicator)}: <b>${sig.signal}</b> \u2014 ${esc(sig.interpretation)}\n`;
    }
  }

  if (briefing.aggregateLiquidity) {
    const liq = briefing.aggregateLiquidity;
    msg1 += `\n\uD83D\uDCA7 Liquiditaet: <b>${liq.level}</b> (${liq.avgRatio}x \u00D8)\n`;
  }

  messages.push(msg1);

  // ═══════════════════════════════════════
  // NACHRICHT 2: Events & Szenarien
  // ═══════════════════════════════════════
  let msg2 = "";

  const events = briefing.seasonalContext?.upcomingEvents;
  if (events?.length) {
    const upcoming = events.filter(e => e.daysUntil >= 0 && e.daysUntil <= 10).slice(0, 8);
    const highImpact = upcoming.filter(e => e.impact === "high");
    const others = upcoming.filter(e => e.impact !== "high");

    if (highImpact.length > 0) {
      msg2 += `\u26A1 <b>Events im Fokus</b>\n`;
      msg2 += `\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n`;
      for (const ev of highImpact) {
        const dayLabel = ev.daysUntil === 0 ? "\uD83D\uDD34 HEUTE" : ev.daysUntil === 1 ? "\uD83D\uDFE0 Morgen" : `\uD83D\uDCC5 in ${ev.daysUntil} Tagen`;
        msg2 += `\n${dayLabel}\n`;
        msg2 += `<b>${esc(ev.name)}</b>\n`;
        if (ev.description) msg2 += `${esc(ev.description)}\n`;
        // Szenarien basierend auf Event-Typ
        if (ev.type === "fed") {
          msg2 += `\uD83D\uDFE2 <i>Bullish: Dovisher Ton / Zinspause \u2192 Tech + Growth Rally</i>\n`;
          msg2 += `\uD83D\uDD34 <i>Bearish: Hawkisher Ton / Zinserhoehung \u2192 Bonds runter, Dollar hoch</i>\n`;
        } else if (ev.type === "ecb") {
          msg2 += `\uD83D\uDFE2 <i>Bullish: Zinssenkung \u2192 DAX + EUR-Exporteure profitieren</i>\n`;
          msg2 += `\uD83D\uDD34 <i>Bearish: Restriktiv \u2192 EUR staerker, DAX unter Druck</i>\n`;
        } else if (ev.type === "data" && ev.name.includes("CPI")) {
          msg2 += `\uD83D\uDFE2 <i>Bullish: CPI unter Erwartung \u2192 Zinssenkungshoffnung, Risk-On</i>\n`;
          msg2 += `\uD83D\uDD34 <i>Bearish: CPI ueber Erwartung \u2192 Zinsangst, Tech + Growth leiden</i>\n`;
        } else if (ev.type === "data" && ev.name.includes("Payrolls")) {
          msg2 += `\uD83D\uDFE2 <i>Bullish: Starker Arbeitsmarkt \u2192 Konjunkturoptimismus</i>\n`;
          msg2 += `\uD83D\uDD34 <i>Bearish: Zu heiss \u2192 Fed bleibt restriktiv; Zu schwach \u2192 Rezessionsangst</i>\n`;
        } else if (ev.type === "minutes") {
          msg2 += `\uD83D\uDFE2 <i>Bullish: Interne Zinssenkungsdebatte \u2192 Maerkte hoffen</i>\n`;
          msg2 += `\uD83D\uDD34 <i>Bearish: Einigkeit fuer laenger hoch \u2192 Enttaeuschung</i>\n`;
        } else {
          msg2 += `\uD83D\uDFE2 <i>Bullish: Besser als erwartet \u2192 Risk-On</i>\n`;
          msg2 += `\uD83D\uDD34 <i>Bearish: Schlechter als erwartet \u2192 Risk-Off</i>\n`;
        }
      }
    }

    if (others.length > 0) {
      msg2 += `\n\uD83D\uDCC6 <b>Weitere Termine</b>\n`;
      for (const ev of others) {
        const dayLabel = ev.daysUntil === 0 ? "Heute" : ev.daysUntil === 1 ? "Morgen" : `in ${ev.daysUntil}T`;
        msg2 += `\uD83D\uDFE1 ${esc(ev.name)} \u2014 ${dayLabel}\n`;
      }
    }
  }

  // Saisonale Einordnung
  const seasonal = briefing.seasonalContext;
  if (seasonal) {
    msg2 += `\n\uD83D\uDCC8 <b>Saisonaler Kontext</b>\n`;
    if (seasonal.monthPattern) {
      const sp = seasonal.monthPattern.sp500Avg;
      const dx = seasonal.monthPattern.daxAvg;
      const spIcon = sp > 0.5 ? "\uD83D\uDFE2" : sp < -0.2 ? "\uD83D\uDD34" : "\uD83D\uDFE1";
      msg2 += `${spIcon} <b>${seasonal.monthName}</b>: S&amp;P hist. ${sp > 0 ? "+" : ""}${Number(sp).toFixed(1)}% \u2502 DAX hist. ${dx > 0 ? "+" : ""}${Number(dx).toFixed(1)}%\n`;
      if (seasonal.monthPattern.note) msg2 += `<i>${esc(seasonal.monthPattern.note)}</i>\n`;
    }
    if (seasonal.presidentialCycle) {
      const pc = seasonal.presidentialCycle;
      msg2 += `\uD83C\uDFDB ${pc.name} (S&amp;P-\u00D8 ${pc.sp500Avg > 0 ? "+" : ""}${pc.sp500Avg}%)\n`;
    }
    if (seasonal.midtermNote) msg2 += `\u26A0\uFE0F <i>${esc(seasonal.midtermNote)}</i>\n`;
  }

  if (msg2) messages.push(msg2);

  // ═══════════════════════════════════════
  // NACHRICHT 3: Sektoren & Disclaimer
  // ═══════════════════════════════════════
  let msg3 = "";

  if (briefing.sectorRotation?.length) {
    msg3 += `\uD83C\uDFED <b>Sektorrotation ${region}</b>\n`;
    msg3 += `\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n`;
    const top = briefing.sectorRotation.slice(0, 6);
    for (let i = 0; i < top.length; i++) {
      const s = top[i];
      const medal = i === 0 ? "\uD83E\uDD47" : i === 1 ? "\uD83E\uDD48" : i === 2 ? "\uD83E\uDD49" : `${i + 1}.`;
      const syms = s.topSymbols?.slice(0, 3).map(t => t.symbol).join(", ") || "";
      const chgIcon = s.avgChange > 0 ? "\uD83D\uDFE2" : s.avgChange < 0 ? "\uD83D\uDD34" : "\u25AB\uFE0F";
      msg3 += `${medal} <b>${esc(s.sector)}</b> ${chgIcon} ${fmtChg(s.avgChange)}  Score ${s.avgSwingScore}\n`;
      if (syms) msg3 += `     <i>${syms}</i>\n`;
    }
  }

  msg3 += `\n\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n`;
  msg3 += `\uD83D\uDD0D <i>Trade-Setups kommen separat via Screener-Alerts (alle 5 Min, Swing \u2265 78)</i>\n`;
  msg3 += `\u26A0\uFE0F <i>Keine Anlageberatung. Alle Angaben ohne Gewaehr.</i>`;

  if (msg3) messages.push(msg3);

  return messages;
}

async function generateBriefing(env, type) {
  const startTime = Date.now();

  // 1. Fetch macro data (12 symbols) + VIX history in parallel
  const [macro, vixHistory] = await Promise.all([fetchMacroData(), fetchVixHistory()]);

  // 2. Read latest scan results (1 KV read)
  const scanData = (await env.NCAPITAL_KV.get("scan:results", "json")) || {};
  const scanResults = scanData.hits || scanData || [];

  // 3. Compute analyses
  const intermarketSignals = computeIntermarketSignals(macro);
  const seasonalContext = getSeasonalContext();

  // 4. Build macro overview
  const macroOverview = Object.entries(MACRO_SYMBOLS).map(([category, symbols]) => ({
    category,
    items: symbols.map(s => ({ name: s.name, symbol: s.symbol, ...(macro[s.symbol] || { price: 0, change: 0, error: "Keine Daten" }) })),
  }));

  // 5. Region-specific content (Sektoren + Hits), but Trade-Setups from ALL markets
  let regionFocus, scannerHits, sectorRotation;
  if (type === "morning") {
    regionFocus = "EU";
    const daxResults = scanResults.filter(r => r.symbol.endsWith(".DE"));
    scannerHits = daxResults.slice(0, 15);
    sectorRotation = computeSectorRotation(daxResults, "EU");
  } else {
    regionFocus = "US";
    const usResults = scanResults.filter(r => !r.symbol.endsWith(".DE"));
    scannerHits = usResults.slice(0, 15);
    sectorRotation = computeSectorRotation(usResults, "US");
  }
  // Trade-Setups: beste aus ALLEN Maerkten (unabhaengig von Region)
  const tradeSetups = generateTradeSetups(scanResults, 5);

  // 6. Compute volume/liquidity overview for indices
  const VOLUME_INDEX_SYMS = ["^GSPC", "^GDAXI", "^DJI", "^IXIC"];
  const volumeOverview = VOLUME_INDEX_SYMS
    .map(sym => {
      const m = macro[sym];
      if (!m || !m.volumeData) return null;
      const vd = m.volumeData;
      const indexName = MACRO_SYMBOLS.indices.find(s => s.symbol === sym)?.name || sym;
      const level = vd.ratio >= 1.5 ? "Hoch" : vd.ratio >= 1.1 ? "Normal" : vd.ratio >= 0.8 ? "Unterdurchschnittlich" : "Niedrig";
      return { symbol: sym, name: indexName, ...vd, level };
    })
    .filter(Boolean);
  let aggregateLiquidity = null;
  if (volumeOverview.length > 0) {
    const avgRatio = volumeOverview.reduce((s, v) => s + v.ratio, 0) / volumeOverview.length;
    const level = avgRatio >= 1.5 ? "Hoch" : avgRatio >= 1.1 ? "Normal" : avgRatio >= 0.8 ? "Unterdurchschnittlich" : "Niedrig";
    aggregateLiquidity = { avgRatio: Math.round(avgRatio * 100) / 100, level };
  }

  // 7. Assemble briefing
  const briefing = {
    type, regionFocus,
    generatedAt: new Date().toISOString(),
    generationMs: Date.now() - startTime,
    seasonalContext,
    macroOverview,
    intermarketSignals,
    volumeOverview,
    aggregateLiquidity,
    sectorRotation,
    scannerHits: scannerHits.map(r => ({
      symbol: r.displaySymbol, yahooSymbol: r.symbol, currency: r.currency,
      price: r.price, change: r.change,
      swingScore: r.swing.total, intradayScore: r.intraday.total,
      combinedScore: r.combinedScore || Math.round(r.swing.total * 0.6 + r.intraday.total * 0.4),
      setup: r.swing.setup, setupKey: r.swing.setupKey, setupEmoji: r.swing.setupEmoji,
      subtitle: r.swing.subtitle,
      tradeSetup: r.swing.tradeSetup || {},
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

// ─── Telegram Briefing Cron ───

async function maybeSendBriefingTelegram(env) {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) return;

  const cetHour = getCETHour();
  const today = new Date().toISOString().slice(0, 10);

  // Determine if we're in a briefing window
  let type = null;
  if (cetHour >= 8.4 && cetHour < 8.7) type = "morning";      // 08:24–08:42 CET
  else if (cetHour >= 14.9 && cetHour < 15.2) type = "afternoon"; // 14:54–15:12 CET
  else return;

  // Cooldown: only send once per type per day
  const cooldownKey = `telegram:sent:${type}:${today}`;
  const alreadySent = await env.NCAPITAL_KV.get(cooldownKey);
  if (alreadySent) return;

  console.log(`[Telegram] Generating ${type} briefing for Telegram...`);

  try {
    const briefing = await generateBriefing(env, type);
    const messages = formatBriefingForTelegram(briefing);
    const sent = await sendTelegramMessages(messages, env);

    // Set cooldown (18h TTL — enough to prevent re-send until next day)
    await env.NCAPITAL_KV.put(cooldownKey, String(sent), { expirationTtl: 64800 });
    console.log(`[Telegram] ${type} briefing sent: ${sent} messages.`);
  } catch (e) {
    console.log(`[Telegram] Error sending ${type} briefing: ${e.message}`);
  }
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

  // POST /api/briefing/telegram — generate + send via Telegram
  if (path === "/api/briefing/telegram" && request.method === "POST") {
    if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) {
      return jsonResponse({ error: "Telegram nicht konfiguriert. TELEGRAM_BOT_TOKEN und TELEGRAM_CHAT_ID als Secrets setzen." }, 500);
    }
    let body;
    try { body = await request.json(); } catch { body = {}; }
    const type = body.type === "afternoon" ? "afternoon" : body.type === "morning" ? "morning" : (getCETHour() >= 14 ? "afternoon" : "morning");

    const briefing = await generateBriefing(env, type);
    const messages = formatBriefingForTelegram(briefing);
    const sent = await sendTelegramMessages(messages, env);

    return jsonResponse({ ok: true, type, messagesSent: sent, generationMs: briefing.generationMs });
  }

  return null;
}

// ─── HTTP Route Handlers ───

// Migrate old subscriptions to per-user format (one-time, skips if already done)
let migrationDone = false;
async function migrateSubscriptions(env, username) {
  if (migrationDone) return;
  // Migrate old single subscription → old array
  const oldSub = await env.NCAPITAL_KV.get("push:subscription", "json");
  if (oldSub) {
    const existing = (await env.NCAPITAL_KV.get("push:subscriptions", "json")) || [];
    if (!existing.some(s => s.endpoint === oldSub.endpoint)) {
      existing.push(oldSub);
      await env.NCAPITAL_KV.put("push:subscriptions", JSON.stringify(existing));
    }
    await env.NCAPITAL_KV.delete("push:subscription");
  }
  // Migrate old global array → first authenticated user
  const globalSubs = (await env.NCAPITAL_KV.get("push:subscriptions", "json")) || [];
  if (globalSubs.length > 0 && username !== "default") {
    const userKey = `push:user:${username}:subscriptions`;
    const userSubs = (await env.NCAPITAL_KV.get(userKey, "json")) || [];
    const merged = [...userSubs];
    for (const sub of globalSubs) {
      if (!merged.some(s => s.endpoint === sub.endpoint)) merged.push(sub);
    }
    await env.NCAPITAL_KV.put(userKey, JSON.stringify(merged));
    await env.NCAPITAL_KV.delete("push:subscriptions");
    console.log(`[Migration] Moved ${globalSubs.length} global push subs to user:${username}`);
  }
  migrationDone = true;
}

async function handlePushRoutes(url, request, env, user) {
  const path = url.pathname;
  const username = user?.sub || "default";
  const pushKey = `push:user:${username}:subscriptions`;

  // One-time migration from single to multi subscription
  await migrateSubscriptions(env, username);

  // GET /api/push/vapid-public-key
  if (path === "/api/push/vapid-public-key" && request.method === "GET") {
    return jsonResponse({ key: env.VAPID_PUBLIC_KEY }, 200, 86400);
  }

  // GET /api/push/status
  if (path === "/api/push/status" && request.method === "GET") {
    const [subs, live] = await Promise.all([
      env.NCAPITAL_KV.get(pushKey, "json"),
      env.NCAPITAL_KV.get("scan:live", "json"),
    ]);
    return jsonResponse({
      subscribed: !!(subs && subs.length > 0),
      deviceCount: subs ? subs.length : 0,
      lastRun: live?.lastRun || null,
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

  // POST /api/push/subscribe — adds device to user's subscriptions
  if (path === "/api/push/subscribe") {
    if (!body.subscription) {
      return jsonResponse({ error: "Missing subscription" }, 400);
    }
    const existing = (await env.NCAPITAL_KV.get(pushKey, "json")) || [];
    const filtered = existing.filter(s => s.endpoint !== body.subscription.endpoint);
    filtered.push(body.subscription);
    await env.NCAPITAL_KV.put(pushKey, JSON.stringify(filtered));
    return jsonResponse({ ok: true, message: "Subscription saved", deviceCount: filtered.length });
  }

  // POST /api/push/unsubscribe — removes one device from user's subscriptions
  if (path === "/api/push/unsubscribe") {
    const endpoint = body.endpoint;
    if (endpoint) {
      const existing = (await env.NCAPITAL_KV.get(pushKey, "json")) || [];
      const filtered = existing.filter(s => s.endpoint !== endpoint);
      await env.NCAPITAL_KV.put(pushKey, JSON.stringify(filtered));
      return jsonResponse({ ok: true, message: "Device removed", deviceCount: filtered.length });
    }
    await env.NCAPITAL_KV.put(pushKey, "[]");
    return jsonResponse({ ok: true, message: "All subscriptions removed" });
  }

  // POST /api/push/watchlist
  if (path === "/api/push/watchlist") {
    if (!body.symbols) {
      return jsonResponse({ error: "Missing symbols" }, 400);
    }
    await env.NCAPITAL_KV.put(`watchlist:user:${username}:symbols`, JSON.stringify(body.symbols));
    if (body.thresholds) {
      await env.NCAPITAL_KV.put(`watchlist:user:${username}:thresholds`, JSON.stringify(body.thresholds));
    }
    return jsonResponse({ ok: true, symbols: body.symbols.length });
  }

  // POST /api/push/test — sends test push to current user's devices
  if (path === "/api/push/test") {
    const subs = (await env.NCAPITAL_KV.get(pushKey, "json")) || [];
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
        url: "/trading/",
      }, env);
      results.push(result);
      if (!result.expired) validSubs.push(sub);
    }
    if (validSubs.length < subs.length) {
      await env.NCAPITAL_KV.put(pushKey, JSON.stringify(validSubs));
    }
    return jsonResponse({ sent: results.some(r => r.sent), devices: results.length, results });
  }

  return null; // Not a push route
}

// ─── Scan Routes (/api/scan/*) ───

async function handleScanRoutes(url, request, env) {
  const path = url.pathname;

  // GET /api/scan/results — filtered scan results from KV
  if (path === "/api/scan/results" && request.method === "GET") {
    const [scanData, live] = await Promise.all([
      env.NCAPITAL_KV.get("scan:results", "json"),
      env.NCAPITAL_KV.get("scan:live", "json"),
    ]);
    const hits = scanData?.hits || scanData || [];
    return jsonResponse({ results: hits, lastFullScan: live?.lastFullScan || null, count: hits.length }, 200, 60);
  }

  // GET /api/scan/status — scan progress info (mode-aware)
  if (path === "/api/scan/status" && request.method === "GET") {
    const { mode: liveMode, symbols: liveSymbols } = getActiveSymbols();
    const [live, config, scanData] = await Promise.all([
      env.NCAPITAL_KV.get("scan:live", "json"),
      env.NCAPITAL_KV.get("scan:config", "json"),
      env.NCAPITAL_KV.get("scan:results", "json"),
    ]);
    const cfg = config || SCAN_DEFAULTS;
    const s = live || { pointer: 0, mode: null, totalChunks: 0, totalSymbols: 0, lastRun: null, lastFullScan: null, retryCount: 0 };
    const chunkSize = cfg.chunkSize || SCAN_DEFAULTS.chunkSize;

    return jsonResponse({
      currentChunk: s.pointer || 0,
      totalChunks: s.totalChunks || Math.ceil(liveSymbols.length / chunkSize),
      totalSymbols: s.totalSymbols || liveSymbols.length,
      sp100Count: SP100_SYMBOLS.length,
      dax40Count: DAX40_SYMBOLS.length,
      scanMode: s.mode || liveMode,
      liveMode,
      lastRun: s.lastRun,
      lastFullScan: s.lastFullScan,
      stats: scanData?.stats || null,
      config: cfg,
      retryCount: s.retryCount || 0,
    }, 200, 0);
  }

  // POST /api/scan/reset — reset scan state
  if (path === "/api/scan/reset" && request.method === "POST") {
    await env.NCAPITAL_KV.put("scan:live", JSON.stringify({
      pointer: 0, lastPointer: -1, retryCount: 0,
      mode: null, totalChunks: 0, totalSymbols: 0,
      results: [], lastRun: null, lastFullScan: null,
    }));
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

  // GET /api/scan/ta-picks — composite TA score LONG candidates + movers
  if (path === "/api/scan/ta-picks" && request.method === "GET") {
    const taData = await env.NCAPITAL_KV.get("scan:ta-picks", "json");
    if (!taData) return jsonResponse({ picks: [], movers: [], stats: null }, 200, 60);
    return jsonResponse(taData, 200, 60);
  }

  // GET /api/scan/debug — current accumulator data for debugging
  if (path === "/api/scan/debug" && request.method === "GET") {
    const live = await env.NCAPITAL_KV.get("scan:live", "json");
    if (!live || !live.results || live.results.length === 0) return jsonResponse({ error: "No accumulated results" }, 404);
    const summary = live.results.map((r) => ({
      symbol: r.symbol,
      price: r.price,
      swing: r.swing.total,
      setup: r.swing.setup || "?",
      setupKey: r.swing.setupKey || null,
      intraday: r.intraday.total,
      swingErr: r.swing.error || null,
      intradayErr: r.intraday.error || null,
    }));
    return jsonResponse({ pointer: live.pointer, totalChunks: live.totalChunks, accumulated: live.results.length, errors: summary.filter((s) => s.swingErr || s.intradayErr).length, data: summary });
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

    // ── Auth Routes (public, no token required) ──
    if (url.pathname.startsWith("/api/auth/")) {
      const resp = await handleAuthRoutes(url, request, env);
      if (resp) return resp;
      return jsonResponse({ error: "Unknown auth endpoint" }, 404);
    }

    // ── Auth Middleware: all other routes require valid JWT ──
    const authHeader = request.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return jsonResponse({ error: "Authentifizierung erforderlich" }, 401);
    }
    const user = await verifyJWT(authHeader.slice(7), env.JWT_SECRET);
    if (!user) {
      return jsonResponse({ error: "Token ungueltig oder abgelaufen" }, 401);
    }

    // ── Push Routes ──
    if (url.pathname.startsWith("/api/push/")) {
      const resp = await handlePushRoutes(url, request, env, user);
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
          "/api/briefing/telegram (POST)",
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
    ctx.waitUntil(runChunkedScan(env).catch((err) => console.log(`[Cron] Scan error: ${err.message}`)));
    ctx.waitUntil(maybeSendBriefingTelegram(env).catch((err) => console.log(`[Cron] Briefing error: ${err.message}`)));
  },
};
