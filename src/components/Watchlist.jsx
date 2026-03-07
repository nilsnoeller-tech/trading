// ─── Watchlist Component ───
// Drei Modi: TA-Picks (Telegram-Push Picks), Index Scanner (S&P 500 + DAX 40), Custom Watchlist (manuell).

import React, { useState, useEffect, useCallback, useRef } from "react";
import { Zap, Bell, BellOff, RefreshCw, Plus, X, ChevronDown, ChevronUp, TrendingUp, Activity, AlertTriangle, CheckCircle, Trash2, Play, Search, Smartphone, Send, BarChart3, List, Globe, Target } from "lucide-react";
import { authFetch } from "../services/auth";
import { scanWatchlist } from "../services/watchlistScanner";
import {
  requestNotificationPermission, getNotificationStatus, checkAndNotify,
  subscribeToPush, unsubscribeFromPush, getPushSubscriptionStatus,
  syncWatchlistToServer, sendTestPush, getPushServerStatus,
  getScanResults, getScanStatus, updateScanConfig,
} from "../services/notifications";

// ── Colors (gleich wie TradingJournal) ──
const C = {
  bg: "#0B0E11", card: "#141820", cardHover: "#1A1F2B",
  border: "#1E2433", borderLight: "#2A3144",
  text: "#E8ECF1", textMuted: "#8892A4", textDim: "#5A6478",
  accent: "#6C5CE7", accentLight: "#A29BFE",
  green: "#00D68F", red: "#FF6B6B", yellow: "#FDCB6E", orange: "#FFA502", blue: "#74B9FF",
};

const PRESETS = {
  "US Large Cap": ["AAPL", "MSFT", "NVDA", "AVGO", "META", "AMZN", "GOOG", "TSLA", "AMD", "CRM"],
  "US Growth": ["PLTR", "CRWD", "SNOW", "DDOG", "NET", "SHOP", "COIN", "MSTR", "SOFI", "AFRM"],
  "DAX": ["SAP.DE", "SIE.DE", "ALV.DE", "DTE.DE", "BAS.DE", "MBG.DE", "BMW.DE", "ADS.DE", "IFX.DE", "MRK.DE"],
};

const STORAGE_KEY = "ncapital-watchlist";
const RESULTS_KEY = "ncapital-watchlist-results";
const TAB_KEY = "ncapital-watchlist-tab";

function loadWatchlist() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? JSON.parse(saved) : PRESETS["US Large Cap"];
  } catch { return PRESETS["US Large Cap"]; }
}
function saveWatchlist(symbols) { localStorage.setItem(STORAGE_KEY, JSON.stringify(symbols)); }

