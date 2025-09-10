#!/bin/bash
# File: start-monitor.sh

echo "🚀 Universal Market Monitor - Quick Start"
echo "========================================="
echo ""

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed!"
    echo "Please install Node.js from: https://nodejs.org/"
    exit 1
fi

echo "✅ Node.js found: $(node --version)"
echo ""

# Create directory structure
echo "📁 Setting up project structure..."
mkdir -p src

# Create the main monitor file
echo "📝 Creating monitor script..."
cat > src/universal-monitor.js << 'ENDOFFILE'
// File: src/universal-monitor.js
// FIXED VERSION - Monitors ALL stocks and cryptos for 9-13% gains in 2-minute windows

import express from 'express';
import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import axios from 'axios';
import chalk from 'chalk';

console.log(chalk.cyan.bold(`
╔════════════════════════════════════════════════════════════╗
║     🌍 UNIVERSAL MARKET MONITOR - FIXED VERSION           ║
║     Tracking ALL Stocks & Cryptos for 9-13% gains         ║
║     in real-time 2-minute windows                         ║
╚════════════════════════════════════════════════════════════╝
`));

// Configuration
const CONFIG = {
  THRESHOLD_MIN: 9.0,
  THRESHOLD_MAX: 13.0,
  TIME_WINDOW: 2 * 60 * 1000, // 2 minutes
  SCAN_INTERVAL: 15000, // 15 seconds
  PORT: 3001
};

// Data storage
const priceHistory = new Map(); // symbol -> [{price, timestamp}]
const activeAlerts = new Map(); // symbol -> alert data
const assetMetadata = new Map(); // symbol -> {name, type, source}
const lastPrices = new Map(); // symbol -> last price

// Express setup
const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });
const clients = new Set();

// ============= DATA FETCHING FUNCTIONS =============

// 1. Fetch ALL US Stocks from multiple sources
async function fetchAllStocks() {
  const stocks = [];
  
  try {
    // Get NASDAQ stocks
    console.log(chalk.gray('Fetching NASDAQ stocks...'));
    const nasdaqResponse = await axios.get(
      'https://api.nasdaq.com/api/screener/stocks?tableonly=true&limit=10000&exchange=nasdaq',
      {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'application/json'
        },
        timeout: 10000
      }
    ).catch(() => null);
    
    if (nasdaqResponse?.data?.data?.rows) {
      nasdaqResponse.data.data.rows.forEach(stock => {
        if (stock.symbol && stock.lastsale) {
          const price = parseFloat(stock.lastsale.replace(/[$,]/g, ''));
          if (price > 0) {
            stocks.push({
              symbol: stock.symbol,
              name: stock.name,
              price: price,
              volume: parseInt(stock.volume) || 0,
              type: 'stock',
              exchange: 'NASDAQ',
              source: 'NASDAQ'
            });
          }
        }
      });
      console.log(chalk.green(`  ✓ NASDAQ: ${stocks.length} stocks`));
    }
    
    // Get NYSE stocks
    console.log(chalk.gray('Fetching NYSE stocks...'));
    const nyseResponse = await axios.get(
      'https://api.nasdaq.com/api/screener/stocks?tableonly=true&limit=10000&exchange=nyse',
      {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'application/json'
        },
        timeout: 10000
      }
    ).catch(() => null);
    
    if (nyseResponse?.data?.data?.rows) {
      nyseResponse.data.data.rows.forEach(stock => {
        if (stock.symbol && stock.lastsale) {
          const price = parseFloat(stock.lastsale.replace(/[$,]/g, ''));
          if (price > 0) {
            stocks.push({
              symbol: stock.symbol,
              name: stock.name,
              price: price,
              volume: parseInt(stock.volume) || 0,
              type: 'stock',
              exchange: 'NYSE',
              source: 'NYSE'
            });
          }
        }
      });
      console.log(chalk.green(`  ✓ NYSE: ${nyseResponse.data.data.rows.length} stocks`));
    }
    
    // Get most active stocks from Financial Modeling Prep (free tier)
    const fmpResponse = await axios.get(
      'https://financialmodelingprep.com/api/v3/stock_market/actives?apikey=demo',
      { timeout: 5000 }
    ).catch(() => null);
    
    if (fmpResponse?.data) {
      fmpResponse.data.forEach(stock => {
        if (stock.symbol && stock.price) {
          stocks.push({
            symbol: stock.symbol,
            name: stock.name,
            price: stock.price,
            volume: stock.volume || 0,
            changePercent: stock.changesPercentage || 0,
            type: 'stock',
            source: 'FMP'
          });
        }
      });
    }
    
  } catch (error) {
    console.log(chalk.yellow('Stock fetch error:', error.message));
  }
  
  return stocks;
}

