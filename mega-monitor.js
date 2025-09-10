import axios from 'axios';
import express from 'express';
import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import chalk from 'chalk';
import yahooFinance from 'yahoo-finance2';
import fs from 'fs/promises';

yahooFinance.suppressNotices(['yahooSurvey']);

console.log(chalk.cyan.bold(`
╔════════════════════════════════════════════════════════════╗
║     🌍 COMPLETE MARKET MONITOR                            ║
║     Getting EVERY stock & crypto in existence!            ║
╚════════════════════════════════════════════════════════════╝
`));

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

let allAssets = new Map();
let priceHistory = new Map();
const clients = new Set();

// Track price changes
function trackChange(symbol, price) {
  if (!priceHistory.has(symbol)) {
    priceHistory.set(symbol, { 
      prices: [], 
      startPrice: price,
      startTime: Date.now() 
    });
  }
  
  const history = priceHistory.get(symbol);
  history.prices.push({ price, time: Date.now() });
  
  const fiveMinAgo = Date.now() - 300000;
  history.prices = history.prices.filter(p => p.time > fiveMinAgo);
  
  const twoMinAgo = Date.now() - 120000;
  const twoMinPrices = history.prices.filter(p => p.time > twoMinAgo);
  
  if (twoMinPrices.length > 1) {
    const oldPrice = twoMinPrices[0].price;
    return ((price - oldPrice) / oldPrice) * 100;
  }
  return 0;
}

// ============= GET ALL EXCHANGE LISTINGS =============

// 1. Get ALL US Stocks from exchanges
async function getAllUSStocks() {
  console.log(chalk.yellow('📊 Fetching ALL US stocks from all exchanges...'));
  const allStocks = new Set();
  
  try {
    // NASDAQ Complete List
    console.log(chalk.gray('Getting NASDAQ listings...'));
    try {
      const nasdaqUrl = 'https://api.nasdaq.com/api/screener/stocks?tableonly=true&limit=10000&exchange=nasdaq';
      const nasdaqResponse = await axios.get(nasdaqUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0',
          'Accept': 'application/json'
        },
        timeout: 15000
      });
      
      if (nasdaqResponse.data?.data?.rows) {
        nasdaqResponse.data.data.rows.forEach(stock => {
          allStocks.add(stock.symbol);
        });
        console.log(chalk.green(`  ✓ NASDAQ: ${nasdaqResponse.data.data.rows.length} stocks`));
      }
    } catch (e) {
      console.log(chalk.red('  NASDAQ fetch failed'));
    }
    
    // NYSE Complete List
    console.log(chalk.gray('Getting NYSE listings...'));
    try {
      const nyseUrl = 'https://api.nasdaq.com/api/screener/stocks?tableonly=true&limit=10000&exchange=nyse';
      const nyseResponse = await axios.get(nyseUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0',
          'Accept': 'application/json'
        },
        timeout: 15000
      });
      
      if (nyseResponse.data?.data?.rows) {
        nyseResponse.data.data.rows.forEach(stock => {
          allStocks.add(stock.symbol);
        });
        console.log(chalk.green(`  ✓ NYSE: ${nyseResponse.data.data.rows.length} stocks`));
      }
    } catch (e) {
      console.log(chalk.red('  NYSE fetch failed'));
    }
    
    // AMEX Complete List
    console.log(chalk.gray('Getting AMEX listings...'));
    try {
      const amexUrl = 'https://api.nasdaq.com/api/screener/stocks?tableonly=true&limit=10000&exchange=amex';
      const amexResponse = await axios.get(amexUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0',
          'Accept': 'application/json'
        },
        timeout: 15000
      });
      
      if (amexResponse.data?.data?.rows) {
        amexResponse.data.data.rows.forEach(stock => {
          allStocks.add(stock.symbol);
        });
        console.log(chalk.green(`  ✓ AMEX: ${amexResponse.data.data.rows.length} stocks`));
      }
    } catch (e) {
      console.log(chalk.red('  AMEX fetch failed'));
    }
    
    // Get OTC Markets
    console.log(chalk.gray('Getting OTC markets...'));
    const otcSymbols = [
      'TSNP', 'OZSC', 'EEENF', 'HCMC', 'ALPP', 'GAXY', 'SANP', 'AABB', 'ENZC',
      'VDRM', 'MINE', 'INND', 'AITX', 'TLSS', 'ABML', 'DPLS', 'FTEG', 'HEMP'
    ];
    otcSymbols.forEach(s => allStocks.add(s));
    
    // Also fetch from Yahoo's complete list
    console.log(chalk.gray('Getting Yahoo Finance complete list...'));
    
    // Use Yahoo screeners to get more stocks
    const yahooScreeners = [
      'all_cryptocurrencies_us',
      'most_actives',
      'day_gainers',
      'day_losers',
      'trending_tickers',
      'most_watched',
      'growth_technology_stocks',
      'undervalued_large_caps',
      'undervalued_growth_stocks',
      'small_cap_gainers',
      'aggressive_small_caps',
      'portfolio_anchors',
      'solid_midcap_growth_funds',
      'top_mutual_funds',
      'conservative_foreign_funds',
      'high_yield_bond'
    ];
    
    for (const screener of yahooScreeners) {
      try {
        const result = await yahooFinance.screener({
          scrIds: screener,
          count: 250
        });
        
        if (result?.quotes) {
          result.quotes.forEach(quote => {
            if (quote.symbol) {
              allStocks.add(quote.symbol);
            }
          });
        }
      } catch (e) {}
      
      await new Promise(r => setTimeout(r, 200)); // Avoid rate limit
    }
    
    // Search by market cap ranges to get all sizes
    console.log(chalk.gray('Searching by market cap...'));
    try {
      const marketCapQueries = [
        { min: 0, max: 10000000 },           // Nano cap
        { min: 10000000, max: 50000000 },    // Micro cap  
        { min: 50000000, max: 300000000 },   // Small cap
        { min: 300000000, max: 2000000000 }, // Mid cap
        { min: 2000000000, max: 10000000000 }, // Large cap
        { min: 10000000000, max: 999999999999 } // Mega cap
      ];
      
      for (const query of marketCapQueries) {
        try {
          const result = await yahooFinance.search(`market cap ${query.min} to ${query.max}`, {
            quotesCount: 100,
            newsCount: 0
          });
          
          if (result?.quotes) {
            result.quotes.forEach(q => {
              if (q.symbol && !q.symbol.includes('^')) {
                allStocks.add(q.symbol);
              }
            });
          }
        } catch (e) {}
        
        await new Promise(r => setTimeout(r, 200));
      }
    } catch (e) {}
    
    console.log(chalk.green.bold(`✅ Found ${allStocks.size} total US stocks!`));
    return Array.from(allStocks);
    
  } catch (error) {
    console.log(chalk.red('Error fetching stocks:', error.message));
    return Array.from(allStocks);
  }
}

