#pragma once

#include <vector>
#include <atomic>
#include <cstring>
#include <algorithm>

namespace stock_monitor {

template<typename T>
class CircularBuffer {
public:
    explicit CircularBuffer(size_t capacity)
        : capacity_(capacity)
        , buffer_(capacity)
        , head_(0)
        , tail_(0)
        , size_(0) {
    }
    
    void push(const T& item) {
        buffer_[tail_] = item;
        tail_ = (tail_ + 1) % capacity_;
        
        if (size_ == capacity_) {
            head_ = (head_ + 1) % capacity_;
        } else {
            size_++;
        }
    }
    
    // Optimized push for POD types using memcpy
    template<typename U = T>
    typename std::enable_if<std::is_trivially_copyable<U>::value>::type
    push_fast(const T& item) {
        std::memcpy(&buffer_[tail_], &item, sizeof(T));
        tail_ = (tail_ + 1) % capacity_;
        
        if (size_ == capacity_) {
            head_ = (head_ + 1) % capacity_;
        } else {
            size_++;
        }
    }
    
    std::vector<T> get_all() const {
        std::vector<T> result;
        result.reserve(size_);
        
        size_t current = head_;
        for (size_t i = 0; i < size_; ++i) {
            result.push_back(buffer_[current]);
            current = (current + 1) % capacity_;
        }
        
        return result;
    }
    
    std::vector<T> get_recent(size_t n) const {
        n = std::min(n, size_);
        std::vector<T> result;
        result.reserve(n);
        
        size_t start = (tail_ + capacity_ - n) % capacity_;
        for (size_t i = 0; i < n; ++i) {
            result.push_back(buffer_[(start + i) % capacity_]);
        }
        
        return result;
    }
    
    // Direct access for performance-critical code
    const T* data() const { return buffer_.data(); }
    
    size_t size() const { return size_; }
    size_t capacity() const { return capacity_; }
    bool empty() const { return size_ == 0; }
    bool full() const { return size_ == capacity_; }
    
    void clear() {
        head_ = 0;
        tail_ = 0;
        size_ = 0;
    }
    
private:
    size_t capacity_;
    std::vector<T> buffer_;
    size_t head_;
    size_t tail_;
    size_t size_;
};

} // namespace stock_monitor