// 2. Fetch ALL Cryptocurrencies
async function fetchAllCrypto() {
  const cryptos = [];
  
  try {
    // CoinGecko - Get top 500 cryptos (no API key needed)
    console.log(chalk.gray('Fetching cryptocurrencies...'));
    
    for (let page = 1; page <= 5; page++) {
      const response = await axios.get(
        'https://api.coingecko.com/api/v3/coins/markets',
        {
          params: {
            vs_currency: 'usd',
            order: 'market_cap_desc',
            per_page: 100,
            page: page,
            sparkline: false
          },
          timeout: 10000
        }
      ).catch(() => null);
      
      if (response?.data) {
        response.data.forEach(coin => {
          if (coin.current_price > 0) {
            cryptos.push({
              symbol: coin.symbol.toUpperCase(),
              name: coin.name,
              price: coin.current_price,
              volume: coin.total_volume || 0,
              marketCap: coin.market_cap || 0,
              change24h: coin.price_change_percentage_24h || 0,
              type: 'crypto',
              source: 'CoinGecko'
            });
          }
        });
      }
      
      // Rate limit prevention
      await new Promise(r => setTimeout(r, 1500));
    }
    
    console.log(chalk.green(`  ✓ CoinGecko: ${cryptos.length} cryptos`));
    
    // Binance - Get additional crypto prices
    const binanceResponse = await axios.get(
      'https://api.binance.com/api/v3/ticker/24hr',
      { timeout: 10000 }
    ).catch(() => null);
    
    if (binanceResponse?.data) {
      binanceResponse.data.forEach(ticker => {
        if (ticker.symbol.endsWith('USDT')) {
          const symbol = ticker.symbol.replace('USDT', '');
          const price = parseFloat(ticker.lastPrice);
          
          // Only add if not already in list
          if (!cryptos.find(c => c.symbol === symbol) && price > 0) {
            cryptos.push({
              symbol: symbol,
              name: symbol,
              price: price,
              volume: parseFloat(ticker.volume) * price,
              change24h: parseFloat(ticker.priceChangePercent),
              type: 'crypto',
              source: 'Binance'
            });
          }
        }
      });
      console.log(chalk.green(`  ✓ Binance: Added additional cryptos`));
    }
    
    // CoinCap - More cryptos
    const coincapResponse = await axios.get(
      'https://api.coincap.io/v2/assets?limit=500',
      { timeout: 10000 }
    ).catch(() => null);
    
    if (coincapResponse?.data?.data) {
      coincapResponse.data.data.forEach(asset => {
        const symbol = asset.symbol;
        const price = parseFloat(asset.priceUsd);
        
        if (!cryptos.find(c => c.symbol === symbol) && price > 0) {
          cryptos.push({
            symbol: symbol,
            name: asset.name,
            price: price,
            volume: parseFloat(asset.volumeUsd24Hr) || 0,
            marketCap: parseFloat(asset.marketCapUsd) || 0,
            change24h: parseFloat(asset.changePercent24Hr) || 0,
            type: 'crypto',
            source: 'CoinCap'
          });
        }
      });
      console.log(chalk.green(`  ✓ CoinCap: Added additional cryptos`));
    }
    
  } catch (error) {
    console.log(chalk.yellow('Crypto fetch error:', error.message));
  }
  
  return cryptos;
}

// ============= PRICE TRACKING FUNCTIONS =============