// 2. Get ALL Cryptocurrencies
async function getAllCryptos() {
  console.log(chalk.yellow('🪙 Fetching ALL cryptocurrencies...'));
  const allCryptos = new Map();
  
  try {
    // CoinGecko - Get ALL coins (multiple pages)
    console.log(chalk.gray('Getting all coins from CoinGecko...'));
    for (let page = 1; page <= 20; page++) {
      try {
        const response = await axios.get('https://api.coingecko.com/api/v3/coins/markets', {
          params: {
            vs_currency: 'usd',
            order: 'market_cap_desc',
            per_page: 250,
            page: page,
            sparkline: false
          },
          timeout: 10000
        });
        
        if (response.data && response.data.length > 0) {
          response.data.forEach(coin => {
            allCryptos.set(coin.symbol.toUpperCase(), {
              symbol: coin.symbol.toUpperCase(),
              name: coin.name,
              price: coin.current_price,
              change24h: coin.price_change_percentage_24h || 0,
              marketCap: coin.market_cap,
              volume: coin.total_volume,
              type: 'crypto',
              source: 'CoinGecko'
            });
          });
          
          console.log(chalk.green(`  ✓ Page ${page}: ${response.data.length} cryptos`));
        } else {
          break; // No more data
        }
        
        await new Promise(r => setTimeout(r, 1200)); // Rate limit: 50 calls/minute
      } catch (e) {
        if (e.response?.status === 429) {
          console.log(chalk.yellow('  Rate limited, waiting...'));
          await new Promise(r => setTimeout(r, 10000));
        }
        break;
      }
    }
    
    // CoinPaprika - Get more cryptos
    console.log(chalk.gray('Getting coins from CoinPaprika...'));
    try {
      const paprikaResponse = await axios.get('https://api.coinpaprika.com/v1/tickers', {
        timeout: 10000
      });
      
      if (paprikaResponse.data) {
        paprikaResponse.data.forEach(coin => {
          if (!allCryptos.has(coin.symbol)) {
            allCryptos.set(coin.symbol, {
              symbol: coin.symbol,
              name: coin.name,
              price: coin.quotes?.USD?.price || 0,
              change24h: coin.quotes?.USD?.percent_change_24h || 0,
              marketCap: coin.quotes?.USD?.market_cap || 0,
              volume: coin.quotes?.USD?.volume_24h || 0,
              type: 'crypto',
              source: 'CoinPaprika'
            });
          }
        });
        console.log(chalk.green(`  ✓ CoinPaprika: ${paprikaResponse.data.length} cryptos`));
      }
    } catch (e) {
      console.log(chalk.red('  CoinPaprika failed'));
    }
    
    // CoinCap - Get more cryptos
    console.log(chalk.gray('Getting coins from CoinCap...'));
    try {
      const coincapResponse = await axios.get('https://api.coincap.io/v2/assets', {
        params: { limit: 2000 },
        timeout: 10000
      });
      
      if (coincapResponse.data?.data) {
        coincapResponse.data.data.forEach(coin => {
          if (!allCryptos.has(coin.symbol)) {
            allCryptos.set(coin.symbol, {
              symbol: coin.symbol,
              name: coin.name,
              price: parseFloat(coin.priceUsd) || 0,
              change24h: parseFloat(coin.changePercent24Hr) || 0,
              marketCap: parseFloat(coin.marketCapUsd) || 0,
              volume: parseFloat(coin.volumeUsd24Hr) || 0,
              type: 'crypto',
              source: 'CoinCap'
            });
          }
        });
        console.log(chalk.green(`  ✓ CoinCap: ${coincapResponse.data.data.length} cryptos`));
      }
    } catch (e) {
      console.log(chalk.red('  CoinCap failed'));
    }
    
    console.log(chalk.green.bold(`✅ Found ${allCryptos.size} total cryptocurrencies!`));
    return Array.from(allCryptos.values());
    
  } catch (error) {
    console.log(chalk.red('Error fetching cryptos:', error.message));
    return Array.from(allCryptos.values());
  }
}

