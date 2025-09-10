import Alpaca from '@alpacahq/alpaca-trade-api';
import WebSocket from 'ws';

class AlpacaDataStream {
  constructor(options) {
    this.keyId = options.keyId;
    this.secretKey = options.secretKey;
    this.onData = options.onData;
    this.ws = null;
    this.authenticated = false;
    
    this.alpaca = new Alpaca({
      keyId: this.keyId,
      secretKey: this.secretKey,
      paper: true
    });
  }

  async connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket('wss://stream.data.alpaca.markets/v2/iex');
      
      this.ws.on('open', () => {
        this.authenticate();
      });
      
      this.ws.on('message', (data) => {
        const messages = JSON.parse(data);
        
        for (const msg of (Array.isArray(messages) ? messages : [messages])) {
          if (msg.msg === 'authenticated') {
            this.authenticated = true;
            console.log('✅ Authenticated with Alpaca');
            resolve();
          } else if (msg.T === 't') {
            this.processTrade(msg);
          }
        }
      });
      
      this.ws.on('error', reject);
    });
  }

  authenticate() {
    this.ws.send(JSON.stringify({
      action: 'auth',
      key: this.keyId,
      secret: this.secretKey
    }));
  }

  processTrade(trade) {
    if (this.onData) {
      this.onData({
        type: 'trade',
        symbol: trade.S,
        price: trade.p,
        volume: trade.s,
        timestamp: Date.now()
      });
    }
  }

  async subscribe(symbols) {
    if (!this.authenticated) return;
    
    // Batch subscribe
    const batchSize = 30;
    for (let i = 0; i < symbols.length; i += batchSize) {
      const batch = symbols.slice(i, i + batchSize);
      this.ws.send(JSON.stringify({
        action: 'subscribe',
        trades: batch
      }));
      await new Promise(r => setTimeout(r, 100));
    }
  }

  async getAllSymbols() {
    try {
      const assets = await this.alpaca.getAssets({ status: 'active', tradable: true });
      return assets
        .filter(a => a.tradable && a.exchange === 'NASDAQ')
        .map(a => a.symbol)
        .slice(0, 500); // Limit for testing
    } catch (error) {
      console.error('Error fetching symbols:', error);
      return ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'TSLA', 'META', 'NVDA'];
    }
  }

  isConnected() {
    return this.ws && this.authenticated;
  }
}

export default AlpacaDataStream;
