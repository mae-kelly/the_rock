#include <iostream>
#include <csignal>
#include <atomic>
#include <thread>
#include <cstdlib>
#include "core/StockMonitor.h"
#include "network/AlpacaWebSocket.h"
#include "network/ClientServer.h"
#include <boost/program_options.hpp>

namespace po = boost::program_options;
using namespace stock_monitor;

std::atomic<bool> g_running{true};

void signal_handler(int signal) {
    std::cout << "\nReceived signal " << signal << ", shutting down..." << std::endl;
    g_running = false;
}

int main(int argc, char* argv[]) {
    // Parse command line arguments
    po::options_description desc("Stock Monitor Engine Options");
    desc.add_options()
        ("help,h", "Show help message")
        ("key", po::value<std::string>()->required(), "Alpaca API key")
        ("secret", po::value<std::string>()->required(), "Alpaca secret key")
        ("port,p", po::value<int>()->default_value(8080), "Server port")
        ("threshold-min", po::value<double>()->default_value(9.0), "Min threshold %")
        ("threshold-max", po::value<double>()->default_value(13.0), "Max threshold %")
        ("buffer-size", po::value<size_t>()->default_value(120), "Price buffer size")
        ("max-stocks", po::value<size_t>()->default_value(10000), "Max stocks to track");
    
    po::variables_map vm;
    
    try {
        po::store(po::parse_command_line(argc, argv, desc), vm);
        
        if (vm.count("help")) {
            std::cout << desc << std::endl;
            return 0;
        }
        
        po::notify(vm);
    } catch (const po::error& e) {
        std::cerr << "Error: " << e.what() << std::endl;
        std::cerr << desc << std::endl;
        return 1;
    }
    
    // Setup signal handlers
    std::signal(SIGINT, signal_handler);
    std::signal(SIGTERM, signal_handler);
    
    try {
        // Configure stock monitor
        StockMonitor::Config config;
        config.buffer_size = vm["buffer-size"].as<size_t>();
        config.threshold_min = vm["threshold-min"].as<double>();
        config.threshold_max = vm["threshold-max"].as<double>();
        config.max_stocks = vm["max-stocks"].as<size_t>();
        
        std::cout << "Starting Stock Monitor Engine" << std::endl;
        std::cout << "Configuration:" << std::endl;
        std::cout << "  Buffer size: " << config.buffer_size << std::endl;
        std::cout << "  Threshold: " << config.threshold_min << "% - " 
                  << config.threshold_max << "%" << std::endl;
        std::cout << "  Max stocks: " << config.max_stocks << std::endl;
        
        // Create stock monitor
        auto monitor = std::make_unique<StockMonitor>(config);
        
        // Setup alert callback
        monitor->set_alert_callback([](const StockMonitor::AlertData& alert) {
            std::cout << "[ALERT] " << alert.symbol 
                     << " changed " << alert.change_percent << "%"
                     << " (price: $" << alert.current_price << ")"
                     << " Link: " << alert.webull_url << std::endl;
        });
        
        // Create client server for Node.js communication
        ClientServer server(vm["port"].as<int>(), monitor.get());
        server.start();
        
        std::cout << "Server listening on port " << vm["port"].as<int>() << std::endl;
        
        // Connect to Alpaca
        AlpacaWebSocket alpaca(
            vm["key"].as<std::string>(),
            vm["secret"].as<std::string>(),
            monitor.get()
        );
        
        std::cout << "Connecting to Alpaca..." << std::endl;
        alpaca.connect();
        std::cout << "Connected to Alpaca data stream" << std::endl;
        
        // Get tradeable symbols (in production, fetch from Alpaca API)
        std::vector<std::string> symbols = {
            "AAPL", "MSFT", "GOOGL", "AMZN", "META", "TSLA", "NVDA", 
            "AMD", "SPY", "QQQ", "NFLX", "INTC", "CSCO", "ADBE", "PYPL",
            "CRM", "ORCL", "IBM", "QCOM", "TXN", "AVGO", "MU", "AMAT"
            // In production, fetch all tradeable symbols from Alpaca
        };
        
        std::cout << "Subscribing to " << symbols.size() << " symbols..." << std::endl;
        alpaca.subscribe(symbols);
        
        // Main loop - print stats every 10 seconds
        auto last_stats_time = std::chrono::steady_clock::now();
        
        while (g_running) {
            std::this_thread::sleep_for(std::chrono::seconds(1));
            
            auto now = std::chrono::steady_clock::now();
            if (now - last_stats_time >= std::chrono::seconds(10)) {
                auto stats = monitor->get_stats();
                
                std::cout << "\n=== Performance Stats ===" << std::endl;
                std::cout << "Total stocks tracked: " << stats.total_stocks << std::endl;
                std::cout << "Stocks in threshold: " << stats.threshold_stocks << std::endl;
                std::cout << "Updates/second: " << stats.updates_per_second << std::endl;
                std::cout << "Avg processing time: " << stats.avg_processing_time_us << " μs" << std::endl;
                std::cout << "Memory usage: " << (stats.memory_usage_bytes / 1024.0 / 1024.0) 
                         << " MB" << std::endl;
                std::cout << "========================\n" << std::endl;
                
                last_stats_time = now;
            }
        }
        
        std::cout << "Shutting down..." << std::endl;
        
        // Cleanup
        alpaca.disconnect();
        server.stop();
        
    } catch (const std::exception& e) {
        std::cerr << "Fatal error: " << e.what() << std::endl;
        return 1;
    }
    
    std::cout << "Shutdown complete" << std::endl;
    return 0;
}