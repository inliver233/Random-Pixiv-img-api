#!/bin/sh
set -eu

# If DATABASE_URL is not provided, construct it from POSTGRES_* variables.
# This avoids common URL parsing issues when passwords contain special characters
# (e.g. '@', ':', '/', '#'), by URL-encoding user/password/db.
if [ -z "${DATABASE_URL:-}" ]; then
  if [ -n "${POSTGRES_USER:-}" ] && [ -n "${POSTGRES_PASSWORD:-}" ] && [ -n "${POSTGRES_DB:-}" ]; then
    export POSTGRES_HOST="${POSTGRES_HOST:-postgres}"
    export POSTGRES_PORT="${POSTGRES_PORT:-5432}"
    export DATABASE_URL="$(node -e '
      const enc = encodeURIComponent;
      const user = process.env.POSTGRES_USER || "";
      const pass = process.env.POSTGRES_PASSWORD || "";
      const host = process.env.POSTGRES_HOST || "postgres";
      const port = process.env.POSTGRES_PORT || "5432";
      const db = process.env.POSTGRES_DB || "";
      if (!user || !pass || !db) process.exit(2);
      process.stdout.write(`postgresql://${enc(user)}:${enc(pass)}@${host}:${port}/${enc(db)}`);
    ')"
  fi
fi

# AdminJS bundler output dir (components bundle). Ensure it exists and is writable.
if [ -n "${ADMIN_JS_TMP_DIR:-}" ]; then
  mkdir -p "${ADMIN_JS_TMP_DIR}" || true
fi

exec "$@"
