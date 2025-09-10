import dotenv from 'dotenv';
import express from 'express';
import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import StockMonitor from './core/StockMonitor.js';
import AlpacaDataStream from './services/AlpacaDataStream.js';

dotenv.config();

console.log(`
╔════════════════════════════════════════════════════════════╗
║        🚀 STOCK MOMENTUM SCANNER - STARTING...            ║
╚════════════════════════════════════════════════════════════╝
`);

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

// Initialize stock monitor
const stockMonitor = new StockMonitor({
  thresholdMin: parseFloat(process.env.DETECTION_THRESHOLD_MIN) || 9.0,
  thresholdMax: parseFloat(process.env.DETECTION_THRESHOLD_MAX) || 13.0
});

// Initialize Alpaca stream
const alpacaStream = new AlpacaDataStream({
  keyId: process.env.ALPACA_KEY_ID,
  secretKey: process.env.ALPACA_SECRET_KEY,
  onData: (data) => stockMonitor.processUpdate(data)
});

// WebSocket connections
const clients = new Set();

wss.on('connection', (ws) => {
  clients.add(ws);
  console.log('Client connected. Total clients:', clients.size);
  
  // Send current active stocks
  ws.send(JSON.stringify({
    type: 'snapshot',
    data: stockMonitor.getActiveStocks()
  }));
  
  ws.on('close', () => {
    clients.delete(ws);
    console.log('Client disconnected. Total clients:', clients.size);
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

// Stock monitor events
stockMonitor.on('threshold-detected', (data) => {
  console.log(`
  ┌────────────────────────────────────┐
  │  🚨 ALERT: ${data.symbol.padEnd(5)} @ ${data.changePercent.toFixed(2)}%
  │  Price: $${data.currentPrice.toFixed(2)}
  │  Link: ${data.webullUrl}
  └────────────────────────────────────┘
  `);
  
  broadcast({
    type: 'alert',
    data
  });
});

// Health endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    activeStocks: stockMonitor.getActiveStocks().length,
    connected: alpacaStream.isConnected()
  });
});

// API endpoints
app.get('/api/stocks/active', (req, res) => {
  res.json(stockMonitor.getActiveStocks());
});

// Start server
const PORT = process.env.PORT || 3001;

async function start() {
  try {
    console.log('📡 Connecting to Alpaca...');
    await alpacaStream.connect();
    
    const symbols = await alpacaStream.getAllSymbols();
    console.log(`📊 Found ${symbols.length} tradeable symbols`);
    
    await alpacaStream.subscribe(symbols.slice(0, 100)); // Start with 100 most active
    
    server.listen(PORT, () => {
      console.log(`
╔════════════════════════════════════════════════════════════╗
║                    ✅ SYSTEM READY                        ║
║                                                            ║
║   API Server:    http://localhost:${PORT}                    ║
║   WebSocket:     ws://localhost:${PORT}                      ║
║                                                            ║
╚════════════════════════════════════════════════════════════╝
      `);
    });
  } catch (error) {
    console.error('Failed to start:', error);
    process.exit(1);
  }
}

start();
