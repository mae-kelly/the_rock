#include "core/StockMonitor.h"
#include <chrono>
#include <algorithm>
#include <cmath>
#include <immintrin.h>

namespace stock_monitor {

using namespace std::chrono;

StockMonitor::StockMonitor(const Config& config) 
    : config_(config) {
    // Reserve space for expected number of stocks
    stock_buffers_.reserve(config.max_stocks);
    
    // Start cleanup thread
    cleanup_thread_ = std::thread([this] {
        while (running_) {
            std::this_thread::sleep_for(milliseconds(config_.cleanup_interval_ms));
            cleanup_inactive_stocks();
        }
    });
}

StockMonitor::~StockMonitor() {
    running_ = false;
    if (cleanup_thread_.joinable()) {
        cleanup_thread_.join();
    }
}

void StockMonitor::process_trade(const TradeData& trade) {
    auto start_time = high_resolution_clock::now();
    
    // Get or create buffer for this stock
    StockBuffer* buffer = nullptr;
    {
        std::shared_lock read_lock(stocks_mutex_);
        auto it = stock_buffers_.find(trade.symbol);
        if (it != stock_buffers_.end()) {
            buffer = it->second.get();
        }
    }
    
    if (!buffer) {
        std::unique_lock write_lock(stocks_mutex_);
        // Double-check after acquiring write lock
        auto it = stock_buffers_.find(trade.symbol);
        if (it == stock_buffers_.end()) {
            auto new_buffer = std::make_unique<StockBuffer>(config_.buffer_size);
            buffer = new_buffer.get();
            stock_buffers_[trade.symbol] = std::move(new_buffer);
        } else {
            buffer = it->second.get();
        }
    }
    
    // Add price to buffer
    {
        std::unique_lock buffer_lock(buffer->mutex);
        buffer->buffer.push(PricePoint{
            trade.price,
            trade.timestamp,
            trade.volume
        });
        buffer->last_update = duration_cast<milliseconds>(
            system_clock::now().time_since_epoch()).count();
        buffer->last_price = trade.price;
    }
    
    // Analyze buffer using SIMD
    double change_percent, min_price, max_price, current_price;
    bool in_threshold = false;
    
    {
        std::shared_lock buffer_lock(buffer->mutex);
        if (analyze_buffer_simd(*buffer, change_percent, min_price, max_price, current_price)) {
            in_threshold = (change_percent >= config_.threshold_min && 
                           change_percent <= config_.threshold_max);
        }
    }
    
    // Handle threshold detection
    if (in_threshold) {
        AlertData alert{
            trade.symbol,
            change_percent,
            current_price,
            min_price,
            max_price,
            trade.volume,
            static_cast<uint64_t>(duration_cast<milliseconds>(
                system_clock::now().time_since_epoch()).count()),
            generate_webull_link(trade.symbol, trade.exchange)
        };
        
        {
            std::unique_lock threshold_lock(threshold_mutex_);
            auto it = threshold_stocks_.find(trade.symbol);
            bool is_new = (it == threshold_stocks_.end());
            bool significant_change = false;
            
            if (!is_new) {
                significant_change = std::abs(it->second.change_percent - change_percent) > 0.1;
            }
            
            if (is_new || significant_change) {
                threshold_stocks_[trade.symbol] = alert;
                
                // Trigger callback
                if (alert_callback_) {
                    alert_callback_(alert);
                }
            }
        }
    } else {
        // Remove from threshold if no longer in range
        std::unique_lock threshold_lock(threshold_mutex_);
        threshold_stocks_.erase(trade.symbol);
    }
    
    // Update metrics
    auto end_time = high_resolution_clock::now();
    auto processing_time = duration_cast<nanoseconds>(end_time - start_time).count();
    
    total_updates_.fetch_add(1, std::memory_order_relaxed);
    total_processing_time_ns_.fetch_add(processing_time, std::memory_order_relaxed);
    updates_last_second_.fetch_add(1, std::memory_order_relaxed);
}

void StockMonitor::process_quote(const QuoteData& quote) {
    // Convert quote to trade using mid-price
    TradeData trade{
        quote.symbol,
        (quote.bid_price + quote.ask_price) / 2.0,
        quote.bid_size + quote.ask_size,
        quote.timestamp,
        quote.exchange
    };
    process_trade(trade);
}

bool StockMonitor::analyze_buffer_simd(const StockBuffer& buffer,
                                       double& change_percent,
                                       double& min_price,
                                       double& max_price,
                                       double& current_price) const {
    auto data = buffer.buffer.get_recent(120); // Last 2 minutes
    if (data.size() < 10) return false;
    
    // Filter for last 2 minutes
    auto now = duration_cast<milliseconds>(
        system_clock::now().time_since_epoch()).count();
    auto two_minutes_ago = now - 120000;
    
    std::vector<double> prices;
    prices.reserve(data.size());
    
    for (const auto& point : data) {
        if (point.timestamp >= two_minutes_ago) {
            prices.push_back(point.price);
        }
    }
    
    if (prices.size() < 5) return false;
    
    current_price = prices.back();
    
    // Use SIMD to find min/max
    PriceCalculator::calculate_min_max_avx2(
        prices.data(), prices.size(), min_price, max_price);
    
    // Calculate percentage change
    if (min_price > 0) {
        change_percent = ((current_price - min_price) / min_price) * 100.0;
    } else {
        change_percent = 0.0;
    }
    
    return true;
}

std::vector<StockMonitor::AlertData> StockMonitor::get_active_stocks() const {
    std::shared_lock lock(threshold_mutex_);
    std::vector<AlertData> result;
    result.reserve(threshold_stocks_.size());
    
    for (const auto& [symbol, alert] : threshold_stocks_) {
        result.push_back(alert);
    }
    
    // Sort by change percentage (descending)
    std::sort(result.begin(), result.end(),
              [](const AlertData& a, const AlertData& b) {
                  return a.change_percent > b.change_percent;
              });
    
    return result;
}

std::string StockMonitor::generate_webull_link(const std::string& symbol,
                                               const std::string& exchange) const {
    static const std::unordered_map<std::string, std::string> exchange_map{
        {"NASDAQ", "nasdaq"},
        {"NYSE", "nyse"},
        {"AMEX", "amex"},
        {"ARCA", "arca"}
    };
    
    auto it = exchange_map.find(exchange);
    std::string mapped_exchange = (it != exchange_map.end()) ? it->second : "nasdaq";
    
    std::string lower_symbol = symbol;
    std::transform(lower_symbol.begin(), lower_symbol.end(), 
                  lower_symbol.begin(), ::tolower);
    
    return "https://www.webull.com/quote/" + mapped_exchange + "-" + lower_symbol;
}

void StockMonitor::cleanup_inactive_stocks() {
    auto now = duration_cast<milliseconds>(
        system_clock::now().time_since_epoch()).count();
    auto inactive_threshold = now - 3600000; // 1 hour
    
    std::vector<std::string> to_remove;
    
    {
        std::shared_lock read_lock(stocks_mutex_);
        for (const auto& [symbol, buffer] : stock_buffers_) {
            if (buffer->last_update.load() < inactive_threshold) {
                to_remove.push_back(symbol);
            }
        }
    }
    
    if (!to_remove.empty()) {
        std::unique_lock write_lock(stocks_mutex_);
        for (const auto& symbol : to_remove) {
            stock_buffers_.erase(symbol);
        }
        
        std::unique_lock threshold_lock(threshold_mutex_);
        for (const auto& symbol : to_remove) {
            threshold_stocks_.erase(symbol);
        }
    }
}

void StockMonitor::set_alert_callback(AlertCallback callback) {
    alert_callback_ = std::move(callback);
}

StockMonitor::Stats StockMonitor::get_stats() const {
    Stats stats;
    
    {
        std::shared_lock lock(stocks_mutex_);
        stats.total_stocks = stock_buffers_.size();
    }
    
    {
        std::shared_lock lock(threshold_mutex_);
        stats.threshold_stocks = threshold_stocks_.size();
    }
    
    uint64_t total_updates = total_updates_.load();
    uint64_t total_time = total_processing_time_ns_.load();
    
    stats.updates_per_second = updates_last_second_.exchange(0);
    stats.avg_processing_time_us = total_updates > 0 ? 
        (total_time / total_updates) / 1000.0 : 0.0;
    
    // Estimate memory usage
    stats.memory_usage_bytes = stats.total_stocks * 
        (sizeof(StockBuffer) + config_.buffer_size * sizeof(PricePoint));
    
    return stats;
}

// SIMD implementation for min/max calculation
void PriceCalculator::calculate_min_max_avx2(const double* prices,
                                             size_t count,
                                             double& min_out,
                                             double& max_out) {
    if (count == 0) return;
    
    __m256d min_vec = _mm256_set1_pd(prices[0]);
    __m256d max_vec = _mm256_set1_pd(prices[0]);
    
    size_t i = 0;
    
    // Process 4 doubles at a time
    for (; i + 3 < count; i += 4) {
        __m256d price_vec = _mm256_loadu_pd(&prices[i]);
        min_vec = _mm256_min_pd(min_vec, price_vec);
        max_vec = _mm256_max_pd(max_vec, price_vec);
    }
    
    // Extract results
    alignas(32) double min_arr[4], max_arr[4];
    _mm256_store_pd(min_arr, min_vec);
    _mm256_store_pd(max_arr, max_vec);
    
    min_out = *std::min_element(min_arr, min_arr + 4);
    max_out = *std::max_element(max_arr, max_arr + 4);
    
    // Process remaining elements
    for (; i < count; ++i) {
        min_out = std::min(min_out, prices[i]);
        max_out = std::max(max_out, prices[i]);
    }
}

void PriceCalculator::batch_calculate_changes(const std::vector<double>& current_prices,
                                              const std::vector<double>& min_prices,
                                              std::vector<double>& changes_out) {
    size_t count = current_prices.size();
    changes_out.resize(count);
    
    size_t i = 0;
    
    // Process 4 calculations at a time using AVX2
    for (; i + 3 < count; i += 4) {
        __m256d current = _mm256_loadu_pd(&current_prices[i]);
        __m256d min = _mm256_loadu_pd(&min_prices[i]);
        
        // Calculate (current - min) / min * 100
        __m256d diff = _mm256_sub_pd(current, min);
        __m256d ratio = _mm256_div_pd(diff, min);
        __m256d hundred = _mm256_set1_pd(100.0);
        __m256d percent = _mm256_mul_pd(ratio, hundred);
        
        _mm256_storeu_pd(&changes_out[i], percent);
    }
    
    // Process remaining elements
    for (; i < count; ++i) {
        changes_out[i] = ((current_prices[i] - min_prices[i]) / min_prices[i]) * 100.0;
    }
}

} // namespace stock_monitor