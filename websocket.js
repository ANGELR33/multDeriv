/**
 * Deriv WebSocket API Manager
 * Handles connection, authentication, subscriptions, and trading
 */

const DerivWS = (() => {
    let ws = null;
    let appId = '1089';
    let token = '';
    let accountType = 'demo';
    let isConnected = false;
    let reconnectAttempts = 0;
    const MAX_RECONNECT = 5;
    let pingInterval = null;
    let reqId = 0;

    // Callbacks
    const callbacks = {
        onConnect: null,
        onDisconnect: null,
        onError: null,
        onTick: null,
        onBalance: null,
        onAuthorize: null,
        onBuy: null,
        onSell: null,
        onProposal: null,
        onProposalOpenContract: null,
        onTickHistory: null,
        onTransaction: null,
    };

    // Pending request handlers
    const pendingRequests = {};

    function getNextReqId() {
        return ++reqId;
    }

    /**
     * Connect to Deriv WebSocket API
     */
    function connect(apiToken, appIdVal, accType) {
        return new Promise((resolve, reject) => {
            token = apiToken;
            appId = appIdVal || '1089';
            accountType = accType || 'demo';

            const wsUrl = `wss://ws.derivws.com/websockets/v3?app_id=${appId}`;

            try {
                ws = new WebSocket(wsUrl);
            } catch (err) {
                reject(new Error('Failed to create WebSocket connection'));
                return;
            }

            const timeout = setTimeout(() => {
                reject(new Error('Connection timed out'));
                if (ws) ws.close();
            }, 15000);

            ws.onopen = () => {
                clearTimeout(timeout);
                isConnected = true;
                reconnectAttempts = 0;

                // Start ping to keep alive
                pingInterval = setInterval(() => {
                    if (isConnected) send({ ping: 1 });
                }, 30000);

                // Authorize
                authorize().then(resolve).catch(reject);

                if (callbacks.onConnect) callbacks.onConnect();
            };

            ws.onclose = (event) => {
                isConnected = false;
                clearInterval(pingInterval);
                if (callbacks.onDisconnect) callbacks.onDisconnect(event);
            };

            ws.onerror = (error) => {
                clearTimeout(timeout);
                if (callbacks.onError) callbacks.onError(error);
                reject(new Error('WebSocket connection error'));
            };

            ws.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    handleMessage(data);
                } catch (e) {
                    console.error('Failed to parse message:', e);
                }
            };
        });
    }

    /**
     * Handle incoming message
     */
    function handleMessage(data) {
        // Handle errors
        if (data.error) {
            console.error('API Error:', data.error.message, data.error.code);
            // Resolve pending request with error
            if (data.req_id && pendingRequests[data.req_id]) {
                pendingRequests[data.req_id].reject(data.error);
                delete pendingRequests[data.req_id];
            }
            if (callbacks.onError) callbacks.onError(data.error);
            return;
        }

        // Resolve pending requests
        if (data.req_id && pendingRequests[data.req_id]) {
            pendingRequests[data.req_id].resolve(data);
            delete pendingRequests[data.req_id];
        }

        // Route to specific handler
        if (data.msg_type === 'tick') {
            if (callbacks.onTick) callbacks.onTick(data.tick);
        } else if (data.msg_type === 'balance') {
            if (callbacks.onBalance) callbacks.onBalance(data.balance);
        } else if (data.msg_type === 'authorize') {
            if (callbacks.onAuthorize) callbacks.onAuthorize(data.authorize);
        } else if (data.msg_type === 'buy') {
            if (callbacks.onBuy) callbacks.onBuy(data.buy);
        } else if (data.msg_type === 'sell') {
            if (callbacks.onSell) callbacks.onSell(data.sell);
        } else if (data.msg_type === 'proposal') {
            if (callbacks.onProposal) callbacks.onProposal(data.proposal);
        } else if (data.msg_type === 'proposal_open_contract') {
            if (callbacks.onProposalOpenContract) callbacks.onProposalOpenContract(data.proposal_open_contract);
        } else if (data.msg_type === 'history') {
            if (callbacks.onTickHistory) callbacks.onTickHistory(data.history);
        } else if (data.msg_type === 'transaction') {
            if (callbacks.onTransaction) callbacks.onTransaction(data.transaction);
        }
    }

    /**
     * Send a request
     */
    function send(payload) {
        if (!ws || ws.readyState !== WebSocket.OPEN) {
            console.error('WebSocket not connected');
            return null;
        }
        const id = getNextReqId();
        payload.req_id = id;
        ws.send(JSON.stringify(payload));
        return id;
    }

    /**
     * Send request and wait for response
     */
    function sendAndWait(payload, timeoutMs = 10000) {
        return new Promise((resolve, reject) => {
            const id = send(payload);
            if (!id) {
                reject(new Error('Failed to send request'));
                return;
            }
            const timeout = setTimeout(() => {
                delete pendingRequests[id];
                reject(new Error('Request timed out'));
            }, timeoutMs);

            pendingRequests[id] = {
                resolve: (data) => { clearTimeout(timeout); resolve(data); },
                reject: (err) => { clearTimeout(timeout); reject(err); },
            };
        });
    }

    /**
     * Authorize with token
     */
    function authorize() {
        return sendAndWait({ authorize: token });
    }

    /**
     * Subscribe to ticks for a symbol
     */
    function subscribeTicks(symbol = 'R_10') {
        send({
            ticks: symbol,
            subscribe: 1,
        });
    }

    /**
     * Get tick history
     */
    function getTickHistory(symbol = 'R_10', count = 200) {
        return sendAndWait({
            ticks_history: symbol,
            adjust_start_time: 1,
            count: count,
            end: 'latest',
            style: 'ticks',
        });
    }

    /**
     * Subscribe to balance updates
     */
    function subscribeBalance() {
        send({
            balance: 1,
            subscribe: 1,
        });
    }

    /**
     * Subscribe to transaction updates
     */
    function subscribeTransactions() {
        send({
            transaction: 1,
            subscribe: 1,
        });
    }

    /**
     * Buy a multiplier contract
     * @param {string} symbol - Market symbol
     * @param {number} amount - Stake amount
     * @param {number} multiplier - Multiplier value
     * @param {string} direction - 'multup' or 'multdown'
     * @param {object} options - { stop_loss, take_profit, deal_cancellation_duration }
     */
    function buyMultiplier(symbol, amount, multiplier, direction, options = {}) {
        const payload = {
            buy: 1,
            price: 100, // max price
            parameters: {
                contract_type: direction === 'up' ? 'MULTUP' : 'MULTDOWN',
                symbol: symbol,
                amount: amount,
                multiplier: multiplier,
                currency: 'USD',
                basis: 'stake',
            },
        };

        if (options.stop_loss) {
            payload.parameters.limit_order = payload.parameters.limit_order || {};
            payload.parameters.limit_order.stop_loss = options.stop_loss;
        }
        if (options.take_profit) {
            payload.parameters.limit_order = payload.parameters.limit_order || {};
            payload.parameters.limit_order.take_profit = options.take_profit;
        }
        if (options.deal_cancellation_duration) {
            payload.parameters.cancellation = options.deal_cancellation_duration;
        }

        return sendAndWait(payload, 30000);
    }

    /**
     * Buy an Accumulator contract
     */
    function buyAccumulator(symbol, amount, growthRate = 0.05) {
        const payload = {
            buy: 1,
            price: 100, // max price or stake equivalent
            parameters: {
                contract_type: 'ACCU',
                symbol: symbol,
                amount: amount,
                currency: 'USD',
                basis: 'stake',
                growth_rate: growthRate
            },
        };

        return sendAndWait(payload, 30000);
    }

    /**
     * Sell a contract
     * @param {number} contractId - Contract ID to sell
     */
    function sellContract(contractId) {
        return sendAndWait({
            sell: contractId,
            price: 0, // sell at market
        }, 15000);
    }

    /**
     * Subscribe to open contract updates
     */
    function subscribeOpenContract(contractId) {
        send({
            proposal_open_contract: 1,
            contract_id: contractId,
            subscribe: 1,
        });
    }

    /**
     * Update limit order on open contract
     */
    function updateContract(contractId, limitOrder) {
        return sendAndWait({
            contract_update: 1,
            contract_id: contractId,
            limit_order: limitOrder,
        });
    }

    /**
     * Cancel deal cancellation
     */
    function cancelDealCancellation(contractId) {
        return sendAndWait({
            cancel: contractId,
        });
    }

    /**
     * Disconnect
     */
    function disconnect() {
        isConnected = false;
        clearInterval(pingInterval);
        if (ws) {
            ws.close();
            ws = null;
        }
    }

    /**
     * Register a callback
     */
    function on(event, callback) {
        if (callbacks.hasOwnProperty(event)) {
            callbacks[event] = callback;
        }
    }

    /**
     * Check if connected
     */
    function connected() {
        return isConnected && ws && ws.readyState === WebSocket.OPEN;
    }

    return {
        connect,
        disconnect,
        send,
        sendAndWait,
        subscribeTicks,
        getTickHistory,
        subscribeBalance,
        subscribeTransactions,
        buyMultiplier,
        buyAccumulator,
        sellContract,
        subscribeOpenContract,
        updateContract,
        cancelDealCancellation,
        on,
        connected,
    };
})();
