import yahooFinance from 'yahoo-finance2';
import express from 'express';
import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import cron from 'node-cron';
import chalk from 'chalk';

console.log(chalk.cyan.bold(`
╔════════════════════════════════════════════════════════════╗
║        🚀 STOCK MOMENTUM SCANNER - FREE VERSION           ║
║           Detecting 9-13% gains in real-time              ║
║              Powered by Yahoo Finance (FREE)              ║
╚════════════════════════════════════════════════════════════╝
`));

// Configuration
const THRESHOLD_MIN = 9.0;
const THRESHOLD_MAX = 13.0;
const CHECK_INTERVAL = 10; // seconds
const PORT = 3001;

// Popular stocks to monitor (you can add more)
const STOCKS_TO_MONITOR = [
  'AAPL', 'MSFT', 'GOOGL', 'AMZN', 'TSLA', 'META', 'NVDA', 'AMD', 
  'NFLX', 'BABA', 'V', 'JPM', 'JNJ', 'WMT', 'PG', 'DIS', 'PYPL',
  'ADBE', 'CRM', 'INTC', 'CSCO', 'PFE', 'ORCL', 'NKE', 'BA',
  'SPY', 'QQQ', 'SOFI', 'PLTR', 'COIN', 'RIVN', 'LCID', 'NIO',
  'SHOP', 'SQ', 'ROKU', 'SNAP', 'PINS', 'UBER', 'LYFT', 'ABNB',
  'DKNG', 'PENN', 'FUBO', 'GME', 'AMC', 'BB', 'BBBY', 'WISH'
];

// Data storage
const stockData = new Map();
const priceHistory = new Map();
const activeAlerts = new Map();

// Express app
const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

// WebSocket clients
const clients = new Set();

// Track WebSocket connections
wss.on('connection', (ws) => {
  clients.add(ws);
  console.log(chalk.green('✅ Client connected. Total clients:'), clients.size);
  
  // Send current alerts
  ws.send(JSON.stringify({
    type: 'snapshot',
    data: Array.from(activeAlerts.values())
  }));
  
  ws.on('close', () => {
    clients.delete(ws);
    console.log(chalk.yellow('Client disconnected. Total clients:'), clients.size);
  });
});

// Broadcast to all clients
function broadcast(data) {
  const message = JSON.stringify(data);
  clients.forEach(client => {
    if (client.readyState === 1) {
      client.send(message);
    }
  });
}

