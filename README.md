# MyOrbit

**Your Life. Your Orbit.** A private, offline-first iPhone app for work shifts, pay, money, study, tasks and habits.

MyOrbit runs entirely on your iPhone. There's no account, no cloud requirement, no ads, no tracking and no subscription.

## Status

Built and checked in the iOS Simulator: the core modules, widgets, the timer Live Activity and Dynamic Island, local reminders, Siri/Shortcuts actions, widget tick-off buttons, encrypted backup and restore, and on-device Personal AI. It hasn't been tested on a physical iPhone yet. See [DEVELOPMENT_STATUS.md](DEVELOPMENT_STATUS.md) and, to install it on your phone, [NATIVE_IOS_SETUP.md](NATIVE_IOS_SETUP.md).

> The project folder and internal identifiers (bundle ID `com.daypilot.personal`, URL scheme `daypilot://`) keep the original name so existing installs keep their data.

## Technology

| Layer | Choice |
| --- | --- |
| App | React Native 0.88, Expo SDK 58, TypeScript (strict), Expo Router (native tabs) |
| Data | SQLite via `expo-sqlite` (WAL, foreign keys, versioned migrations) |
| Security | `expo-local-authentication` (Face ID / passcode), `expo-secure-store` (Keychain) |
| UI | SF Symbols (`expo-symbols`), native date/time pickers, haptics |
| Tests | Jest (`jest-expo`), React Native Testing Library, real SQLite in tests via `better-sqlite3` |
| Planned native | Swift/SwiftUI WidgetKit + ActivityKit extension, App Groups, App Intents |

## Requirements

- macOS with **Xcode 26+** (from the App Store) for iOS builds. Command Line Tools alone are not enough.
- Node.js 22 LTS (`brew install node@22`).
- An iPhone running iOS 17 or later for device testing. A free Apple ID can sign builds for your own device; a paid Apple Developer membership is only needed for TestFlight/App Store.

## Getting started

```bash
npm install
```

```bash
npx expo run:ios
```

`expo run:ios` generates the native `ios/` project (Continuous Native Generation), builds it with Xcode and launches the Simulator. Expo Go is **not** supported because the app uses native modules.

To run on a physical iPhone, connect it by cable and run:

```bash
npx expo run:ios --device
```

## Development commands

| Command | What it does |
| --- | --- |
| `npm start` | Start Metro for an installed development build |
| `npm run ios` | Build and run on the iOS Simulator |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint (`eslint-config-expo`, React Compiler rules) |
| `npm test` | Jest (runs with `TZ=Australia/Melbourne` so DST tests are deterministic) |
| `npm run check` | Typecheck + lint + tests |

## Project layout

```
src/
  app/                 Expo Router routes (screens only)
    (tabs)/            Home, Work, Money, Study, Settings
    shift/ expense/ …  Modal forms ([id] = "new" or a row id)
  components/          Shared UI (ui.tsx) and form controls (form.tsx)
  database/            Connection, migrations, typed repositories
  features/            Pure domain logic (shift pay, budgets, grades, streaks, recurrence, calendar, dashboard)
  services/            App context, queries, haptics, App Lock
  theme/               Colour tokens (dark/light), spacing, type scale
  utils/               Money (integer cents), dates/times, validation
tests/                 Unit, database and component tests
```

## Key design decisions

- **Money is integer cents** everywhere. User input is parsed from strings; floats never do arithmetic.
- **Dates are local `YYYY-MM-DD` keys** and instants are epoch ms. Shift durations use real elapsed time, so overnight and DST-crossing shifts are paid correctly.
- **Estimated shift earnings and actual income are separate.** Shifts estimate; income is only what you record as paid.
- **The calendar is a view, not a copy.** It reads shifts, assessments, study sessions and tasks from their own tables, so nothing is duplicated.
- **Timers are persisted instants.** Focus/study/shift timers store start and end times in SQLite and recover after the app is killed. No background JS timers.

See [DATABASE_SCHEMA.md](DATABASE_SCHEMA.md), [SECURITY_AUDIT.md](SECURITY_AUDIT.md), [NATIVE_IOS_SETUP.md](NATIVE_IOS_SETUP.md) and [BUG_REPORT.md](BUG_REPORT.md).
