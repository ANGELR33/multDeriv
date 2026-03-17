/**
 * "Hunt & Management" Strategy (Caza y Gestión)
 * 
 * 4 Phases:
 * 1. SCANNING: Triple confirmation (SMA trend + RSI strength + ATR volatility < 4.0)
 * 2. EXECUTION: Protected entry with fixed SL ($1.00), dynamic manual TP ($0.40), Deal Cancellation (60m)
 * 3. MANAGEMENT: Dynamic management (salvavidas a 45s, break-even a +$0.20, trailing stop a +$0.30)
 * 4. DAMAGE CONTROL: Cooldown (2m win / 15m loss), Límites diarios (+$2 / -$5), Account protection (<$95)
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
        rsiMin: 30,
        rsiMax: 70,

        // ATR
        atrPeriod: 14,
        atrMaxThreshold: 4.0,

        // Risk Management
        fixedStopLoss: 1.00,       // SL máximo -$1.00
        fixedTakeProfit: 0.40,     // TP objetivo +$0.40
        dealCancellationDuration: '60m',

        // Dynamic Management
        panicSellSeconds: 45,             
        panicSellLossThreshold: -0.30,   // Perdiendo -$0.30 (15%) entre s45 y s60
        breakEvenProfitThreshold: 0.20,  // Ganando +$0.20 mueve SL a $0.00
        trailingStopActivation: 0.30,    // Ganando +$0.30 mueve SL a +$0.10
        trailingStopTarget: 0.10,

        // Damage Control
        cooldownWinMs: 120000,     // 2 minutos
        cooldownLossMs: 900000,    // 15 minutos
        maxDailyProfit: 2.00,      // Meta +$2.00
        maxDailyLoss: 5.00,        // Límite -$5.00
        accountProtectionMinBalance: 95.00, 
        maxDailyTrades: 15,

        // Signal requirements
        minTicksForAnalysis: 55, 
    };

    // ========== STATE ==========
    const state = {
        phase: 'IDLE', // IDLE, SCANNING, EXECUTING, MANAGING, COOLDOWN, HIBERNATING
        direction: null, 

        // Active contract
        activeContract: null,
        contractId: null,
        entryPrice: null,
        contractStartTime: 0,
        manualStopLoss: null,
        breakEvenMoved: false,
        trailingMoved: false,

        // Session tracking
        sessionPnL: 0,
        dailyTrades: 0,
        dailyLoss: 0,
        wins: 0,
        losses: 0,
        startingBalance: 0,

        // Cooldown
        cooldownUntil: 0,
        cooldownReason: '',

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

        // 2. RSI Strength (Zona segura 30 a 70 independientemente de dirección)
        const currentRSI = Indicators.rsi(prices, CONFIG.rsiPeriod);
        let rsiOk = false;
        if (currentRSI !== null) {
            rsiOk = currentRSI >= CONFIG.rsiMin && currentRSI <= CONFIG.rsiMax;
        }
        state.signals.rsi = rsiOk;

        // 3. ATR Volatility (Debe ser menor a 4.0)
        const currentATR = Indicators.atr(prices, CONFIG.atrPeriod);
        const atrOk = currentATR !== null && currentATR < CONFIG.atrMaxThreshold;
        state.signals.atr = atrOk;

        state.signals.direction = smaDirection;

        const confirmed = state.signals.sma && state.signals.rsi && state.signals.atr;

        return { confirmed, direction: smaDirection, signals: { ...state.signals }, rsi: currentRSI, atr: currentATR };
    }

    // ========== PHASE 2: EXECUTION ==========
    function calculateRiskLevels(prices) {
        return { stopLoss: CONFIG.fixedStopLoss, takeProfit: CONFIG.fixedTakeProfit };
    }

    async function executeTrade(direction, prices) {
        if (!canTrade()) {
            throw new Error('Trading conditions (or limits) not met');
        }

        const { stopLoss } = calculateRiskLevels(prices);

        state.phase = 'EXECUTING';
        state.direction = direction;
        state.contractStartTime = Date.now();
        state.breakEvenMoved = false;
        state.trailingMoved = false;
        state.manualStopLoss = -stopLoss; // Inicializado en -$1.00 USD
        state.highestProfit = 0;

        try {
            const result = await DerivWS.buyMultiplier(
                CONFIG.symbol,
                CONFIG.stake,
                CONFIG.multiplier,
                direction,
                {
                    deal_cancellation_duration: CONFIG.dealCancellationDuration,
                    // NOTE: API doesn't allow stop_loss/take_profit if using deal_cancellation. 
                    // Managed locally via 'manualStopLoss' and 'fixedTakeProfit'.
                }
            );

            if (result.buy) {
                state.contractId = result.buy.contract_id;
                state.entryPrice = result.buy.buy_price;
                state.phase = 'MANAGING';
                state.dailyTrades++;

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
    function manageContract(contract) {
        if (state.phase !== 'MANAGING') return null;

        state.activeContract = contract;
        const profit = parseFloat(contract.profit) || 0;
        const elapsedSeconds = (Date.now() - state.contractStartTime) / 1000;

        if (profit > state.highestProfit) {
            state.highestProfit = profit;
        }

        // 1. Take Profit Fijo Manual (+$0.40)
        if (profit >= CONFIG.fixedTakeProfit) {
            panicSell();
            return { profit, action: 'Take Profit Fijo' };
        }

        // 2. El Salvavidas (Segundo 45 a 60) perdiendo -$0.30
        if (elapsedSeconds >= CONFIG.panicSellSeconds && elapsedSeconds <= 60 && profit <= CONFIG.panicSellLossThreshold) {
            panicSell();
            return { profit, action: 'Salvavidas (Segundo 45)' };
        }

        // 3. Break-Even (Ganancia +$0.20 -> SL $0.00)
        if (profit >= CONFIG.breakEvenProfitThreshold && !state.breakEvenMoved) {
            state.manualStopLoss = 0.00;
            state.breakEvenMoved = true;
            // Lo gestionamos de forma manual ya que deal_cancellation podría evitar actualizaciones API.
        }

        // 4. Trailing Stop Loss (Ganancia +$0.30 -> SL +$0.10)
        if (profit >= CONFIG.trailingStopActivation && !state.trailingMoved) {
            state.manualStopLoss = CONFIG.trailingStopTarget;
            state.trailingMoved = true;
        }

        // 5. Validar Stop Loss Dinámico Interno
        if (state.manualStopLoss !== null && profit <= state.manualStopLoss) {
            panicSell();
            return { profit, action: 'Stop Loss Manual / Trailing' };
        }

        return {
            profit,
            highestProfit: state.highestProfit,
            contractId: contract.contract_id,
            status: contract.status,
            is_valid_to_sell: contract.is_valid_to_sell,
        };
    }

    async function panicSell() {
        if (!state.contractId) throw new Error('No active contract');
        state.phase = 'IDLE'; 
        return DerivWS.sellContract(state.contractId);
    }

    async function moveToBreakEven() {
        if (!state.contractId) throw new Error('No active contract');
        state.manualStopLoss = 0.00;
        state.breakEvenMoved = true;
    }

    // ========== PHASE 4: DAMAGE CONTROL ==========
    function canTrade() {
        if (state.phase === 'MANAGING' || state.phase === 'EXECUTING' || state.phase === 'HIBERNATING') return false;
        if (state.sessionPnL >= CONFIG.maxDailyProfit) return false;
        if (state.dailyLoss >= CONFIG.maxDailyLoss) return false;
        if (state.dailyTrades >= CONFIG.maxDailyTrades) return false;
        if (Date.now() < state.cooldownUntil) return false;
        return true;
    }

    function recordTradeResult(pnl) {
        state.sessionPnL += pnl;

        if (pnl >= 0) {
            state.wins++;
            state.cooldownUntil = Date.now() + CONFIG.cooldownWinMs; // 2 min
            state.cooldownReason = 'Ganada -> 2 mins';
        } else {
            state.losses++;
            state.dailyLoss += Math.abs(pnl);
            state.cooldownUntil = Date.now() + CONFIG.cooldownLossMs; // 15 min
            state.cooldownReason = 'Perdida -> 15 mins';
        }

        // Control de hibernación general
        if (state.sessionPnL >= CONFIG.maxDailyProfit || state.dailyLoss >= CONFIG.maxDailyLoss) {
            state.phase = 'HIBERNATING';
        } else {
            state.phase = 'COOLDOWN';
        }

        state.contractId = null;
        state.activeContract = null;
        state.direction = null;
        state.highestProfit = 0;
    }

    function checkAccountProtection(currentBalance) {
        return currentBalance < CONFIG.accountProtectionMinBalance;
    }

    function getWinRate() {
        const total = state.wins + state.losses;
        if (total === 0) return 0;
        return ((state.wins / total) * 100).toFixed(0);
    }

    function start(currentBalance) {
        state.phase = 'SCANNING';
        state.startingBalance = currentBalance;
    }

    function stop() {
        state.phase = 'IDLE';
    }

    function resetDaily() {
        state.dailyTrades = 0;
        state.dailyLoss = 0;
        state.wins = 0;
        state.losses = 0;
        state.sessionPnL = 0;
        state.phase = 'IDLE';
    }

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