// Fetch stock data
async function fetchStockData(symbol) {
  try {
    const quote = await yahooFinance.quote(symbol);
    
    if (quote && quote.regularMarketPrice) {
      return {
        symbol: quote.symbol,
        price: quote.regularMarketPrice,
        previousClose: quote.regularMarketPreviousClose,
        dayChange: quote.regularMarketChange,
        dayChangePercent: quote.regularMarketChangePercent,
        volume: quote.regularMarketVolume,
        dayHigh: quote.regularMarketDayHigh,
        dayLow: quote.regularMarketDayLow,
        marketCap: quote.marketCap,
        timestamp: Date.now()
      };
    }
  } catch (error) {
    // Silently handle errors for individual stocks
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
  
  // Add current price
  history.push({ price: currentPrice, timestamp: now });
  
  // Remove prices older than 2 minutes
  const twoMinutesAgo = now - (2 * 60 * 1000);
  const filtered = history.filter(h => h.timestamp > twoMinutesAgo);
  priceHistory.set(symbol, filtered);
  
  // Calculate change if we have enough data
  if (filtered.length > 5) {
    const prices = filtered.map(h => h.price);
    const minPrice = Math.min(...prices);
    const maxPrice = Math.max(...prices);
    const changePercent = ((currentPrice - minPrice) / minPrice) * 100;
    
    return {
      changePercent,
      minPrice,
      maxPrice,
      dataPoints: filtered.length
    };
  }
  
  return null;
}

// Check for threshold alerts
function checkThreshold(stockInfo, twoMinChange) {
  const { symbol, price, volume, dayChangePercent } = stockInfo;
  const { changePercent, minPrice, maxPrice } = twoMinChange;
  
  if (changePercent >= THRESHOLD_MIN && changePercent <= THRESHOLD_MAX) {
    const alert = {
      symbol,
      currentPrice: price,
      changePercent2Min: changePercent,
      dayChangePercent,
      minPrice2Min: minPrice,
      maxPrice2Min: maxPrice,
      volume,
      timestamp: Date.now(),
      webullUrl: `https://www.webull.com/quote/nasdaq-${symbol.toLowerCase()}`,
      yahooUrl: `https://finance.yahoo.com/quote/${symbol}`
    };
    
    // Check if this is a new alert or significant change
    const existing = activeAlerts.get(symbol);
    if (!existing || Math.abs(existing.changePercent2Min - changePercent) > 0.5) {
      activeAlerts.set(symbol, alert);
      
      // Console alert
      console.log(chalk.red.bold(`
┌────────────────────────────────────────┐
│  🚨 ALERT: ${symbol.padEnd(5)} @ ${changePercent.toFixed(2)}% (2min)
│  Price: $${price.toFixed(2)}
│  2-Min Range: $${minPrice.toFixed(2)} - $${maxPrice.toFixed(2)}
│  Day Change: ${dayChangePercent.toFixed(2)}%
│  Volume: ${(volume / 1000000).toFixed(2)}M
│  🔗 ${alert.webullUrl}
└────────────────────────────────────────┘`));
      
      // Broadcast to clients
      broadcast({
        type: 'alert',
        data: alert
      });
      
      return true;
    }
  } else {
    // Remove from active alerts if no longer in range
    if (activeAlerts.has(symbol)) {
      activeAlerts.delete(symbol);
      console.log(chalk.blue(`ℹ️  ${symbol} exited threshold range`));
    }
  }
  
  return false;
}

// Monitor stocks
async function monitorStocks() {
  console.log(chalk.gray(`Checking ${STOCKS_TO_MONITOR.length} stocks...`));
  
  let alertCount = 0;
  const promises = STOCKS_TO_MONITOR.map(async (symbol) => {
    const data = await fetchStockData(symbol);
    
    if (data) {
      stockData.set(symbol, data);
      
      const twoMinChange = calculate2MinuteChange(symbol, data.price);
      if (twoMinChange) {
        if (checkThreshold(data, twoMinChange)) {
          alertCount++;
        }
      }
    }
  });
  
  await Promise.all(promises);
  
  if (alertCount > 0) {
    console.log(chalk.yellow(`Found ${alertCount} stocks in threshold range`));
  }
  
  // Update stats
  broadcast({
    type: 'stats',
    data: {
      totalMonitored: STOCKS_TO_MONITOR.length,
      activeAlerts: activeAlerts.size,
      timestamp: Date.now()
    }
  });
}

// API endpoints
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    monitoring: STOCKS_TO_MONITOR.length,
    activeAlerts: activeAlerts.size
  });
});

app.get('/api/alerts', (req, res) => {
  res.json(Array.from(activeAlerts.values()));
});

app.get('/api/stocks', (req, res) => {
  res.json(Array.from(stockData.values()));
});

