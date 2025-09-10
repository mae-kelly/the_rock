import { EventEmitter } from 'events';

class StockMonitor extends EventEmitter {
  constructor(options = {}) {
    super();
    this.thresholdMin = options.thresholdMin || 9.0;
    this.thresholdMax = options.thresholdMax || 13.0;
    this.bufferSize = options.bufferSize || 120;
    this.stockBuffers = new Map();
    this.activeStocks = new Map();
  }

  processUpdate(data) {
    if (data.type === 'trade') {
      this.processTrade(data);
    }
  }

  processTrade(trade) {
    const { symbol, price, timestamp, volume } = trade;
    
    // Get or create buffer
    if (!this.stockBuffers.has(symbol)) {
      this.stockBuffers.set(symbol, []);
    }
    
    const buffer = this.stockBuffers.get(symbol);
    buffer.push({ price, timestamp, volume });
    
    // Keep only last 2 minutes
    const twoMinutesAgo = Date.now() - 120000;
    const filtered = buffer.filter(p => p.timestamp > twoMinutesAgo);
    this.stockBuffers.set(symbol, filtered);
    
    // Calculate percentage change
    if (filtered.length > 5) {
      const prices = filtered.map(p => p.price);
      const minPrice = Math.min(...prices);
      const currentPrice = price;
      const changePercent = ((currentPrice - minPrice) / minPrice) * 100;
      
      if (changePercent >= this.thresholdMin && changePercent <= this.thresholdMax) {
        const alertData = {
          symbol,
          changePercent,
          currentPrice,
          minPrice,
          maxPrice: Math.max(...prices),
          volume,
          timestamp: Date.now(),
          webullUrl: `https://www.webull.com/quote/nasdaq-${symbol.toLowerCase()}`
        };
        
        this.activeStocks.set(symbol, alertData);
        this.emit('threshold-detected', alertData);
      } else {
        this.activeStocks.delete(symbol);
      }
    }
  }

  getActiveStocks() {
    return Array.from(this.activeStocks.values())
      .sort((a, b) => b.changePercent - a.changePercent);
  }
}

export default StockMonitor;
