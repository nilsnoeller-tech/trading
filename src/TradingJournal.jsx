import React, { useState, useMemo, useEffect, useCallback } from "react";
import { LineChart, Line, AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from "recharts";
import { TrendingUp, TrendingDown, DollarSign, Activity, Target, Shield, BarChart3, ArrowUpRight, ArrowDownRight, AlertTriangle, CheckCircle, XCircle, Zap, Bell, LayoutDashboard, BookOpen, Calculator, ChevronRight, ChevronLeft, ChevronDown, RotateCcw, ArrowRight, Hash, Crosshair, Menu, X, Plus, Info, Wifi, WifiOff, BarChart2, Eye } from "lucide-react";
import Watchlist from "./components/Watchlist";
import { useAutoScore } from "./hooks/useAutoScore";
import { getFinvizChartUrl, isFinvizAvailable } from "./services/marketData";

// ─── Color System ───
const C = {
  bg: "#0B0E11", card: "#141820", cardHover: "#1A1F2B",
  border: "#1E2433", borderLight: "#2A3144",
  text: "#E8ECF1", textMuted: "#8892A4", textDim: "#5A6478",
  accent: "#6C5CE7", accentLight: "#A29BFE",
  green: "#00D68F", greenBg: "rgba(0,214,143,0.08)", greenBorder: "rgba(0,214,143,0.2)",
  red: "#FF6B6B", redBg: "rgba(255,107,107,0.08)", redBorder: "rgba(255,107,107,0.2)",
  yellow: "#FDCB6E", yellowBg: "rgba(253,203,110,0.08)", yellowBorder: "rgba(253,203,110,0.2)",
  orange: "#FFA502", orangeBg: "rgba(255,165,2,0.08)", orangeBorder: "rgba(255,165,2,0.2)",
  noTrade: "#636E72", noTradeBg: "rgba(99,110,114,0.08)", noTradeBorder: "rgba(99,110,114,0.2)",
  blue: "#74B9FF", blueBg: "rgba(116,185,255,0.08)",
};

// ─── Startkapital, Gebühren & Initiale Trade-Daten ───
const STARTKAPITAL = 45691.59;
const GEBUEHR_PRO_ORDER = 7.90; // flatex: 5,90€ Provision + 2,00€ Regulierung

const INITIAL_TRADES = [
  { id: 1, symbol: "SAP", setup: "Mean Reversion", score: 75, ampel: "ORANGE", stopLoss: 164.50, ziel: 192.00, waehrung: "EUR", historical: true,
    transactions: [
      { type: "buy", datum: "2026-02-04", stueck: 16, kurs: 172.46 },
      { type: "buy", datum: "2026-02-04", stueck: 40, kurs: 167.28 },
      { type: "sell", datum: "2026-02-06", stueck: 56, kurs: 174.08 },
    ]
  },
  { id: 2, symbol: "AVGO", setup: "Mean Reversion", score: 80, ampel: "GRÜN", stopLoss: 234.50, ziel: 301.11, waehrung: "EUR", historical: true,
    transactions: [
      { type: "buy", datum: "2026-02-05", stueck: 26, kurs: 262.75 },
      { type: "sell", datum: "2026-02-08", stueck: 13, kurs: 285.30 },
      { type: "sell", datum: "2026-02-12", stueck: 13, kurs: 292.25 },
    ]
  },
];

// ─── Trade Computed Props (Transaction-basiert) ───
function tradeComputedProps(trade) {
  const txs = trade.transactions || [];
  const buys = txs.filter(t => t.type === "buy");
  const sells = txs.filter(t => t.type === "sell");
  const totalBought = buys.reduce((s, t) => s + t.stueck, 0);
  const totalSold = sells.reduce((s, t) => s + t.stueck, 0);
  const remaining = totalBought - totalSold;
  const avgKaufkurs = totalBought > 0 ? buys.reduce((s, t) => s + t.kurs * t.stueck, 0) / totalBought : 0;
  const avgVerkaufskurs = totalSold > 0 ? sells.reduce((s, t) => s + t.kurs * t.stueck, 0) / totalSold : 0;
  const pnlRaw = totalSold > 0 ? sells.reduce((s, t) => s + (t.kurs - avgKaufkurs) * t.stueck, 0) : 0;
  const gebuehrProOrder = GEBUEHR_PRO_ORDER;
  const anzahlOrders = txs.length;
  const totalGebuehren = anzahlOrders * gebuehrProOrder;
  const datum = buys.length > 0 ? buys[0].datum : (txs[0]?.datum || "");
  const status = remaining > 0 ? "Offen" : (totalSold > 0 ? "Verkauf" : "Offen");
  const isPartialClose = totalSold > 0 && remaining > 0;
  return { totalBought, totalSold, remaining, avgKaufkurs, avgVerkaufskurs, pnlRaw, totalGebuehren, datum, status, isPartialClose };
}

// ─── Migration: altes Format → neues Format ───
function migrateTrade(oldTrade) {
  if (oldTrade.transactions) return oldTrade;
  const txs = [];
  if (oldTrade.kaufkurs && oldTrade.stueck) {
    txs.push({ type: "buy", datum: oldTrade.datum, stueck: oldTrade.stueck, kurs: oldTrade.kaufkurs });
  }
  if (oldTrade.verkaufskurs && oldTrade.status === "Verkauf") {
    txs.push({ type: "sell", datum: oldTrade.datum, stueck: oldTrade.stueck, kurs: oldTrade.verkaufskurs });
  }
  const { kaufkurs, verkaufskurs, stueck, datum, status, ...rest } = oldTrade;
  return { ...rest, transactions: txs };
}

// ─── localStorage Persistenz ───
const STORAGE_KEY = "ncapital-trades";
const VERSION_KEY = "ncapital-trades-version";
const CURRENT_VERSION = 2;
function loadTrades() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    const version = parseInt(localStorage.getItem(VERSION_KEY)) || 1;
    if (saved) {
      let parsed = JSON.parse(saved);
      if (version < 2) parsed = parsed.map(migrateTrade);
      localStorage.setItem(VERSION_KEY, String(CURRENT_VERSION));
      const savedIds = new Set(INITIAL_TRADES.map(t => t.id));
      const newTrades = parsed.filter(t => !savedIds.has(t.id));
      return [...INITIAL_TRADES, ...newTrades];
    }
  } catch (e) { /* fallback */ }
  return [...INITIAL_TRADES];
}
function saveTrades(tradeList) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tradeList));
    localStorage.setItem(VERSION_KEY, String(CURRENT_VERSION));
  } catch (e) { /* ignore */ }
}

// ─── Dynamische Berechnungen (Transaction-basiert) ───
function computePortfolio(tradeList, startkapital) {
  let kapital = startkapital;
  const closedTrades = [];
  const openTrades = [];
  const equityPoints = [{ tag: "01.01", wert: startkapital }];

  tradeList.forEach(t => {
    const props = tradeComputedProps(t);
    const fx = t.waehrung === "USD" && t.wechselkurs ? t.wechselkurs : 1;
    const riskPerShare = Math.abs(props.avgKaufkurs - t.stopLoss);
    const rValue = riskPerShare > 0 && props.totalSold > 0 ? (props.avgVerkaufskurs - props.avgKaufkurs) / riskPerShare : 0;
    const pnlBrutto = props.pnlRaw * fx;
    const pnl = pnlBrutto - props.totalGebuehren;

    if (props.status === "Verkauf" || props.isPartialClose) {
      if (!t.historical && props.totalSold > 0) { kapital += pnl; }
      const enriched = { ...t, ...props, pnl, pnlBrutto, rValue, fx };
      if (props.remaining > 0) {
        openTrades.push(enriched);
      }
      if (props.totalSold > 0) {
        closedTrades.push(enriched);
        // Equity-Punkte pro Verkaufs-Transaktion
        const sells = (t.transactions || []).filter(tx => tx.type === "sell");
        sells.forEach(sell => {
          const d = sell.datum.split("-");
          equityPoints.push({ tag: `${d[2]}.${d[1]}`, wert: Math.round(kapital * 100) / 100 });
        });
      }
    } else {
      openTrades.push({ ...t, ...props, pnl: 0, pnlBrutto: 0, rValue: 0, fx });
    }
  });

  const realisiertGewinn = closedTrades.reduce((s, t) => s + t.pnl, 0);
  const wins = closedTrades.filter(t => t.pnl > 0);
  const losses = closedTrades.filter(t => t.pnl <= 0);
  const winRate = closedTrades.length > 0 ? (wins.length / closedTrades.length) * 100 : 0;
  const avgWin = wins.length > 0 ? wins.reduce((s, t) => s + t.pnl, 0) / wins.length : 0;
  const avgLoss = losses.length > 0 ? Math.abs(losses.reduce((s, t) => s + t.pnl, 0) / losses.length) : 0;
  const profitFaktor = losses.length === 0 ? (wins.length > 0 ? Infinity : 0) : (avgLoss > 0 ? avgWin / avgLoss : 0);
  const avgR = closedTrades.length > 0 ? closedTrades.reduce((s, t) => s + t.rValue, 0) / closedTrades.length : 0;
  const offenRisiko = openTrades.reduce((s, t) => {
    const remaining = t.remaining ?? t.totalBought ?? 0;
    const avgK = t.avgKaufkurs ?? 0;
    const risk = Math.abs(avgK - t.stopLoss) * remaining;
    const fx2 = t.waehrung === "USD" && t.wechselkurs ? t.wechselkurs : 1;
    return s + risk * fx2;
  }, 0);
  const roiPct = ((kapital - startkapital) / startkapital) * 100;

  const monthMap = {};
  const monthNames = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];
  closedTrades.forEach(t => {
    const d = t.datum || (t.transactions?.[0]?.datum) || "";
    const m = parseInt(d.split("-")[1]) - 1;
    const key = monthNames[m];
    if (!monthMap[key]) monthMap[key] = { ergebnisR: 0, ergebnisEur: 0, count: 0, sortIdx: m };
    monthMap[key].ergebnisR += t.rValue;
    monthMap[key].ergebnisEur += t.pnl;
    monthMap[key].count++;
  });
  let runningKapitalForMonths = startkapital;
  const monthlyPerf = Object.entries(monthMap)
    .sort(([, a], [, b]) => a.sortIdx - b.sortIdx)
    .map(([monat, data]) => {
      const depotPerf = runningKapitalForMonths > 0 ? (data.ergebnisEur / runningKapitalForMonths) * 100 : 0;
      runningKapitalForMonths += data.ergebnisEur;
      return { monat, ergebnisR: Math.round(data.ergebnisR * 10) / 10, depotPerf: Math.round(depotPerf * 10) / 10 };
    });

  const allForStats = [...closedTrades];
  const gruenTrades = allForStats.filter(t => t.ampel === "GRÜN").length;
  const orangeTrades = allForStats.filter(t => t.ampel === "ORANGE").length;
  const rotTrades = allForStats.filter(t => t.ampel === "ROT").length;
  const nichtTradenTrades = allForStats.filter(t => t.ampel === "NICHT TRADEN").length;
  const total = allForStats.length || 1;
  const avgScore = allForStats.length > 0 ? allForStats.reduce((s, t) => s + t.score, 0) / allForStats.length : 0;
  const gesamtGebuehren = closedTrades.reduce((s, t) => s + (t.totalGebuehren || 0), 0);

  return {
    startkapital, kapital, realisiertGewinn, gesamtGebuehren, offenRisiko, roiPct,
    winRate, profitFaktor, avgR, tradesGesamt: closedTrades.length,
    equityPoints, monthlyPerf,
    setupQuality: {
      avgScore,
      gruen: (gruenTrades / total) * 100,
      orange: (orangeTrades / total) * 100,
      rot: (rotTrades / total) * 100,
      nichtTraden: (nichtTradenTrades / total) * 100,
    },
    closedTrades, openTrades,
  };
}

// ─── Helpers ───
const fmt = (v, d = 2) => typeof v === "number" ? (isFinite(v) ? v.toFixed(d) : "∞") : "–";
const fmtEur = (v) => typeof v === "number" ? new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(v) : "–";
const ampelColor = (a) => a === "GRÜN" ? C.green : a === "ORANGE" ? C.orange : a === "ROT" ? C.red : a === "NICHT TRADEN" ? C.noTrade : C.textMuted;
const ampelBg = (a) => a === "GRÜN" ? C.greenBg : a === "ORANGE" ? C.orangeBg : a === "ROT" ? C.redBg : a === "NICHT TRADEN" ? C.noTradeBg : "transparent";
const ampelBorder = (a) => a === "GRÜN" ? C.greenBorder : a === "ORANGE" ? C.orangeBorder : a === "ROT" ? C.redBorder : a === "NICHT TRADEN" ? C.noTradeBorder : C.border;

// ─── Responsive Hook ───
function useWindowWidth() {
  const [width, setWidth] = useState(typeof window !== "undefined" ? window.innerWidth : 1200);
  useEffect(() => {
    const h = () => setWidth(window.innerWidth);
    window.addEventListener("resize", h);
    return () => window.removeEventListener("resize", h);
  }, []);
  return width;
}

// ─── Shared Components ───
const GlassCard = ({ children, style, onClick }) => (
  <div onClick={onClick} style={{
    background: "linear-gradient(135deg, rgba(20,24,32,0.95), rgba(26,31,43,0.9))",
    border: `1px solid ${C.border}`, borderRadius: 16, padding: 24,
    backdropFilter: "blur(20px)", transition: "all 0.3s cubic-bezier(0.4,0,0.2,1)",
    cursor: onClick ? "pointer" : "default", ...style,
  }}>{children}</div>
);

const StatCard = ({ icon: Icon, label, value, sub, color = C.accent, trend }) => (
  <GlassCard style={{ padding: 20, minWidth: 0 }}>
    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 12 }}>
      <div style={{ width: 40, height: 40, borderRadius: 12, background: `${color}18`, border: `1px solid ${color}33`, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <Icon size={18} color={color} />
      </div>
      {trend !== undefined && (
        <div style={{ display: "flex", alignItems: "center", gap: 3, color: trend >= 0 ? C.green : C.red, fontSize: 12, fontWeight: 600 }}>
          {trend >= 0 ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}{Math.abs(trend).toFixed(1)}%
        </div>
      )}
    </div>
    <div style={{ fontSize: 13, color: C.textMuted, marginBottom: 4, fontWeight: 500 }}>{label}</div>
    <div style={{ fontSize: 24, fontWeight: 700, color: C.text, letterSpacing: "-0.02em" }}>{value}</div>
    {sub && <div style={{ fontSize: 12, color: C.textDim, marginTop: 4 }}>{sub}</div>}
  </GlassCard>
);

const Badge = ({ children, color = C.accent }) => (
  <span style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "3px 10px", borderRadius: 8, fontSize: 11, fontWeight: 600, color, background: `${color}15`, border: `1px solid ${color}30`, letterSpacing: "0.03em", textTransform: "uppercase" }}>{children}</span>
);

