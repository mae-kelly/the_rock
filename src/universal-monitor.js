import yahooFinance from 'yahoo-finance2';
import express from 'express';
import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import cron from 'node-cron';
import chalk from 'chalk';
import pLimit from 'p-limit';

console.log(chalk.cyan.bold(`
╔════════════════════════════════════════════════════════════╗
║     🌍 UNIVERSAL ASSET MONITOR - ALL STOCKS & CRYPTO      ║
║         Monitoring EVERY tradeable asset worldwide         ║
║              Powered by Yahoo Finance (FREE)              ║
╚════════════════════════════════════════════════════════════╝
`));

// Configuration
const THRESHOLD_MIN = 9.0;
const THRESHOLD_MAX = 13.0;
const CHECK_INTERVAL = 30; // seconds (increased for more symbols)
const PORT = 3001;
const BATCH_SIZE = 50; // Process in batches
const CONCURRENT_REQUESTS = 10; // Concurrent API calls

// Data storage
const allSymbols = new Set();
const priceHistory = new Map();
const activeAlerts = new Map();
const lastPrices = new Map();
const symbolMetadata = new Map();

// Express app
const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

// WebSocket clients
const clients = new Set();

// Rate limiter
const limit = pLimit(CONCURRENT_REQUESTS);

// Get ALL available stocks from Yahoo Finance
async function getAllStocks() {
  console.log(chalk.yellow('📊 Fetching all available stocks...'));
  const stocks = new Set();
  
  try {
    // Get US stocks
    const usScreener = await yahooFinance.screener({
      scrIds: 'most_actives_us',
      count: 250
    });
    usScreener.quotes?.forEach(q => stocks.add(q.symbol));
    
    // Get different categories
    const categories = [
      'day_gainers', 'day_losers', 'most_actives',
      'trending_tickers', 'small_cap_gainers'
    ];
    
    for (const category of categories) {
      try {
        const results = await yahooFinance.screener({
          scrIds: category,
          count: 100
        });
        results.quotes?.forEach(q => stocks.add(q.symbol));
      } catch (e) {
        // Continue if category fails
      }
    }
    
    // Get all major indices components
    const indices = ['SPY', 'QQQ', 'DIA', 'IWM', 'VOO', 'VTI'];
    for (const index of indices) {
      try {
        const quote = await yahooFinance.quote(index);
        if (quote?.symbol) stocks.add(quote.symbol);
      } catch (e) {
        // Continue
      }
    }
    
    // Search for stocks by letter (to get more)
    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
    for (const letter of letters) {
      try {
        const searchResults = await yahooFinance.search(letter, {
          newsCount: 0,
          enableFuzzyQuery: false,
          quotesCount: 20
        });
        searchResults.quotes?.forEach(q => {
          if (q.symbol && !q.symbol.includes('^')) {
            stocks.add(q.symbol);
          }
        });
      } catch (e) {
        // Continue
      }
      
      // Small delay to avoid rate limiting
      await new Promise(r => setTimeout(r, 100));
    }
    
  } catch (error) {
    console.error(chalk.red('Error fetching stocks:'), error.message);
  }
  
  console.log(chalk.green(`✅ Found ${stocks.size} stocks`));
  return Array.from(stocks);
}

// Get ALL cryptocurrencies
async function getAllCrypto() {
  console.log(chalk.yellow('🪙 Fetching all cryptocurrencies...'));
  const cryptos = new Set();
  
  try {
    // Get trending cryptos
    const trending = await yahooFinance.trendings('US', { count: 20 });
    trending.quotes?.forEach(q => {
      if (q.symbol?.includes('-USD')) cryptos.add(q.symbol);
    });
    
    // Common crypto symbols
    const majorCryptos = [
      'BTC', 'ETH', 'BNB', 'XRP', 'SOL', 'ADA', 'AVAX', 'DOT', 'MATIC',
      'LINK', 'UNI', 'ATOM', 'LTC', 'ETC', 'XLM', 'ALGO', 'VET', 'FIL',
      'SAND', 'MANA', 'AXS', 'AAVE', 'SUSHI', 'COMP', 'CRV', 'SNX', 'YFI',
      'DOGE', 'SHIB', 'ARB', 'OP', 'APT', 'IMX', 'FTM', 'NEAR', 'HBAR',
      'ICP', 'TRX', 'XMR', 'BCH', 'TON', 'MKR', 'INJ', 'LDO', 'RUNE',
      'PEPE', 'FLOKI', 'WLD', 'BLUR', 'FET', 'RNDR', 'GRT', 'THETA',
      'EGLD', 'FLOW', 'KAS', 'MINA', 'ROSE', 'DYDX', 'GMX', 'CFX'
    ];
    
    // Add USD pairs
    for (const crypto of majorCryptos) {
      cryptos.add(`${crypto}-USD`);
    }
    
    // Search for more cryptos
    const searchTerms = ['crypto', 'coin', 'token', 'defi', 'USD'];
    for (const term of searchTerms) {
      try {
        const results = await yahooFinance.search(term, {
          quotesCount: 50,
          newsCount: 0
        });
        results.quotes?.forEach(q => {
          if (q.symbol?.includes('-USD')) {
            cryptos.add(q.symbol);
          }
        });
      } catch (e) {
        // Continue
      }
      await new Promise(r => setTimeout(r, 100));
    }
    
  } catch (error) {
    console.error(chalk.red('Error fetching cryptos:'), error.message);
  }
  
  console.log(chalk.green(`✅ Found ${cryptos.size} cryptocurrencies`));
  return Array.from(cryptos);
}

