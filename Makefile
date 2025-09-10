.PHONY: all build run test clean docker-build docker-up docker-down install dev prod

# Variables
CXX = g++
CMAKE = cmake
NODE = node
NPM = npm
DOCKER = docker
DOCKER_COMPOSE = docker-compose

# Directories
BUILD_DIR = build
CLIENT_DIR = client
DIST_DIR = dist

# Detect OS
UNAME_S := $(shell uname -s)
ifeq ($(UNAME_S),Darwin)
    OS := macOS
else
    OS := Linux
endif

# Default target
all: build

# Install all dependencies
install:
	@echo "Detected OS: $(OS)"
ifeq ($(OS),macOS)
	@echo "Installing dependencies for macOS..."
	@command -v brew >/dev/null 2>&1 || { echo "Homebrew not found. Installing..."; /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"; }
	@echo "Installing C++ dependencies..."
	brew install cmake boost openssl
	@echo "Installing Node.js if needed..."
	brew list node &>/dev/null || brew install node
else
	@echo "Installing dependencies for Linux..."
	sudo apt-get update && sudo apt-get install -y \
		build-essential cmake libboost-all-dev libssl-dev nodejs npm
endif
	@echo "Installing Node.js dependencies..."
	test -d $(CLIENT_DIR) && cd $(CLIENT_DIR) && $(NPM) install || echo "Client directory not found, skipping client dependencies"
	$(NPM) install
	@echo "Dependencies installed successfully"

# Build C++ engine
build-cpp:
	@echo "Building C++ engine..."
	mkdir -p $(BUILD_DIR)
	cd $(BUILD_DIR) && $(CMAKE) .. -DCMAKE_BUILD_TYPE=Release
	cd $(BUILD_DIR) && $(MAKE) -j$(shell nproc)
	@echo "C++ engine built successfully"

# Build Node.js server
build-node:
	@echo "Building Node.js server..."
	$(NPM) run build:server || true
	@echo "Node.js server ready"

# Build React client
build-client:
	@echo "Building React client..."
	cd $(CLIENT_DIR) && $(NPM) run build
	@echo "React client built successfully"

# Build all components
build: build-cpp build-node build-client
	@echo "All components built successfully"

# Run in development mode
dev:
	@echo "Starting development environment..."
	# Start C++ engine in background
	./$(BUILD_DIR)/stock_monitor_engine \
		--key $(ALPACA_KEY_ID) \
		--secret $(ALPACA_SECRET_KEY) \
		--port 8080 &
	# Start Node.js server
	$(NPM) run dev &
	# Start React dev server
	cd $(CLIENT_DIR) && $(NPM) start
	
# Run in production mode
prod:
	@echo "Starting production environment..."
	$(DOCKER_COMPOSE) up -d
	@echo "Production environment started"
	@echo "Access the application at http://localhost:3000"

# Docker commands
docker-build:
	@echo "Building Docker images..."
	$(DOCKER) build -f Dockerfile.cpp -t stock-monitor-cpp .
	$(DOCKER) build -f Dockerfile.node -t stock-monitor-node .
	@echo "Docker images built successfully"

docker-up:
	@echo "Starting Docker containers..."
	$(DOCKER_COMPOSE) up -d
	@echo "Containers started successfully"

docker-down:
	@echo "Stopping Docker containers..."
	$(DOCKER_COMPOSE) down
	@echo "Containers stopped"

docker-logs:
	$(DOCKER_COMPOSE) logs -f

# Testing
test-cpp:
	@echo "Running C++ tests..."
	cd $(BUILD_DIR) && ctest --verbose

test-node:
	@echo "Running Node.js tests..."
	$(NPM) test

test: test-cpp test-node
	@echo "All tests completed"

# Performance benchmark
benchmark:
	@echo "Running performance benchmark..."
	./$(BUILD_DIR)/stock_monitor_engine --benchmark
	
# Clean build artifacts
clean:
	@echo "Cleaning build artifacts..."
	rm -rf $(BUILD_DIR)
	rm -rf $(CLIENT_DIR)/build
	rm -rf node_modules
	rm -rf $(CLIENT_DIR)/node_modules
	@echo "Clean complete"

# Monitor logs
logs:
	tail -f logs/*.log

# Check system status
status:
	@echo "System Status:"
	@echo "-------------"
	@ps aux | grep stock_monitor_engine | grep -v grep && echo "C++ Engine: Running" || echo "C++ Engine: Stopped"
	@curl -s http://localhost:3001/health > /dev/null && echo "API Server: Running" || echo "API Server: Stopped"
	@curl -s http://localhost:3000 > /dev/null && echo "Frontend: Running" || echo "Frontend: Stopped"
	@$(DOCKER) ps | grep redis > /dev/null && echo "Redis: Running" || echo "Redis: Stopped"

# Help
help:
	@echo "Stock Monitor Build System"
	@echo "-------------------------"
	@echo "make install     - Install all dependencies"
	@echo "make build       - Build all components"
	@echo "make dev         - Run in development mode"
	@echo "make prod        - Run in production mode (Docker)"
	@echo "make test        - Run all tests"
	@echo "make benchmark   - Run performance benchmark"
	@echo "make clean       - Clean build artifacts"
	@echo "make status      - Check system status"
	@echo "make logs        - Monitor application logs"
	@echo ""
	@echo "Docker commands:"
	@echo "make docker-build - Build Docker images"
	@echo "make docker-up    - Start Docker containers"
	@echo "make docker-down  - Stop Docker containers"
	@echo "make docker-logs  - View Docker logs"