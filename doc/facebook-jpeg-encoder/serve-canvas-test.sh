#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
HOST="${1:-127.0.0.1}"
PORT="${2:-8123}"

cd "$ROOT_DIR"

echo "Serving doc/ at http://$HOST:$PORT/"
echo "Open: http://$HOST:$PORT/facebook-jpeg-encoder/canvas-jpeg-q92.html"

exec php -S "$HOST:$PORT" -t doc
