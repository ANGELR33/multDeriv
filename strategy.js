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
        // Trading Mode
        tradingMode: 'ACCU', // 'MULT' or 'ACCU'

        // Market & Contract
        symbol: 'R_10',
        stake: 2.00,
        multiplier: 400,
        accuGrowthRate: 0.05, // 5% por tick en acumuladores

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

        // MACD & Bollinger Bounds (AI variables)
        macdFast: 12,
        macdSlow: 26,
        macdSignal: 9,
        bbPeriod: 20,
        bbStdDev: 2,

        // Risk Management
        fixedStopLoss: 1.00,       // SL máximo -$1.00
        fixedTakeProfit: 0.40,     // TP objetivo +$0.40
        dealCancellationDuration: '60m',

        // ACCU Dynamic Management
        accuDangerDistance: 0.05, // Vender si la barrera está muy cerca
        accuLossPenaltyCooldown: 5000, // 5 segundos, buscar rápido otra oportunidad

        // Dynamic Management
        panicSellSeconds: 45,             
        panicSellLossThreshold: -0.30,   // Perdiendo -$0.30 (15%) entre s45 y s60
        breakEvenProfitThreshold: 0.20,  // Ganando +$0.20 mueve SL a $0.00
        trailingStopActivation: 0.30,    // Ganando +$0.30 mueve SL a +$0.10
        trailingStopTarget: 0.10,

        // Damage Control
        cooldownWinMs: 2000,     // 2 segundos (solo para limpiar variables y evitar gatillo doble)
        cooldownLossMs: 4000,    // 4 segundos para un respiro
        maxDailyProfit: 5.00,      // Meta +$5.00
        maxDailyLoss: 10.00,        // Límite -$10.00
        accountProtectionMinBalance: 95.00, 
        maxDailyTrades: 99,

        minTicksForAnalysis: 55, 
        
        // AI Logic
        minAIConfidence: 85, // Mínimo de puntaje IA (0-100) para autorizar compra
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

        // Signals & AI
        signals: {
            sma: false,
            rsi: false,
            atr: false,
            direction: null,
        },
        aiConfidence: 0,
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

        state.signals.direction = smaDirection;

        // ==========================================
        // 4. MOTOR DE INTELIGENCIA / FUZZY LOGIC V2 (Deep Analysis)
        // ==========================================
        let confidenceScore = 0;
        let confirmed = false;
        
        // Obtenemos los nuevos indicadores IA
        const currentMACD = Indicators.macd(prices, CONFIG.macdFast, CONFIG.macdSlow, CONFIG.macdSignal);
        const currentBB = Indicators.bollingerBands(prices, CONFIG.bbPeriod, CONFIG.bbStdDev);
        const currentPrice = prices[prices.length - 1];

        if (CONFIG.tradingMode === 'MULT') {
            // LÓGICA MULTIPLICADOR ORIGINAL (Cazador de Tendencias)
            // --- FILTRO 1: Tendencia Mayor (SMA) [Max: 20 pts] ---
            if (smaConfirmed && smaDirection) {
                confidenceScore += 15;
                if (smaDirection === 'up' && currentPrice > smaFast) confidenceScore += 5;
                if (smaDirection === 'down' && currentPrice < smaFast) confidenceScore += 5;
            }

            // --- FILTRO 2: Fuerza Relativa (RSI) [Max: 20 pts] ---
            if (rsiOk) {
                confidenceScore += 10;
                if (smaDirection === 'up' && currentRSI > 50 && currentRSI < 65) confidenceScore += 10;
                else if (smaDirection === 'down' && currentRSI < 50 && currentRSI > 35) confidenceScore += 10;
                else confidenceScore += 5; 
            }

            // --- FILTRO 3: MACD [Max: 25 pts] ---
            if (currentMACD !== null && smaDirection) {
                let macdOk = false;
                if (smaDirection === 'up' && currentMACD.histogram > 0) { confidenceScore += 15; macdOk = true; }
                else if (smaDirection === 'down' && currentMACD.histogram < 0) { confidenceScore += 15; macdOk = true; }
                if (macdOk && Math.abs(currentMACD.histogram) > 0.05) confidenceScore += 10;
            }

            // --- FILTRO 4: Bollinger [Max: 15 pts] ---
            if (currentBB !== null && smaDirection) {
                if (smaDirection === 'up' && currentPrice < currentBB.upper) confidenceScore += 15;
                else if (smaDirection === 'down' && currentPrice > currentBB.lower) confidenceScore += 15;
            }

            // --- FILTRO 5: ATR Liquidez [Max: 10 pts] ---
            if (atrOk) {
                if (currentATR >= 0.005) confidenceScore += 10;
            }

            // --- FILTRO 6: Price Action 3 Ticks [Max: 10 pts] ---
            if (prices.length >= 4 && smaDirection) {
                const t1 = prices[prices.length - 2];
                const t2 = prices[prices.length - 3];
                if (smaDirection === 'up' && currentPrice > t1 && t1 >= t2) confidenceScore += 10;
                else if (smaDirection === 'down' && currentPrice < t1 && t1 <= t2) confidenceScore += 10;
            }

            state.aiConfidence = Math.max(0, Math.min(100, confidenceScore));
            confirmed = state.signals.sma && state.signals.rsi && state.signals.atr && state.aiConfidence >= CONFIG.minAIConfidence;
        } else {
            // LÓGICA ACUMULADOR (Buscando "Agua Estancada" y Lateralización Total)
            smaDirection = 'flat'; // En accu no hay dirección "up" o "down"
            
            // FILTRO 1: SMA Pegadas (Flat)
            let isSmaFlat = false;
            if (smaConfirmed) {
                const diff = Math.abs(smaFast - smaSlow);
                // Muy juntas
                if (diff < 0.2) {
                    confidenceScore += 30;
                    isSmaFlat = true;
                }
            }
            state.signals.sma = isSmaFlat;

            // FILTRO 2: RSI Estrictamente Neutro (45 a 55)
            let isRsiNeutral = false;
            if (currentRSI !== null && currentRSI >= 45 && currentRSI <= 55) {
                confidenceScore += 30;
                isRsiNeutral = true;
            }
            state.signals.rsi = isRsiNeutral;

            // FILTRO 3: ATR Muerto (< 1.5)
            let isAtrDead = false;
            if (currentATR !== null && currentATR < 1.5) {
                confidenceScore += 30;
                isAtrDead = true;
                // Bono por vela diminuta
                if (currentATR < 0.8) confidenceScore += 10; 
            }
            state.signals.atr = isAtrDead;

            state.aiConfidence = Math.max(0, Math.min(100, confidenceScore));
            confirmed = isSmaFlat && isRsiNeutral && isAtrDead && state.aiConfidence >= 80; // 80% exigencia accu
        }

        return { confirmed, direction: smaDirection, signals: { ...state.signals }, rsi: currentRSI, atr: currentATR, aiConfidence: state.aiConfidence, macd: currentMACD };
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
            let result;
            if (CONFIG.tradingMode === 'MULT') {
                result = await DerivWS.buyMultiplier(
                    CONFIG.symbol,
                    CONFIG.stake,
                    CONFIG.multiplier,
                    direction,
                    { deal_cancellation_duration: CONFIG.dealCancellationDuration }
                );
            } else {
                // ACCUMULATOR
                result = await DerivWS.buyAccumulator(
                    CONFIG.symbol,
                    CONFIG.stake,
                    CONFIG.accuGrowthRate
                );
            }

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

        // 1. Take Profit Fijo Manual (Mismo para ACCU y MULT = +$0.40)
        if (profit >= CONFIG.fixedTakeProfit) {
            panicSell();
            return { profit, action: 'Take Profit Fijo Alcanzado' };
        }

        if (CONFIG.tradingMode === 'ACCU') {
            // ===== GESTIÓN DE ACCUMULATOR =====
            if (contract.current_spot && contract.high_barrier && contract.low_barrier) {
                const currentSpot = parseFloat(contract.current_spot);
                const hBarrier = parseFloat(contract.high_barrier);
                const lBarrier = parseFloat(contract.low_barrier);
                
                // Distancia a las barreras. Si la anomalía acerca el precio a < 0.05% de la banda letal, huir.
                const distHigh = (hBarrier - currentSpot) / currentSpot;
                const distLow = (currentSpot - lBarrier) / currentSpot;

                if (distHigh < 0.0001 || distLow < 0.0001) {
                    if (profit > 0) {
                        panicSell(); // Vender de emergencia conformándonse con lo acumulado
                        return { profit, action: 'Anomalía de Barrera (Emergency Sell)' };
                    }
                }
            }
        } else {
            // ===== GESTIÓN DE MULTIPLIER =====
            // El Salvavidas (Segundo 45 a 60) perdiendo -$0.30
            if (elapsedSeconds >= CONFIG.panicSellSeconds && elapsedSeconds <= 60 && profit <= CONFIG.panicSellLossThreshold) {
                panicSell();
                return { profit, action: 'Salvavidas (Segundo 45)' };
            }

            // Break-Even (Ganancia +$0.20 -> SL $0.00)
            if (profit >= CONFIG.breakEvenProfitThreshold && !state.breakEvenMoved) {
                state.manualStopLoss = 0.00;
                state.breakEvenMoved = true;
            }

            // Trailing Stop Loss (Ganancia +$0.30 -> SL +$0.10)
            if (profit >= CONFIG.trailingStopActivation && !state.trailingMoved) {
                state.manualStopLoss = CONFIG.trailingStopTarget;
                state.trailingMoved = true;
            }

            // Validar Stop Loss Dinámico Interno
            if (state.manualStopLoss !== null && profit <= state.manualStopLoss) {
                panicSell();
                return { profit, action: 'Stop Loss Manual / Trailing' };
            }
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
            state.cooldownUntil = Date.now() + CONFIG.cooldownWinMs; 
            state.cooldownReason = 'Ganada -> Next Scan';
        } else {
            state.losses++;
            state.dailyLoss += Math.abs(pnl);
            if (CONFIG.tradingMode === 'ACCU') {
                state.cooldownUntil = Date.now() + CONFIG.accuLossPenaltyCooldown; 
                state.cooldownReason = 'Perdida ACCU -> Recuperando Datos';
            } else {
                state.cooldownUntil = Date.now() + CONFIG.cooldownLossMs; 
                state.cooldownReason = 'Perdida MULT -> Recuperando Datos';
            }
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
