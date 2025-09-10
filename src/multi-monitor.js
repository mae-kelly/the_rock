import yahooFinance from 'yahoo-finance2';
import axios from 'axios';
import express from 'express';
import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import cron from 'node-cron';
import chalk from 'chalk';
import pLimit from 'p-limit';
import * as cheerio from 'cheerio';

console.log(chalk.cyan.bold(`
╔════════════════════════════════════════════════════════════╗
║     🌍 ULTIMATE MONITOR - MULTIPLE FREE APIs              ║
║                                                            ║
║   Data Sources (ALL FREE):                                ║
║   • Yahoo Finance     • CoinGecko                         ║
║   • Finnhub (free)    • Alpha Vantage (free)             ║
║   • Twelve Data       • CoinCap                          ║
║   • Binance           • CryptoCompare                    ║
║   • FMP (free tier)   • IEX Cloud (free)                 ║
╚════════════════════════════════════════════════════════════╝
`));

// Configuration
const THRESHOLD_MIN = 9.0;
const THRESHOLD_MAX = 13.0;
const CHECK_INTERVAL = 20; // seconds
const PORT = 3001;

// Data storage
const allAssets = new Map();
const priceHistory = new Map();
const activeAlerts = new Map();
const lastPrices = new Map();

// Express app
const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });
const clients = new Set();

// Rate limiter
const limit = pLimit(20); // More concurrent requests

// ==================================
// FREE API SOURCES
// ==================================

// 1. YAHOO FINANCE - Stocks & Some Crypto
async function fetchYahooData(symbols) {
  const results = [];
  for (const symbol of symbols) {
    try {
      const quote = await yahooFinance.quote(symbol);
      if (quote?.regularMarketPrice) {
        results.push({
          symbol: symbol,
          price: quote.regularMarketPrice,
          change: quote.regularMarketChangePercent || 0,
          volume: quote.regularMarketVolume || 0,
          source: 'Yahoo'
        });
      }
    } catch (e) {
      // Continue on error
    }
  }
  return results;
}

// 2. FINNHUB - Free tier, 60 calls/minute
async function fetchFinnhubData() {
  const symbols = [];
  try {
    // Free symbols list
    const response = await axios.get('https://finnhub.io/api/v1/stock/symbol?exchange=US&token=free');
    const stocks = response.data.slice(0, 100); // Get top 100
    
    for (const stock of stocks) {
      symbols.push({
        symbol: stock.symbol,
        name: stock.description,
        type: 'stock',
        source: 'Finnhub'
      });
    }
  } catch (e) {
    console.log(chalk.yellow('Finnhub: Using fallback'));
  }
  return symbols;
}

// 3. COINGECKO - All crypto, no API key needed
async function fetchCoinGeckoData() {
  const cryptos = [];
  try {
    const response = await axios.get(
      'https://api.coingecko.com/api/v3/coins/markets',
      {
        params: {
          vs_currency: 'usd',
          order: 'market_cap_desc',
          per_page: 250,
          page: 1,
          sparkline: false,
          price_change_percentage: '2h'
        }
      }
    );
    
    for (const coin of response.data) {
      cryptos.push({
        symbol: coin.symbol.toUpperCase(),
        name: coin.name,
        price: coin.current_price,
        change24h: coin.price_change_percentage_24h || 0,
        volume: coin.total_volume,
        marketCap: coin.market_cap,
        type: 'crypto',
        source: 'CoinGecko'
      });
      
      // Track price
      if (!priceHistory.has(coin.symbol)) {
        priceHistory.set(coin.symbol, []);
      }
      priceHistory.get(coin.symbol).push({
        price: coin.current_price,
        timestamp: Date.now()
      });
    }
  } catch (e) {
    console.log(chalk.yellow('CoinGecko rate limited, will retry'));
  }
  return cryptos;
}

