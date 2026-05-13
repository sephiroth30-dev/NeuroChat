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

EXE="${DIST_DIR}/NeuroChat-Setup-${VERSION}.exe"
DMG="${DIST_DIR}/NeuroChat-${VERSION}.dmg"
[ ! -f "$EXE" ] && EXE=$(find "$DIST_DIR" -maxdepth 1 -name "NeuroChat-Setup-*.exe" | sort -V | tail -1)
[ ! -f "$EXE" ] && EXE=$(find "$DIST_DIR" -maxdepth 1 -name "NeuroChat Setup *.exe" | sort -V | tail -1)
[ ! -f "$DMG" ] && DMG=$(find "$DIST_DIR" -maxdepth 1 -name "NeuroChat-*.dmg" | sort -V | tail -1)

ZIP="${DIST_DIR}/NeuroChat-${VERSION}.zip"
[ ! -f "$ZIP" ] && ZIP=$(find "$DIST_DIR" -maxdepth 1 -name "NeuroChat-*.zip" | sort -V | tail -1)
WIN_YML="${DIST_DIR}/latest.yml"
MAC_YML="${DIST_DIR}/latest-mac.yml"

if [ -z "$EXE" ] && [ -z "$DMG" ]; then
  echo "ERROR: No .exe or .dmg found in $DIST_DIR. Run 'npm run build:win' and/or 'npm run build:mac' first."
  exit 1
fi

echo "► Releasing $TAG"
[ -n "$EXE" ] && echo "  Windows : $(basename "$EXE")"
[ -f "$WIN_YML" ] && echo "  Win YML : latest.yml"
[ -n "$DMG" ] && echo "  macOS   : $(basename "$DMG")"
[ -n "$ZIP" ] && echo "  Mac ZIP : $(basename "$ZIP")"
[ -f "$MAC_YML" ] && echo "  Mac YML : latest-mac.yml"

# ── Helper: upload one asset (deletes existing with same name first) ──────────
upload_asset() {
  local release_id="$1"
  local file_path="$2"
  local asset_name
  asset_name=$(basename "$file_path")

  # Delete existing asset with the same name if present
  local existing_id
  existing_id=$(curl -sf -H "Authorization: token $GITHUB_TOKEN" \
    "https://api.github.com/repos/${REPO}/releases/${release_id}/assets" \
    | python3 -c "
import sys, json
assets = json.load(sys.stdin)
match = next((a['id'] for a in assets if a['name'] == '${asset_name}'), '')
print(match)
" 2>/dev/null || true)

  if [ -n "$existing_id" ]; then
    echo "  Replacing existing asset: $asset_name"
    curl -sf -X DELETE -H "Authorization: token $GITHUB_TOKEN" \
      "https://api.github.com/repos/${REPO}/releases/assets/${existing_id}" > /dev/null
  fi

  echo "  Uploading $asset_name…"
  local url
  url=$(curl -sf -X POST \
    -H "Authorization: token $GITHUB_TOKEN" \
    -H "Content-Type: application/octet-stream" \
    "https://uploads.github.com/repos/${REPO}/releases/${release_id}/assets?name=$(python3 -c "import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1]))" "$asset_name")" \
    --data-binary @"$file_path" \
    | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('browser_download_url',''))" 2>/dev/null || true)

  if [ -z "$url" ]; then
    echo "  ERROR: Upload failed for $asset_name"
    return 1
  fi
  echo "  ✓ $url"
}

# ── Check if release already exists ──────────────────────────────────────────
EXISTING=$(curl -sf -H "Authorization: token $GITHUB_TOKEN" \
  "https://api.github.com/repos/${REPO}/releases/tags/${TAG}" \
  2>/dev/null | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('id',''))" 2>/dev/null || true)

if [ -n "$EXISTING" ]; then
  echo "  Release $TAG already exists (id=$EXISTING)."
  RELEASE_ID="$EXISTING"
else
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
    echo "ERROR: Failed to create release."
    echo "$RELEASE_RESPONSE"
    exit 1
  fi
  echo "  Release created (id=$RELEASE_ID)"
fi

# ── Upload assets ─────────────────────────────────────────────────────────────
[ -n "$EXE" ] && upload_asset "$RELEASE_ID" "$EXE"
[ -f "$WIN_YML" ] && upload_asset "$RELEASE_ID" "$WIN_YML"
[ -n "$DMG" ] && upload_asset "$RELEASE_ID" "$DMG"
[ -n "$ZIP" ] && upload_asset "$RELEASE_ID" "$ZIP"
[ -f "$MAC_YML" ] && upload_asset "$RELEASE_ID" "$MAC_YML"

echo ""
echo "✓ Release publicada: https://github.com/${REPO}/releases/tag/${TAG}"