const NavItem = ({ icon: Icon, label, active, onClick, num }) => (
  <button onClick={onClick} style={{
    display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "10px 14px", borderRadius: 10, border: "none",
    background: active ? `linear-gradient(135deg, ${C.accent}20, ${C.accent}10)` : "transparent",
    color: active ? C.accentLight : C.textMuted, cursor: "pointer", fontSize: 13, fontWeight: active ? 600 : 500,
    transition: "all 0.2s", borderLeft: active ? `3px solid ${C.accent}` : "3px solid transparent",
  }}>
    <Icon size={17} /><span style={{ flex: 1, textAlign: "left" }}>{label}</span>
    {num !== undefined && <span style={{ fontSize: 10, color: C.textDim, background: `${C.accent}15`, padding: "2px 7px", borderRadius: 6 }}>{num}</span>}
  </button>
);

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: "rgba(20,24,32,0.95)", border: `1px solid ${C.border}`, borderRadius: 10, padding: "10px 14px" }}>
      <div style={{ fontSize: 11, color: C.textMuted, marginBottom: 6 }}>{label}</div>
      {payload.map((p, i) => (
        <div key={i} style={{ fontSize: 13, color: p.color || C.text, fontWeight: 600 }}>
          {p.name}: {typeof p.value === "number" ? p.value.toLocaleString("de-DE") : p.value}
        </div>
      ))}
    </div>
  );
};

// ─── Candle Icon SVGs ───
const CandleIcon = ({ type, size = 32 }) => {
  const s = size;
  if (type === "hammer") return (
    <svg width={s} height={s} viewBox="0 0 32 32" fill="none">
      <line x1="16" y1="2" x2="16" y2="8" stroke="#8892A4" strokeWidth="1.5"/>
      <rect x="11" y="8" width="10" height="6" rx="1.5" fill="#00D68F" stroke="#00D68F"/>
      <line x1="16" y1="14" x2="16" y2="30" stroke="#8892A4" strokeWidth="1.5"/>
    </svg>
  );
  if (type === "engulfing") return (
    <svg width={s} height={s} viewBox="0 0 32 32" fill="none">
      <rect x="12" y="10" width="6" height="12" rx="1" fill="#FF6B6B" stroke="#FF6B6B" opacity="0.5"/>
      <line x1="15" y1="4" x2="15" y2="10" stroke="#8892A4" strokeWidth="1" opacity="0.5"/>
      <line x1="15" y1="22" x2="15" y2="28" stroke="#8892A4" strokeWidth="1" opacity="0.5"/>
      <rect x="10" y="6" width="12" height="18" rx="1.5" fill="#00D68F" stroke="#00D68F"/>
      <line x1="16" y1="2" x2="16" y2="6" stroke="#8892A4" strokeWidth="1.5"/>
      <line x1="16" y1="24" x2="16" y2="30" stroke="#8892A4" strokeWidth="1.5"/>
    </svg>
  );
  if (type === "doji") return (
    <svg width={s} height={s} viewBox="0 0 32 32" fill="none">
      <line x1="16" y1="2" x2="16" y2="14" stroke="#8892A4" strokeWidth="1.5"/>
      <rect x="10" y="14" width="12" height="3" rx="1" fill="#FDCB6E" stroke="#FDCB6E"/>
      <line x1="16" y1="17" x2="16" y2="30" stroke="#8892A4" strokeWidth="1.5"/>
    </svg>
  );
  if (type === "pinbar") return (
    <svg width={s} height={s} viewBox="0 0 32 32" fill="none">
      <rect x="12" y="4" width="8" height="5" rx="1.5" fill="#00D68F" stroke="#00D68F"/>
      <line x1="16" y1="9" x2="16" y2="30" stroke="#8892A4" strokeWidth="1.5"/>
    </svg>
  );
  if (type === "morningstar") return (
    <svg width={s} height={s} viewBox="0 0 32 32" fill="none">
      <rect x="2" y="6" width="7" height="14" rx="1" fill="#FF6B6B" stroke="#FF6B6B"/>
      <line x1="5.5" y1="3" x2="5.5" y2="6" stroke="#8892A4" strokeWidth="1"/>
      <line x1="5.5" y1="20" x2="5.5" y2="24" stroke="#8892A4" strokeWidth="1"/>
      <rect x="12" y="16" width="7" height="4" rx="1" fill="#FDCB6E" stroke="#FDCB6E"/>
      <line x1="15.5" y1="13" x2="15.5" y2="16" stroke="#8892A4" strokeWidth="1"/>
      <line x1="15.5" y1="20" x2="15.5" y2="24" stroke="#8892A4" strokeWidth="1"/>
      <rect x="22" y="4" width="8" height="16" rx="1" fill="#00D68F" stroke="#00D68F"/>
      <line x1="26" y1="2" x2="26" y2="4" stroke="#8892A4" strokeWidth="1"/>
      <line x1="26" y1="20" x2="26" y2="26" stroke="#8892A4" strokeWidth="1"/>
    </svg>
  );
  // "none" = neutrale, uneindeutige Kerze (kurzer Körper, kurze Dochte — kein Signal)
  return (
    <svg width={s} height={s} viewBox="0 0 32 32" fill="none">
      <line x1="16" y1="9" x2="16" y2="13" stroke="#5A6478" strokeWidth="1.5"/>
      <rect x="11" y="13" width="10" height="6" rx="1.5" fill="#5A6478" stroke="#5A6478" opacity="0.5"/>
      <line x1="16" y1="19" x2="16" y2="23" stroke="#5A6478" strokeWidth="1.5"/>
    </svg>
  );
};

// ════════════════════════════════════════════════════════════════
// ─── TRADE CHECK — Geführter Fragebogen mit Setup-Gewichtung ───
// ════════════════════════════════════════════════════════════════

const QUESTIONS = [
  // ── SCHRITT 0: Basisdaten ──
  {
    id: "basis",
    step: 0,
    title: "Basisdaten",
    subtitle: "Dein Konto und der Trade",
    icon: DollarSign,
    color: C.accent,
    type: "inputs",
    fields: [
      { key: "symbol", label: "Ticker / Symbol", placeholder: "z.B. SAP oder AVGO", suffix: "", inputType: "text" },
      { key: "waehrung", label: "Handelswährung", type: "currency-toggle" },
      { key: "kontostand", label: "Aktueller Kontostand", placeholder: "z.B. 45991", suffix: "€" },
      { key: "risikoPct", label: "Max. Risiko pro Trade", placeholder: "1", suffix: "%" },
      { key: "wechselkurs", label: "EUR/USD Wechselkurs", placeholder: "z.B. 0.93", suffix: "$/€", showIf: "usd", type: "fx-rate" },
      { key: "einstieg", label: "Geplanter Einstiegskurs", placeholder: "z.B. 142.30", suffix: "CURRENCY" },
      { key: "stopLoss", label: "Stop-Loss Kurs", placeholder: "z.B. 135.00", suffix: "CURRENCY" },
      { key: "ziel", label: "Zielkurs (Take Profit)", placeholder: "z.B. 160.00", suffix: "CURRENCY" },
    ],
  },
  // ── SCHRITT 1–8: Bewertungsfragen mit setup-spezifischen Gewichten ──
  {
    id: "q1", step: 1, title: "Unterstützungszone",
    subtitle: "Liegt dein Einstiegskurs an einer erkennbaren Unterstützung?",
    icon: Target, color: C.blue, type: "choice",
    weights: { default: 15, breakout: 20, meanReversion: 10, followThrough: 12 },
    question: "Gibt es im Bereich deines Einstiegskurses (±1-2%) eine Unterstützungszone?",
    hint: "Schau auf den Daily Chart der letzten 6–12 Monate: Hat der Kurs in diesem Bereich mehrfach gedreht? Erkennbar an langen unteren Dochten und/oder erhöhtem Volumen bei Berührung.",
    options: [
      { label: "Keine Unterstützung erkennbar", desc: "Kein sichtbarer Halt im Chart — Kurs könnte weiter fallen", score: 0 },
      { label: "Schwache Zone", desc: "Kurs hat sich hier einmal kurz gehalten, aber keine deutliche Reaktion", score: 0.33 },
      { label: "Klare Unterstützung", desc: "Mind. 2× hat der Kurs hier gedreht, erkennbar an langen Dochten", score: 0.75 },
      { label: "Starke Zone + Kaufdruck", desc: "Mehrfach bestätigt mit sichtbarem Kaufdruck (Volumen, Dochte)", score: 1.0 },
    ],
  },
  {
    id: "q2", step: 2, title: "Volumen-Profil am Level",
    subtitle: "Ist am Einstiegs-Level hohes historisches Volumen sichtbar?",
    icon: BarChart3, color: C.green, type: "choice",
    weights: { default: 12, breakout: 18, meanReversion: 8, followThrough: 10 },
    question: "Was zeigt das Volume Profile an deinem Einstiegs-Level?",
    hint: "Volume Profile zeigt, wo historisch am meisten gehandelt wurde. Hohes Volumen = Markt 'akzeptiert' diesen Preis → stärkerer S/R. Quelle: TradingView (Volume Profile Indicator). Daily Chart.",
    options: [
      { label: "Kaum Volumen am Level", desc: "Geringes historisches Volumen, Level wenig beachtet", score: 0 },
      { label: "Moderate Aktivität", desc: "Etwas Volumen, aber kein klarer Cluster", score: 0.33 },
      { label: "Deutlicher Volumen-Cluster", desc: "Level liegt in einer High Volume Node — gut gestützt", score: 0.75 },
      { label: "POC / VPOC nahe Einstieg", desc: "Point of Control (meistgehandelter Preis) nahe deinem Level", score: 1.0 },
    ],
  },
  {
    id: "q3", step: 3, title: "Kerzen-Signal",
    subtitle: "Was sagen dir die letzten Kerzen?",
    icon: Activity, color: C.yellow, type: "choice",
    weights: { default: 12, breakout: 10, meanReversion: 18, followThrough: 10 },
    question: "Gibt es eine klare Bestätigungskerze am Level?",
    hint: "Hammer = langer unterer Docht, kleiner Körper oben. Engulfing = große Kerze verschlingt vorherige. Doji = Kreuz, Unentschlossenheit. Pin Bar = langer Docht in eine Richtung. Daily Chart.",
    candleIcons: true,
    patternReference: [
      { name: "Hammer", icon: "hammer", desc: "Langer unterer Docht, kleiner Körper oben — Käufer drücken Kurs hoch", signal: "bullish" },
      { name: "Bullish Engulfing", icon: "engulfing", desc: "Große grüne Kerze verschlingt vorherige rote — starker Kaufdruck", signal: "bullish" },
      { name: "Pin Bar", icon: "pinbar", desc: "Langer Docht nach unten — Ablehnung tieferer Kurse", signal: "bullish" },
      { name: "Morning Star", icon: "morningstar", desc: "3-Kerzen-Umkehr: Rot → klein → Grün — Trendwende", signal: "bullish" },
      { name: "Doji", icon: "doji", desc: "Kreuz-Kerze, winziger Körper — Unentschlossenheit", signal: "neutral" },
      { name: "Keine Formation", icon: "none", desc: "Normaler Körper, kurze Dochte — kein Signal", signal: "none" },
    ],
    options: [
      { label: "Keine erkennbare Formation", desc: "Unklares Bild, keine Umkehr-/Bestätigungskerze", score: 0, candle: "none" },
      { label: "Doji / schwache Andeutung", desc: "Kreuz-Kerze: Markt unentschlossen, Signal noch schwach", score: 0.33, candle: "doji" },
      { label: "Hammer / Pin Bar / Engulfing", desc: "Klare Umkehrkerze am Level — starkes Signal", score: 0.75, candle: "hammer" },
      { label: "Formation + Folgekerze bestätigt", desc: "Bestätigungskerze + nächste Kerze bestätigt Richtung", score: 1.0, candle: "engulfing" },
    ],
  },
  {
    id: "q4", step: 4, title: "Trend & Struktur",
    subtitle: "Unterstützt der Trend deinen Long-Einstieg?",
    icon: TrendingUp, color: C.accent, type: "choice",
    weights: { default: 15, breakout: 10, meanReversion: 8, followThrough: 22 },
    question: "Wie ist der übergeordnete Trend auf dem Daily Chart?",
    hint: "Ein Long-Trade MIT dem Aufwärtstrend hat deutlich höhere Erfolgschancen. Kaufen im Abwärtstrend braucht sehr starke Signale. Daily Chart.",
    options: [
      { label: "Klarer Abwärtstrend", desc: "Kurs fällt, tiefere Hochs und Tiefs — schwierig für Long", score: 0 },
      { label: "Seitwärtsmarkt / kein Trend", desc: "Range-Markt, Kurs pendelt ohne klare Richtung", score: 0.33 },
      { label: "Leichter Aufwärtstrend", desc: "Tendenz nach oben, aber noch nicht eindeutig", score: 0.67 },
      { label: "Klarer Aufwärtstrend", desc: "Höhere Hochs und Tiefs, EMAs aufsteigend", score: 1.0 },
    ],
  },
  {
    id: "q5", step: 5, title: "RSI & Momentum",
    subtitle: "Ist das Momentum auf deiner Seite?",
    icon: Zap, color: C.green, type: "choice",
    weights: { default: 10, breakout: 5, meanReversion: 20, followThrough: 8 },
    question: "In welchem Bereich befindet sich der RSI(14)?",
    hint: "RSI(14) auf dem Daily Chart. >70 = überkauft, Rücksetzer wahrscheinlich. <40 = unterstützt Long-Einstieg. Divergenz = Kurs macht neues Tief, RSI bildet höheres Tief → bullisches Signal.",
    options: [
      { label: "RSI überkauft (>70)", desc: "Rücksetzer wahrscheinlich — kein guter Long-Einstieg", score: 0.10 },
      { label: "RSI neutral (50–70)", desc: "Kein extremes Signal, Trend könnte weiterlaufen", score: 0.40 },
      { label: "RSI im Kaufbereich (30–50)", desc: "Gute Zone für Long-Einstiege, Momentum aufbauend", score: 0.75 },
      { label: "RSI <40 + bullische Divergenz", desc: "Idealer Bereich + Kurs macht neues Tief, RSI steigt", score: 1.0 },
    ],
  },
  {
    id: "q6", step: 6, title: "EMA-Anordnung",
    subtitle: "Sind die gleitenden Durchschnitte aufsteigend?",
    icon: Layers, color: C.blue, type: "choice",
    weights: { default: 10, breakout: 7, meanReversion: 6, followThrough: 18 },
    question: "Wie stehen die EMAs (20/50/200) zueinander?",
    hint: "Daily Chart. Aufwärtstrend: EMA 20 > 50 > 200. Abwärtstrend: 200 > 50 > 20. Verschlungen = Range/kein Trend.",
    options: [
      { label: "EMAs im Abwärtstrend (200 > 50 > 20)", desc: "Klarer Gegentrend — ungünstig für Long", score: 0 },
      { label: "Verschlungen / keine Ordnung", desc: "Range-Markt, EMAs kreuzen sich ständig", score: 0.30 },
      { label: "Teilweise aufsteigend", desc: "2 von 3 EMAs in Long-Richtung geordnet", score: 0.70 },
      { label: "EMA 20 > 50 > 200", desc: "Klarer Aufwärtstrend — ideal für Long", score: 1.0 },
    ],
  },
  {
    id: "q7", step: 7, title: "Chart-Muster",
    subtitle: "Erkennst du ein klassisches Chartmuster?",
    icon: Crosshair, color: C.yellow, type: "choice",
    weights: { default: 12, breakout: 16, meanReversion: 12, followThrough: 10 },
    question: "Ist ein bekanntes Chart-Muster erkennbar?",
    hint: "Daily Chart. Doppelboden, Head & Shoulders, Flagge, Keil, aufsteigende Dreiecke etc. verstärken das Signal.",
    options: [
      { label: "Kein Muster erkennbar", desc: "Unklare Chartstruktur", score: 0 },
      { label: "Muster angedeutet, nicht vollständig", desc: "Könnte sich bilden, aber noch nicht bestätigt", score: 0.33 },
      { label: "Klares Muster erkennbar", desc: "Flagge, Keil, Dreieck oder Doppelboden sichtbar", score: 0.75 },
      { label: "Muster bestätigt + Ausbruch", desc: "Muster abgeschlossen mit Bestätigung", score: 1.0 },
    ],
  },
  {
    id: "q8", step: 8, title: "Leitindex-Check",
    subtitle: "Unterstützt der Leitindex deinen Trade?",
    icon: Shield, color: C.red, type: "choice",
    weights: { default: 14, breakout: 14, meanReversion: 18, followThrough: 10 },
    question: "Wie steht der Leitindex (S&P 500 oder DAX) zu seinen gleitenden Durchschnitten?",
    hint: "USD-Aktien → S&P 500, EUR-Aktien → DAX. Prüfe auf Tageschart: Steht der Index über/unter 50-MA und 200-MA? Quelle: finviz.com oder boerse.de.",
    options: [
      { label: "Index unter 50-MA UND 200-MA", desc: "Bärenmarkt — schwierig für Käufe", score: 0 },
      { label: "Index zwischen 50-MA und 200-MA", desc: "Korrektur- oder Erholungsphase", score: 0.36 },
      { label: "Index über 200-MA, nahe 50-MA", desc: "Grundtrend intakt, kurzfristig neutral", score: 0.71 },
      { label: "Index über 50-MA UND 200-MA", desc: "Bullenmarkt — breite Beteiligung", score: 1.0 },
    ],
  },
  {
    id: "q9", step: 9, title: "Bollinger Bänder",
    subtitle: "Wo steht der Kurs relativ zu den Bändern?",
    icon: Activity, color: C.yellow, type: "choice",
    weights: { default: 10, breakout: 12, meanReversion: 18, followThrough: 6 },
    question: "Wie verhält sich der Kurs zu den Bollinger Bändern (20,2)?",
    hint: "Bollinger Bänder (20,2) = 20-Tage-MA ± 2 Standardabweichungen. Für Long: Kurs am unteren Band + Umkehrsignal = Kaufgelegenheit. Squeeze = niedrige Volatilität, Ausbruch steht bevor. Daily Chart.",
    options: [
      { label: "Kurs weit außerhalb (unter unterem Band)", desc: "Stark überverkauft — Mean Reversion Setup möglich", score: 0.25 },
      { label: "Kurs innerhalb, nahe unterem Band", desc: "Nähert sich dem Band, aber noch kein Kontakt", score: 0.50 },
      { label: "Kurs mittig zwischen den Bändern", desc: "Neutral — kein Signal von den Bändern", score: 0.35 },
      { label: "Kurs am unteren Band + Umkehrsignal", desc: "Berührt Band und zeigt Kerzen-Umkehr (Hammer, Engulfing)", score: 0.80 },
      { label: "Bollinger Squeeze + Ausbruch nach oben", desc: "Bänder eng zusammen, Ausbruch nach oben beginnt", score: 1.0 },
    ],
  },
];

