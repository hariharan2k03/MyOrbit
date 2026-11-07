#!/usr/bin/env bash
# Builds a Release copy of MyOrbit and installs it on the connected iPhone.
# A free Apple ID's signature lasts 7 days: run this weekly (`npm run phone`)
# to renew it, or `bash scripts/install-iphone.sh`. Installing over the
# existing app keeps all your data.
set -euo pipefail
cd "$(dirname "$0")/.."
# Homebrew's node@22 isn't on the default PATH.
export PATH="/opt/homebrew/opt/node@22/bin:$PATH" LANG="${LANG:-en_US.UTF-8}"

TEAM_ID="${TEAM_ID:-UXQ2VPYB93}"
DEVICE="${DEVICE:-$(xcrun devicectl list devices 2>/dev/null | awk '/physical/ && /connected/ {for (i=1;i<=NF;i++) if ($i ~ /^[0-9A-F]{8}-[0-9A-F]{16}$/) {print $i; exit}}')}"
if [ -z "$DEVICE" ]; then
  echo "No iPhone found. Plug it in, unlock it, and try again." >&2
  exit 1
fi

# ios/ is generated (not in git); create it on first run.
if [ ! -d ios/MyOrbit.xcworkspace ]; then
  echo "Generating the iOS project…"
  npx expo prebuild --platform ios
fi

# Build output is several GB; the .nosync suffix keeps it out of iCloud Drive.
OUT="build-device.nosync"

echo "Building MyOrbit for iPhone $DEVICE (team $TEAM_ID)…"
xcodebuild -workspace ios/MyOrbit.xcworkspace -scheme MyOrbit -configuration Release \
  -destination "id=$DEVICE" -derivedDataPath "$OUT" \
  -allowProvisioningUpdates -allowProvisioningDeviceRegistration \
  DEVELOPMENT_TEAM="$TEAM_ID" CODE_SIGN_STYLE=Automatic build -quiet

echo "Installing…"
xcrun devicectl device install app --device "$DEVICE" "$OUT/Build/Products/Release-iphoneos/MyOrbit.app" >/dev/null
echo "Done. MyOrbit is renewed for another 7 days."