// Track price changes over 2-minute window
function trackPriceChange(symbol, currentPrice) {
  const now = Date.now();
  
  // Initialize history if needed
  if (!priceHistory.has(symbol)) {
    priceHistory.set(symbol, []);
  }
  
  const history = priceHistory.get(symbol);
  
  // Add current price
  history.push({ price: currentPrice, timestamp: now });
  
  // Remove prices older than 2 minutes
  const cutoffTime = now - CONFIG.TIME_WINDOW;
  const filtered = history.filter(h => h.timestamp > cutoffTime);
  priceHistory.set(symbol, filtered);
  
  // Need at least 2 data points to calculate change
  if (filtered.length < 2) {
    return null;
  }
  
  // Get min and max prices in the window
  const prices = filtered.map(h => h.price);
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const oldestPrice = filtered[0].price;
  
  // Calculate percentage change from minimum to current
  const changeFromMin = ((currentPrice - minPrice) / minPrice) * 100;
  const changeFromOldest = ((currentPrice - oldestPrice) / oldestPrice) * 100;
  
  return {
    changePercent: changeFromMin,
    changeFromOldest: changeFromOldest,
    minPrice: minPrice,
    maxPrice: maxPrice,
    currentPrice: currentPrice,
    dataPoints: filtered.length,
    timeSpan: (now - filtered[0].timestamp) / 1000 // in seconds
  };
}

// Check if asset meets alert criteria
function checkForAlert(asset) {
  const change = trackPriceChange(asset.symbol, asset.price);
  
  if (!change) return false;
  
  // Check if within threshold range
  if (change.changePercent >= CONFIG.THRESHOLD_MIN && 
      change.changePercent <= CONFIG.THRESHOLD_MAX) {
    
    const alert = {
      symbol: asset.symbol,
      name: asset.name || asset.symbol,
      type: asset.type,
      currentPrice: asset.price,
      changePercent2Min: change.changePercent,
      changeFromOldest: change.changeFromOldest,
      minPrice: change.minPrice,
      maxPrice: change.maxPrice,
      volume: asset.volume || 0,
      marketCap: asset.marketCap || 0,
      source: asset.source,
      dataPoints: change.dataPoints,
      timeSpan: change.timeSpan,
      timestamp: Date.now(),
      alertTime: new Date().toLocaleTimeString()
    };
    
    // Check if this is a new alert or significant change
    const existing = activeAlerts.get(asset.symbol);
    if (!existing || Math.abs(existing.changePercent2Min - change.changePercent) > 0.2) {
      activeAlerts.set(asset.symbol, alert);
      
      // Console notification
      const emoji = asset.type === 'crypto' ? '🪙' : '📈';
      console.log(chalk.red.bold(`
┌────────────────────────────────────────────────────────┐
│  🚨 ALERT: ${emoji} ${asset.symbol.padEnd(8)} +${change.changePercent.toFixed(2)}%
│  Price: $${asset.price < 1 ? asset.price.toFixed(6) : asset.price.toFixed(2)}
│  2min Range: $${change.minPrice.toFixed(2)} → $${change.maxPrice.toFixed(2)}
│  Source: ${asset.source} | Type: ${asset.type}
│  Time: ${new Date().toLocaleTimeString()}
└────────────────────────────────────────────────────────┘`));
      
      // Broadcast to WebSocket clients
      broadcast({ type: 'alert', data: alert });
      
      return true;
    }
  } else {
    // Remove from alerts if no longer in range
    if (activeAlerts.has(asset.symbol)) {
      activeAlerts.delete(asset.symbol);
      broadcast({ type: 'alert_removed', symbol: asset.symbol });
    }
  }
  
  return false;
}

// ============= MAIN MONITORING FUNCTION =============

