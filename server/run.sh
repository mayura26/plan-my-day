#!/usr/bin/env bash
# Start the Plan My Day Go server from this directory.
# Overrides: PORT=8081 ALLOW_DEV_LOGIN=0 SQLITE_PATH=../tmp-plan.db ./run.sh
set -euo pipefail

cd "$(dirname "$0")"

export PORT="${PORT:-8080}"
export ALLOW_DEV_LOGIN="${ALLOW_DEV_LOGIN:-1}"
if [[ -z "${PUBLIC_URL:-}" ]]; then
  export PUBLIC_URL="http://localhost:${PORT}"
fi

exec go run ./cmd/server
