// ─── Watchlist Component ───
// Zwei Modi: TA-Picks (Composite Score LONG Picks) und Watchlist (Finviz-Charts + Performance-Tracking).

import React, { useState, useEffect, useCallback } from "react";
import { Target, RefreshCw, Plus, X, AlertTriangle, List, Bookmark, BookmarkCheck } from "lucide-react";
import { authFetch } from "../services/auth";
import { getFinvizChartUrl, isFinvizAvailable } from "../services/marketData";

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
const TAB_KEY = "ncapital-watchlist-tab";
const PROXY_BASE = "https://ncapital-market-proxy.nils-noeller.workers.dev";

// ── Watchlist Storage (new format: objects with metadata) ──
function loadWatchlist() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return [];
    const parsed = JSON.parse(saved);
    if (!Array.isArray(parsed)) return [];
    // Migration: if old format (string array), convert to new format
    if (parsed.length > 0 && typeof parsed[0] === "string") {
      return parsed.map(sym => ({ symbol: sym, addedAt: null, addedPrice: null }));
    }
    return parsed;
  } catch { return []; }
}
function saveWatchlist(items) { localStorage.setItem(STORAGE_KEY, JSON.stringify(items)); }

function GlassCard({ children, style }) {
  return (
    <div style={{ background: C.card, borderRadius: 16, padding: 20, border: `1px solid ${C.border}`, ...style }}>
      {children}
    </div>
  );
}

// ─── TA-Picks Tab (Composite Score LONG — same data as Telegram Push) ───