function loadCachedResults() {
  try {
    const saved = localStorage.getItem(RESULTS_KEY);
    if (!saved) return null;
    const parsed = JSON.parse(saved);
    if (parsed.timestamp && Date.now() - parsed.timestamp < 4 * 60 * 60 * 1000) return parsed.results;
    return null;
  } catch { return null; }
}
function saveCachedResults(results) {
  localStorage.setItem(RESULTS_KEY, JSON.stringify({ results, timestamp: Date.now() }));
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

function GlassCard({ children, style }) {
  return (
    <div style={{ background: C.card, borderRadius: 16, padding: 20, border: `1px solid ${C.border}`, ...style }}>
      {children}
    </div>
  );
}

// ─── Shared Results Table ───
function ResultsTable({ results, isMobile, sortBy, setSortBy, expandedRow, setExpandedRow, openTradeCheck, showCombined }) {
  const sortedResults = [...results].sort((a, b) => {
    if (sortBy === "combined") return (b.combinedScore || 0) - (a.combinedScore || 0);
    if (sortBy === "swing") return b.swing.total - a.swing.total;
    if (sortBy === "intraday") return b.intraday.total - a.intraday.total;
    if (sortBy === "change") return b.change - a.change;
    return 0;
  });

  if (sortedResults.length === 0) return null;

  return (
    <GlassCard style={{ padding: 0, overflow: "hidden" }}>
      {/* Table Header */}
      <div style={{
        display: "grid",
        gridTemplateColumns: isMobile
          ? (showCombined ? "1fr 44px 44px 44px" : "1fr 55px 55px")
          : (showCombined ? "100px 90px 70px 70px 75px 75px 1fr" : "140px 90px 80px 70px 70px 1fr"),
        gap: 8, padding: "12px 16px", borderBottom: `1px solid ${C.border}`,
        background: "rgba(10,13,17,0.3)", fontSize: 11, fontWeight: 700, color: C.textDim,
        textTransform: "uppercase", letterSpacing: "0.05em",
      }}>
        <div>Symbol</div>
        {!isMobile && <div style={{ textAlign: "right" }}>Kurs</div>}
        {!isMobile && <div style={{ textAlign: "right", cursor: "pointer" }} onClick={() => setSortBy("change")}>
          Chg% {sortBy === "change" ? "▼" : ""}
        </div>}
        <div style={{ textAlign: "center", cursor: "pointer" }} onClick={() => setSortBy("swing")}>
          {isMobile ? "Sw" : "Swing"} {sortBy === "swing" ? "▼" : ""}
        </div>
        <div style={{ textAlign: "center", cursor: "pointer" }} onClick={() => setSortBy("intraday")}>
          {isMobile ? "Intra" : "Intraday"} {sortBy === "intraday" ? "▼" : ""}
        </div>
        {showCombined && (
          <div style={{ textAlign: "center", cursor: "pointer" }} onClick={() => setSortBy("combined")}>
            {isMobile ? "Comb" : "Combined"} {sortBy === "combined" ? "▼" : ""}
          </div>
        )}
        {!isMobile && <div>Signal</div>}
      </div>

      {/* Table Rows */}
      {sortedResults.map((r, idx) => {
        const isExpanded = expandedRow === idx;
        const cs = r.combinedScore || Math.round(r.swing.total * 0.6 + r.intraday.total * 0.4);
        const rowBorder = cs >= 70 ? `${C.green}15` : cs >= 50 ? `${C.yellow}10` : "transparent";

        return (
          <div key={r.symbol}>
            <div
              onClick={() => setExpandedRow(isExpanded ? null : idx)}
              style={{
                display: "grid",
                gridTemplateColumns: isMobile
                  ? (showCombined ? "1fr 44px 44px 44px" : "1fr 55px 55px")
                  : (showCombined ? "100px 90px 70px 70px 75px 75px 1fr" : "140px 90px 80px 70px 70px 1fr"),
                gap: 8, padding: "12px 16px", cursor: "pointer",
                borderBottom: `1px solid ${C.border}`,
                background: isExpanded ? `${C.accent}05` : idx % 2 === 0 ? "transparent" : "rgba(10,13,17,0.15)",
                borderLeft: `3px solid ${rowBorder}`,
                transition: "all 0.15s",
              }}
            >
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{r.displaySymbol}</div>
                {isMobile && <div style={{ fontSize: 10, color: C.textDim }}>
                  {r.price > 0 ? `${r.price.toFixed(2)} ${r.currency}` : "—"}
                  {r.change !== 0 && <span style={{ color: r.change >= 0 ? C.green : C.red, marginLeft: 4 }}>
                    {r.change >= 0 ? "+" : ""}{r.change.toFixed(1)}%
                  </span>}
                </div>}
              </div>
              {!isMobile && <div style={{ textAlign: "right", fontSize: 13, fontWeight: 600, color: C.text }}>{r.price > 0 ? r.price.toFixed(2) : "—"}</div>}
              {!isMobile && (
                <div style={{ textAlign: "right", fontSize: 12, fontWeight: 600, color: r.change >= 0 ? C.green : C.red }}>
                  {r.change >= 0 ? "+" : ""}{r.change.toFixed(2)}%
                </div>
              )}
              <div style={{ textAlign: "center" }}><ScoreBadge score={r.swing.total} size="small" /></div>
              <div style={{ textAlign: "center" }}><ScoreBadge score={r.intraday.total} size="small" /></div>
              {showCombined && <div style={{ textAlign: "center" }}><ScoreBadge score={cs} size="small" /></div>}
              {!isMobile && (
                <div style={{ fontSize: 11, color: C.textMuted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {[...r.swing.signals, ...r.intraday.signals].slice(0, 2).join(", ") || "—"}
                </div>
              )}
            </div>

            {/* Expanded Detail */}
            {isExpanded && (
              <div style={{ padding: 16, borderBottom: `1px solid ${C.border}`, background: `${C.accent}03` }}>
                <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 16 }}>
                  {/* Swing Detail */}
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: C.green, marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}>
                      <TrendingUp size={14} /> Swing-Score: {r.swing.total}
                    </div>
                    {(r.swing.factors || []).map((f, i) => (
                      <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "4px 0", fontSize: 12 }}>
                        <span style={{ color: C.textMuted }}>{f.name}</span>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <span style={{ color: C.textDim, fontSize: 11 }}>{f.value}</span>
                          <div style={{ width: 40, height: 4, borderRadius: 2, background: C.border, overflow: "hidden" }}>
                            <div style={{ height: "100%", width: `${f.score}%`, borderRadius: 2, background: f.score >= 70 ? C.green : f.score >= 40 ? C.yellow : C.red }} />
                          </div>
                        </div>
                      </div>
                    ))}
                    {r.swing.signals.length > 0 && (
                      <div style={{ marginTop: 8, fontSize: 11, color: C.green, fontWeight: 600 }}>
                        {r.swing.signals.join(" · ")}
                      </div>
                    )}
                  </div>

                  {/* Intraday Detail */}
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: C.blue, marginBottom: 8, display: "flex", alignItems: "center", gap: 6 }}>
                      <Activity size={14} /> Intraday-Score: {r.intraday.total}
                    </div>
                    {(r.intraday.factors || []).map((f, i) => (
                      <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "4px 0", fontSize: 12 }}>
                        <span style={{ color: C.textMuted }}>{f.name}</span>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <span style={{ color: C.textDim, fontSize: 11 }}>{f.value}</span>
                          <div style={{ width: 40, height: 4, borderRadius: 2, background: C.border, overflow: "hidden" }}>
                            <div style={{ height: "100%", width: `${f.score}%`, borderRadius: 2, background: f.score >= 70 ? C.green : f.score >= 40 ? C.yellow : C.red }} />
                          </div>
                        </div>
                      </div>
                    ))}
                    {r.intraday.signals.length > 0 && (
                      <div style={{ marginTop: 8, fontSize: 11, color: C.blue, fontWeight: 600 }}>
                        {r.intraday.signals.join(" · ")}
                      </div>
                    )}
                  </div>
                </div>

                {/* Trade Setup (Entry/Stop/Ziel/CRV/Risiko) */}
                {r.swing.tradeSetup && r.swing.tradeSetup.entry > 0 && (() => {
                  const ts = r.swing.tradeSetup;
                  const fmtP = (v) => v >= 100 ? v.toFixed(0) : v.toFixed(2);
                  return (
                    <div style={{
                      marginTop: 12, padding: 12, borderRadius: 10,
                      background: `${C.accent}08`, border: `1px solid ${C.accent}15`,
                    }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: C.accent, marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                        {r.swing.setupEmoji} Trade-Setup
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 8 }}>
                        <div style={{ textAlign: "center", padding: 8, borderRadius: 8, background: `${C.text}06` }}>
                          <div style={{ fontSize: 10, color: C.textDim, marginBottom: 2 }}>Entry</div>
                          <div style={{ fontSize: 14, fontWeight: 700, color: C.text }}>{fmtP(ts.entry)} {r.currency}</div>
                        </div>
                        <div style={{ textAlign: "center", padding: 8, borderRadius: 8, background: `${C.red}08` }}>
                          <div style={{ fontSize: 10, color: C.textDim, marginBottom: 2 }}>Stop</div>
                          <div style={{ fontSize: 14, fontWeight: 700, color: C.red }}>{fmtP(ts.stop)}</div>
                          <div style={{ fontSize: 10, color: C.red }}>-{ts.stopPct}%</div>
                        </div>
                        <div style={{ textAlign: "center", padding: 8, borderRadius: 8, background: `${C.green}08` }}>
                          <div style={{ fontSize: 10, color: C.textDim, marginBottom: 2 }}>Ziel</div>
                          <div style={{ fontSize: 14, fontWeight: 700, color: C.green }}>{fmtP(ts.target)}</div>
                        </div>
                      </div>
                      <div style={{ display: "flex", justifyContent: "center", gap: 16, fontSize: 12 }}>
                        <span style={{ color: C.textMuted }}>CRV <b style={{ color: ts.crv >= 2 ? C.green : ts.crv >= 1.5 ? C.yellow : C.red }}>{ts.crv.toFixed(1)}</b></span>
                        <span style={{ color: C.textMuted }}>Risiko <b style={{ color: ts.riskPct >= 0.75 ? C.green : ts.riskPct >= 0.5 ? C.yellow : C.red }}>{ts.riskLabel}</b></span>
                        {r.swing.atr > 0 && <span style={{ color: C.textDim }}>ATR {fmtP(r.swing.atr)}</span>}
                      </div>
                    </div>
                  );
                })()}

                {/* Action Buttons */}
                <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
                  <button onClick={() => openTradeCheck(r.displaySymbol, r.currency === "EUR" ? "EUR" : "USD")} style={{
                    padding: "8px 16px", borderRadius: 8, border: "none",
                    background: `linear-gradient(135deg, ${C.accent}, ${C.accentLight})`,
                    color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer",
                    display: "flex", alignItems: "center", gap: 6,
                  }}>
                    <Search size={13} /> Trade Check starten
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </GlassCard>
  );
}