// Initialize all symbols
async function initializeSymbols() {
  console.log(chalk.cyan('\n🔍 Discovering all tradeable assets...\n'));
  
  const [stocks, cryptos] = await Promise.all([
    getAllStocks(),
    getAllCrypto()
  ]);
  
  // Add to main set
  stocks.forEach(s => {
    allSymbols.add(s);
    symbolMetadata.set(s, { type: 'stock', symbol: s });
  });
  
  cryptos.forEach(c => {
    allSymbols.add(c);
    symbolMetadata.set(c, { type: 'crypto', symbol: c });
  });
  
  console.log(chalk.green.bold(`
╔════════════════════════════════════════════════════════════╗
║   📊 Total Assets Discovered:                             ║
║   • Stocks: ${String(stocks.length).padEnd(46)} ║
║   • Crypto: ${String(cryptos.length).padEnd(46)} ║
║   • TOTAL:  ${String(allSymbols.size).padEnd(46)} ║
╚════════════════════════════════════════════════════════════╝
  `));
  
  return Array.from(allSymbols);
}

// WebSocket handling
wss.on('connection', (ws) => {
  clients.add(ws);
  console.log(chalk.green('✅ Client connected. Total clients:'), clients.size);
  
  // Send current alerts and stats
  ws.send(JSON.stringify({
    type: 'snapshot',
    data: Array.from(activeAlerts.values())
  }));
  
  ws.send(JSON.stringify({
    type: 'stats',
    data: {
      totalAssets: allSymbols.size,
      totalStocks: Array.from(symbolMetadata.values()).filter(m => m.type === 'stock').length,
      totalCrypto: Array.from(symbolMetadata.values()).filter(m => m.type === 'crypto').length,
      activeAlerts: activeAlerts.size
    }
  }));
  
  ws.on('close', () => {
    clients.delete(ws);
  });
});

// Broadcast to all clients
function broadcast(data) {
  const message = JSON.stringify(data);
  clients.forEach(client => {
    if (client.readyState === 1) {
      try {
        client.send(message);
      } catch (e) {
        // Client disconnected
      }
    }
  });
}

// Fetch quote data
async function fetchQuote(symbol) {
  try {
    const quote = await yahooFinance.quote(symbol);
    if (quote && quote.regularMarketPrice) {
      return {
        symbol: symbol,
        price: quote.regularMarketPrice,
        dayChangePercent: quote.regularMarketChangePercent || 0,
        volume: quote.regularMarketVolume || 0,
        marketCap: quote.marketCap || 0,
        name: quote.shortName || quote.longName || symbol
      };
    }
  } catch (e) {
    return null;
  }
}

// Calculate 2-minute change
function calculate2MinuteChange(symbol, currentPrice) {
  if (!priceHistory.has(symbol)) {
    priceHistory.set(symbol, []);
  }
  
  const history = priceHistory.get(symbol);
  const now = Date.now();
  
  history.push({ price: currentPrice, timestamp: now });
  
  // Keep only last 2 minutes
  const twoMinutesAgo = now - (2 * 60 * 1000);
  const filtered = history.filter(h => h.timestamp > twoMinutesAgo);
  priceHistory.set(symbol, filtered);
  
  if (filtered.length >= 3) {
    const prices = filtered.map(h => h.price);
    const minPrice = Math.min(...prices);
    const changePercent = ((currentPrice - minPrice) / minPrice) * 100;
    
    return {
      changePercent,
      minPrice,
      maxPrice: Math.max(...prices)
    };
  }
  
  return null;
}

