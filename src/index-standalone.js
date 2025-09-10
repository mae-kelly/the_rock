/**
 * Standalone Node.js version of the stock monitor
 * This version doesn't require the C++ engine and can run directly on macOS
 */

import dotenv from 'dotenv';
import express from 'express';
import cors from 'cors';
import compression from 'compression';
import helmet from 'helmet';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { StockMonitor } from './core/StockMonitor.js';
import { AlpacaDataStream } from './services/AlpacaDataStream.js';
import { RedisCache } from './services/RedisCache.js';
import { WebSocketManager } from './services/WebSocketManager.js';
import { CircuitBreaker } from './utils/CircuitBreaker.js';
import { Logger } from './utils/Logger.js';
import { MetricsCollector } from './utils/MetricsCollector.js';
import apiRoutes from './routes/api.js';

dotenv.config();

console.log(`
╔════════════════════════════════════════════════════════════╗
║                                                            ║
║        🚀 STOCK MOMENTUM SCANNER - NODE.JS VERSION        ║
║                                                            ║
║        Detecting 9-13% gains in real-time                 ║
║        Running on macOS without C++ engine                ║
║                                                            ║
╚════════════════════════════════════════════════════════════╝
`);

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });
const logger = new Logger('Main');
const metrics = new MetricsCollector();

// Middleware
app.use(helmet());
app.use(compression());
app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
  credentials: true
}));
app.use(express.json());

// Serve static files from React build
app.use(express.static('client/build'));

// Initialize services
logger.info('Initializing services...');

const redisCache = new RedisCache({
  host: process.env.REDIS_HOST || 'localhost',
  port: process.env.REDIS_PORT || 6379,
  password: process.env.REDIS_PASSWORD,
  db: process.env.REDIS_DB || 0
});

const stockMonitor = new StockMonitor({
  bufferSize: parseInt(process.env.PRICE_BUFFER_SIZE) || 120,
  thresholdMin: parseFloat(process.env.DETECTION_THRESHOLD_MIN) || 9.0,
  thresholdMax: parseFloat(process.env.DETECTION_THRESHOLD_MAX) || 13.0,
  cache: redisCache,
  metrics
});

const alpacaStream = new AlpacaDataStream({
  keyId: process.env.ALPACA_KEY_ID,
  secretKey: process.env.ALPACA_SECRET_KEY,
  dataUrl: process.env.ALPACA_DATA_URL || 'wss://stream.data.alpaca.markets/v2/sip',
  onData: (data) => stockMonitor.processUpdate(data),
  circuitBreaker: new CircuitBreaker({ threshold: 5, timeout: 60000 })
});

const wsManager = new WebSocketManager(wss, {
  heartbeatInterval: parseInt(process.env.WEBSOCKET_HEARTBEAT_INTERVAL) || 30000,
  maxConnectionsPerIp: parseInt(process.env.MAX_CONNECTIONS_PER_IP) || 10
});

// API Routes
app.use('/api', apiRoutes({ stockMonitor, wsManager, metrics }));

// Health check endpoint
app.get('/health', (req, res) => {
  const health = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    services: {
      redis: redisCache.isConnected(),
      alpaca: alpacaStream.isConnected(),
      websocket: wsManager.getConnectionCount() > 0
    },
    metrics: metrics.getSnapshot(),
    platform: process.platform,
    nodeVersion: process.version,
    memory: process.memoryUsage()
  };
  
  const statusCode = Object.values(health.services).every(s => s !== false) ? 200 : 503;
  res.status(statusCode).json(health);
});

// Metrics endpoint (Prometheus format)
app.get('/metrics', (req, res) => {
  res.type('text/plain');
  res.send(metrics.getPrometheusFormat());
});

// System info endpoint
app.get('/api/system', (req, res) => {
  const stats = stockMonitor.getStats();
  res.json({
    platform: 'Node.js Standalone',
    version: '1.0.0',
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    stockStats: stats,
    connections: wsManager.getConnectionCount()
  });
});

// WebSocket connection handler
wsManager.on('connection', (client) => {
  logger.info(`New WebSocket connection: ${client.id}`);
  
  // Send initial snapshot of active stocks
  const activeStocks = stockMonitor.getActiveStocks();
  client.send(JSON.stringify({
    type: 'snapshot',
    data: activeStocks,
    timestamp: Date.now()
  }));
  
  // Send system info
  client.send(JSON.stringify({
    type: 'system',
    data: {
      platform: 'Node.js',
      thresholdMin: process.env.DETECTION_THRESHOLD_MIN || 9.0,
      thresholdMax: process.env.DETECTION_THRESHOLD_MAX || 13.0
    }
  }));
});

