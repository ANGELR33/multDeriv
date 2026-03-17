/**
 * Technical Indicators Module
 * Calculates SMA, RSI, and ATR from tick data
 */

const Indicators = (() => {
    /**
     * Simple Moving Average
     * @param {number[]} data - Array of prices
     * @param {number} period - SMA period
     * @returns {number|null}
     */
    function sma(data, period) {
        if (data.length < period) return null;
        const slice = data.slice(-period);
        return slice.reduce((sum, val) => sum + val, 0) / period;
    }

    /**
     * SMA Series — returns array of SMA values for all possible windows
     * @param {number[]} data
     * @param {number} period
     * @returns {(number|null)[]}
     */
    function smaSeries(data, period) {
        const result = [];
        for (let i = 0; i < data.length; i++) {
            if (i < period - 1) {
                result.push(null);
            } else {
                const slice = data.slice(i - period + 1, i + 1);
                result.push(slice.reduce((s, v) => s + v, 0) / period);
            }
        }
        return result;
    }

    /**
     * RSI (Relative Strength Index)
     * @param {number[]} data - Array of prices
     * @param {number} period - RSI period (default 14)
     * @returns {number|null}
     */
    function rsi(data, period = 14) {
        if (data.length < period + 1) return null;

        let gains = 0;
        let losses = 0;
        const slice = data.slice(-(period + 1));

        for (let i = 1; i <= period; i++) {
            const change = slice[i] - slice[i - 1];
            if (change >= 0) gains += change;
            else losses += Math.abs(change);
        }

        const avgGain = gains / period;
        const avgLoss = losses / period;

        if (avgLoss === 0) return 100;
        const rs = avgGain / avgLoss;
        return 100 - (100 / (1 + rs));
    }

    /**
     * RSI Series
     * @param {number[]} data
     * @param {number} period
     * @returns {(number|null)[]}
     */
    function rsiSeries(data, period = 14) {
        const result = [];
        for (let i = 0; i < data.length; i++) {
            if (i < period) {
                result.push(null);
            } else {
                result.push(rsi(data.slice(0, i + 1), period));
            }
        }
        return result;
    }

    /**
     * ATR (Average True Range) — adapted for tick data (no OHLC)
     * Uses absolute price changes as a proxy
     * @param {number[]} data - Array of prices
     * @param {number} period - ATR period (default 14)
     * @returns {number|null}
     */
    function atr(data, period = 14) {
        if (data.length < period + 1) return null;

        const slice = data.slice(-(period + 1));
        let trSum = 0;

        for (let i = 1; i < slice.length; i++) {
            trSum += Math.abs(slice[i] - slice[i - 1]);
        }

        return trSum / period;
    }

    /**
     * ATR Series
     * @param {number[]} data
     * @param {number} period
     * @returns {(number|null)[]}
     */
    function atrSeries(data, period = 14) {
        const result = [];
        for (let i = 0; i < data.length; i++) {
            if (i < period) {
                result.push(null);
            } else {
                result.push(atr(data.slice(0, i + 1), period));
            }
        }
        return result;
    }

    /**
     * EMA (Exponential Moving Average)
     */
    function ema(data, period) {
        if (data.length < period) return null;
        let k = 2 / (period + 1);
        
        // Start with SMA as initial EMA
        let initialSma = sma(data.slice(0, period), period);
        let currentEma = initialSma;
        
        for (let i = period; i < data.length; i++) {
            currentEma = (data[i] - currentEma) * k + currentEma;
        }
        return currentEma;
    }

    /**
     * MACD
     * Returns { macdLine, signalLine, histogram }
     */
    function macd(data, fast=12, slow=26, signalPeriod=9) {
        if (data.length < slow + signalPeriod) return null;
        
        let macdLineSeries = [];
        for (let i = slow; i <= data.length; i++) {
            let slice = data.slice(0, i);
            let fastEma = ema(slice, fast);
            let slowEma = ema(slice, slow);
            if(fastEma !== null && slowEma !== null) {
               macdLineSeries.push(fastEma - slowEma);
            }
        }
        
        if (macdLineSeries.length < signalPeriod) return null;
        
        let macdLine = macdLineSeries[macdLineSeries.length - 1];
        let signalLine = ema(macdLineSeries, signalPeriod);
        
        if(signalLine === null) return null;
        
        return {
            macdLine: macdLine,
            signalLine: signalLine,
            histogram: macdLine - signalLine
        };
    }

    /**
     * Bollinger Bands
     * Returns { upper, middle, lower }
     */
    function bollingerBands(data, period=20, stdDevMult=2) {
        if (data.length < period) return null;
        
        const slice = data.slice(-period);
        const middle = sma(slice, period); // SMA
        
        // Calculate Standard Deviation
        let variance = 0;
        for (let i = 0; i < slice.length; i++) {
            variance += Math.pow(slice[i] - middle, 2);
        }
        let stdDev = Math.sqrt(variance / period);
        
        return {
            upper: middle + (stdDev * stdDevMult),
            middle: middle,
            lower: middle - (stdDev * stdDevMult)
        };
    }

    return {
        sma,
        smaSeries,
        rsi,
        rsiSeries,
        atr,
        atrSeries,
        ema,
        macd,
        bollingerBands
    };
})();