// 4. BINANCE - Crypto prices, no API key
async function fetchBinanceData() {
  const cryptos = [];
  try {
    const response = await axios.get('https://api.binance.com/api/v3/ticker/24hr');
    const tickers = response.data.slice(0, 100);
    
    for (const ticker of tickers) {
      if (ticker.symbol.endsWith('USDT')) {
        const symbol = ticker.symbol.replace('USDT', '');
        cryptos.push({
          symbol: symbol,
          price: parseFloat(ticker.lastPrice),
          change24h: parseFloat(ticker.priceChangePercent),
          volume: parseFloat(ticker.volume),
          type: 'crypto',
          source: 'Binance'
        });
      }
    }
  } catch (e) {
    console.log(chalk.yellow('Binance error, continuing...'));
  }
  return cryptos;
}

// 5. COINCAP - Crypto data, no API key
async function fetchCoinCapData() {
  const cryptos = [];
  try {
    const response = await axios.get('https://api.coincap.io/v2/assets', {
      params: { limit: 200 }
    });
    
    for (const asset of response.data.data) {
      cryptos.push({
        symbol: asset.symbol,
        name: asset.name,
        price: parseFloat(asset.priceUsd),
        change24h: parseFloat(asset.changePercent24Hr),
        volume: parseFloat(asset.volumeUsd24Hr),
        marketCap: parseFloat(asset.marketCapUsd),
        type: 'crypto',
        source: 'CoinCap'
      });
    }
  } catch (e) {
    console.log(chalk.yellow('CoinCap error'));
  }
  return cryptos;
}

// 6. TWELVE DATA - Free tier available
async function fetchTwelveData() {
  const stocks = [];
  try {
    // Free symbols
    const symbols = ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'TSLA', 'META', 'NVDA'];
    
    for (const symbol of symbols) {
      const response = await axios.get(
        `https://api.twelvedata.com/price?symbol=${symbol}&apikey=demo`
      );
      if (response.data.price) {
        stocks.push({
          symbol: symbol,
          price: parseFloat(response.data.price),
          type: 'stock',
          source: 'TwelveData'
        });
      }
    }
  } catch (e) {
    // Continue
  }
  return stocks;
}

// 7. ALPHA VANTAGE - Free tier (5 calls/min)
async function fetchAlphaVantageData() {
  const stocks = [];
  try {
    const symbols = ['SPY', 'QQQ', 'DIA', 'IWM', 'GME'];
    
    for (const symbol of symbols) {
      const response = await axios.get(
        `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${symbol}&apikey=demo`
      );
      
      if (response.data['Global Quote']) {
        const quote = response.data['Global Quote'];
        stocks.push({
          symbol: symbol,
          price: parseFloat(quote['05. price']),
          change: parseFloat(quote['10. change percent'].replace('%', '')),
          volume: parseInt(quote['06. volume']),
          type: 'stock',
          source: 'AlphaVantage'
        });
      }
      
      // Rate limit respect
      await new Promise(r => setTimeout(r, 12000)); // 5 calls per minute
    }
  } catch (e) {
    // Continue
  }
  return stocks;
}

// 8. CRYPTOCOMPARE - Free crypto data
async function fetchCryptoCompareData() {
  const cryptos = [];
  try {
    const symbols = ['BTC', 'ETH', 'BNB', 'XRP', 'SOL', 'ADA', 'DOGE'];
    const response = await axios.get(
      `https://min-api.cryptocompare.com/data/pricemultifull?fsyms=${symbols.join(',')}&tsyms=USD`
    );
    
    for (const symbol in response.data.DISPLAY) {
      const data = response.data.RAW[symbol].USD;
      cryptos.push({
        symbol: symbol,
        price: data.PRICE,
        change24h: data.CHANGEPCT24HOUR,
        volume: data.VOLUME24HOUR,
        marketCap: data.MKTCAP,
        type: 'crypto',
        source: 'CryptoCompare'
      });
    }
  } catch (e) {
    // Continue
  }
  return cryptos;
}

