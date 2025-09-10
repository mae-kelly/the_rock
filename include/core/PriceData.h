#pragma once

#include <string>
#include <cstdint>
#include <optional>

namespace stock_monitor {

// Aligned for optimal cache performance
struct alignas(64) PricePoint {
    double price;
    uint64_t timestamp;
    uint64_t volume;
};

struct TradeData {
    std::string symbol;
    double price;
    uint64_t volume;
    uint64_t timestamp;
    std::string exchange;
};

struct QuoteData {
    std::string symbol;
    double bid_price;
    uint64_t bid_size;
    double ask_price;
    uint64_t ask_size;
    uint64_t timestamp;
    std::string exchange;
};

struct StockData {
    std::string symbol;
    double current_price;
    double change_percent;
    double min_price;
    double max_price;
    uint64_t volume;
    uint64_t last_update;
    bool in_threshold;
};

} // namespace stock_monitor