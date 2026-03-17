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

    return {
        sma,
        smaSeries,
        rsi,
        rsiSeries,
        atr,
        atrSeries,
    };
})();
