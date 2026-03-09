// ─── Briefing Component ───
// Taeglich automatisierte Markt-Briefings: Morning (08:30, DAX/EU) und Afternoon (15:00, US)

import React, { useState, useEffect, useCallback } from "react";
import { RefreshCw, Sun, Moon, TrendingUp, TrendingDown, Minus, AlertTriangle, BarChart3, Target, Clock } from "lucide-react";
import { authFetch } from "../services/auth.js";

const PROXY_BASE = "https://ncapital-market-proxy.nils-noeller.workers.dev";

// ── Colors (gleich wie TradingJournal / Watchlist) ──
const C = {
  bg: "#0B0E11", card: "#141820", cardHover: "#1A1F2B",
  border: "#1E2433", borderLight: "#2A3144",
  text: "#E8ECF1", textMuted: "#8892A4", textDim: "#5A6478",
  accent: "#6C5CE7", accentLight: "#A29BFE",
  green: "#00D68F", red: "#FF6B6B", yellow: "#FDCB6E", orange: "#FFA502", blue: "#74B9FF",
};

function GlassCard({ children, style }) {
  return (
    <div style={{ background: C.card, borderRadius: 16, padding: 20, border: `1px solid ${C.border}`, ...style }}>
      {children}
    </div>
  );
}

function SignalBadge({ signal, size = "normal" }) {
  const colorMap = {
    GIER: C.green, NEUTRAL: C.yellow, VORSICHT: C.orange, RISIKO: C.red,
    "RISK-ON": C.green, "RISK-OFF": C.red, EXPANSIV: C.green, RESTRIKTIV: C.red,
    "INFLATIONAER": C.red, "DEFLATIONAER": C.blue, INFO: C.blue,
  };
  const color = colorMap[signal] || C.textMuted;
  const bg = `${color}20`;
  const fontSize = size === "small" ? 10 : 12;
  return (
    <span style={{ fontSize, fontWeight: 700, color, background: bg, borderRadius: 6, padding: "2px 8px", display: "inline-block", textTransform: "uppercase", letterSpacing: 0.5 }}>
      {signal}
    </span>
  );
}

function ScoreBadge({ score, size = "normal" }) {
  const color = score >= 70 ? C.green : score >= 50 ? C.yellow : score >= 30 ? C.orange : C.textDim;
  const bg = score >= 70 ? `${C.green}15` : score >= 50 ? `${C.yellow}15` : score >= 30 ? `${C.orange}15` : "rgba(10,13,17,0.4)";
  const fontSize = size === "small" ? 11 : 14;
  const padding = size === "small" ? "2px 6px" : "4px 10px";
  return (
    <span style={{ fontSize, fontWeight: 700, color, background: bg, borderRadius: 6, padding, display: "inline-block", minWidth: 28, textAlign: "center" }}>
      {score}
    </span>
  );
}

function ChangeDisplay({ change, style }) {
  if (change == null || isNaN(change)) return <span style={{ color: C.textDim, ...style }}>-</span>;
  const color = change > 0.1 ? C.green : change < -0.1 ? C.red : C.textMuted;
  return <span style={{ color, fontWeight: 600, fontFamily: "monospace", ...style }}>{change > 0 ? "+" : ""}{change.toFixed(2)}%</span>;
}

function TrendIcon({ change }) {
  if (change > 0.1) return <TrendingUp size={14} color={C.green} />;
  if (change < -0.1) return <TrendingDown size={14} color={C.red} />;
  return <Minus size={14} color={C.textMuted} />;
}

// ─── Main Briefing Component ───

