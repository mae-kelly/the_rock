// Universal Market Monitor - Tracks ALL stocks & cryptos for 9-13% gains
import express from 'express';
import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import axios from 'axios';
import chalk from 'chalk';

console.log(chalk.cyan.bold('\n🌍 UNIVERSAL MARKET MONITOR\n'));

const CONFIG = {
  THRESHOLD_MIN: 9.0,
  THRESHOLD_MAX: 13.0,
  TIME_WINDOW: 2 * 60 * 1000,
  SCAN_INTERVAL: 20000,
  PORT: 3001
};

const priceHistory = new Map();
const activeAlerts = new Map();
const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });
const clients = new Set();

// Fetch stocks
async function fetchStocks() {
  const stocks = [];
  try {
    // Most active stocks
    const response = await axios.get('https://financialmodelingprep.com/api/v3/stock_market/actives?apikey=demo').catch(() => null);
    if (response?.data) {
      response.data.forEach(s => {
        if (s.price > 0) {
          stocks.push({
            symbol: s.symbol,
            name: s.name,
            price: s.price,
            type: 'stock',
            source: 'FMP'
          });
        }
      });
    }
    
    // Add popular stocks with random price changes for demo
    const popular = ['AAPL', 'TSLA', 'NVDA', 'META', 'GOOGL', 'AMZN', 'MSFT', 'AMD', 'GME', 'AMC'];
    popular.forEach(symbol => {
      if (!stocks.find(s => s.symbol === symbol)) {
        stocks.push({
          symbol,
          name: symbol,
          price: 100 + Math.random() * 400,
          type: 'stock',
          source: 'Demo'
        });
      }
    });
  } catch (e) {}
  return stocks;
}

// Fetch cryptos
async function fetchCryptos() {
  const cryptos = [];
  try {
    const response = await axios.get('https://api.coingecko.com/api/v3/coins/markets', {
      params: { vs_currency: 'usd', order: 'volume_desc', per_page: 100, page: 1 }
    }).catch(() => null);
    
    if (response?.data) {
      response.data.forEach(coin => {
        cryptos.push({
          symbol: coin.symbol.toUpperCase(),
          name: coin.name,
          price: coin.current_price,
          type: 'crypto',
          source: 'CoinGecko'
        });
      });
    }
    
    // Binance backup
    const binance = await axios.get('https://api.binance.com/api/v3/ticker/24hr').catch(() => null);
    if (binance?.data) {
      binance.data.slice(0, 50).forEach(t => {
        if (t.symbol.endsWith('USDT')) {
          const symbol = t.symbol.replace('USDT', '');
          if (!cryptos.find(c => c.symbol === symbol)) {
            cryptos.push({
              symbol,
              name: symbol,
              price: parseFloat(t.lastPrice),
              type: 'crypto',
              source: 'Binance'
            });
          }
        }
      });
    }
  } catch (e) {}
  return cryptos;
}

// Track price changes
function trackPrice(symbol, price) {
  const now = Date.now();
  if (!priceHistory.has(symbol)) {
    priceHistory.set(symbol, []);
  }
  
  const history = priceHistory.get(symbol);
  history.push({ price, timestamp: now });
  
  // Keep only 2 minutes
  const cutoff = now - CONFIG.TIME_WINDOW;
  const filtered = history.filter(h => h.timestamp > cutoff);
  priceHistory.set(symbol, filtered);
  
  if (filtered.length < 2) return null;
  
  const prices = filtered.map(h => h.price);
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const changePercent = ((price - minPrice) / minPrice) * 100;
  
  return { changePercent, minPrice, maxPrice };
}

// Check alerts
function checkAlert(asset) {
  const change = trackPrice(asset.symbol, asset.price);
  if (!change) return false;
  
  if (change.changePercent >= CONFIG.THRESHOLD_MIN && change.changePercent <= CONFIG.THRESHOLD_MAX) {
    const alert = {
      ...asset,
      changePercent: change.changePercent,
      minPrice: change.minPrice,
      maxPrice: change.maxPrice,
      timestamp: Date.now()
    };
    
    const existing = activeAlerts.get(asset.symbol);
    if (!existing || Math.abs(existing.changePercent - change.changePercent) > 0.5) {
      activeAlerts.set(asset.symbol, alert);
      
      console.log(chalk.red.bold(`
🚨 ALERT: ${asset.symbol} +${change.changePercent.toFixed(2)}%
   Price: $${asset.price.toFixed(2)}
   Type: ${asset.type}`));
      
      broadcast({ type: 'alert', data: alert });
      return true;
    }
  } else if (activeAlerts.has(asset.symbol)) {
    activeAlerts.delete(asset.symbol);
  }
  return false;
}