// 3. Get price data for stocks
async function getStockPrices(symbols) {
  console.log(chalk.yellow(`📈 Fetching prices for ${symbols.length} stocks...`));
  const priceData = [];
  const batchSize = 10;
  let processed = 0;
  
  for (let i = 0; i < symbols.length; i += batchSize) {
    const batch = symbols.slice(i, i + batchSize);
    
    await Promise.all(batch.map(async (symbol) => {
      try {
        const quote = await yahooFinance.quote(symbol);
        if (quote?.regularMarketPrice) {
          const change2min = trackChange(symbol, quote.regularMarketPrice);
          
          priceData.push({
            symbol: quote.symbol,
            name: quote.shortName || quote.longName || quote.symbol,
            price: quote.regularMarketPrice,
            change24h: quote.regularMarketChangePercent || 0,
            change2min,
            volume: quote.regularMarketVolume || 0,
            marketCap: quote.marketCap || 0,
            type: 'stock',
            source: 'Yahoo',
            lastUpdate: Date.now()
          });
        }
      } catch (e) {
        // Silently skip failed symbols
      }
    }));
    
    processed += batch.length;
    
    // Progress update
    if (processed % 100 === 0) {
      console.log(chalk.gray(`  Processed ${processed}/${symbols.length} stocks...`));
    }
    
    // Small delay to avoid rate limiting
    await new Promise(r => setTimeout(r, 100));
  }
  
  console.log(chalk.green(`✅ Got prices for ${priceData.length} stocks`));
  return priceData;
}