// ─── Breadth Badge (hover/click tooltip for index market breadth) ───
function BreadthBadge({ label, data }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  if (!data || !data.total) return <span>{label} · </span>;

  const posPct = Math.round((data.positive / data.total) * 100);
  const negPct = Math.round((data.negative / data.total) * 100);
  const barColor = posPct > 60 ? C.green : posPct < 40 ? C.red : C.yellow;

  return (
    <span ref={ref} style={{ position: "relative", display: "inline-flex", alignItems: "center", gap: 4, cursor: "pointer" }}
      onClick={() => setOpen(!open)} onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <span>{label}</span>
      {/* Mini breadth bar */}
      <span style={{ display: "inline-block", width: 28, height: 4, borderRadius: 2, background: C.red, overflow: "hidden", verticalAlign: "middle" }}>
        <span style={{ display: "block", height: "100%", width: `${posPct}%`, background: C.green, borderRadius: 2 }} />
      </span>
      <span style={{ color: C.textDim }}> · </span>
      {/* Tooltip */}
      {open && (
        <div style={{
          position: "absolute", top: "100%", left: 0, marginTop: 6, zIndex: 999,
          background: "#1a1f2b", border: `1px solid ${C.borderLight}`, borderRadius: 10,
          padding: 12, minWidth: 200, boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
        }} onClick={(e) => e.stopPropagation()}>
          <div style={{ fontSize: 11, fontWeight: 700, color: C.text, marginBottom: 8 }}>
            Marktbreite {label}
          </div>
          {/* Visual bar */}
          <div style={{ display: "flex", height: 10, borderRadius: 4, overflow: "hidden", marginBottom: 8 }}>
            <div style={{ width: `${posPct}%`, background: C.green, transition: "width 0.3s" }} />
            {data.unchanged > 0 && <div style={{ width: `${Math.round((data.unchanged / data.total) * 100)}%`, background: C.textDim, transition: "width 0.3s" }} />}
            <div style={{ width: `${negPct}%`, background: C.red, transition: "width 0.3s" }} />
          </div>
          {/* Stats */}
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 4 }}>
            <span style={{ color: C.green, fontWeight: 700 }}>{"\u25B2"} {data.positive} ({posPct}%)</span>
            {data.unchanged > 0 && <span style={{ color: C.textDim }}>{"\u25AC"} {data.unchanged}</span>}
            <span style={{ color: C.red, fontWeight: 700 }}>{"\u25BC"} {data.negative} ({negPct}%)</span>
          </div>
          <div style={{ fontSize: 11, color: C.textMuted, marginTop: 4, borderTop: `1px solid ${C.border}`, paddingTop: 4 }}>
            {data.total} Werte gescannt
            <span style={{ marginLeft: 8, color: data.avgChange >= 0 ? C.green : C.red, fontWeight: 600 }}>
              {"\u00D8"} {data.avgChange >= 0 ? "+" : ""}{data.avgChange.toFixed(2)}%
            </span>
          </div>
        </div>
      )}
    </span>
  );
}

