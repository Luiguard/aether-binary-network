#!/bin/bash
# ═══════════════════════════════════════════════════════════
#  🌐 Aether Binary Network – Linux/macOS Installer
# ═══════════════════════════════════════════════════════════

set -e

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "  🌐 AETHER BINARY NETWORK – Das Binäre Internet"
echo "  Zero-Friction Installer v1.0.0"
echo "═══════════════════════════════════════════════════════════"
echo ""

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# 1. Validate Node.js
echo "[1/4] Validating Node.js runtime..."
if ! command -v node &> /dev/null; then
    echo "  ❌ Node.js is not installed."
    echo "  📥 Install: curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -"
    exit 1
fi

NODE_VERSION=$(node -v)
echo "  ✅ Node.js detected: $NODE_VERSION"

MAJOR=$(echo "$NODE_VERSION" | sed 's/v\([0-9]*\)\..*/\1/')
if [ "$MAJOR" -lt 18 ]; then
    echo "  ⚠️  Node.js 18+ required. Please upgrade."
    exit 1
fi

# 2. Install Dependencies
echo "[2/4] Installing binary protocol dependencies..."
npm install --production 2>&1 > /dev/null
echo "  ✅ Dependencies installed"

# 3. Launch Server
echo "[3/4] Launching Aether Binary Network node..."
PORT=${PORT:-8080} node src/server.js &
SERVER_PID=$!

sleep 2

# 4. Open Dashboard
echo "[4/4] Opening Binary Dashboard..."
if command -v xdg-open &> /dev/null; then
    xdg-open "http://localhost:${PORT:-8080}" 2>/dev/null || true
elif command -v open &> /dev/null; then
    open "http://localhost:${PORT:-8080}" 2>/dev/null || true
fi

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "  ✅ AETHER BINARY NETWORK IS LIVE!"
echo "═══════════════════════════════════════════════════════════"
echo ""
echo "  📡 Dashboard:  http://localhost:${PORT:-8080}"
echo "  📊 API Stats:  http://localhost:${PORT:-8080}/api/stats"
echo ""
echo "  Server PID: $SERVER_PID"
echo "  Stop: kill $SERVER_PID"
echo ""
