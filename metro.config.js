// Learn more https://docs.expo.dev/guides/customizing-metro
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// The project lives in iCloud Drive, where Watchman misses file changes, so
// edits never reached the app. macOS's own file events (FSEvents) see them.
config.resolver.useWatchman = false;

module.exports = config;
