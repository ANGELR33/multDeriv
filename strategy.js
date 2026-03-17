/**
 * "Hunt & Management" Strategy (Caza y Gestión)
 * 
 * 4 Phases:
 * 1. SCANNING: Triple confirmation (SMA trend + RSI strength + ATR volatility)
 * 2. EXECUTION: Protected entry with SL/TP and deal cancellation
 * 3. MANAGEMENT: Dynamic management (panic sell, break-even, trailing stop)
 * 4. DAMAGE CONTROL: Cooldown, daily limits, account protection
 */

const Strategy = (() => {
    // ========== CONFIGURATION ==========
    const CONFIG = {
        // Market & Contract
        symbol: 'R_10',
        stake: 2.00,
        multiplier: 400,

        // SMA Periods
        smaFast: 20,
        smaSlow: 50,

        // RSI
        rsiPeriod: 14,
        rsiBuyMin: 40,
        rsiBuyMax: 60,
        rsiOverbought: 70,
        rsiOversold: 30,

        // ATR
        atrPeriod: 14,
        atrMinThreshold: 0.005, // Minimum volatility to trade

        // Risk Management
        stopLossMultiplier: 2.0,   // SL = ATR * multiplier
        takeProfitMultiplier: 3.0, // TP = ATR * multiplier
        dealCancellationDuration: '60m', // Cancel within 60 minutes

        // Dynamic Management
        trailingStopActivation: 1.5, // Activate trailing at 1.5x ATR profit
        trailingStopDistance: 1.0,    // Trail at 1x ATR
        breakEvenThreshold: 0.50,    // Move SL to break even after $0.50 profit

        // Damage Control
        maxConsecutiveLosses: 3,
        cooldownDurationMs: 60000,  // 60 seconds cooldown
        maxDailyTrades: 15,
        maxDailyLoss: 15.00,      // Stop after $15 daily loss
        accountProtectionPct: 0.20, // Stop if balance drops 20%

        // Signal requirements
        minTicksForAnalysis: 55, // Need at least 55 ticks (for SMA 50 + buffer)
    };

    // ========== STATE ==========
    const state = {
        phase: 'IDLE', // IDLE, SCANNING, EXECUTING, MANAGING, COOLDOWN
        direction: null, // 'up' or 'down'

        // Active contract
        activeContract: null,
        contractId: null,
        entryPrice: null,

        // Session tracking
        sessionPnL: 0,
        dailyTrades: 0,
        dailyLoss: 0,
        wins: 0,
        losses: 0,
        consecutiveLosses: 0,
        startingBalance: 0,

        // Cooldown
        cooldownUntil: 0,

        // Trailing stop
        highestProfit: 0,

        // Signals
        signals: {
            sma: false,
            rsi: false,
            atr: false,
            direction: null,
        },
    };

    // ========== PHASE 1: SCANNING ==========
    /**
     * Analyze current market with triple confirmation
     * @param {number[]} prices - Tick price history
     * @returns {{ confirmed: boolean, direction: string|null, signals: object }}
     */
    function analyzeSignals(prices) {
        if (prices.length < CONFIG.minTicksForAnalysis) {
            return { confirmed: false, direction: null, signals: state.signals };
        }

        // 1. SMA Trend
        const smaFast = Indicators.sma(prices, CONFIG.smaFast);
        const smaSlow = Indicators.sma(prices, CONFIG.smaSlow);
        const smaConfirmed = smaFast !== null && smaSlow !== null;
        let smaDirection = null;

        if (smaConfirmed) {
            if (smaFast > smaSlow) smaDirection = 'up';
            else if (smaFast < smaSlow) smaDirection = 'down';
        }

        state.signals.sma = smaDirection !== null;

        // 2. RSI Strength
        const currentRSI = Indicators.rsi(prices, CONFIG.rsiPeriod);
        let rsiOk = false;

        if (currentRSI !== null) {
            if (smaDirection === 'up') {
                // For buy, RSI should not be overbought
                rsiOk = currentRSI >= CONFIG.rsiBuyMin && currentRSI < CONFIG.rsiOverbought;
            } else if (smaDirection === 'down') {
                // For sell, RSI should not be oversold
                rsiOk = currentRSI <= CONFIG.rsiBuyMax && currentRSI > CONFIG.rsiOversold;
            }
        }

        state.signals.rsi = rsiOk;

        // 3. ATR Volatility
        const currentATR = Indicators.atr(prices, CONFIG.atrPeriod);
        const atrOk = currentATR !== null && currentATR >= CONFIG.atrMinThreshold;
        state.signals.atr = atrOk;

        state.signals.direction = smaDirection;

        const confirmed = state.signals.sma && state.signals.rsi && state.signals.atr;

        return { confirmed, direction: smaDirection, signals: { ...state.signals }, rsi: currentRSI, atr: currentATR };
    }

    // ========== PHASE 2: EXECUTION ==========
    /**
     * Calculate stop loss and take profit based on ATR
     * @param {number[]} prices
     * @returns {{ stopLoss: number, takeProfit: number }}
     */
    function calculateRiskLevels(prices) {
        const currentATR = Indicators.atr(prices, CONFIG.atrPeriod);
        if (!currentATR) return { stopLoss: 1.00, takeProfit: 2.00 }; // defaults

        const stopLoss = Math.max(0.50, +(currentATR * CONFIG.stopLossMultiplier * CONFIG.multiplier).toFixed(2));
        const takeProfit = Math.max(1.00, +(currentATR * CONFIG.takeProfitMultiplier * CONFIG.multiplier).toFixed(2));

        // Cap SL at stake
        const cappedSL = Math.min(stopLoss, CONFIG.stake);

        return { stopLoss: cappedSL, takeProfit };
    }

    /**
     * Execute a trade
     * @param {string} direction - 'up' or 'down'
     * @param {number[]} prices
     * @returns {Promise<object>} Buy response
     */
    async function executeTrade(direction, prices) {
        // Pre-checks
        if (!canTrade()) {
            throw new Error('Trading conditions not met');
        }

        const { stopLoss, takeProfit } = calculateRiskLevels(prices);

        state.phase = 'EXECUTING';
        state.direction = direction;

        try {
            const result = await DerivWS.buyMultiplier(
                CONFIG.symbol,
                CONFIG.stake,
                CONFIG.multiplier,
                direction,
                {
                    stop_loss: stopLoss,
                    take_profit: takeProfit
                    // NOTE: API doesn't allow both take_profit and deal_cancellation.
                }
            );

            if (result.buy) {
                state.contractId = result.buy.contract_id;
                state.entryPrice = result.buy.buy_price;
                state.phase = 'MANAGING';
                state.highestProfit = 0;
                state.dailyTrades++;

                // Subscribe to contract updates
                DerivWS.subscribeOpenContract(result.buy.contract_id);

                return result.buy;
            }

            throw new Error('Buy failed');
        } catch (err) {
            state.phase = 'SCANNING';
            throw err;
        }
    }

    // ========== PHASE 3: DYNAMIC MANAGEMENT ==========
    /**
     * Handle contract update - apply dynamic management
     * @param {object} contract - Proposal open contract data
     */
    function manageContract(contract) {
        if (state.phase !== 'MANAGING') return null;

        state.activeContract = contract;
        const profit = parseFloat(contract.profit) || 0;

        // Track highest profit for trailing stop
        if (profit > state.highestProfit) {
            state.highestProfit = profit;
        }

        return {
            profit,
            highestProfit: state.highestProfit,
            contractId: contract.contract_id,
            status: contract.status,
            is_valid_to_sell: contract.is_valid_to_sell,
        };
    }

    /**
     * Panic Sell - immediately close at market
     */
    async function panicSell() {
        if (!state.contractId) throw new Error('No active contract');
        state.phase = 'IDLE';
        return DerivWS.sellContract(state.contractId);
    }

    /**
     * Move stop loss to break even
     */
    async function moveToBreakEven() {
        if (!state.contractId) throw new Error('No active contract');
        // Set SL to 0 (entry price essentially)
        return DerivWS.updateContract(state.contractId, {
            stop_loss: 0.01, // minimal SL
        });
    }

    // ========== PHASE 4: DAMAGE CONTROL ==========
    /**
     * Check if trading is allowed
     */
    function canTrade() {
        if (state.phase === 'MANAGING' || state.phase === 'EXECUTING') return false;
        if (state.dailyTrades >= CONFIG.maxDailyTrades) return false;
        if (state.dailyLoss >= CONFIG.maxDailyLoss) return false;
        if (state.consecutiveLosses >= CONFIG.maxConsecutiveLosses) return false;
        if (Date.now() < state.cooldownUntil) return false;
        return true;
    }

    /**
     * Record trade result
     * @param {number} pnl - Profit or loss from trade
     */
    function recordTradeResult(pnl) {
        state.sessionPnL += pnl;

        if (pnl >= 0) {
            state.wins++;
            state.consecutiveLosses = 0;
        } else {
            state.losses++;
            state.dailyLoss += Math.abs(pnl);
            state.consecutiveLosses++;
        }

        // Trigger cooldown on consecutive losses
        if (state.consecutiveLosses >= CONFIG.maxConsecutiveLosses) {
            state.cooldownUntil = Date.now() + CONFIG.cooldownDurationMs;
            state.phase = 'COOLDOWN';
        } else {
            state.phase = 'SCANNING';
        }

        state.contractId = null;
        state.activeContract = null;
        state.direction = null;
        state.highestProfit = 0;
    }

    /**
     * Check account protection
     * @param {number} currentBalance
     * @returns {boolean} true if account is protected (should stop)
     */
    function checkAccountProtection(currentBalance) {
        if (state.startingBalance <= 0) return false;
        const dropPct = (state.startingBalance - currentBalance) / state.startingBalance;
        return dropPct >= CONFIG.accountProtectionPct;
    }

    /**
     * Get win rate
     */
    function getWinRate() {
        const total = state.wins + state.losses;
        if (total === 0) return 0;
        return ((state.wins / total) * 100).toFixed(0);
    }

    /**
     * Start the bot
     */
    function start(currentBalance) {
        state.phase = 'SCANNING';
        state.startingBalance = currentBalance;
    }

    /**
     * Stop the bot
     */
    function stop() {
        state.phase = 'IDLE';
    }

    /**
     * Reset daily stats
     */
    function resetDaily() {
        state.dailyTrades = 0;
        state.dailyLoss = 0;
        state.consecutiveLosses = 0;
    }

    /**
     * Get signal strength (0-5)
     */
    function getSignalStrength(prices) {
        let strength = 0;
        if (prices.length < CONFIG.minTicksForAnalysis) return 0;

        if (state.signals.sma) strength += 2;
        if (state.signals.rsi) strength += 2;
        if (state.signals.atr) strength += 1;

        return Math.min(5, strength);
    }

    return {
        CONFIG,
        state,
        analyzeSignals,
        calculateRiskLevels,
        executeTrade,
        manageContract,
        panicSell,
        moveToBreakEven,
        canTrade,
        recordTradeResult,
        checkAccountProtection,
        getWinRate,
        getSignalStrength,
        start,
        stop,
        resetDaily,
    };
})();
