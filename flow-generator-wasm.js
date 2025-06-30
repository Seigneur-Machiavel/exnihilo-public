// VERSION 1.0.0
import { generateRandomSeed, todayFirstTimestamp } from '../utils.js';
import { getPriceGenerator, initStorms, generatePrice,
	generatePricesBatch, getSeedHash, getStormMultiplier } from './price-generator-wasm.js';

const timeframesMs = { '15s': 15000, '1m': 60000, '5m': 300000, '15m': 900000, '1h': 3600000 };

function newTick(time = 0, price = 0) {
    return [time, price];
}
function newOhlcCandle(time = 0, open = 0, high = 0, low = 0, close = 0) {
    return [time, open, high, low, close];
}

export class FlowGeneratorWasm {
    ticksPerCycle = 86400;
    lastTickIndex = 86400 + 1;
    digits = 2;
    
    initPrice;
    volatility;
    tickInterval;
    stormPerCycle = 0;
    stormMaxMultiplier = 2.0;
    seed;
    seedHash;
    
    // RUNTIME PROPERTIES
    initialized = false;
    /** @type {function | null} */
    onTickHandler = null;
    /** @type {function | null} */
    endCycleHandler = null;
    isRunning = false;
    intervalId = null;
    tickCount = 0;
    lastTick;
    ticks;
    /** @type {Record<string, number[][]>} */
    ohlc = { '15s': [], '1m': [], '5m': [], '15m': [], '1h': [] };
    /** @type {Record<string, Record<number, number[]>>} */
    ohlcvByTimestamp = { '15s': {}, '1m': {}, '5m': {}, '15m': {}, '1h': {} };
    /** @type {Record<string, number[]>} */
    currentCandles = { '15s': null, '1m': null, '5m': null, '15m': null, '1h': null };

    constructor(
        initPrice = 1000.0, volatility = 0.001, tickInterval = 500,
        stormPerCycle = 0, stormMaxMultiplier = 2.0,
        seed = generateRandomSeed(), startTimestamp = todayFirstTimestamp()
    ) {
        this.initPrice = initPrice; this.volatility = volatility; this.tickInterval = tickInterval;
        this.stormPerCycle = stormPerCycle; this.stormMaxMultiplier = stormMaxMultiplier;
        this.seed = seed;
        
        this.#initializeAsync(startTimestamp, initPrice);
    }

	async resetAndInitialize(
		initPrice = 1000.0,volatility = 0.001, tickInterval = 500,
		stormPerCycle = 0, stormMaxMultiplier = 2.0, seed = generateRandomSeed(), startTimestamp = todayFirstTimestamp()
	) {
		this.initialized = false;
		this.ohlc = { '15s': [], '1m': [], '5m': [], '15m': [], '1h': [] };
		this.ohlcvByTimestamp = { '15s': {}, '1m': {}, '5m': {}, '15m': {}, '1h': {} };
		this.onTickHandler = null;
		this.endCycleHandler = null;
		this.isRunning = false;
		this.intervalId = null;
		this.ticksMultipliers = [0];

		this.initPrice = initPrice; this.volatility = volatility; this.tickInterval = tickInterval;
		this.stormPerCycle = stormPerCycle; this.stormMaxMultiplier = stormMaxMultiplier;
		this.seed = seed;

		await this.#initializeAsync(startTimestamp, initPrice);
	}