const TradeCheck = ({ portfolio, tradeList, onAddTrade, onUpdateTrade, onNavigate }) => {
  const [step, setStep] = useState(0);
  const [inputs, setInputs] = useState({ symbol: "", waehrung: "EUR", kontostand: String(Math.round(portfolio.kapital * 100) / 100), risikoPct: "1", wechselkurs: "", einstieg: "", stopLoss: "", ziel: "" });
  const [answers, setAnswers] = useState({});
  const [fxLoading, setFxLoading] = useState(false);
  const [fxDate, setFxDate] = useState("");
  const [tradeAdded, setTradeAdded] = useState(false);
  const [addInputs, setAddInputs] = useState({ stueckzahl: "", kaufkurs: "", datum: new Date().toISOString().split("T")[0] });
  const [manualOverrides, setManualOverrides] = useState({}); // Tracks which questions were manually answered after auto-fill
  const totalSteps = QUESTIONS.length;
  const ww = useWindowWidth();
  const isMobile = ww < 600;

  // ── Auto-Score Integration ──
  const { autoScores, loading: autoLoading, error: autoError, dataTimestamp, staleData, marketData, computeAutoScores, resetAutoScores } = useAutoScore();

  // ── Symbol-Historie ──
  const symbolHistory = useMemo(() => {
    const sym = inputs.symbol.toUpperCase().trim();
    if (!sym || sym.length < 1) return null;
    const matches = tradeList.filter(t => t.symbol === sym);
    if (matches.length === 0) return null;
    let totalPnl = 0, totalR = 0, totalScore = 0, wins = 0, losses = 0;
    let openTrade = null;
    matches.forEach(t => {
      const props = tradeComputedProps(t);
      const fx = t.waehrung === "USD" && t.wechselkurs ? t.wechselkurs : 1;
      const pnlBrutto = props.pnlRaw * fx;
      const pnl = pnlBrutto - props.totalGebuehren;
      const riskPS = Math.abs(props.avgKaufkurs - t.stopLoss);
      const rVal = riskPS > 0 && props.totalSold > 0 ? (props.avgVerkaufskurs - props.avgKaufkurs) / riskPS : 0;
      if (props.totalSold > 0) {
        totalPnl += pnl;
        totalR += rVal;
        if (pnl > 0) wins++; else losses++;
      }
      totalScore += t.score;
      if (props.remaining > 0) openTrade = { ...t, ...props };
    });
    const avgScore = matches.length > 0 ? totalScore / matches.length : 0;
    const avgR = (wins + losses) > 0 ? totalR / (wins + losses) : 0;
    let insight = "";
    if (wins + losses >= 2) {
      if (avgScore >= 70 && losses > wins) insight = "Trotz hoher Scores oft Verluste — Pattern prüfen";
      else if (avgScore < 60 && wins > losses) insight = "Performt besser als der Score vermuten lässt";
      else insight = "Score korreliert gut mit Ergebnis";
    }
    return { symbol: sym, count: matches.length, wins, losses, avgScore, avgR, totalPnl, openTrade, insight };
  }, [inputs.symbol, tradeList]);

  const fetchFxRate = async () => {
    setFxLoading(true);
    try {
      const res = await fetch("https://api.frankfurter.dev/v1/latest?base=USD&symbols=EUR");
      const data = await res.json();
      if (data?.rates?.EUR) {
        setInputs(prev => ({ ...prev, wechselkurs: String(data.rates.EUR) }));
        setFxDate(data.date || "");
      }
    } catch (e) {
      console.warn("Wechselkurs konnte nicht geladen werden:", e);
    }
    setFxLoading(false);
  };

  const isUsd = inputs.waehrung === "USD";
  const currencySymbol = isUsd ? "$" : "€";
  const wechselkurs = parseFloat(inputs.wechselkurs) || 0.93;
  const toEur = (val) => isUsd ? val * wechselkurs : val;

  const updateInput = (k, v) => setInputs(prev => ({ ...prev, [k]: v }));
  const selectAnswer = (qId, optionIndex) => {
    setAnswers(prev => ({ ...prev, [qId]: optionIndex }));
    // Track dass diese Frage manuell beantwortet wurde (nach Auto-Fill)
    if (autoScores) setManualOverrides(prev => ({ ...prev, [qId]: true }));
  };

  // ── Auto-Fill: Antworten vorausfuellen wenn autoScores verfuegbar ──
  useEffect(() => {
    if (!autoScores) return;
    setAnswers(prev => {
      const next = { ...prev };
      Object.entries(autoScores).forEach(([qId, result]) => {
        // Nur vorausfuellen wenn nicht bereits manuell beantwortet
        if (next[qId] === undefined && !manualOverrides[qId]) {
          next[qId] = result.optionIndex;
        }
      });
      return next;
    });
  }, [autoScores]); // eslint-disable-line react-hooks/exhaustive-deps

  const canProceed = step === 0
    ? (parseFloat(inputs.einstieg) > 0 && parseFloat(inputs.stopLoss) > 0 && parseFloat(inputs.ziel) > 0)
    : answers[QUESTIONS[step]?.id] !== undefined;

  const showResults = step === totalSteps;

  // ── Berechnungen ──
  const kontostand = parseFloat(inputs.kontostand) || 0;
  const risikoPct = parseFloat(inputs.risikoPct) || 1;
  const einstieg = parseFloat(inputs.einstieg) || 0;
  const sl = parseFloat(inputs.stopLoss) || 0;
  const ziel = parseFloat(inputs.ziel) || 0;
  const userMaxVerlust = kontostand * (risikoPct / 100);
  const risikoProAktie = Math.abs(einstieg - sl);
  const risikoProAktieEur = toEur(risikoProAktie);
  const crv = risikoProAktie > 0 ? (Math.abs(ziel - einstieg)) / risikoProAktie : 0;
  const orderGroesse = risikoProAktieEur > 0 ? Math.floor(userMaxVerlust / risikoProAktieEur) : 0;
  const kapitaleinsatz = toEur(orderGroesse * einstieg);
  const depotAnteil = kontostand > 0 ? (kapitaleinsatz / kontostand) * 100 : 0;

  // ── Setup-Erkennung (ZUERST, unabhängig vom Score) ──
  const detectedSetup = useMemo(() => {
    const getIdx = (qId) => answers[qId];
    const getScore = (qId) => {
      const idx = getIdx(qId);
      if (idx === undefined) return 0;
      return QUESTIONS.find(q => q.id === qId).options[idx].score;
    };

    const breakoutScore = getScore("q1") * 2 + getScore("q2") * 1.5 + getScore("q7") * 1.2 + getScore("q9") * 0.8;
    const meanRevScore = getScore("q5") * 2 + getScore("q3") * 1.5 + getScore("q8") * 1.0 + getScore("q9") * 1.5;
    const followScore = getScore("q4") * 2 + getScore("q6") * 1.5 + getScore("q1") * 0.5;

    const setups = [
      { name: "Breakout", key: "breakout", score: breakoutScore, color: C.accent, icon: Zap, desc: "Ausbruch über/unter ein getestetes Level mit Volumenbestätigung" },
      { name: "Mean Reversion", key: "meanReversion", score: meanRevScore, color: C.green, icon: Activity, desc: "Rückkehr zum Mittelwert nach extremer Bewegung" },
      { name: "Follow-Through", key: "followThrough", score: followScore, color: C.blue, icon: TrendingUp, desc: "Fortführung eines bestehenden Trends nach Pullback" },
    ];
    setups.sort((a, b) => b.score - a.score);
    return setups;
  }, [answers]);

  const activeSetupKey = detectedSetup.length > 0 ? detectedSetup[0].key : "default";

  // ── Score mit setup-spezifischer Gewichtung ──
  const { totalScore, maxScore } = useMemo(() => {
    let score = 0;
    let max = 0;
    QUESTIONS.filter(q => q.type === "choice").forEach(q => {
      const w = q.weights[activeSetupKey] || q.weights.default;
      max += w;
      if (answers[q.id] !== undefined) {
        score += q.options[answers[q.id]].score * w;
      }
    });
    return { totalScore: Math.round(score), maxScore: max };
  }, [answers, activeSetupKey]);

  const scorePct = maxScore > 0 ? (totalScore / maxScore) * 100 : 0;

  // ── 4-stufige Ampel mit CRV-Integration ──
  const ampelResult = useMemo(() => {
    let stufe;
    if (scorePct >= 75) stufe = 3;
    else if (scorePct >= 55) stufe = 2;
    else if (scorePct >= 35) stufe = 1;
    else stufe = 0;

    if (crv < 1.0) stufe = Math.max(0, stufe - 2);
    else if (crv < 1.5) stufe = Math.max(0, stufe - 1);

    const ampelMap = ["NICHT TRADEN", "ROT", "ORANGE", "GRÜN"];
    const colorMap = [C.noTrade, C.red, C.orange, C.green];
    return { ampel: ampelMap[stufe], scoreColor: colorMap[stufe], stufe };
  }, [scorePct, crv]);

  const { ampel, scoreColor } = ampelResult;

  // ── Positionsgröße an Ampel gekoppelt ──
  const positionAdvice = useMemo(() => {
    switch (ampelResult.ampel) {
      case "GRÜN": return { riskPct: 1.0, pct: 100, label: "Volle Position", color: C.green, desc: "Starkes Setup — 1% Depot-Risiko erlaubt" };
      case "ORANGE": return { riskPct: 0.5, pct: 50, label: "Halbe Position", color: C.orange, desc: "Gemischte Signale — nur 0,5% Depot-Risiko" };
      case "ROT": return { riskPct: 0.25, pct: 25, label: "Mini-Position", color: C.red, desc: "Schwache Signale — maximal 0,25% Depot-Risiko" };
      default: return { riskPct: 0, pct: 0, label: "Nicht traden", color: C.noTrade, desc: "Zu viele Warnsignale — kein Einstieg empfohlen" };
    }
  }, [ampelResult.ampel]);

  // Dynamisches Risiko-Budget: gebundenes Risiko abziehen
  const gebundenesRisiko = portfolio.offenRisiko;
  const verfuegbaresRisiko = Math.max(0, kontostand * (positionAdvice.riskPct / 100) - gebundenesRisiko);
  const effektiverMaxVerlust = Math.min(userMaxVerlust, verfuegbaresRisiko);
  const empfPositionSize = risikoProAktieEur > 0 ? Math.floor(effektiverMaxVerlust / risikoProAktieEur) : 0;
  const empfEinsatz = toEur(empfPositionSize * einstieg);
  const empfRisiko = empfPositionSize * risikoProAktieEur;

  // ── Min CRV ampel-basiert ──
  const minCrv = ampelResult.ampel === "GRÜN" ? 1.5 : ampelResult.ampel === "ORANGE" ? 2.0 : ampelResult.ampel === "ROT" ? 3.0 : Infinity;

  const reset = () => {
    setStep(0); setAnswers({}); setTradeAdded(false); setManualOverrides({});
    setInputs({ symbol: "", waehrung: "EUR", kontostand: String(Math.round(portfolio.kapital * 100) / 100), risikoPct: "1", wechselkurs: "", einstieg: "", stopLoss: "", ziel: "" });
    setAddInputs({ stueckzahl: "", kaufkurs: "", datum: new Date().toISOString().split("T")[0] });
    setFxDate("");
    resetAutoScores();
  };

  // ── Trade-Übernahme (Transaktionsformat + Nachkauf) ──
  const isNachkauf = symbolHistory?.openTrade != null;

  const handleAddTrade = () => {
    const stueck = parseInt(addInputs.stueckzahl) || empfPositionSize;
    const kk = parseFloat(addInputs.kaufkurs) || einstieg;
    if (!stueck || stueck <= 0 || !kk || kk <= 0) return;

    if (isNachkauf && symbolHistory.openTrade) {
      // Nachkauf: Transaction zum bestehenden Trade hinzufügen
      onUpdateTrade(symbolHistory.openTrade.id, (trade) => ({
        ...trade,
        transactions: [...(trade.transactions || []), { type: "buy", datum: addInputs.datum, stueck, kurs: kk }],
      }));
    } else {
      // Neuer Trade im Transaktionsformat
      const newTrade = {
        id: Date.now(),
        symbol: inputs.symbol.toUpperCase(),
        stopLoss: sl,
        ziel,
        setup: detectedSetup[0].name,
        score: totalScore,
        ampel,
        historical: false,
        waehrung: inputs.waehrung,
        ...(isUsd && { wechselkurs }),
        transactions: [{ type: "buy", datum: addInputs.datum, stueck, kurs: kk }],
      };
      onAddTrade(newTrade);
    }
    setTradeAdded(true);
  };

  // ════ RENDER ════
  const currentQ = QUESTIONS[step];
  const progressPct = (step / totalSteps) * 100;

  return (
    <div style={{ maxWidth: 780, margin: "0 auto" }}>
      {/* Progress Bar */}
      <div style={{ marginBottom: 28 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <span style={{ fontSize: 12, color: C.textMuted, fontWeight: 500 }}>
            {showResults ? "Ergebnis" : `Schritt ${step + 1} von ${totalSteps}`}
          </span>
          <span style={{ fontSize: 12, color: C.accent, fontWeight: 600 }}>{Math.round(progressPct)}%</span>
        </div>
        <div style={{ height: 4, borderRadius: 2, background: C.border, overflow: "hidden" }}>
          <div style={{ height: "100%", borderRadius: 2, background: `linear-gradient(90deg, ${C.accent}, ${C.accentLight})`, width: `${progressPct}%`, transition: "width 0.5s cubic-bezier(0.4,0,0.2,1)" }} />
        </div>
        <div style={{ display: "flex", gap: 4, marginTop: 10, justifyContent: "center", flexWrap: "wrap" }}>
          {QUESTIONS.map((q, i) => (
            <div key={i} onClick={() => { if (i <= step) setStep(i); }} style={{
              width: i === step ? 24 : 8, height: 8, borderRadius: 4, cursor: i <= step ? "pointer" : "default",
              background: i < step ? C.accent : i === step ? C.accentLight : C.border,
              transition: "all 0.3s", opacity: i > step ? 0.4 : 1,
            }} />
          ))}
          <div style={{ width: showResults ? 24 : 8, height: 8, borderRadius: 4, background: showResults ? C.green : C.border, transition: "all 0.3s", opacity: showResults ? 1 : 0.4 }} />
        </div>
      </div>

      {/* ── INPUTS STEP ── */}
      {!showResults && currentQ?.type === "inputs" && (
        <>
        <GlassCard style={{ animation: "fadeIn 0.4s ease-out" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 24 }}>
            <div style={{ width: 48, height: 48, borderRadius: 14, background: `${currentQ.color}15`, border: `1px solid ${currentQ.color}30`, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <currentQ.icon size={22} color={currentQ.color} />
            </div>
            <div>
              <div style={{ fontSize: isMobile ? 18 : 20, fontWeight: 800, color: C.text }}>{currentQ.title}</div>
              <div style={{ fontSize: 13, color: C.textMuted }}>{currentQ.subtitle}</div>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 16 }}>
            {currentQ.fields
              .filter(f => !f.showIf || (f.showIf === "usd" && isUsd))
              .map(f => {
              if (f.type === "currency-toggle") {
                return (
                  <div key={f.key} style={{ gridColumn: "1 / -1" }}>
                    <label style={{ display: "block", fontSize: 12, color: C.textMuted, marginBottom: 6, fontWeight: 600 }}>{f.label}</label>
                    <div style={{ display: "flex", gap: 0, borderRadius: 12, overflow: "hidden", border: `1px solid ${C.border}` }}>
                      {[{ val: "EUR", label: "EUR €", desc: "Europäische Aktien" }, { val: "USD", label: "USD $", desc: "US-Aktien (→ EUR)" }].map(opt => (
                        <button key={opt.val} onClick={() => {
                          updateInput("waehrung", opt.val);
                          if (opt.val === "USD" && !inputs.wechselkurs) fetchFxRate();
                        }} style={{
                          flex: 1, padding: "12px 16px", border: "none", cursor: "pointer",
                          background: inputs.waehrung === opt.val
                            ? `linear-gradient(135deg, ${C.accent}25, ${C.accent}10)`
                            : "rgba(10,13,17,0.6)",
                          borderRight: opt.val === "EUR" ? `1px solid ${C.border}` : "none",
                          transition: "all 0.25s",
                        }}>
                          <div style={{ fontSize: 15, fontWeight: 700, color: inputs.waehrung === opt.val ? C.accentLight : C.textMuted }}>{opt.label}</div>
                          <div style={{ fontSize: 11, color: inputs.waehrung === opt.val ? C.textDim : C.textDim + "80", marginTop: 2 }}>{opt.desc}</div>
                        </button>
                      ))}
                    </div>
                  </div>
                );
              }

              if (f.type === "fx-rate") {
                return (
                  <div key={f.key} style={{ gridColumn: "1 / -1" }}>
                    <label style={{ display: "block", fontSize: 12, color: C.textMuted, marginBottom: 6, fontWeight: 600 }}>{f.label}</label>
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <div style={{ position: "relative", flex: 1 }}>
                        <input type="number" value={inputs.wechselkurs} onChange={e => updateInput("wechselkurs", e.target.value)} placeholder={f.placeholder}
                          style={{ width: "100%", padding: "12px 14px", paddingRight: 40, background: "rgba(10,13,17,0.6)", border: `1px solid ${C.border}`, borderRadius: 12, color: C.text, fontSize: 15, fontWeight: 500, outline: "none", transition: "border 0.2s", boxSizing: "border-box" }}
                          onFocus={e => e.target.style.borderColor = C.accent} onBlur={e => e.target.style.borderColor = C.border} />
                        <span style={{ position: "absolute", right: 14, top: "50%", transform: "translateY(-50%)", fontSize: 13, color: C.textDim, fontWeight: 600 }}>€/$</span>
                      </div>
                      <button onClick={fetchFxRate} disabled={fxLoading} style={{
                        padding: "12px 14px", borderRadius: 12, border: `1px solid ${C.accent}40`, background: `${C.accent}10`, cursor: fxLoading ? "wait" : "pointer",
                        color: C.accentLight, fontSize: 13, fontWeight: 600, whiteSpace: "nowrap", display: "flex", alignItems: "center", gap: 6, transition: "all 0.2s",
                      }}>
                        <RotateCcw size={14} style={{ animation: fxLoading ? "spin 1s linear infinite" : "none" }} />
                        {fxLoading ? "Lade…" : "Live-Kurs"}
                      </button>
                    </div>
                    {fxDate && (
                      <div style={{ fontSize: 11, color: C.green, marginTop: 4, fontWeight: 500, display: "flex", alignItems: "center", gap: 4 }}>
                        <CheckCircle size={10} /> EZB-Kurs vom {fxDate} · 1 $ = {parseFloat(inputs.wechselkurs || 0).toFixed(4)} €
                      </div>
                    )}
                    {!fxDate && inputs.wechselkurs && (
                      <div style={{ fontSize: 11, color: C.textDim, marginTop: 4, fontWeight: 500 }}>
                        Manuell eingegeben · 1 $ = {parseFloat(inputs.wechselkurs).toFixed(4)} €
                      </div>
                    )}
                  </div>
                );
              }

              const displaySuffix = f.suffix === "CURRENCY" ? currencySymbol : f.suffix;
              return (
              <div key={f.key} style={f.key === "symbol" ? { gridColumn: "1 / -1" } : {}}>
                <label style={{ display: "block", fontSize: 12, color: C.textMuted, marginBottom: 6, fontWeight: 600 }}>{f.label}</label>
                <div style={{ position: "relative" }}>
                  <input type={f.inputType || "number"} value={inputs[f.key]} onChange={e => updateInput(f.key, e.target.value)} placeholder={f.placeholder}
                    style={{ width: "100%", padding: "12px 14px", paddingRight: displaySuffix ? 40 : 14, background: "rgba(10,13,17,0.6)", border: `1px solid ${C.border}`, borderRadius: 12, color: C.text, fontSize: 15, fontWeight: 500, outline: "none", transition: "border 0.2s", boxSizing: "border-box" }}
                    onFocus={e => e.target.style.borderColor = C.accent} onBlur={e => e.target.style.borderColor = C.border} />
                  {displaySuffix && <span style={{ position: "absolute", right: 14, top: "50%", transform: "translateY(-50%)", fontSize: 13, color: C.textDim, fontWeight: 600 }}>{displaySuffix}</span>}
                </div>
                {f.suffix === "CURRENCY" && isUsd && parseFloat(inputs[f.key]) > 0 && (
                  <div style={{ fontSize: 11, color: C.accent, marginTop: 4, fontWeight: 500 }}>
                    ≈ {(parseFloat(inputs[f.key]) * wechselkurs).toFixed(2)} €
                  </div>
                )}
              </div>
              );
            })}
          </div>

          {/* Symbol-Historie Info-Box */}
          {symbolHistory && (
            <div style={{ marginTop: 16, padding: 16, borderRadius: 12, background: `${C.accent}08`, border: `1px solid ${C.accent}25` }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                <Info size={16} color={C.accent} />
                <span style={{ fontSize: 14, fontWeight: 700, color: C.text }}>
                  {symbolHistory.symbol} — bereits {symbolHistory.count}× gehandelt
                </span>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "1fr 1fr 1fr 1fr", gap: 8, marginBottom: 10 }}>
                <div style={{ padding: "6px 10px", borderRadius: 8, background: "rgba(10,13,17,0.4)" }}>
                  <div style={{ fontSize: 10, color: C.textDim, fontWeight: 600 }}>Trades</div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: C.text }}>{symbolHistory.wins + symbolHistory.losses} ({symbolHistory.wins}W / {symbolHistory.losses}L)</div>
                </div>
                <div style={{ padding: "6px 10px", borderRadius: 8, background: "rgba(10,13,17,0.4)" }}>
                  <div style={{ fontSize: 10, color: C.textDim, fontWeight: 600 }}>Ø Score</div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: C.accentLight }}>{symbolHistory.avgScore.toFixed(0)}</div>
                </div>
                <div style={{ padding: "6px 10px", borderRadius: 8, background: "rgba(10,13,17,0.4)" }}>
                  <div style={{ fontSize: 10, color: C.textDim, fontWeight: 600 }}>Gesamt P&L</div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: symbolHistory.totalPnl >= 0 ? C.green : C.red }}>{symbolHistory.totalPnl >= 0 ? "+" : ""}{fmtEur(symbolHistory.totalPnl)}</div>
                </div>
                <div style={{ padding: "6px 10px", borderRadius: 8, background: "rgba(10,13,17,0.4)" }}>
                  <div style={{ fontSize: 10, color: C.textDim, fontWeight: 600 }}>Ø R-Wert</div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: symbolHistory.avgR >= 0 ? C.green : C.red }}>{symbolHistory.avgR >= 0 ? "+" : ""}{symbolHistory.avgR.toFixed(2)}R</div>
                </div>
              </div>
              {symbolHistory.openTrade && (
                <div style={{ padding: "8px 12px", borderRadius: 8, background: `${C.yellow}10`, border: `1px solid ${C.yellow}30`, marginBottom: 8 }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: C.yellow }}>⚠ Offene Position: {symbolHistory.openTrade.remaining} Stk. @ Ø {symbolHistory.openTrade.avgKaufkurs.toFixed(2)} {inputs.waehrung === "USD" ? "$" : "€"}</span>
                </div>
              )}
              {!symbolHistory.openTrade && (
                <div style={{ padding: "6px 10px", borderRadius: 8, background: "rgba(10,13,17,0.3)" }}>
                  <span style={{ fontSize: 11, color: C.textDim }}>Offene Position: NEIN</span>
                </div>
              )}
              {symbolHistory.insight && (
                <div style={{ marginTop: 8, fontSize: 12, color: C.textMuted, fontStyle: "italic" }}>
                  💡 {symbolHistory.insight}
                </div>
              )}
            </div>
          )}

          {/* Live-Vorschau */}
          {einstieg > 0 && sl > 0 && ziel > 0 && (
            <div style={{ marginTop: 20 }}>
              {isUsd && (
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, padding: "8px 14px", borderRadius: 10, background: `${C.accent}08`, border: `1px solid ${C.accent}20` }}>
                  <DollarSign size={14} color={C.accent} />
                  <span style={{ fontSize: 12, color: C.textMuted }}>USD → EUR Umrechnung aktiv</span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: C.accentLight, marginLeft: "auto" }}>1 $ = {wechselkurs.toFixed(4)} €</span>
                </div>
              )}
              <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "1fr 1fr 1fr 1fr", gap: 10 }}>
                {[
                  { label: "CRV", value: fmt(crv, 1) + "x", color: crv >= 2 ? C.green : crv >= 1.5 ? C.orange : C.red },
                  { label: "Max. Verlust", value: fmtEur(userMaxVerlust), color: C.accent },
                  { label: "Max. Stückzahl", value: orderGroesse.toString(), color: C.blue },
                  { label: "Einsatz (EUR)", value: fmtEur(kapitaleinsatz), color: depotAnteil > 30 ? C.orange : C.accentLight },
                ].map((item, i) => (
                  <div key={i} style={{ textAlign: "center", padding: "12px 8px", borderRadius: 10, background: `${item.color}08`, border: `1px solid ${item.color}20` }}>
                    <div style={{ fontSize: 10, color: C.textMuted, marginBottom: 3, textTransform: "uppercase", fontWeight: 600 }}>{item.label}</div>
                    <div style={{ fontSize: 16, fontWeight: 700, color: item.color }}>{item.value}</div>
                  </div>
                ))}
              </div>

            </div>
          )}
        </GlassCard>

        {/* ── Auto-Fill Button (außerhalb GlassCard, immer sichtbar wenn Symbol + Einstieg vorhanden) ── */}
        {inputs.symbol.trim() && einstieg > 0 && (
          <div style={{ marginTop: 16 }}>
            <button
              onClick={() => computeAutoScores(inputs.symbol, inputs.waehrung, einstieg)}
              disabled={autoLoading}
              style={{
                width: "100%", padding: "14px 20px", borderRadius: 12, cursor: autoLoading ? "wait" : "pointer",
                background: autoScores
                  ? `linear-gradient(135deg, ${C.green}20, ${C.green}08)`
                  : `linear-gradient(135deg, ${C.accent}, ${C.accentLight})`,
                color: autoScores ? C.green : "#fff",
                fontSize: 14, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
                transition: "all 0.3s", opacity: autoLoading ? 0.7 : 1,
                border: autoScores ? `1px solid ${C.green}30` : "none",
              }}
            >
              {autoLoading ? (
                <>
                  <div style={{ width: 16, height: 16, border: "2px solid rgba(255,255,255,0.3)", borderTopColor: "#fff", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
                  Analysiere Marktdaten fuer {inputs.symbol.toUpperCase()}...
                </>
              ) : autoScores ? (
                <>
                  <CheckCircle size={16} />
                  Auto-Analyse abgeschlossen — erneut laden?
                </>
              ) : (
                <>
                  <Zap size={16} />
                  Auto-Fill starten
                </>
              )}
            </button>
            <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>

            {/* Auto-Score Ergebnis-Banner */}
            {autoScores && dataTimestamp && (
              <div style={{
                marginTop: 10, padding: "10px 14px", borderRadius: 10, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap",
                background: staleData ? `${C.yellow}08` : `${C.green}08`,
                border: `1px solid ${staleData ? C.yellow : C.green}20`,
              }}>
                {staleData ? <WifiOff size={14} color={C.yellow} /> : <Wifi size={14} color={C.green} />}
                <span style={{ fontSize: 12, color: staleData ? C.yellow : C.green, fontWeight: 600 }}>
                  {staleData ? "Offline-Daten" : "Live-Daten"} · {dataTimestamp.toLocaleTimeString("de-DE")}
                </span>
                {marketData && (
                  <span style={{ fontSize: 11, color: C.textDim, marginLeft: "auto" }}>
                    {marketData.candles} Kerzen · Letzter Kurs: {marketData.lastPrice?.toFixed(2)} {marketData.currency}
                  </span>
                )}
              </div>
            )}

            {/* Auto-Score Fehler */}
            {autoError && (
              <div style={{ marginTop: 10, padding: "10px 14px", borderRadius: 10, display: "flex", alignItems: "center", gap: 8, background: `${C.red}08`, border: `1px solid ${C.red}20` }}>
                <AlertTriangle size={14} color={C.red} />
                <span style={{ fontSize: 12, color: C.red }}>{autoError}</span>
              </div>
            )}
          </div>
        )}

        {/* ── Finviz Chart (außerhalb GlassCard, kompakt auf Mobile) ── */}
        {inputs.symbol.trim() && isFinvizAvailable(inputs.symbol) && (
          <div style={{ marginTop: 12, borderRadius: 12, overflow: "hidden", border: `1px solid ${C.border}` }}>
            <div style={{ fontSize: 11, color: C.textDim, padding: "6px 12px", background: "rgba(10,13,17,0.6)", display: "flex", alignItems: "center", gap: 6 }}>
              <BarChart2 size={12} />
              Finviz Daily Chart — {inputs.symbol.toUpperCase()}
            </div>
            <img
              src={getFinvizChartUrl(inputs.symbol)}
              alt={`Chart ${inputs.symbol}`}
              style={{ width: "100%", display: "block", background: "#fff" }}
              onError={(e) => { e.target.style.display = "none"; e.target.previousSibling && (e.target.previousSibling.style.display = "none"); }}
            />
          </div>
        )}
        {inputs.symbol.trim() && !isFinvizAvailable(inputs.symbol) && (
          <div style={{ marginTop: 12, padding: "10px 14px", borderRadius: 10, background: `${C.accent}08`, border: `1px solid ${C.accent}15` }}>
            <span style={{ fontSize: 11, color: C.textDim }}>
              <BarChart2 size={12} style={{ verticalAlign: "middle", marginRight: 6 }} />
              Finviz-Chart fuer EU-Aktien nicht verfuegbar — nutze boerse.de oder TradingView fuer {inputs.symbol.toUpperCase()}
            </span>
          </div>
        )}
        </>
      )}

      {/* ── CHOICE STEP ── */}
      {!showResults && currentQ?.type === "choice" && (() => {
        const activeWeight = currentQ.weights[activeSetupKey] || currentQ.weights.default;
        return (
        <div style={{ animation: "fadeIn 0.4s ease-out" }}>
          <GlassCard>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
              <div style={{ width: 48, height: 48, borderRadius: 14, background: `${currentQ.color}15`, border: `1px solid ${currentQ.color}30`, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <currentQ.icon size={22} color={currentQ.color} />
              </div>
              <div>
                <div style={{ fontSize: isMobile ? 18 : 20, fontWeight: 800, color: C.text }}>{currentQ.title}</div>
                <div style={{ fontSize: 13, color: C.textMuted }}>{currentQ.subtitle}</div>
              </div>
            </div>
            <div style={{ fontSize: 11, color: C.textDim, fontWeight: 500, padding: "0 0 4px 60px", letterSpacing: "0.02em" }}>
              Gewichtung: {activeWeight} von {maxScore} Punkten
              {activeSetupKey !== "default" && (
                <span style={{ marginLeft: 8, color: C.accent }}>
                  (angepasst für {detectedSetup[0]?.name})
                </span>
              )}
            </div>
          </GlassCard>

          <div style={{ margin: "20px 0 10px", padding: "0 4px" }}>
            <div style={{ fontSize: 17, fontWeight: 700, color: C.text, marginBottom: 6 }}>{currentQ.question}</div>
            <div style={{ fontSize: 13, color: C.textDim, lineHeight: 1.6 }}>{currentQ.hint}</div>
          </div>

          {/* ── Auto-Score Info-Leiste ── */}
          {autoScores?.[currentQ.id] && (
            <div style={{
              margin: "12px 0 4px", padding: "10px 14px", borderRadius: 10, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap",
              background: manualOverrides[currentQ.id] ? `${C.accent}06` : `${C.blue}08`,
              border: `1px solid ${manualOverrides[currentQ.id] ? C.accent : C.blue}20`,
            }}>
              <Zap size={13} color={manualOverrides[currentQ.id] ? C.accent : C.blue} />
              <span style={{ fontSize: 12, color: manualOverrides[currentQ.id] ? C.accent : C.blue, fontWeight: 600 }}>
                {manualOverrides[currentQ.id] ? "Manuell ueberschrieben" : "Auto-Analyse"}
              </span>
              <span style={{ fontSize: 11, color: C.textMuted }}>
                {autoScores[currentQ.id].detail}
              </span>
              {autoScores[currentQ.id].confidence > 0 && (
                <span style={{ fontSize: 10, color: C.textDim, marginLeft: "auto", padding: "2px 8px", borderRadius: 6, background: "rgba(10,13,17,0.4)" }}>
                  {Math.round(autoScores[currentQ.id].confidence * 100)}% Konfidenz
                </span>
              )}
            </div>
          )}

          {currentQ.patternReference && (
            <div style={{ margin: "16px 0 6px", padding: 16, borderRadius: 12, background: "rgba(10,13,17,0.5)", border: `1px solid ${C.border}` }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: C.textMuted, marginBottom: 12, display: "flex", alignItems: "center", gap: 6 }}>
                <Info size={14} /> Kerzenformationen — Referenz
              </div>
              <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 10 }}>
                {currentQ.patternReference.map(p => (
                  <div key={p.name} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", borderRadius: 8, background: "rgba(20,24,32,0.6)" }}>
                    <div style={{ flexShrink: 0 }}><CandleIcon type={p.icon} size={36} /></div>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: C.text }}>
                        {p.name}
                        <span style={{ fontSize: 10, fontWeight: 600, marginLeft: 6, color: p.signal === "bullish" ? C.green : p.signal === "neutral" ? C.yellow : C.textDim }}>
                          {p.signal === "bullish" ? "BULLISH" : p.signal === "neutral" ? "NEUTRAL" : ""}
                        </span>
                      </div>
                      <div style={{ fontSize: 11, color: C.textDim, lineHeight: 1.4 }}>{p.desc}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 16 }}>
            {currentQ.options.map((opt, i) => {
              const selected = answers[currentQ.id] === i;
              const displayScore = Math.round(opt.score * activeWeight);
              return (
                <div key={i} onClick={() => selectAnswer(currentQ.id, i)} style={{
                  padding: isMobile ? "14px 16px" : "16px 20px", borderRadius: 14, cursor: "pointer",
                  background: selected
                    ? `linear-gradient(135deg, ${currentQ.color}12, ${currentQ.color}06)`
                    : "linear-gradient(135deg, rgba(20,24,32,0.95), rgba(26,31,43,0.9))",
                  border: `2px solid ${selected ? currentQ.color + "60" : C.border}`,
                  transition: "all 0.25s cubic-bezier(0.4,0,0.2,1)",
                  transform: selected ? "scale(1.01)" : "scale(1)",
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: isMobile ? 10 : 14 }}>
                    {currentQ.candleIcons && opt.candle && (
                      <div style={{ flexShrink: 0, opacity: selected ? 1 : 0.6 }}>
                        <CandleIcon type={opt.candle} size={32} />
                      </div>
                    )}
                    {!currentQ.candleIcons && (
                    <div style={{
                      width: 22, height: 22, borderRadius: 11, flexShrink: 0,
                      border: `2px solid ${selected ? currentQ.color : C.borderLight}`,
                      background: selected ? currentQ.color : "transparent",
                      display: "flex", alignItems: "center", justifyContent: "center", transition: "all 0.2s",
                    }}>
                      {selected && <div style={{ width: 8, height: 8, borderRadius: 4, background: "#fff" }} />}
                    </div>
                    )}
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: isMobile ? 14 : 15, fontWeight: 600, color: selected ? C.text : C.textMuted, marginBottom: 2 }}>{opt.label}</div>
                      <div style={{ fontSize: 12, color: C.textDim }}>{opt.desc}</div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      {autoScores?.[currentQ.id]?.optionIndex === i && !manualOverrides[currentQ.id] && (
                        <div style={{ padding: "3px 7px", borderRadius: 6, fontSize: 9, fontWeight: 700, color: C.blue, background: `${C.blue}15`, border: `1px solid ${C.blue}25`, letterSpacing: "0.05em" }}>
                          AUTO
                        </div>
                      )}
                      <div style={{
                        padding: "4px 10px", borderRadius: 8, fontSize: 12, fontWeight: 700,
                        color: opt.score >= 0.7 ? C.green : opt.score >= 0.4 ? C.orange : C.textDim,
                        background: `${opt.score >= 0.7 ? C.green : opt.score >= 0.4 ? C.orange : C.textDim}10`,
                      }}>
                        +{displayScore}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        );
      })()}

      {/* ── RESULTS ── */}
      {showResults && (
        <div style={{ animation: "fadeIn 0.5s ease-out", display: "flex", flexDirection: "column", gap: 20 }}>

          {/* NICHT TRADEN Warnung */}
          {ampel === "NICHT TRADEN" && (
            <GlassCard style={{ background: `linear-gradient(135deg, ${C.noTrade}15, ${C.card})`, border: `2px solid ${C.noTrade}60`, textAlign: "center", padding: "24px" }}>
              <XCircle size={40} color={C.noTrade} style={{ marginBottom: 12 }} />
              <div style={{ fontSize: 20, fontWeight: 800, color: C.noTrade, marginBottom: 8 }}>Trade NICHT empfohlen</div>
              <div style={{ fontSize: 14, color: C.textMuted, maxWidth: 400, margin: "0 auto" }}>
                Die Kombination aus Score ({totalScore}/{maxScore}) und CRV ({fmt(crv, 1)}x) ergibt ein zu hohes Risiko. Warte auf ein besseres Setup.
              </div>
            </GlassCard>
          )}

          {/* Score Header */}
          <GlassCard style={{ background: `linear-gradient(135deg, ${scoreColor}08, ${C.card})`, border: `1px solid ${scoreColor}30`, textAlign: "center", padding: isMobile ? "24px 16px" : "32px 24px" }}>
            {inputs.symbol && <div style={{ fontSize: 14, color: C.textMuted, fontWeight: 600, marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.1em" }}>{inputs.symbol}</div>}
            <div style={{ position: "relative", width: 200, height: 200, margin: "0 auto 16px" }}>
              <svg width="200" height="200" viewBox="0 0 200 200">
                <circle cx="100" cy="100" r="88" fill="none" stroke={C.border} strokeWidth="8" />
                <circle cx="100" cy="100" r="88" fill="none" stroke={scoreColor} strokeWidth="8"
                  strokeDasharray={`${(scorePct / 100) * 553} 553`}
                  strokeLinecap="round" transform="rotate(-90 100 100)"
                  style={{ transition: "stroke-dasharray 1s cubic-bezier(0.4,0,0.2,1)" }} />
              </svg>
              <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
                <span style={{ fontSize: 48, fontWeight: 800, color: scoreColor, lineHeight: 1 }}>{totalScore}</span>
                <span style={{ fontSize: 13, color: C.textMuted, marginTop: 4 }}>von {maxScore}</span>
              </div>
            </div>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "10px 24px", borderRadius: 24, background: `${scoreColor}15`, border: `1px solid ${scoreColor}30`, color: scoreColor, fontSize: 15, fontWeight: 700 }}>
              {ampel === "GRÜN" ? <CheckCircle size={18} /> : ampel === "ORANGE" ? <AlertTriangle size={18} /> : <XCircle size={18} />}
              {ampel}
            </div>
          </GlassCard>

          {/* Positionsgröße */}
          <GlassCard>
            <div style={{ fontSize: 16, fontWeight: 700, color: C.text, marginBottom: 4 }}>Positionsgröße</div>
            <div style={{ fontSize: 13, color: C.textDim, marginBottom: 16 }}>{positionAdvice.desc}</div>

            {/* Ampel-Info */}
            <div style={{ marginBottom: 16, padding: "10px 16px", borderRadius: 10, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8, background: `${positionAdvice.color}08`, border: `1px solid ${positionAdvice.color}30` }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: positionAdvice.color }}>Ampel: {ampel}</span>
              <span style={{ fontSize: 13, color: C.textMuted }}>
                Max. Risiko: {positionAdvice.riskPct}% vom Depot
                {positionAdvice.riskPct < risikoPct && (
                  <span style={{ color: C.orange, marginLeft: 8 }}>(herabgestuft von {risikoPct}%)</span>
                )}
              </span>
            </div>

            {/* Risiko-Budget */}
            {gebundenesRisiko > 0 && (
              <div style={{ marginBottom: 16, padding: "10px 16px", borderRadius: 10, background: `${C.yellow}08`, border: `1px solid ${C.yellow}25` }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: C.yellow, marginBottom: 6 }}>Dynamisches Risiko-Budget</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                  <div>
                    <div style={{ fontSize: 10, color: C.textDim, fontWeight: 600 }}>Gesamt-Budget</div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: C.text }}>{fmtEur(kontostand * (positionAdvice.riskPct / 100))}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 10, color: C.textDim, fontWeight: 600 }}>Gebunden (offen)</div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: C.orange }}>{fmtEur(gebundenesRisiko)}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 10, color: C.textDim, fontWeight: 600 }}>Verfügbar</div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: C.green }}>{fmtEur(verfuegbaresRisiko)}</div>
                  </div>
                </div>
              </div>
            )}

            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr 1fr", gap: 12 }}>
              <div style={{ padding: "16px 14px", borderRadius: 12, background: `${positionAdvice.color}08`, border: `1px solid ${positionAdvice.color}20`, textAlign: "center" }}>
                <div style={{ fontSize: 11, color: C.textMuted, marginBottom: 4, fontWeight: 600, textTransform: "uppercase" }}>Empf. Stückzahl</div>
                <div style={{ fontSize: 28, fontWeight: 800, color: positionAdvice.color }}>{empfPositionSize}</div>
                <div style={{ fontSize: 11, color: C.textDim }}>von max. {orderGroesse}</div>
              </div>
              <div style={{ padding: "16px 14px", borderRadius: 12, background: `${C.accent}08`, border: `1px solid ${C.accent}20`, textAlign: "center" }}>
                <div style={{ fontSize: 11, color: C.textMuted, marginBottom: 4, fontWeight: 600, textTransform: "uppercase" }}>Kapitaleinsatz</div>
                <div style={{ fontSize: 28, fontWeight: 800, color: C.accentLight }}>{fmtEur(empfEinsatz)}</div>
                <div style={{ fontSize: 11, color: C.textDim }}>{kontostand > 0 ? ((empfEinsatz / kontostand) * 100).toFixed(1) : 0}% vom Depot</div>
              </div>
              <div style={{ padding: "16px 14px", borderRadius: 12, background: `${C.red}08`, border: `1px solid ${C.red}20`, textAlign: "center" }}>
                <div style={{ fontSize: 11, color: C.textMuted, marginBottom: 4, fontWeight: 600, textTransform: "uppercase" }}>Risiko</div>
                <div style={{ fontSize: 28, fontWeight: 800, color: C.red }}>{fmtEur(empfRisiko)}</div>
                <div style={{ fontSize: 11, color: C.textDim }}>{kontostand > 0 ? ((empfRisiko / kontostand) * 100).toFixed(1) : 0}% vom Depot</div>
              </div>
            </div>

            {/* CRV Check */}
            <div style={{ marginTop: 16, padding: "12px 16px", borderRadius: 10, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8, background: crv >= minCrv ? C.greenBg : C.redBg, border: `1px solid ${crv >= minCrv ? C.greenBorder : C.redBorder}` }}>
              <div>
                <span style={{ fontSize: 13, fontWeight: 600, color: crv >= minCrv ? C.green : C.red }}>{crv >= minCrv ? "CRV erfüllt" : "CRV zu niedrig"}</span>
                <span style={{ fontSize: 12, color: C.textDim, marginLeft: 8 }}>Min. {minCrv === Infinity ? "—" : minCrv.toFixed(1) + "x"} empfohlen</span>
              </div>
              <span style={{ fontSize: 20, fontWeight: 800, color: crv >= minCrv ? C.green : C.red }}>{fmt(crv, 1)}x</span>
            </div>
          </GlassCard>

          {/* Setup-Kategorisierung */}
          <GlassCard>
            <div style={{ fontSize: 16, fontWeight: 700, color: C.text, marginBottom: 4 }}>Erkannter Trade-Typ</div>
            <div style={{ fontSize: 13, color: C.textDim, marginBottom: 20 }}>Basierend auf deinen Antworten passt der Trade am besten zu:</div>
            {detectedSetup.map((s, i) => {
              const best = i === 0;
              const Icon = s.icon;
              return (
                <div key={s.name} style={{
                  padding: isMobile ? "12px 14px" : "14px 18px", borderRadius: 12, marginBottom: 10,
                  background: best ? `${s.color}10` : "rgba(10,13,17,0.3)",
                  border: `2px solid ${best ? s.color + "50" : C.border}`,
                  display: "flex", alignItems: "center", gap: isMobile ? 10 : 14, transition: "all 0.3s",
                }}>
                  <div style={{ width: 40, height: 40, borderRadius: 10, background: `${s.color}18`, border: `1px solid ${s.color}30`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    <Icon size={18} color={s.color} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <span style={{ fontSize: 15, fontWeight: 700, color: best ? C.text : C.textMuted }}>{s.name}</span>
                      {best && <Badge color={s.color}>Beste Übereinstimmung</Badge>}
                    </div>
                    {!isMobile && <div style={{ fontSize: 12, color: C.textDim, marginTop: 2 }}>{s.desc}</div>}
                  </div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: best ? s.color : C.textDim, flexShrink: 0 }}>{s.score.toFixed(0)} Pkt.</div>
                </div>
              );
            })}
          </GlassCard>

          {/* Antworten-Übersicht */}
          <GlassCard>
            <div style={{ fontSize: 16, fontWeight: 700, color: C.text, marginBottom: 16 }}>Deine Bewertungen</div>
            {QUESTIONS.filter(q => q.type === "choice").map(q => {
              const aIdx = answers[q.id];
              const opt = aIdx !== undefined ? q.options[aIdx] : null;
              const activeW = q.weights[activeSetupKey] || q.weights.default;
              const achievedScore = opt ? Math.round(opt.score * activeW) : 0;
              const pct = opt ? (opt.score * 100) : 0;
              const barColor = pct >= 70 ? C.green : pct >= 40 ? C.orange : C.red;
              return (
                <div key={q.id} style={{ marginBottom: 14 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
                    <span style={{ fontSize: 12, color: C.textMuted, fontWeight: 500 }}>{q.title}</span>
                    <span style={{ fontSize: 12, fontWeight: 700, color: barColor }}>{achievedScore}/{activeW}</span>
                  </div>
                  <div style={{ height: 6, borderRadius: 3, background: C.border, overflow: "hidden" }}>
                    <div style={{ height: "100%", borderRadius: 3, width: `${pct}%`, background: `linear-gradient(90deg, ${barColor}, ${barColor}AA)`, transition: "width 0.6s" }} />
                  </div>
                  {opt && <div style={{ fontSize: 11, color: C.textDim, marginTop: 3 }}>{opt.label}</div>}
                </div>
              );
            })}
          </GlassCard>

          {/* ── Trade-Übernahme ins Journal ── */}
          {ampel !== "NICHT TRADEN" && inputs.symbol && !tradeAdded && (
            <GlassCard style={{ borderTop: `3px solid ${C.green}` }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}>
                <Plus size={20} color={C.green} />
                <div style={{ fontSize: 16, fontWeight: 700, color: C.text }}>Trade ins Journal übernehmen</div>
              </div>

              {/* Read-only Info */}
              <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "1fr 1fr 1fr 1fr", gap: 8, marginBottom: 20 }}>
                {[
                  { label: "Symbol", value: inputs.symbol.toUpperCase() },
                  { label: "Setup", value: detectedSetup[0]?.name },
                  { label: "Ampel", value: ampel, color: scoreColor },
                  { label: "CRV", value: fmt(crv, 1) + "x" },
                  { label: "Einstieg", value: `${currencySymbol}${fmt(einstieg)}` },
                  { label: "Stop-Loss", value: `${currencySymbol}${fmt(sl)}` },
                  { label: "Ziel", value: `${currencySymbol}${fmt(ziel)}` },
                  { label: "Score", value: `${totalScore}/${maxScore}` },
                ].map((item, i) => (
                  <div key={i} style={{ padding: "8px 12px", borderRadius: 8, background: "rgba(10,13,17,0.4)", border: `1px solid ${C.border}` }}>
                    <div style={{ fontSize: 10, color: C.textDim, textTransform: "uppercase", fontWeight: 600, marginBottom: 2 }}>{item.label}</div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: item.color || C.text }}>{item.value}</div>
                  </div>
                ))}
              </div>

              {/* Editierbare Felder */}
              <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr 1fr", gap: 12 }}>
                <div>
                  <label style={{ display: "block", fontSize: 12, color: C.textMuted, marginBottom: 6, fontWeight: 600 }}>Stückzahl</label>
                  <input type="number" value={addInputs.stueckzahl} onChange={e => setAddInputs(p => ({ ...p, stueckzahl: e.target.value }))}
                    placeholder={String(empfPositionSize)}
                    style={{ width: "100%", padding: "12px 14px", background: "rgba(10,13,17,0.6)", border: `1px solid ${C.accent}40`, borderRadius: 12, color: C.text, fontSize: 15, fontWeight: 500, outline: "none", boxSizing: "border-box" }}
                    onFocus={e => e.target.style.borderColor = C.accent} onBlur={e => e.target.style.borderColor = C.accent + "40"} />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: 12, color: C.textMuted, marginBottom: 6, fontWeight: 600 }}>Tatsächlicher Kaufkurs</label>
                  <div style={{ position: "relative" }}>
                    <input type="number" value={addInputs.kaufkurs} onChange={e => setAddInputs(p => ({ ...p, kaufkurs: e.target.value }))}
                      placeholder={String(einstieg)}
                      style={{ width: "100%", padding: "12px 14px", paddingRight: 30, background: "rgba(10,13,17,0.6)", border: `1px solid ${C.accent}40`, borderRadius: 12, color: C.text, fontSize: 15, fontWeight: 500, outline: "none", boxSizing: "border-box" }}
                      onFocus={e => e.target.style.borderColor = C.accent} onBlur={e => e.target.style.borderColor = C.accent + "40"} />
                    <span style={{ position: "absolute", right: 14, top: "50%", transform: "translateY(-50%)", fontSize: 13, color: C.textDim, fontWeight: 600 }}>{currencySymbol}</span>
                  </div>
                </div>
                <div>
                  <label style={{ display: "block", fontSize: 12, color: C.textMuted, marginBottom: 6, fontWeight: 600 }}>Datum</label>
                  <input type="date" value={addInputs.datum} onChange={e => setAddInputs(p => ({ ...p, datum: e.target.value }))}
                    style={{ width: "100%", padding: "12px 14px", background: "rgba(10,13,17,0.6)", border: `1px solid ${C.accent}40`, borderRadius: 12, color: C.text, fontSize: 15, fontWeight: 500, outline: "none", boxSizing: "border-box", colorScheme: "dark" }}
                    onFocus={e => e.target.style.borderColor = C.accent} onBlur={e => e.target.style.borderColor = C.accent + "40"} />
                </div>
              </div>

              {isNachkauf && (
                <div style={{ marginTop: 16, padding: "10px 14px", borderRadius: 10, background: `${C.yellow}10`, border: `1px solid ${C.yellow}30` }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: C.yellow }}>⚠ Offene Position erkannt — Nachkauf wird zur bestehenden Position hinzugefügt</span>
                </div>
              )}

              <button onClick={handleAddTrade} disabled={(!parseInt(addInputs.stueckzahl) && !empfPositionSize) || !addInputs.datum} style={{
                marginTop: 16, width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "14px 28px", borderRadius: 12,
                background: isNachkauf
                  ? `linear-gradient(135deg, ${C.blue}, ${C.accent})`
                  : `linear-gradient(135deg, ${C.green}, ${C.green}CC)`,
                border: "none", color: "#fff", fontSize: 15, fontWeight: 700,
                cursor: "pointer", transition: "all 0.2s",
                boxShadow: isNachkauf ? `0 4px 20px ${C.blue}40` : `0 4px 20px ${C.green}40`,
              }}>
                <Plus size={18} /> {isNachkauf ? "Nachkauf zur bestehenden Position" : "Trade übernehmen"}
              </button>
            </GlassCard>
          )}

          {/* Erfolgs-Meldung nach Übernahme */}
          {tradeAdded && (
            <GlassCard style={{ background: `linear-gradient(135deg, ${C.green}10, ${C.card})`, border: `2px solid ${C.green}40`, textAlign: "center", padding: "24px" }}>
              <CheckCircle size={40} color={C.green} style={{ marginBottom: 12 }} />
              <div style={{ fontSize: 18, fontWeight: 800, color: C.green, marginBottom: 8 }}>Trade erfolgreich übernommen</div>
              <div style={{ fontSize: 14, color: C.textMuted, marginBottom: 16 }}>
                {inputs.symbol.toUpperCase()} wurde als offener Trade ins Journal eingetragen.
              </div>
              <button onClick={() => onNavigate("trades")} style={{
                display: "inline-flex", alignItems: "center", gap: 8, padding: "10px 24px", borderRadius: 12,
                background: `${C.accent}15`, border: `1px solid ${C.accent}40`, color: C.accentLight,
                fontSize: 14, fontWeight: 600, cursor: "pointer", transition: "all 0.2s",
              }}>
                <BookOpen size={16} /> Zum Trade Log
              </button>
            </GlassCard>
          )}
        </div>
      )}

      {/* ── Navigation Buttons ── */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 24, gap: 12 }}>
        {step > 0 && !showResults ? (
          <button onClick={() => setStep(s => s - 1)} style={{
            display: "flex", alignItems: "center", gap: 6, padding: "12px 20px", borderRadius: 12,
            background: "transparent", border: `1px solid ${C.border}`, color: C.textMuted,
            fontSize: 14, fontWeight: 600, cursor: "pointer", transition: "all 0.2s",
          }}>
            <ChevronLeft size={16} />Zurück
          </button>
        ) : <div />}

        {showResults ? (
          <button onClick={reset} style={{
            display: "flex", alignItems: "center", gap: 8, padding: "12px 28px", borderRadius: 12,
            background: `linear-gradient(135deg, ${C.accent}, ${C.accentLight})`, border: "none",
            color: "#fff", fontSize: 14, fontWeight: 700, cursor: "pointer", transition: "all 0.2s",
            boxShadow: `0 4px 20px ${C.accent}40`,
          }}>
            <RotateCcw size={16} />Neuer Trade Check
          </button>
        ) : (
          <button onClick={() => { if (canProceed) setStep(s => s + 1); }} disabled={!canProceed} style={{
            display: "flex", alignItems: "center", gap: 8, padding: "12px 28px", borderRadius: 12,
            background: canProceed ? `linear-gradient(135deg, ${C.accent}, ${C.accentLight})` : C.border,
            border: "none", color: canProceed ? "#fff" : C.textDim,
            fontSize: 14, fontWeight: 700, cursor: canProceed ? "pointer" : "not-allowed",
            transition: "all 0.2s", boxShadow: canProceed ? `0 4px 20px ${C.accent}40` : "none",
            opacity: canProceed ? 1 : 0.5,
          }}>
            {step === totalSteps - 1 ? "Ergebnis anzeigen" : "Weiter"}
            <ChevronRight size={16} />
          </button>
        )}
      </div>
    </div>
  );
};

