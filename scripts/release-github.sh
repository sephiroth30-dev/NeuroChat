#!/usr/bin/env bash
set -euo pipefail

# Load .env if it exists (for local development)
if [ -f "$(dirname "$0")/../.env" ]; then
  # shellcheck disable=SC1091
  set -a; source "$(dirname "$0")/../.env"; set +a
fi

# ── Validation ────────────────────────────────────────────────────────────────
: "${GITHUB_TOKEN:?ERROR: GITHUB_TOKEN is not set. Add it to .env or export it.}"

REPO="sephiroth30-dev/NeuroChat"
VERSION=$(node -p "require('./package.json').version")
TAG="v${VERSION}"
DIST_DIR="dist"

EXE=$(find "$DIST_DIR" -maxdepth 1 -name "NeuroChat Setup *.exe" | head -1)
if [ -z "$EXE" ]; then
  echo "ERROR: No .exe found in $DIST_DIR. Run 'npm run build:win' first."
  exit 1
fi

echo "► Releasing $TAG — $(basename "$EXE")"

# ── Check if release already exists ──────────────────────────────────────────
EXISTING=$(curl -sf -H "Authorization: token $GITHUB_TOKEN" \
  "https://api.github.com/repos/${REPO}/releases/tags/${TAG}" \
  2>/dev/null | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('id',''))" 2>/dev/null || true)

if [ -n "$EXISTING" ]; then
  echo "  Release $TAG already exists (id=$EXISTING). Skipping creation."
  RELEASE_ID="$EXISTING"
else
  # ── Create release ──────────────────────────────────────────────────────────
  echo "  Creating release $TAG..."
  RELEASE_RESPONSE=$(curl -sf -X POST \
    -H "Authorization: token $GITHUB_TOKEN" \
    -H "Content-Type: application/json" \
    "https://api.github.com/repos/${REPO}/releases" \
    -d "{
      \"tag_name\": \"${TAG}\",
      \"name\": \"NeuroChat ${VERSION}\",
      \"draft\": false,
      \"prerelease\": $(echo "$VERSION" | grep -q '[a-zA-Z]' && echo 'true' || echo 'false'),
      \"generate_release_notes\": true
    }")

  RELEASE_ID=$(echo "$RELEASE_RESPONSE" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('id',''))" 2>/dev/null || echo "")
  if [ -z "$RELEASE_ID" ]; then
    echo "ERROR: Failed to create release. Response:"
    echo "$RELEASE_RESPONSE"
    exit 1
  fi
  echo "  Release created (id=$RELEASE_ID)"
fi

# ── Upload asset ──────────────────────────────────────────────────────────────
ASSET_NAME=$(basename "$EXE")
echo "  Uploading $ASSET_NAME..."

UPLOAD_RESPONSE=$(curl -sf -X POST \
  -H "Authorization: token $GITHUB_TOKEN" \
  -H "Content-Type: application/octet-stream" \
  "https://uploads.github.com/repos/${REPO}/releases/${RELEASE_ID}/assets?name=$(python3 -c "import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1]))" "$ASSET_NAME")" \
  --data-binary @"$EXE")

ASSET_URL=$(echo "$UPLOAD_RESPONSE" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('browser_download_url',''))" 2>/dev/null || true)
if [ -z "$ASSET_URL" ]; then
  echo "ERROR: Upload failed. Response:"
  echo "$UPLOAD_RESPONSE"
  exit 1
fi

echo ""
echo "✓ Subida exitosa"
echo "  Release : https://github.com/${REPO}/releases/tag/${TAG}"
echo "  Download: $ASSET_URL"