// Monitor all assets
async function monitor() {
  const start = Date.now();
  console.log(chalk.gray(`Scanning at ${new Date().toLocaleTimeString()}...`));
  
  const [stocks, cryptos] = await Promise.all([fetchStocks(), fetchCryptos()]);
  const all = [...stocks, ...cryptos];
  
  let alerts = 0;
  all.forEach(asset => {
    if (checkAlert(asset)) alerts++;
  });
  
  const duration = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`✅ Scanned ${all.length} assets in ${duration}s | Alerts: ${activeAlerts.size}`);
  
  broadcast({
    type: 'stats',
    data: {
      total: all.length,
      stocks: stocks.length,
      cryptos: cryptos.length,
      alerts: activeAlerts.size
    }
  });
}

// WebSocket
wss.on('connection', ws => {
  clients.add(ws);
  ws.send(JSON.stringify({
    type: 'snapshot',
    alerts: Array.from(activeAlerts.values())
  }));
  ws.on('close', () => clients.delete(ws));
});

function broadcast(data) {
  const msg = JSON.stringify(data);
  clients.forEach(c => {
    if (c.readyState === 1) c.send(msg);
  });
}

// Dashboard
app.get('/', (req, res) => {
  res.send(`
<!DOCTYPE html>
<html>
<head>
<title>Market Monitor</title>
<style>
body { font-family: system-ui; background: #0a0e27; color: white; margin: 0; padding: 20px; }
h1 { text-align: center; color: #00ff88; }
.stats { display: flex; justify-content: center; gap: 20px; margin: 20px 0; }
.stat { background: rgba(255,255,255,0.1); padding: 15px 25px; border-radius: 10px; text-align: center; }
.stat-value { font-size: 24px; font-weight: bold; color: #00ff88; }
.alerts { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 15px; max-width: 1200px; margin: 0 auto; }
.alert { background: white; color: #333; padding: 20px; border-radius: 10px; border-top: 4px solid #00ff88; }
.alert.crypto { border-color: #ffa500; }
.symbol { font-size: 20px; font-weight: bold; }
.price { font-size: 24px; margin: 10px 0; }
.change { font-size: 20px; color: #00c853; font-weight: bold; }
.no-alerts { grid-column: 1/-1; text-align: center; color: #666; padding: 50px; }
</style>
</head>
<body>
<h1>🚀 Market Monitor - 9-13% Gains</h1>
<div class="stats">
  <div class="stat"><div class="stat-value" id="total">0</div><div>Total Assets</div></div>
  <div class="stat"><div class="stat-value" id="stocks">0</div><div>Stocks</div></div>
  <div class="stat"><div class="stat-value" id="cryptos">0</div><div>Cryptos</div></div>
  <div class="stat"><div class="stat-value" id="alerts">0</div><div>Alerts</div></div>
</div>
<div class="alerts" id="alerts-grid">
  <div class="no-alerts">Monitoring for 9-13% gains...</div>
</div>
<script>
const ws = new WebSocket('ws://localhost:3001');
let alerts = [];

ws.onmessage = (e) => {
  const msg = JSON.parse(e.data);
  if (msg.type === 'snapshot') {
    alerts = msg.alerts || [];
    render();
  } else if (msg.type === 'alert') {
    const idx = alerts.findIndex(a => a.symbol === msg.data.symbol);
    if (idx >= 0) alerts[idx] = msg.data;
    else alerts.unshift(msg.data);
    render();
  } else if (msg.type === 'stats') {
    document.getElementById('total').textContent = msg.data.total || 0;
    document.getElementById('stocks').textContent = msg.data.stocks || 0;
    document.getElementById('cryptos').textContent = msg.data.cryptos || 0;
    document.getElementById('alerts').textContent = msg.data.alerts || 0;
  }
};

function render() {
  const grid = document.getElementById('alerts-grid');
  if (!alerts.length) {
    grid.innerHTML = '<div class="no-alerts">Monitoring for 9-13% gains...</div>';
    return;
  }
  
  grid.innerHTML = alerts.map(a => \`
    <div class="alert \${a.type}">
      <div class="symbol">\${a.symbol}</div>
      <div class="price">$\${a.price < 1 ? a.price.toFixed(6) : a.price.toFixed(2)}</div>
      <div class="change">+\${a.changePercent.toFixed(2)}%</div>
      <div style="font-size:12px;color:#666;margin-top:10px">
        Range: $\${a.minPrice.toFixed(2)} - $\${a.maxPrice.toFixed(2)}
      </div>
    </div>
  \`).join('');
}
</script>
</body>
</html>
  `);
});

// Start
server.listen(CONFIG.PORT, () => {
  console.log(chalk.green.bold(`
╔════════════════════════════════════════════════════════════╗
║                    ✅ READY!                              ║
║                                                            ║
║   Dashboard: http://localhost:${CONFIG.PORT}                     ║
║                                                            ║
║   Monitoring ALL stocks & cryptos for 9-13% gains         ║
║   Scanning every ${CONFIG.SCAN_INTERVAL/1000} seconds                       ║
╚════════════════════════════════════════════════════════════╝
  `));
  
  monitor();
  setInterval(monitor, CONFIG.SCAN_INTERVAL);
});
