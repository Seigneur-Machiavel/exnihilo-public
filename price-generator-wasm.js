import WasmPriceGenerator from './build/price_generator.js';

class PriceGeneratorWasm {
    constructor() {
        this.wasmModule = null;
        this.initialized = false;
    }

    async initialize() {
        if (this.initialized) return;
        
        try {
            this.wasmModule = await WasmPriceGenerator();
            this.initialized = true;
            console.log('PriceGeneratorWasm initialized successfully');
        } catch (error) {
            console.error('Failed to initialize WASM:', error);
            throw error;
        }
    }

    #ensureInitialized() {
        if (!this.initialized || !this.wasmModule) {
            throw new Error('WASM module not initialized. Call initialize() first.');
        }
    }

    #allocateString(str) {
        const bytes = new TextEncoder().encode(str + '\0');
        const ptr = this.wasmModule._malloc(bytes.length);
        this.wasmModule.HEAP8.set(bytes, ptr);
        return ptr;
    }

    #allocateDoubleArray(array) {
        const ptr = this.wasmModule._malloc(array.length * 8);
        const view = new Float64Array(this.wasmModule.HEAP8.buffer, ptr, array.length);
        view.set(array);
        return { ptr, view };
    }

    #readString(ptr, maxLength = 256) {
        if (ptr === 0) return null;
        const bytes = new Uint8Array(this.wasmModule.HEAP8.buffer, ptr, maxLength);
        const end = bytes.indexOf(0);
        return new TextDecoder().decode(bytes.subarray(0, end >= 0 ? end : maxLength));
    }

    /**
     * Initialize storms system
     * @param {string} seed - Seed string
     * @param {number} stormPerCycle - Number of storms per cycle
     * @param {number} stormMaxMultiplier - Maximum storm multiplier
     */
    initStorms(seed, stormPerCycle = 0, stormMaxMultiplier = 2.0) {
        this.#ensureInitialized();
        
        const seedPtr = this.#allocateString(seed);
        try {
            this.wasmModule._init_storms(seedPtr, stormPerCycle, stormMaxMultiplier);
        } finally {
            this.wasmModule._free(seedPtr);
        }
    }

    /**
     * Generate a single price
     * @param {string} seed - Seed string
     * @param {number} lastPrice - Previous price
     * @param {number} volatility - Price volatility
     * @param {number} tickIndex - Current tick index
     * @param {number} digits - Number of decimal places
     * @returns {number} Generated price
     */
    generatePrice(seed, lastPrice, volatility, tickIndex, digits = 2) {
        this.#ensureInitialized();
        
        const seedPtr = this.#allocateString(seed);
        try {
            // Ajouter la longueur du seed
            return this.wasmModule._generate_price(seedPtr, seed.length, lastPrice, volatility, tickIndex, digits);
        } finally {
            this.wasmModule._free(seedPtr);
        }
    }

    /**
     * Generate multiple prices in batch (more efficient)
     * @param {string} seed - Seed string
     * @param {number[]} prices - Array of prices (first element should be the starting price)
     * @param {number} volatility - Price volatility
     * @param {number} startTickIndex - Starting tick index
     * @param {number} digits - Number of decimal places
     * @returns {number[]} Array of generated prices
     */
    generatePricesBatch(seed, prices, volatility, startTickIndex, digits = 2) {
        this.#ensureInitialized();
        
        const seedPtr = this.#allocateString(seed);
        const { ptr: pricesPtr, view: pricesView } = this.#allocateDoubleArray(prices);
        
        try {
            // Corriger l'ordre des paramètres pour inclure seed.length
            this.wasmModule._generate_prices_batch(
                seedPtr,
                seed.length,  // Ajouter la longueur du seed
                pricesPtr,
                prices.length,
                volatility,
                startTickIndex,
                digits
            );
            
            return Array.from(pricesView);
        } finally {
            this.wasmModule._free(seedPtr);
            this.wasmModule._free(pricesPtr);
        }
    }

    /**
     * Initialize storms system
     * @param {string} seed - Seed string
     * @param {number} stormPerCycle - Number of storms per cycle
     * @param {number} stormMaxMultiplier - Maximum storm multiplier
     */
    initStorms(seed, stormPerCycle = 0, stormMaxMultiplier = 2.0) {
        this.#ensureInitialized();
        
        const seedPtr = this.#allocateString(seed);
        try {
            // Ajouter la longueur du seed
            this.wasmModule._init_storms(seedPtr, seed.length, stormPerCycle, stormMaxMultiplier);
        } finally {
            this.wasmModule._free(seedPtr);
        }
    }

    /**
     * Get hash of a seed
     * @param {string} seed - Seed string
     * @returns {string} Seed hash (64 character hex string)
     */
    getSeedHash(seed) {
        this.#ensureInitialized();
        
        const seedPtr = this.#allocateString(seed);
        const hashPtr = this.wasmModule._malloc(65); // 64 chars + null terminator
        
        try {
            this.wasmModule._get_seed_hash(seedPtr, seed.length, hashPtr);
            return this.#readString(hashPtr, 65) || 'error';
        } finally {
            this.wasmModule._free(seedPtr);
            this.wasmModule._free(hashPtr);
        }
    }
}