export default function Briefing({ onNavigate }) {
  const [data, setData] = useState(null);
  const [taPicks, setTaPicks] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const isMobile = typeof window !== "undefined" && window.innerWidth < 600;

  // Auto-select tab based on time: before 14:00 CET → morning, after → afternoon
  const getDefaultTab = () => {
    try {
      const cetHour = parseInt(new Intl.DateTimeFormat("en-US", { hour: "numeric", hour12: false, timeZone: "Europe/Berlin" }).format(new Date()));
      return cetHour >= 14 ? "afternoon" : "morning";
    } catch { return "morning"; }
  };
  const [activeTab, setActiveTab] = useState(getDefaultTab);

  const fetchBriefing = useCallback(async (force = false) => {
    try {
      if (force) setRefreshing(true);
      else setLoading(true);
      setError(null);

      // Check localStorage cache first (5 min freshness)
      if (!force) {
        try {
          const cached = localStorage.getItem("ncapital-briefing-cache");
          if (cached) {
            const { data: cachedData, ts } = JSON.parse(cached);
            if (Date.now() - ts < 5 * 60 * 1000) {
              setData(cachedData);
              setLoading(false);
              return;
            }
          }
        } catch {}
      }

      const [res, taRes] = await Promise.all([
        authFetch(`${PROXY_BASE}/api/briefing/latest`),
        authFetch(`${PROXY_BASE}/api/scan/ta-picks`).catch(() => null),
      ]);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setData(json);
      localStorage.setItem("ncapital-briefing-cache", JSON.stringify({ data: json, ts: Date.now() }));
      if (taRes?.ok) {
        const taJson = await taRes.json();
        setTaPicks(taJson);
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { fetchBriefing(); }, [fetchBriefing]);

  const briefing = data?.[activeTab];

  // ─── Loading / Error ───
  if (loading) {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: 400, gap: 16 }}>
        <RefreshCw size={32} color={C.accent} style={{ animation: "spin 1s linear infinite" }} />
        <span style={{ color: C.textMuted, fontSize: 14 }}>Briefing wird geladen...</span>
        <style>{`@keyframes spin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }`}</style>
      </div>
    );
  }

  if (error) {
    return (
      <GlassCard style={{ textAlign: "center", padding: 40 }}>
        <AlertTriangle size={32} color={C.orange} />
        <p style={{ color: C.text, marginTop: 12 }}>Fehler beim Laden: {error}</p>
        <button onClick={() => fetchBriefing(true)} style={{ marginTop: 12, padding: "8px 20px", background: C.accent, color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontSize: 14 }}>
          Erneut versuchen
        </button>
      </GlassCard>
    );
  }

  const fmtTime = (iso) => {
    if (!iso) return "-";
    try { return new Date(iso).toLocaleString("de-DE", { timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }); }
    catch { return iso.slice(0, 16).replace("T", " "); }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* ── Header ── */}
      <GlassCard style={{ padding: isMobile ? "16px" : "20px 24px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ fontSize: 28 }}>{activeTab === "morning" ? "\u2600\uFE0F" : "\uD83C\uDF19"}</span>
            <div>
              <h2 style={{ margin: 0, color: C.text, fontSize: isMobile ? 18 : 22, fontWeight: 700 }}>
                {activeTab === "morning" ? "Morning Briefing" : "Afternoon Briefing"}
              </h2>
              <span style={{ color: C.textMuted, fontSize: 12 }}>
                {activeTab === "morning" ? "08:30 \u2022 DAX & Europa" : "15:00 \u2022 Wall Street & US"}
                {briefing ? ` \u2022 Erstellt: ${fmtTime(briefing.generatedAt)}` : ""}
              </span>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {/* Tab Toggle */}
            <div style={{ display: "flex", background: C.bg, borderRadius: 10, padding: 3, border: `1px solid ${C.border}` }}>
              {["morning", "afternoon"].map(tab => (
                <button key={tab} onClick={() => setActiveTab(tab)} style={{
                  padding: "6px 14px", borderRadius: 8, border: "none", cursor: "pointer", fontSize: 13, fontWeight: 600, transition: "all .2s",
                  background: activeTab === tab ? C.accent : "transparent",
                  color: activeTab === tab ? "#fff" : C.textMuted,
                }}>
                  {tab === "morning" ? <Sun size={14} style={{ marginRight: 4, verticalAlign: -2 }} /> : <Moon size={14} style={{ marginRight: 4, verticalAlign: -2 }} />}
                  {tab === "morning" ? "Morning" : "Afternoon"}
                </button>
              ))}
            </div>
            <button onClick={() => fetchBriefing(true)} disabled={refreshing} style={{
              display: "flex", alignItems: "center", gap: 6, padding: "6px 14px", background: `${C.accent}20`, color: C.accent, border: `1px solid ${C.accent}40`,
              borderRadius: 8, cursor: refreshing ? "wait" : "pointer", fontSize: 13, fontWeight: 600,
            }}>
              <RefreshCw size={14} style={refreshing ? { animation: "spin 1s linear infinite" } : {}} /> Refresh
            </button>
          </div>
        </div>
      </GlassCard>

      {!briefing ? (
        <GlassCard style={{ textAlign: "center", padding: 40 }}>
          <Clock size={32} color={C.textMuted} />
          <p style={{ color: C.textMuted, marginTop: 12 }}>
            {activeTab === "morning" ? "Morning Briefing wird ab 08:30 Uhr generiert." : "Afternoon Briefing wird ab 15:00 Uhr generiert."}
          </p>
        </GlassCard>
      ) : (
        <>
          {/* ── Pre-Market Futures (oben) ── */}
          {briefing.futures && (
            <FuturesSection futures={briefing.futures} isMobile={isMobile} />
          )}

          {/* ── Indizes (S&P 500, DAX etc.) ── */}
          <IndicesSection macro={briefing.macroOverview} isMobile={isMobile} />

          {/* ── Intermarket-Signale ── */}
          <IntermarketSection signals={briefing.intermarketSignals} isMobile={isMobile} />

          {/* ── Market News ── */}
          {briefing.news?.items?.length > 0 && (
            <NewsSection news={briefing.news} isMobile={isMobile} />
          )}

          {/* ── TA Scanner Picks (Composite Score LONG) ── */}
          {taPicks?.picks?.length > 0 && (
            <TAPicksSection picks={taPicks.picks} stats={taPicks.stats} isMobile={isMobile} onNavigate={onNavigate} newsSentiment={briefing?.news?.symbolSentiment} />
          )}

          {/* ── ATR-based Daily Movers (>= 3x ATR) ── */}
          {taPicks?.movers?.length > 0 && (
            <MoversSection movers={taPicks.movers} isMobile={isMobile} onNavigate={onNavigate} />
          )}

          {/* ── Uebrige Makro-Daten (VIX, Anleihen, Rohstoffe, Krypto, Waehrungen) ── */}
          <MacroRemainingSection macro={briefing.macroOverview} vixHistory={briefing.vixHistory} isMobile={isMobile} />
        </>
      )}

      <style>{`@keyframes spin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }`}</style>
    </div>
  );
}

// ─── Macro Section ───
// VIX classification helper
function getVixLevel(price) {
  if (price < 12) return { label: "Sehr niedrig", color: C.green, desc: "Extreme Sorglosigkeit, oft vor Korrekturen" };
  if (price < 16) return { label: "Niedrig", color: C.green, desc: "Ruhiger Markt, geringes Absicherungsbedürfnis" };
  if (price < 20) return { label: "Normal", color: C.yellow, desc: "Markt im Gleichgewicht, moderate Schwankungen" };
  if (price < 25) return { label: "Erhöht", color: C.orange, desc: "Steigende Unsicherheit, Absicherung nimmt zu" };
  if (price < 30) return { label: "Hoch", color: C.orange, desc: "Deutliche Angst im Markt, erhöhte Volatilitaet" };
  if (price < 40) return { label: "Sehr hoch", color: C.red, desc: "Panik-Modus, starke Schwankungen erwartet" };
  return { label: "Extrem", color: C.red, desc: "Crash-Niveau, historisch seltene Extremwerte" };
}

const VIX_SCALE = [
  { max: 12, label: "<12 Sehr niedrig", color: C.green },
  { max: 16, label: "12-16 Niedrig", color: C.green },
  { max: 20, label: "16-20 Normal", color: C.yellow },
  { max: 25, label: "20-25 Erhöht", color: C.orange },
  { max: 30, label: "25-30 Hoch", color: C.orange },
  { max: 40, label: "30-40 Sehr hoch", color: C.red },
  { max: 100, label: ">40 Extrem", color: C.red },
];

function VixTooltip({ price, vixHistory, isMobile }) {
  const [show, setShow] = useState(false);
  const level = getVixLevel(price);

  return (
    <div
      style={{ position: "relative", display: "inline-block" }}
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
      onClick={() => setShow(s => !s)}
    >
      <span style={{
        fontSize: 10, fontWeight: 700, color: level.color, background: `${level.color}20`,
        borderRadius: 4, padding: "1px 6px", cursor: "pointer", borderBottom: `1px dashed ${level.color}60`,
      }}>
        {level.label}
      </span>

      {show && (
        <div style={{
          position: "absolute", top: "100%", left: isMobile ? -60 : 0, zIndex: 100, marginTop: 6,
          background: C.card, border: `1px solid ${C.borderLight}`, borderRadius: 12, padding: 14,
          width: isMobile ? 280 : 300, boxShadow: "0 8px 32px rgba(0,0,0,0.6)",
        }}>
          {/* Current classification */}
          <div style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: level.color, marginBottom: 4 }}>
              VIX {price?.toFixed(2)} — {level.label}
            </div>
            <div style={{ fontSize: 11, color: C.textMuted, lineHeight: 1.5 }}>{level.desc}</div>
          </div>

          {/* Scale */}
          <div style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 10, fontWeight: 600, color: C.textMuted, textTransform: "uppercase", marginBottom: 6 }}>Einordnung</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
              {VIX_SCALE.map((s, i) => {
                const active = (i === 0 && price < s.max) ||
                  (i > 0 && price >= VIX_SCALE[i - 1].max && price < s.max) ||
                  (i === VIX_SCALE.length - 1 && price >= VIX_SCALE[i - 1].max);
                return (
                  <div key={i} style={{
                    display: "flex", alignItems: "center", gap: 6, padding: "2px 6px", borderRadius: 4,
                    background: active ? `${s.color}20` : "transparent",
                    border: active ? `1px solid ${s.color}40` : "1px solid transparent",
                  }}>
                    <div style={{ width: 8, height: 8, borderRadius: 2, background: s.color, opacity: active ? 1 : 0.4 }} />
                    <span style={{ fontSize: 11, color: active ? s.color : C.textDim, fontWeight: active ? 700 : 400 }}>
                      {s.label}
                    </span>
                    {active && <span style={{ fontSize: 10, color: s.color, marginLeft: "auto" }}>{"\u25C0"}</span>}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Historical comparison */}
          {vixHistory && (
            <div>
              <div style={{ fontSize: 10, fontWeight: 600, color: C.textMuted, textTransform: "uppercase", marginBottom: 6 }}>Historischer Vergleich</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6 }}>
                {[
                  { label: "1 Woche", val: vixHistory.week?.close, chg: vixHistory.week?.change, avg: vixHistory.week?.avg },
                  { label: "1 Monat", val: vixHistory.month?.close, chg: vixHistory.month?.change, avg: vixHistory.month?.avg },
                  { label: "YTD", val: vixHistory.ytd?.open, chg: vixHistory.ytd?.change, avg: vixHistory.ytd?.avg },
                ].map((h, i) => (
                  <div key={i} style={{ background: C.bg, borderRadius: 8, padding: "6px 8px", textAlign: "center" }}>
                    <div style={{ fontSize: 10, color: C.textDim, marginBottom: 3 }}>{h.label}</div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: h.chg > 0 ? C.red : C.green, fontFamily: "monospace" }}>
                      {h.chg != null ? `${h.chg > 0 ? "+" : ""}${h.chg.toFixed(1)}%` : "-"}
                    </div>
                    {h.avg != null && (
                      <div style={{ fontSize: 10, color: C.textDim, marginTop: 2 }}>
                        {"\u00D8"} {h.avg.toFixed(1)}
                      </div>
                    )}
                  </div>
                ))}
              </div>
              {vixHistory.ytd && (
                <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, fontSize: 10, color: C.textDim }}>
                  <span>YTD Low: <span style={{ color: C.green, fontWeight: 600 }}>{vixHistory.ytd.low?.toFixed(1)}</span></span>
                  <span>YTD High: <span style={{ color: C.red, fontWeight: 600 }}>{vixHistory.ytd.high?.toFixed(1)}</span></span>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// 52-Week Range Tooltip for all macro values
function RangeTooltip({ item, isMobile }) {
  const [show, setShow] = useState(false);
  const w52 = item.w52;
  if (!w52) return null;

  const pos = Math.max(0, Math.min(100, w52.rangePosition || 0));
  // Color based on position: near low = red, near high = green (inverted for VIX)
  const isVix = item.symbol === "^VIX";
  const posColor = isVix
    ? (pos > 75 ? C.red : pos > 50 ? C.orange : pos > 25 ? C.yellow : C.green)
    : (pos > 75 ? C.green : pos > 50 ? C.yellow : pos > 25 ? C.orange : C.red);

  const fmtPrice = (p) => {
    if (p == null) return "-";
    return p.toLocaleString("de-DE", { maximumFractionDigits: p > 100 ? 0 : p > 10 ? 1 : 2 });
  };

  return (
    <div
      style={{ position: "relative", display: "inline-flex", alignItems: "center", gap: 4, cursor: "pointer" }}
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
      onClick={() => setShow(s => !s)}
    >
      {/* Mini range bar always visible */}
      <div style={{ width: 40, height: 4, background: C.border, borderRadius: 2, position: "relative" }}>
        <div style={{ position: "absolute", left: `${pos}%`, top: -1, width: 5, height: 6, background: posColor, borderRadius: 1, transform: "translateX(-50%)" }} />
      </div>
      <span style={{ fontSize: 9, color: C.textDim }}>{pos}%</span>

      {show && (
        <div style={{
          position: "absolute", top: "100%", left: isMobile ? -80 : -20, zIndex: 100, marginTop: 6,
          background: C.card, border: `1px solid ${C.borderLight}`, borderRadius: 12, padding: 14,
          width: isMobile ? 250 : 270, boxShadow: "0 8px 32px rgba(0,0,0,0.6)",
        }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.text, marginBottom: 10 }}>
            {item.name} — 52W Range
          </div>

          {/* Visual range bar */}
          <div style={{ marginBottom: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
              <span style={{ fontSize: 10, color: C.red, fontWeight: 600 }}>Low {fmtPrice(w52.low)}</span>
              <span style={{ fontSize: 10, color: C.green, fontWeight: 600 }}>High {fmtPrice(w52.high)}</span>
            </div>
            <div style={{ height: 10, background: C.bg, borderRadius: 5, position: "relative", border: `1px solid ${C.border}` }}>
              {/* Gradient bar */}
              <div style={{
                position: "absolute", inset: 1, borderRadius: 4,
                background: `linear-gradient(to right, ${C.red}60, ${C.yellow}60, ${C.green}60)`,
              }} />
              {/* Current price marker */}
              <div style={{
                position: "absolute", left: `${pos}%`, top: -3, width: 4, height: 16,
                background: C.text, borderRadius: 2, transform: "translateX(-50%)",
                boxShadow: "0 0 6px rgba(255,255,255,0.4)",
              }} />
            </div>
            <div style={{ textAlign: "center", marginTop: 4 }}>
              <span style={{ fontSize: 11, color: posColor, fontWeight: 700 }}>
                Aktuell: {fmtPrice(item.price)} ({pos}% der Range)
              </span>
            </div>
          </div>

          {/* Stats grid */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
            <div style={{ background: C.bg, borderRadius: 8, padding: "6px 8px" }}>
              <div style={{ fontSize: 10, color: C.textDim }}>Abstand 52W-High</div>
              <div style={{ fontSize: 12, fontWeight: 700, color: w52.pctFromHigh < -10 ? C.red : w52.pctFromHigh < -3 ? C.orange : C.green, fontFamily: "monospace" }}>
                {w52.pctFromHigh != null ? `${w52.pctFromHigh > 0 ? "+" : ""}${w52.pctFromHigh.toFixed(1)}%` : "-"}
              </div>
            </div>
            <div style={{ background: C.bg, borderRadius: 8, padding: "6px 8px" }}>
              <div style={{ fontSize: 10, color: C.textDim }}>Abstand 52W-Low</div>
              <div style={{ fontSize: 12, fontWeight: 700, color: C.green, fontFamily: "monospace" }}>
                {w52.pctFromLow != null ? `+${w52.pctFromLow.toFixed(1)}%` : "-"}
              </div>
            </div>
            <div style={{ background: C.bg, borderRadius: 8, padding: "6px 8px" }}>
              <div style={{ fontSize: 10, color: C.textDim }}>{"\u00D8"} 52W</div>
              <div style={{ fontSize: 12, fontWeight: 600, color: C.text, fontFamily: "monospace" }}>{fmtPrice(w52.avg)}</div>
            </div>
            <div style={{ background: C.bg, borderRadius: 8, padding: "6px 8px" }}>
              <div style={{ fontSize: 10, color: C.textDim }}>5d Trend</div>
              <div style={{ fontSize: 12, fontWeight: 700, color: item.trend5d > 0 ? C.green : item.trend5d < 0 ? C.red : C.textDim, fontFamily: "monospace" }}>
                {item.trend5d != null ? `${item.trend5d > 0 ? "+" : ""}${item.trend5d.toFixed(1)}%` : "-"}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Helper: render macro items grid (shared by IndicesSection and MacroRemainingSection)
function MacroItemsGrid({ items, vixHistory, isMobile }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(4, 1fr)", gap: 10 }}>
      {items.map(item => {
        const isVix = item.symbol === "^VIX";
        let priceColor = C.text;
        if (isVix) {
          priceColor = item.price >= 30 ? C.red : item.price >= 20 ? C.orange : item.price >= 15 ? C.yellow : C.green;
        }
        return (
          <div key={item.symbol} style={{ background: C.bg, borderRadius: 12, padding: isMobile ? 10 : 12, border: `1px solid ${C.border}` }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
              <span style={{ color: C.textMuted, fontSize: 11, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {item.name}
              </span>
              <TrendIcon change={item.change} />
            </div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 6, flexWrap: "wrap" }}>
              {item.price > 0 ? (<>
                <span style={{ color: priceColor, fontSize: isMobile ? 15 : 17, fontWeight: 700, fontFamily: "monospace" }}>
                  {item.price?.toLocaleString("de-DE", { maximumFractionDigits: item.price > 100 ? 0 : 2 })}
                </span>
                <ChangeDisplay change={item.change} style={{ fontSize: 12 }} />
              </>) : (
                <span style={{ color: C.textDim, fontSize: 13 }}>Markt geschlossen</span>
              )}
            </div>
            {item.stale && <div style={{ fontSize: 9, color: C.yellow, marginTop: 2 }}>Letzte Daten</div>}
            {isVix && item.price > 0 && (
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}>
                <VixTooltip price={item.price} vixHistory={vixHistory} isMobile={isMobile} />
                {item.w52 && <RangeTooltip item={item} isMobile={isMobile} />}
              </div>
            )}
            {!isVix && (
              <div style={{ marginTop: 4 }}>
                {item.w52 ? (
                  <RangeTooltip item={item} isMobile={isMobile} />
                ) : item.trend5d != null ? (
                  <div style={{ fontSize: 10, color: C.textDim }}>
                    5d: <span style={{ color: item.trend5d > 0 ? C.green : item.trend5d < 0 ? C.red : C.textDim }}>{item.trend5d > 0 ? "+" : ""}{item.trend5d.toFixed(1)}%</span>
                  </div>
                ) : null}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Indices Section (extracted from Macro) ───
function IndicesSection({ macro, isMobile }) {
  if (!macro?.length) return null;
  const indicesGroup = macro.find(g => g.category === "indices");
  if (!indicesGroup?.items?.length) return null;

  return (
    <GlassCard>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
        <span style={{ fontSize: 18 }}>{"\uD83D\uDCC8"}</span>
        <h3 style={{ margin: 0, color: C.text, fontSize: 16, fontWeight: 700 }}>Indizes</h3>
      </div>
      <MacroItemsGrid items={indicesGroup.items} isMobile={isMobile} />
    </GlassCard>
  );
}

// ─── Remaining Macro Section (VIX, Anleihen, Rohstoffe, Krypto, Waehrungen) ───
function MacroRemainingSection({ macro, vixHistory, isMobile }) {
  if (!macro?.length) return null;
  const excludeCategories = new Set(["indices", "futures"]);
  const remaining = macro.filter(g => !excludeCategories.has(g.category));
  const allItems = remaining.flatMap(g => g.items);
  if (allItems.length === 0) return null;

  return (
    <GlassCard>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
        <BarChart3 size={18} color={C.accent} />
        <h3 style={{ margin: 0, color: C.text, fontSize: 16, fontWeight: 700 }}>Makro-Daten</h3>
      </div>
      <MacroItemsGrid items={allItems} vixHistory={vixHistory} isMobile={isMobile} />
    </GlassCard>
  );
}

// ─── VIX Level Tooltip ───
const VIX_LEVELS = [
  { min: 0, max: 12, label: "Sehr niedrig", color: C.green, desc: "Extreme Sorglosigkeit. Markt preist kaum Risiko ein. Oft vor Korrekturen." },
  { min: 12, max: 16, label: "Niedrig", color: "#00D68F", desc: "Typisch fuer ruhige Bullenmaerkte. Normales Umfeld fuer Swing-Trades." },
  { min: 16, max: 20, label: "Normal", color: C.yellow, desc: "Gesunde Volatilitaet. Standardniveau — weder Angst noch Sorglosigkeit." },
  { min: 20, max: 25, label: "Erhoeht", color: C.orange, desc: "Steigende Unsicherheit. Positionsgroessen reduzieren, engere Stops." },
  { min: 25, max: 30, label: "Hoch", color: "#FF6B6B", desc: "Deutliche Angst im Markt. Nur High-Conviction-Trades. Mean-Reversion moeglich." },
  { min: 30, max: 999, label: "Sehr hoch / Panik", color: C.red, desc: "Panik-Modus (COVID, 2008-Niveau). Keine neuen LONG-Positionen. Absicherung pruefen." },
];

function VixLevelTooltip({ value }) {
  const [show, setShow] = useState(false);
  const vixVal = typeof value === "number" ? value : parseFloat(value);
  if (!vixVal || isNaN(vixVal)) return null;
  const currentLevel = VIX_LEVELS.find(l => vixVal >= l.min && vixVal < l.max) || VIX_LEVELS[VIX_LEVELS.length - 1];

  return (
    <div style={{ position: "relative", display: "inline-block" }}
      onMouseEnter={() => setShow(true)} onMouseLeave={() => setShow(false)}>
      <span style={{ cursor: "help", borderBottom: `1px dashed ${C.textDim}`, color: C.textDim, fontSize: 12, fontFamily: "monospace" }}>
        {vixVal.toFixed(2)}
      </span>
      {show && (
        <div style={{
          position: "absolute", top: "calc(100% + 8px)", left: "50%", transform: "translateX(-50%)",
          background: "#1A1F2B", border: `1px solid ${C.border}`, borderRadius: 10, padding: 14,
          zIndex: 1000, width: 280, boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
        }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.text, marginBottom: 10 }}>VIX-Skala</div>
          {VIX_LEVELS.map((level, i) => {
            const isActive = level === currentLevel;
            return (
              <div key={i} style={{
                display: "flex", alignItems: "center", gap: 8, padding: "4px 6px", borderRadius: 6,
                background: isActive ? `${level.color}15` : "transparent",
                border: isActive ? `1px solid ${level.color}30` : "1px solid transparent",
                marginBottom: 3,
              }}>
                <div style={{ width: 8, height: 8, borderRadius: "50%", background: level.color, flexShrink: 0 }} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 11, fontWeight: isActive ? 700 : 500, color: isActive ? level.color : C.textMuted }}>
                    {level.min}–{level.max < 999 ? level.max : "∞"}: {level.label}
                  </div>
                  {isActive && (
                    <div style={{ fontSize: 10, color: C.textMuted, marginTop: 2, lineHeight: 1.3 }}>
                      {level.desc}
                    </div>
                  )}
                </div>
                {isActive && <span style={{ fontSize: 11, fontWeight: 700, color: level.color }}>{"\u25C0"}</span>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Intermarket Signals Section ───
function IntermarketSection({ signals, isMobile }) {
  if (!signals?.length) return null;
  return (
    <GlassCard>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
        <TrendingUp size={18} color={C.accent} />
        <h3 style={{ margin: 0, color: C.text, fontSize: 16, fontWeight: 700 }}>Intermarket-Signale</h3>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 8 }}>
        {signals.map((sig, i) => {
          const isVix = sig.indicator === "VIX";
          return (
            <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: C.bg, borderRadius: 10, padding: "10px 14px", border: `1px solid ${C.border}` }}>
              <div style={{ flex: 1 }}>
                <div style={{ color: C.text, fontSize: 13, fontWeight: 600 }}>{sig.indicator}</div>
                <div style={{ color: C.textMuted, fontSize: 11, marginTop: 2 }}>{sig.interpretation}</div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {sig.value != null && (
                  isVix ? <VixLevelTooltip value={sig.value} /> : (
                    <span style={{ color: C.textDim, fontSize: 12, fontFamily: "monospace" }}>
                      {typeof sig.value === "number" ? sig.value.toFixed(2) : sig.value}
                    </span>
                  )
                )}
                <SignalBadge signal={sig.signal} />
              </div>
            </div>
          );
        })}
      </div>
    </GlassCard>
  );
}


// ─── Trade Setups Section ───
function TradeSetupsSection({ setups, isMobile, onNavigate }) {
  return (
    <GlassCard>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
        <Target size={18} color={C.green} />
        <h3 style={{ margin: 0, color: C.text, fontSize: 16, fontWeight: 700 }}>Swing-Trade Setups</h3>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 12 }}>
        {setups.map((setup, i) => {
          const range = setup.target - setup.stop;
          const entryPos = ((setup.entry - setup.stop) / range) * 100;

          return (
            <div key={i} style={{ background: C.bg, borderRadius: 14, padding: 16, border: `1px solid ${C.border}` }}>
              {/* Header */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <div>
                  <span style={{ color: C.text, fontSize: 18, fontWeight: 700 }}>{setup.symbol}</span>
                  <span style={{ color: C.textDim, fontSize: 11, marginLeft: 6 }}>{setup.currency}</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <ScoreBadge score={setup.swingScore} />
                  <span style={{ fontSize: 13, fontWeight: 700, color: C.green, background: `${C.green}15`, padding: "3px 10px", borderRadius: 6 }}>
                    CRV {setup.crv}
                  </span>
                </div>
              </div>

              {/* Entry / Stop / Target Bar */}
              <div style={{ marginBottom: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                  <span style={{ fontSize: 11, color: C.red, fontWeight: 600 }}>Stop {setup.stop?.toFixed(2)}</span>
                  <span style={{ fontSize: 11, color: C.blue, fontWeight: 600 }}>Entry {setup.entry?.toFixed(2)}</span>
                  <span style={{ fontSize: 11, color: C.green, fontWeight: 600 }}>Target {setup.target?.toFixed(2)}</span>
                </div>
                <div style={{ height: 8, background: C.border, borderRadius: 4, position: "relative" }}>
                  {/* Red zone (stop) */}
                  <div style={{ position: "absolute", left: 0, height: "100%", width: `${entryPos}%`, background: `${C.red}40`, borderRadius: "4px 0 0 4px" }} />
                  {/* Green zone (target) */}
                  <div style={{ position: "absolute", left: `${entryPos}%`, height: "100%", width: `${100 - entryPos}%`, background: `${C.green}40`, borderRadius: "0 4px 4px 0" }} />
                  {/* Entry marker */}
                  <div style={{ position: "absolute", left: `${entryPos}%`, top: -3, width: 3, height: 14, background: C.blue, borderRadius: 2, transform: "translateX(-50%)" }} />
                </div>
              </div>

              {/* Signals */}
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 10 }}>
                {(setup.signals || []).map((sig, j) => (
                  <span key={j} style={{ fontSize: 11, color: C.textMuted, background: `${C.accent}12`, borderRadius: 6, padding: "3px 8px", border: `1px solid ${C.accent}20` }}>
                    {sig}
                  </span>
                ))}
              </div>

              {/* Trade Check Button */}
              {onNavigate && (
                <button onClick={() => onNavigate("check")} style={{
                  width: "100%", padding: "8px 0", background: `${C.accent}15`, color: C.accent,
                  border: `1px solid ${C.accent}30`, borderRadius: 8, cursor: "pointer", fontSize: 13, fontWeight: 600,
                }}>
                  Trade Check starten {"\u2192"}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </GlassCard>
  );
}

// ─── Market News Section ───

function NewsSection({ news, isMobile }) {
  if (!news?.items?.length) return null;

  const sentArrow = (score) => {
    if (score >= 3) return { icon: "\u2191\u2191", color: C.green };
    if (score >= 1) return { icon: "\u2191", color: C.green };
    if (score <= -3) return { icon: "\u2193\u2193", color: C.red };
    if (score <= -1) return { icon: "\u2193", color: C.red };
    return { icon: "\u2192", color: C.textDim };
  };

  const timeAgo = (ts) => {
    if (!ts) return "";
    const hours = Math.round((Date.now() / 1000 - ts) / 3600);
    if (hours < 1) return "< 1h";
    if (hours < 24) return `${hours}h`;
    return `${Math.round(hours / 24)}d`;
  };

  return (
    <GlassCard>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
        <span style={{ fontSize: 18 }}>{"\uD83D\uDCF0"}</span>
        <h3 style={{ margin: 0, color: C.text, fontSize: 16, fontWeight: 700 }}>Market News</h3>
        <span style={{ fontSize: 11, color: C.textDim, marginLeft: "auto" }}>
          {news.items.length} Artikel
        </span>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {news.items.slice(0, isMobile ? 8 : 12).map((item, i) => {
          const { icon, color } = sentArrow(item.sentimentScore);
          return (
            <a key={item.id || i} href={item.link || "#"} target="_blank" rel="noopener noreferrer"
              style={{
                display: "flex", alignItems: "flex-start", gap: 10, textDecoration: "none",
                background: C.bg, borderRadius: 10, padding: "10px 14px",
                border: `1px solid ${item.isScanner ? `${C.accent}40` : C.border}`,
                transition: "border-color 0.15s",
              }}
              onMouseEnter={e => e.currentTarget.style.borderColor = C.accent}
              onMouseLeave={e => e.currentTarget.style.borderColor = item.isScanner ? `${C.accent}40` : C.border}
            >
              <span style={{ fontSize: 18, fontWeight: 700, color, minWidth: 24, textAlign: "center", lineHeight: "22px" }}>
                {icon}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  color: C.text, fontSize: 13, fontWeight: 600, lineHeight: 1.3,
                  overflow: "hidden", textOverflow: "ellipsis",
                  display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical",
                }}>
                  {item.title}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 11, color: C.textDim }}>{item.publisher}</span>
                  {item.relatedSymbols?.slice(0, 3).map(sym => (
                    <span key={sym} style={{
                      fontSize: 10, color: C.accent, background: `${C.accent}12`,
                      borderRadius: 4, padding: "1px 5px", fontWeight: 600,
                    }}>
                      {sym}
                    </span>
                  ))}
                  {item.isScanner && (
                    <span style={{ fontSize: 9, color: C.green, background: `${C.green}12`, borderRadius: 4, padding: "1px 5px", fontWeight: 600 }}>
                      Scanner
                    </span>
                  )}
                </div>
              </div>
              <span style={{ fontSize: 11, color: C.textDim, whiteSpace: "nowrap", marginTop: 2 }}>
                {timeAgo(item.publishedAt)}
              </span>
            </a>
          );
        })}
      </div>
    </GlassCard>
  );
}

// ─── TA Picks Section (Composite Score LONG Candidates) ───

function TAPicksSection({ picks, stats, isMobile, onNavigate, newsSentiment }) {
  const fmtP = (v) => v >= 100 ? v.toFixed(0) : v.toFixed(2);
  const confColor = (c) => c === "STRONG BUY" ? C.green : c === "BUY" ? "#00D68F" : C.yellow;

  const regime = stats?.marketRegime;
  const sp500Bull = regime?.sp500 === "bullish";
  const daxBull = regime?.dax === "bullish";

  return (
    <GlassCard>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <span style={{ fontSize: 18 }}>{"\uD83D\uDCCA"}</span>
        <h3 style={{ margin: 0, color: C.text, fontSize: 16, fontWeight: 700 }}>TA-Scanner: Optimierte Picks</h3>
      </div>

      {/* Market Regime Status */}
      {regime && (
        <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
          <span style={{
            fontSize: 10, fontWeight: 600, borderRadius: 5, padding: "2px 8px",
            color: sp500Bull ? C.green : C.red,
            background: `${sp500Bull ? C.green : C.red}12`,
            border: `1px solid ${sp500Bull ? C.green : C.red}25`,
          }}>
            S&P 500 {sp500Bull ? "\u2713 über" : "\u2717 unter"} SMA200
          </span>
          <span style={{
            fontSize: 10, fontWeight: 600, borderRadius: 5, padding: "2px 8px",
            color: daxBull ? C.green : C.red,
            background: `${daxBull ? C.green : C.red}12`,
            border: `1px solid ${daxBull ? C.green : C.red}25`,
          }}>
            DAX {daxBull ? "\u2713 über" : "\u2717 unter"} SMA200
          </span>
        </div>
      )}

      {/* Filter Summary */}
      <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 8 }}>
        {["Score \u2265 7.5", "RS 0\u201315%", "EMA20 < 2 ATR", "Index > SMA200", "Max 2/Sektor"].map((f) => (
          <span key={f} style={{
            fontSize: 9, color: C.accent, background: `${C.accent}10`, borderRadius: 4, padding: "1px 5px",
            border: `1px solid ${C.accent}20`,
          }}>{f}</span>
        ))}
      </div>

      <div style={{ color: C.textMuted, fontSize: 11, marginBottom: 14 }}>
        Backtest-optimiert (PF 1.56 {"\u2022"} WR 57% {"\u2022"} MaxDD -4.5%) {"\u2022"} Depot EUR 45k
        {stats && <span> {"\u2022"} {stats.totalScanned} gescannt, {stats.unfilteredPicks || stats.longPicks} unfiltered {"\u2192"} {stats.longPicks} Picks</span>}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 12 }}>
        {picks.slice(0, 10).map((r, i) => {
          const c = r.composite;
          const tp = c?.tradePlan;
          if (!c || !tp) return null;

          const range = tp.target - tp.stop;
          const entryPos = range > 0 ? ((tp.entry - tp.stop) / range) * 100 : 50;

          return (
            <div key={i} style={{ background: C.bg, borderRadius: 14, padding: 16, border: `1px solid ${C.border}` }}>
              {/* Header: Rank + Symbol + Score + Confidence */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: C.textDim, background: `${C.accent}15`, borderRadius: 6, padding: "2px 7px" }}>#{i + 1}</span>
                  <span style={{ color: C.text, fontSize: 18, fontWeight: 700 }}>{r.displaySymbol}</span>
                  <span style={{ color: C.textDim, fontSize: 11 }}>{r.currency}</span>
                  {(() => {
                    const sym = (r.displaySymbol || "").toUpperCase();
                    const sent = newsSentiment?.[sym];
                    if (!sent) return null;
                    const s = sent.score;
                    const arrow = s >= 3 ? "\u2191\u2191" : s >= 1 ? "\u2191" : s <= -3 ? "\u2193\u2193" : s <= -1 ? "\u2193" : null;
                    if (!arrow) return null;
                    const clr = s > 0 ? C.green : C.red;
                    return <span title={`News: ${sent.count} Artikel, Score ${sent.score}`} style={{ fontSize: 14, fontWeight: 700, color: clr }}>{arrow}</span>;
                  })()}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontSize: 14, fontWeight: 700, color: confColor(c.confidence), background: `${confColor(c.confidence)}15`, padding: "3px 10px", borderRadius: 6 }}>
                    {c.compositeScore}
                  </span>
                  <span style={{ fontSize: 11, fontWeight: 600, color: confColor(c.confidence) }}>{c.confidence}</span>
                </div>
              </div>

              {/* Price + Change */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                <span style={{ color: C.text, fontSize: 15, fontWeight: 600, fontFamily: "monospace" }}>{fmtP(r.price)}</span>
                <ChangeDisplay change={r.change} />
              </div>

              {/* Score Breakdown */}
              {c.breakdown && (
              <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 10 }}>
                {[
                  { label: "Trend", val: c.breakdown.trend, max: 6 },
                  { label: "RSI", val: c.breakdown.rsi, max: 1.5 },
                  { label: "MACD", val: c.breakdown.macd, max: 1 },
                  { label: "MA", val: c.breakdown.ma, max: 2 },
                  { label: "Vol", val: c.breakdown.volume, max: 1 },
                ].map(({ label, val, max }) => {
                  const color = val > 0 ? C.green : val < 0 ? C.red : C.textDim;
                  return (
                    <span key={label} style={{ fontSize: 10, color, background: `${color}12`, borderRadius: 5, padding: "2px 6px", border: `1px solid ${color}20` }}>
                      {label} {val > 0 ? "+" : ""}{val}
                    </span>
                  );
                })}
              </div>
              )}

              {/* Entry / Stop / Target Bar */}
              <div style={{ marginBottom: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                  <span style={{ fontSize: 11, color: C.red, fontWeight: 600 }}>Stop {fmtP(tp.stop)}</span>
                  <span style={{ fontSize: 11, color: C.blue, fontWeight: 600 }}>Entry {fmtP(tp.entry)}</span>
                  <span style={{ fontSize: 11, color: C.green, fontWeight: 600 }}>Ziel {fmtP(tp.target)}</span>
                </div>
                <div style={{ height: 8, background: C.border, borderRadius: 4, position: "relative" }}>
                  <div style={{ position: "absolute", left: 0, height: "100%", width: `${entryPos}%`, background: `${C.red}40`, borderRadius: "4px 0 0 4px" }} />
                  <div style={{ position: "absolute", left: `${entryPos}%`, height: "100%", width: `${100 - entryPos}%`, background: `${C.green}40`, borderRadius: "0 4px 4px 0" }} />
                  <div style={{ position: "absolute", left: `${entryPos}%`, top: -3, width: 3, height: 14, background: C.blue, borderRadius: 2, transform: "translateX(-50%)" }} />
                </div>
              </div>

              {/* Trade Stats */}
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: C.textMuted }}>
                <span>R:R <b style={{ color: tp.rr >= 2 ? C.green : C.yellow }}>{tp.rr}</b></span>
                <span>{tp.shares} Stk.</span>
                <span>{tp.portfolioPct}% Depot</span>
                <span>ATR {fmtP(tp.atr)}</span>
              </div>

              {/* Extension + Relative Strength */}
              {(r.ema20Distance != null || r.relStrengthVsIndex != null) && (
                <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                  {r.ema20Distance != null && (
                    <span style={{
                      fontSize: 10,
                      color: Math.abs(r.ema20Distance) > 2 ? "#f59e0b" : C.textDim,
                      background: `${Math.abs(r.ema20Distance) > 2 ? "#f59e0b" : C.textDim}10`,
                      borderRadius: 5, padding: "2px 6px",
                    }}>
                      EMA20 {r.ema20Distance > 0 ? "+" : ""}{r.ema20Distance.toFixed(1)} ATR
                    </span>
                  )}
                  {r.relStrengthVsIndex != null && (
                    <span style={{
                      fontSize: 10,
                      color: r.relStrengthVsIndex > 0 ? C.green : r.relStrengthVsIndex < -3 ? C.red : C.textDim,
                      background: `${r.relStrengthVsIndex > 0 ? C.green : r.relStrengthVsIndex < -3 ? C.red : C.textDim}10`,
                      borderRadius: 5, padding: "2px 6px",
                    }}>
                      RS vs {r.currency === "EUR" ? "DAX" : "S&P"} {r.relStrengthVsIndex > 0 ? "+" : ""}{r.relStrengthVsIndex.toFixed(1)}%
                    </span>
                  )}
                </div>
              )}

              {/* Trend Info */}
              {c.indicators && (
              <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                {["Daily", "Weekly", "Monthly"].map((tf, j) => {
                  const key = ["dailyTrend", "weeklyTrend", "monthlyTrend"][j];
                  const val = c.indicators?.[key] || "?";
                  const isUp = val.includes("Auf");
                  const isDown = val.includes("Ab");
                  const color = isUp ? C.green : isDown ? C.red : C.textDim;
                  return (
                    <span key={tf} style={{ fontSize: 10, color, background: `${color}10`, borderRadius: 5, padding: "2px 6px" }}>
                      {tf}: {val}
                    </span>
                  );
                })}
              </div>
              )}
            </div>
          );
        })}
      </div>
    </GlassCard>
  );
}

// ─── Movers Section (>= 3x ATR Daily Moves) ───

function MoversSection({ movers, isMobile, onNavigate }) {
  const fmtP = (v) => v >= 100 ? v.toFixed(0) : v.toFixed(2);
  const gainers = movers.filter(m => m.change > 0).sort((a, b) => (b.atrMultiple || 0) - (a.atrMultiple || 0));
  const losers = movers.filter(m => m.change < 0).sort((a, b) => (b.atrMultiple || 0) - (a.atrMultiple || 0));

  return (
    <GlassCard>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
        <span style={{ fontSize: 18 }}>{"\uD83D\uDEA8"}</span>
        <h3 style={{ margin: 0, color: C.text, fontSize: 16, fontWeight: 700 }}>{movers.length} Aktie{movers.length > 1 ? "n" : ""} mit {"\u2265"}3x ATR Bewegung</h3>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 12 }}>
        {/* Gainers */}
        {gainers.length > 0 && (
          <div>
            <div style={{ color: C.green, fontSize: 12, fontWeight: 700, marginBottom: 8 }}>{"\uD83D\uDCC8"} Gewinner</div>
            {gainers.map((m, i) => (
              <div key={i} style={{
                padding: "8px 12px",
                background: `${C.green}08`, borderRadius: 10, marginBottom: 6, border: `1px solid ${C.green}15`,
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <span style={{ color: C.text, fontWeight: 700, fontSize: 14 }}>{m.displaySymbol}</span>
                    <span style={{ color: C.textDim, fontSize: 11, marginLeft: 6 }}>{m.atrMultiple ? `${m.atrMultiple}x ATR` : m.currency}</span>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <span style={{ color: C.text, fontFamily: "monospace", fontSize: 13 }}>{fmtP(m.price)}</span>
                    <span style={{ color: C.green, fontWeight: 700, fontSize: 13, marginLeft: 10 }}>+{m.change.toFixed(1)}%</span>
                  </div>
                </div>
                {(m.ema20Distance != null || m.relStrengthVsIndex != null) && (
                  <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                    {m.ema20Distance != null && (
                      <span style={{ fontSize: 10, color: Math.abs(m.ema20Distance) > 2 ? "#f59e0b" : C.textDim }}>
                        EMA20: {m.ema20Distance > 0 ? "+" : ""}{m.ema20Distance.toFixed(1)} ATR
                      </span>
                    )}
                    {m.relStrengthVsIndex != null && (
                      <span style={{ fontSize: 10, color: m.relStrengthVsIndex > 0 ? C.green : m.relStrengthVsIndex < -3 ? C.red : C.textDim }}>
                        RS: {m.relStrengthVsIndex > 0 ? "+" : ""}{m.relStrengthVsIndex.toFixed(1)}%
                      </span>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Losers */}
        {losers.length > 0 && (
          <div>
            <div style={{ color: C.red, fontSize: 12, fontWeight: 700, marginBottom: 8 }}>{"\uD83D\uDCC9"} Verlierer</div>
            {losers.map((m, i) => (
              <div key={i} style={{
                padding: "8px 12px",
                background: `${C.red}08`, borderRadius: 10, marginBottom: 6, border: `1px solid ${C.red}15`,
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <span style={{ color: C.text, fontWeight: 700, fontSize: 14 }}>{m.displaySymbol}</span>
                    <span style={{ color: C.textDim, fontSize: 11, marginLeft: 6 }}>{m.atrMultiple ? `${m.atrMultiple}x ATR` : m.currency}</span>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <span style={{ color: C.text, fontFamily: "monospace", fontSize: 13 }}>{fmtP(m.price)}</span>
                    <span style={{ color: C.red, fontWeight: 700, fontSize: 13, marginLeft: 10 }}>{m.change.toFixed(1)}%</span>
                  </div>
                </div>
                {(m.ema20Distance != null || m.relStrengthVsIndex != null) && (
                  <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                    {m.ema20Distance != null && (
                      <span style={{ fontSize: 10, color: Math.abs(m.ema20Distance) > 2 ? "#f59e0b" : C.textDim }}>
                        EMA20: {m.ema20Distance > 0 ? "+" : ""}{m.ema20Distance.toFixed(1)} ATR
                      </span>
                    )}
                    {m.relStrengthVsIndex != null && (
                      <span style={{ fontSize: 10, color: m.relStrengthVsIndex > 0 ? C.green : m.relStrengthVsIndex < -3 ? C.red : C.textDim }}>
                        RS: {m.relStrengthVsIndex > 0 ? "+" : ""}{m.relStrengthVsIndex.toFixed(1)}%
                      </span>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </GlassCard>
  );
}

// ─── Futures Section ───
function FuturesSection({ futures, isMobile }) {
  const items = [
    { key: "es", label: "S&P 500 Futures", data: futures.es },
    { key: "nq", label: "Nasdaq Futures", data: futures.nq },
  ].filter(f => f.data);

  if (items.length === 0) return null;

  return (
    <GlassCard>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
        <span style={{ fontSize: 18 }}>{"\uD83D\uDD2E"}</span>
        <h3 style={{ margin: 0, color: C.text, fontSize: 16, fontWeight: 700 }}>Pre-Market Futures</h3>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 10 }}>
        {items.map(({ key, label, data }) => (
          <div key={key} style={{ background: C.bg, borderRadius: 12, padding: 14, border: `1px solid ${C.border}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <div style={{ color: C.textMuted, fontSize: 11, fontWeight: 600 }}>{label}</div>
              {data.price > 0 ? (
                <div style={{ color: C.text, fontSize: 18, fontWeight: 700, fontFamily: "monospace", marginTop: 2 }}>
                  {data.price?.toLocaleString("de-DE", { maximumFractionDigits: 0 })}
                </div>
              ) : (
                <div style={{ color: C.textDim, fontSize: 14, marginTop: 2 }}>Markt geschlossen</div>
              )}
              {data.stale && <div style={{ fontSize: 9, color: C.yellow }}>Letzte Daten</div>}
            </div>
            {data.price > 0 && (
            <div style={{ textAlign: "right" }}>
              <ChangeDisplay change={data.change} style={{ fontSize: 15 }} />
              <div style={{ marginTop: 4 }}><TrendIcon change={data.change} /></div>
            </div>
            )}
          </div>
        ))}
      </div>
    </GlassCard>
  );
}
