#!/bin/sh
# Regenerates the iOS app icon and launch image from public/icons/icon.svg, the
# same mark the PWA uses. macOS only (sips). Run from the repo root.
#
# Apple rejects an icon with an alpha channel, and sips keeps one when it
# rasterises an SVG — so each image goes PNG → JPEG → PNG, which flattens it.
# The launch image is a 2732² square shown aspect-fill; on a phone only the
# middle ~45% of its width is visible, so the mark sits small in the centre on
# the page's own #0f0f0f, and the first paint of the web app matches it.
set -e
SVG=public/icons/icon.svg
OUT=ios/App/App/Assets.xcassets
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

flatten() { # in.png out.png
  sips -s format jpeg -s formatOptions 100 "$1" --out "$TMP/f.jpg" >/dev/null
  sips -s format png "$TMP/f.jpg" --out "$2" >/dev/null
}

sips -s format png -z 1024 1024 "$SVG" --out "$TMP/icon.png" >/dev/null
flatten "$TMP/icon.png" "$OUT/AppIcon.appiconset/AppIcon-512@2x.png"

INNER=$(sed -E 's/.*<rect[^>]*\/>(.*)<\/svg>.*/\1/' "$SVG")
printf '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2732 2732"><rect width="2732" height="2732" fill="#0f0f0f"/><g transform="translate(816,816) scale(1.157894737)">%s</g></svg>' "$INNER" > "$TMP/splash.svg"
sips -s format png -z 2732 2732 "$TMP/splash.svg" --out "$TMP/splash.png" >/dev/null
for f in splash-2732x2732.png splash-2732x2732-1.png splash-2732x2732-2.png; do
  flatten "$TMP/splash.png" "$OUT/Splash.imageset/$f"
done
sips -g hasAlpha "$OUT/AppIcon.appiconset/AppIcon-512@2x.png" | grep -q 'hasAlpha: no' || { echo "icon still has alpha" >&2; exit 1; }
echo "✔ ios-icons: AppIcon + Splash written"