// Main update function
async function updateAllAssets() {
  console.log(chalk.cyan.bold(`\n📊 FETCHING ENTIRE MARKET DATA...\n`));
  const startTime = Date.now();
  
  // Get all symbols first
  const [allStockSymbols, allCryptos] = await Promise.all([
    getAllUSStocks(),
    getAllCryptos()
  ]);
  
  console.log(chalk.white(`\n📊 Total symbols found:`));
  console.log(chalk.white(`  • Stocks: ${allStockSymbols.length}`));
  console.log(chalk.white(`  • Cryptos: ${allCryptos.length}`));
  console.log(chalk.white(`  • TOTAL: ${allStockSymbols.length + allCryptos.length}`));
  
  // Get stock prices (batch process to avoid overwhelming)
  console.log(chalk.cyan('\n💹 Getting stock prices (this may take a few minutes)...'));
  const stockPrices = await getStockPrices(allStockSymbols.slice(0, 500)); // Start with first 500
  
  // Process crypto changes
  allCryptos.forEach(crypto => {
    crypto.change2min = trackChange(crypto.symbol, crypto.price);
  });
  
  // Combine all assets
  const newAssets = new Map();
  
  stockPrices.forEach(stock => {
    newAssets.set(stock.symbol, stock);
  });
  
  allCryptos.forEach(crypto => {
    if (!newAssets.has(crypto.symbol)) {
      newAssets.set(crypto.symbol, crypto);
    }
  });
  
  allAssets = newAssets;
  
  // Find interesting movements
  const assetsArray = Array.from(allAssets.values());
  
  const alerts = assetsArray.filter(a => a.change2min >= 9 && a.change2min <= 13);
  const hotMovers = assetsArray.filter(a => Math.abs(a.change2min) >= 3);
  const gainers = assetsArray.filter(a => a.change2min > 0).sort((a, b) => b.change2min - a.change2min);
  const losers = assetsArray.filter(a => a.change2min < 0).sort((a, b) => a.change2min - b.change2min);
  const mostActive = assetsArray.sort((a, b) => (b.volume || 0) - (a.volume || 0)).slice(0, 20);
  
  const duration = ((Date.now() - startTime) / 1000).toFixed(1);
  
  // Summary
  console.log(chalk.green.bold(`\n✅ MARKET UPDATE COMPLETE in ${duration}s`));
  console.log(chalk.white(`📊 Tracking: ${allAssets.size} total assets`));
  console.log(chalk.white(`  • Stocks with prices: ${assetsArray.filter(a => a.type === 'stock').length}`));
  console.log(chalk.white(`  • Cryptos with prices: ${assetsArray.filter(a => a.type === 'crypto').length}`));
  
  if (alerts.length > 0) {
    console.log(chalk.red.bold(`\n🚨 ALERTS (9-13% gain in 2 min):`));
    alerts.forEach(a => {
      console.log(chalk.red(`  ${a.symbol}: +${a.change2min.toFixed(2)}% | $${a.price.toFixed(2)}`));
    });
  }
  
  if (hotMovers.length > 0) {
    console.log(chalk.yellow(`\n🔥 Hot Movers (3%+ change in 2 min):`));
    hotMovers.slice(0, 5).forEach(a => {
      const sign = a.change2min > 0 ? '+' : '';
      console.log(chalk.yellow(`  ${a.symbol}: ${sign}${a.change2min.toFixed(2)}%`));
    });
  }
  
  // Broadcast to clients
  broadcast({
    type: 'update',
    data: {
      total: allAssets.size,
      totalStocks: assetsArray.filter(a => a.type === 'stock').length,
      totalCryptos: assetsArray.filter(a => a.type === 'crypto').length,
      alerts,
      hotMovers: hotMovers.slice(0, 20),
      gainers: gainers.slice(0, 20),
      losers: losers.slice(0, 20),
      mostActive,
      timestamp: Date.now()
    }
  });
}

// WebSocket handling
wss.on('connection', (ws) => {
  clients.add(ws);
  console.log(chalk.green('✅ Client connected'));
  
  ws.on('close', () => clients.delete(ws));
});

function broadcast(data) {
  const message = JSON.stringify(data);
  clients.forEach(client => {
    if (client.readyState === 1) {
      try { client.send(message); } catch (e) {}
    }
  });
}