function TAPicksTab({ isMobile, onNavigate }) {
  const [picks, setPicks] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [watchlist, setWatchlist] = useState(loadWatchlist);

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

  const isInWatchlist = (symbol) => watchlist.some(w => w.symbol === symbol);

  const toggleWatchlist = (pick) => {
    setWatchlist(prev => {
      const exists = prev.some(w => w.symbol === pick.symbol);
      let next;
      if (exists) {
        next = prev.filter(w => w.symbol !== pick.symbol);
      } else {
        next = [...prev, {
          symbol: pick.symbol,
          addedAt: new Date().toISOString().split("T")[0],
          addedPrice: pick.price || null,
        }];
      }
      saveWatchlist(next);
      return next;
    });
  };

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
          <div style={{ color: C.textMuted, fontSize: 14 }}>Keine Picks verfuegbar</div>
          <div style={{ color: C.textDim, fontSize: 12, marginTop: 4 }}>Daten werden waehrend der Handelszeiten aktualisiert (Mo-Fr 10-23 Uhr)</div>
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
            const inWl = isInWatchlist(r.symbol);

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
                    {/* Watchlist Bookmark Button */}
                    <button onClick={() => toggleWatchlist(r)} title={inWl ? "Aus Watchlist entfernen" : "Zur Watchlist"} style={{
                      background: inWl ? `${C.accent}20` : "transparent", border: `1px solid ${inWl ? C.accent : C.border}40`,
                      borderRadius: 8, padding: "4px 6px", cursor: "pointer", display: "flex", alignItems: "center",
                    }}>
                      {inWl ? <BookmarkCheck size={16} color={C.accent} /> : <Bookmark size={16} color={C.textDim} />}
                    </button>
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

                {/* Sector Comparison (informational) */}
                {r.sector && r.sectorAvgChange != null && r.change != null && (
                  <div style={{ marginTop: 6 }}>
                    <span style={{
                      fontSize: 10, borderRadius: 5, padding: "2px 6px",
                      color: r.change > r.sectorAvgChange ? C.green : r.change < r.sectorAvgChange ? C.red : C.textDim,
                      background: `${r.change > r.sectorAvgChange ? C.green : r.change < r.sectorAvgChange ? C.red : C.textDim}10`,
                    }}>
                      {r.displaySymbol} {r.change >= 0 ? "+" : ""}{r.change.toFixed(1)}% vs {r.sector} {r.sectorAvgChange >= 0 ? "+" : ""}{r.sectorAvgChange.toFixed(1)}%
                    </span>
                  </div>
                )}

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

// ─── Watchlist Tab (Finviz-Charts + Performance-Tracking) ───

function WatchlistTab({ isMobile }) {
  const [watchlist, setWatchlist] = useState(loadWatchlist);
  const [newSymbol, setNewSymbol] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [taPicks, setTaPicks] = useState([]);
  const [chartErrors, setChartErrors] = useState({});

  // Fetch TA-Picks data to overlay on watchlist cards
  useEffect(() => {
    (async () => {
      try {
        const resp = await authFetch(`${PROXY_BASE}/api/scan/ta-picks`);
        if (resp.ok) {
          const data = await resp.json();
          setTaPicks(data.picks || []);
        }
      } catch {}
    })();
  }, []);

  useEffect(() => { saveWatchlist(watchlist); }, [watchlist]);

  const addSymbol = () => {
    const sym = newSymbol.trim().toUpperCase();
    if (sym && !watchlist.some(w => w.symbol === sym)) {
      setWatchlist(prev => [...prev, { symbol: sym, addedAt: new Date().toISOString().split("T")[0], addedPrice: null }]);
      setNewSymbol("");
    }
  };

  const removeSymbol = (sym) => {
    setWatchlist(prev => prev.filter(w => w.symbol !== sym));
  };

  const addPreset = (presetName) => {
    const preset = PRESETS[presetName];
    if (!preset) return;
    setWatchlist(prev => {
      const existingSyms = new Set(prev.map(w => w.symbol));
      const newItems = preset.filter(s => !existingSyms.has(s)).map(s => ({ symbol: s, addedAt: new Date().toISOString().split("T")[0], addedPrice: null }));
      const next = [...prev, ...newItems];
      saveWatchlist(next);
      return next;
    });
  };

  // Build TA-Picks lookup
  const pickMap = {};
  for (const p of taPicks) {
    pickMap[p.symbol] = p;
  }

  const fmtP = (v) => v == null ? "\u2013" : v >= 100 ? v.toFixed(0) : v.toFixed(2);
  const fmtDate = (iso) => {
    if (!iso) return "\u2013";
    const parts = iso.split("-");
    return `${parts[2]}.${parts[1]}.`;
  };

  return (
    <>
      {/* Symbol Manager */}
      <GlassCard style={{ marginBottom: 20 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: C.text }}>Symbole ({watchlist.length})</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {Object.keys(PRESETS).map((name) => (
              <button key={name} onClick={() => addPreset(name)} style={{
                padding: "4px 10px", borderRadius: 6, border: `1px solid ${C.border}`,
                background: "transparent", color: C.textMuted, fontSize: 11, fontWeight: 600, cursor: "pointer",
              }}>+ {name}</button>
            ))}
          </div>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
          {watchlist.map((w) => (
            <div key={w.symbol} style={{
              display: "flex", alignItems: "center", gap: 4, padding: "4px 10px",
              borderRadius: 8, background: pickMap[w.symbol] ? `${C.green}10` : `${C.accent}10`,
              border: `1px solid ${pickMap[w.symbol] ? C.green : C.accent}20`,
              fontSize: 12, fontWeight: 600, color: pickMap[w.symbol] ? C.green : C.accentLight,
            }}>
              {pickMap[w.symbol] && <Target size={10} />}
              {w.symbol}
              <X size={12} style={{ cursor: "pointer", opacity: 0.6 }} onClick={() => removeSymbol(w.symbol)} />
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
      </GlassCard>

      {/* Chart Grid */}
      {watchlist.length === 0 ? (
        <GlassCard style={{ textAlign: "center", padding: 40 }}>
          <AlertTriangle size={32} color={C.yellow} style={{ marginBottom: 12 }} />
          <div style={{ fontSize: 16, fontWeight: 700, color: C.text, marginBottom: 8 }}>Keine Symbole</div>
          <div style={{ fontSize: 13, color: C.textMuted, marginBottom: 16 }}>Fuege Symbole hinzu, nutze Presets oder uebernimm Picks aus dem TA-Picks Tab.</div>
          <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
            {Object.keys(PRESETS).map((name) => (
              <button key={name} onClick={() => addPreset(name)} style={{
                padding: "10px 16px", borderRadius: 10, border: `1px solid ${C.accent}30`,
                background: `${C.accent}10`, color: C.accentLight, fontSize: 13, fontWeight: 700, cursor: "pointer",
              }}>{name}</button>
            ))}
          </div>
        </GlassCard>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 12 }}>
          {watchlist.map((w) => {
            const pick = pickMap[w.symbol];
            const hasChart = isFinvizAvailable(w.symbol);
            const currentPrice = pick?.price || null;
            const perfPct = w.addedPrice && currentPrice ? ((currentPrice - w.addedPrice) / w.addedPrice * 100) : null;
            const chartHidden = chartErrors[w.symbol];

            return (
              <GlassCard key={w.symbol} style={{ padding: 0, overflow: "hidden" }}>
                {/* Header */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px 8px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ color: C.text, fontSize: 18, fontWeight: 700 }}>{w.symbol}</span>
                    {pick && (
                      <span style={{ fontSize: 9, fontWeight: 700, color: C.green, background: `${C.green}15`, borderRadius: 4, padding: "1px 6px" }}>TA-Pick</span>
                    )}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    {w.addedAt && (
                      <span style={{ fontSize: 10, color: C.textDim }}>seit {fmtDate(w.addedAt)}</span>
                    )}
                    <button onClick={() => removeSymbol(w.symbol)} style={{
                      background: "transparent", border: "none", cursor: "pointer", color: C.textDim, padding: 2, display: "flex",
                    }}>
                      <X size={16} />
                    </button>
                  </div>
                </div>

                {/* Finviz Chart */}
                {hasChart && !chartHidden && (
                  <div style={{ padding: "0 16px", marginBottom: 8 }}>
                    <img
                      src={getFinvizChartUrl(w.symbol)}
                      alt={`${w.symbol} Chart`}
                      style={{ width: "100%", borderRadius: 8, display: "block" }}
                      onError={() => setChartErrors(prev => ({ ...prev, [w.symbol]: true }))}
                    />
                  </div>
                )}
                {!hasChart && (
                  <div style={{ padding: "20px 16px", textAlign: "center", color: C.textDim, fontSize: 12 }}>
                    Finviz-Chart nicht verfuegbar (nur US-Aktien)
                  </div>
                )}

                {/* Performance + Info */}
                <div style={{ padding: "8px 16px 12px" }}>
                  {/* Price performance since added */}
                  {(w.addedPrice != null || currentPrice != null) && (
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                      {w.addedPrice != null && (
                        <span style={{ fontSize: 13, color: C.textMuted, fontFamily: "monospace" }}>{fmtP(w.addedPrice)}</span>
                      )}
                      {w.addedPrice != null && currentPrice != null && (
                        <span style={{ fontSize: 11, color: C.textDim }}>{"\u2192"}</span>
                      )}
                      {currentPrice != null && (
                        <span style={{ fontSize: 13, color: C.text, fontWeight: 600, fontFamily: "monospace" }}>{fmtP(currentPrice)}</span>
                      )}
                      {perfPct != null && (
                        <span style={{
                          fontSize: 12, fontWeight: 700,
                          color: perfPct >= 0 ? C.green : C.red,
                          background: `${perfPct >= 0 ? C.green : C.red}12`,
                          borderRadius: 5, padding: "1px 6px",
                        }}>
                          {perfPct >= 0 ? "+" : ""}{perfPct.toFixed(1)}%
                        </span>
                      )}
                    </div>
                  )}

                  {/* TA-Pick details if match */}
                  {pick && (
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      <span style={{ fontSize: 10, color: C.accent, background: `${C.accent}12`, borderRadius: 5, padding: "2px 6px" }}>
                        Score {pick.composite?.compositeScore}
                      </span>
                      {pick.composite?.tradePlan?.rr && (
                        <span style={{ fontSize: 10, color: pick.composite.tradePlan.rr >= 2 ? C.green : C.yellow, background: `${pick.composite.tradePlan.rr >= 2 ? C.green : C.yellow}12`, borderRadius: 5, padding: "2px 6px" }}>
                          R:R {pick.composite.tradePlan.rr}
                        </span>
                      )}
                      {pick.composite?.tradePlan && (
                        <span style={{ fontSize: 10, color: C.textDim, background: `${C.textDim}10`, borderRadius: 5, padding: "2px 6px" }}>
                          E {fmtP(pick.composite.tradePlan.entry)} / S {fmtP(pick.composite.tradePlan.stop)} / Z {fmtP(pick.composite.tradePlan.target)}
                        </span>
                      )}
                    </div>
                  )}

                  {/* Sector comparison */}
                  {pick?.sector && pick.sectorAvgChange != null && pick.change != null && (
                    <div style={{ marginTop: 4 }}>
                      <span style={{
                        fontSize: 10, borderRadius: 5, padding: "2px 6px",
                        color: pick.change > pick.sectorAvgChange ? C.green : pick.change < pick.sectorAvgChange ? C.red : C.textDim,
                        background: `${pick.change > pick.sectorAvgChange ? C.green : pick.change < pick.sectorAvgChange ? C.red : C.textDim}10`,
                      }}>
                        {w.symbol} {pick.change >= 0 ? "+" : ""}{pick.change.toFixed(1)}% vs {pick.sector} {pick.sectorAvgChange >= 0 ? "+" : ""}{pick.sectorAvgChange.toFixed(1)}%
                      </span>
                    </div>
                  )}
                </div>
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
        <button onClick={() => setActiveTab("watchlist")} style={tabStyle("watchlist")}>
          <List size={15} />
          Watchlist
        </button>
      </div>

      {/* Active Tab Content */}
      {activeTab === "tapicks"
        ? <TAPicksTab isMobile={isMobile} onNavigate={onNavigate} />
        : <WatchlistTab isMobile={isMobile} />
      }

      <style>{`
        @keyframes spin { to { transform: rotate(360deg) } }
      `}</style>
    </div>
  );
}