async function monitorAllAssets() {
  const startTime = Date.now();
  console.log(chalk.cyan(`\n[${new Date().toLocaleTimeString()}] Starting market scan...`));
  
  try {
    // Fetch all assets in parallel
    const [stocks, cryptos] = await Promise.all([
      fetchAllStocks(),
      fetchAllCrypto()
    ]);
    
    const allAssets = [...stocks, ...cryptos];
    console.log(chalk.white(`📊 Processing ${allAssets.length} total assets...`));
    
    let alertCount = 0;
    let processedCount = 0;
    
    // Process each asset
    for (const asset of allAssets) {
      // Store metadata
      assetMetadata.set(asset.symbol, {
        name: asset.name,
        type: asset.type,
        source: asset.source,
        exchange: asset.exchange
      });
      
      // Store last price
      lastPrices.set(asset.symbol, asset.price);
      
      // Check for alerts
      if (checkForAlert(asset)) {
        alertCount++;
      }
      
      processedCount++;
      
      // Progress update every 500 assets
      if (processedCount % 500 === 0) {
        process.stdout.write(`\r  Processing: ${processedCount}/${allAssets.length} | Alerts: ${alertCount}`);
      }
    }
    
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(chalk.green(`\n✅ Scan complete in ${duration}s`));
    console.log(chalk.white(`   • Processed: ${processedCount} assets`));
    console.log(chalk.white(`   • Active alerts: ${activeAlerts.size}`));
    console.log(chalk.white(`   • Price histories: ${priceHistory.size}`));
    
    // Broadcast stats update
    broadcast({
      type: 'stats',
      data: {
        totalAssets: allAssets.length,
        stocks: stocks.length,
        cryptos: cryptos.length,
        activeAlerts: activeAlerts.size,
        lastScan: Date.now(),
        scanDuration: duration
      }
    });
    
    // Clean up old alerts
    const alertCutoff = Date.now() - (5 * 60 * 1000); // 5 minutes
    for (const [symbol, alert] of activeAlerts.entries()) {
      if (alert.timestamp < alertCutoff) {
        activeAlerts.delete(symbol);
      }
    }
    
  } catch (error) {
    console.error(chalk.red('Monitor error:'), error.message);
  }
}

// ============= WEBSOCKET HANDLING =============

wss.on('connection', (ws) => {
  clients.add(ws);
  console.log(chalk.green('✅ Client connected. Total:', clients.size));
  
  // Send current state
  ws.send(JSON.stringify({
    type: 'snapshot',
    alerts: Array.from(activeAlerts.values()),
    stats: {
      totalAssets: assetMetadata.size,
      activeAlerts: activeAlerts.size,
      priceHistories: priceHistory.size
    }
  }));
  
  ws.on('close', () => {
    clients.delete(ws);
    console.log(chalk.yellow('Client disconnected. Total:', clients.size));
  });
  
  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
  });
});

function broadcast(data) {
  const message = JSON.stringify(data);
  clients.forEach(client => {
    if (client.readyState === 1) {
      try {
        client.send(message);
      } catch (e) {
        console.error('Broadcast error:', e);
      }
    }
  });
}

// ============= HTTP ENDPOINTS =============

app.get('/api/alerts', (req, res) => {
  res.json({
    alerts: Array.from(activeAlerts.values()),
    count: activeAlerts.size
  });
});

app.get('/api/stats', (req, res) => {
  res.json({
    totalAssets: assetMetadata.size,
    activeAlerts: activeAlerts.size,
    priceHistories: priceHistory.size,
    lastPrices: lastPrices.size,
    uptime: process.uptime()
  });
});

app.get('/api/assets', (req, res) => {
  const assets = [];
  for (const [symbol, price] of lastPrices.entries()) {
    const meta = assetMetadata.get(symbol) || {};
    assets.push({
      symbol,
      price,
      ...meta
    });
  }
  res.json(assets);
});

// ============= WEB DASHBOARD =============