// Singleton instance
let instance = null;

/**
 * Get the singleton instance of PriceGeneratorWasm
 * @returns {Promise<PriceGeneratorWasm>}
 */
export async function getPriceGenerator() {
    if (!instance) {
        instance = new PriceGeneratorWasm();
        await instance.initialize();
    }
    return instance;
}

/**
 * Quick API - Generate a single price
 * @param {string} seed - Seed string
 * @param {number} lastPrice - Previous price
 * @param {number} volatility - Price volatility
 * @param {number} tickIndex - Current tick index
 * @param {number} digits - Number of decimal places
 * @returns {Promise<number>} Generated price
 */
export async function generatePrice(seed, lastPrice, volatility, tickIndex, digits = 2) {
    const generator = await getPriceGenerator();
    return generator.generatePrice(seed, lastPrice, volatility, tickIndex, digits);
}

/**
 * Quick API - Generate multiple prices in batch
 * @param {string} seed - Seed string
 * @param {number[]} prices - Array of prices (first element should be the starting price)
 * @param {number} volatility - Price volatility
 * @param {number} startTickIndex - Starting tick index
 * @param {number} digits - Number of decimal places
 * @returns {Promise<number[]>} Array of generated prices
 */
export async function generatePricesBatch(seed, prices, volatility, startTickIndex, digits = 2) {
    const generator = await getPriceGenerator();
    return generator.generatePricesBatch(seed, prices, volatility, startTickIndex, digits);
}

/**
 * Quick API - Initialize storms
 * @param {string} seed - Seed string
 * @param {number} stormPerCycle - Number of storms per cycle
 * @param {number} stormMaxMultiplier - Maximum storm multiplier
 */
export async function initStorms(seed, stormPerCycle = 0, stormMaxMultiplier = 2.0) {
    const generator = await getPriceGenerator();
    return generator.initStorms(seed, stormPerCycle, stormMaxMultiplier);
}

/**
 * Quick API - Get storm multiplier
 * @param {number} tickIndex - Tick index
 * @returns {Promise<number>} Storm multiplier
 */
export async function getStormMultiplier(tickIndex) {
    const generator = await getPriceGenerator();
    return generator.getStormMultiplier(tickIndex);
}

/**
 * Quick API - Get seed hash
 * @param {string} seed - Seed string
 * @returns {Promise<string>} Seed hash
 */
export async function getSeedHash(seed) {
    const generator = await getPriceGenerator();
    return generator.getSeedHash(seed);
}

// Export both class and convenience functions
export { PriceGeneratorWasm };
export default { 
    getPriceGenerator, 
    generatePrice, 
    generatePricesBatch, 
    initStorms, 
    getStormMultiplier, 
    getSeedHash,
    PriceGeneratorWasm 
};