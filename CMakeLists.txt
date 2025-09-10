cmake_minimum_required(VERSION 3.20)
project(StockMonitorEngine VERSION 1.0.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

# Optimization flags for production
set(CMAKE_CXX_FLAGS_RELEASE "-O3 -march=native -mtune=native -flto -ffast-math -funroll-loops -fprefetch-loop-arrays")
set(CMAKE_CXX_FLAGS_RELEASE "${CMAKE_CXX_FLAGS_RELEASE} -DNDEBUG -Wall -Wextra -Wpedantic")

# Enable AVX2 for SIMD operations
set(CMAKE_CXX_FLAGS "${CMAKE_CXX_FLAGS} -mavx2 -mfma")

# Find required packages
find_package(Threads REQUIRED)
find_package(Boost 1.75 REQUIRED COMPONENTS system thread chrono)

# Include directories
include_directories(${CMAKE_CURRENT_SOURCE_DIR}/include)
include_directories(${Boost_INCLUDE_DIRS})

# External libraries
include(FetchContent)

# JSON library
FetchContent_Declare(
    json
    GIT_REPOSITORY https://github.com/nlohmann/json.git
    GIT_TAG v3.11.3
)
FetchContent_MakeAvailable(json)

# WebSocket++ library
FetchContent_Declare(
    websocketpp
    GIT_REPOSITORY https://github.com/zaphoyd/websocketpp.git
    GIT_TAG 0.8.2
)
FetchContent_MakeAvailable(websocketpp)

# Source files
set(SOURCES
    src/main.cpp
    src/core/StockMonitor.cpp
    src/core/CircularBuffer.cpp
    src/core/PriceProcessor.cpp
    src/network/AlpacaWebSocket.cpp
    src/network/ClientManager.cpp
    src/utils/MemoryPool.cpp
    src/utils/ThreadPool.cpp
)

# Create executable
add_executable(stock_monitor_engine ${SOURCES})

# Link libraries
target_link_libraries(stock_monitor_engine
    PRIVATE
    Threads::Threads
    ${Boost_LIBRARIES}
    nlohmann_json::nlohmann_json
)

# Enable link-time optimization
set_property(TARGET stock_monitor_engine PROPERTY INTERPROCEDURAL_OPTIMIZATION TRUE)

# Install target
install(TARGETS stock_monitor_engine DESTINATION bin)