# Build stage
FROM ubuntu:22.04 AS builder

# Install build dependencies
RUN apt-get update && apt-get install -y \
    build-essential \
    cmake \
    g++ \
    libboost-all-dev \
    libssl-dev \
    git \
    wget \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /build

# Copy source files
COPY CMakeLists.txt .
COPY include/ include/
COPY src/ src/

# Build the application
RUN cmake -B build -DCMAKE_BUILD_TYPE=Release \
    && cmake --build build -j$(nproc)

# Runtime stage
FROM ubuntu:22.04

# Install runtime dependencies
RUN apt-get update && apt-get install -y \
    libboost-system1.74.0 \
    libboost-thread1.74.0 \
    libboost-chrono1.74.0 \
    libboost-program-options1.74.0 \
    libssl3 \
    netcat \
    && rm -rf /var/lib/apt/lists/*

# Create non-root user
RUN useradd -m -s /bin/bash stockmonitor

# Copy built binary
COPY --from=builder /build/build/stock_monitor_engine /usr/local/bin/

# Set ownership
RUN chown stockmonitor:stockmonitor /usr/local/bin/stock_monitor_engine

# Switch to non-root user
USER stockmonitor

# Expose port
EXPOSE 8080

# Set entrypoint
ENTRYPOINT ["/usr/local/bin/stock_monitor_engine"]