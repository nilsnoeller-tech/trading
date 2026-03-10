import React, { useState, useMemo, useEffect, useCallback, useRef } from "react";
import ReactDOM from "react-dom";
import { LineChart, Line, AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { TrendingUp, TrendingDown, DollarSign, Activity, Target, Shield, BarChart3, ArrowUpRight, ArrowDownRight, AlertTriangle, CheckCircle, XCircle, Zap, Bell, LayoutDashboard, BookOpen, Calculator, ChevronRight, ChevronLeft, ChevronDown, RotateCcw, ArrowRight, Hash, Crosshair, Menu, X, Plus, Info, Wifi, WifiOff, BarChart2, Eye, EyeOff, Layers, Newspaper, LogOut, Settings as SettingsIcon, User, Edit3, Trash2, Save, Camera, Image as ImageIcon, Calendar, Clock } from "lucide-react";
import Watchlist from "./components/Watchlist";
import Briefing from "./components/Briefing";
import LoginPage from "./components/LoginPage";
import { useAutoScore } from "./hooks/useAutoScore";
import { getFinvizChartUrl, isFinvizAvailable } from "./services/marketData";
import { isAuthenticated, getUser, logout as authLogout, verifyMagicToken, authFetch } from "./services/auth";
import { saveScreenshot, getScreenshotUrl, deleteScreenshot } from "./services/screenshotStore";

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
const DEFAULT_STARTKAPITAL = 45691.59;
const GEBUEHR_PRO_ORDER = 7.90; // flatex: 5,90€ Provision + 2,00€ Regulierung

// Per-User Startkapital aus localStorage laden
function getStartkapital() {
  const user = getUser();
  if (!user) return DEFAULT_STARTKAPITAL;
  const key = `ncapital-startkapital-${user.username.toLowerCase()}`;
  const saved = localStorage.getItem(key);
  return saved ? parseFloat(saved) : DEFAULT_STARTKAPITAL;
}
function hasExplicitStartkapital() {
  const user = getUser();
  if (!user) return false;
  const key = `ncapital-startkapital-${user.username.toLowerCase()}`;
  return localStorage.getItem(key) !== null;
}
function setStartkapital(value) {
  const user = getUser();
  if (!user) return;
  const key = `ncapital-startkapital-${user.username.toLowerCase()}`;
  localStorage.setItem(key, String(value));
}

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

// ─── localStorage Persistenz (per-User) ───
const CURRENT_VERSION = 3;
function getUserStorageKey() {
  const user = getUser();
  const suffix = user ? `-${user.username.toLowerCase()}` : "";
  return `ncapital-trades${suffix}`;
}
function getUserVersionKey() {
  const user = getUser();
  const suffix = user ? `-${user.username.toLowerCase()}` : "";
  return `ncapital-trades-version${suffix}`;
}

// Migration v3: USD-Trades → EUR umrechnen (alle Preise in EUR, einheitliches Log)
function migrateUsdToEur(trade) {
  if (trade.waehrung !== "USD" || !trade.wechselkurs) return trade;
  const fx = trade.wechselkurs;
  return {
    ...trade,
    stopLoss: Math.round(trade.stopLoss * fx * 100) / 100,
    ziel: Math.round(trade.ziel * fx * 100) / 100,
    waehrung: "EUR",
    originalWaehrung: "USD",
    usdWechselkurs: fx,
    transactions: (trade.transactions || []).map(tx => ({
      ...tx,
      kurs: Math.round(tx.kurs * fx * 100) / 100,
    })),
  };
}

function loadTrades() {
  try {
    const storageKey = getUserStorageKey();
    const versionKey = getUserVersionKey();
    const saved = localStorage.getItem(storageKey);
    const version = parseInt(localStorage.getItem(versionKey)) || 1;
    if (saved) {
      let parsed = JSON.parse(saved);
      if (version < 2) parsed = parsed.map(migrateTrade);
      if (version < 3) parsed = parsed.map(migrateUsdToEur);
      localStorage.setItem(versionKey, String(CURRENT_VERSION));
      const savedIds = new Set(INITIAL_TRADES.map(t => t.id));
      const newTrades = parsed.filter(t => !savedIds.has(t.id));
      return [...INITIAL_TRADES, ...newTrades];
    }
    // Fallback: alte globale Daten migrieren (einmaliger Uebergang)
    const legacySaved = localStorage.getItem("ncapital-trades");
    if (legacySaved) {
      let parsed = JSON.parse(legacySaved);
      const legacyVersion = parseInt(localStorage.getItem("ncapital-trades-version")) || 1;
      if (legacyVersion < 2) parsed = parsed.map(migrateTrade);
      if (legacyVersion < 3) parsed = parsed.map(migrateUsdToEur);
      // Zu per-User Key speichern
      localStorage.setItem(storageKey, JSON.stringify(parsed));
      localStorage.setItem(versionKey, String(CURRENT_VERSION));
      const savedIds = new Set(INITIAL_TRADES.map(t => t.id));
      const newTrades = parsed.filter(t => !savedIds.has(t.id));
      return [...INITIAL_TRADES, ...newTrades];
    }
  } catch (e) { /* fallback */ }
  return [...INITIAL_TRADES];
}
function saveTrades(tradeList) {
  try {
    const storageKey = getUserStorageKey();
    const versionKey = getUserVersionKey();
    localStorage.setItem(storageKey, JSON.stringify(tradeList));
    localStorage.setItem(versionKey, String(CURRENT_VERSION));
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
  const grossProfit = wins.reduce((s, t) => s + t.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
  const profitFaktor = losses.length === 0 ? (wins.length > 0 ? Infinity : 0) : (grossLoss > 0 ? grossProfit / grossLoss : 0);
  const avgR = closedTrades.length > 0 ? closedTrades.reduce((s, t) => s + t.rValue, 0) / closedTrades.length : 0;
  const offenRisiko = openTrades.reduce((s, t) => {
    const remaining = t.remaining ?? t.totalBought ?? 0;
    const avgK = t.avgKaufkurs ?? 0;
    const risk = Math.abs(avgK - t.stopLoss) * remaining;
    const fx2 = t.waehrung === "USD" && t.wechselkurs ? t.wechselkurs : 1;
    return s + risk * fx2;
  }, 0);
  // ROI: Durchschnittliche Rendite aller abgeschlossenen Trades (gewichtet nach Volumen)
  const totalVolume = closedTrades.reduce((s, t) => s + (t.avgKaufkurs * t.totalSold * (t.fx || 1)), 0);
  const roiPct = totalVolume > 0
    ? (closedTrades.reduce((s, t) => s + t.pnl, 0) / totalVolume) * 100
    : 0;

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
  const total = allForStats.length || 1;
  const gesamtGebuehren = closedTrades.reduce((s, t) => s + (t.totalGebuehren || 0), 0);

  // Tier-basierte Performance (TA Score Modell)
  // Score 0-100 normalisiert aus Composite -11 bis +11: tier = ((composite + 11) / 22) * 100
  // HIGH_CONVICTION: composite >= 7.5 → normalized >= 84
  // STANDARD: composite >= 6.5 → normalized >= 80
  // MANUELL: score === 0 (kein Bot-Score)
  const tierStats = {};
  for (const [tier, filterFn] of [
    ["HIGH_CONVICTION", t => t.score >= 84],
    ["STANDARD", t => t.score >= 75 && t.score < 84],
    ["LOW", t => t.score > 0 && t.score < 75],
    ["MANUELL", t => !t.score || t.score === 0],
  ]) {
    const trades = allForStats.filter(filterFn);
    const catWins = trades.filter(t => t.pnl > 0).length;
    const catAvgR = trades.length > 0 ? trades.reduce((s, t) => s + t.rValue, 0) / trades.length : 0;
    const catPnl = trades.reduce((s, t) => s + t.pnl, 0);
    tierStats[tier] = { count: trades.length, wins: catWins, winRate: trades.length > 0 ? (catWins / trades.length) * 100 : 0, avgR: catAvgR, totalPnl: catPnl };
  }

  return {
    startkapital, kapital, realisiertGewinn, gesamtGebuehren, offenRisiko, roiPct,
    winRate, profitFaktor, avgR, tradesGesamt: closedTrades.length,
    equityPoints, monthlyPerf,
    tierStats,
    closedTrades, openTrades,
  };
}

// ─── Helpers ───
const fmt = (v, d = 2) => typeof v === "number" ? (isFinite(v) ? v.toFixed(d) : "∞") : "–";
const fmtEur = (v) => typeof v === "number" ? new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(v) : "–";
const ampelColor = (a) => a === "GRÜN" ? C.green : a === "ORANGE" ? C.orange : a === "ROT" ? C.red : a === "NICHT TRADEN" ? C.noTrade : a === "MANUELL" ? C.blue : C.textMuted;
const ampelBg = (a) => a === "GRÜN" ? C.greenBg : a === "ORANGE" ? C.orangeBg : a === "ROT" ? C.redBg : a === "NICHT TRADEN" ? C.noTradeBg : a === "MANUELL" ? C.blueBg : "transparent";
const ampelBorder = (a) => a === "GRÜN" ? C.greenBorder : a === "ORANGE" ? C.orangeBorder : a === "ROT" ? C.redBorder : a === "NICHT TRADEN" ? C.noTradeBorder : a === "MANUELL" ? `${C.blue}33` : C.border;

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
const GlassCard = ({ children, style, onClick, onMouseEnter, onMouseLeave }) => (
  <div onClick={onClick} onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave} style={{
    background: "linear-gradient(135deg, rgba(20,24,32,0.95), rgba(26,31,43,0.9))",
    border: `1px solid ${C.border}`, borderRadius: 16, padding: 24,
    backdropFilter: "blur(20px)", transition: "all 0.3s cubic-bezier(0.4,0,0.2,1)",
    cursor: onClick ? "pointer" : "default", ...style,
  }}>{children}</div>
);

const StatCard = ({ icon: Icon, label, value, sub, color = C.accent, trend, tooltip }) => {
  const [showTip, setShowTip] = useState(false);
  const cardRef = useRef(null);
  const [tipPos, setTipPos] = useState({ top: 0, left: 0 });
  const handleEnter = () => {
    if (!tooltip || !cardRef.current) return;
    const r = cardRef.current.getBoundingClientRect();
    setTipPos({ top: r.bottom + 8, left: r.left + r.width / 2 });
    setShowTip(true);
  };
  return (
    <div ref={cardRef}>
      <GlassCard style={{ padding: 20, minWidth: 0 }}
        onMouseEnter={handleEnter} onMouseLeave={() => setShowTip(false)}>
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
      {showTip && tooltip && ReactDOM.createPortal(
        <div style={{ position: "fixed", top: tipPos.top, left: tipPos.left, transform: "translateX(-50%)", padding: "10px 14px", borderRadius: 10, background: "rgba(15,18,25,0.97)", border: `1px solid ${C.border}`, backdropFilter: "blur(12px)", fontSize: 12, color: C.textMuted, whiteSpace: "pre-line", lineHeight: 1.6, zIndex: 9999, minWidth: 220, maxWidth: 300, boxShadow: "0 8px 32px rgba(0,0,0,0.5)", pointerEvents: "none" }}>
          {tooltip}
        </div>,
        document.body
      )}
    </div>
  );
};

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

// ─── Merkmalliste v2: 4 Setup-Typen mit gewichteten Kriterien ───
const MERKMALLISTE = {
  "trend_pullback": {
    key: "trend_pullback", label: "Trend-Pullback", emoji: "🎯", color: C.green,
    desc: "Ruecksetzer im Aufwaertstrend",
    criteria: [
      { autoKey: "aboveSMA50", label: "Kurs > SMA50", weight: 15 },
      { autoKey: "aboveSMA200", label: "Kurs > SMA200", weight: 10 },
      { autoKey: "pullbackRange", label: "Pullback 0.5–1.5 ATR", weight: 20 },
      { autoKey: "nearEMA20", label: "Nahe EMA20", weight: 15 },
      { autoKey: "insideBar", label: "Inside Bar", weight: 10 },
      { autoKey: "higherLow", label: "Higher Low", weight: 15 },
      { autoKey: "ema20Reclaim", label: "EMA20 Reclaim", weight: 10 },
      { autoKey: "breakPullbackHigh", label: "Bruch Pullback-Hoch", weight: 5 },
    ],
    invalidators: [
      { autoKey: "aboveSMA50", label: "Kurs < SMA50", inverted: true },
    ],
  },
  "breakout": {
    key: "breakout", label: "Breakout", emoji: "⚡", color: C.accent,
    desc: "Ausbruch ueber Widerstand",
    criteria: [
      { autoKey: "multipleTests", label: "Mehrere Tests am Widerstand", weight: 15 },
      { autoKey: "compressionNearHigh", label: "Kompression nahe Hoch", weight: 20 },
      { autoKey: "higherLows", label: "Hoehere Tiefs", weight: 15 },
      { autoKey: "bigGreenCandle", label: "Grosse gruene Kerze", weight: 20 },
      { autoKey: "closeNearDayHigh", label: "Close nahe Tageshoch", weight: 15 },
      { autoKey: "atrIncreasing", label: "ATR nimmt zu", weight: 15 },
    ],
    invalidators: [],
  },
  "range": {
    key: "range", label: "Range", emoji: "↔️", color: C.blue,
    desc: "Seitwaertsphase",
    criteria: [
      { autoKey: "flatSMAs", label: "Flache SMAs", weight: 15 },
      { autoKey: "directionChanges", label: "Viele Richtungswechsel", weight: 15 },
      { autoKey: "lowATR", label: "ATR niedrig", weight: 15 },
      { autoKey: "wicksAtEdges", label: "Dochte an Raendern", weight: 20 },
      { autoKey: "alternatingColors", label: "Wechselnde Kerzenfarben", weight: 15 },
      { autoKey: "nearSupport", label: "Nahe Unterstuetzung", weight: 20 },
    ],
    invalidators: [],
  },
  "bounce": {
    key: "bounce", label: "Bounce", emoji: "🔄", color: C.yellow,
    desc: "Kapitulation + Umkehr",
    criteria: [
      { autoKey: "bigDrop", label: "Drop >= 3 ATR", weight: 20 },
      { autoKey: "farBelowEMAs", label: "Weit unter EMA20/50", weight: 15 },
      { autoKey: "atrRising", label: "ATR steigend", weight: 15 },
      { autoKey: "bigRedCandles", label: "Grosse rote Kerzen", weight: 10 },
      { autoKey: "longLowerWicks", label: "Lange untere Dochte", weight: 15 },
      { autoKey: "firstGreenReversal", label: "Erste gruene Umkehrkerze", weight: 25 },
    ],
    invalidators: [],
  },
};

const BASISDATEN_FIELDS = [
  { key: "symbol", label: "Ticker / Symbol", placeholder: "z.B. SAP oder AVGO", suffix: "", inputType: "text" },
  { key: "waehrung", label: "Handelswährung", type: "currency-toggle" },
  { key: "kontostand", label: "Aktueller Kontostand", placeholder: "z.B. 45991", suffix: "€" },
  { key: "risikoPct", label: "Max. Risiko pro Trade", placeholder: "1", suffix: "%" },
  { key: "wechselkurs", label: "EUR/USD Wechselkurs", placeholder: "z.B. 0.93", suffix: "$/€", showIf: "usd", type: "fx-rate" },
  { key: "einstieg", label: "Geplanter Einstiegskurs", placeholder: "z.B. 142.30", suffix: "CURRENCY" },
  { key: "stopLoss", label: "Stop-Loss Kurs", placeholder: "z.B. 135.00", suffix: "CURRENCY" },
  { key: "ziel", label: "Zielkurs (Take Profit)", placeholder: "z.B. 160.00", suffix: "CURRENCY" },
];

// Dummy QUESTIONS for backwards compat (only basis step)
const QUESTIONS = [
  {
    id: "basis", step: 0, title: "Basisdaten", subtitle: "Dein Konto und der Trade",
    icon: DollarSign, color: C.accent, type: "inputs", fields: BASISDATEN_FIELDS,
  },
];

const TradeCheck = ({ portfolio, tradeList, onAddTrade, onUpdateTrade, onNavigate }) => {
  const [step, setStep] = useState(0); // 0=Basisdaten, 1=Merkmalliste, 2=Ergebnis
  const [inputs, setInputs] = useState({ symbol: "", waehrung: "EUR", kontostand: String(Math.round(portfolio.kapital * 100) / 100), risikoPct: "1", wechselkurs: "", einstieg: "", stopLoss: "", ziel: "" });
  const [fxLoading, setFxLoading] = useState(false);
  const [fxDate, setFxDate] = useState("");
  const [tradeAdded, setTradeAdded] = useState(false);
  const [addInputs, setAddInputs] = useState({ stueckzahl: "", kaufkurs: "", datum: new Date().toISOString().split("T")[0] });
  const [checkedItems, setCheckedItems] = useState({}); // { autoKey: boolean }
  const totalSteps = 3; // Basisdaten, Merkmalliste, Ergebnis
  const ww = useWindowWidth();
  const isMobile = ww < 600;

  // ── Auto-Score Integration (Merkmalliste v2) ──
  const { merkmalResults, compositeResult, loading: autoLoading, error: autoError, dataTimestamp, staleData, marketData, computeAutoScores, resetAutoScores } = useAutoScore();

  // ── Prefill from Watchlist ──
  useEffect(() => {
    const prefill = localStorage.getItem("ncapital-prefill-symbol");
    if (prefill) {
      localStorage.removeItem("ncapital-prefill-symbol");
      const currency = localStorage.getItem("ncapital-prefill-currency") || "EUR";
      localStorage.removeItem("ncapital-prefill-currency");
      setInputs(prev => ({ ...prev, symbol: prefill, waehrung: currency }));
    }
  }, []);

  // ── Symbol-Historie ──
  const symbolHistory = useMemo(() => {
    const sym = inputs.symbol.toUpperCase().trim();
    if (!sym || sym.length < 1) return null;
    const matches = tradeList.filter(t => t.symbol === sym);
    if (matches.length === 0) return null;
    let totalPnl = 0, totalR = 0, wins = 0, losses = 0;
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
      if (props.remaining > 0) openTrade = { ...t, ...props };
    });
    const avgR = (wins + losses) > 0 ? totalR / (wins + losses) : 0;
    const wr = (wins + losses) > 0 ? (wins / (wins + losses)) * 100 : 0;
    let insight = "";
    if (wins + losses >= 2) {
      if (wr < 40) insight = "Niedrige WR bei diesem Symbol — Setup hinterfragen";
      else if (wr >= 60 && avgR > 0) insight = "Starkes Symbol — Setup funktioniert gut";
      else insight = "Solide Trefferquote";
    }
    return { symbol: sym, count: matches.length, wins, losses, winRate: wr, avgR, totalPnl, openTrade, insight };
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

  // ── Auto-Fill: Checkboxen aus Merkmalliste-Ergebnissen vorausfuellen ──
  useEffect(() => {
    if (!merkmalResults) return;
    setCheckedItems(prev => {
      const next = { ...prev };
      Object.entries(merkmalResults).forEach(([key, result]) => {
        if (next[key] === undefined) next[key] = result.value;
      });
      return next;
    });
  }, [merkmalResults]);

  // Setup-Ranking und Merkmalliste entfernt — Composite Score ersetzt dies

  const canProceed = step === 0
    ? (parseFloat(inputs.einstieg) > 0 && parseFloat(inputs.stopLoss) > 0 && parseFloat(inputs.ziel) > 0)
    : step === 1 ? compositeResult != null : false;

  const showResults = step === 2;

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

  // ── Score basierend auf Enhanced Score ──
  const { totalScore, maxScore } = useMemo(() => {
    if (!compositeResult) return { totalScore: 0, maxScore: 11 };
    const es = compositeResult.enhancedScore || compositeResult.compositeScore;
    // Enhanced Score Bereich: ca. -10 bis +11, normalisieren auf 0-100 fuer Ampel
    const normalized = Math.round(((es + 10) / 21) * 100);
    return { totalScore: normalized, maxScore: 100 };
  }, [compositeResult]);

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

  // Max-Verlust pro Trade (Ampel-adjustiert), unabhaengig von offenen Positionen
  const ampelMaxVerlust = kontostand * (positionAdvice.riskPct / 100);
  const empfPositionSize = risikoProAktieEur > 0 ? Math.floor(ampelMaxVerlust / risikoProAktieEur) : 0;
  const empfEinsatz = toEur(empfPositionSize * einstieg);
  const empfRisiko = empfPositionSize * risikoProAktieEur;
  const minCrv = ampelResult.ampel === "GRÜN" ? 1.5 : ampelResult.ampel === "ORANGE" ? 2.0 : ampelResult.ampel === "ROT" ? 3.0 : Infinity;

  const reset = () => {
    setStep(0); setCheckedItems({});
    setTradeAdded(false);
    setInputs({ symbol: "", waehrung: "EUR", kontostand: String(Math.round(portfolio.kapital * 100) / 100), risikoPct: "1", wechselkurs: "", einstieg: "", stopLoss: "", ziel: "" });
    setAddInputs({ stueckzahl: "", kaufkurs: "", datum: new Date().toISOString().split("T")[0] });
    setFxDate("");
    resetAutoScores();
  };

  // ── Trade-Übernahme (Transaktionsformat + Nachkauf) ──
  const isNachkauf = symbolHistory?.openTrade != null;

  const handleAddTrade = () => {
    const stueck = parseInt(addInputs.stueckzahl) || empfPositionSize;
    const kkRaw = parseFloat(addInputs.kaufkurs) || einstieg;
    if (!stueck || stueck <= 0 || !kkRaw || kkRaw <= 0) return;

    // Bei USD: alle Preise in EUR umrechnen — Trade Log ist immer EUR
    const kk = isUsd ? Math.round(kkRaw * wechselkurs * 100) / 100 : kkRaw;
    const slEur = isUsd ? Math.round(sl * wechselkurs * 100) / 100 : sl;
    const zielEur = isUsd ? Math.round(ziel * wechselkurs * 100) / 100 : ziel;

    if (isNachkauf && symbolHistory.openTrade) {
      // Nachkauf: Transaction zum bestehenden Trade hinzufügen (EUR-Kurs)
      onUpdateTrade(symbolHistory.openTrade.id, (trade) => ({
        ...trade,
        transactions: [...(trade.transactions || []), { type: "buy", datum: addInputs.datum, stueck, kurs: kk }],
      }));
    } else {
      // Neuer Trade — immer in EUR gespeichert
      const newTrade = {
        id: Date.now(),
        symbol: inputs.symbol.toUpperCase(),
        stopLoss: slEur,
        ziel: zielEur,
        score: totalScore,
        ...(compositeResult && { compositeScore: compositeResult.compositeScore, compositeBreakdown: compositeResult.breakdown }),
        ampel,
        historical: false,
        waehrung: "EUR",
        ...(isUsd && { originalWaehrung: "USD", usdWechselkurs: wechselkurs }),
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
          {["Basisdaten", "Composite Score", "Ergebnis"].map((_, i) => (
            <div key={i} onClick={() => { if (i < step) setStep(i); }} style={{
              width: (showResults ? i === 2 : i === step) ? 24 : 8, height: 8, borderRadius: 4,
              cursor: i < step ? "pointer" : "default",
              background: i < step ? C.accent : (showResults && i === 2) ? C.green : (i === step && !showResults) ? C.accentLight : C.border,
              transition: "all 0.3s", opacity: (showResults ? true : i <= step) ? 1 : 0.4,
            }} />
          ))}
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
                  <div style={{ fontSize: 10, color: C.textDim, fontWeight: 600 }}>Win-Rate</div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: symbolHistory.winRate >= 50 ? C.green : C.red }}>{symbolHistory.winRate.toFixed(0)}%</div>
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
              {isUsd && (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 10 }}>
                  {[
                    { label: "Einstieg", usd: `$${fmt(einstieg)}`, eur: `€${fmt(einstieg * wechselkurs)}` },
                    { label: "Stop-Loss", usd: `$${fmt(sl)}`, eur: `€${fmt(sl * wechselkurs)}`, color: C.red },
                    { label: "Ziel", usd: `$${fmt(ziel)}`, eur: `€${fmt(ziel * wechselkurs)}`, color: C.green },
                  ].map((item, i) => (
                    <div key={i} style={{ textAlign: "center", padding: "10px 8px", borderRadius: 10, background: `${(item.color || C.accent)}08`, border: `1px solid ${(item.color || C.accent)}20` }}>
                      <div style={{ fontSize: 10, color: C.textMuted, marginBottom: 3, textTransform: "uppercase", fontWeight: 600 }}>{item.label}</div>
                      <div style={{ fontSize: 15, fontWeight: 700, color: item.color || C.text }}>{item.usd}</div>
                      <div style={{ fontSize: 12, color: C.accent, fontWeight: 500, marginTop: 2 }}>{item.eur}</div>
                    </div>
                  ))}
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
                background: merkmalResults
                  ? `linear-gradient(135deg, ${C.green}20, ${C.green}08)`
                  : `linear-gradient(135deg, ${C.accent}, ${C.accentLight})`,
                color: merkmalResults ? C.green : "#fff",
                fontSize: 14, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
                transition: "all 0.3s", opacity: autoLoading ? 0.7 : 1,
                border: merkmalResults ? `1px solid ${C.green}30` : "none",
              }}
            >
              {autoLoading ? (
                <>
                  <div style={{ width: 16, height: 16, border: "2px solid rgba(255,255,255,0.3)", borderTopColor: "#fff", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
                  Analysiere Marktdaten fuer {inputs.symbol.toUpperCase()}...
                </>
              ) : merkmalResults ? (
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
            {merkmalResults && dataTimestamp && (
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

      {/* ── COMPOSITE SCORE STEP ── */}
      {step === 1 && !showResults && (
        <div style={{ animation: "fadeIn 0.4s ease-out" }}>
          <GlassCard style={{ marginBottom: 16 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
              <div style={{ width: 48, height: 48, borderRadius: 14, background: `${C.accent}15`, border: `1px solid ${C.accent}30`, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <BarChart2 size={22} color={C.accent} />
              </div>
              <div>
                <div style={{ fontSize: isMobile ? 18 : 20, fontWeight: 800, color: C.text }}>Composite Score</div>
                <div style={{ fontSize: 13, color: C.textMuted }}>Automatische Analyse aus 6 Faktoren + Enhanced</div>
              </div>
            </div>
            {compositeResult && (
              <div style={{ padding: "8px 12px", borderRadius: 8, background: `${C.green}08`, border: `1px solid ${C.green}20`, fontSize: 12, color: C.green, display: "flex", alignItems: "center", gap: 6 }}>
                <Zap size={12} /> Base: {compositeResult.compositeScore.toFixed(1)} | Enhanced: {(compositeResult.enhancedScore || compositeResult.compositeScore).toFixed(1)} ({compositeResult.confidence})
              </div>
            )}
            {autoLoading && (
              <div style={{ padding: "8px 12px", borderRadius: 8, background: `${C.accent}08`, border: `1px solid ${C.accent}20`, fontSize: 12, color: C.accent, display: "flex", alignItems: "center", gap: 6 }}>
                <RotateCcw size={12} style={{ animation: "spin 1s linear infinite" }} /> Marktdaten werden geladen...
              </div>
            )}
            {autoError && (
              <div style={{ padding: "8px 12px", borderRadius: 8, background: `${C.red}08`, border: `1px solid ${C.red}20`, fontSize: 12, color: C.red }}>
                Fehler: {autoError}
              </div>
            )}
          </GlassCard>

          {compositeResult && compositeResult.breakdown && (() => {
            const factors = [
              { key: "trend", label: "Trend", emoji: "\uD83D\uDCC8", max: 4, color: C.green, desc: "Daily \u00D7 1.0 + Weekly \u00D7 0.7 + Monthly \u00D7 0.3" },
              { key: "rsi", label: "RSI", emoji: "\uD83D\uDCCA", max: 2, color: C.accent, desc: "Relative Strength Index (Uptrend-Modifier + Divergenz)" },
              { key: "macd", label: "MACD", emoji: "\u26A1", max: 1.5, color: C.yellow, desc: "MACD Histogramm (graduell + Crossover)" },
              { key: "ma", label: "MA Alignment", emoji: "\uD83C\uDFAF", max: 1.5, color: C.blue, desc: "EMA20 / SMA50 / SMA200 Ordnung" },
              { key: "volume", label: "Volume", emoji: "\uD83D\uDD0A", max: 0.5, color: "#E056A0", desc: "5-Tage-Trend + OBV" },
              { key: "breakout", label: "Breakout", emoji: "\uD83D\uDE80", max: 1, color: "#F59E0B", desc: "Naehe 52w/20d High + BB Squeeze" },
            ];
            return factors.map(f => {
              const bd = compositeResult.breakdown[f.key];
              if (!bd) return null;
              const pct = f.max > 0 ? Math.max(0, Math.min(100, ((bd.score + f.max) / (2 * f.max)) * 100)) : 50;
              const isPositive = bd.score > 0;
              const isNegative = bd.score < 0;
              return (
                <GlassCard key={f.key} style={{ marginBottom: 10, padding: "14px 18px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
                    <span style={{ fontSize: 20 }}>{f.emoji}</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 15, fontWeight: 700, color: C.text }}>{f.label}</div>
                      <div style={{ fontSize: 11, color: C.textDim }}>{f.desc}</div>
                    </div>
                    <div style={{
                      padding: "4px 12px", borderRadius: 8, fontSize: 16, fontWeight: 800,
                      color: isPositive ? C.green : isNegative ? C.red : C.textMuted,
                      background: `${isPositive ? C.green : isNegative ? C.red : C.textMuted}10`,
                    }}>
                      {bd.score > 0 ? "+" : ""}{bd.score.toFixed(1)}
                    </div>
                    <div style={{ fontSize: 11, color: C.textDim, fontWeight: 600 }}>/ {"\u00B1"}{f.max}</div>
                  </div>
                  {/* Score Bar */}
                  <div style={{ height: 6, background: C.border, borderRadius: 3, position: "relative", overflow: "hidden" }}>
                    <div style={{
                      position: "absolute", left: `${Math.min(pct, 50)}%`, height: "100%",
                      width: `${Math.abs(pct - 50)}%`,
                      background: isPositive ? C.green : isNegative ? C.red : C.textDim,
                      borderRadius: 3, transition: "all 0.5s",
                    }} />
                    <div style={{ position: "absolute", left: "50%", top: -2, width: 2, height: 10, background: C.textDim, borderRadius: 1 }} />
                  </div>
                  <div style={{ fontSize: 11, color: C.textDim, marginTop: 6 }}>{bd.detail}</div>
                </GlassCard>
              );
            });
          })()}

          {/* Enhanced Bonus Section */}
          {compositeResult?.enhanced && (
            <GlassCard style={{ marginBottom: 10, padding: "14px 18px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                <span style={{ fontSize: 16 }}>{"\u2728"}</span>
                <div style={{ fontSize: 14, fontWeight: 700, color: C.text }}>Enhanced Bonus</div>
                <div style={{
                  marginLeft: "auto", padding: "3px 10px", borderRadius: 6, fontSize: 13, fontWeight: 700,
                  color: compositeResult.enhanced.bonus > 0 ? C.green : compositeResult.enhanced.bonus < 0 ? C.red : C.textMuted,
                  background: `${compositeResult.enhanced.bonus > 0 ? C.green : compositeResult.enhanced.bonus < 0 ? C.red : C.textMuted}10`,
                }}>
                  {compositeResult.enhanced.bonus > 0 ? "+" : ""}{compositeResult.enhanced.bonus.toFixed(1)}
                </div>
              </div>
              {[
                { key: "stoch", label: "StochRSI", max: 0.5 },
                { key: "structure", label: "Struktur", max: 0.5 },
                { key: "pullback", label: "Pullback", max: 0.3 },
                { key: "buyer", label: "Kaeufer", max: 0.2 },
                { key: "distribution", label: "Distribution", max: 0.5 },
              ].map(f => {
                const d = compositeResult.enhanced[f.key];
                if (!d) return null;
                return (
                  <div key={f.key} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0", fontSize: 12 }}>
                    <span style={{ color: C.textDim, width: 80 }}>{f.label}</span>
                    <span style={{ color: d.score > 0 ? C.green : d.score < 0 ? C.red : C.textMuted, fontWeight: 700, width: 40 }}>
                      {d.score > 0 ? "+" : ""}{d.score.toFixed(1)}
                    </span>
                    <span style={{ color: C.textDim, fontSize: 11 }}>{d.detail}</span>
                  </div>
                );
              })}
            </GlassCard>
          )}

          {/* Score Summary */}
          {compositeResult && (() => {
            const es = compositeResult.enhancedScore || compositeResult.compositeScore;
            const scoreColor = es >= 5 ? C.green : es >= 2 ? "#00D68F" : es >= 0 ? C.yellow : C.red;
            return (
              <GlassCard style={{ marginTop: 4, textAlign: "center", background: `linear-gradient(135deg, ${scoreColor}08, ${C.card})` }}>
                <div style={{ display: "flex", justifyContent: "center", gap: 30, marginBottom: 8 }}>
                  <div>
                    <div style={{ fontSize: 11, color: C.textMuted, fontWeight: 600 }}>Base Score</div>
                    <div style={{ fontSize: 24, fontWeight: 800, color: C.textMuted }}>{compositeResult.compositeScore.toFixed(1)}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 11, color: scoreColor, fontWeight: 600 }}>Enhanced Score</div>
                    <div style={{ fontSize: 36, fontWeight: 800, color: scoreColor }}>{es.toFixed(1)}</div>
                  </div>
                </div>
                <div style={{
                  display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 16px", borderRadius: 20,
                  fontSize: 13, fontWeight: 700, color: scoreColor, background: `${scoreColor}15`,
                }}>
                  {compositeResult.confidence}
                </div>
              </GlassCard>
            );
          })()}
        </div>
      )}

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
                <span style={{ fontSize: 48, fontWeight: 800, color: scoreColor, lineHeight: 1 }}>{compositeResult ? compositeResult.compositeScore.toFixed(1) : totalScore}</span>
                <span style={{ fontSize: 13, color: C.textMuted, marginTop: 4 }}>{compositeResult ? "/ 11.0" : `von ${maxScore}`}</span>
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

            {/* Max-Verlust pro Trade */}

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

          {/* Composite Score Breakdown */}
          {compositeResult && compositeResult.breakdown && (
          <GlassCard>
            <div style={{ fontSize: 16, fontWeight: 700, color: C.text, marginBottom: 16 }}>Score-Faktoren</div>
            {[
              { key: "trend", label: "Trend", emoji: "\uD83D\uDCC8", max: 6, color: C.green },
              { key: "rsi", label: "RSI", emoji: "\uD83D\uDCCA", max: 1.5, color: C.accent },
              { key: "macd", label: "MACD", emoji: "\u26A1", max: 1.0, color: C.yellow },
              { key: "ma", label: "MA Alignment", emoji: "\uD83C\uDFAF", max: 2.0, color: C.blue },
              { key: "volume", label: "Volume", emoji: "\uD83D\uDD0A", max: 1.0, color: "#E056A0" },
            ].map(f => {
              const bd = compositeResult.breakdown[f.key];
              if (!bd) return null;
              const pct = f.max > 0 ? Math.max(0, Math.min(100, ((bd.score + f.max) / (2 * f.max)) * 100)) : 50;
              const barColor = bd.score > 0 ? C.green : bd.score < 0 ? C.red : C.textDim;
              return (
                <div key={f.key} style={{ marginBottom: 14 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 5 }}>
                    <span style={{ fontSize: 12, color: C.textMuted, fontWeight: 500 }}>{f.emoji} {f.label}</span>
                    <span style={{ fontSize: 12, fontWeight: 700, color: barColor }}>{bd.score > 0 ? "+" : ""}{bd.score.toFixed(1)} / {"\u00B1"}{f.max}</span>
                  </div>
                  <div style={{ height: 6, borderRadius: 3, background: C.border, overflow: "hidden", position: "relative" }}>
                    <div style={{
                      position: "absolute", left: `${Math.min(pct, 50)}%`, height: "100%",
                      width: `${Math.abs(pct - 50)}%`,
                      background: `linear-gradient(90deg, ${barColor}, ${barColor}AA)`,
                      borderRadius: 3, transition: "width 0.6s",
                    }} />
                    <div style={{ position: "absolute", left: "50%", top: -1, width: 1, height: 8, background: C.textDim }} />
                  </div>
                  <div style={{ fontSize: 10, color: C.textDim, marginTop: 3 }}>{bd.detail}</div>
                </div>
              );
            })}
          </GlassCard>
          )}

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
                  { label: "Composite", value: compositeResult ? compositeResult.compositeScore.toFixed(1) : "\u2014" },
                  { label: "Ampel", value: ampel, color: scoreColor },
                  { label: "CRV", value: fmt(crv, 1) + "x" },
                  { label: "Einstieg", value: isUsd ? `\u20AC${fmt(einstieg * wechselkurs)}` : `\u20AC${fmt(einstieg)}`, sub: isUsd ? `($${fmt(einstieg)})` : null },
                  { label: "Stop-Loss", value: isUsd ? `\u20AC${fmt(sl * wechselkurs)}` : `\u20AC${fmt(sl)}`, sub: isUsd ? `($${fmt(sl)})` : null },
                  { label: "Ziel", value: isUsd ? `\u20AC${fmt(ziel * wechselkurs)}` : `\u20AC${fmt(ziel)}`, sub: isUsd ? `($${fmt(ziel)})` : null },
                  { label: "Score", value: compositeResult ? `${compositeResult.compositeScore.toFixed(1)} / 11` : `${totalScore}/${maxScore}` },
                ].map((item, i) => (
                  <div key={i} style={{ padding: "8px 12px", borderRadius: 8, background: "rgba(10,13,17,0.4)", border: `1px solid ${C.border}` }}>
                    <div style={{ fontSize: 10, color: C.textDim, textTransform: "uppercase", fontWeight: 600, marginBottom: 2 }}>{item.label}</div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: item.color || C.text }}>{item.value}</div>
                    {item.sub && <div style={{ fontSize: 10, color: C.textDim, fontWeight: 500, marginTop: 1 }}>{item.sub}</div>}
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
            {step === 1 ? "Ergebnis anzeigen" : "Weiter"}
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
  const ts = P.tierStats || {};
  const winsTotal = P.closedTrades?.filter(t => t.pnl > 0).length || 0;
  const lossesTotal = (P.tradesGesamt || 0) - winsTotal;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : isTablet ? "1fr 1fr" : "repeat(5, 1fr)", gap: 16 }}>
        <StatCard icon={DollarSign} label="Kapital" value={fmtEur(P.kapital)} sub={`Start: ${fmtEur(P.startkapital)}`} color={C.accent} trend={P.roiPct}
          tooltip={`Aktuelles Depot-Kapital nach allen\nrealisierten Gewinnen und Verlusten.\n\nStartkapital: ${fmtEur(P.startkapital)}\nAktuell: ${fmtEur(P.kapital)}\nDifferenz: ${P.kapital - P.startkapital >= 0 ? "+" : ""}${fmtEur(P.kapital - P.startkapital)}`} />
        <StatCard icon={TrendingUp} label="Realisiert" value={fmtEur(P.realisiertGewinn)} sub={P.gesamtGebuehren > 0 ? `Netto (${fmtEur(P.gesamtGebuehren)} Gebühren)` : "Geschlossene P&L"} color={P.realisiertGewinn >= 0 ? C.green : C.red}
          tooltip={`Summe aller geschlossenen Trades\n(Gewinn minus Verlust minus Gebühren).\n\nBrutto-P&L abzgl. ${fmtEur(P.gesamtGebuehren)} Gebühren\n= ${fmtEur(P.realisiertGewinn)} Netto`} />
        <StatCard icon={Activity} label="Win-Rate" value={`${P.winRate.toFixed(1)}%`} sub={`${P.tradesGesamt} Trades`} color={C.blue}
          tooltip={`Anteil gewonnener Trades an allen\nabgeschlossenen Trades.\n\n${winsTotal} Wins / ${lossesTotal} Losses\nvon ${P.tradesGesamt} Trades gesamt`} />
        <StatCard icon={Target} label="Profit-Faktor" value={fmt(P.profitFaktor, 1)} sub={`Ø ${fmt(P.avgR, 2)}R`} color={C.yellow}
          tooltip={`Verhältnis von durchschnittlichem\nGewinn zu durchschnittlichem Verlust.\n\nPF > 1.0 = profitabel\nPF > 2.0 = sehr gut\n\nØ R-Wert: ${fmt(P.avgR, 2)}R pro Trade`} />
        <StatCard icon={Shield} label="Offenes Risiko" value={fmtEur(P.offenRisiko)} sub={`${P.kapital > 0 ? ((P.offenRisiko / P.kapital) * 100).toFixed(1) : "0.0"}% vom Depot`} color={C.red}
          tooltip={`Maximaler Verlust aller offenen\nPositionen bis zum Stop-Loss.\n\nRegel: Max. 3-5% vom Depot.\nAktuell: ${P.kapital > 0 ? ((P.offenRisiko / P.kapital) * 100).toFixed(1) : "0.0"}% gebunden`} />
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
          <div style={{ fontSize: 15, fontWeight: 700, color: C.text, marginBottom: 14 }}>TA Score Modell</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 5, marginBottom: 16 }}>
            {[
              { label: "Trend", max: 4.0, desc: "D×1.0 + W×0.7 + M×0.3", color: C.accent },
              { label: "RSI", max: 2.0, desc: "Divergenz + Penalty", color: C.blue },
              { label: "MACD", max: 1.5, desc: "Graduiert + Crossover", color: C.yellow },
              { label: "MA Align", max: 1.5, desc: "EMA20/SMA50/SMA200", color: C.green },
              { label: "Breakout", max: 1.0, desc: "52W-Hoch + BB Squeeze", color: C.orange },
              { label: "Volumen", max: 0.5, desc: "5d-Trend + OBV", color: C.textMuted },
            ].map((comp, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ width: 62, fontSize: 10, color: C.textDim, fontWeight: 600, textAlign: "right", flexShrink: 0 }}>{comp.label}</div>
                <div style={{ flex: 1, height: 14, background: "rgba(10,13,17,0.5)", borderRadius: 7, overflow: "hidden", position: "relative" }}>
                  <div style={{ position: "absolute", left: 0, top: 0, height: "100%", width: `${(comp.max / 4.0) * 100}%`, background: `${comp.color}40`, borderRadius: 7 }} />
                  <div style={{ position: "absolute", right: 6, top: 0, height: "100%", display: "flex", alignItems: "center", fontSize: 9, color: comp.color, fontWeight: 700 }}>{"\u00B1"}{comp.max}</div>
                </div>
              </div>
            ))}
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 2 }}>
              <span style={{ fontSize: 10, color: C.textDim }}>Max: <strong style={{ color: C.accentLight }}>{"\u00B1"}10.5</strong></span>
            </div>
          </div>
          <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: C.textMuted, marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.05em" }}>Tier-Performance</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {[
                { label: "High Conviction", key: "HIGH_CONVICTION", desc: "Score \u2265 7.5", color: C.green },
                { label: "Standard", key: "STANDARD", desc: "Score \u2265 6.5", color: C.accent },
                { label: "Low Score", key: "LOW", desc: "Score < 6.5", color: C.orange },
                { label: "Manuell", key: "MANUELL", desc: "Kein TA Score", color: C.textDim },
              ].map((tier, i) => {
                const st = ts[tier.key] || { count: 0, wins: 0, winRate: 0, avgR: 0, totalPnl: 0 };
                if (st.count === 0) return null;
                return (
                  <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "5px 8px", borderRadius: 6, background: `${tier.color}08`, border: `1px solid ${tier.color}15` }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <div style={{ width: 6, height: 6, borderRadius: 3, background: tier.color }} />
                      <span style={{ fontSize: 11, color: C.text, fontWeight: 600 }}>{tier.label}</span>
                      <span style={{ fontSize: 10, color: C.textDim }}>({st.count})</span>
                    </div>
                    <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                      <span style={{ fontSize: 10, color: C.textDim }}>{st.wins}W/{st.count - st.wins}L</span>
                      <span style={{ fontSize: 11, color: st.winRate >= 50 ? C.green : C.red, fontWeight: 700 }}>{st.winRate.toFixed(0)}%</span>
                      <span style={{ fontSize: 11, color: st.avgR >= 0 ? C.green : C.red, fontWeight: 700 }}>{st.avgR >= 0 ? "+" : ""}{st.avgR.toFixed(1)}R</span>
                    </div>
                  </div>
                );
              })}
            </div>
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
// SETUP_OPTIONS entfernt — Setup-Namen werden nicht mehr angezeigt