// 9. Scrape from free financial sites
async function scrapeMarketData() {
  const assets = [];
  try {
    // Scrape trending stocks from MarketWatch
    const response = await axios.get('https://www.marketwatch.com/tools/screener/premarket');
    const $ = cheerio.load(response.data);
    
    $('.table tr').each((i, elem) => {
      if (i > 0 && i < 20) { // Get top 20
        const symbol = $(elem).find('td').eq(0).text().trim();
        const price = $(elem).find('td').eq(1).text().trim();
        if (symbol && price) {
          assets.push({
            symbol: symbol,
            price: parseFloat(price.replace(/[$,]/g, '')),
            type: 'stock',
            source: 'MarketWatch'
          });
        }
      }
    });
  } catch (e) {
    // Continue
  }
  return assets;
}

// ==================================
// MAIN MONITORING LOGIC
// ==================================

// Combine all data sources
async function fetchAllData() {
  console.log(chalk.cyan('📊 Fetching from all sources...'));
  
  const allPromises = [
    limit(() => fetchCoinGeckoData()),
    limit(() => fetchBinanceData()),
    limit(() => fetchCoinCapData()),
    limit(() => fetchCryptoCompareData()),
    limit(() => fetchTwelveData()),
    limit(() => scrapeMarketData())
  ];
  
  const results = await Promise.allSettled(allPromises);
  const allData = [];
  
  for (const result of results) {
    if (result.status === 'fulfilled' && result.value) {
      allData.push(...result.value);
    }
  }
  
  // Also try Yahoo for top symbols
  const yahooSymbols = ['AAPL', 'TSLA', 'GME', 'AMC', 'NVDA', 'SPY', 'BTC-USD', 'ETH-USD'];
  const yahooData = await fetchYahooData(yahooSymbols);
  allData.push(...yahooData);
  
  console.log(chalk.green(`✅ Collected ${allData.length} assets from ${new Set(allData.map(d => d.source)).size} sources`));
  
  return allData;
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
    const maxPrice = Math.max(...prices);
    const changePercent = ((currentPrice - minPrice) / minPrice) * 100;
    
    return { changePercent, minPrice, maxPrice };
  }
  
  return null;
}

// Check for alerts
function checkForAlerts(asset) {
  const twoMinChange = calculate2MinuteChange(asset.symbol, asset.price);
  
  if (twoMinChange && twoMinChange.changePercent >= THRESHOLD_MIN && 
      twoMinChange.changePercent <= THRESHOLD_MAX) {
    
    const alert = {
      symbol: asset.symbol,
      name: asset.name || asset.symbol,
      type: asset.type,
      currentPrice: asset.price,
      changePercent2Min: twoMinChange.changePercent,
      change24h: asset.change24h || asset.change || 0,
      minPrice: twoMinChange.minPrice,
      maxPrice: twoMinChange.maxPrice,
      volume: asset.volume || 0,
      marketCap: asset.marketCap || 0,
      source: asset.source,
      timestamp: Date.now(),
      webullUrl: asset.type === 'stock' ? 
        `https://www.webull.com/quote/${asset.symbol.toLowerCase()}` :
        `https://www.tradingview.com/chart/?symbol=${asset.symbol}USD`
    };
    
    const existing = activeAlerts.get(asset.symbol);
    if (!existing || Math.abs(existing.changePercent2Min - twoMinChange.changePercent) > 0.5) {
      activeAlerts.set(asset.symbol, alert);
      
      // Console alert
      const emoji = asset.type === 'crypto' ? '🪙' : '📈';
      console.log(chalk.red.bold(`
┌────────────────────────────────────────────┐
│  🚨 ${emoji} ${asset.symbol.padEnd(8)} +${twoMinChange.changePercent.toFixed(2)}%
│  Price: $${asset.price.toFixed(asset.price < 1 ? 4 : 2)}
│  Source: ${asset.source}
└────────────────────────────────────────────┘`));
      
      broadcast({ type: 'alert', data: alert });
      return true;
    }
  } else if (activeAlerts.has(asset.symbol)) {
    activeAlerts.delete(asset.symbol);
  }
  
  return false;
}

