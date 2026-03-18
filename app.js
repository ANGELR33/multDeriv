/**
 * DerivMULT — Main Application Controller
 * Connects all modules: WebSocket, Strategy, Chart, UI
 */

(function () {
    'use strict';

    // ========== DATA ==========
    let prices = [];
    let botRunning = false;
    let scanInterval = null;
    let currentBalance = 0;
    let accountType = 'demo';
    let tradeHistory = JSON.parse(localStorage.getItem('derivmult_history')) || [];

    // ========== DOM REFS ==========
    const $ = (sel) => document.querySelector(sel);
    const $$ = (sel) => document.querySelectorAll(sel);

    // Modal
    const connectModal = $('#connectModal');
    const apiTokenInput = $('#apiToken');
    const appIdInput = $('#appId');
    const connectBtn = $('#connectBtn');
    const connectError = $('#connectError');
    const togglePassword = $('#togglePassword');
    const toggleBtns = $$('.toggle-btn');

    // Dashboard
    const dashboard = $('#dashboard');
    const currentPriceEl = $('#currentPrice');
    const priceChangeEl = $('#priceChange');
    const accountBalanceEl = $('#accountBalance');
    const accountTypeBadge = $('#accountTypeBadge');
    const sessionPnLEl = $('#sessionPnL');
    const winRateEl = $('#winRate');
    const tradesTodayEl = $('#tradesToday');
    const dailyLossEl = $('#dailyLoss');
    const botStatusEl = $('#botStatus');
    const signalBars = $('#signalBars');

    // Controls
    const startBtn = $('#startBot');
    const stopBtn = $('#stopBot');
    const panicBtn = $('#panicSell');
    const breakEvenBtn = $('#breakEven');
    const disconnectBtn = $('#disconnectBtn');

    // Signal confirmations
    const confirmSMA = $('#confirmSMA');
    const confirmRSI = $('#confirmRSI');
    const confirmATR = $('#confirmATR');

    // Contract
    const contractPanel = $('#contractPanel');
    const contractIdEl = $('#contractId');
    const contractDirEl = $('#contractDir');
    const entryPriceEl = $('#entryPrice');
    const contractPnLEl = $('#contractPnL');
    const contractSLEl = $('#contractSL');
    const contractTPEl = $('#contractTP');
    const contractCancelEl = $('#contractCancel');
    const pnlBar = $('#pnlBar');
    const slDisplay = $('#slDisplay');
    const tpDisplay = $('#tpDisplay');

    // Cooldown
    const cooldownOverlay = $('#cooldownOverlay');
    const cooldownTimer = $('#cooldownTimer');

    // Log
    const logEntries = $('#logEntries');
    const clearLogBtn = $('#clearLog');

    // History
    const historyBody = $('#historyBody');
    const clearHistoryBtn = $('#clearHistory');
    
    // Trading Mode Toggle
    const tradingModeSelect = $('#tradingModeSelect');
    const accuGrowthRateSelect = $('#accuGrowthRateSelect');
    const growthRateContainer = $('#growthRateContainer');
    const multiplierLabelDisplay = $('#multiplierLabelDisplay');
    const maxTicksContainer = $('#maxTicksContainer');
    const accuMaxTicksInput = $('#accuMaxTicksInput');

    // Indicator toggles
    const indBtns = $$('.ind-btn');

    // ========== LOGGING ==========
    function log(msg, type = 'info') {
        const now = new Date();
        const time = now.toLocaleTimeString('en-US', { hour12: false });
        const entry = document.createElement('div');
        entry.className = `log-entry ${type}`;
        entry.innerHTML = `<span class="log-time">${time}</span><span class="log-msg">${msg}</span>`;
        logEntries.appendChild(entry);
        logEntries.scrollTop = logEntries.scrollHeight;

        // Keep max 200 entries
        while (logEntries.children.length > 200) {
            logEntries.removeChild(logEntries.firstChild);
        }
    }

    // ========== UI UPDATES ==========
    function updatePrice(price) {
        currentPriceEl.textContent = price.toFixed(4);
        
        if (prices.length >= 2) {
            const prev = prices[prices.length - 2];
            const change = ((price - prev) / prev * 100);
            priceChangeEl.textContent = (change >= 0 ? '+' : '') + change.toFixed(4) + '%';
            priceChangeEl.className = 'market-change ' + (change >= 0 ? 'positive' : 'negative');
        }
    }

    function updateBalance(balance) {
        currentBalance = parseFloat(balance);
        accountBalanceEl.textContent = '$' + currentBalance.toFixed(2);
    }

    function updateStats() {
        const s = Strategy.state;

        sessionPnLEl.textContent = (s.sessionPnL >= 0 ? '+$' : '-$') + Math.abs(s.sessionPnL).toFixed(2);
        sessionPnLEl.className = 'stat-value ' + (s.sessionPnL >= 0 ? 'profit' : 'loss');

        winRateEl.textContent = Strategy.getWinRate() + '%';
        tradesTodayEl.textContent = s.dailyTrades + ' / ' + Strategy.CONFIG.maxDailyTrades;
        if(dailyLossEl) dailyLossEl.textContent = '$' + s.dailyLoss.toFixed(2) + ' / $' + Strategy.CONFIG.maxDailyLoss.toFixed(2);

        // Bot status
        const phase = s.phase;
        botStatusEl.textContent = phase;
        botStatusEl.style.color = {
            'IDLE': 'var(--text-muted)',
            'SCANNING': 'var(--color-info)',
            'EXECUTING': 'var(--color-warning)',
            'MANAGING': 'var(--accent-primary)',
            'COOLDOWN': 'var(--color-loss)',
            'HIBERNATING': 'var(--color-loss)',
        }[phase] || 'var(--text-muted)';
    }

    function updateSignalBars(strength) {
        const bars = signalBars.querySelectorAll('.bar');
        bars.forEach((bar, i) => {
            bar.className = 'bar';
            if (i < strength) {
                bar.classList.add('active');
                if (strength <= 1) bar.classList.add('weak');
                else if (strength <= 3) bar.classList.add('medium');
                else bar.classList.add('strong');
            }
        });
    }

    function updateConfirmations(signals) {
        setConfirm(confirmSMA, signals.sma, signals.direction === 'up' ? '▲ BULL' : signals.direction === 'down' ? '▼ BEAR' : 'Flat');
        setConfirm(confirmRSI, signals.rsi, signals.rsi ? '✓ Ready' : '✗ Waiting');
        setConfirm(confirmATR, signals.atr, signals.atr ? '✓ Active' : '✗ Low');
    }

    function setConfirm(el, confirmed, statusText) {
        el.className = 'confirm-item ' + (confirmed ? 'confirmed' : 'denied');
        el.querySelector('.confirm-icon').textContent = confirmed ? '✅' : '❌';
        el.querySelector('.confirm-status').textContent = statusText;
    }

    function updateContractPanel(contract) {
        if (!contract) {
            contractPanel.style.display = 'none';
            return;
        }

        contractPanel.style.display = 'block';
        contractIdEl.textContent = '#' + (contract.contract_id || '--');
        contractDirEl.textContent = contract.contract_type === 'MULTUP' ? '▲ UP' : '▼ DOWN';
        contractDirEl.style.color = contract.contract_type === 'MULTUP' ? 'var(--color-profit)' : 'var(--color-loss)';
        entryPriceEl.textContent = parseFloat(contract.entry_spot_display_value || contract.buy_price || 0).toFixed(4);

        const profit = parseFloat(contract.profit) || 0;
        contractPnLEl.textContent = (profit >= 0 ? '+$' : '-$') + Math.abs(profit).toFixed(2);
        contractPnLEl.className = 'pnl-value ' + (profit >= 0 ? 'profit' : 'loss');

        // SL / TP
        if (contract.limit_order) {
            if (contract.limit_order.stop_loss) {
                contractSLEl.textContent = '$' + parseFloat(contract.limit_order.stop_loss.order_amount || 0).toFixed(2);
            }
            if (contract.limit_order.take_profit) {
                contractTPEl.textContent = '$' + parseFloat(contract.limit_order.take_profit.order_amount || 0).toFixed(2);
            }
        }

        // Cancellation
        if (contract.cancellation) {
            contractCancelEl.textContent = contract.cancellation.date_expiry
                ? new Date(contract.cancellation.date_expiry * 1000).toLocaleTimeString()
                : 'Active';
        } else {
            contractCancelEl.textContent = 'N/A';
        }

        // PnL bar
        const maxPnl = 5;
        const pct = Math.min(100, Math.max(0, ((profit + maxPnl) / (maxPnl * 2)) * 100));
        pnlBar.style.width = pct + '%';
        pnlBar.style.background = profit >= 0
            ? 'linear-gradient(90deg, #00c853, #00e676)'
            : 'linear-gradient(90deg, #c62828, #ff5252)';
    }

    function saveHistory() {
        localStorage.setItem('derivmult_history', JSON.stringify(tradeHistory));
    }

    function renderHistory() {
        if (!historyBody) return;
        historyBody.innerHTML = '';
        
        // render backwards (newest first)
        const displayHistory = [...tradeHistory].reverse();
        displayHistory.forEach(trade => {
            const tr = document.createElement('tr');
            
            const pnlColor = trade.pnl >= 0 ? 'profit' : 'loss';
            const sign = trade.pnl >= 0 ? '+$' : '-$';
            const pnlText = trade.pnl !== 0 ? (sign + Math.abs(trade.pnl).toFixed(2)) : '$0.00';
            const statusClass = trade.status === 'OPEN' ? 'status-open' : 'status-closed';
            const typeColor = trade.type === 'UP' ? 'color: var(--color-profit)' : 'color: var(--color-loss)';

            tr.innerHTML = `
                <td>${trade.time}</td>
                <td>#${trade.id}</td>
                <td style="${typeColor}"><b>${trade.type}</b></td>
                <td>$${trade.stake.toFixed(2)}</td>
                <td>${trade.multiplier}x</td>
                <td>${parseFloat(trade.entry).toFixed(4)}</td>
                <td><span class="${statusClass}">${trade.status}</span></td>
                <td class="pnl-value ${pnlColor}">${pnlText}</td>
            `;
            historyBody.appendChild(tr);
        });
    }

    function addTradeToHistory(contractId, direction, stake, multiplier, entryPrice) {
        const time = new Date().toLocaleTimeString('en-US', { hour12: false });
        if(tradeHistory.find(t => t.id === contractId)) return;
        
        tradeHistory.push({
            id: contractId, time: time, type: direction.toUpperCase(),
            stake: stake, multiplier: multiplier, entry: entryPrice,
            status: 'OPEN', pnl: 0
        });

        // Limit to 50 items so localStorage doesn't bloat
        if(tradeHistory.length > 50) tradeHistory.shift();
        
        saveHistory();
        renderHistory();
    }

    function updateTradeHistory(contractId, pnl, status) {
        const trade = tradeHistory.find(t => t.id === contractId);
        if (trade) {
            trade.pnl = parseFloat(pnl);
            if (status) trade.status = status;
            
            // Avoid extreme disk writes, but it's fine for small array
            if (status === 'CLOSED') {
                 saveHistory();
            }
            renderHistory();
        }
    }

    function showCooldown(durationMs) {
        // Not block screen anymore, just wait internal variable
        setTimeout(() => {
            if(Strategy.state.phase === 'COOLDOWN') {
               Strategy.state.phase = 'SCANNING';
               log('Scanning for next opportunity...', 'info');
               updateStats();
            }
        }, durationMs);
    }
    
    function showResultToast(profit) {
        const toast = document.createElement('div');
        toast.className = `trade-toast ${profit >= 0 ? 'toast-win' : 'toast-loss'}`;
        toast.innerHTML = profit >= 0 
            ? `<h2>🎉 WIN! +$${profit.toFixed(2)}</h2><p>Resuming scan...</p>`
            : `<h2>❌ LOSS! -$${Math.abs(profit).toFixed(2)}</h2><p>Analyzing conditions...</p>`;
            
        document.body.appendChild(toast);
        
        // Remove after 2.5s
        setTimeout(() => {
            toast.style.opacity = '0';
            setTimeout(() => toast.remove(), 1000);
        }, 1500);
    }

    // ========== BOT LOOP ==========
    function runScanLoop() {
        if (!botRunning || Strategy.state.phase !== 'SCANNING') return;

        // Check account protection
        if (Strategy.checkAccountProtection(currentBalance)) {
            log(`🛑 ACCOUNT PROTECTION: Balance dropped below $${Strategy.CONFIG.accountProtectionMinBalance}. Bot stopped.`, 'error');
            stopBot();
            return;
        }

        // Check daily limits
        if (!Strategy.canTrade()) {
            if (Strategy.state.phase === 'HIBERNATING') {
                log('💤 HIBERNATING: Meta de ganancia o límite de pérdida alcanzado. Bot detenido por hoy.', 'warning');
                stopBot();
            } else if (Strategy.state.dailyTrades >= Strategy.CONFIG.maxDailyTrades) {
                log('📊 Daily trade limit reached. Bot stopped.', 'warning');
                stopBot();
            }
            updateStats();
            return;
        }

        // Analyze
        const analysis = Strategy.analyzeSignals(prices);
        updateConfirmations(analysis.signals);
        updateSignalBars(Strategy.getSignalStrength(prices));
        
        // Update AI Confidence Display if element exists
        const aiConfidenceEl = document.getElementById('aiConfidenceValue');
        if (aiConfidenceEl) {
            aiConfidenceEl.textContent = analysis.aiConfidence + '%';
            if(analysis.aiConfidence >= Strategy.CONFIG.minAIConfidence) aiConfidenceEl.style.color = 'var(--color-profit)';
            else if(analysis.aiConfidence >= 50) aiConfidenceEl.style.color = 'var(--color-warning)';
            else aiConfidenceEl.style.color = 'var(--color-loss)';
        }

        if (analysis.confirmed && analysis.direction) {
            log(`🧠 AI CONFIDENCE [${analysis.aiConfidence}%] — 🎯 Signal: ${analysis.direction.toUpperCase()} | RSI: ${analysis.rsi?.toFixed(1)}`, 'success');

            // Calculate and display risk levels
            const { stopLoss, takeProfit } = Strategy.calculateRiskLevels(prices);
            slDisplay.textContent = '$' + stopLoss.toFixed(2);
            tpDisplay.textContent = '$' + takeProfit.toFixed(2);

            executeTrade(analysis.direction);
        }
    }

    async function executeTrade(direction) {
        const leverageLabel = Strategy.CONFIG.tradingMode === 'ACCU' 
            ? (Strategy.CONFIG.accuGrowthRate * 100) + '% Growth' 
            : Strategy.CONFIG.multiplier + 'x';
            
        log(`⚡ EXECUTING: ${direction.toUpperCase()} trade — $${Strategy.CONFIG.stake} | [${leverageLabel}]`, 'trade');

        try {
            const result = await Strategy.executeTrade(direction, prices);
            log(`✅ CONTRACT OPENED: #${result.contract_id} | Price: $${result.buy_price}`, 'success');

            addTradeToHistory(
                result.contract_id, 
                direction, 
                Strategy.CONFIG.stake, 
                leverageLabel, // pass formatted label
                result.buy_price
            );

            // Enable emergency controls
            panicBtn.disabled = false;
            breakEvenBtn.disabled = false;

            updateStats();
        } catch (err) {
            log(`❌ TRADE FAILED: ${err.message || err}`, 'error');
            Strategy.state.phase = 'SCANNING';
            updateStats();
        }
    }

    // ========== WEBSOCKET CALLBACKS ==========
    function setupCallbacks() {
        DerivWS.on('onTick', (tick) => {
            const price = parseFloat(tick.quote);
            prices.push(price);

            // Keep max 500 ticks in memory
            if (prices.length > 500) prices.shift();

            updatePrice(price);
            Chart.draw(prices);

            // Update RSI / ATR values
            const rsi = Indicators.rsi(prices, 14);
            const atr = Indicators.atr(prices, 14);
            if (rsi !== null) {
                const rsiValEl = document.getElementById('rsiValue');
                if (rsiValEl) rsiValEl.textContent = rsi.toFixed(1);
            }
            if (atr !== null) {
                const atrValEl = document.getElementById('atrValue');
                if (atrValEl) atrValEl.textContent = atr.toFixed(5);
            }

            // Run analysis if scanning
            if (botRunning && Strategy.state.phase === 'SCANNING') {
                runScanLoop();
            }
        });

        DerivWS.on('onBalance', (balance) => {
            updateBalance(balance.balance);
            const accType = balance.loginid?.startsWith('VR') ? 'DEMO' : 'REAL';
            accountTypeBadge.textContent = accType;
            if (accType === 'REAL') accountTypeBadge.classList.add('real');
        });

        DerivWS.on('onProposalOpenContract', (contract) => {
            if (!contract) return;

            updateContractPanel(contract);

            if (contract.status === 'sold' || contract.is_sold) {
                const profit = parseFloat(contract.profit) || 0;
                Strategy.recordTradeResult(profit);
                updateTradeHistory(contract.contract_id, profit, 'CLOSED');

                if (profit >= 0) {
                    log(`💰 CONTRACT CLOSED: +$${profit.toFixed(2)} PROFIT`, 'success');
                } else {
                    log(`💸 CONTRACT CLOSED: -$${Math.abs(profit).toFixed(2)} LOSS`, 'error');
                }
                
                showResultToast(profit);

                // Disable emergency controls
                panicBtn.disabled = true;
                breakEvenBtn.disabled = true;
                updateContractPanel(null);
                updateStats();

                // Check cooldown or hibernation
                if (Strategy.state.phase === 'COOLDOWN') {
                    const duration = Strategy.state.cooldownUntil - Date.now();
                    if (duration > 0) showCooldown(duration);
                } else if (Strategy.state.phase === 'HIBERNATING') {
                    stopBot();
                    log('💤 Bot Hibernating.', 'info');
                }
            } else {
                Strategy.manageContract(contract);
                updateTradeHistory(contract.contract_id, contract.profit, 'OPEN');
            }
        });

        DerivWS.on('onDisconnect', () => {
            log('🔌 Disconnected from Deriv.', 'error');
            const statusEl = document.getElementById('connectionStatus');
            if (statusEl) {
                statusEl.querySelector('.status-dot').classList.remove('connected');
                statusEl.querySelector('span:last-child').textContent = 'Disconnected';
            }
            stopBot();
        });

        DerivWS.on('onError', (error) => {
            if (error && error.message) {
                log(`⚠️ API Error: ${error.message}`, 'error');
            }
        });
    }

    // ========== CONNECTION ==========
    async function handleConnect() {
        const token = import.meta.env.VITE_DERIV_API_TOKEN || apiTokenInput.value.trim();
        const appId = import.meta.env.VITE_DERIV_APP_ID || appIdInput.value.trim() || '1089';

        if (!token) {
            showError('Please enter your API token');
            return;
        }

        // Get account type
        const activeTypeBtn = document.querySelector('.toggle-btn.active');
        accountType = activeTypeBtn ? activeTypeBtn.dataset.type : 'demo';

        // Show loading
        connectBtn.querySelector('.btn-text').style.display = 'none';
        connectBtn.querySelector('.btn-loader').style.display = 'inline';
        connectBtn.disabled = true;
        hideError();

        try {
            setupCallbacks();
            const authData = await DerivWS.connect(token, appId, accountType);

            if (authData.authorize) {
                const auth = authData.authorize;
                log(`✅ Authorized as: ${auth.fullname || auth.loginid}`, 'success');
                log(`Account: ${auth.loginid} | Currency: ${auth.currency}`, 'info');

                updateBalance(auth.balance);

                // Subscribe to data
                const historyData = await DerivWS.getTickHistory('R_10', 200);
                if (historyData.history && historyData.history.prices) {
                    prices = historyData.history.prices.map(Number);
                    log(`📈 Loaded ${prices.length} historical ticks`, 'info');
                    Chart.draw(prices);
                }

                DerivWS.subscribeTicks('R_10');
                DerivWS.subscribeBalance();
                DerivWS.subscribeTransactions();

                log('📡 Subscribed to R_10 ticks & balance updates', 'info');

                // Switch to dashboard
                connectModal.classList.remove('active');
                dashboard.style.display = 'flex';

                Chart.init();
                setTimeout(() => {
                    Chart.resizeAll();
                    Chart.draw(prices);
                }, 300);
            }
        } catch (err) {
            showError(err.message || 'Connection failed. Check your token and try again.');
            log(`❌ Connection failed: ${err.message || err}`, 'error');
        } finally {
            connectBtn.querySelector('.btn-text').style.display = 'inline';
            connectBtn.querySelector('.btn-loader').style.display = 'none';
            connectBtn.disabled = false;
        }
    }

    function showError(msg) {
        connectError.textContent = msg;
        connectError.style.display = 'block';
    }

    function hideError() {
        connectError.style.display = 'none';
    }

    // ========== BOT CONTROL ==========
    function startBot() {
        if (botRunning) return;

        botRunning = true;
        Strategy.start(currentBalance);

        startBtn.disabled = true;
        stopBtn.disabled = false;

        log('🤖 BOT STARTED — Scanning for signals...', 'success');
        log(`Config: Stake $${Strategy.CONFIG.stake} | Multiplier ${Strategy.CONFIG.multiplier}x | Symbol ${Strategy.CONFIG.symbol}`, 'info');

        updateStats();
    }

    function stopBot() {
        botRunning = false;
        Strategy.stop();

        startBtn.disabled = false;
        stopBtn.disabled = true;
        panicBtn.disabled = true;
        breakEvenBtn.disabled = true;

        log('⏹ BOT STOPPED', 'warning');
        updateStats();
    }

    async function handlePanicSell() {
        if (!Strategy.state.contractId) return;

        log('🚨 PANIC SELL — Closing position immediately!', 'warning');
        try {
            await Strategy.panicSell();
            log('✅ Position closed via panic sell', 'success');
        } catch (err) {
            log(`❌ Panic sell failed: ${err.message}`, 'error');
        }
    }

    async function handleBreakEven() {
        if (!Strategy.state.contractId) return;

        log('⚖️ Moving stop loss to break even...', 'info');
        try {
            await Strategy.moveToBreakEven();
            log('✅ Stop loss moved to break even', 'success');
        } catch (err) {
            log(`❌ Break even failed: ${err.message}`, 'error');
        }
    }

    function handleDisconnect() {
        stopBot();
        DerivWS.disconnect();
        dashboard.style.display = 'none';
        connectModal.classList.add('active');
        prices = [];
        log('🔌 Disconnected', 'info');
    }

    // ========== EVENT LISTENERS ==========
    function bindEvents() {
        // Connect
        connectBtn.addEventListener('click', handleConnect);
        apiTokenInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') handleConnect();
        });

        // Password toggle
        togglePassword.addEventListener('click', () => {
            const type = apiTokenInput.type === 'password' ? 'text' : 'password';
            apiTokenInput.type = type;
            togglePassword.textContent = type === 'password' ? '👁️' : '🙈';
        });

        // Account type toggle
        toggleBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                toggleBtns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
            });
        });

        // Bot controls
        startBtn.addEventListener('click', startBot);
        stopBtn.addEventListener('click', stopBot);
        panicBtn.addEventListener('click', handlePanicSell);
        breakEvenBtn.addEventListener('click', handleBreakEven);
        disconnectBtn.addEventListener('click', handleDisconnect);

        // Clear log
        clearLogBtn.addEventListener('click', () => {
            logEntries.innerHTML = '';
            log('Log cleared', 'info');
        });

        if (clearHistoryBtn) {
            clearHistoryBtn.addEventListener('click', () => {
                // Keep only OPEN trades to avoid breaking running logic
                tradeHistory = tradeHistory.filter(t => t.status === 'OPEN');
                saveHistory();
                renderHistory();
                log('Trade history cleared (closed trades removed).', 'info');
            });
        }
        
        if (tradingModeSelect) {
            function updateModeUI(mode) {
                // Update strategy config
                Strategy.CONFIG.tradingMode = mode;
                
                // Actualizar labels de la UI
                const modeLabel = mode === 'ACCU' ? 'FLAT MARKET SCAN' : 'TREND TREND SCAN';
                document.querySelector('.signal-analysis h3').textContent = `🎯 ${modeLabel}`;
                
                // Actualizar panel lateral derecho visualmente
                const rightPanelMultiplierLabel = document.querySelectorAll('.right-panel .control-group label')[2];
                const rightPanelMultiplierValue = document.querySelectorAll('.right-panel .control-group .value-display')[1];
                
                if (mode === 'ACCU') {
                    if (growthRateContainer) growthRateContainer.style.display = 'flex';
                    if (maxTicksContainer) maxTicksContainer.style.display = 'flex';
                    if (rightPanelMultiplierLabel) rightPanelMultiplierLabel.textContent = 'Growth';
                    if (rightPanelMultiplierValue) rightPanelMultiplierValue.textContent = (Strategy.CONFIG.accuGrowthRate * 100) + '%';
                } else {
                    if (growthRateContainer) growthRateContainer.style.display = 'none';
                    if (maxTicksContainer) maxTicksContainer.style.display = 'none';
                    if (rightPanelMultiplierLabel) rightPanelMultiplierLabel.textContent = 'Multiplier';
                    if (rightPanelMultiplierValue) rightPanelMultiplierValue.textContent = Strategy.CONFIG.multiplier + 'x';
                }
            }
            
            tradingModeSelect.addEventListener('change', (e) => {
                log(`Modo de trading cambiado a: ${e.target.value}`, 'warning');
                updateModeUI(e.target.value);
            });
            
            // Listen for Growth Rate changes
            if (accuGrowthRateSelect) {
                accuGrowthRateSelect.addEventListener('change', (e) => {
                    const rate = parseFloat(e.target.value);
                    Strategy.CONFIG.accuGrowthRate = rate;
                    log(`Accumulator Growth Rate changed to: ${rate * 100}%`, 'info');
                    updateModeUI(Strategy.CONFIG.tradingMode); // refresh labels
                });
                // Initialize growth rate
                Strategy.CONFIG.accuGrowthRate = parseFloat(accuGrowthRateSelect.value);
            }

            if (accuMaxTicksInput) {
                accuMaxTicksInput.addEventListener('change', (e) => {
                    let ticks = parseInt(e.target.value);
                    if (ticks < 2) ticks = 2; // Minimo 2
                    Strategy.CONFIG.accuMaxTicks = ticks;
                    log(`Accumulator Max Ticks set to: ${ticks}`, 'info');
                });
                Strategy.CONFIG.accuMaxTicks = parseInt(accuMaxTicksInput.value);
            }

            // Init default
            updateModeUI(tradingModeSelect.value);
        }

        // Indicator toggles
        indBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                const indicator = btn.dataset.indicator;
                btn.classList.toggle('active');
                Chart.toggleIndicator(indicator);

                // Show/hide panels
                if (indicator === 'rsi') {
                    const rsiPanel = document.getElementById('rsiPanel');
                    rsiPanel.style.display = btn.classList.contains('active') ? 'block' : 'none';
                }
                if (indicator === 'atr') {
                    const atrPanel = document.getElementById('atrPanel');
                    atrPanel.style.display = btn.classList.contains('active') ? 'block' : 'none';
                }

                Chart.draw(prices);
            });
        });
    }

    // ========== INIT ==========
    function init() {
        bindEvents();
        renderHistory();
        log('🚀 DerivMULT Trading Bot v1.0 initialized', 'info');
        
        const envToken = import.meta.env.VITE_DERIV_API_TOKEN;
        if (envToken) {
            log('Using internal credentials from .env. Connecting...', 'info');
            handleConnect();
        } else {
            log('Enter your API token and connect to start trading', 'info');
        }
    }

    // Start when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
