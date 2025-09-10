#pragma once

#include <atomic>
#include <unordered_map>
#include <shared_mutex>
#include <memory>
#include <vector>
#include <immintrin.h> // For AVX2
#include "CircularBuffer.h"
#include "PriceData.h"

namespace stock_monitor {

class StockMonitor {
public:
    struct Config {
        size_t buffer_size = 120;  // 2 minutes at 1-second intervals
        double threshold_min = 9.0;
        double threshold_max = 13.0;
        size_t max_stocks = 10000;
        size_t cleanup_interval_ms = 60000;
    };

    struct AlertData {
        std::string symbol;
        double change_percent;
        double current_price;
        double min_price;
        double max_price;
        uint64_t volume;
        uint64_t timestamp;
        std::string webull_url;
    };

    explicit StockMonitor(const Config& config);
    ~StockMonitor();

    // Process incoming price update (thread-safe)
    void process_trade(const TradeData& trade);
    void process_quote(const QuoteData& quote);
    
    // Get stocks currently in threshold range
    std::vector<AlertData> get_active_stocks() const;
    
    // Get specific stock data
    std::optional<StockData> get_stock_data(const std::string& symbol) const;
    
    // Statistics
    struct Stats {
        size_t total_stocks;
        size_t threshold_stocks;
        size_t updates_per_second;
        double avg_processing_time_us;
        size_t memory_usage_bytes;
    };
    Stats get_stats() const;

    // Callbacks for alerts
    using AlertCallback = std::function<void(const AlertData&)>;
    void set_alert_callback(AlertCallback callback);

private:
    struct StockBuffer {
        CircularBuffer<PricePoint> buffer;
        std::atomic<uint64_t> last_update;
        std::atomic<double> last_price;
        mutable std::shared_mutex mutex;
        
        explicit StockBuffer(size_t capacity) 
            : buffer(capacity), last_update(0), last_price(0.0) {}
    };

    Config config_;
    
    // Lock-free hash map for stock buffers
    mutable std::shared_mutex stocks_mutex_;
    std::unordered_map<std::string, std::unique_ptr<StockBuffer>> stock_buffers_;
    
    // Threshold tracking
    mutable std::shared_mutex threshold_mutex_;
    std::unordered_map<std::string, AlertData> threshold_stocks_;
    
    // Performance metrics
    std::atomic<uint64_t> total_updates_{0};
    std::atomic<uint64_t> total_processing_time_ns_{0};
    std::atomic<uint64_t> updates_last_second_{0};
    
    // Alert callback
    AlertCallback alert_callback_;
    
    // SIMD-optimized analysis
    bool analyze_buffer_simd(const StockBuffer& buffer, 
                             double& change_percent,
                             double& min_price,
                             double& max_price,
                             double& current_price) const;
    
    // Generate Webull link
    std::string generate_webull_link(const std::string& symbol, 
                                     const std::string& exchange) const;
    
    // Cleanup thread
    void cleanup_inactive_stocks();
    std::atomic<bool> running_{true};
    std::thread cleanup_thread_;
};

// SIMD-optimized price calculations
class PriceCalculator {
public:
    // Process 8 prices simultaneously using AVX2
    static void calculate_min_max_avx2(const double* prices, 
                                       size_t count,
                                       double& min_out, 
                                       double& max_out);
    
    // Calculate percentage changes for multiple stocks in parallel
    static void batch_calculate_changes(const std::vector<double>& current_prices,
                                        const std::vector<double>& min_prices,
                                        std::vector<double>& changes_out);
};

} // namespace stock_monitor