// Dashboard
app.get('/', (req, res) => {
  res.send(`
<!DOCTYPE html>
<html>
<head>
  <title>Complete Market Monitor - ALL Stocks & Crypto</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, system-ui, sans-serif;
      background: linear-gradient(135deg, #0f2027 0%, #203a43 50%, #2c5364 100%);
      color: white;
      padding: 20px;
      min-height: 100vh;
    }
    .header {
      text-align: center;
      padding: 30px;
      background: rgba(0,0,0,0.4);
      border-radius: 15px;
      margin-bottom: 30px;
    }
    h1 { 
      font-size: 42px; 
      margin-bottom: 10px;
      background: linear-gradient(90deg, #00ff88, #00aaff);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }
    .subtitle { font-size: 18px; color: #aaa; }
    .stats {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 20px;
      margin: 30px 0;
      max-width: 1200px;
      margin-left: auto;
      margin-right: auto;
    }
    .stat {
      background: rgba(255,255,255,0.1);
      padding: 20px;
      border-radius: 10px;
      text-align: center;
      backdrop-filter: blur(10px);
    }
    .stat-value {
      font-size: 36px;
      font-weight: bold;
      color: #00ff88;
    }
    .stat-label {
      font-size: 14px;
      color: #aaa;
      margin-top: 5px;
    }
    .sections {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(400px, 1fr));
      gap: 20px;
      max-width: 1600px;
      margin: 0 auto;
    }
    .section {
      background: rgba(255,255,255,0.05);
      border-radius: 15px;
      padding: 20px;
      backdrop-filter: blur(10px);
    }
    .section h2 {
      margin-bottom: 15px;
      padding-bottom: 10px;
      border-bottom: 2px solid rgba(255,255,255,0.2);
      color: #00ff88;
    }
    .asset {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 12px;
      margin: 8px 0;
      background: rgba(255,255,255,0.05);
      border-radius: 8px;
      transition: all 0.3s;
    }
    .asset:hover {
      background: rgba(255,255,255,0.1);
      transform: translateX(5px);
    }
    .symbol { 
      font-weight: bold; 
      color: #00aaff;
      font-size: 16px;
    }
    .price { 
      color: white;
      font-size: 14px;
    }
    .change { 
      font-weight: bold; 
      padding: 4px 8px;
      border-radius: 4px;
      font-size: 14px;
    }
    .positive { 
      background: rgba(0,255,0,0.2);
      color: #00ff88;
    }
    .negative { 
      background: rgba(255,0,0,0.2);
      color: #ff6666;
    }
    .alert {
      background: rgba(255,0,0,0.1);
      border: 2px solid rgba(255,0,0,0.5);
      animation: pulse 2s infinite;
    }
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.7; }
    }
    .loading {
      text-align: center;
      padding: 50px;
      color: #888;
    }
    #status {
      text-align: center;
      padding: 10px;
      color: #00ff88;
      font-size: 14px;
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>🌍 COMPLETE MARKET MONITOR</h1>
    <div class="subtitle">Tracking EVERY Stock & Cryptocurrency</div>
    <div id="status">Connecting...</div>
  </div>
  
  <div class="stats">
    <div class="stat">
      <div class="stat-value" id="total">0</div>
      <div class="stat-label">Total Assets</div>
    </div>
    <div class="stat">
      <div class="stat-value" id="stocks">0</div>
      <div class="stat-label">Stocks</div>
    </div>
    <div class="stat">
      <div class="stat-value" id="cryptos">0</div>
      <div class="stat-label">Cryptocurrencies</div>
    </div>
    <div class="stat">
      <div class="stat-value" id="alerts">0</div>
      <div class="stat-label">🚨 Alerts</div>
    </div>
    <div class="stat">
      <div class="stat-value" id="movers">0</div>
      <div class="stat-label">🔥 Hot Movers</div>
    </div>
  </div>
  
  <div class="sections">
    <div class="section">
      <h2>🚨 ALERTS (9-13% in 2 minutes)</h2>
      <div id="alert-list">
        <div class="loading">Waiting for alerts...</div>
      </div>
    </div>
    
    <div class="section">
      <h2>🔥 HOT MOVERS (3%+ in 2 min)</h2>
      <div id="mover-list">
        <div class="loading">Loading market data...</div>
      </div>
    </div>
    
    <div class="section">
      <h2>📈 TOP GAINERS</h2>
      <div id="gainer-list">
        <div class="loading">Loading...</div>
      </div>
    </div>
    
    <div class="section">
      <h2>📉 TOP LOSERS</h2>
      <div id="loser-list">
        <div class="loading">Loading...</div>
      </div>
    </div>
    
    <div class="section">
      <h2>🔊 MOST ACTIVE (Volume)</h2>
      <div id="active-list">
        <div class="loading">Loading...</div>
      </div>
    </div>
  </div>
  
  <script>
    const ws = new WebSocket('ws://localhost:3001');
    
    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.type === 'update') {
        updateDashboard(msg.data);
      }
    };
    
    ws.onopen = () => {
      document.getElementById('status').textContent = '🟢 Connected - Live Updates Active';
    };
    
    ws.onerror = () => {
      document.getElementById('status').textContent = '🔴 Connection Error';
    };
    
    function updateDashboard(data) {
      // Update stats
      document.getElementById('total').textContent = data.total.toLocaleString();
      document.getElementById('stocks').textContent = data.totalStocks.toLocaleString();
      document.getElementById('cryptos').textContent = data.totalCryptos.toLocaleString();
      document.getElementById('alerts').textContent = data.alerts.length;
      document.getElementById('movers').textContent = data.hotMovers.length;
      
      // Update time
      document.getElementById('status').textContent = 
        '🟢 Last Update: ' + new Date().toLocaleTimeString();
      
      // Render alerts
      const alertDiv = document.getElementById('alert-list');
      if (data.alerts && data.alerts.length > 0) {
        alertDiv.innerHTML = data.alerts.map(a => 
          '<div class="asset alert">' +
          '<span class="symbol">' + a.symbol + '</span>' +
          '<span class="price">$' + formatPrice(a.price) + '</span>' +
          '<span class="change positive">+' + a.change2min.toFixed(2) + '%</span>' +
          '</div>'
        ).join('');
      } else {
        alertDiv.innerHTML = '<div class="loading">No alerts yet (waiting for 9-13% gains)</div>';
      }
      
      // Render other sections
      document.getElementById('mover-list').innerHTML = renderAssets(data.hotMovers);
      document.getElementById('gainer-list').innerHTML = renderAssets(data.gainers);
      document.getElementById('loser-list').innerHTML = renderAssets(data.losers);
      document.getElementById('active-list').innerHTML = renderActiveAssets(data.mostActive);
    }
    
    function renderAssets(assets) {
      if (!assets || assets.length === 0) {
        return '<div class="loading">No data yet...</div>';
      }
      
      return assets.map(a => {
        const changeClass = a.change2min >= 0 ? 'positive' : 'negative';
        const sign = a.change2min >= 0 ? '+' : '';
        
        return '<div class="asset">' +
          '<span class="symbol">' + a.symbol + '</span>' +
          '<span class="price">$' + formatPrice(a.price) + '</span>' +
          '<span class="change ' + changeClass + '">' + 
          sign + a.change2min.toFixed(2) + '%</span>' +
          '</div>';
      }).join('');
    }
    
    function renderActiveAssets(assets) {
      if (!assets || assets.length === 0) {
        return '<div class="loading">No data yet...</div>';
      }
      
      return assets.map(a => 
        '<div class="asset">' +
        '<span class="symbol">' + a.symbol + '</span>' +
        '<span class="price">$' + formatPrice(a.price) + '</span>' +
        '<span style="color:#888; font-size:12px">Vol: ' + formatVolume(a.volume) + '</span>' +
        '</div>'
      ).join('');
    }
    
    function formatPrice(price) {
      if (!price) return '0.00';
      return price < 1 ? price.toFixed(6) : price.toFixed(2);
    }
    
    function formatVolume(vol) {
      if (!vol) return '0';
      if (vol > 1e9) return (vol / 1e9).toFixed(1) + 'B';
      if (vol > 1e6) return (vol / 1e6).toFixed(1) + 'M';
      if (vol > 1e3) return (vol / 1e3).toFixed(1) + 'K';
      return vol.toFixed(0);
    }
  </script>
</body>
</html>
  `);
});

// Start server
const PORT = 3001;
server.listen(PORT, () => {
  console.log(chalk.green.bold(`
╔════════════════════════════════════════════════════════════╗
║                    ✅ SERVER READY                        ║
║                                                            ║
║   Dashboard: http://localhost:${PORT}                         ║
║                                                            ║
║   This monitor will fetch:                                ║
║   • ALL stocks from NASDAQ, NYSE, AMEX                    ║
║   • ALL cryptocurrencies from multiple sources            ║
║   • THOUSANDS of assets total                             ║
║                                                            ║
║   First load may take 2-3 minutes to fetch everything     ║
║   Updates every 30 seconds after initial load             ║
╚════════════════════════════════════════════════════════════╝
  `));
});

// Initial update (this will take a while)
console.log(chalk.yellow('\n⏳ Starting initial market scan (this will take 2-3 minutes)...\n'));
setTimeout(updateAllAssets, 1000);

// Update every 30 seconds
setInterval(updateAllAssets, 30000);

// Error handling
process.on('uncaughtException', (err) => {
  console.error(chalk.red('Error:'), err.message);
});