const TradeLog = ({ tradeList, onUpdateTrade, onDeleteTrade, onAddTrade }) => {
  const [filter, setFilter] = useState("Alle");
  const [expandedId, setExpandedId] = useState(null);
  const [txModal, setTxModal] = useState(null); // { tradeId, type: "sell"|"buy" }
  const [txInputs, setTxInputs] = useState({ stueckzahl: "", kurs: "", datum: new Date().toISOString().split("T")[0] });
  const [editModal, setEditModal] = useState(null); // trade object being edited
  const [editInputs, setEditInputs] = useState({});
  const [deleteConfirm, setDeleteConfirm] = useState(null); // tradeId awaiting delete confirmation
  const [newTradeModal, setNewTradeModal] = useState(false);
  const [newTradeError, setNewTradeError] = useState("");
  const [newTradeInputs, setNewTradeInputs] = useState({
    symbol: "", waehrung: "EUR", wechselkurs: "", botScore: "",
    stopLoss: "", ziel: "", datum: new Date().toISOString().split("T")[0], stueckzahl: "", kaufkurs: "",
  });
  const [screenshotUrls, setScreenshotUrls] = useState({}); // { tradeId: objectUrl }
  const [screenshotViewer, setScreenshotViewer] = useState(null); // objectUrl for fullscreen
  const [pendingScreenshot, setPendingScreenshot] = useState(null); // File for new/edit trade
  const ww = useWindowWidth();
  const isMobile = ww < 600;

  // Load screenshot thumbnails for trades that have screenshotId
  useEffect(() => {
    let cancelled = false;
    const loadUrls = async () => {
      const urls = {};
      for (const t of tradeList) {
        if (t.screenshotId) {
          try {
            const url = await getScreenshotUrl(t.screenshotId);
            if (url && !cancelled) urls[t.id] = url;
          } catch {}
        }
      }
      if (!cancelled) setScreenshotUrls(urls);
    };
    loadUrls();
    return () => { cancelled = true; };
  }, [tradeList]);

  const handleNewTradeSave = async () => {
    const sl = parseFloat(newTradeInputs.stopLoss);
    const z = parseFloat(newTradeInputs.ziel);
    const stueck = parseInt(newTradeInputs.stueckzahl);
    const kk = parseFloat(newTradeInputs.kaufkurs);
    const missing = [];
    if (!newTradeInputs.symbol.trim()) missing.push("Symbol");
    if (!sl) missing.push("Stop-Loss");
    if (!z) missing.push("Zielkurs");
    if (!stueck) missing.push("Stueckzahl");
    if (!kk) missing.push("Kaufkurs");
    if (missing.length > 0) { setNewTradeError(`Fehlende Pflichtfelder: ${missing.join(", ")}`); return; }
    setNewTradeError("");
    const isUsd = newTradeInputs.waehrung === "USD";
    const fx = parseFloat(newTradeInputs.wechselkurs) || 0.93;
    const slEur = isUsd ? Math.round(sl * fx * 100) / 100 : sl;
    const zielEur = isUsd ? Math.round(z * fx * 100) / 100 : z;
    const kkEur = isUsd ? Math.round(kk * fx * 100) / 100 : kk;
    const botScore = parseInt(newTradeInputs.botScore) || 0;
    const ampel = botScore >= 78 ? "GRÜN" : botScore >= 55 ? "ORANGE" : botScore >= 35 ? "ROT" : botScore > 0 ? "NICHT TRADEN" : "MANUELL";
    const tradeId = Date.now();
    let screenshotId = undefined;
    if (pendingScreenshot) {
      try { await saveScreenshot(tradeId, pendingScreenshot); screenshotId = String(tradeId); } catch {}
    }
    const newTrade = {
      id: tradeId,
      symbol: newTradeInputs.symbol.toUpperCase().trim(),
      stopLoss: slEur, ziel: zielEur,
      score: botScore,
      ampel,
      historical: false,
      waehrung: "EUR",
      ...(botScore > 0 && { botScore }),
      ...(isUsd && { originalWaehrung: "USD", usdWechselkurs: fx }),
      ...(screenshotId && { screenshotId }),
      transactions: [{ type: "buy", datum: newTradeInputs.datum, stueck, kurs: kkEur }],
    };
    onAddTrade(newTrade);
    setNewTradeModal(false);
    setPendingScreenshot(null);
    setNewTradeError("");
    setNewTradeInputs({ symbol: "", waehrung: "EUR", wechselkurs: "", botScore: "", stopLoss: "", ziel: "", datum: new Date().toISOString().split("T")[0], stueckzahl: "", kaufkurs: "" });
  };

  const enriched = useMemo(() => tradeList.map(t => {
    const props = tradeComputedProps(t);
    const fx = t.waehrung === "USD" && t.wechselkurs ? t.wechselkurs : 1;
    const pnlBrutto = props.pnlRaw * fx;
    const pnl = pnlBrutto - props.totalGebuehren;
    const riskPS = Math.abs(props.avgKaufkurs - t.stopLoss);
    const rValue = riskPS > 0 && props.totalSold > 0 ? (props.avgVerkaufskurs - props.avgKaufkurs) / riskPS : 0;
    // Haltezeit in Tagen (ab erstem Kauf)
    const holdingDays = props.datum ? Math.max(0, Math.floor((new Date() - new Date(props.datum)) / (1000 * 60 * 60 * 24))) : 0;
    return { ...t, ...props, pnl, pnlBrutto, rValue, fx, holdingDays };
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

  const openEdit = (trade) => {
    setEditModal(trade);
    // Wenn Trade schon EUR ist aber aus USD konvertiert, USD-Werte zurueckrechnen
    const wasUsd = trade.originalWaehrung === "USD" && trade.usdWechselkurs;
    const fx = wasUsd ? trade.usdWechselkurs : (trade.wechselkurs || 0);
    setEditInputs({
      symbol: trade.symbol,
      stopLoss: wasUsd ? String(Math.round(trade.stopLoss / fx * 100) / 100) : String(trade.stopLoss),
      ziel: wasUsd ? String(Math.round(trade.ziel / fx * 100) / 100) : String(trade.ziel),
      waehrung: wasUsd ? "USD" : (trade.originalWaehrung || trade.waehrung || "EUR"),
      wechselkurs: fx ? String(fx) : "",
      botScore: trade.botScore != null ? String(trade.botScore) : "",
      botSetup: trade.botSetup || trade.setup || "",
      // Transaktions-Kurse ebenfalls zurueckrechnen bei USD-Trades
      transactions: (trade.transactions || []).map(tx => ({
        ...tx,
        kurs: wasUsd && fx > 0 ? String(Math.round(tx.kurs / fx * 100) / 100) : String(tx.kurs),
        stueck: String(tx.stueck),
      })),
    });
  };

  const handleEditSave = async () => {
    if (!editModal) return;
    const sl = parseFloat(editInputs.stopLoss);
    const z = parseFloat(editInputs.ziel);
    if (!editInputs.symbol.trim() || !sl || sl <= 0 || !z || z <= 0) return;
    const editIsUsd = editInputs.waehrung === "USD";
    const editFx = parseFloat(editInputs.wechselkurs) || 0.93;
    // Transaktionen validieren, parsen und ggf. USD→EUR konvertieren
    const cleanTx = (editInputs.transactions || [])
      .filter(tx => parseFloat(tx.kurs) > 0 && parseInt(tx.stueck) > 0 && tx.datum)
      .map(tx => ({
        type: tx.type, datum: tx.datum,
        kurs: editIsUsd ? Math.round(parseFloat(tx.kurs) * editFx * 100) / 100 : parseFloat(tx.kurs),
        stueck: parseInt(tx.stueck),
      }));
    // Bot-Score Felder
    const editBotScore = parseInt(editInputs.botScore) || 0;
    const editBotSetup = editInputs.botSetup || undefined;
    // Screenshot handling
    let newScreenshotId = editModal.screenshotId;
    if (pendingScreenshot) {
      try { await saveScreenshot(editModal.id, pendingScreenshot); newScreenshotId = String(editModal.id); } catch {}
    } else if (editModal._removeScreenshot) {
      try { await deleteScreenshot(editModal.screenshotId); } catch {}
      newScreenshotId = undefined;
    }
    // Immer in EUR speichern
    onUpdateTrade(editModal.id, (t) => ({
      ...t,
      symbol: editInputs.symbol.toUpperCase().trim(),
      stopLoss: editIsUsd ? Math.round(sl * editFx * 100) / 100 : sl,
      ziel: editIsUsd ? Math.round(z * editFx * 100) / 100 : z,
      waehrung: "EUR",
      ...(cleanTx.length > 0 ? { transactions: cleanTx } : {}),
      ...(editIsUsd ? { originalWaehrung: "USD", usdWechselkurs: editFx } : { originalWaehrung: undefined, usdWechselkurs: undefined }),
      botScore: editBotScore > 0 ? editBotScore : undefined,
      botSetup: editBotSetup,
      screenshotId: newScreenshotId,
    }));
    setPendingScreenshot(null);
    setEditModal(null);
  };

  // Beim Währungswechsel alle Werte automatisch umrechnen
  const switchEditCurrency = (newCurrency) => {
    setEditInputs(p => {
      if (p.waehrung === newCurrency) return p;
      const fx = parseFloat(p.wechselkurs) || 0.93;
      const toEur = newCurrency === "EUR";
      const conv = (val) => {
        const n = parseFloat(val);
        if (!n || n <= 0) return val;
        return String(Math.round((toEur ? n * fx : n / fx) * 100) / 100);
      };
      return {
        ...p,
        waehrung: newCurrency,
        stopLoss: conv(p.stopLoss),
        ziel: conv(p.ziel),
        transactions: (p.transactions || []).map(tx => ({ ...tx, kurs: conv(tx.kurs) })),
      };
    });
  };

  const updateEditTx = (idx, field, value) => {
    setEditInputs(p => {
      const txs = [...(p.transactions || [])];
      txs[idx] = { ...txs[idx], [field]: value };
      return { ...p, transactions: txs };
    });
  };

  const removeEditTx = (idx) => {
    setEditInputs(p => ({ ...p, transactions: (p.transactions || []).filter((_, i) => i !== idx) }));
  };

  const addEditTx = (type) => {
    setEditInputs(p => ({
      ...p,
      transactions: [...(p.transactions || []), { type, datum: new Date().toISOString().split("T")[0], stueck: "", kurs: "" }],
    }));
  };

  const handleDelete = (id) => {
    const trade = tradeList.find(t => t.id === id);
    if (trade?.screenshotId) deleteScreenshot(trade.screenshotId).catch(() => {});
    onDeleteTrade(id);
    setDeleteConfirm(null);
  };

  // ─── Bot-Score Import via Paste ───
  const [importModal, setImportModal] = useState(null); // { tradeId } or null
  const [importText, setImportText] = useState("");
  const [importParsed, setImportParsed] = useState(null);

  const parseTelegramAlert = (text) => {
    try {
      // Symbol: first word after 🟢 or 🔴, e.g. "🟢 SAP"
      const symbolMatch = text.match(/[🟢🔴]\s*(\w+)/);
      // Score: number after setup label, e.g. "Trend-Pullback 85"
      const scoreMatch = text.match(/(?:Trend-Pullback|Breakout|Range|Bounce|GENERAL)\s+(\d+)/i);
      // Setup type
      const setupMatch = text.match(/(Trend-Pullback|Breakout|Range|Bounce)/i);
      // Entry price: "Entry PRICE" pattern
      const entryMatch = text.match(/Entry\s+([\d.,]+)/i);
      // Stop: "Stop PRICE" pattern
      const stopMatch = text.match(/Stop\s+([\d.,]+)/i);
      // Target: "Ziel PRICE" pattern
      const targetMatch = text.match(/Ziel\s+([\d.,]+)/i);
      if (!symbolMatch && !scoreMatch) return null;
      const parseNum = (s) => s ? parseFloat(s.replace(",", ".")) : undefined;
      return {
        symbol: symbolMatch?.[1]?.toUpperCase(),
        score: scoreMatch ? parseInt(scoreMatch[1]) : undefined,
        setup: setupMatch ? setupMatch[1] : undefined,
        entry: parseNum(entryMatch?.[1]),
        stop: parseNum(stopMatch?.[1]),
        target: parseNum(targetMatch?.[1]),
      };
    } catch { return null; }
  };

  const handleImportParse = () => {
    const parsed = parseTelegramAlert(importText);
    setImportParsed(parsed);
  };

  const handleImportApply = () => {
    if (!importModal || !importParsed) return;
    const { score, setup, stop, target } = importParsed;
    onUpdateTrade(importModal.tradeId, (t) => ({
      ...t,
      ...(score && { botScore: score, botSetup: setup || t.botSetup }),
      ...(stop && { stopLoss: stop }),
      ...(target && { ziel: target }),
    }));
    setImportModal(null);
    setImportText("");
    setImportParsed(null);
  };

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 20, flexWrap: "wrap", alignItems: "center" }}>
        {["Alle", "Offen", "GRÜN", "ORANGE", "ROT", "MANUELL", "NICHT TRADEN"].map(f => (
          <button key={f} onClick={() => setFilter(f)} style={{
            padding: "7px 16px", borderRadius: 8, border: `1px solid ${filter === f ? C.accent : C.border}`,
            background: filter === f ? `${C.accent}15` : "transparent",
            color: f === "GRÜN" ? C.green : f === "ORANGE" ? C.orange : f === "ROT" ? C.red : f === "MANUELL" ? C.blue : f === "NICHT TRADEN" ? C.noTrade : filter === f ? C.accentLight : C.textMuted,
            fontSize: 12, fontWeight: 600, cursor: "pointer", transition: "all 0.2s",
          }}>{f === "Alle" ? `Alle (${tradeList.length})` : f}</button>
        ))}
        {onAddTrade && (
          <button onClick={() => setNewTradeModal(true)} style={{
            marginLeft: "auto", padding: "7px 14px", borderRadius: 8,
            border: `1px solid ${C.accent}40`, background: `linear-gradient(135deg, ${C.accent}20, ${C.accentLight}10)`,
            color: C.accentLight, fontSize: 12, fontWeight: 700, cursor: "pointer",
            display: "flex", alignItems: "center", gap: 5, transition: "all 0.2s",
          }}>
            <Plus size={14} /> Neuer Trade
          </button>
        )}
      </div>

      {/* Neuer Trade Modal */}
      {newTradeModal && (
        <GlassCard style={{ marginBottom: 20, border: `2px solid ${C.accent}40` }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
            <Plus size={18} color={C.accent} />
            <div style={{ fontSize: 15, fontWeight: 700, color: C.text }}>Neuer Trade</div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr 1fr 1fr", gap: 12 }}>
            <div>
              <label style={{ display: "block", fontSize: 12, color: C.textMuted, marginBottom: 6, fontWeight: 600 }}>Symbol *</label>
              <input type="text" value={newTradeInputs.symbol} onChange={e => setNewTradeInputs(p => ({ ...p, symbol: e.target.value }))} placeholder="z.B. SAP"
                style={{ width: "100%", padding: "10px 12px", background: "rgba(10,13,17,0.6)", border: `1px solid ${C.border}`, borderRadius: 10, color: C.text, fontSize: 14, fontWeight: 500, outline: "none", boxSizing: "border-box", textTransform: "uppercase" }} />
            </div>
            <div>
              <label style={{ display: "block", fontSize: 12, color: C.textMuted, marginBottom: 6, fontWeight: 600 }}>Composite Score (optional)</label>
              <input type="number" min="0" max="100" value={newTradeInputs.botScore} onChange={e => setNewTradeInputs(p => ({ ...p, botScore: e.target.value }))} placeholder="0-100"
                style={{ width: "100%", padding: "10px 12px", background: "rgba(10,13,17,0.6)", border: `1px solid ${C.border}`, borderRadius: 10, color: C.text, fontSize: 14, fontWeight: 500, outline: "none", boxSizing: "border-box" }} />
            </div>
            <div>
              <label style={{ display: "block", fontSize: 12, color: C.textMuted, marginBottom: 6, fontWeight: 600 }}>Waehrung</label>
              <div style={{ display: "flex", gap: 0, borderRadius: 10, overflow: "hidden", border: `1px solid ${C.border}` }}>
                {["EUR", "USD"].map(w => (
                  <button key={w} onClick={() => setNewTradeInputs(p => ({ ...p, waehrung: w }))} style={{
                    flex: 1, padding: "10px 0", border: "none", cursor: "pointer", fontSize: 13, fontWeight: 600,
                    background: newTradeInputs.waehrung === w ? `${C.accent}20` : "rgba(10,13,17,0.6)",
                    color: newTradeInputs.waehrung === w ? C.accentLight : C.textDim,
                    borderRight: w === "EUR" ? `1px solid ${C.border}` : "none",
                  }}>{w}</button>
                ))}
              </div>
            </div>
          </div>
          {newTradeInputs.waehrung === "USD" && (
            <div style={{ marginTop: 12 }}>
              <label style={{ display: "block", fontSize: 12, color: C.textMuted, marginBottom: 6, fontWeight: 600 }}>Wechselkurs (1$ = x€)</label>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input type="number" value={newTradeInputs.wechselkurs} onChange={e => setNewTradeInputs(p => ({ ...p, wechselkurs: e.target.value }))} placeholder="0.93"
                  style={{ width: isMobile ? "100%" : "200px", padding: "10px 12px", background: "rgba(10,13,17,0.6)", border: `1px solid ${C.border}`, borderRadius: 10, color: C.text, fontSize: 14, fontWeight: 500, outline: "none", boxSizing: "border-box" }} />
                <button onClick={async () => { try { const r = await fetch("https://api.frankfurter.dev/v1/latest?base=USD&symbols=EUR"); const d = await r.json(); if (d?.rates?.EUR) setNewTradeInputs(p => ({ ...p, wechselkurs: String(d.rates.EUR) })); } catch {} }} style={{ padding: "10px 12px", borderRadius: 10, border: `1px solid ${C.accent}40`, background: `${C.accent}10`, color: C.accentLight, fontSize: 12, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}>
                  Live-Kurs
                </button>
              </div>
            </div>
          )}
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 12, marginTop: 12 }}>
            <div>
              <label style={{ display: "block", fontSize: 12, color: C.textMuted, marginBottom: 6, fontWeight: 600 }}>Stop-Loss {newTradeInputs.waehrung === "USD" ? "($)" : "(€)"} *</label>
              <input type="number" step="0.01" value={newTradeInputs.stopLoss} onChange={e => setNewTradeInputs(p => ({ ...p, stopLoss: e.target.value }))}
                style={{ width: "100%", padding: "10px 12px", background: "rgba(10,13,17,0.6)", border: `1px solid ${C.border}`, borderRadius: 10, color: C.text, fontSize: 14, fontWeight: 500, outline: "none", boxSizing: "border-box" }} />
            </div>
            <div>
              <label style={{ display: "block", fontSize: 12, color: C.textMuted, marginBottom: 6, fontWeight: 600 }}>Zielkurs {newTradeInputs.waehrung === "USD" ? "($)" : "(€)"} *</label>
              <input type="number" step="0.01" value={newTradeInputs.ziel} onChange={e => setNewTradeInputs(p => ({ ...p, ziel: e.target.value }))}
                style={{ width: "100%", padding: "10px 12px", background: "rgba(10,13,17,0.6)", border: `1px solid ${C.border}`, borderRadius: 10, color: C.text, fontSize: 14, fontWeight: 500, outline: "none", boxSizing: "border-box" }} />
            </div>
          </div>
          <div style={{ borderTop: `1px solid ${C.border}`, marginTop: 16, paddingTop: 14 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: C.textMuted, marginBottom: 10 }}>Erste Transaktion</div>
            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr 1fr", gap: 12 }}>
              <div>
                <label style={{ display: "block", fontSize: 12, color: C.textMuted, marginBottom: 6, fontWeight: 600 }}>Datum</label>
                <input type="date" value={newTradeInputs.datum} onChange={e => setNewTradeInputs(p => ({ ...p, datum: e.target.value }))}
                  style={{ width: "100%", padding: "10px 12px", background: "rgba(10,13,17,0.6)", border: `1px solid ${C.border}`, borderRadius: 10, color: C.text, fontSize: 14, fontWeight: 500, outline: "none", boxSizing: "border-box", colorScheme: "dark" }} />
              </div>
              <div>
                <label style={{ display: "block", fontSize: 12, color: C.textMuted, marginBottom: 6, fontWeight: 600 }}>Stueckzahl *</label>
                <input type="number" value={newTradeInputs.stueckzahl} onChange={e => setNewTradeInputs(p => ({ ...p, stueckzahl: e.target.value }))}
                  style={{ width: "100%", padding: "10px 12px", background: "rgba(10,13,17,0.6)", border: `1px solid ${C.border}`, borderRadius: 10, color: C.text, fontSize: 14, fontWeight: 500, outline: "none", boxSizing: "border-box" }} />
              </div>
              <div>
                <label style={{ display: "block", fontSize: 12, color: C.textMuted, marginBottom: 6, fontWeight: 600 }}>Kaufkurs {newTradeInputs.waehrung === "USD" ? "($)" : "(€)"} *</label>
                <input type="number" step="0.01" value={newTradeInputs.kaufkurs} onChange={e => setNewTradeInputs(p => ({ ...p, kaufkurs: e.target.value }))}
                  style={{ width: "100%", padding: "10px 12px", background: "rgba(10,13,17,0.6)", border: `1px solid ${C.border}`, borderRadius: 10, color: C.text, fontSize: 14, fontWeight: 500, outline: "none", boxSizing: "border-box" }} />
              </div>
            </div>
          </div>
          {/* Screenshot Upload */}
          <div style={{ marginTop: 14, display: "flex", alignItems: "center", gap: 10 }}>
            <label style={{ padding: "8px 14px", borderRadius: 8, border: `1px dashed ${C.border}`, background: "rgba(10,13,17,0.4)", color: C.textMuted, fontSize: 12, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}>
              <Camera size={14} /> {pendingScreenshot ? pendingScreenshot.name : "Screenshot hinzufuegen"}
              <input type="file" accept="image/*" style={{ display: "none" }} onChange={e => { if (e.target.files?.[0]) setPendingScreenshot(e.target.files[0]); }} />
            </label>
            {pendingScreenshot && (
              <button onClick={() => setPendingScreenshot(null)} style={{ padding: "4px 8px", borderRadius: 6, border: "none", background: `${C.red}15`, color: C.red, fontSize: 11, fontWeight: 600, cursor: "pointer" }}>Entfernen</button>
            )}
          </div>
          {/* Preview */}
          {newTradeInputs.symbol && parseFloat(newTradeInputs.stopLoss) > 0 && parseFloat(newTradeInputs.kaufkurs) > 0 && (
            <div style={{ marginTop: 14, padding: "10px 14px", borderRadius: 10, background: `${C.accent}08`, border: `1px solid ${C.accent}15`, display: "flex", gap: 16, flexWrap: "wrap", fontSize: 12, color: C.textMuted }}>
              <span>CRV: <strong style={{ color: C.text }}>{((parseFloat(newTradeInputs.ziel) - parseFloat(newTradeInputs.kaufkurs)) / Math.abs(parseFloat(newTradeInputs.kaufkurs) - parseFloat(newTradeInputs.stopLoss))).toFixed(1)}:1</strong></span>
              <span>Risiko/Stk: <strong style={{ color: C.red }}>{Math.abs(parseFloat(newTradeInputs.kaufkurs) - parseFloat(newTradeInputs.stopLoss)).toFixed(2)}</strong></span>
              <span>Ampel: <strong style={{ color: ampelColor(parseInt(newTradeInputs.botScore) >= 78 ? "GRÜN" : parseInt(newTradeInputs.botScore) >= 55 ? "ORANGE" : parseInt(newTradeInputs.botScore) >= 35 ? "ROT" : parseInt(newTradeInputs.botScore) > 0 ? "NICHT TRADEN" : "MANUELL") }}>{parseInt(newTradeInputs.botScore) >= 78 ? "GRÜN" : parseInt(newTradeInputs.botScore) >= 55 ? "ORANGE" : parseInt(newTradeInputs.botScore) >= 35 ? "ROT" : parseInt(newTradeInputs.botScore) > 0 ? "NICHT TRADEN" : "MANUELL"}</strong></span>
            </div>
          )}
          {newTradeError && (
            <div style={{ padding: "8px 12px", borderRadius: 8, background: `${C.red}15`, border: `1px solid ${C.red}40`, color: C.red, fontSize: 13, fontWeight: 600, marginTop: 8 }}>
              {newTradeError}
            </div>
          )}
          <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
            <button onClick={handleNewTradeSave} style={{ flex: 1, padding: "10px 20px", borderRadius: 10, border: "none", background: `linear-gradient(135deg, ${C.accent}, ${C.accentLight})`, color: "#fff", fontSize: 14, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
              <Save size={15} /> Trade anlegen
            </button>
            <button onClick={() => setNewTradeModal(false)} style={{ padding: "10px 20px", borderRadius: 10, border: `1px solid ${C.border}`, background: "transparent", color: C.textMuted, fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
              Abbrechen
            </button>
          </div>
        </GlassCard>
      )}

      {/* Bot-Score Import Modal */}
      {importModal && (
        <GlassCard style={{ marginBottom: 20, border: `2px solid ${C.yellow}40` }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
            <Zap size={18} color={C.yellow} />
            <div style={{ fontSize: 15, fontWeight: 700, color: C.text }}>Bot-Score importieren — {tradeList.find(t => t.id === importModal.tradeId)?.symbol}</div>
          </div>
          <div>
            <label style={{ display: "block", fontSize: 12, color: C.textMuted, marginBottom: 6, fontWeight: 600 }}>Telegram Alert einfuegen</label>
            <textarea value={importText} onChange={e => { setImportText(e.target.value); setImportParsed(null); }}
              placeholder="Telegram Bot Alert hier einfuegen..."
              rows={5} style={{ width: "100%", padding: "10px 12px", background: "rgba(10,13,17,0.6)", border: `1px solid ${C.border}`, borderRadius: 10, color: C.text, fontSize: 13, fontFamily: "monospace", outline: "none", boxSizing: "border-box", resize: "vertical" }} />
          </div>
          {importText.trim() && !importParsed && (
            <button onClick={handleImportParse} style={{ marginTop: 10, padding: "8px 16px", borderRadius: 8, border: `1px solid ${C.yellow}40`, background: `${C.yellow}10`, color: C.yellow, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
              Analysieren
            </button>
          )}
          {importParsed && (
            <div style={{ marginTop: 12, padding: "12px 16px", borderRadius: 10, background: `${C.green}08`, border: `1px solid ${C.green}20` }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: C.green, marginBottom: 8 }}>Erkannte Werte:</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, fontSize: 12, color: C.textMuted }}>
                {importParsed.symbol && <span>Symbol: <strong style={{ color: C.text }}>{importParsed.symbol}</strong></span>}
                {importParsed.score && <span>Score: <strong style={{ color: C.text }}>{importParsed.score}</strong></span>}
                {importParsed.setup && <span>Setup: <strong style={{ color: C.text }}>{importParsed.setup}</strong></span>}
                {importParsed.entry && <span>Entry: <strong style={{ color: C.text }}>{importParsed.entry}</strong></span>}
                {importParsed.stop && <span>Stop: <strong style={{ color: C.text }}>{importParsed.stop}</strong></span>}
                {importParsed.target && <span>Ziel: <strong style={{ color: C.text }}>{importParsed.target}</strong></span>}
              </div>
            </div>
          )}
          {importParsed === null && importText.trim() && (
            <div style={{ marginTop: 8, fontSize: 12, color: C.red }}>Text konnte nicht analysiert werden.</div>
          )}
          <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
            {importParsed && (
              <button onClick={handleImportApply} style={{ flex: 1, padding: "10px 20px", borderRadius: 10, border: "none", background: `linear-gradient(135deg, ${C.accent}, ${C.accentLight})`, color: "#fff", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>
                Uebernehmen
              </button>
            )}
            <button onClick={() => { setImportModal(null); setImportText(""); setImportParsed(null); }} style={{ padding: "10px 20px", borderRadius: 10, border: `1px solid ${C.border}`, background: "transparent", color: C.textMuted, fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
              Abbrechen
            </button>
          </div>
        </GlassCard>
      )}

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

      {/* Edit-Modal */}
      {editModal && (
        <GlassCard style={{ marginBottom: 20, border: `2px solid ${C.accent}40` }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
            <Edit3 size={18} color={C.accent} />
            <div style={{ fontSize: 15, fontWeight: 700, color: C.text }}>Trade bearbeiten — {editModal.symbol}</div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr 1fr 1fr", gap: 12 }}>
            <div>
              <label style={{ display: "block", fontSize: 12, color: C.textMuted, marginBottom: 6, fontWeight: 600 }}>Symbol</label>
              <input type="text" value={editInputs.symbol} onChange={e => setEditInputs(p => ({ ...p, symbol: e.target.value }))}
                style={{ width: "100%", padding: "10px 12px", background: "rgba(10,13,17,0.6)", border: `1px solid ${C.border}`, borderRadius: 10, color: C.text, fontSize: 14, fontWeight: 500, outline: "none", boxSizing: "border-box" }} />
            </div>
            <div>
              <label style={{ display: "block", fontSize: 12, color: C.textMuted, marginBottom: 6, fontWeight: 600 }}>Stop-Loss {editInputs.waehrung === "USD" ? "($)" : "(€)"}</label>
              <input type="number" value={editInputs.stopLoss} onChange={e => setEditInputs(p => ({ ...p, stopLoss: e.target.value }))}
                style={{ width: "100%", padding: "10px 12px", background: "rgba(10,13,17,0.6)", border: `1px solid ${C.border}`, borderRadius: 10, color: C.text, fontSize: 14, fontWeight: 500, outline: "none", boxSizing: "border-box" }} />
              {editInputs.waehrung === "USD" && parseFloat(editInputs.stopLoss) > 0 && (
                <div style={{ fontSize: 11, color: C.accent, marginTop: 4, fontWeight: 500 }}>≈ €{(parseFloat(editInputs.stopLoss) * (parseFloat(editInputs.wechselkurs) || 0.93)).toFixed(2)}</div>
              )}
            </div>
            <div>
              <label style={{ display: "block", fontSize: 12, color: C.textMuted, marginBottom: 6, fontWeight: 600 }}>Zielkurs {editInputs.waehrung === "USD" ? "($)" : "(€)"}</label>
              <input type="number" value={editInputs.ziel} onChange={e => setEditInputs(p => ({ ...p, ziel: e.target.value }))}
                style={{ width: "100%", padding: "10px 12px", background: "rgba(10,13,17,0.6)", border: `1px solid ${C.border}`, borderRadius: 10, color: C.text, fontSize: 14, fontWeight: 500, outline: "none", boxSizing: "border-box" }} />
              {editInputs.waehrung === "USD" && parseFloat(editInputs.ziel) > 0 && (
                <div style={{ fontSize: 11, color: C.accent, marginTop: 4, fontWeight: 500 }}>≈ €{(parseFloat(editInputs.ziel) * (parseFloat(editInputs.wechselkurs) || 0.93)).toFixed(2)}</div>
              )}
            </div>
            <div>
              <label style={{ display: "block", fontSize: 12, color: C.textMuted, marginBottom: 6, fontWeight: 600 }}>Waehrung</label>
              <div style={{ display: "flex", gap: 0, borderRadius: 10, overflow: "hidden", border: `1px solid ${C.border}` }}>
                {["EUR", "USD"].map(w => (
                  <button key={w} onClick={() => switchEditCurrency(w)} style={{
                    flex: 1, padding: "10px 0", border: "none", cursor: "pointer", fontSize: 13, fontWeight: 600,
                    background: editInputs.waehrung === w ? `${C.accent}20` : "rgba(10,13,17,0.6)",
                    color: editInputs.waehrung === w ? C.accentLight : C.textDim,
                    borderRight: w === "EUR" ? `1px solid ${C.border}` : "none",
                  }}>{w}</button>
                ))}
              </div>
            </div>
          </div>
          {/* Composite Score */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 12, marginTop: 12 }}>
            <div>
              <label style={{ display: "block", fontSize: 12, color: C.textMuted, marginBottom: 6, fontWeight: 600 }}>Composite Score (optional)</label>
              <input type="number" min="0" max="100" value={editInputs.botScore} onChange={e => setEditInputs(p => ({ ...p, botScore: e.target.value }))} placeholder="0-100"
                style={{ width: "100%", padding: "10px 12px", background: "rgba(10,13,17,0.6)", border: `1px solid ${C.border}`, borderRadius: 10, color: C.text, fontSize: 14, fontWeight: 500, outline: "none", boxSizing: "border-box" }} />
            </div>
          </div>
          {editInputs.waehrung === "USD" && (
            <div style={{ marginTop: 12 }}>
              <label style={{ display: "block", fontSize: 12, color: C.textMuted, marginBottom: 6, fontWeight: 600 }}>Wechselkurs (1$ = x€)</label>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input type="number" value={editInputs.wechselkurs} onChange={e => setEditInputs(p => ({ ...p, wechselkurs: e.target.value }))} placeholder="0.93"
                  style={{ width: isMobile ? "100%" : "200px", padding: "10px 12px", background: "rgba(10,13,17,0.6)", border: `1px solid ${C.border}`, borderRadius: 10, color: C.text, fontSize: 14, fontWeight: 500, outline: "none", boxSizing: "border-box" }} />
                <button onClick={async () => { try { const r = await fetch("https://api.frankfurter.dev/v1/latest?base=USD&symbols=EUR"); const d = await r.json(); if (d?.rates?.EUR) setEditInputs(p => ({ ...p, wechselkurs: String(d.rates.EUR) })); } catch {} }} style={{ padding: "10px 12px", borderRadius: 10, border: `1px solid ${C.accent}40`, background: `${C.accent}10`, color: C.accentLight, fontSize: 12, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}>
                  Live-Kurs
                </button>
              </div>
              <div style={{ fontSize: 11, color: C.accent, marginTop: 6, fontWeight: 500, padding: "6px 10px", borderRadius: 8, background: `${C.accent}08`, border: `1px solid ${C.accent}15`, display: "inline-block" }}>
                Wird beim Speichern automatisch in EUR umgerechnet
              </div>
            </div>
          )}
          {/* Screenshot */}
          <div style={{ marginTop: 14, display: "flex", alignItems: "center", gap: 10 }}>
            <label style={{ padding: "8px 14px", borderRadius: 8, border: `1px dashed ${C.border}`, background: "rgba(10,13,17,0.4)", color: C.textMuted, fontSize: 12, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}>
              <Camera size={14} /> {pendingScreenshot ? pendingScreenshot.name : editModal?.screenshotId ? "Screenshot ersetzen" : "Screenshot hinzufuegen"}
              <input type="file" accept="image/*" style={{ display: "none" }} onChange={e => { if (e.target.files?.[0]) setPendingScreenshot(e.target.files[0]); }} />
            </label>
            {(pendingScreenshot || editModal?.screenshotId) && (
              <button onClick={() => { setPendingScreenshot(null); if (editModal?.screenshotId) setEditModal(m => ({ ...m, screenshotId: null, _removeScreenshot: true })); }} style={{ padding: "4px 8px", borderRadius: 6, border: "none", background: `${C.red}15`, color: C.red, fontSize: 11, fontWeight: 600, cursor: "pointer" }}>Entfernen</button>
            )}
            {editModal?.screenshotId && screenshotUrls[editModal.id] && !pendingScreenshot && (
              <img src={screenshotUrls[editModal.id]} alt="" style={{ width: 40, height: 40, borderRadius: 6, objectFit: "cover", border: `1px solid ${C.border}`, cursor: "pointer" }} onClick={() => setScreenshotViewer(screenshotUrls[editModal.id])} />
            )}
          </div>
          {/* Transaktionen bearbeiten */}
          <div style={{ marginTop: 16, borderTop: `1px solid ${C.border}`, paddingTop: 14 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: C.textMuted, marginBottom: 10 }}>Transaktionen</div>
            {(editInputs.transactions || []).map((tx, idx) => (
              <div key={idx} style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "70px 1fr 1fr 1fr 36px", gap: 8, marginBottom: 8, alignItems: "center" }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: tx.type === "buy" ? C.green : C.red, textTransform: "uppercase" }}>
                  {tx.type === "buy" ? "Kauf" : "Verkauf"}
                </div>
                <div>
                  <input type="date" value={tx.datum || ""} onChange={e => updateEditTx(idx, "datum", e.target.value)}
                    style={{ width: "100%", padding: "8px 10px", background: "rgba(10,13,17,0.6)", border: `1px solid ${C.border}`, borderRadius: 8, color: C.text, fontSize: 13, outline: "none", boxSizing: "border-box", colorScheme: "dark" }} />
                </div>
                <div>
                  <input type="number" value={tx.stueck} onChange={e => updateEditTx(idx, "stueck", e.target.value)} placeholder="St."
                    style={{ width: "100%", padding: "8px 10px", background: "rgba(10,13,17,0.6)", border: `1px solid ${C.border}`, borderRadius: 8, color: C.text, fontSize: 13, outline: "none", boxSizing: "border-box" }} />
                </div>
                <div>
                  <input type="number" step="0.01" value={tx.kurs} onChange={e => updateEditTx(idx, "kurs", e.target.value)} placeholder="Kurs"
                    style={{ width: "100%", padding: "8px 10px", background: "rgba(10,13,17,0.6)", border: `1px solid ${C.border}`, borderRadius: 8, color: C.text, fontSize: 13, outline: "none", boxSizing: "border-box" }} />
                </div>
                <button onClick={() => removeEditTx(idx)} title="Entfernen"
                  style={{ padding: "6px", borderRadius: 6, border: "none", background: `${C.red}15`, color: C.red, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, lineHeight: 1 }}>
                  ×
                </button>
              </div>
            ))}
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <button onClick={() => addEditTx("buy")} style={{ padding: "6px 14px", borderRadius: 8, border: `1px solid ${C.green}40`, background: `${C.green}10`, color: C.green, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                + Kauf
              </button>
              <button onClick={() => addEditTx("sell")} style={{ padding: "6px 14px", borderRadius: 8, border: `1px solid ${C.red}40`, background: `${C.red}10`, color: C.red, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                + Verkauf
              </button>
            </div>
          </div>
          <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
            <button onClick={handleEditSave} style={{ flex: 1, padding: "10px 20px", borderRadius: 10, border: "none", background: `linear-gradient(135deg, ${C.accent}, ${C.accentLight})`, color: "#fff", fontSize: 14, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
              <Save size={15} /> Speichern
            </button>
            <button onClick={() => setEditModal(null)} style={{ padding: "10px 20px", borderRadius: 10, border: `1px solid ${C.border}`, background: "transparent", color: C.textMuted, fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
              Abbrechen
            </button>
          </div>
        </GlassCard>
      )}

      {/* Delete-Bestätigung */}
      {deleteConfirm && (
        <GlassCard style={{ marginBottom: 20, border: `2px solid ${C.red}40`, textAlign: "center", padding: "20px" }}>
          <Trash2 size={28} color={C.red} style={{ marginBottom: 10 }} />
          <div style={{ fontSize: 15, fontWeight: 700, color: C.text, marginBottom: 6 }}>Trade loeschen?</div>
          <div style={{ fontSize: 13, color: C.textMuted, marginBottom: 16 }}>
            {tradeList.find(t => t.id === deleteConfirm)?.symbol} — diese Aktion kann nicht rueckgaengig gemacht werden.
          </div>
          <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
            <button onClick={() => handleDelete(deleteConfirm)} style={{ padding: "10px 24px", borderRadius: 10, border: "none", background: C.red, color: "#fff", fontSize: 14, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}>
              <Trash2 size={14} /> Loeschen
            </button>
            <button onClick={() => setDeleteConfirm(null)} style={{ padding: "10px 20px", borderRadius: 10, border: `1px solid ${C.border}`, background: "transparent", color: C.textMuted, fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
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
                {["", "Datum", "Symbol", "Ø Kauf", "Stop", "Ziel", "Ø Verk.", "Pos.", "Ergebnis", "R", "Aktion"].map(h => (
                  <th key={h} style={{ padding: "14px 12px", textAlign: "left", fontSize: 11, fontWeight: 600, color: C.textDim, textTransform: "uppercase", letterSpacing: "0.05em", background: "rgba(10,13,17,0.5)", whiteSpace: "nowrap" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((t, i) => {
                const cur = "€"; // Alle Trades werden in EUR gespeichert
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
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          {screenshotUrls[t.id] && (
                            <img src={screenshotUrls[t.id]} alt="" onClick={e => { e.stopPropagation(); setScreenshotViewer(screenshotUrls[t.id]); }}
                              style={{ width: 32, height: 32, borderRadius: 6, objectFit: "cover", border: `1px solid ${C.border}`, cursor: "pointer", flexShrink: 0 }} />
                          )}
                          <div>
                            <div>
                              <span style={{ fontWeight: 700, color: C.text, fontSize: 14 }}>{t.symbol}</span>
                              <span style={{ fontSize: 10, color: C.textDim, marginLeft: 6, fontWeight: 600 }}>{t.originalWaehrung === "USD" ? "USD→EUR" : "EUR"}</span>
                            </div>
                            {t.remaining > 0 && (() => {
                              const days = t.holdingDays;
                              const maxDays = 30;
                              const timerColor = days >= 30 ? C.red : days >= 25 ? C.orange : days >= 21 ? C.yellow : C.textDim;
                              const timerBg = days >= 30 ? C.redBg : days >= 25 ? C.orangeBg : days >= 21 ? C.yellowBg : "rgba(90,100,120,0.08)";
                              const timerBorder = days >= 30 ? C.redBorder : days >= 25 ? C.orangeBorder : days >= 21 ? C.yellowBorder : "transparent";
                              const pct = Math.min(100, (days / maxDays) * 100);
                              return (
                                <div style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 3 }}>
                                  <Clock size={10} color={timerColor} />
                                  <div style={{ position: "relative", width: 40, height: 4, borderRadius: 2, background: "rgba(90,100,120,0.15)" }}>
                                    <div style={{ position: "absolute", left: 0, top: 0, height: "100%", width: `${pct}%`, borderRadius: 2, background: timerColor, transition: "width 0.3s" }} />
                                  </div>
                                  <span style={{
                                    fontSize: 10, fontWeight: 700, color: timerColor,
                                    padding: days >= 25 ? "1px 5px" : "0",
                                    borderRadius: 4,
                                    background: days >= 25 ? timerBg : "transparent",
                                    border: days >= 25 ? `1px solid ${timerBorder}` : "none",
                                  }}>
                                    {days >= 30 ? `${days}d!` : `${days}/${maxDays}d`}
                                  </span>
                                </div>
                              );
                            })()}
                          </div>
                        </div>
                      </td>
                      <td style={{ padding: "10px 12px", color: C.text, fontWeight: 500 }}>€{fmt(t.avgKaufkurs)}</td>
                      <td style={{ padding: "10px 12px", color: C.red, fontWeight: 500 }}>€{fmt(t.stopLoss)}</td>
                      <td style={{ padding: "10px 12px", color: C.green, fontWeight: 500 }}>€{fmt(t.ziel)}</td>
                      <td style={{ padding: "10px 12px", color: t.totalSold > 0 ? C.text : C.textDim, fontWeight: 500 }}>{t.totalSold > 0 ? `€${fmt(t.avgVerkaufskurs)}` : "–"}</td>
                      <td style={{ padding: "10px 12px", fontWeight: 600, color: C.textMuted, fontSize: 12 }}>{t.remaining}/{t.totalBought}</td>
                      <td style={{ padding: "10px 12px" }}>
                        <div style={{ fontWeight: 700, color: t.totalSold === 0 ? C.textDim : isWin ? C.green : C.red }}>{t.totalSold > 0 ? `${t.pnl >= 0 ? "+" : ""}${t.pnl.toFixed(0)}€` : "–"}</div>
                        {t.totalGebuehren > 0 && t.totalSold > 0 && <div style={{ fontSize: 10, color: C.textDim, fontWeight: 500 }}>({t.totalGebuehren.toFixed(2)}€ Geb.)</div>}
                      </td>
                      <td style={{ padding: "10px 12px", fontWeight: 700, color: t.totalSold === 0 ? C.textDim : t.rValue >= 0 ? C.green : C.red }}>{t.totalSold > 0 ? `${t.rValue >= 0 ? "+" : ""}${t.rValue.toFixed(1)}R` : "–"}</td>
                      <td style={{ padding: "10px 12px" }} onClick={e => e.stopPropagation()}>
                        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                          {t.remaining > 0 && (
                            <>
                              <button onClick={() => { setTxModal({ tradeId: t.id, type: "sell" }); setTxInputs({ stueckzahl: "", kurs: "", datum: new Date().toISOString().split("T")[0] }); }} style={{ padding: "4px 8px", borderRadius: 6, border: "none", background: `${C.red}20`, color: C.red, fontSize: 11, fontWeight: 600, cursor: "pointer" }}>Teilverkauf</button>
                              <button onClick={() => { setTxModal({ tradeId: t.id, type: "buy" }); setTxInputs({ stueckzahl: "", kurs: "", datum: new Date().toISOString().split("T")[0] }); }} style={{ padding: "4px 8px", borderRadius: 6, border: "none", background: `${C.green}20`, color: C.green, fontSize: 11, fontWeight: 600, cursor: "pointer" }}>Nachkauf</button>
                            </>
                          )}
                          {t.remaining === 0 && (
                            <span style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "4px 8px", borderRadius: 6, fontSize: 11, fontWeight: 600, color: C.textDim, background: "rgba(10,13,17,0.4)" }}>Geschl.</span>
                          )}
                          <button onClick={() => { setImportModal({ tradeId: t.id }); setImportText(""); setImportParsed(null); }} title="Bot importieren" style={{ padding: "4px 6px", borderRadius: 6, border: "none", background: `${C.yellow}12`, color: C.yellow, cursor: "pointer", display: "flex", alignItems: "center" }}>
                            <Zap size={13} />
                          </button>
                          <button onClick={() => openEdit(t)} title="Bearbeiten" style={{ padding: "4px 6px", borderRadius: 6, border: "none", background: `${C.accent}15`, color: C.accentLight, cursor: "pointer", display: "flex", alignItems: "center" }}>
                            <Edit3 size={13} />
                          </button>
                          <button onClick={() => setDeleteConfirm(t.id)} title="Loeschen" style={{ padding: "4px 6px", borderRadius: 6, border: "none", background: `${C.red}10`, color: C.red, cursor: "pointer", display: "flex", alignItems: "center", opacity: 0.6 }}>
                            <Trash2 size={13} />
                          </button>
                        </div>
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

      {/* Screenshot Fullscreen Viewer */}
      {screenshotViewer && (
        <div onClick={() => setScreenshotViewer(null)} style={{
          position: "fixed", inset: 0, zIndex: 9999, background: "rgba(0,0,0,0.85)",
          display: "flex", alignItems: "center", justifyContent: "center", cursor: "zoom-out",
          backdropFilter: "blur(8px)",
        }}>
          <img src={screenshotViewer} alt="Screenshot" style={{ maxWidth: "95vw", maxHeight: "90vh", borderRadius: 12, boxShadow: "0 8px 40px rgba(0,0,0,0.6)" }} />
          <button onClick={() => setScreenshotViewer(null)} style={{
            position: "absolute", top: 20, right: 20, width: 36, height: 36, borderRadius: "50%",
            border: "none", background: "rgba(255,255,255,0.15)", color: "#fff", fontSize: 20,
            cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
          }}>×</button>
        </div>
      )}
    </div>
  );
};

// ════════════════════════════════════════════════════════════════
// ─── SETTINGS PAGE ───
// ════════════════════════════════════════════════════════════════
const SettingsPage = ({ currentStartkapital, onStartkapitalChange }) => {
  const user = getUser();
  const [kapitalInput, setKapitalInput] = useState(String(Math.round(currentStartkapital * 100) / 100));
  const [kapitalSaved, setKapitalSaved] = useState(false);

  return (
    <div style={{ maxWidth: 520, margin: "0 auto" }}>
      {/* User Info */}
      <GlassCard>
        <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "4px 0" }}>
          <div style={{
            width: 44, height: 44, borderRadius: 12,
            background: `linear-gradient(135deg, ${C.accent}, ${C.accentLight})`,
            display: "flex", alignItems: "center", justifyContent: "center",
            boxShadow: `0 4px 12px ${C.accent}30`,
          }}>
            <User size={22} color="#fff" />
          </div>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: C.text }}>{user?.username || "–"}</div>
            <div style={{ fontSize: 12, color: C.textDim }}>Angemeldet via Magic Link</div>
          </div>
        </div>
      </GlassCard>

      {/* Depot-Konfiguration */}
      <GlassCard style={{ marginTop: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
          <DollarSign size={18} color={C.green} />
          <div style={{ fontSize: 15, fontWeight: 700, color: C.text }}>Depot-Konfiguration</div>
        </div>
        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 12, color: C.textMuted, fontWeight: 600, display: "block", marginBottom: 6 }}>Startkapital (EUR)</label>
          <div style={{ display: "flex", gap: 8 }}>
            <input type="number" value={kapitalInput} onChange={e => { setKapitalInput(e.target.value); setKapitalSaved(false); }}
              placeholder="z.B. 45000" step="0.01"
              style={{ flex: 1, padding: "10px 14px", borderRadius: 10, border: `1px solid ${C.border}`, background: C.bg, color: C.text, fontSize: 14, fontWeight: 500, outline: "none" }}
              onFocus={e => e.target.style.borderColor = C.accent} onBlur={e => e.target.style.borderColor = C.border} />
            <button onClick={() => {
              const val = parseFloat(kapitalInput);
              if (val > 0) {
                setStartkapital(val);
                if (onStartkapitalChange) onStartkapitalChange(val);
                setKapitalSaved(true);
                setTimeout(() => setKapitalSaved(false), 2000);
              }
            }} style={{
              padding: "10px 18px", borderRadius: 10, border: "none",
              background: `linear-gradient(135deg, ${C.green}, ${C.green}CC)`,
              color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer",
              display: "flex", alignItems: "center", gap: 6,
            }}>
              <Save size={14} /> Speichern
            </button>
          </div>
          {kapitalSaved && (
            <div style={{ fontSize: 11, color: C.green, marginTop: 6, fontWeight: 500, display: "flex", alignItems: "center", gap: 4 }}>
              <CheckCircle size={10} /> Startkapital gespeichert
            </div>
          )}
          <div style={{ fontSize: 11, color: C.textDim, marginTop: 6 }}>
            Dein persoenliches Startkapital fuer die Portfolio-Berechnung und Position Sizing.
            Jeder User hat sein eigenes Depot — kein Zugriff auf andere Konten.
          </div>
        </div>
      </GlassCard>
    </div>
  );
};

// ════════════════════════════════════════════════════════════════
// ─── MAIN APP ───
// ════════════════════════════════════════════════════════════════
const PROXY_BASE = "https://ncapital-market-proxy.nils-noeller.workers.dev";

export default function TradingJournal() {
  const [authed, setAuthed] = useState(isAuthenticated());
  const [page, setPage] = useState("briefing");
  const [tradeList, setTradeList] = useState(loadTrades);
  const [startkapital, setStartkapitalState] = useState(getStartkapital);
  const [menuOpen, setMenuOpen] = useState(false);
  const [isOffline, setIsOffline] = useState(typeof navigator !== "undefined" && !navigator.onLine);
  const [calendarEvents, setCalendarEvents] = useState([]);
  const [seasonalData, setSeasonalData] = useState(null);
  const [showKapital, setShowKapital] = useState(false);
  const ww = useWindowWidth();
  const isMobile = ww < 768;

  const handleLogout = useCallback(() => { authLogout(); setAuthed(false); }, []);
  const handleLogin = useCallback(() => {
    setAuthed(true);
    // Trades und Startkapital fuer den neuen User laden
    setTradeList(loadTrades());
    setStartkapitalState(getStartkapital());
  }, []);

  // Magic Link Token Detection — check URL params on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const magicToken = params.get("magic_token");
    if (magicToken) {
      // Clean URL immediately (remove token from address bar)
      const url = new URL(window.location);
      url.searchParams.delete("magic_token");
      window.history.replaceState({}, "", url.pathname + url.search || url.pathname);
      // Verify token with backend
      verifyMagicToken(magicToken)
        .then(() => {
          setAuthed(true);
          setTradeList(loadTrades());
          setStartkapitalState(getStartkapital());
        })
        .catch((err) => {
          console.error("Magic link verification failed:", err);
          // Login page will be shown since authed is still false
        });
    }
  }, []);

  // Listen for auth errors (401) from authFetch
  useEffect(() => {
    const onAuthError = () => { setAuthed(false); };
    window.addEventListener("ncapital-auth-error", onAuthError);
    return () => window.removeEventListener("ncapital-auth-error", onAuthError);
  }, []);

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

  // Fetch calendar events + seasonal data for sidebar widgets
  useEffect(() => {
    if (!authed) return;
    const extractSidebar = (src) => {
      const seasonal = src?.morning?.seasonalContext || src?.afternoon?.seasonalContext || null;
      const events = seasonal?.upcomingEvents || [];
      setCalendarEvents(events.filter(e => e.impact === "high" || e.impact === "medium").slice(0, 3));
      if (seasonal) setSeasonalData(seasonal);
    };
    (async () => {
      try {
        const cached = localStorage.getItem("ncapital-briefing-cache");
        if (cached) {
          const { data } = JSON.parse(cached);
          extractSidebar(data);
          if (data?.morning?.seasonalContext || data?.afternoon?.seasonalContext) return;
        }
        const res = await authFetch(`${PROXY_BASE}/api/briefing/latest`);
        if (res.ok) {
          const json = await res.json();
          extractSidebar(json);
        }
      } catch {}
    })();
  }, [authed]);

  const portfolio = useMemo(() => {
    const p = computePortfolio(tradeList, startkapital);
    p.startkapitalExplicit = hasExplicitStartkapital();
    return p;
  }, [tradeList, startkapital]);

  const addTrade = useCallback((trade) => {
    setTradeList(prev => [...prev, trade]);
  }, []);

  const updateTrade = useCallback((id, updaterFn) => {
    setTradeList(prev => prev.map(t => t.id === id ? updaterFn(t) : t));
  }, []);

  const deleteTrade = useCallback((id) => {
    setTradeList(prev => prev.filter(t => t.id !== id));
  }, []);

  const navigate = useCallback((p) => {
    setPage(p);
    setMenuOpen(false);
  }, []);

  // Auth Guard — AFTER all hooks (React rules of hooks)
  if (!authed) return <LoginPage onLogin={handleLogin} />;

  const pages = {
    briefing: { label: "Briefing", icon: Newspaper, sub: "Taegliches Markt-Briefing" },
    watchlist: { label: "Screener", icon: Activity, sub: "Scanner fuer Swing- & Intraday-Setups" },
    check: { label: "Trade Check", icon: Calculator, sub: "Bewerte neue Trade-Setups" },
    trades: { label: "Trade Log", icon: BookOpen, sub: "Alle Trades im Detail" },
    dashboard: { label: "Dashboard", icon: LayoutDashboard, sub: "Übersicht deiner Performance" },
  };

  const settingsPageMeta = { label: "Einstellungen", sub: "Konto & Passwort verwalten" };

  const renderPage = () => {
    switch (page) {
      case "briefing": return <Briefing onNavigate={navigate} portfolio={portfolio} />;
      case "check": return <TradeCheck portfolio={portfolio} tradeList={tradeList} onAddTrade={addTrade} onUpdateTrade={updateTrade} onNavigate={navigate} />;
      case "trades": return <TradeLog tradeList={tradeList} onUpdateTrade={updateTrade} onDeleteTrade={deleteTrade} onAddTrade={addTrade} />;
      case "dashboard": return <Dashboard portfolio={portfolio} />;
      case "watchlist": return <Watchlist onNavigate={navigate} />;
      case "settings": return <SettingsPage currentStartkapital={startkapital} onStartkapitalChange={v => setStartkapitalState(v)} />;
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
        @supports (padding-top: env(safe-area-inset-top)) {
          .nc-safe-header { padding-top: calc(env(safe-area-inset-top) + 14px) !important; }
          .nc-safe-menu { padding-top: calc(env(safe-area-inset-top) + 24px) !important; }
        }
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
          <div style={{ marginTop: "auto" }}>
            {/* Saisonale Einordnung Widget */}
            {seasonalData && (() => {
              const sp = typeof seasonalData.monthPattern?.sp500Avg === "string" ? parseFloat(seasonalData.monthPattern.sp500Avg) : seasonalData.monthPattern?.sp500Avg;
              const dx = typeof seasonalData.monthPattern?.daxAvg === "string" ? parseFloat(seasonalData.monthPattern.daxAvg) : seasonalData.monthPattern?.daxAvg;
              const spC = sp > 0.5 ? C.green : sp < -0.2 ? C.red : C.yellow;
              const dxC = dx > 0.5 ? C.green : dx < -0.2 ? C.red : C.yellow;
              return (
                <div onClick={() => setPage("briefing")} style={{ padding: "10px 12px", borderRadius: 12, background: `${C.accent}08`, border: `1px solid ${C.accent}15`, marginBottom: 10, cursor: "pointer" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                    <Calendar size={13} color={C.accent} />
                    <span style={{ fontSize: 10, fontWeight: 700, color: C.accent, textTransform: "uppercase", letterSpacing: "0.05em" }}>Saisonalität</span>
                    <span style={{ fontSize: 10, color: C.textDim, marginLeft: "auto" }}>{seasonalData.monthName}</span>
                  </div>
                  <div style={{ display: "flex", gap: 12, marginBottom: 4 }}>
                    <div>
                      <span style={{ fontSize: 9, color: C.textDim }}>S&P </span>
                      <span style={{ fontSize: 12, fontWeight: 700, color: spC, fontFamily: "monospace" }}>{sp > 0 ? "+" : ""}{typeof sp === "number" ? sp.toFixed(1) : sp}%</span>
                    </div>
                    <div>
                      <span style={{ fontSize: 9, color: C.textDim }}>DAX </span>
                      <span style={{ fontSize: 12, fontWeight: 700, color: dxC, fontFamily: "monospace" }}>{dx > 0 ? "+" : ""}{typeof dx === "number" ? dx.toFixed(1) : dx}%</span>
                    </div>
                  </div>
                  {seasonalData.presidentialCycle && (
                    <div style={{ fontSize: 10, color: C.textMuted, lineHeight: 1.4 }}>
                      <span style={{ color: C.accentLight, fontWeight: 600 }}>{seasonalData.presidentialCycle.name}</span>
                      <span style={{ color: C.textDim }}> · Jahr {seasonalData.presidentialCycle.year}/4</span>
                    </div>
                  )}
                </div>
              );
            })()}
            {/* Wirtschaftskalender Widget */}
            {calendarEvents.length > 0 && (
              <div onClick={() => setPage("briefing")} style={{ padding: "10px 12px", borderRadius: 12, background: `${C.orange}08`, border: `1px solid ${C.orange}15`, marginBottom: 10, cursor: "pointer" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                  <Calendar size={13} color={C.orange} />
                  <span style={{ fontSize: 10, fontWeight: 700, color: C.orange, textTransform: "uppercase", letterSpacing: "0.05em" }}>Kalender</span>
                </div>
                {calendarEvents.map((ev, i) => {
                  const iColor = ev.impact === "high" ? C.red : C.orange;
                  return (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: i < calendarEvents.length - 1 ? 4 : 0 }}>
                      <span style={{ fontSize: 10, fontWeight: 700, color: ev.daysUntil <= 1 ? C.accent : C.textMuted, minWidth: 30 }}>{ev.day}.{ev.month}.</span>
                      <span style={{ fontSize: 10, color: C.text, fontWeight: 500, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ev.name}</span>
                      <span style={{ fontSize: 8, fontWeight: 700, color: iColor, background: `${iColor}20`, borderRadius: 3, padding: "1px 4px" }}>{ev.impact === "high" ? "H" : "M"}</span>
                    </div>
                  );
                })}
              </div>
            )}
            {/* Depot Box — ROI only, toggle for EUR value */}
            <div style={{ padding: "16px 12px", borderRadius: 12, background: `${C.accent}08`, border: `1px solid ${C.accent}15`, marginBottom: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                <div style={{ fontSize: 11, color: C.textDim }}>Depot</div>
                <button onClick={(e) => { e.stopPropagation(); setShowKapital(s => !s); }} style={{ background: "none", border: "none", cursor: "pointer", color: C.textDim, padding: 2, display: "flex" }}>
                  {showKapital ? <EyeOff size={13} /> : <Eye size={13} />}
                </button>
              </div>
              {showKapital && <div style={{ fontSize: 20, fontWeight: 800, color: C.accentLight }}>{fmtEur(portfolio.kapital)}</div>}
              <div style={{ fontSize: showKapital ? 11 : 20, color: portfolio.roiPct >= 0 ? C.green : C.red, fontWeight: showKapital ? 600 : 800, marginTop: showKapital ? 2 : 0 }}>{portfolio.roiPct >= 0 ? "+" : ""}{portfolio.roiPct.toFixed(1)}% ROI</div>
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <button onClick={() => setPage("settings")} style={{
                display: "flex", alignItems: "center", justifyContent: "center", flex: 1, padding: "9px 0",
                border: "none", borderRadius: 10, background: page === "settings" ? `${C.accent}18` : "transparent", color: page === "settings" ? C.accentLight : C.textDim,
                cursor: "pointer", transition: "all 0.2s",
              }} onMouseEnter={e => { if (page !== "settings") { e.currentTarget.style.background = `${C.accent}10`; e.currentTarget.style.color = C.accentLight; }}}
                 onMouseLeave={e => { if (page !== "settings") { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = C.textDim; }}}>
                <SettingsIcon size={16} />
              </button>
              <button onClick={handleLogout} style={{
                display: "flex", alignItems: "center", justifyContent: "center", flex: 1, padding: "9px 0",
                border: "none", borderRadius: 10, background: "transparent", color: C.textDim,
                cursor: "pointer", transition: "all 0.2s",
              }} onMouseEnter={e => { e.currentTarget.style.background = `${C.red}12`; e.currentTarget.style.color = C.red; }}
                 onMouseLeave={e => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = C.textDim; }}>
                <LogOut size={16} />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Mobile Menu Overlay */}
      {isMobile && menuOpen && (
        <div style={{ position: "fixed", inset: 0, zIndex: 100, background: "rgba(0,0,0,0.6)", backdropFilter: "blur(8px)" }} onClick={() => setMenuOpen(false)}>
          <div onClick={e => e.stopPropagation()} className="nc-safe-menu" style={{ width: 260, height: "100%", background: "linear-gradient(180deg, rgba(20,24,32,0.99), rgba(11,14,17,0.99))", padding: "24px 16px", display: "flex", flexDirection: "column" }}>
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
            <div style={{ marginTop: "auto" }}>
              <div style={{ padding: "16px 12px", borderRadius: 12, background: `${C.accent}08`, border: `1px solid ${C.accent}15`, marginBottom: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                  <div style={{ fontSize: 11, color: C.textDim }}>Depot</div>
                  <button onClick={(e) => { e.stopPropagation(); setShowKapital(s => !s); }} style={{ background: "none", border: "none", cursor: "pointer", color: C.textDim, padding: 2, display: "flex" }}>
                    {showKapital ? <EyeOff size={13} /> : <Eye size={13} />}
                  </button>
                </div>
                {showKapital && <div style={{ fontSize: 20, fontWeight: 800, color: C.accentLight }}>{fmtEur(portfolio.kapital)}</div>}
                <div style={{ fontSize: showKapital ? 11 : 20, color: portfolio.roiPct >= 0 ? C.green : C.red, fontWeight: showKapital ? 600 : 800, marginTop: showKapital ? 2 : 0 }}>{portfolio.roiPct >= 0 ? "+" : ""}{portfolio.roiPct.toFixed(1)}% ROI</div>
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <button onClick={() => navigate("settings")} style={{
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 6, flex: 1, padding: "9px 0",
                  border: "none", borderRadius: 10, background: page === "settings" ? `${C.accent}18` : `${C.accent}08`,
                  color: page === "settings" ? C.accentLight : C.textDim, fontSize: 12, fontWeight: 500, cursor: "pointer",
                }}>
                  <SettingsIcon size={15} />
                </button>
                <button onClick={handleLogout} style={{
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 6, flex: 1, padding: "9px 0",
                  border: "none", borderRadius: 10, background: `${C.red}12`, color: C.red,
                  fontSize: 12, fontWeight: 500, cursor: "pointer",
                }}>
                  <LogOut size={15} />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Main */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        <div className={isMobile ? "nc-safe-header" : ""} style={{ padding: isMobile ? "14px 16px" : "18px 32px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", justifyContent: "space-between", background: "rgba(20,24,32,0.6)", backdropFilter: "blur(20px)", position: "sticky", top: 0, zIndex: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            {isMobile && (
              <button onClick={() => setMenuOpen(true)} style={{ background: "none", border: "none", color: C.textMuted, cursor: "pointer", padding: 4 }}>
                <Menu size={22} />
              </button>
            )}
            <div>
              <div style={{ fontSize: isMobile ? 18 : 20, fontWeight: 800, color: C.text, letterSpacing: "-0.02em" }}>{(pages[page] || settingsPageMeta).label}</div>
              {!isMobile && <div style={{ fontSize: 12, color: C.textDim, marginTop: 2 }}>{(pages[page] || settingsPageMeta).sub}</div>}
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