// ─── Index Scanner Tab ───
function IndexScanner({ isMobile, onNavigate }) {
  const [results, setResults] = useState([]);
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [sortBy, setSortBy] = useState("swing");
  const [expandedRow, setExpandedRow] = useState(null);
  const pollRef = useRef(null);
  const statusRef = useRef(null);

  // Push State
  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushLoading, setPushLoading] = useState(false);
  const [testSending, setTestSending] = useState(false);

  const loadResults = useCallback(async () => {
    try {
      const data = await getScanResults();
      if (data.results) setResults(data.results);
    } catch (e) { console.error("Scan results fetch error:", e); }
  }, []);

  const loadStatus = useCallback(async () => {
    try {
      const data = await getScanStatus();
      setStatus(data);
    } catch (e) { console.error("Scan status fetch error:", e); }
  }, []);

  // Initial load
  useEffect(() => {
    Promise.all([loadResults(), loadStatus(), getPushSubscriptionStatus().then(setPushEnabled)])
      .finally(() => setLoading(false));
  }, []);

  // Poll results every 5 min, status every 60s
  useEffect(() => {
    pollRef.current = setInterval(loadResults, 5 * 60 * 1000);
    statusRef.current = setInterval(loadStatus, 60 * 1000);
    return () => { clearInterval(pollRef.current); clearInterval(statusRef.current); };
  }, [loadResults, loadStatus]);

  const togglePush = async () => {
    setPushLoading(true);
    try {
      if (!pushEnabled) {
        const granted = await requestNotificationPermission();
        if (!granted) { setPushLoading(false); return; }
        const sub = await subscribeToPush([]);
        if (sub) setPushEnabled(true);
      } else {
        await unsubscribeFromPush();
        setPushEnabled(false);
      }
    } catch (e) { console.error("Push toggle error:", e); }
    finally { setPushLoading(false); }
  };

  const handleTestPush = async () => {
    setTestSending(true);
    try { await sendTestPush(); } catch (e) { console.error(e); }
    finally { setTestSending(false); }
  };

  const openTradeCheck = (symbol, currency) => {
    localStorage.setItem("ncapital-prefill-symbol", symbol);
    if (currency) localStorage.setItem("ncapital-prefill-currency", currency);
    if (onNavigate) onNavigate("check");
  };

  const formatTime = (iso) => {
    if (!iso) return "—";
    return new Date(iso).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
  };

  return (
    <>
      {/* Status Card */}
      <GlassCard style={{ marginBottom: 20 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
          <div>
            <div style={{ fontSize: isMobile ? 18 : 22, fontWeight: 800, color: C.text, display: "flex", alignItems: "center", gap: 8 }}>
              <Globe size={isMobile ? 18 : 22} color={C.accent} />
              Index Scanner
            </div>
            <div style={{ fontSize: 12, color: C.textMuted, marginTop: 4, display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
              {status ? (
                status.scanMode === "dax-only" ? <BreadthBadge label={`${status.dax40Count} DAX`} data={status.stats?.breadth?.dax} /> :
                status.scanMode === "sp500-only" ? <BreadthBadge label={`${status.sp500Count} S&P 500`} data={status.stats?.breadth?.sp500} /> :
                status.scanMode === "both" ? <><BreadthBadge label={`${status.sp500Count} S&P 500`} data={status.stats?.breadth?.sp500} /><span style={{ color: C.textDim }}> + </span><BreadthBadge label={`${status.dax40Count} DAX`} data={status.stats?.breadth?.dax} /><span style={{ color: C.textDim }}> · </span></> :
                status.scanMode === "closed" ? <span>Markt geschlossen · </span> : null
              ) : null}
              <span>{results.length > 0 ? `${results.length} Setups gefunden` : loading ? "Lade..." : "Warte auf ersten Scan-Zyklus..."}</span>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {/* Push Toggle */}
            <button onClick={togglePush} disabled={pushLoading} style={{
              padding: "8px 14px", borderRadius: 10, border: `1px solid ${pushEnabled ? C.green : C.border}30`,
              background: pushEnabled ? `${C.green}10` : "transparent", cursor: pushLoading ? "wait" : "pointer",
              color: pushEnabled ? C.green : C.textDim, fontSize: 12, fontWeight: 600,
              display: "flex", alignItems: "center", gap: 6, transition: "all 0.2s",
              opacity: pushLoading ? 0.6 : 1,
            }}>
              {pushEnabled ? <Smartphone size={14} /> : <BellOff size={14} />}
              {pushLoading ? "..." : pushEnabled ? "Push An" : "Push"}
            </button>

            {pushEnabled && (
              <button onClick={handleTestPush} disabled={testSending} style={{
                padding: "8px 14px", borderRadius: 10, border: `1px solid ${C.blue}30`,
                background: "transparent", cursor: testSending ? "wait" : "pointer",
                color: C.blue, fontSize: 12, fontWeight: 600,
                display: "flex", alignItems: "center", gap: 6, opacity: testSending ? 0.6 : 1,
              }}>
                <Send size={13} /> Test
              </button>
            )}

            {/* Refresh */}
            <button onClick={() => { loadResults(); loadStatus(); }} style={{
              padding: "8px 14px", borderRadius: 10, border: `1px solid ${C.accent}30`,
              background: "transparent", cursor: "pointer",
              color: C.accentLight, fontSize: 12, fontWeight: 600,
              display: "flex", alignItems: "center", gap: 6,
            }}>
              <RefreshCw size={14} /> Aktualisieren
            </button>
          </div>
        </div>

        {/* Scan Progress Bar */}
        {status && (
          <div style={{
            marginTop: 12, padding: "8px 12px", borderRadius: 8,
            background: `${C.accent}08`, border: `1px solid ${C.accent}15`,
            fontSize: 11, color: C.textMuted,
          }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 6 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{
                  width: 8, height: 8, borderRadius: "50%",
                  background: C.green,
                  animation: "pulse 2s ease-in-out infinite",
                }} />
                <span>
                  {status.scanMode === "dax-only" ? "DAX 40" : status.scanMode === "sp500-only" ? "S&P 500" : status.scanMode === "both" ? "DAX + S&P 500" : status.scanMode === "closed" ? "Markt geschlossen" : ""}
                  {status.scanMode !== "closed" && ` · Chunk ${status.currentChunk + 1}/${status.totalChunks}`}
                  {" · "}{status.totalSymbols} Symbole
                  {" · "}Cron alle 5 Min
                </span>
              </div>
              <div>
                {status.lastFullScan ? `Letzter voller Scan: ${formatTime(status.lastFullScan)}` : "Erster Zyklus laeuft..."}
                {status.lastRun && ` · Letzter Chunk: ${formatTime(status.lastRun)}`}
              </div>
            </div>
            {/* Visual chunk progress */}
            <div style={{ marginTop: 6, height: 3, borderRadius: 2, background: C.border, overflow: "hidden" }}>
              <div style={{
                height: "100%", borderRadius: 2,
                background: `linear-gradient(90deg, ${C.accent}, ${C.accentLight})`,
                width: `${((status.currentChunk + 1) / status.totalChunks) * 100}%`,
                transition: "width 0.5s",
              }} />
            </div>
            {status.stats && (
              <div style={{ marginTop: 4, fontSize: 10, color: C.textDim }}>
                Gesamt: {status.stats.totalScanned} gescannt · {status.stats.hits} Hits (Score ≥ {status.config?.threshold || 60}) · {status.stats.errors} Fehler
              </div>
            )}
          </div>
        )}
      </GlassCard>

      {/* Results Table */}
      <ResultsTable
        results={results}
        isMobile={isMobile}
        sortBy={sortBy}
        setSortBy={setSortBy}
        expandedRow={expandedRow}
        setExpandedRow={setExpandedRow}
        openTradeCheck={openTradeCheck}
        showCombined={true}
      />

      {/* Empty State */}
      {!loading && results.length === 0 && (
        <GlassCard style={{ textAlign: "center", padding: 40 }}>
          <BarChart3 size={32} color={C.accent} style={{ marginBottom: 12 }} />
          <div style={{ fontSize: 16, fontWeight: 700, color: C.text, marginBottom: 8 }}>
            Scanner wird initialisiert
          </div>
          <div style={{ fontSize: 13, color: C.textMuted, maxWidth: 400, margin: "0 auto" }}>
            Der Server scannt automatisch nach Boersenzeiten:
            DAX 08:30-20:00 Uhr, S&P 500 15:00-23:00 Uhr.
            Ergebnisse erscheinen hier automatisch.
          </div>
        </GlassCard>
      )}
    </>
  );
}

// ─── Custom Watchlist Tab (bestehende Funktionalitaet) ───
function CustomWatchlist({ isMobile, onNavigate }) {
  const [symbols, setSymbols] = useState(loadWatchlist);
  const [results, setResults] = useState(() => loadCachedResults() || []);
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [newSymbol, setNewSymbol] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [expandedRow, setExpandedRow] = useState(null);
  const [sortBy, setSortBy] = useState("swing");
  const [notificationsEnabled, setNotificationsEnabled] = useState(getNotificationStatus() === "granted");
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [lastScan, setLastScan] = useState(null);
  const intervalRef = useRef(null);

  // Push State
  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushLoading, setPushLoading] = useState(false);
  const [testSending, setTestSending] = useState(false);

  useEffect(() => { getPushSubscriptionStatus().then(setPushEnabled).catch(() => {}); }, []);
  useEffect(() => { saveWatchlist(symbols); }, [symbols]);
  useEffect(() => {
    if (pushEnabled && symbols.length > 0) syncWatchlistToServer(symbols);
  }, [symbols, pushEnabled]);

  useEffect(() => {
    if (autoRefresh && !scanning) {
      intervalRef.current = setInterval(() => { runScan(); }, 15 * 60 * 1000);
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [autoRefresh, symbols]);

  const runScan = useCallback(async () => {
    if (scanning || symbols.length === 0) return;
    setScanning(true);
    setProgress({ done: 0, total: symbols.length });
    try {
      const hasEU = symbols.some((s) => s.includes("."));
      const currency = hasEU ? "EUR" : "USD";
      const scanResults = await scanWatchlist(symbols, currency, (done, total) => { setProgress({ done, total }); });
      setResults(scanResults);
      saveCachedResults(scanResults);
      setLastScan(new Date());
      if (notificationsEnabled) checkAndNotify(scanResults);
    } catch (err) { console.error("Scan-Fehler:", err); }
    finally { setScanning(false); }
  }, [symbols, scanning, notificationsEnabled]);

  const togglePush = async () => {
    setPushLoading(true);
    try {
      if (!pushEnabled) {
        const granted = await requestNotificationPermission();
        if (!granted) { setPushLoading(false); return; }
        const sub = await subscribeToPush(symbols);
        if (sub) { setPushEnabled(true); setNotificationsEnabled(true); }
      } else {
        await unsubscribeFromPush();
        setPushEnabled(false);
      }
    } catch (e) { console.error("Push toggle error:", e); }
    finally { setPushLoading(false); }
  };

  const handleTestPush = async () => {
    setTestSending(true);
    try { await sendTestPush(); } catch (e) { console.error(e); }
    finally { setTestSending(false); }
  };

  const addSymbol = () => {
    const sym = newSymbol.trim().toUpperCase();
    if (sym && !symbols.includes(sym)) { setSymbols((prev) => [...prev, sym]); setNewSymbol(""); }
  };
  const removeSymbol = (sym) => { setSymbols((prev) => prev.filter((s) => s !== sym)); };
  const addPreset = (presetName) => {
    const preset = PRESETS[presetName];
    if (!preset) return;
    setSymbols((prev) => { const newSyms = preset.filter((s) => !prev.includes(s)); return [...prev, ...newSyms]; });
  };

  const openTradeCheck = (symbol, currency) => {
    localStorage.setItem("ncapital-prefill-symbol", symbol);
    if (currency) localStorage.setItem("ncapital-prefill-currency", currency);
    if (onNavigate) onNavigate("check");
  };

  return (
    <>
      {/* Header */}
      <GlassCard style={{ marginBottom: 20 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
          <div>
            <div style={{ fontSize: isMobile ? 18 : 22, fontWeight: 800, color: C.text }}>Custom Watchlist</div>
            <div style={{ fontSize: 12, color: C.textMuted, marginTop: 4 }}>
              {symbols.length} Symbole · {results.length > 0 ? `Letzter Scan: ${lastScan ? lastScan.toLocaleTimeString("de-DE") : "gecacht"}` : "Noch nicht gescannt"}
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button onClick={togglePush} disabled={pushLoading} style={{
              padding: "8px 14px", borderRadius: 10, border: `1px solid ${pushEnabled ? C.green : C.border}30`,
              background: pushEnabled ? `${C.green}10` : "transparent", cursor: pushLoading ? "wait" : "pointer",
              color: pushEnabled ? C.green : C.textDim, fontSize: 12, fontWeight: 600,
              display: "flex", alignItems: "center", gap: 6, opacity: pushLoading ? 0.6 : 1,
            }}>
              {pushEnabled ? <Smartphone size={14} /> : <BellOff size={14} />}
              {pushLoading ? "..." : pushEnabled ? "Push An" : "Push"}
            </button>
            {pushEnabled && (
              <button onClick={handleTestPush} disabled={testSending} style={{
                padding: "8px 14px", borderRadius: 10, border: `1px solid ${C.blue}30`,
                background: "transparent", cursor: testSending ? "wait" : "pointer",
                color: C.blue, fontSize: 12, fontWeight: 600,
                display: "flex", alignItems: "center", gap: 6, opacity: testSending ? 0.6 : 1,
              }}>
                <Send size={13} /> Test
              </button>
            )}
            <button onClick={() => setAutoRefresh(!autoRefresh)} style={{
              padding: "8px 14px", borderRadius: 10, border: `1px solid ${autoRefresh ? C.accent : C.border}30`,
              background: autoRefresh ? `${C.accent}10` : "transparent", cursor: "pointer",
              color: autoRefresh ? C.accentLight : C.textDim, fontSize: 12, fontWeight: 600,
              display: "flex", alignItems: "center", gap: 6,
            }}>
              <RefreshCw size={14} style={{ animation: autoRefresh ? "spin 3s linear infinite" : "none" }} />
              {autoRefresh ? "Auto 15m" : "Auto"}
            </button>
            <button onClick={runScan} disabled={scanning || symbols.length === 0} style={{
              padding: "10px 20px", borderRadius: 10, border: "none", cursor: scanning ? "wait" : "pointer",
              background: `linear-gradient(135deg, ${C.accent}, ${C.accentLight})`,
              color: "#fff", fontSize: 13, fontWeight: 700,
              display: "flex", alignItems: "center", gap: 8, opacity: scanning ? 0.7 : 1,
            }}>
              {scanning ? (
                <>
                  <div style={{ width: 14, height: 14, border: "2px solid rgba(255,255,255,0.3)", borderTopColor: "#fff", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
                  {progress.done}/{progress.total}
                </>
              ) : (
                <><Play size={14} /> Scan</>
              )}
            </button>
          </div>
        </div>
        {scanning && (
          <div style={{ marginTop: 12, height: 4, borderRadius: 2, background: C.border, overflow: "hidden" }}>
            <div style={{
              height: "100%", borderRadius: 2, background: `linear-gradient(90deg, ${C.accent}, ${C.accentLight})`,
              width: `${progress.total > 0 ? (progress.done / progress.total) * 100 : 0}%`, transition: "width 0.3s",
            }} />
          </div>
        )}
      </GlassCard>

      {/* Symbol Manager */}
      <GlassCard style={{ marginBottom: 20 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: C.text }}>Symbole ({symbols.length})</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {Object.keys(PRESETS).map((name) => (
              <button key={name} onClick={() => addPreset(name)} style={{
                padding: "4px 10px", borderRadius: 6, border: `1px solid ${C.border}`,
                background: "transparent", color: C.textMuted, fontSize: 11, fontWeight: 600, cursor: "pointer",
              }}>+ {name}</button>
            ))}
          </div>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
          {symbols.map((sym) => (
            <div key={sym} style={{
              display: "flex", alignItems: "center", gap: 4, padding: "4px 10px",
              borderRadius: 8, background: `${C.accent}10`, border: `1px solid ${C.accent}20`,
              fontSize: 12, fontWeight: 600, color: C.accentLight,
            }}>
              {sym}
              <X size={12} style={{ cursor: "pointer", opacity: 0.6 }} onClick={() => removeSymbol(sym)} />
            </div>
          ))}
          {showAdd ? (
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <input value={newSymbol} onChange={(e) => setNewSymbol(e.target.value.toUpperCase())}
                onKeyDown={(e) => { if (e.key === "Enter") addSymbol(); if (e.key === "Escape") setShowAdd(false); }}
                placeholder="AAPL" autoFocus
                style={{ width: 80, padding: "4px 8px", borderRadius: 6, border: `1px solid ${C.accent}40`, background: "rgba(10,13,17,0.6)", color: C.text, fontSize: 12, fontWeight: 600, outline: "none" }}
              />
              <button onClick={addSymbol} style={{ padding: "4px 8px", borderRadius: 6, border: "none", background: C.accent, color: "#fff", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>OK</button>
              <X size={14} color={C.textDim} style={{ cursor: "pointer" }} onClick={() => setShowAdd(false)} />
            </div>
          ) : (
            <button onClick={() => setShowAdd(true)} style={{
              display: "flex", alignItems: "center", gap: 4, padding: "4px 10px",
              borderRadius: 8, border: `1px dashed ${C.border}`,
              background: "transparent", color: C.textDim, fontSize: 12, fontWeight: 600, cursor: "pointer",
            }}>
              <Plus size={12} /> Hinzufuegen
            </button>
          )}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => setSymbols([])} style={{
            padding: "4px 10px", borderRadius: 6, border: `1px solid ${C.red}20`,
            background: "transparent", color: C.red, fontSize: 11, fontWeight: 600,
            cursor: "pointer", display: "flex", alignItems: "center", gap: 4, opacity: 0.7,
          }}>
            <Trash2 size={11} /> Alle entfernen
          </button>
        </div>
      </GlassCard>

      {/* Results */}
      <ResultsTable
        results={results}
        isMobile={isMobile}
        sortBy={sortBy}
        setSortBy={setSortBy}
        expandedRow={expandedRow}
        setExpandedRow={setExpandedRow}
        openTradeCheck={openTradeCheck}
        showCombined={false}
      />

      {!scanning && results.length === 0 && symbols.length > 0 && (
        <GlassCard style={{ textAlign: "center", padding: 40 }}>
          <Zap size={32} color={C.accent} style={{ marginBottom: 12 }} />
          <div style={{ fontSize: 16, fontWeight: 700, color: C.text, marginBottom: 8 }}>Bereit zum Scannen</div>
          <div style={{ fontSize: 13, color: C.textMuted, marginBottom: 16 }}>
            Klicke "Scan" um {symbols.length} Symbole auf Swing- und Intraday-Setups zu pruefen.
          </div>
          <button onClick={runScan} style={{
            padding: "12px 24px", borderRadius: 10, border: "none",
            background: `linear-gradient(135deg, ${C.accent}, ${C.accentLight})`,
            color: "#fff", fontSize: 14, fontWeight: 700, cursor: "pointer",
            display: "inline-flex", alignItems: "center", gap: 8,
          }}>
            <Play size={16} /> Scan starten
          </button>
        </GlassCard>
      )}

      {symbols.length === 0 && (
        <GlassCard style={{ textAlign: "center", padding: 40 }}>
          <AlertTriangle size={32} color={C.yellow} style={{ marginBottom: 12 }} />
          <div style={{ fontSize: 16, fontWeight: 700, color: C.text, marginBottom: 8 }}>Keine Symbole</div>
          <div style={{ fontSize: 13, color: C.textMuted, marginBottom: 16 }}>Fuege Symbole hinzu oder waehle ein Preset.</div>
          <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
            {Object.keys(PRESETS).map((name) => (
              <button key={name} onClick={() => addPreset(name)} style={{
                padding: "10px 16px", borderRadius: 10, border: `1px solid ${C.accent}30`,
                background: `${C.accent}10`, color: C.accentLight, fontSize: 13, fontWeight: 700, cursor: "pointer",
              }}>{name}</button>
            ))}
          </div>
        </GlassCard>
      )}
    </>
  );
}

// ─── TA-Picks Tab (Composite Score LONG — same data as Telegram Push) ───

const PROXY_BASE = "https://ncapital-market-proxy.nils-noeller.workers.dev";

function TAPicksTab({ isMobile, onNavigate }) {
  const [picks, setPicks] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchPicks = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const resp = await authFetch(`${PROXY_BASE}/api/scan/ta-picks`);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      setPicks(data.picks || []);
      setStats(data.stats || null);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchPicks(); }, [fetchPicks]);

  const fmtP = (v) => v >= 100 ? v.toFixed(0) : v.toFixed(2);
  const confColor = (c) => c === "STRONG BUY" ? C.green : c === "BUY" ? "#00D68F" : C.yellow;

  const regime = stats?.marketRegime;
  const sp500Bull = regime?.sp500 === "bullish";
  const daxBull = regime?.dax === "bullish";

  return (
    <>
      <GlassCard>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Target size={18} style={{ color: C.accent }} />
            <h3 style={{ margin: 0, color: C.text, fontSize: 16, fontWeight: 700 }}>TA-Picks: Optimierte LONG Kandidaten</h3>
          </div>
          <button onClick={fetchPicks} disabled={loading} style={{
            background: "transparent", border: `1px solid ${C.border}`, borderRadius: 8,
            padding: "6px 12px", color: C.textMuted, cursor: "pointer", fontSize: 12,
            display: "flex", alignItems: "center", gap: 4,
          }}>
            <RefreshCw size={12} style={{ animation: loading ? "spin 1s linear infinite" : "none" }} />
            Aktualisieren
          </button>
        </div>

        {/* Market Regime */}
        {regime && (
          <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
            <span style={{
              fontSize: 10, fontWeight: 600, borderRadius: 5, padding: "2px 8px",
              color: sp500Bull ? C.green : C.red,
              background: `${sp500Bull ? C.green : C.red}12`,
              border: `1px solid ${sp500Bull ? C.green : C.red}25`,
            }}>
              S&P 500 {sp500Bull ? "\u2713 \u00FCber" : "\u2717 unter"} SMA200
            </span>
            <span style={{
              fontSize: 10, fontWeight: 600, borderRadius: 5, padding: "2px 8px",
              color: daxBull ? C.green : C.red,
              background: `${daxBull ? C.green : C.red}12`,
              border: `1px solid ${daxBull ? C.green : C.red}25`,
            }}>
              DAX {daxBull ? "\u2713 \u00FCber" : "\u2717 unter"} SMA200
            </span>
          </div>
        )}

        {/* Filter Chips */}
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 8 }}>
          {["Score \u2265 7.5", "RS 0\u201315%", "EMA20 < 2 ATR", "Index > SMA200", "Max 2/Sektor"].map((f) => (
            <span key={f} style={{
              fontSize: 9, color: C.accent, background: `${C.accent}10`, borderRadius: 4, padding: "1px 5px",
              border: `1px solid ${C.accent}20`,
            }}>{f}</span>
          ))}
        </div>

        <div style={{ color: C.textMuted, fontSize: 11, marginBottom: 4 }}>
          Backtest-optimiert (PF 1.56 {"\u2022"} WR 57% {"\u2022"} MaxDD -4.5%) {"\u2022"} Depot EUR 45k
          {stats && <span> {"\u2022"} {stats.totalScanned} gescannt, {stats.unfilteredPicks || stats.longPicks} unfiltered {"\u2192"} {stats.longPicks} Picks</span>}
        </div>
      </GlassCard>

      {/* Loading / Error / Empty */}
      {loading && (
        <div style={{ textAlign: "center", padding: 40, color: C.textMuted }}>
          <RefreshCw size={20} style={{ animation: "spin 1s linear infinite", marginBottom: 8 }} />
          <div>Lade TA-Picks...</div>
        </div>
      )}
      {error && (
        <div style={{ textAlign: "center", padding: 40, color: C.red }}>
          <AlertTriangle size={20} style={{ marginBottom: 8 }} />
          <div>Fehler: {error}</div>
        </div>
      )}
      {!loading && !error && picks.length === 0 && (
        <GlassCard style={{ textAlign: "center", padding: 40 }}>
          <div style={{ color: C.textMuted, fontSize: 14 }}>Keine Picks verfügbar</div>
          <div style={{ color: C.textDim, fontSize: 12, marginTop: 4 }}>Daten werden während der Handelszeiten aktualisiert (Mo–Fr 10–23 Uhr)</div>
        </GlassCard>
      )}

      {/* Pick Cards */}
      {!loading && picks.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 12, marginTop: 12 }}>
          {picks.map((r, i) => {
            const c = r.composite;
            const tp = c?.tradePlan;
            if (!c || !tp) return null;

            const range = tp.target - tp.stop;
            const entryPos = range > 0 ? ((tp.entry - tp.stop) / range) * 100 : 50;

            return (
              <GlassCard key={i} style={{ padding: 16 }}>
                {/* Header */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: C.textDim, background: `${C.accent}15`, borderRadius: 6, padding: "2px 7px" }}>#{i + 1}</span>
                    <span style={{ color: C.text, fontSize: 18, fontWeight: 700 }}>{r.displaySymbol}</span>
                    <span style={{ color: C.textDim, fontSize: 11 }}>{r.currency}</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ fontSize: 14, fontWeight: 700, color: confColor(c.confidence), background: `${confColor(c.confidence)}15`, padding: "3px 10px", borderRadius: 6 }}>
                      {c.compositeScore}
                    </span>
                  </div>
                </div>

                {/* Price + Change */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                  <span style={{ color: C.text, fontSize: 15, fontWeight: 600, fontFamily: "monospace" }}>{fmtP(r.price)}</span>
                  <span style={{ fontSize: 13, fontWeight: 600, color: r.change >= 0 ? C.green : C.red }}>
                    {r.change >= 0 ? "+" : ""}{r.change?.toFixed(2)}%
                  </span>
                </div>

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
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: C.textMuted, marginBottom: 8 }}>
                  <span>R:R <b style={{ color: tp.rr >= 2 ? C.green : C.yellow }}>{tp.rr}</b></span>
                  <span>{tp.shares} Stk.</span>
                  <span>Risiko {"\u20AC"}{tp.riskTotal?.toFixed(0) || "450"}</span>
                  <span>ATR {fmtP(r.atr || tp.atr || 0)}</span>
                </div>

                {/* RS + EMA20 Badges */}
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
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

                {/* Trade Check Button */}
                {onNavigate && (
                  <button onClick={() => onNavigate("tradecheck", r.displaySymbol)} style={{
                    marginTop: 10, width: "100%", padding: "8px 0", borderRadius: 10, border: `1px solid ${C.accent}30`,
                    background: `${C.accent}08`, color: C.accent, fontSize: 12, fontWeight: 600, cursor: "pointer",
                  }}>
                    Trade Check starten {"\u2192"}
                  </button>
                )}
              </GlassCard>
            );
          })}
        </div>
      )}
    </>
  );
}