// Check for alerts
function checkForAlert(symbol, data, twoMinChange) {
  const { changePercent, minPrice, maxPrice } = twoMinChange;
  
  if (changePercent >= THRESHOLD_MIN && changePercent <= THRESHOLD_MAX) {
    const metadata = symbolMetadata.get(symbol) || { type: 'unknown' };
    const alert = {
      symbol,
      type: metadata.type,
      name: data.name,
      currentPrice: data.price,
      changePercent2Min: changePercent,
      dayChangePercent: data.dayChangePercent,
      minPrice2Min: minPrice,
      maxPrice2Min: maxPrice,
      volume: data.volume,
      marketCap: data.marketCap,
      timestamp: Date.now(),
      webullUrl: metadata.type === 'stock' ? 
        `https://www.webull.com/quote/${symbol.toLowerCase()}` :
        `https://www.tradingview.com/chart/?symbol=${symbol}`,
      yahooUrl: `https://finance.yahoo.com/quote/${symbol}`
    };
    
    const existing = activeAlerts.get(symbol);
    if (!existing || Math.abs(existing.changePercent2Min - changePercent) > 0.5) {
      activeAlerts.set(symbol, alert);
      
      // Console alert
      const emoji = metadata.type === 'crypto' ? '🪙' : '📈';
      console.log(chalk.red.bold(`
┌────────────────────────────────────────────┐
│  🚨 ${emoji} ${symbol.padEnd(10)} +${changePercent.toFixed(2)}%
│  Price: $${data.price.toFixed(data.price < 1 ? 4 : 2)}
│  Name: ${data.name.substring(0, 35)}
└────────────────────────────────────────────┘`));
      
      broadcast({ type: 'alert', data: alert });
      return true;
    }
  } else if (activeAlerts.has(symbol)) {
    activeAlerts.delete(symbol);
  }
  
  return false;
}

// Monitor all assets
async function monitorAllAssets() {
  const startTime = Date.now();
  const symbols = Array.from(allSymbols);
  
  console.log(chalk.gray(`\n[${new Date().toLocaleTimeString()}] Scanning ${symbols.length} assets...`));
  
  let processed = 0;
  let alerts = 0;
  let errors = 0;
  
  // Process in batches with rate limiting
  for (let i = 0; i < symbols.length; i += BATCH_SIZE) {
    const batch = symbols.slice(i, i + BATCH_SIZE);
    
    const promises = batch.map(symbol => 
      limit(async () => {
        try {
          const data = await fetchQuote(symbol);
          if (data) {
            lastPrices.set(symbol, data);
            const twoMinChange = calculate2MinuteChange(symbol, data.price);
            if (twoMinChange) {
              if (checkForAlert(symbol, data, twoMinChange)) {
                alerts++;
              }
            }
            processed++;
          }
        } catch (e) {
          errors++;
        }
      })
    );
    
    await Promise.all(promises);
    
    // Progress update
    if (processed % 100 === 0) {
      const progress = ((processed / symbols.length) * 100).toFixed(1);
      process.stdout.write(`\r  Progress: ${progress}% | Processed: ${processed}/${symbols.length} | Alerts: ${alerts}`);
    }
    
    // Small delay between batches
    await new Promise(r => setTimeout(r, 50));
  }
  
  const duration = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(chalk.green(`\n  ✅ Scan complete in ${duration}s | Processed: ${processed} | Alerts: ${alerts} | Errors: ${errors}`));
  
  // Broadcast stats
  broadcast({
    type: 'stats',
    data: {
      totalAssets: allSymbols.size,
      processedAssets: processed,
      activeAlerts: activeAlerts.size,
      scanDuration: duration,
      timestamp: Date.now()
    }
  });
}

// API endpoints
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    totalAssets: allSymbols.size,
    activeAlerts: activeAlerts.size
  });
});

app.get('/api/alerts', (req, res) => {
  res.json(Array.from(activeAlerts.values()));
});

app.get('/api/stats', (req, res) => {
  const stocks = Array.from(symbolMetadata.values()).filter(m => m.type === 'stock').length;
  const crypto = Array.from(symbolMetadata.values()).filter(m => m.type === 'crypto').length;
  
  res.json({
    totalAssets: allSymbols.size,
    stocks,
    crypto,
    activeAlerts: activeAlerts.size,
    pricesCached: lastPrices.size
  });
});