// ════════════════════════════════════════════════════════════════
// ─── DASHBOARD ───
// ════════════════════════════════════════════════════════════════
const Dashboard = ({ portfolio }) => {
  const P = portfolio;
  const ww = useWindowWidth();
  const isMobile = ww < 600;
  const isTablet = ww < 900;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : isTablet ? "1fr 1fr" : "repeat(5, 1fr)", gap: 16 }}>
        <StatCard icon={DollarSign} label="Kapital" value={fmtEur(P.kapital)} sub={`Start: ${fmtEur(P.startkapital)}`} color={C.accent} trend={P.roiPct} />
        <StatCard icon={TrendingUp} label="Realisiert" value={fmtEur(P.realisiertGewinn)} sub={P.gesamtGebuehren > 0 ? `Netto (${fmtEur(P.gesamtGebuehren)} Gebühren)` : "Geschlossene P&L"} color={P.realisiertGewinn >= 0 ? C.green : C.red} />
        <StatCard icon={Activity} label="Win-Rate" value={`${P.winRate.toFixed(1)}%`} sub={`${P.tradesGesamt} Trades`} color={C.blue} />
        <StatCard icon={Target} label="Profit-Faktor" value={fmt(P.profitFaktor, 1)} sub={`Ø ${fmt(P.avgR, 2)}R`} color={C.yellow} />
        <StatCard icon={Shield} label="Offenes Risiko" value={fmtEur(P.offenRisiko)} sub={`${P.kapital > 0 ? ((P.offenRisiko / P.kapital) * 100).toFixed(1) : "0.0"}% vom Depot`} color={C.red} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "2fr 1fr", gap: 20 }}>
        <GlassCard>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: C.text }}>Equity Curve</div>
            <Badge color={P.roiPct >= 0 ? C.green : C.red}>{P.roiPct >= 0 ? "+" : ""}{P.roiPct.toFixed(1)}%</Badge>
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={P.equityPoints}>
              <defs><linearGradient id="eqGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={C.accent} stopOpacity={0.3} /><stop offset="100%" stopColor={C.accent} stopOpacity={0} /></linearGradient></defs>
              <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
              <XAxis dataKey="tag" stroke={C.textDim} fontSize={11} tickLine={false} />
              <YAxis stroke={C.textDim} fontSize={11} tickLine={false} tickFormatter={v => `${(v/1000).toFixed(1)}k`} domain={["dataMin - 500", "dataMax + 500"]} />
              <Tooltip content={<CustomTooltip />} />
              <Area type="monotone" dataKey="wert" stroke={C.accent} strokeWidth={2.5} fill="url(#eqGrad)" name="Kapital" dot={{ r: 3, fill: C.accent }} />
            </AreaChart>
          </ResponsiveContainer>
        </GlassCard>
        <GlassCard>
          <div style={{ fontSize: 15, fontWeight: 700, color: C.text, marginBottom: 16 }}>Setup-Qualität</div>
          <div style={{ display: "flex", justifyContent: "center" }}>
            <PieChart width={200} height={200}>
              <Pie data={[
                { name: "GRÜN", value: P.setupQuality.gruen },
                { name: "ORANGE", value: P.setupQuality.orange },
                { name: "ROT", value: P.setupQuality.rot },
                { name: "NICHT TRADEN", value: P.setupQuality.nichtTraden },
              ]} cx={100} cy={100} innerRadius={60} outerRadius={85} paddingAngle={4} dataKey="value" strokeWidth={0}>
                <Cell fill={C.green} /><Cell fill={C.orange} /><Cell fill={C.red} /><Cell fill={C.noTrade} />
              </Pie>
            </PieChart>
          </div>
          <div style={{ display: "flex", justifyContent: "center", gap: 12, marginTop: 8, flexWrap: "wrap" }}>
            {[
              { l: "Grün", v: P.setupQuality.gruen, c: C.green },
              { l: "Orange", v: P.setupQuality.orange, c: C.orange },
              { l: "Rot", v: P.setupQuality.rot, c: C.red },
              { l: "Nicht traden", v: P.setupQuality.nichtTraden, c: C.noTrade },
            ].map((s, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <div style={{ width: 8, height: 8, borderRadius: 4, background: s.c }} />
                <span style={{ fontSize: 11, color: C.textMuted }}>{s.l} {s.v.toFixed(0)}%</span>
              </div>
            ))}
          </div>
          <div style={{ textAlign: "center", marginTop: 14, padding: "8px 12px", borderRadius: 8, background: `${C.accent}08`, border: `1px solid ${C.accent}20` }}>
            <span style={{ fontSize: 11, color: C.textMuted }}>Ø Score: </span>
            <span style={{ fontSize: 14, fontWeight: 700, color: C.accentLight }}>{P.setupQuality.avgScore.toFixed(1)}</span>
          </div>
        </GlassCard>
      </div>
      <GlassCard>
        <div style={{ fontSize: 15, fontWeight: 700, color: C.text, marginBottom: 20 }}>Monatliche Performance 2026</div>
        <ResponsiveContainer width="100%" height={180}>
          <BarChart data={P.monthlyPerf} barGap={8}>
            <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
            <XAxis dataKey="monat" stroke={C.textDim} fontSize={12} tickLine={false} />
            <YAxis stroke={C.textDim} fontSize={11} tickLine={false} tickFormatter={v => `${v}R`} />
            <Tooltip content={<CustomTooltip />} />
            <Bar dataKey="ergebnisR" name="Ergebnis (R)" radius={[6, 6, 0, 0]} maxBarSize={50}>
              {P.monthlyPerf.map((e, i) => <Cell key={i} fill={e.ergebnisR >= 0 ? C.green : C.red} fillOpacity={0.85} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </GlassCard>
    </div>
  );
};