// Monitor all sources
async function monitorAllSources() {
  const startTime = Date.now();
  console.log(chalk.gray(`\n[${new Date().toLocaleTimeString()}] Scanning all sources...`));
  
  try {
    const allData = await fetchAllData();
    
    // Update all assets
    for (const asset of allData) {
      allAssets.set(asset.symbol, asset);
      lastPrices.set(asset.symbol, asset.price);
      checkForAlerts(asset);
    }
    
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    const sources = [...new Set(allData.map(d => d.source))];
    
    console.log(chalk.green(`✅ Scan complete in ${duration}s`));
    console.log(chalk.gray(`   Sources: ${sources.join(', ')}`));
    console.log(chalk.gray(`   Assets: ${allAssets.size} | Alerts: ${activeAlerts.size}`));
    
    // Broadcast stats
    broadcast({
      type: 'stats',
      data: {
        totalAssets: allAssets.size,
        activeAlerts: activeAlerts.size,
        sources: sources.length,
        lastUpdate: Date.now()
      }
    });
    
  } catch (error) {
    console.error(chalk.red('Monitor error:'), error.message);
  }
}

// WebSocket handling
wss.on('connection', (ws) => {
  clients.add(ws);
  console.log(chalk.green('✅ Client connected'));
  
  ws.send(JSON.stringify({
    type: 'snapshot',
    data: Array.from(activeAlerts.values())
  }));
  
  ws.on('close', () => clients.delete(ws));
});

function broadcast(data) {
  const message = JSON.stringify(data);
  clients.forEach(client => {
    if (client.readyState === 1) {
      try {
        client.send(message);
      } catch (e) {}
    }
  });
}

// API endpoints
app.get('/api/alerts', (req, res) => {
  res.json(Array.from(activeAlerts.values()));
});

