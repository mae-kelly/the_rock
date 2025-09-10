#!/bin/bash

# macOS Setup Script for Stock Monitor Bot
# This script installs all required dependencies on macOS

set -e

echo "🚀 Stock Monitor Bot - macOS Setup"
echo "=================================="
echo ""

# Check if Homebrew is installed
if ! command -v brew &> /dev/null; then
    echo "📦 Installing Homebrew..."
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
    
    # Add Homebrew to PATH for Apple Silicon Macs
    if [[ $(uname -m) == 'arm64' ]]; then
        echo 'eval "$(/opt/homebrew/bin/brew shellenv)"' >> ~/.zprofile
        eval "$(/opt/homebrew/bin/brew shellenv)"
    fi
else
    echo "✅ Homebrew already installed"
fi

echo ""
echo "📦 Installing development tools..."

# Install Xcode Command Line Tools if needed
if ! xcode-select -p &> /dev/null; then
    echo "Installing Xcode Command Line Tools..."
    xcode-select --install
    echo "Please complete the Xcode Command Line Tools installation, then run this script again."
    exit 1
fi

# Update Homebrew
echo "Updating Homebrew..."
brew update

# Install C++ dependencies
echo ""
echo "📦 Installing C++ dependencies..."
brew list cmake &>/dev/null || brew install cmake
brew list boost &>/dev/null || brew install boost
brew list openssl &>/dev/null || brew install openssl

# Install Node.js and npm
echo ""
echo "📦 Installing Node.js..."
brew list node &>/dev/null || brew install node

# Install Redis
echo ""
echo "📦 Installing Redis..."
brew list redis &>/dev/null || brew install redis

# Install Docker (if not already installed)
echo ""
echo "📦 Checking Docker..."
if ! command -v docker &> /dev/null; then
    echo "Docker not found. Please install Docker Desktop for Mac from:"
    echo "https://www.docker.com/products/docker-desktop"
    echo ""
    echo "After installing Docker Desktop, run this script again."
    DOCKER_MISSING=1
else
    echo "✅ Docker already installed"
fi

# Create project directories
echo ""
echo "📁 Creating project structure..."
mkdir -p build
mkdir -p logs
mkdir -p data

# Install Node.js dependencies
echo ""
echo "📦 Installing Node.js dependencies..."
if [ -f "package.json" ]; then
    npm install
else
    echo "package.json not found, skipping npm install"
fi

if [ -d "client" ] && [ -f "client/package.json" ]; then
    cd client
    npm install
    cd ..
else
    echo "Client directory not found, skipping client dependencies"
fi

# Set up environment file
echo ""
echo "🔧 Setting up environment configuration..."
if [ ! -f ".env" ]; then
    cat > .env << EOL
# Alpaca API Configuration
ALPACA_KEY_ID=your_alpaca_key_here
ALPACA_SECRET_KEY=your_alpaca_secret_here
ALPACA_BASE_URL=https://paper-api.alpaca.markets
ALPACA_DATA_URL=wss://stream.data.alpaca.markets/v2/sip

# Redis Configuration
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=
REDIS_DB=0

# Server Configuration
PORT=3001
NODE_ENV=development
CORS_ORIGIN=http://localhost:3000

# C++ Engine Configuration
CPP_ENGINE_HOST=localhost
CPP_ENGINE_PORT=8080

# Performance Tuning
PRICE_BUFFER_SIZE=120
DETECTION_THRESHOLD_MIN=9.0
DETECTION_THRESHOLD_MAX=13.0
EOL
    echo "✅ Created .env file - Please add your Alpaca API credentials"
else
    echo "✅ .env file already exists"
fi

# Build C++ engine
echo ""
echo "🔨 Building C++ engine..."
if [ -f "CMakeLists.txt" ]; then
    mkdir -p build
    cd build
    cmake .. -DCMAKE_BUILD_TYPE=Release
    make -j$(sysctl -n hw.ncpu)
    cd ..
    echo "✅ C++ engine built successfully"
else
    echo "⚠️  CMakeLists.txt not found, skipping C++ build"
    echo "   For now, we'll use the Node.js-only version"
fi

# Start Redis in the background
echo ""
echo "🔴 Starting Redis server..."
if ! pgrep -x "redis-server" > /dev/null; then
    brew services start redis
    echo "✅ Redis server started"
else
    echo "✅ Redis server already running"
fi

echo ""
echo "=================================="
echo "✅ Setup Complete!"
echo ""
echo "Next steps:"
echo "1. Edit .env file and add your Alpaca API credentials"
echo "   Get them at: https://alpaca.markets/"
echo ""
echo "2. Run the application:"
echo "   Development mode:  make dev"
echo "   Production mode:   make prod"
echo ""

if [ "$DOCKER_MISSING" == "1" ]; then
    echo "⚠️  Note: Docker is required for production deployment"
    echo "   Please install Docker Desktop from https://www.docker.com/products/docker-desktop"
fi

echo ""
echo "For more information, see README.md"
echo "=================================="