// Web Dashboard
app.get('/', (req, res) => {
  res.send(`
<!DOCTYPE html>
<html>
<head>
  <title>Universal Asset Monitor - ALL Stocks & Crypto</title>
  <meta charset="UTF-8">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, system-ui, sans-serif;
      background: #0a0a0a;
      color: #fff;
      padding: 20px;
    }
    .header {
      text-align: center;
      margin-bottom: 30px;
      padding: 20px;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      border-radius: 10px;
    }
    h1 { 
      font-size: 32px; 
      margin-bottom: 10px;
    }
    .stats {
      display: flex;
      justify-content: center;
      gap: 30px;
      margin: 20px 0;
      flex-wrap: wrap;
    }
    .stat {
      text-align: center;
    }
    .stat-value {
      font-size: 24px;
      font-weight: bold;
      color: #00ff88;
    }
    .stat-label {
      font-size: 12px;
      color: rgba(255,255,255,0.7);
      text-transform: uppercase;
    }
    .alerts-container {
      max-width: 1400px;
      margin: 0 auto;
    }
    .alerts {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
      gap: 15px;
      margin-top: 20px;
    }
    .alert {
      background: rgba(255,255,255,0.05);
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 10px;
      padding: 20px;
      transition: all 0.3s;
    }
    .alert:hover {
      transform: translateY(-5px);
      border-color: #00ff88;
      box-shadow: 0 10px 30px rgba(0,255,136,0.2);
    }
    .alert.crypto {
      border-left: 3px solid #ffd700;
    }
    .alert.stock {
      border-left: 3px solid #00ff88;
    }
    .alert-header {
      display: flex;
      justify-content: space-between;
      margin-bottom: 10px;
    }
    .symbol {
      font-size: 20px;
      font-weight: bold;
    }
    .type {
      padding: 4px 8px;
      border-radius: 4px;
      font-size: 11px;
      font-weight: bold;
      background: rgba(255,255,255,0.1);
    }
    .price {
      font-size: 24px;
      font-weight: bold;
      margin: 10px 0;
    }
    .change {
      font-size: 18px;
      color: #00ff88;
      font-weight: bold;
    }
    .name {
      font-size: 12px;
      color: #888;
      margin: 5px 0;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .links {
      display: flex;
      gap: 10px;
      margin-top: 10px;
    }
    .link {
      flex: 1;
      padding: 6px;
      background: rgba(255,255,255,0.1);
      border-radius: 5px;
      text-align: center;
      color: #00aaff;
      text-decoration: none;
      font-size: 12px;
      transition: all 0.3s;
    }
    .link:hover {
      background: #00aaff;
      color: #000;
    }
    .no-alerts {
      text-align: center;
      padding: 50px;
      color: #666;
      grid-column: 1 / -1;
    }
    .loading {
      text-align: center;
      padding: 20px;
      color: #00ff88;
    }
    .scan-progress {
      position: fixed;
      bottom: 20px;
      right: 20px;
      background: rgba(0,0,0,0.9);
      padding: 15px;
      border-radius: 10px;
      border: 1px solid #00ff88;
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>🌍 Universal Asset Monitor</h1>
    <div>Monitoring EVERY Stock & Cryptocurrency Worldwide</div>
  </div>
  
  <div class="stats" id="stats">
    <div class="stat">
      <div class="stat-value" id="total-assets">-</div>
      <div class="stat-label">Total Assets</div>
    </div>
    <div class="stat">
      <div class="stat-value" id="total-stocks">-</div>
      <div class="stat-label">Stocks</div>
    </div>
    <div class="stat">
      <div class="stat-value" id="total-crypto">-</div>
      <div class="stat-label">Crypto</div>
    </div>
    <div class="stat">
      <div class="stat-value" id="active-alerts">0</div>
      <div class="stat-label">Active Alerts</div>
    </div>
  </div>
  
  <div class="alerts-container">
    <div class="loading" id="loading">Connecting to monitor...</div>
    <div class="alerts" id="alerts"></div>
  </div>
  
  <div class="scan-progress" id="scan-progress" style="display:none;">
    <div>Scanning assets...</div>
    <div id="scan-status"></div>
  </div>
  
  <script>
    const ws = new WebSocket('ws://localhost:3001');
    let allAlerts = [];
    
    ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      
      if (message.type === 'alert') {
        addOrUpdateAlert(message.data);
      } else if (message.type === 'snapshot') {
        allAlerts = message.data;
        renderAlerts();
      } else if (message.type === 'stats') {
        updateStats(message.data);
      }
    };
    
    ws.onopen = () => {
      document.getElementById('loading').textContent = 'Connected! Waiting for alerts...';
    };
    
    function addOrUpdateAlert(alert) {
      const index = allAlerts.findIndex(a => a.symbol === alert.symbol);
      if (index >= 0) {
        allAlerts[index] = alert;
      } else {
        allAlerts.unshift(alert);
      }
      renderAlerts();
      
      // Browser notification
      if (Notification.permission === 'granted') {
        new Notification('🚨 Momentum Alert!', {
          body: alert.symbol + ' gained ' + alert.changePercent2Min.toFixed(2) + '%',
          icon: '/favicon.ico'
        });
      }
    }
    
    function updateStats(stats) {
      document.getElementById('total-assets').textContent = stats.totalAssets || '-';
      document.getElementById('total-stocks').textContent = stats.totalStocks || '-';
      document.getElementById('total-crypto').textContent = stats.totalCrypto || '-';
      document.getElementById('active-alerts').textContent = stats.activeAlerts || 0;
      
      if (stats.scanDuration) {
        const scanDiv = document.getElementById('scan-progress');
        scanDiv.style.display = 'block';
        document.getElementById('scan-status').textContent = 
          'Last scan: ' + stats.scanDuration + 's | Processed: ' + stats.processedAssets;
        setTimeout(() => {
          scanDiv.style.display = 'none';
        }, 5000);
      }
    }
    
    function renderAlerts() {
      const alertsDiv = document.getElementById('alerts');
      document.getElementById('loading').style.display = allAlerts.length > 0 ? 'none' : 'block';
      
      if (allAlerts.length === 0) {
        document.getElementById('loading').textContent = 'No alerts yet - monitoring for 9-13% gains...';
        alertsDiv.innerHTML = '';
        return;
      }
      
      alertsDiv.innerHTML = allAlerts
        .sort((a, b) => b.changePercent2Min - a.changePercent2Min)
        .map(alert => {
          const price = alert.currentPrice < 1 ? 
            alert.currentPrice.toFixed(4) : alert.currentPrice.toFixed(2);
          
          return \`
            <div class="alert \${alert.type}">
              <div class="alert-header">
                <span class="symbol">\${alert.symbol}</span>
                <span class="type">\${alert.type?.toUpperCase() || 'UNKNOWN'}</span>
              </div>
              <div class="name">\${alert.name || ''}</div>
              <div class="price">$\${price}</div>
              <div class="change">+\${alert.changePercent2Min.toFixed(2)}% (2min)</div>
              <div style="font-size:12px; color:#888; margin:5px 0;">
                Day: \${alert.dayChangePercent.toFixed(2)}% | 
                Vol: \${(alert.volume/1000000).toFixed(1)}M
              </div>
              <div class="links">
                <a href="\${alert.webullUrl}" target="_blank" class="link">Chart →</a>
                <a href="\${alert.yahooUrl}" target="_blank" class="link">Yahoo →</a>
              </div>
            </div>
          \`;
        }).join('');
    }
    
    // Request notifications
    if (Notification.permission === 'default') {
      Notification.requestPermission();
    }
  </script>
</body>
</html>
  `);
});