// ─── Main Watchlist Component ───
export default function Watchlist({ onNavigate }) {
  const [activeTab, setActiveTab] = useState(() => localStorage.getItem(TAB_KEY) || "tapicks");
  const isMobile = typeof window !== "undefined" && window.innerWidth < 600;

  useEffect(() => { localStorage.setItem(TAB_KEY, activeTab); }, [activeTab]);

  const tabStyle = (id) => ({
    padding: isMobile ? "8px 14px" : "10px 20px", borderRadius: 10, border: "none", cursor: "pointer",
    background: activeTab === id ? `linear-gradient(135deg, ${C.accent}, ${C.accentLight})` : "transparent",
    color: activeTab === id ? "#fff" : C.textMuted,
    fontSize: 13, fontWeight: 700, display: "flex", alignItems: "center", gap: 6,
    transition: "all 0.2s",
  });

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto" }}>
      {/* Tab Toggle */}
      <div style={{
        display: "flex", gap: 4, marginBottom: 20, padding: 4, borderRadius: 12,
        background: C.card, border: `1px solid ${C.border}`, width: "fit-content",
      }}>
        <button onClick={() => setActiveTab("tapicks")} style={tabStyle("tapicks")}>
          <Target size={15} />
          TA-Picks
        </button>
        <button onClick={() => setActiveTab("index")} style={tabStyle("index")}>
          <Globe size={15} />
          {isMobile ? "Scanner" : "Index Scanner"}
        </button>
        <button onClick={() => setActiveTab("custom")} style={tabStyle("custom")}>
          <List size={15} />
          Watchlist
        </button>
      </div>

      {/* Active Tab Content */}
      {activeTab === "tapicks"
        ? <TAPicksTab isMobile={isMobile} onNavigate={onNavigate} />
        : activeTab === "index"
        ? <IndexScanner isMobile={isMobile} onNavigate={onNavigate} />
        : <CustomWatchlist isMobile={isMobile} onNavigate={onNavigate} />
      }

      <style>{`
        @keyframes spin { to { transform: rotate(360deg) } }
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
      `}</style>
    </div>
  );
}