// Stock monitor event handlers
stockMonitor.on('threshold-detected', (data) => {
  logger.info(`🎯 Threshold detected for ${data.symbol}: ${data.changePercent.toFixed(2)}%`);
  
  // Broadcast to all connected clients
  wsManager.broadcast({
    type: 'threshold-alert',
    data,
    timestamp: Date.now()
  });
  
  // Store in Redis for persistence
  redisCache.addAlert(data);
  
  // Update metrics
  metrics.increment('alerts.triggered');
  
  // Console output for monitoring
  console.log(`
  ┌────────────────────────────────────┐
  │  🚨 ALERT: ${data.symbol.padEnd(5)} @ ${data.changePercent.toFixed(2)}%
  │  Price: $${data.currentPrice.toFixed(2)}
  │  Range: $${data.minPrice.toFixed(2)} - $${data.maxPrice.toFixed(2)}
  │  Link: ${data.webullUrl}
  └────────────────────────────────────┘
  `);
});

stockMonitor.on('update', (data) => {
  // Broadcast price updates to subscribers
  wsManager.broadcastToSubscribers(data.symbol, {
    type: 'price-update',
    data,
    timestamp: Date.now()
  });
  
  metrics.increment('updates.processed');
});

// Graceful shutdown
const shutdown = async (signal) => {
  logger.info(`Received ${signal}, starting graceful shutdown`);
  
  console.log('\n🛑 Shutting down gracefully...');
  
  try {
    // Stop accepting new connections
    server.close();
    
    // Close WebSocket connections
    wsManager.closeAll();
    
    // Disconnect from data streams
    await alpacaStream.disconnect();
    
    // Close Redis connection
    await redisCache.disconnect();
    
    logger.info('Graceful shutdown complete');
    console.log('✅ Shutdown complete');
    process.exit(0);
  } catch (error) {
    logger.error('Error during shutdown:', error);
    process.exit(1);
  }
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Performance monitoring
setInterval(() => {
  const stats = stockMonitor.getStats();
  const mem = process.memoryUsage();
  
  console.log(`
📊 Performance Stats:
  • Active Stocks: ${stats.thresholdStocks}
  • Total Monitored: ${stats.totalStocks}
  • Memory: ${Math.round(mem.heapUsed / 1024 / 1024)}MB / ${Math.round(mem.heapTotal / 1024 / 1024)}MB
  • Uptime: ${Math.round(process.uptime() / 60)} minutes
  `);
}, 60000); // Every minute

// Start server
const PORT = process.env.PORT || 3001;

async function start() {
  try {
    console.log('🔧 Starting services...\n');
    
    // Connect to Redis
    console.log('📦 Connecting to Redis...');
    await redisCache.connect();
    logger.info('Connected to Redis');
    console.log('✅ Redis connected\n');
    
    // Connect to Alpaca data stream
    console.log('📡 Connecting to Alpaca data stream...');
    console.log('   Using: ' + (process.env.ALPACA_DATA_URL || 'wss://stream.data.alpaca.markets/v2/sip'));
    
    if (!process.env.ALPACA_KEY_ID || !process.env.ALPACA_SECRET_KEY) {
      console.error('❌ ERROR: Alpaca API credentials not found!');
      console.error('   Please add ALPACA_KEY_ID and ALPACA_SECRET_KEY to your .env file');
      console.error('   Get your API keys at: https://alpaca.markets/');
      process.exit(1);
    }
    
    await alpacaStream.connect();
    logger.info('Connected to Alpaca data stream');
    console.log('✅ Alpaca connected\n');
    
    // Get tradeable symbols
    console.log('📊 Loading tradeable symbols...');
    const symbols = await alpacaStream.getAllSymbols();
    console.log(`✅ Found ${symbols.length} tradeable symbols\n`);
    
    // Subscribe to symbols
    console.log('📈 Subscribing to market data...');
    await alpacaStream.subscribe(symbols);
    logger.info(`Subscribed to ${symbols.length} symbols`);
    console.log(`✅ Subscribed to ${symbols.length} symbols\n`);
    
    // Start HTTP server
    server.listen(PORT, () => {
      logger.info(`Server running on port ${PORT}`);
      console.log(`
╔════════════════════════════════════════════════════════════╗
║                                                            ║
║                    ✅ SYSTEM READY                        ║
║                                                            ║
║   API Server:    http://localhost:${PORT}                    ║
║   WebSocket:     ws://localhost:${PORT}                      ║
║   Health Check:  http://localhost:${PORT}/health             ║
║                                                            ║
║   Monitoring ${symbols.length.toString().padEnd(4)} stocks for 9-13% gains           ║
║                                                            ║
╚════════════════════════════════════════════════════════════╝
      `);
      
      if (process.platform === 'darwin') {
        console.log('💡 Tip: On macOS, you can use the Activity Monitor to track performance\n');
      }
    });
    
    // Start metrics collection
    metrics.startCollection();
    
  } catch (error) {
    logger.error('Failed to start application:', error);
    console.error('❌ Failed to start:', error.message);
    
    if (error.message.includes('Redis')) {
      console.error('\n💡 Tip: Make sure Redis is running:');
      console.error('   brew services start redis\n');
    }
    
    process.exit(1);
  }
}

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception:', error);
  console.error('❌ Uncaught exception:', error);
  shutdown('EXCEPTION');
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled rejection at:', promise, 'reason:', reason);
  console.error('❌ Unhandled rejection:', reason);
});

// Start the application
start();