    async #initializeAsync(startTimestamp, initPrice) {
        try {
            await getPriceGenerator(); // initialize the WASM module
            await initStorms(this.seed, this.stormPerCycle, this.stormMaxMultiplier);

            this.seedHash = await getSeedHash(this.seed);
        
            const tick = newTick(startTimestamp, initPrice);
            this.#initializeCandles(startTimestamp, initPrice);
            this.lastTick = tick;
            this.ticks = [tick];
            this.tickCount = 1;
            this.initialized = true;
            
            console.log('FlowGeneratorWasm initialized successfully, seed hash:', this.seedHash);
        } catch (error) { console.error('Failed to initialize FlowGeneratorWasm:', error); throw error; }
    }
    #initializeCandles(timestamp, price) {
        for (const [tf, interval] of Object.entries(timeframesMs)) {
            const candleStart = Math.floor(timestamp / interval) * interval;
            this.currentCandles[tf] = newOhlcCandle(candleStart, price, price, price, price);
        }
    }
    #updateOhlcCandles(timestamp, price) {
        for (const [tf, interval] of Object.entries(timeframesMs)) {
            const candleStart = Math.floor(timestamp / interval) * interval;
            const currentCandle = this.currentCandles[tf];
            if (!currentCandle) throw new Error(`Current candle for timeframe ${tf} not initialized`);
            
            this.currentCandles[tf][2] = Math.max(currentCandle[2], price); // high
            this.currentCandles[tf][3] = Math.min(currentCandle[3], price); // low
            this.currentCandles[tf][4] = price; // close
            if (currentCandle[0] === candleStart) continue;

            this.ohlcvByTimestamp[tf][currentCandle[0]] = currentCandle;
            this.ohlc[tf].push(currentCandle);
            this.currentCandles[tf] = newOhlcCandle(candleStart, price, price, price, price);
        }
    }
    async #generatePrice() {
        if (!this.initialized) throw new Error('FlowGeneratorWasm not initialized');
        return await generatePrice(this.seed, this.lastTick[1], this.volatility, this.tickCount, this.digits);
    }
    async #updateTick() {
        const newPrice = await this.#generatePrice();
        const newTime = this.lastTick[0] + this.tickInterval;
        const tick = newTick(newTime, newPrice);
        this.lastTick = tick;
        this.ticks.push(tick);
        this.tickCount++;
        
        this.#updateOhlcCandles(newTime, newPrice);
        if (this.onTickHandler) this.onTickHandler(tick, this.currentCandles);
        if (this.tickCount < this.lastTickIndex) return;
        this.isRunning = false;
        clearInterval(this.intervalId);
        if (this.endCycleHandler) this.endCycleHandler(tick);
    }
    async startSynchronizedOnNow() {
        if (this.isRunning) return;
        if (!this.initialized) throw new Error('FlowGeneratorWasm not initialized.');

        this.isRunning = true;
        await this.#ticksUntilSync();
        if (!this.isRunning) return;
        this.intervalId = setInterval(async () => await this.#ticksUntilSync(), this.tickInterval);
    }
    async #ticksUntilSync() {
        const targetTime = Date.now() - this.tickInterval;
        while(this.isRunning && this.lastTick[0] < targetTime) await this.#updateTick();
    }
    destroy() {
        this.isRunning = false;
        this.intervalId = null;
        this.onTickHandler = null;
        this.endCycleHandler = null;
    }
    /** @param {'15s' | '1m' | '5m' | '15m' | '1h'} [timeframe] default 1m @param {number} [maxCandles] default 100 */
    getOhlcData(timeframe = '1m', maxCandles = 100) {
        const candles = this.ohlc[timeframe].slice(-maxCandles);
        const currentCandle = this.currentCandles[timeframe];
        const [time, open, high, low, close] = currentCandle;
        if (open === high && open === low && open === close) return candles;

        if (candles.length === 0) candles.push(currentCandle);
        else if (currentCandle[0] !== candles[candles.length - 1][0]) candles.push(currentCandle);
        
        return candles;
    }
    /** @param {'15s' | '1m' | '5m' | '15m' | '1h'} [timeframe] default 1m */
    getCurrentCandle(timeframe = '1m') {
        return this.currentCandles[timeframe];
    }

    // DEV METHODS
    async doTicks(amount = 1) {
        if (!this.initialized) throw new Error('FlowGeneratorWasm not initialized');
        for (let i = 0; i < amount; i++) await this.#updateTick();
    }
    /** Fast batch tick generation using WASM batch processing */
    async doTicksBatch(amount = 1) {
        if (!this.initialized) throw new Error('FlowGeneratorWasm not initialized');
        
        const batchSize = Math.min(amount, 1000); // Process in batches of max 1000
        let remaining = amount;
        
        while (remaining > 0) {
            const currentBatch = Math.min(remaining, batchSize);
            const prices = new Array(currentBatch);
            prices[0] = this.lastTick[1];
            
			const newPrices = await generatePricesBatch(this.seed, prices, this.volatility, this.tickCount, this.digits);
            for (let i = 0; i < currentBatch; i++) {
                const newTime = this.lastTick[0] + this.tickInterval;
                const tick = newTick(newTime, newPrices[i]);
                this.lastTick = tick;
                this.ticks.push(tick);
                this.tickCount++;
                
                this.#updateOhlcCandles(newTime, newPrices[i]);
                if (this.onTickHandler) this.onTickHandler(tick, this.currentCandles);
            }
            
            remaining -= currentBatch;
        }
    }
    getData_dev(maxTicks = 100, includesSeed = false) {
        return {
            seed: includesSeed ? this.seed : null,
            seedHash: this.seedHash,
            lastTick: this.lastTick,
            tickInterval: this.tickInterval,
            ticks: this.ticks.slice(-maxTicks),
            ohlc: {
                '1m': this.getOhlcData('1m', 10),
                '5m': this.getOhlcData('5m', 10), 
                '15m': this.getOhlcData('15m', 10),
                '1h': this.getOhlcData('1h', 10)
            }
        };
    }
    getDataWithJumps_dev(maxTicks = 100, gap = 100) {
        const data = this.getData_dev(maxTicks);
        data.ticks = data.ticks.filter((_, index) => index % gap === 0);
        return data;
    }
    async getStormMultiplier(tickIndex) {
        if (!this.initialized) return 1.0;
        return await getStormMultiplier(tickIndex);
    }
}