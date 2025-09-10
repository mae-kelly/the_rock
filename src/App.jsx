import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createChart } from 'lightweight-charts';
import './App.css';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:3001';
const WS_URL = process.env.REACT_APP_WS_URL || 'ws://localhost:3001';

function App() {
  const [activeStocks, setActiveStocks] = useState([]);
  const [selectedStock, setSelectedStock] = useState(null);
  const [stats, setStats] = useState({});
  const [connected, setConnected] = useState(false);
  const chartContainerRef = useRef();
  const chartRef = useRef();
  const wsRef = useRef();
  const reconnectTimeoutRef = useRef();

  // WebSocket connection
  const connectWebSocket = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const ws = new WebSocket(WS_URL);
    
    ws.onopen = () => {
      console.log('WebSocket connected');
      setConnected(true);
      
      // Request active stocks
      ws.send(JSON.stringify({ type: 'get-active' }));
      
      // Subscribe to all threshold alerts
      ws.send(JSON.stringify({ 
        type: 'subscribe', 
        symbols: ['*'] // Subscribe to all threshold alerts
      }));
    };
    
    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        handleWebSocketMessage(message);
      } catch (error) {
        console.error('Failed to parse WebSocket message:', error);
      }
    };
    
    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
    };
    
    ws.onclose = () => {
      console.log('WebSocket disconnected');
      setConnected(false);
      
      // Reconnect after 3 seconds
      reconnectTimeoutRef.current = setTimeout(() => {
        connectWebSocket();
      }, 3000);
    };
    
    wsRef.current = ws;
  }, []);

  const handleWebSocketMessage = (message) => {
    switch (message.type) {
      case 'snapshot':
        setActiveStocks(message.data || []);
        break;
        
      case 'threshold-alert':
        handleThresholdAlert(message.data);
        break;
        
      case 'price-update':
        handlePriceUpdate(message.data);
        break;
        
      case 'stats':
        setStats(message.data);
        break;
        
      default:
        break;
    }
  };

  const handleThresholdAlert = (alert) => {
    setActiveStocks(prev => {
      const existing = prev.findIndex(s => s.symbol === alert.symbol);
      if (existing >= 0) {
        const updated = [...prev];
        updated[existing] = alert;
        return updated.sort((a, b) => b.changePercent - a.changePercent);
      } else {
        return [alert, ...prev].sort((a, b) => b.changePercent - a.changePercent);
      }
    });
    
    // Show notification
    if (Notification.permission === 'granted') {
      new Notification(`📈 ${alert.symbol} Alert`, {
        body: `${alert.changePercent.toFixed(2)}% gain detected! Price: $${alert.currentPrice.toFixed(2)}`,
        icon: '/icon.png'
      });
    }
  };

  const handlePriceUpdate = (update) => {
    if (selectedStock && selectedStock.symbol === update.symbol) {
      // Update chart if this stock is selected
      updateChart(update);
    }
  };

  const updateChart = (priceData) => {
    if (!chartRef.current) return;
    
    // Update chart with new price point
    const lineSeries = chartRef.current.series;
    if (lineSeries) {
      lineSeries.update({
        time: Math.floor(priceData.timestamp / 1000),
        value: priceData.price
      });
    }
  };

  // Initialize chart
  useEffect(() => {
    if (chartContainerRef.current && !chartRef.current) {
      const chart = createChart(chartContainerRef.current, {
        width: chartContainerRef.current.clientWidth,
        height: 400,
        layout: {
          background: { color: '#1e1e1e' },
          textColor: '#d1d4dc',
        },
        grid: {
          vertLines: { color: '#2B2B43' },
          horzLines: { color: '#2B2B43' },
        },
        timeScale: {
          borderColor: '#2B2B43',
        },
      });
      
      const lineSeries = chart.addLineSeries({
        color: '#4caf50',
        lineWidth: 2,
      });
      
      chartRef.current = { chart, series: lineSeries };
      
      // Handle resize
      const handleResize = () => {
        chart.applyOptions({
          width: chartContainerRef.current.clientWidth,
        });
      };
      
      window.addEventListener('resize', handleResize);
      
      return () => {
        window.removeEventListener('resize', handleResize);
        chart.remove();
      };
    }
  }, []);

  // Connect WebSocket on mount
  useEffect(() => {
    connectWebSocket();
    
    // Request notification permission
    if (Notification.permission === 'default') {
      Notification.requestPermission();
    }
    
    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [connectWebSocket]);

  // Load stock history when selected
  const loadStockHistory = async (symbol) => {
    try {
      const response = await fetch(`${API_URL}/api/stocks/${symbol}/history?minutes=120`);
      const data = await response.json();
      
      if (data.success && chartRef.current) {
        const chartData = data.data.map(point => ({
          time: Math.floor(point.timestamp / 1000),
          value: point.price
        }));
        
        chartRef.current.series.setData(chartData);
      }
    } catch (error) {
      console.error('Failed to load stock history:', error);
    }
  };

  const selectStock = (stock) => {
    setSelectedStock(stock);
    loadStockHistory(stock.symbol);
  };

  const formatTime = (timestamp) => {
    return new Date(timestamp).toLocaleTimeString();
  };

  const formatPrice = (price) => {
    return `${price.toFixed(2)}`;
  };

  const formatPercent = (percent) => {
    return `${percent >= 0 ? '+' : ''}${percent.toFixed(2)}%`;
  };

  return (
    <div className="app">
      <header className="app-header">
        <h1>🚀 Stock Momentum Scanner</h1>
        <div className="connection-status">
          <span className={`status-dot ${connected ? 'connected' : 'disconnected'}`}></span>
          {connected ? 'Live' : 'Connecting...'}
        </div>
      </header>

      <div className="stats-bar">
        <div className="stat">
          <span className="stat-label">Active Stocks:</span>
          <span className="stat-value">{activeStocks.length}</span>
        </div>
        <div className="stat">
          <span className="stat-label">Total Monitored:</span>
          <span className="stat-value">{stats.totalStocks || 0}</span>
        </div>
        <div className="stat">
          <span className="stat-label">Updates/sec:</span>
          <span className="stat-value">{stats.updatesPerSecond || 0}</span>
        </div>
        <div className="stat">
          <span className="stat-label">Avg Latency:</span>
          <span className="stat-value">{stats.avgProcessingTime || 0}μs</span>
        </div>
      </div>

      <div className="main-content">
        <div className="stocks-panel">
          <h2>Stocks in 9-13% Range</h2>
          <div className="stocks-list">
            {activeStocks.length === 0 ? (
              <div className="no-stocks">
                <p>No stocks currently in threshold range</p>
                <p className="sub-text">Monitoring for 9-13% gains...</p>
              </div>
            ) : (
              activeStocks.map(stock => (
                <div
                  key={stock.symbol}
                  className={`stock-card ${selectedStock?.symbol === stock.symbol ? 'selected' : ''}`}
                  onClick={() => selectStock(stock)}
                >
                  <div className="stock-header">
                    <span className="stock-symbol">{stock.symbol}</span>
                    <span className={`stock-change ${stock.changePercent >= 10 ? 'hot' : ''}`}>
                      {formatPercent(stock.changePercent)}
                    </span>
                  </div>
                  <div className="stock-details">
                    <div className="stock-price">
                      {formatPrice(stock.currentPrice)}
                    </div>
                    <div className="stock-range">
                      Range: {formatPrice(stock.minPrice)} - {formatPrice(stock.maxPrice)}
                    </div>
                    <div className="stock-volume">
                      Vol: {(stock.volume / 1000).toFixed(0)}K
                    </div>
                  </div>
                  <div className="stock-actions">
                    <a
                      href={stock.webullUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="webull-link"
                      onClick={(e) => e.stopPropagation()}
                    >
                      Open in Webull →
                    </a>
                  </div>
                  <div className="stock-time">
                    {formatTime(stock.timestamp)}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="chart-panel">
          <h2>
            {selectedStock ? `${selectedStock.symbol} - Live Chart` : 'Select a Stock'}
          </h2>
          <div ref={chartContainerRef} className="chart-container"></div>
          {selectedStock && (
            <div className="chart-info">
              <div className="info-row">
                <span>Current Price:</span>
                <strong>{formatPrice(selectedStock.currentPrice)}</strong>
              </div>
              <div className="info-row">
                <span>Change:</span>
                <strong className={selectedStock.changePercent >= 10 ? 'hot' : ''}>
                  {formatPercent(selectedStock.changePercent)}
                </strong>
              </div>
              <div className="info-row">
                <span>2-Min Range:</span>
                <strong>
                  {formatPrice(selectedStock.minPrice)} - {formatPrice(selectedStock.maxPrice)}
                </strong>
              </div>
              <div className="info-row">
                <span>Volume:</span>
                <strong>{selectedStock.volume.toLocaleString()}</strong>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default App;