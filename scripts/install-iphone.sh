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
# A physical iPhone (not iPad), cable-connected first, else paired over Wi-Fi.
find_iphone() {
  xcrun devicectl list devices 2>/dev/null | awk -v want="$1" '/physical/ && /iPhone/ && $0 ~ want {
    for (i = 1; i <= NF; i++) if ($i ~ /^[0-9A-F]{8}-[0-9A-F]{16}$/) { print $i; exit }
  }'
}
DEVICE="${DEVICE:-$(find_iphone connected)}"
DEVICE="${DEVICE:-$(find_iphone available)}"
if [ -z "$DEVICE" ]; then
  echo "No iPhone found. Unlock it and keep it on the same Wi-Fi as this Mac (or plug it in), then try again." >&2
  exit 1
fi

# ios/ is generated (not in git); create it on first run, outside iCloud sync.
bash scripts/keep-out-of-icloud.sh
if [ ! -d ios/MyOrbit.xcworkspace ]; then
  echo "Generating the iOS project…"
  npx expo prebuild --platform ios
fi

# Build output goes outside iCloud Drive: iCloud tags files with Finder data
# that code signing rejects ("resource fork ... not allowed"), and it's several GB.
OUT="$HOME/Library/Developer/MyOrbit/build-device"

# A free Apple ID's profile lasts 7 days, and Xcode reuses an existing one
# until it expires — so a "renewal" could quietly keep the old date. Delete
# profiles for this app that expire within 2 days, forcing a fresh 7-day one.
PROFILES="$HOME/Library/Developer/Xcode/UserData/Provisioning Profiles"
if [ -d "$PROFILES" ]; then
  soon=$(( $(date +%s) + 2 * 86400 ))
  for f in "$PROFILES"/*.mobileprovision; do
    [ -e "$f" ] || continue
    plist=$(security cms -D -i "$f" 2>/dev/null) || continue
    echo "$plist" | grep -q "com.daypilot.personal" || continue
    exp=$(echo "$plist" | plutil -extract ExpirationDate raw -o - - 2>/dev/null) || continue
    exp_s=$(date -j -u -f "%Y-%m-%dT%H:%M:%SZ" "$exp" +%s 2>/dev/null) || continue
    if [ "$exp_s" -lt "$soon" ]; then
      echo "Removing signing profile that expires $exp"
      rm -f "$f"
    fi
  done
fi

echo "Building MyOrbit for iPhone $DEVICE (team $TEAM_ID)…"
# The full build log is long and noisy; keep it in a file and show only errors.
LOG="$HOME/Library/Developer/MyOrbit/last-build.log"
mkdir -p "$(dirname "$LOG")"
echo "(takes a few minutes; full log: $LOG)"
if ! xcodebuild -workspace ios/MyOrbit.xcworkspace -scheme MyOrbit -configuration Release \
  -destination "id=$DEVICE" -derivedDataPath "$OUT" \
  -allowProvisioningUpdates -allowProvisioningDeviceRegistration \
  DEVELOPMENT_TEAM="$TEAM_ID" CODE_SIGN_STYLE=Automatic build >"$LOG" 2>&1; then
  echo "Build failed. Errors:" >&2
  grep -E ": error:|error: " "$LOG" | sort -u | head -20 >&2
  exit 1
fi

echo "Installing…"
xcrun devicectl device install app --device "$DEVICE" "$OUT/Build/Products/Release-iphoneos/MyOrbit.app" >/dev/null
# Report the real expiry from the installed app's profile, not an assumption.
EXP=$(security cms -D -i "$OUT/Build/Products/Release-iphoneos/MyOrbit.app/embedded.mobileprovision" 2>/dev/null | plutil -extract ExpirationDate raw -o - - 2>/dev/null || true)
if [ -n "$EXP" ]; then
  echo "Done. MyOrbit works until $(TZ=UTC date -j -f "%Y-%m-%dT%H:%M:%SZ" "$EXP" +%s | xargs -I{} date -r {} "+%a %d %b, %I:%M %p" 2>/dev/null || echo "$EXP"). Run this again before then."
else
  echo "Done."
fi
