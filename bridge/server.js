import net from 'net';
import { EventEmitter } from 'events';
import { Logger } from '../src/utils/Logger.js';

/**
 * Bridge between C++ engine and Node.js services
 * Communicates via TCP socket with the C++ engine
 */
export class CppEngineBridge extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.host = options.host || 'localhost';
    this.port = options.port || 8080;
    this.reconnectInterval = options.reconnectInterval || 5000;
    this.logger = new Logger('CppBridge');
    
    this.socket = null;
    this.connected = false;
    this.buffer = '';
  }
  
  connect() {
    return new Promise((resolve, reject) => {
      this.socket = new net.Socket();
      
      this.socket.connect(this.port, this.host, () => {
        this.connected = true;
        this.logger.info(`Connected to C++ engine at ${this.host}:${this.port}`);
        resolve();
      });
      
      this.socket.on('data', (data) => {
        this.handleData(data);
      });
      
      this.socket.on('error', (error) => {
        this.logger.error('Socket error:', error);
        this.connected = false;
        reject(error);
      });
      
      this.socket.on('close', () => {
        this.logger.warn('Connection to C++ engine closed');
        this.connected = false;
        this.emit('disconnected');
        
        // Auto-reconnect
        setTimeout(() => {
          if (!this.connected) {
            this.connect().catch(() => {});
          }
        }, this.reconnectInterval);
      });
    });
  }
  
  handleData(data) {
    this.buffer += data.toString();
    
    // Process complete messages (delimited by newline)
    let lines = this.buffer.split('\n');
    this.buffer = lines.pop() || '';
    
    for (const line of lines) {
      if (line.trim()) {
        try {
          const message = JSON.parse(line);
          this.processMessage(message);
        } catch (error) {
          this.logger.error('Failed to parse message:', error);
        }
      }
    }
  }
  
  processMessage(message) {
    switch (message.type) {
      case 'alert':
        this.emit('threshold-detected', message.data);
        break;
        
      case 'update':
        this.emit('price-update', message.data);
        break;
        
      case 'stats':
        this.emit('stats', message.data);
        break;
        
      case 'response':
        this.emit(`response-${message.id}`, message.data);
        break;
        
      default:
        this.logger.warn('Unknown message type:', message.type);
    }
  }
  
  // Send command to C++ engine
  sendCommand(command, data = {}) {
    return new Promise((resolve, reject) => {
      if (!this.connected) {
        reject(new Error('Not connected to C++ engine'));
        return;
      }
      
      const id = Date.now().toString();
      const message = JSON.stringify({
        id,
        command,
        data
      }) + '\n';
      
      // Setup response listener
      const timeout = setTimeout(() => {
        this.removeListener(`response-${id}`, responseHandler);
        reject(new Error('Command timeout'));
      }, 5000);
      
      const responseHandler = (data) => {
        clearTimeout(timeout);
        resolve(data);
      };
      
      this.once(`response-${id}`, responseHandler);
      
      // Send command
      this.socket.write(message, (error) => {
        if (error) {
          clearTimeout(timeout);
          this.removeListener(`response-${id}`, responseHandler);
          reject(error);
        }
      });
    });
  }
  
  // API methods
  async getActiveStocks() {
    return this.sendCommand('get_active_stocks');
  }
  
  async getStockData(symbol) {
    return this.sendCommand('get_stock_data', { symbol });
  }
  
  async getStats() {
    return this.sendCommand('get_stats');
  }
  
  async subscribe(symbols) {
    return this.sendCommand('subscribe', { symbols });
  }
  
  async unsubscribe(symbols) {
    return this.sendCommand('unsubscribe', { symbols });
  }
  
  disconnect() {
    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
      this.connected = false;
    }
  }
}