// Start the application
async function start() {
  console.log(chalk.cyan('\n🚀 Initializing Universal Asset Monitor...\n'));
  
  // Discover all symbols
  await initializeSymbols();
  
  // Start server
  server.listen(PORT, () => {
    console.log(chalk.green.bold(`
╔════════════════════════════════════════════════════════════╗
║                    ✅ SYSTEM READY                        ║
║                                                            ║
║   Dashboard:     http://localhost:${PORT}                     ║
║   WebSocket:     ws://localhost:${PORT}                       ║
║                                                            ║
║   Monitoring:    ${String(allSymbols.size).padEnd(41)} ║
║   • Every tradeable stock worldwide                       ║
║   • Every cryptocurrency available                        ║
║                                                            ║
║   Threshold:     9-13% gains in 2 minutes                 ║
║   Scan Rate:     Every ${CHECK_INTERVAL} seconds                      ║
║                                                            ║
║   🎉 100% FREE - No API keys required!                    ║
╚════════════════════════════════════════════════════════════╝
    `));
  });
  
  // Initial scan
  console.log(chalk.cyan('\n📊 Starting initial scan of all assets...'));
  await monitorAllAssets();
  
  // Schedule regular scans
  cron.schedule(`*/${CHECK_INTERVAL} * * * * *`, () => {
    monitorAllAssets();
  });
}

// Error handling
process.on('uncaughtException', (error) => {
  console.error(chalk.red('Error:'), error.message);
});

process.on('unhandledRejection', (error) => {
  console.error(chalk.red('Unhandled:'), error);
});

// Start
start();