// ════════════════════════════════════════════════════════════════
// ─── TRADE LOG ───
// ════════════════════════════════════════════════════════════════
const TradeLog = ({ tradeList, onUpdateTrade }) => {
  const [filter, setFilter] = useState("Alle");
  const [expandedId, setExpandedId] = useState(null);
  const [txModal, setTxModal] = useState(null); // { tradeId, type: "sell"|"buy" }
  const [txInputs, setTxInputs] = useState({ stueckzahl: "", kurs: "", datum: new Date().toISOString().split("T")[0] });
  const ww = useWindowWidth();
  const isMobile = ww < 600;

  const enriched = useMemo(() => tradeList.map(t => {
    const props = tradeComputedProps(t);
    const fx = t.waehrung === "USD" && t.wechselkurs ? t.wechselkurs : 1;
    const pnlBrutto = props.pnlRaw * fx;
    const pnl = pnlBrutto - props.totalGebuehren;
    const riskPS = Math.abs(props.avgKaufkurs - t.stopLoss);
    const rValue = riskPS > 0 && props.totalSold > 0 ? (props.avgVerkaufskurs - props.avgKaufkurs) / riskPS : 0;
    return { ...t, ...props, pnl, pnlBrutto, rValue, fx };
  }), [tradeList]);

  const filtered = filter === "Alle" ? enriched
    : filter === "Offen" ? enriched.filter(t => t.remaining > 0)
    : enriched.filter(t => t.ampel === filter);

  const handleTxSubmit = () => {
    if (!txModal) return;
    const stueck = parseInt(txInputs.stueckzahl);
    const kurs = parseFloat(txInputs.kurs);
    if (!stueck || stueck <= 0 || !kurs || kurs <= 0) return;
    const trade = tradeList.find(t => t.id === txModal.tradeId);
    if (!trade) return;
    if (txModal.type === "sell") {
      const props = tradeComputedProps(trade);
      if (stueck > props.remaining) return;
    }
    onUpdateTrade(txModal.tradeId, (t) => ({
      ...t,
      transactions: [...(t.transactions || []), { type: txModal.type, datum: txInputs.datum, stueck, kurs }],
    }));
    setTxModal(null);
    setTxInputs({ stueckzahl: "", kurs: "", datum: new Date().toISOString().split("T")[0] });
  };

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 20, flexWrap: "wrap" }}>
        {["Alle", "Offen", "GRÜN", "ORANGE", "ROT", "NICHT TRADEN"].map(f => (
          <button key={f} onClick={() => setFilter(f)} style={{
            padding: "7px 16px", borderRadius: 8, border: `1px solid ${filter === f ? C.accent : C.border}`,
            background: filter === f ? `${C.accent}15` : "transparent",
            color: f === "GRÜN" ? C.green : f === "ORANGE" ? C.orange : f === "ROT" ? C.red : f === "NICHT TRADEN" ? C.noTrade : filter === f ? C.accentLight : C.textMuted,
            fontSize: 12, fontWeight: 600, cursor: "pointer", transition: "all 0.2s",
          }}>{f === "Alle" ? `Alle (${tradeList.length})` : f}</button>
        ))}
      </div>

      {/* Teilverkauf/Nachkauf Modal */}
      {txModal && (
        <GlassCard style={{ marginBottom: 20, border: `2px solid ${txModal.type === "sell" ? C.red : C.green}40` }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: C.text, marginBottom: 12 }}>
            {txModal.type === "sell" ? "Teilverkauf" : "Nachkauf"} — {tradeList.find(t => t.id === txModal.tradeId)?.symbol}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr 1fr", gap: 12 }}>
            <div>
              <label style={{ display: "block", fontSize: 12, color: C.textMuted, marginBottom: 6, fontWeight: 600 }}>Stückzahl</label>
              <input type="number" value={txInputs.stueckzahl} onChange={e => setTxInputs(p => ({ ...p, stueckzahl: e.target.value }))}
                placeholder={txModal.type === "sell" ? String(tradeComputedProps(tradeList.find(t => t.id === txModal.tradeId) || {}).remaining || "") : ""}
                style={{ width: "100%", padding: "10px 12px", background: "rgba(10,13,17,0.6)", border: `1px solid ${C.border}`, borderRadius: 10, color: C.text, fontSize: 14, fontWeight: 500, outline: "none", boxSizing: "border-box" }} />
            </div>
            <div>
              <label style={{ display: "block", fontSize: 12, color: C.textMuted, marginBottom: 6, fontWeight: 600 }}>Kurs</label>
              <input type="number" value={txInputs.kurs} onChange={e => setTxInputs(p => ({ ...p, kurs: e.target.value }))}
                style={{ width: "100%", padding: "10px 12px", background: "rgba(10,13,17,0.6)", border: `1px solid ${C.border}`, borderRadius: 10, color: C.text, fontSize: 14, fontWeight: 500, outline: "none", boxSizing: "border-box" }} />
            </div>
            <div>
              <label style={{ display: "block", fontSize: 12, color: C.textMuted, marginBottom: 6, fontWeight: 600 }}>Datum</label>
              <input type="date" value={txInputs.datum} onChange={e => setTxInputs(p => ({ ...p, datum: e.target.value }))}
                style={{ width: "100%", padding: "10px 12px", background: "rgba(10,13,17,0.6)", border: `1px solid ${C.border}`, borderRadius: 10, color: C.text, fontSize: 14, fontWeight: 500, outline: "none", boxSizing: "border-box", colorScheme: "dark" }} />
            </div>
          </div>
          <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
            <button onClick={handleTxSubmit} style={{ flex: 1, padding: "10px 20px", borderRadius: 10, border: "none", background: txModal.type === "sell" ? C.red : C.green, color: "#fff", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>
              {txModal.type === "sell" ? "Teilverkauf buchen" : "Nachkauf buchen"}
            </button>
            <button onClick={() => setTxModal(null)} style={{ padding: "10px 20px", borderRadius: 10, border: `1px solid ${C.border}`, background: "transparent", color: C.textMuted, fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
              Abbrechen
            </button>
          </div>
        </GlassCard>
      )}

      <GlassCard style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, minWidth: isMobile ? 750 : "auto" }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                {["", "Datum", "Symbol", "Setup", "Ø Kauf", "Stop", "Ziel", "Ø Verk.", "Pos.", "Ergebnis", "R", "Score", "Aktion"].map(h => (
                  <th key={h} style={{ padding: "14px 12px", textAlign: "left", fontSize: 11, fontWeight: 600, color: C.textDim, textTransform: "uppercase", letterSpacing: "0.05em", background: "rgba(10,13,17,0.5)", whiteSpace: "nowrap" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((t, i) => {
                const cur = t.waehrung === "USD" ? "$" : "€";
                const isWin = t.pnl > 0;
                const hasTxs = (t.transactions || []).length > 1;
                const isExpanded = expandedId === t.id;
                return (
                  <React.Fragment key={t.id}>
                    <tr onClick={() => hasTxs && setExpandedId(isExpanded ? null : t.id)} style={{
                      borderBottom: `1px solid ${C.border}`, background: i % 2 === 0 ? "transparent" : "rgba(10,13,17,0.2)",
                      cursor: hasTxs ? "pointer" : "default",
                    }}>
                      <td style={{ padding: "10px 8px", width: 28, textAlign: "center" }}>
                        {hasTxs && <ChevronDown size={14} color={C.textDim} style={{ transform: isExpanded ? "rotate(180deg)" : "rotate(0)", transition: "transform 0.2s" }} />}
                      </td>
                      <td style={{ padding: "10px 12px", color: C.textMuted, fontSize: 12, whiteSpace: "nowrap" }}>{t.datum}</td>
                      <td style={{ padding: "10px 12px" }}>
                        <span style={{ fontWeight: 700, color: C.text, fontSize: 14 }}>{t.symbol}</span>
                        <span style={{ fontSize: 10, color: C.textDim, marginLeft: 6, fontWeight: 600 }}>{t.waehrung || "EUR"}</span>
                      </td>
                      <td style={{ padding: "10px 12px" }}><Badge color={C.blue}>{t.setup}</Badge></td>
                      <td style={{ padding: "10px 12px", color: C.text, fontWeight: 500 }}>{cur}{fmt(t.avgKaufkurs)}</td>
                      <td style={{ padding: "10px 12px", color: C.red, fontWeight: 500 }}>{cur}{fmt(t.stopLoss)}</td>
                      <td style={{ padding: "10px 12px", color: C.green, fontWeight: 500 }}>{cur}{fmt(t.ziel)}</td>
                      <td style={{ padding: "10px 12px", color: t.totalSold > 0 ? C.text : C.textDim, fontWeight: 500 }}>{t.totalSold > 0 ? `${cur}${fmt(t.avgVerkaufskurs)}` : "–"}</td>
                      <td style={{ padding: "10px 12px", fontWeight: 600, color: C.textMuted, fontSize: 12 }}>{t.remaining}/{t.totalBought}</td>
                      <td style={{ padding: "10px 12px" }}>
                        <div style={{ fontWeight: 700, color: t.totalSold === 0 ? C.textDim : isWin ? C.green : C.red }}>{t.totalSold > 0 ? `${t.pnl >= 0 ? "+" : ""}${t.pnl.toFixed(0)}€` : "–"}</div>
                        {t.totalGebuehren > 0 && t.totalSold > 0 && <div style={{ fontSize: 10, color: C.textDim, fontWeight: 500 }}>({t.totalGebuehren.toFixed(2)}€ Geb.)</div>}
                      </td>
                      <td style={{ padding: "10px 12px", fontWeight: 700, color: t.totalSold === 0 ? C.textDim : t.rValue >= 0 ? C.green : C.red }}>{t.totalSold > 0 ? `${t.rValue >= 0 ? "+" : ""}${t.rValue.toFixed(1)}R` : "–"}</td>
                      <td style={{ padding: "10px 12px" }}>
                        <div style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 36, height: 24, borderRadius: 6, fontSize: 12, fontWeight: 700, color: ampelColor(t.ampel), background: ampelBg(t.ampel), border: `1px solid ${ampelBorder(t.ampel)}` }}>{t.score}</div>
                      </td>
                      <td style={{ padding: "10px 12px" }} onClick={e => e.stopPropagation()}>
                        {t.remaining > 0 && (
                          <div style={{ display: "flex", gap: 4 }}>
                            <button onClick={() => { setTxModal({ tradeId: t.id, type: "sell" }); setTxInputs({ stueckzahl: "", kurs: "", datum: new Date().toISOString().split("T")[0] }); }} style={{ padding: "4px 8px", borderRadius: 6, border: "none", background: `${C.red}20`, color: C.red, fontSize: 11, fontWeight: 600, cursor: "pointer" }}>Teilverkauf</button>
                            <button onClick={() => { setTxModal({ tradeId: t.id, type: "buy" }); setTxInputs({ stueckzahl: "", kurs: "", datum: new Date().toISOString().split("T")[0] }); }} style={{ padding: "4px 8px", borderRadius: 6, border: "none", background: `${C.green}20`, color: C.green, fontSize: 11, fontWeight: 600, cursor: "pointer" }}>Nachkauf</button>
                          </div>
                        )}
                        {t.remaining === 0 && (
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "4px 8px", borderRadius: 6, fontSize: 11, fontWeight: 600, color: C.textDim, background: "rgba(10,13,17,0.4)" }}>Geschlossen</span>
                        )}
                      </td>
                    </tr>
                    {/* Expanded Transaction Sub-Rows */}
                    {isExpanded && (t.transactions || []).map((tx, j) => (
                      <tr key={`${t.id}-tx-${j}`} style={{ background: "rgba(108,92,231,0.04)", borderBottom: `1px solid ${C.border}40` }}>
                        <td style={{ padding: "6px 8px" }} />
                        <td style={{ padding: "6px 12px", fontSize: 12, color: C.textDim }}>{tx.datum}</td>
                        <td colSpan={2} style={{ padding: "6px 12px" }}>
                          <Badge color={tx.type === "buy" ? C.green : C.red}>{tx.type === "buy" ? "Kauf" : "Verkauf"}</Badge>
                        </td>
                        <td colSpan={4} style={{ padding: "6px 12px", fontSize: 13, color: C.text, fontWeight: 500 }}>
                          {tx.stueck} Stk. × {cur}{tx.kurs.toFixed(2)} = {cur}{(tx.stueck * tx.kurs).toFixed(2)}
                        </td>
                        <td colSpan={5} />
                      </tr>
                    ))}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </GlassCard>
    </div>
  );
};

// ════════════════════════════════════════════════════════════════

// ════════════════════════════════════════════════════════════════
// ─── MAIN APP ───
// ════════════════════════════════════════════════════════════════
export default function TradingJournal() {
  const [page, setPage] = useState("check");
  const [tradeList, setTradeList] = useState(loadTrades);
  const [menuOpen, setMenuOpen] = useState(false);
  const [isOffline, setIsOffline] = useState(typeof navigator !== "undefined" && !navigator.onLine);
  const ww = useWindowWidth();
  const isMobile = ww < 768;

  // Offline-Detection
  useEffect(() => {
    const goOnline = () => setIsOffline(false);
    const goOffline = () => setIsOffline(true);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => { window.removeEventListener("online", goOnline); window.removeEventListener("offline", goOffline); };
  }, []);

  // localStorage Persistenz
  useEffect(() => { saveTrades(tradeList); }, [tradeList]);

  const portfolio = useMemo(() => computePortfolio(tradeList, STARTKAPITAL), [tradeList]);

  const addTrade = useCallback((trade) => {
    setTradeList(prev => [...prev, trade]);
  }, []);

  const updateTrade = useCallback((id, updaterFn) => {
    setTradeList(prev => prev.map(t => t.id === id ? updaterFn(t) : t));
  }, []);

  const navigate = useCallback((p) => {
    setPage(p);
    setMenuOpen(false);
  }, []);

  const pages = {
    check: { label: "Trade Check", icon: Calculator, sub: "Bewerte neue Trade-Setups" },
    trades: { label: "Trade Log", icon: BookOpen, sub: "Alle Trades im Detail" },
    dashboard: { label: "Dashboard", icon: LayoutDashboard, sub: "Übersicht deiner Performance" },
    watchlist: { label: "Watchlist", icon: Eye, sub: "Scanner fuer Swing- & Intraday-Setups" },
  };

  const renderPage = () => {
    switch (page) {
      case "check": return <TradeCheck portfolio={portfolio} tradeList={tradeList} onAddTrade={addTrade} onUpdateTrade={updateTrade} onNavigate={navigate} />;
      case "trades": return <TradeLog tradeList={tradeList} onUpdateTrade={updateTrade} />;
      case "dashboard": return <Dashboard portfolio={portfolio} />;
      case "watchlist": return <Watchlist onNavigate={navigate} />;
      default: return null;
    }
  };

  return (
    <div style={{ display: "flex", minHeight: "100vh", background: C.bg, fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif", color: C.text }}>
      <style>{`
        * { box-sizing: border-box; margin: 0; padding: 0; }
        ::-webkit-scrollbar { width: 6px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: ${C.border}; border-radius: 3px; }
        input::placeholder { color: ${C.textDim}; }
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>

      {/* Offline-Banner */}
      {isOffline && (
        <div style={{
          position: "fixed", top: 0, left: 0, right: 0, zIndex: 9999,
          padding: "6px 16px", textAlign: "center",
          background: `linear-gradient(135deg, ${C.orange}20, ${C.yellow}15)`,
          borderBottom: `1px solid ${C.orange}40`,
          fontSize: 12, fontWeight: 600, color: C.orange,
          display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
        }}>
          <Zap size={13} /> Offline — Daten werden lokal gespeichert
        </div>
      )}

      {/* Sidebar — Desktop */}
      {!isMobile && (
        <div style={{ width: 240, padding: "24px 16px", borderRight: `1px solid ${C.border}`, background: "linear-gradient(180deg, rgba(20,24,32,0.98), rgba(11,14,17,0.98))", display: "flex", flexDirection: "column", position: "sticky", top: 0, height: "100vh" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "4px 8px", marginBottom: 32 }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: `linear-gradient(135deg, ${C.accent}, ${C.accentLight})`, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: `0 4px 16px ${C.accent}40` }}>
              <BarChart3 size={18} color="#fff" />
            </div>
            <div>
              <div style={{ fontSize: 15, fontWeight: 800, color: C.text, letterSpacing: "-0.02em" }}>N-Capital</div>
              <div style={{ fontSize: 10, color: C.textDim, fontWeight: 500 }}>Trading Journal</div>
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <div style={{ fontSize: 10, color: C.textDim, padding: "0 14px", marginBottom: 6, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em" }}>Navigation</div>
            {Object.entries(pages).map(([k, v]) => (
              <NavItem key={k} icon={v.icon} label={v.label} active={page === k} onClick={() => setPage(k)}
                num={k === "trades" ? tradeList.filter(t => { const p = tradeComputedProps(t); return p.remaining > 0; }).length || undefined : undefined} />
            ))}
          </div>
          <div style={{ marginTop: "auto", padding: "16px 12px", borderRadius: 12, background: `${C.accent}08`, border: `1px solid ${C.accent}15` }}>
            <div style={{ fontSize: 11, color: C.textDim, marginBottom: 4 }}>Aktuelles Kapital</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: C.accentLight }}>{fmtEur(portfolio.kapital)}</div>
            <div style={{ fontSize: 11, color: portfolio.roiPct >= 0 ? C.green : C.red, fontWeight: 600, marginTop: 2 }}>{portfolio.roiPct >= 0 ? "+" : ""}{portfolio.roiPct.toFixed(1)}% ROI</div>
          </div>
        </div>
      )}

      {/* Mobile Menu Overlay */}
      {isMobile && menuOpen && (
        <div style={{ position: "fixed", inset: 0, zIndex: 100, background: "rgba(0,0,0,0.6)", backdropFilter: "blur(8px)" }} onClick={() => setMenuOpen(false)}>
          <div onClick={e => e.stopPropagation()} style={{ width: 260, height: "100%", background: "linear-gradient(180deg, rgba(20,24,32,0.99), rgba(11,14,17,0.99))", padding: "24px 16px", display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 32 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ width: 36, height: 36, borderRadius: 10, background: `linear-gradient(135deg, ${C.accent}, ${C.accentLight})`, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <BarChart3 size={18} color="#fff" />
                </div>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 800, color: C.text }}>N-Capital</div>
                  <div style={{ fontSize: 10, color: C.textDim }}>Trading Journal</div>
                </div>
              </div>
              <button onClick={() => setMenuOpen(false)} style={{ background: "none", border: "none", color: C.textMuted, cursor: "pointer", padding: 8 }}>
                <X size={20} />
              </button>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {Object.entries(pages).map(([k, v]) => (
                <NavItem key={k} icon={v.icon} label={v.label} active={page === k} onClick={() => navigate(k)}
                  num={k === "trades" ? tradeList.filter(t => { const p = tradeComputedProps(t); return p.remaining > 0; }).length || undefined : undefined} />
              ))}
            </div>
            <div style={{ marginTop: "auto", padding: "16px 12px", borderRadius: 12, background: `${C.accent}08`, border: `1px solid ${C.accent}15` }}>
              <div style={{ fontSize: 11, color: C.textDim, marginBottom: 4 }}>Aktuelles Kapital</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: C.accentLight }}>{fmtEur(portfolio.kapital)}</div>
            </div>
          </div>
        </div>
      )}

      {/* Main */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        <div style={{ padding: isMobile ? "14px 16px" : "18px 32px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", justifyContent: "space-between", background: "rgba(20,24,32,0.6)", backdropFilter: "blur(20px)", position: "sticky", top: 0, zIndex: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            {isMobile && (
              <button onClick={() => setMenuOpen(true)} style={{ background: "none", border: "none", color: C.textMuted, cursor: "pointer", padding: 4 }}>
                <Menu size={22} />
              </button>
            )}
            <div>
              <div style={{ fontSize: isMobile ? 18 : 20, fontWeight: 800, color: C.text, letterSpacing: "-0.02em" }}>{pages[page].label}</div>
              {!isMobile && <div style={{ fontSize: 12, color: C.textDim, marginTop: 2 }}>{pages[page].sub}</div>}
            </div>
          </div>
        </div>
        <div style={{ padding: isMobile ? 16 : 32, flex: 1, animation: "fadeIn 0.3s ease-out" }}>
          {renderPage()}
        </div>
      </div>
    </div>
  );
}