app.get('/', (req, res) => {
  res.send(\`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Universal Market Monitor - 9-13% Gains</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #1e3c72 0%, #2a5298 100%);
      color: white;
      min-height: 100vh;
    }
    
    .header {
      text-align: center;
      padding: 30px 20px;
      background: rgba(0,0,0,0.3);
      backdrop-filter: blur(10px);
    }
    
    h1 {
      font-size: 36px;
      margin-bottom: 10px;
      text-shadow: 2px 2px 4px rgba(0,0,0,0.5);
    }
    
    .subtitle {
      font-size: 16px;
      color: #aaa;
    }
    
    .stats {
      display: flex;
      justify-content: center;
      gap: 30px;
      padding: 20px;
      flex-wrap: wrap;
    }
    
    .stat {
      background: rgba(255,255,255,0.1);
      padding: 15px 30px;
      border-radius: 10px;
      text-align: center;
      backdrop-filter: blur(5px);
    }
    
    .stat-value {
      font-size: 28px;
      font-weight: bold;
      color: #00ff88;
    }
    
    .stat-label {
      font-size: 12px;
      color: #aaa;
      text-transform: uppercase;
      margin-top: 5px;
    }
    
    .container {
      max-width: 1400px;
      margin: 0 auto;
      padding: 20px;
    }
    
    .alerts-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 20px;
    }
    
    .alerts-title {
      font-size: 24px;
      font-weight: bold;
    }
    
    .scan-status {
      font-size: 14px;
      color: #00ff88;
      padding: 8px 15px;
      background: rgba(0,255,136,0.1);
      border-radius: 20px;
      border: 1px solid rgba(0,255,136,0.3);
    }
    
    .alerts-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(350px, 1fr));
      gap: 20px;
    }
    
    .alert-card {
      background: rgba(255,255,255,0.95);
      color: #333;
      border-radius: 12px;
      padding: 20px;
      box-shadow: 0 10px 30px rgba(0,0,0,0.3);
      transition: all 0.3s ease;
      position: relative;
      overflow: hidden;
    }
    
    .alert-card:hover {
      transform: translateY(-5px);
      box-shadow: 0 15px 40px rgba(0,0,0,0.4);
    }
    
    .alert-card.crypto {
      border-top: 4px solid #f39c12;
    }
    
    .alert-card.stock {
      border-top: 4px solid #00ff88;
    }
    
    .alert-card::before {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      height: 2px;
      background: linear-gradient(90deg, transparent, #00ff88, transparent);
      animation: scan 2s linear infinite;
    }
    
    @keyframes scan {
      0% { transform: translateX(-100%); }
      100% { transform: translateX(100%); }
    }
    
    .alert-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 15px;
    }
    
    .alert-symbol {
      font-size: 24px;
      font-weight: bold;
      color: #1e3c72;
    }
    
    .alert-type {
      padding: 4px 10px;
      border-radius: 15px;
      font-size: 11px;
      font-weight: bold;
      text-transform: uppercase;
    }
    
    .alert-type.crypto {
      background: #f39c12;
      color: white;
    }
    
    .alert-type.stock {
      background: #00ff88;
      color: #1e3c72;
    }
    
    .alert-price {
      font-size: 32px;
      font-weight: bold;
      color: #1e3c72;
      margin: 10px 0;
    }
    
    .alert-change {
      font-size: 28px;
      font-weight: bold;
      color: #00c853;
      margin: 10px 0;
    }
    
    .alert-details {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
      margin-top: 15px;
      padding-top: 15px;
      border-top: 1px solid #e0e0e0;
    }
    
    .detail-item {
      font-size: 12px;
    }
    
    .detail-label {
      color: #666;
    }
    
    .detail-value {
      color: #1e3c72;
      font-weight: bold;
    }
    
    .alert-time {
      text-align: center;
      margin-top: 10px;
      padding-top: 10px;
      border-top: 1px solid #e0e0e0;
      font-size: 11px;
      color: #999;
    }
    
    .no-alerts {
      grid-column: 1 / -1;
      text-align: center;
      padding: 50px;
      color: rgba(255,255,255,0.5);
      font-size: 18px;
    }
    
    .pulse {
      animation: pulse 2s ease-in-out infinite;
    }
    
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.5; }
    }
    
    .connection-status {
      position: fixed;
      bottom: 20px;
      right: 20px;
      padding: 10px 20px;
      border-radius: 20px;
      font-size: 12px;
      font-weight: bold;
      z-index: 1000;
    }
    
    .connection-status.connected {
      background: #00c853;
      color: white;
    }
    
    .connection-status.disconnected {
      background: #ff5252;
      color: white;
    }