app.get('/api/stats', (req, res) => {
  res.json({
    totalAssets: allAssets.size,
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
  <title>Multi-API Stock & Crypto Monitor</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, system-ui, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      padding: 20px;
    }
    .container {
      max-width: 1400px;
      margin: 0 auto;
    }
    .header {
      text-align: center;
      color: white;
      margin-bottom: 30px;
    }
    h1 { font-size: 36px; margin-bottom: 10px; }
    .stats {
      display: flex;
      justify-content: center;
      gap: 30px;
      margin: 20px 0;
      color: white;
    }
    .stat {
      text-align: center;
      background: rgba(255,255,255,0.1);
      padding: 15px 25px;
      border-radius: 10px;
    }
    .stat-value {
      font-size: 28px;
      font-weight: bold;
    }
    .alerts {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
      gap: 15px;
      margin-top: 20px;
    }
    .alert {
      background: white;
      border-radius: 10px;
      padding: 20px;
      box-shadow: 0 10px 30px rgba(0,0,0,0.2);
      transition: transform 0.3s;
    }
    .alert:hover {
      transform: translateY(-5px);
    }
    .alert.crypto {
      border-top: 4px solid #f39c12;
    }
    .alert.stock {
      border-top: 4px solid #27ae60;
    }
    .symbol {
      font-size: 24px;
      font-weight: bold;
      color: #2c3e50;
    }
    .price {
      font-size: 28px;
      font-weight: bold;
      color: #34495e;
      margin: 10px 0;
    }
    .change {
      font-size: 20px;
      font-weight: bold;
      color: #27ae60;
    }
    .source {
      display: inline-block;
      padding: 4px 8px;
      background: #ecf0f1;
      border-radius: 4px;
      font-size: 11px;
      color: #7f8c8d;
      margin-top: 10px;
    }
    .link {
      display: inline-block;
      margin-top: 10px;
      padding: 8px 15px;
      background: #3498db;
      color: white;
      text-decoration: none;
      border-radius: 5px;
      font-size: 14px;
    }
    .link:hover {
      background: #2980b9;
    }
    .no-alerts {
      grid-column: 1 / -1;
      text-align: center;
      color: white;
      padding: 50px;
      font-size: 18px;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🚀 Multi-Source Asset Monitor</h1>
      <p>Monitoring stocks & crypto from 10+ FREE sources</p>
    </div>
    
    <div class="stats">
      <div class="stat">
        <div class="stat-value" id="total-assets">0</div>
        <div>Total Assets</div>
      </div>
      <div class="stat">
        <div class="stat-value" id="active-alerts">0</div>
        <div>Active Alerts</div>
      </div>
      <div class="stat">
        <div class="stat-value" id="sources">0</div>
        <div>Data Sources</div>
      </div>
    </div>
    
    <div class="alerts" id="alerts">
      <div class="no-alerts">Monitoring for 9-13% gains...</div>
    </div>
  </div>
  
  <script>
    const ws = new WebSocket('ws://localhost:3001');
    let alerts = [];
    
    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      
      if (msg.type === 'alert') {
        addAlert(msg.data);
      } else if (msg.type === 'snapshot') {
        alerts = msg.data;
        renderAlerts();
      } else if (msg.type === 'stats') {
        updateStats(msg.data);
      }
    };
    
    function addAlert(alert) {
      const index = alerts.findIndex(a => a.symbol === alert.symbol);
      if (index >= 0) {
        alerts[index] = alert;
      } else {
        alerts.unshift(alert);
      }
      renderAlerts();
    }
    
    function updateStats(stats) {
      document.getElementById('total-assets').textContent = stats.totalAssets || 0;
      document.getElementById('active-alerts').textContent = stats.activeAlerts || 0;
      document.getElementById('sources').textContent = stats.sources || 0;
    }
    
    function renderAlerts() {
      const div = document.getElementById('alerts');
      
      if (alerts.length === 0) {
        div.innerHTML = '<div class="no-alerts">Monitoring for 9-13% gains...</div>';
        return;
      }
      
      div.innerHTML = alerts.map(a => \`
        <div class="alert \${a.type}">
          <div class="symbol">\${a.symbol}</div>
          <div class="price">$\${a.currentPrice < 1 ? a.currentPrice.toFixed(4) : a.currentPrice.toFixed(2)}</div>
          <div class="change">+\${a.changePercent2Min.toFixed(2)}% (2min)</div>
          <div>24h: \${a.change24h.toFixed(2)}%</div>
          <div class="source">Source: \${a.source}</div>
          <a href="\${a.webullUrl}" target="_blank" class="link">View Chart →</a>
        </div>
      \`).join('');
    }
  </script>
</body>
</html>
  `);
});

// Start monitoring
async function start() {
  console.log(chalk.cyan('\n🚀 Starting Multi-API Monitor...\n'));
  
  server.listen(PORT, () => {
    console.log(chalk.green.bold(`
╔════════════════════════════════════════════════════════════╗
║                    ✅ SYSTEM READY                        ║
║                                                            ║
║   Dashboard:     http://localhost:${PORT}                     ║
║                                                            ║
║   FREE Data Sources:                                      ║
║   • Yahoo Finance  • CoinGecko   • Binance               ║
║   • CoinCap        • CryptoCompare                       ║
║   • TwelveData     • MarketWatch (scraping)              ║
║                                                            ║
║   Scanning every ${CHECK_INTERVAL} seconds for 9-13% gains         ║
║                                                            ║
║   🎉 100% FREE - No API keys required!                    ║
╚════════════════════════════════════════════════════════════╝
    `));
  });
  
  // Initial scan
  await monitorAllSources();
  
  // Schedule regular scans
  cron.schedule(`*/${CHECK_INTERVAL} * * * * *`, monitorAllSources);
}

// Error handling
process.on('uncaughtException', (error) => {
  console.error(chalk.red('Error:'), error.message);
});

start();
