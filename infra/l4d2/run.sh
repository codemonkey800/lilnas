#!/bin/bash

set -e

# Environment variables with defaults
PORT=${PORT:-27015}
MAP=${MAP:-c1m1_hotel}
MAX_PLAYERS=${MAX_PLAYERS:-8}
NAME=${NAME:-"L4D2 Dedicated Server"}
GAME_MODE=${GAME_MODE:-coop}
RCON_PASSWORD=${RCON_PASSWORD:-""}

# SteamCMD paths
STEAM_DIR="/l4d2"
L4D2_SERVER_DIR="${STEAM_DIR}/server"
CONFIG_DIR="${L4D2_SERVER_DIR}/left4dead2/cfg"
SRCDS_RUN="${L4D2_SERVER_DIR}/srcds_run"

# Logging function
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1"
}

# Signal handling for graceful shutdown
shutdown() {
    log "Received shutdown signal, stopping L4D2 server..."
    if [ -n "$SERVER_PID" ] && kill -0 "$SERVER_PID" 2>/dev/null; then
        kill "$SERVER_PID"
        wait "$SERVER_PID"
    fi
    exit 0
}

trap shutdown SIGTERM SIGINT

log "Starting SteamCMD L4D2 server setup..."

# Check if L4D2 server is installed
if [ ! -f "$SRCDS_RUN" ]; then
    log "Installing L4D2 server via SteamCMD..."
    log "This may take several minutes to download and install..."

    # Install the server using SteamCMD
    ./steamcmd.sh +force_install_dir "$L4D2_SERVER_DIR" +login anonymous +@sSteamCmdForcePlatformType windows +app_update 222860 validate +quit
    ./steamcmd.sh +force_install_dir "$L4D2_SERVER_DIR" +login anonymous +@sSteamCmdForcePlatformType linux +app_update 222860 validate +quit

    # Clean up default files
    rm -rf "${L4D2_SERVER_DIR}/left4dead2/host.txt" \
           "${L4D2_SERVER_DIR}/left4dead2/motd.txt" 2>/dev/null || true

    log "L4D2 server installation completed"
fi

# Create config directory if it doesn't exist
mkdir -p "$CONFIG_DIR"

log "Config directory ready at: $CONFIG_DIR"
log "Note: server.cfg should be manually copied to $CONFIG_DIR/server.cfg"

log "L4D2 server configuration complete"
log "Server configuration:"
log "  Port: $PORT"
log "  Map: $MAP"
log "  Max Players: $MAX_PLAYERS"
log "  Server Name: $NAME"
log "  Game Mode: $GAME_MODE"
log "  RCON: $([ -n "$RCON_PASSWORD" ] && echo "Enabled" || echo "Disabled")"
log "  Config Dir: $CONFIG_DIR"

# Start the server using srcds_run directly
log "Starting L4D2 server via srcds_run..."

cd "$L4D2_SERVER_DIR"

# Start the server in background and capture PID
./srcds_run -game left4dead2 -secure +exec server.cfg +map "$MAP" -port "$PORT" &
SERVER_PID=$!

log "L4D2 server started with PID: $SERVER_PID"

# Wait for the server process to exit
# Docker's restart policy will handle restarting the container if needed
wait "$SERVER_PID"
