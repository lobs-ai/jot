#!/bin/bash
set -e

echo "Installing Jot..."

# Get the directory where this script lives
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Check for Node.js
if ! command -v node &> /dev/null; then
    echo "Error: Node.js is not installed. Install from https://nodejs.org"
    exit 1
fi

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
    echo "Installing dependencies..."
    npm install
fi

# Build
echo "Building..."
npm run build

# Link globally
echo "Linking globally..."
npm link

echo ""
echo "Jot is installed! Run 'jot-note add \"your first note\"' to start."
echo "LM Studio should be running at localhost:1234 for AI analysis."
echo "Configure ~/.jot/config.json to change backends or add remote endpoints."