/**
 * Chart Module — Canvas-based real-time price chart with indicators
 */

const Chart = (() => {
    let priceCanvas, priceCtx;
    let rsiCanvas, rsiCtx;
    let atrCanvas, atrCtx;
    
    // Display config
    const DISPLAY_TICKS = 150;
    const COLORS = {
        price: '#00d4aa',
        sma20: '#7b61ff',
        sma50: '#ff6d00',
        grid: 'rgba(255,255,255,0.04)',
        gridText: 'rgba(255,255,255,0.2)',
        rsiLine: '#40c4ff',
        rsiOverbought: 'rgba(255,82,82,0.3)',
        rsiOversold: 'rgba(0,230,118,0.3)',
        rsiZone: 'rgba(64,196,255,0.08)',
        atrLine: '#ffab40',
        atrFill: 'rgba(255,171,64,0.08)',
        crosshairLine: 'rgba(255,255,255,0.1)',
        priceFill: 'rgba(0,212,170,0.06)',
        profitLine: '#00e676',
        lossLine: '#ff5252',
    };

    // Visible indicators
    const visible = {
        sma20: true,
        sma50: true,
        rsi: true,
        atr: true,
    };

    const tradeMarkers = [];

    function addTradeMarker(type, price, isWin, tickIndex) {
        tradeMarkers.push({ type, price, isWin, tickIndex });
        if (tradeMarkers.length > 50) tradeMarkers.shift();
    }

    function init() {
        priceCanvas = document.getElementById('priceChart');
        rsiCanvas = document.getElementById('rsiChart');
        atrCanvas = document.getElementById('atrChart');

        if (priceCanvas) priceCtx = priceCanvas.getContext('2d');
        if (rsiCanvas) rsiCtx = rsiCanvas.getContext('2d');
        if (atrCanvas) atrCtx = atrCanvas.getContext('2d');

        resizeAll();
        window.addEventListener('resize', resizeAll);
    }

    function resizeAll() {
        resizeCanvas(priceCanvas);
        resizeCanvas(rsiCanvas);
        resizeCanvas(atrCanvas);
    }

    function resizeCanvas(canvas) {
        if (!canvas) return;
        const parent = canvas.parentElement;
        const dpr = window.devicePixelRatio || 1;
        canvas.width = parent.clientWidth * dpr;
        canvas.height = parent.clientHeight * dpr;
        canvas.style.width = parent.clientWidth + 'px';
        canvas.style.height = parent.clientHeight + 'px';
        const ctx = canvas.getContext('2d');
        ctx.scale(dpr, dpr);
    }

    function toggleIndicator(indicator) {
        if (visible.hasOwnProperty(indicator)) {
            visible[indicator] = !visible[indicator];
        }
    }

    /**
     * Draw the full chart
     * @param {number[]} prices - All tick prices
     */
    function draw(prices) {
        if (!prices || prices.length < 2) return;
        
        const displayPrices = prices.slice(-DISPLAY_TICKS);
        
        drawPriceChart(displayPrices, prices);
        if (visible.rsi) drawRSIChart(prices);
        if (visible.atr) drawATRChart(prices);
    }

    function drawPriceChart(displayPrices, allPrices) {
        if (!priceCtx || !priceCanvas) return;

        const w = priceCanvas.clientWidth;
        const h = priceCanvas.clientHeight;
        const padding = { top: 20, right: 60, bottom: 20, left: 10 };
        const chartW = w - padding.left - padding.right;
        const chartH = h - padding.top - padding.bottom;

        priceCtx.clearRect(0, 0, w, h);

        if (displayPrices.length < 2) return;

        // Price range
        const minP = Math.min(...displayPrices);
        const maxP = Math.max(...displayPrices);
        const range = maxP - minP || 0.01;
        const marginRange = range * 0.1;

        const yMin = minP - marginRange;
        const yMax = maxP + marginRange;

        const px = (i) => padding.left + (i / (displayPrices.length - 1)) * chartW;
        const py = (v) => padding.top + (1 - (v - yMin) / (yMax - yMin)) * chartH;

        // Grid lines (horizontal)
        priceCtx.strokeStyle = COLORS.grid;
        priceCtx.lineWidth = 0.5;
        const gridLines = 5;
        for (let i = 0; i <= gridLines; i++) {
            const yVal = yMin + (i / gridLines) * (yMax - yMin);
            const y = py(yVal);
            priceCtx.beginPath();
            priceCtx.moveTo(padding.left, y);
            priceCtx.lineTo(w - padding.right, y);
            priceCtx.stroke();

            // Price label
            priceCtx.fillStyle = COLORS.gridText;
            priceCtx.font = '10px JetBrains Mono, monospace';
            priceCtx.textAlign = 'left';
            priceCtx.fillText(yVal.toFixed(4), w - padding.right + 6, y + 4);
        }

        // Price area fill
        priceCtx.beginPath();
        priceCtx.moveTo(px(0), py(displayPrices[0]));
        for (let i = 1; i < displayPrices.length; i++) {
            priceCtx.lineTo(px(i), py(displayPrices[i]));
        }
        priceCtx.lineTo(px(displayPrices.length - 1), py(yMin));
        priceCtx.lineTo(px(0), py(yMin));
        priceCtx.closePath();
        const gradient = priceCtx.createLinearGradient(0, padding.top, 0, h - padding.bottom);
        gradient.addColorStop(0, 'rgba(0, 212, 170, 0.12)');
        gradient.addColorStop(1, 'rgba(0, 212, 170, 0.0)');
        priceCtx.fillStyle = gradient;
        priceCtx.fill();

        // Price line
        priceCtx.beginPath();
        priceCtx.moveTo(px(0), py(displayPrices[0]));
        for (let i = 1; i < displayPrices.length; i++) {
            priceCtx.lineTo(px(i), py(displayPrices[i]));
        }
        priceCtx.strokeStyle = COLORS.price;
        priceCtx.lineWidth = 1.8;
        priceCtx.stroke();

        // Latest price dot
        const lastX = px(displayPrices.length - 1);
        const lastY = py(displayPrices[displayPrices.length - 1]);
        priceCtx.beginPath();
        priceCtx.arc(lastX, lastY, 4, 0, Math.PI * 2);
        priceCtx.fillStyle = COLORS.price;
        priceCtx.fill();
        priceCtx.beginPath();
        priceCtx.arc(lastX, lastY, 8, 0, Math.PI * 2);
        priceCtx.strokeStyle = 'rgba(0, 212, 170, 0.3)';
        priceCtx.lineWidth = 1;
        priceCtx.stroke();

        // Current price tag
        priceCtx.fillStyle = '#00d4aa';
        priceCtx.fillRect(w - padding.right + 2, lastY - 10, padding.right - 4, 20);
        priceCtx.fillStyle = '#0a0e17';
        priceCtx.font = 'bold 10px JetBrains Mono, monospace';
        priceCtx.textAlign = 'center';
        priceCtx.fillText(displayPrices[displayPrices.length - 1].toFixed(4), w - padding.right / 2 + 1, lastY + 4);

        // --- Active Trade Line ---
        if (window.Strategy && window.Strategy.state.phase === 'MANAGING' && window.Strategy.state.activeContract && window.Strategy.state.activeContract.entry_spot) {
            const entrySpot = parseFloat(window.Strategy.state.activeContract.entry_spot);
            const entryY = py(entrySpot);
            
            priceCtx.beginPath();
            priceCtx.setLineDash([4, 4]);
            priceCtx.strokeStyle = '#00a3ff'; // Info blue
            priceCtx.moveTo(padding.left, entryY);
            priceCtx.lineTo(w - padding.right, entryY);
            priceCtx.stroke();
            priceCtx.setLineDash([]);
            
            priceCtx.fillStyle = '#00a3ff';
            priceCtx.font = 'bold 10px JetBrains Mono, monospace';
            priceCtx.textAlign = 'left';
            priceCtx.fillText('ENTRY ' + entrySpot.toFixed(4), padding.left + 5, entryY - 5);
        }

        // --- Trade Markers (Entry/Exit) ---
        tradeMarkers.forEach(marker => {
            const offsetFromEnd = allPrices.length - 1 - marker.tickIndex;
            const displayIndex = displayPrices.length - 1 - offsetFromEnd;
            
            if (displayIndex >= 0 && displayIndex < displayPrices.length) {
                const mx = px(displayIndex);
                const my = py(marker.price);
                
                priceCtx.beginPath();
                priceCtx.arc(mx, my, 5, 0, Math.PI * 2);
                priceCtx.fillStyle = marker.type === 'ENTRY' ? '#00a3ff' : (marker.isWin ? '#00e676' : '#ff5252');
                priceCtx.fill();
                priceCtx.strokeStyle = '#0a0e17';
                priceCtx.lineWidth = 2;
                priceCtx.stroke();
            }
        });

        // SMA Lines
        if (visible.sma20) {
            const sma20All = Indicators.smaSeries(allPrices, 20);
            const sma20Display = sma20All.slice(-DISPLAY_TICKS);
            drawIndicatorLine(priceCtx, sma20Display, displayPrices, px, py, COLORS.sma20, 1.2);
        }

        if (visible.sma50) {
            const sma50All = Indicators.smaSeries(allPrices, 50);
            const sma50Display = sma50All.slice(-DISPLAY_TICKS);
            drawIndicatorLine(priceCtx, sma50Display, displayPrices, px, py, COLORS.sma50, 1.2);
        }
    }

    function drawIndicatorLine(ctx, data, displayPrices, px, py, color, lineWidth) {
        ctx.beginPath();
        let started = false;
        for (let i = 0; i < data.length; i++) {
            if (data[i] === null) continue;
            const x = px(i);
            const y = py(data[i]);
            if (!started) {
                ctx.moveTo(x, y);
                started = true;
            } else {
                ctx.lineTo(x, y);
            }
        }
        ctx.strokeStyle = color;
        ctx.lineWidth = lineWidth;
        ctx.setLineDash([4, 3]);
        ctx.stroke();
        ctx.setLineDash([]);
    }

    function drawRSIChart(allPrices) {
        if (!rsiCtx || !rsiCanvas) return;

        const w = rsiCanvas.clientWidth;
        const h = rsiCanvas.clientHeight;
        const padding = { top: 24, right: 40, bottom: 4, left: 10 };

        rsiCtx.clearRect(0, 0, w, h);

        const rsiAll = Indicators.rsiSeries(allPrices, 14);
        const rsiDisplay = rsiAll.slice(-DISPLAY_TICKS);

        const chartW = w - padding.left - padding.right;
        const chartH = h - padding.top - padding.bottom;

        const px = (i) => padding.left + (i / Math.max(1, rsiDisplay.length - 1)) * chartW;
        const py = (v) => padding.top + (1 - v / 100) * chartH;

        // Overbought zone
        rsiCtx.fillStyle = COLORS.rsiOverbought;
        rsiCtx.fillRect(padding.left, py(100), chartW, py(70) - py(100));

        // Oversold zone
        rsiCtx.fillStyle = COLORS.rsiOversold;
        rsiCtx.fillRect(padding.left, py(30), chartW, py(0) - py(30));

        // 50 line
        rsiCtx.strokeStyle = 'rgba(255,255,255,0.1)';
        rsiCtx.lineWidth = 0.5;
        rsiCtx.setLineDash([3, 3]);
        rsiCtx.beginPath();
        rsiCtx.moveTo(padding.left, py(50));
        rsiCtx.lineTo(w - padding.right, py(50));
        rsiCtx.stroke();
        rsiCtx.setLineDash([]);

        // 70 and 30 lines
        rsiCtx.strokeStyle = 'rgba(255,255,255,0.06)';
        rsiCtx.beginPath();
        rsiCtx.moveTo(padding.left, py(70));
        rsiCtx.lineTo(w - padding.right, py(70));
        rsiCtx.moveTo(padding.left, py(30));
        rsiCtx.lineTo(w - padding.right, py(30));
        rsiCtx.stroke();

        // RSI line
        rsiCtx.beginPath();
        let started = false;
        for (let i = 0; i < rsiDisplay.length; i++) {
            if (rsiDisplay[i] === null) continue;
            const x = px(i);
            const y = py(rsiDisplay[i]);
            if (!started) { rsiCtx.moveTo(x, y); started = true; }
            else rsiCtx.lineTo(x, y);
        }
        rsiCtx.strokeStyle = COLORS.rsiLine;
        rsiCtx.lineWidth = 1.5;
        rsiCtx.stroke();

        // Labels
        rsiCtx.fillStyle = COLORS.gridText;
        rsiCtx.font = '9px JetBrains Mono';
        rsiCtx.textAlign = 'left';
        rsiCtx.fillText('70', w - padding.right + 4, py(70) + 3);
        rsiCtx.fillText('30', w - padding.right + 4, py(30) + 3);
        rsiCtx.fillText('50', w - padding.right + 4, py(50) + 3);
    }

    function drawATRChart(allPrices) {
        if (!atrCtx || !atrCanvas) return;

        const w = atrCanvas.clientWidth;
        const h = atrCanvas.clientHeight;
        const padding = { top: 24, right: 40, bottom: 4, left: 10 };

        atrCtx.clearRect(0, 0, w, h);

        const atrAll = Indicators.atrSeries(allPrices, 14);
        const atrDisplay = atrAll.slice(-DISPLAY_TICKS);

        const validATR = atrDisplay.filter(v => v !== null);
        if (validATR.length < 2) return;

        const minATR = Math.min(...validATR);
        const maxATR = Math.max(...validATR);
        const atrRange = maxATR - minATR || 0.001;

        const chartW = w - padding.left - padding.right;
        const chartH = h - padding.top - padding.bottom;

        const px = (i) => padding.left + (i / Math.max(1, atrDisplay.length - 1)) * chartW;
        const py = (v) => padding.top + (1 - (v - minATR) / (atrRange * 1.2)) * chartH;

        // ATR fill
        atrCtx.beginPath();
        let started = false;
        let firstX = 0;
        for (let i = 0; i < atrDisplay.length; i++) {
            if (atrDisplay[i] === null) continue;
            const x = px(i);
            const y = py(atrDisplay[i]);
            if (!started) { atrCtx.moveTo(x, y); firstX = x; started = true; }
            else atrCtx.lineTo(x, y);
        }
        const lastIdx = atrDisplay.length - 1;
        atrCtx.lineTo(px(lastIdx), h - padding.bottom);
        atrCtx.lineTo(firstX, h - padding.bottom);
        atrCtx.closePath();
        atrCtx.fillStyle = COLORS.atrFill;
        atrCtx.fill();

        // ATR line
        atrCtx.beginPath();
        started = false;
        for (let i = 0; i < atrDisplay.length; i++) {
            if (atrDisplay[i] === null) continue;
            const x = px(i);
            const y = py(atrDisplay[i]);
            if (!started) { atrCtx.moveTo(x, y); started = true; }
            else atrCtx.lineTo(x, y);
        }
        atrCtx.strokeStyle = COLORS.atrLine;
        atrCtx.lineWidth = 1.5;
        atrCtx.stroke();

        // Min threshold line
        if (Strategy.CONFIG.atrMinThreshold >= minATR && Strategy.CONFIG.atrMinThreshold <= maxATR * 1.2) {
            atrCtx.strokeStyle = 'rgba(255,82,82,0.4)';
            atrCtx.lineWidth = 1;
            atrCtx.setLineDash([4, 4]);
            atrCtx.beginPath();
            const threshY = py(Strategy.CONFIG.atrMinThreshold);
            atrCtx.moveTo(padding.left, threshY);
            atrCtx.lineTo(w - padding.right, threshY);
            atrCtx.stroke();
            atrCtx.setLineDash([]);

            atrCtx.fillStyle = 'rgba(255,82,82,0.5)';
            atrCtx.font = '9px JetBrains Mono';
            atrCtx.fillText('MIN', w - padding.right + 4, threshY + 3);
        }
    }

    return {
        init,
        draw,
        toggleIndicator,
        resizeAll,
        visible,
        addTradeMarker
    };
})();
