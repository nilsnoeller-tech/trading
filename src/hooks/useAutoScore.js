// ─── Auto-Score Hook ───
// Orchestriert das Laden von Marktdaten und die Berechnung aller Indikatoren.

import { useState, useCallback } from "react";
import { fetchOHLCV, fetchIndexData } from "../services/marketData";
import {
  detectSupportZone,
  analyzeVolumeProfile,
  detectCandlePattern,
  analyzeTrend,
  computeRSI,
  analyzeEMAs,
  checkLeadingIndex,
  analyzeBollingerBands,
} from "../services/indicators";

/**
 * @returns {{
 *   autoScores: Object|null,
 *   loading: boolean,
 *   error: string|null,
 *   dataTimestamp: Date|null,
 *   staleData: boolean,
 *   marketData: Object|null,
 *   computeAutoScores: (symbol: string, currency: string, entryPrice: number) => Promise<void>,
 *   resetAutoScores: () => void
 * }}
 */
export function useAutoScore() {
  const [autoScores, setAutoScores] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [dataTimestamp, setDataTimestamp] = useState(null);
  const [staleData, setStaleData] = useState(false);
  const [marketData, setMarketData] = useState(null);

  const computeAutoScores = useCallback(async (symbol, currency, entryPrice) => {
    if (!symbol || !entryPrice) {
      setError("Symbol und Einstiegskurs erforderlich");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // Yahoo-Ticker fuer europaeische Aktien anpassen
      // Flatex/Xetra: SAP → SAP.DE, etc.
      let yahooSymbol = symbol.toUpperCase();
      if (currency === "EUR" && !yahooSymbol.includes(".")) {
        // Versuche zuerst mit .DE (Xetra)
        yahooSymbol = `${yahooSymbol}.DE`;
      }

      // Parallel laden: Symbol-Daten + Index-Daten
      const [symbolResult, indexResult] = await Promise.all([
        fetchOHLCV(yahooSymbol, "1y", "1d"),
        fetchIndexData(currency),
      ]);

      const { candles } = symbolResult;
      const indexCandles = indexResult.candles;

      if (!candles || candles.length < 30) {
        throw new Error(
          `Nur ${candles?.length || 0} Kerzen fuer ${yahooSymbol} — mindestens 30 noetig`
        );
      }

      // Stale-Status pruefen
      const isStale = symbolResult.stale || indexResult.stale;
      setStaleData(isStale);

      // Alle Indikatoren berechnen
      const scores = {
        q1: detectSupportZone(candles, entryPrice),
        q2: analyzeVolumeProfile(candles, entryPrice),
        q3: detectCandlePattern(candles),
        q4: analyzeTrend(candles),
        q5: computeRSI(candles),
        q6: analyzeEMAs(candles),
        // q7 bleibt manuell (Chartmuster)
        q8: checkLeadingIndex(indexCandles),
        q9: analyzeBollingerBands(candles),
      };

      setAutoScores(scores);
      setMarketData({
        symbol: yahooSymbol,
        candles: candles.length,
        lastPrice: candles[candles.length - 1]?.close,
        lastDate: candles[candles.length - 1]?.date,
        currency: symbolResult.meta?.currency,
        indexName: indexResult.indexName,
        indexPrice: indexCandles[indexCandles.length - 1]?.close,
      });
      setDataTimestamp(new Date());
    } catch (err) {
      console.error("Auto-Score Fehler:", err);
      setError(err.message || "Unbekannter Fehler");
      setAutoScores(null);
      setMarketData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const resetAutoScores = useCallback(() => {
    setAutoScores(null);
    setError(null);
    setDataTimestamp(null);
    setStaleData(false);
    setMarketData(null);
  }, []);

  return {
    autoScores,
    loading,
    error,
    dataTimestamp,
    staleData,
    marketData,
    computeAutoScores,
    resetAutoScores,
  };
}