// HTML dashboard
app.get('/', (req, res) => {
  res.send(`
<!DOCTYPE html>
<html>
<head>
  <title>Stock Momentum Scanner</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #0a0a0a;
      color: #fff;
      margin: 0;
      padding: 20px;
    }
    h1 {
      color: #00ff00;
      text-align: center;
    }
    .alerts {
      max-width: 800px;
      margin: 0 auto;
    }
    .alert {
      background: #1a1a1a;
      border: 1px solid #333;
      border-radius: 8px;
      padding: 15px;
      margin: 10px 0;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .alert.hot {
      border-color: #ff9800;
      box-shadow: 0 0 10px rgba(255, 152, 0, 0.3);
    }
    .symbol {
      font-size: 24px;
      font-weight: bold;
      color: #00ff00;
    }
    .price {
      font-size: 20px;
    }
    .change {
      font-size: 18px;
      color: #00ff00;
    }
    .link {
      color: #00aaff;
      text-decoration: none;
    }
    .stats {
      text-align: center;
      margin: 20px 0;
      color: #888;
    }
    .no-alerts {
      text-align: center;
      color: #666;
      margin: 50px 0;
    }
  </style>
</head>
<body>
  <h1>🚀 Stock Momentum Scanner</h1>
  <div class="stats" id="stats">Connecting...</div>
  <div class="alerts" id="alerts">
    <div class="no-alerts">Monitoring for stocks with 9-13% gains...</div>
  </div>
  
  <script>
    const ws = new WebSocket('ws://localhost:3001');
    const alertsDiv = document.getElementById('alerts');
    const statsDiv = document.getElementById('stats');
    
    ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      
      if (message.type === 'alert' || message.type === 'snapshot') {
        const alerts = message.type === 'snapshot' ? message.data : [message.data];
        
        if (alerts.length > 0) {
          alertsDiv.innerHTML = alerts.map(alert => \`
            <div class="alert \${alert.changePercent2Min > 11 ? 'hot' : ''}">
              <div>
                <div class="symbol">\${alert.symbol}</div>
                <div class="price">$\${alert.currentPrice.toFixed(2)}</div>
              </div>
              <div>
                <div class="change">+\${alert.changePercent2Min.toFixed(2)}% (2min)</div>
                <div>Day: \${alert.dayChangePercent.toFixed(2)}%</div>
              </div>
              <div>
                <a href="\${alert.webullUrl}" target="_blank" class="link">Webull →</a>
              </div>
            </div>
          \`).join('');
        }
      } else if (message.type === 'stats') {
        statsDiv.innerHTML = \`Monitoring \${message.data.totalMonitored} stocks | Active alerts: \${message.data.activeAlerts}\`;
      }
    };
    
    ws.onopen = () => {
      statsDiv.innerHTML = 'Connected - Waiting for data...';
    };
    
    ws.onclose = () => {
      statsDiv.innerHTML = 'Disconnected - Refreshing...';
      setTimeout(() => location.reload(), 3000);
    };
  </script>
</body>
</html>
  `);
});

// Start monitoring
async function start() {
  console.log(chalk.cyan('\n📊 Starting initial scan...'));
  
  // Initial scan
  await monitorStocks();
  
  // Schedule regular checks (every 10 seconds during market hours)
  cron.schedule(`*/${CHECK_INTERVAL} * * * * *`, () => {
    const now = new Date();
    const hour = now.getHours();
    const day = now.getDay();
    
    // Only run during extended market hours (4 AM - 8 PM ET, Mon-Fri)
    // Adjust for your timezone
    if (day >= 1 && day <= 5 && hour >= 4 && hour <= 20) {
      monitorStocks();
    }
  });
  
  // Start server
  server.listen(PORT, () => {
    console.log(chalk.green.bold(`
╔════════════════════════════════════════════════════════════╗
║                    ✅ SYSTEM READY                        ║
║                                                            ║
║   Dashboard:     http://localhost:${PORT}                     ║
║   WebSocket:     ws://localhost:${PORT}                       ║
║   Health:        http://localhost:${PORT}/health              ║
║                                                            ║
║   Monitoring ${STOCKS_TO_MONITOR.length} stocks for 9-13% gains            ║
║   Checking every ${CHECK_INTERVAL} seconds                           ║
║                                                            ║
║   NO API KEY REQUIRED! 100% FREE!                         ║
╚════════════════════════════════════════════════════════════╝
    `));
    
    console.log(chalk.cyan('\n💡 Tips:'));
    console.log(chalk.gray('   • Add more stocks to monitor by editing STOCKS_TO_MONITOR'));
    console.log(chalk.gray('   • Adjust thresholds by changing THRESHOLD_MIN/MAX'));
    console.log(chalk.gray('   • View dashboard at http://localhost:3001\n'));
  });
}

// Handle errors
process.on('uncaughtException', (error) => {
  console.error(chalk.red('Error:'), error);
});

// Start the application
start();
