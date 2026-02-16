// ─── Watchlist Component ───
// Scanner fuer Swing- und Intraday-Setups mit Browser-Benachrichtigungen.

import React, { useState, useEffect, useCallback, useRef } from "react";
import { Zap, Bell, BellOff, RefreshCw, Plus, X, ChevronDown, ChevronUp, TrendingUp, Activity, AlertTriangle, CheckCircle, Trash2, Play, Search } from "lucide-react";
import { scanWatchlist } from "../services/watchlistScanner";
import { requestNotificationPermission, getNotificationStatus, checkAndNotify } from "../services/notifications";

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

function loadWatchlist() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? JSON.parse(saved) : PRESETS["US Large Cap"];
  } catch { return PRESETS["US Large Cap"]; }
}

function saveWatchlist(symbols) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(symbols));
}

function loadCachedResults() {
  try {
    const saved = localStorage.getItem(RESULTS_KEY);
    if (!saved) return null;
    const parsed = JSON.parse(saved);
    // Max 4h alte Results verwenden
    if (parsed.timestamp && Date.now() - parsed.timestamp < 4 * 60 * 60 * 1000) {
      return parsed.results;
    }
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

export default function Watchlist({ onNavigate }) {
  const [symbols, setSymbols] = useState(loadWatchlist);
  const [results, setResults] = useState(() => loadCachedResults() || []);
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [newSymbol, setNewSymbol] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [expandedRow, setExpandedRow] = useState(null);
  const [sortBy, setSortBy] = useState("swing"); // "swing" | "intraday" | "change"
  const [notificationsEnabled, setNotificationsEnabled] = useState(getNotificationStatus() === "granted");
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [lastScan, setLastScan] = useState(null);
  const intervalRef = useRef(null);
  const isMobile = typeof window !== "undefined" && window.innerWidth < 600;

  // Symbole speichern wenn sie sich aendern
  useEffect(() => { saveWatchlist(symbols); }, [symbols]);

  // Auto-Refresh
  useEffect(() => {
    if (autoRefresh && !scanning) {
      intervalRef.current = setInterval(() => {
        runScan();
      }, 15 * 60 * 1000); // 15 Min
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [autoRefresh, symbols]);

  const runScan = useCallback(async () => {
    if (scanning || symbols.length === 0) return;
    setScanning(true);
    setProgress({ done: 0, total: symbols.length });

    try {
      // Waehrung bestimmen: Wenn .DE Symbole dabei, EUR; sonst USD
      const hasEU = symbols.some((s) => s.includes("."));
      const currency = hasEU ? "EUR" : "USD";

      const scanResults = await scanWatchlist(symbols, currency, (done, total) => {
        setProgress({ done, total });
      });

      setResults(scanResults);
      saveCachedResults(scanResults);
      setLastScan(new Date());

      // Benachrichtigungen pruefen
      if (notificationsEnabled) {
        checkAndNotify(scanResults);
      }
    } catch (err) {
      console.error("Scan-Fehler:", err);
    } finally {
      setScanning(false);
    }
  }, [symbols, scanning, notificationsEnabled]);

  const toggleNotifications = async () => {
    if (!notificationsEnabled) {
      const granted = await requestNotificationPermission();
      setNotificationsEnabled(granted);
    } else {
      setNotificationsEnabled(false);
    }
  };

  const addSymbol = () => {
    const sym = newSymbol.trim().toUpperCase();
    if (sym && !symbols.includes(sym)) {
      setSymbols((prev) => [...prev, sym]);
      setNewSymbol("");
    }
  };

  const removeSymbol = (sym) => {
    setSymbols((prev) => prev.filter((s) => s !== sym));
  };

  const addPreset = (presetName) => {
    const preset = PRESETS[presetName];
    if (!preset) return;
    setSymbols((prev) => {
      const newSyms = preset.filter((s) => !prev.includes(s));
      return [...prev, ...newSyms];
    });
  };

  const sortedResults = [...results].sort((a, b) => {
    if (sortBy === "swing") return b.swing.total - a.swing.total;
    if (sortBy === "intraday") return b.intraday.total - a.intraday.total;
    if (sortBy === "change") return b.change - a.change;
    return 0;
  });

  const openTradeCheck = (symbol) => {
    // Symbol in localStorage speichern fuer TradeCheck
    localStorage.setItem("ncapital-prefill-symbol", symbol);
    if (onNavigate) onNavigate("check");
  };

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto" }}>
      {/* Header */}
      <GlassCard style={{ marginBottom: 20 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
          <div>
            <div style={{ fontSize: isMobile ? 20 : 24, fontWeight: 800, color: C.text }}>Watchlist Scanner</div>
            <div style={{ fontSize: 13, color: C.textMuted, marginTop: 4 }}>
              {symbols.length} Symbole · {results.length > 0 ? `Letzter Scan: ${lastScan ? lastScan.toLocaleTimeString("de-DE") : "gecacht"}` : "Noch nicht gescannt"}
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {/* Notifications Toggle */}
            <button onClick={toggleNotifications} style={{
              padding: "8px 14px", borderRadius: 10, border: `1px solid ${notificationsEnabled ? C.green : C.border}30`,
              background: notificationsEnabled ? `${C.green}10` : "transparent", cursor: "pointer",
              color: notificationsEnabled ? C.green : C.textDim, fontSize: 12, fontWeight: 600,
              display: "flex", alignItems: "center", gap: 6, transition: "all 0.2s",
            }}>
              {notificationsEnabled ? <Bell size={14} /> : <BellOff size={14} />}
              {notificationsEnabled ? "Alerts An" : "Alerts"}
            </button>

            {/* Auto-Refresh Toggle */}
            <button onClick={() => setAutoRefresh(!autoRefresh)} style={{
              padding: "8px 14px", borderRadius: 10, border: `1px solid ${autoRefresh ? C.accent : C.border}30`,
              background: autoRefresh ? `${C.accent}10` : "transparent", cursor: "pointer",
              color: autoRefresh ? C.accentLight : C.textDim, fontSize: 12, fontWeight: 600,
              display: "flex", alignItems: "center", gap: 6, transition: "all 0.2s",
            }}>
              <RefreshCw size={14} style={{ animation: autoRefresh ? "spin 3s linear infinite" : "none" }} />
              {autoRefresh ? "Auto 15m" : "Auto"}
            </button>

            {/* Scan Button */}
            <button onClick={runScan} disabled={scanning || symbols.length === 0} style={{
              padding: "10px 20px", borderRadius: 10, border: "none", cursor: scanning ? "wait" : "pointer",
              background: `linear-gradient(135deg, ${C.accent}, ${C.accentLight})`,
              color: "#fff", fontSize: 13, fontWeight: 700,
              display: "flex", alignItems: "center", gap: 8, transition: "all 0.2s",
              opacity: scanning ? 0.7 : 1,
            }}>
              {scanning ? (
                <>
                  <div style={{ width: 14, height: 14, border: "2px solid rgba(255,255,255,0.3)", borderTopColor: "#fff", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
                  {progress.done}/{progress.total}
                </>
              ) : (
                <><Play size={14} /> Scan starten</>
              )}
            </button>
          </div>
        </div>

        {/* Progress Bar */}
        {scanning && (
          <div style={{ marginTop: 12, height: 4, borderRadius: 2, background: C.border, overflow: "hidden" }}>
            <div style={{
              height: "100%", borderRadius: 2, background: `linear-gradient(90deg, ${C.accent}, ${C.accentLight})`,
              width: `${progress.total > 0 ? (progress.done / progress.total) * 100 : 0}%`,
              transition: "width 0.3s",
            }} />
          </div>
        )}
      </GlassCard>

      {/* Symbol Manager */}
      <GlassCard style={{ marginBottom: 20 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: C.text }}>Symbole ({symbols.length})</div>
          <div style={{ display: "flex", gap: 6 }}>
            {Object.keys(PRESETS).map((name) => (
              <button key={name} onClick={() => addPreset(name)} style={{
                padding: "4px 10px", borderRadius: 6, border: `1px solid ${C.border}`,
                background: "transparent", color: C.textMuted, fontSize: 11, fontWeight: 600,
                cursor: "pointer", transition: "all 0.2s",
              }}>
                + {name}
              </button>
            ))}
          </div>
        </div>

        {/* Symbol Tags */}
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
          {/* Add Symbol */}
          {showAdd ? (
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <input
                value={newSymbol}
                onChange={(e) => setNewSymbol(e.target.value.toUpperCase())}
                onKeyDown={(e) => { if (e.key === "Enter") addSymbol(); if (e.key === "Escape") setShowAdd(false); }}
                placeholder="AAPL"
                autoFocus
                style={{
                  width: 80, padding: "4px 8px", borderRadius: 6,
                  border: `1px solid ${C.accent}40`, background: "rgba(10,13,17,0.6)",
                  color: C.text, fontSize: 12, fontWeight: 600, outline: "none",
                }}
              />
              <button onClick={addSymbol} style={{
                padding: "4px 8px", borderRadius: 6, border: "none",
                background: C.accent, color: "#fff", fontSize: 11, fontWeight: 700, cursor: "pointer",
              }}>OK</button>
              <X size={14} color={C.textDim} style={{ cursor: "pointer" }} onClick={() => setShowAdd(false)} />
            </div>
          ) : (
            <button onClick={() => setShowAdd(true)} style={{
              display: "flex", alignItems: "center", gap: 4, padding: "4px 10px",
              borderRadius: 8, border: `1px dashed ${C.border}`,
              background: "transparent", color: C.textDim, fontSize: 12, fontWeight: 600,
              cursor: "pointer",
            }}>
              <Plus size={12} /> Hinzufuegen
            </button>
          )}
        </div>

        {/* Quick Actions */}
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

      {/* Ergebnis-Tabelle */}
      {sortedResults.length > 0 && (
        <GlassCard style={{ padding: 0, overflow: "hidden" }}>
          {/* Table Header */}
          <div style={{
            display: "grid",
            gridTemplateColumns: isMobile ? "1fr 60px 60px" : "140px 1fr 90px 80px 70px 70px 120px",
            gap: 0, padding: "12px 16px", borderBottom: `1px solid ${C.border}`,
            background: "rgba(10,13,17,0.3)", fontSize: 11, fontWeight: 700, color: C.textDim,
            textTransform: "uppercase", letterSpacing: "0.05em",
          }}>
            <div>Symbol</div>
            {!isMobile && <div>Name</div>}
            {!isMobile && <div style={{ textAlign: "right" }}>Kurs</div>}
            {!isMobile && <div style={{ textAlign: "right" }}>Chg %</div>}
            <div style={{ textAlign: "center", cursor: "pointer" }} onClick={() => setSortBy("swing")}>
              Swing {sortBy === "swing" ? "▼" : ""}
            </div>
            <div style={{ textAlign: "center", cursor: "pointer" }} onClick={() => setSortBy("intraday")}>
              Intra {sortBy === "intraday" ? "▼" : ""}
            </div>
            {!isMobile && <div>Signal</div>}
          </div>

          {/* Table Rows */}
          {sortedResults.map((r, idx) => {
            const isExpanded = expandedRow === idx;
            const combinedScore = r.swing.total * 0.6 + r.intraday.total * 0.4;
            const rowBorder = combinedScore >= 70 ? `${C.green}15` : combinedScore >= 50 ? `${C.yellow}10` : "transparent";

            return (
              <div key={r.symbol}>
                <div
                  onClick={() => setExpandedRow(isExpanded ? null : idx)}
                  style={{
                    display: "grid",
                    gridTemplateColumns: isMobile ? "1fr 60px 60px" : "140px 1fr 90px 80px 70px 70px 120px",
                    gap: 0, padding: "12px 16px", cursor: "pointer",
                    borderBottom: `1px solid ${C.border}`,
                    background: isExpanded ? `${C.accent}05` : idx % 2 === 0 ? "transparent" : "rgba(10,13,17,0.15)",
                    borderLeft: `3px solid ${rowBorder}`,
                    transition: "all 0.15s",
                  }}
                >
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{r.displaySymbol}</div>
                    {isMobile && <div style={{ fontSize: 10, color: C.textDim }}>{r.price.toFixed(2)} {r.currency}</div>}
                  </div>
                  {!isMobile && <div style={{ fontSize: 12, color: C.textMuted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.name}</div>}
                  {!isMobile && <div style={{ textAlign: "right", fontSize: 13, fontWeight: 600, color: C.text }}>{r.price.toFixed(2)}</div>}
                  {!isMobile && (
                    <div style={{ textAlign: "right", fontSize: 12, fontWeight: 600, color: r.change >= 0 ? C.green : C.red }}>
                      {r.change >= 0 ? "+" : ""}{r.change.toFixed(2)}%
                    </div>
                  )}
                  <div style={{ textAlign: "center" }}><ScoreBadge score={r.swing.total} size="small" /></div>
                  <div style={{ textAlign: "center" }}><ScoreBadge score={r.intraday.total} size="small" /></div>
                  {!isMobile && (
                    <div style={{ fontSize: 11, color: C.textMuted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {[...r.swing.signals, ...r.intraday.signals].slice(0, 1).join(", ") || "—"}
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
                        {r.swing.factors.map((f, i) => (
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
                        {r.intraday.factors.map((f, i) => (
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

                    {/* Action Buttons */}
                    <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
                      <button onClick={() => openTradeCheck(r.displaySymbol)} style={{
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
      )}

      {/* Empty State */}
      {!scanning && results.length === 0 && symbols.length > 0 && (
        <GlassCard style={{ textAlign: "center", padding: 40 }}>
          <Zap size={32} color={C.accent} style={{ marginBottom: 12 }} />
          <div style={{ fontSize: 16, fontWeight: 700, color: C.text, marginBottom: 8 }}>Bereit zum Scannen</div>
          <div style={{ fontSize: 13, color: C.textMuted, marginBottom: 16 }}>
            Klicke "Scan starten" um {symbols.length} Symbole auf Swing- und Intraday-Setups zu pruefen.
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
          <div style={{ fontSize: 13, color: C.textMuted, marginBottom: 16 }}>
            Fuege Symbole hinzu oder waehle eine vordefinierte Liste.
          </div>
          <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
            {Object.keys(PRESETS).map((name) => (
              <button key={name} onClick={() => addPreset(name)} style={{
                padding: "10px 16px", borderRadius: 10, border: `1px solid ${C.accent}30`,
                background: `${C.accent}10`, color: C.accentLight, fontSize: 13, fontWeight: 700,
                cursor: "pointer",
              }}>
                {name}
              </button>
            ))}
          </div>
        </GlassCard>
      )}

      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  );
}
