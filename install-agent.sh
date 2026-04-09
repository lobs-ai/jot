#!/bin/bash
# Jot Agent Installer for macOS launchd

JOT_DIR="$HOME/.jot"
PLIST_PATH="$HOME/Library/LaunchAgents/com.lobs.jot.agent.plist"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
AGENT_PATH="$SCRIPT_DIR/dist/agent.js"

echo "=== Jot Agent Installer ==="
echo ""
echo "This will install jot as a background agent that runs every 5 minutes."
echo "Logs will be written to: $JOT_DIR/logs/agent.log"
echo ""

read -p "Install jot agent? (y/n): " -n 1 -r
echo ""
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Cancelled."
    exit 0
fi

# Create directories
mkdir -p "$JOT_DIR/logs"
mkdir -p "$HOME/Library/LaunchAgents"

# Get node path
NODE_PATH=$(which node)
if [ -z "$NODE_PATH" ]; then
    echo "Error: node not found in PATH"
    exit 1
fi

if [ ! -f "$AGENT_PATH" ]; then
    echo "Error: built agent not found at $AGENT_PATH"
    echo "Run: npm run build"
    exit 1
fi

# Create plist
cat > "$PLIST_PATH" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.lobs.jot.agent</string>
    <key>ProgramArguments</key>
    <array>
        <string>$NODE_PATH</string>
        <string>$AGENT_PATH</string>
    </array>
    <key>StartInterval</key>
    <integer>300</integer>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <false/>
    <key>StandardOutPath</key>
    <string>$JOT_DIR/logs/agent.out.log</string>
    <key>StandardErrorPath</key>
    <string>$JOT_DIR/logs/agent.err.log</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>HOME</key>
        <string>$HOME</string>
    </dict>
</dict>
</plist>
EOF

echo "Created plist at: $PLIST_PATH"
echo ""
echo "Loading agent..."
if [ -f "$PLIST_PATH" ]; then
    launchctl unload "$PLIST_PATH" >/dev/null 2>&1 || true
fi
launchctl load "$PLIST_PATH"
echo ""
echo "Agent installed and running."
echo ""
echo "Commands:"
echo "  launchctl stop com.lobs.jot.agent    # Stop agent"
echo "  launchctl start com.lobs.jot.agent   # Start agent"
echo "  launchctl unload $PLIST_PATH        # Uninstall"
echo ""
echo "Logs: tail -f $JOT_DIR/logs/agent.log"
