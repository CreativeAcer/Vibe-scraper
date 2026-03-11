#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"
command -v python3 >/dev/null 2>&1 || {
    echo "Python 3 not found. Install from https://python.org/downloads"
    exit 1
}
echo "Installing dependencies..."
pip3 install -r requirements.txt -q
echo ""
echo "Starting Vibe Scraper Server on http://localhost:7823 ..."
echo "Press Ctrl+C to stop."
echo ""
python3 server.py
