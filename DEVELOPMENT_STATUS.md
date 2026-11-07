# Development Status — MyOrbit

_Last updated: 7 November 2026_

## Verification summary

| Check | Result |
| --- | --- |
| TypeScript (`tsc --noEmit`, strict + `noUncheckedIndexedAccess`) | ✅ 0 errors |
| ESLint (`expo lint`, incl. React Compiler rules) | ✅ 0 errors, 0 warnings |
| Jest | ✅ 146 / 146 tests, 10 suites |
| Native iOS build (Xcode 27.2, iOS 27.2 SDK) incl. widget target and the `myorbit-ai` Swift module | ✅ builds and installs |
| Simulator (iPhone 18 Pro, iOS 27.2) | ✅ see "Checked in the Simulator" below |
| Physical iPhone testing | ⛔ Not run yet (needs the user's iPhone 17 and signing — see NATIVE_IOS_SETUP.md) |

### Checked in the Simulator

- Home with the Ocean Blue theme, mountain scene and scrolling day strip; light and dark mode.
- Work (Schedule/Hours/Salary), including penalty rates, after-tax estimates and **pay fortnight** totals.
- Calendar (month/week/day) and the subscribed-calendar screen.
- Home Screen widget (small/medium/large) with live data.
- Timer Live Activity: compact and expanded Dynamic Island, Lock Screen, and the "Done" state after it ends. Ending a session dismisses it.
- Timer card on Study, shown even with no subjects.
- Reminders screen (scheduling covered by 10 tests; the iOS notification permission prompt was left for the user).
- Backup: encrypted backup created (native PBKDF2, a few seconds), share sheet, saved to Files.
- Siri / Shortcuts: MyOrbit's actions (Add Expense, Add Task, Start Timer, Focus, Break) appear in the Shortcuts app. "Add Task" queued a task that the app added on next open; "Focus" opened the app and started a 25-minute timer.
- Widget tick-off: ticking a task on the Home Screen widget removed it at once, and opening the app marked it done in the database.
- Personal AI: on-device model available in the Simulator; "Earnings this month" answered with the exact figure from the database; quick-add produced a confirmation card (cancelled, so no test data was saved).

Not yet clicked through in the Simulator: restoring a backup into the app (the restore path is covered by tests, including rollback on a broken file), and tapping a delivered reminder.

## Roadmap

| Phase | Feature | Status |
| --- | --- | --- |
| 1 | Environment and project setup | ✅ Node 22, Expo SDK 58, Xcode 27.2, CocoaPods, iOS Simulator |
| 2 | Architecture and navigation | ✅ Native tabs + root stack with modal forms |
| 3 | Premium UI and theme system | ✅ Ocean Blue (dark/light/system), mountain scene, gradient tiles, SF Symbols, haptics, new MyOrbit icon |
| 4 | SQLite database and migrations | ✅ Tested |
| 5 | Dashboard | ✅ Real data, reorderable cards, scrolling day strip |
| 6 | Work shift manager | ✅ Tested — overnight/DST, overlap prevention, Saturday/Sunday/night penalty rates, after-tax estimate (ATO 2026–27), weekly/fortnightly/monthly totals |
| 7 | Income and expenses | ✅ Tested |
| 8 | Budget manager | ✅ Tested |
| 9 | Study planner | ✅ Tested |
| 10 | Tasks and habits | ✅ Tested |
| 11 | Calendar and reminders | ✅ Calendar with .ics feeds; local reminders for shifts, assessments, tasks and a daily habit check-in |
| 12 | Native widget extension | ✅ "MyOrbit Today" (small/medium/large) |
| 13 | Lock Screen widgets | 🟡 Built (circular/rectangular/inline); not yet placed on the Lock Screen in testing |
| 14 | Dynamic Island and Live Activities | ✅ Timer Live Activity |
| 15 | Notifications and App Intents | ✅ Local reminders; Siri/Shortcuts actions (start timer, add expense, add task); tick-off buttons on the widget |
| 16 | Secure backup and restore | ✅ AES-256-GCM + PBKDF2 (native), integrity check, schema validation, confirmation, transactional restore |
| 17 | Security checks and fixes | 🟡 Ongoing — see SECURITY_AUDIT.md |
| 18 | Physical iPhone testing | ⛔ Not started |
| 19 | Performance optimisation | ⛔ Not profiled (queries are indexed) |
| 20 | Release preparation | ⛔ Not started |
| 21 | Personal AI (on-device) | ✅ Apple Foundation Models (on-device only): questions about your data, daily summary, study planning around free time, spending insights, quick-add with confirmation. Hidden when Apple Intelligence isn't available |

## Pending (next steps, in order)

1. Install on the iPhone 17 (NATIVE_IOS_SETUP.md), use a Release build, and repeat the Simulator checks on the device, especially Personal AI speed and Live Activities.
2. Restore a real backup on the device end to end.
4. Privacy cover in the app switcher when App Lock is on (SECURITY_AUDIT.md item 1).
5. Release build size and performance check.

## Test coverage

- `tests/calculations.test.ts`: money, dates, DST, shift pay, budgets, grades, streaks, recurrence.
- `tests/database.test.ts`: migrations, foreign keys, every repository, duplicate/overlap prevention, settings validation, activity sessions, calendar feeds, widget snapshot.
- `tests/pay.test.ts`: penalty rates, ATO tax, take-home, fortnight periods.
- `tests/ics.test.ts`: calendar feed parsing (time zones, recurrence, exceptions).
- `tests/liveActivity.test.ts`: timer Live Activity content.
- `tests/reminders.test.ts`: reminder planning (lead times, overrides, cancelled shifts, horizon, iOS 64-limit, habits), settings validation.
- `tests/backup.test.ts`: encryption round trip, wrong password/tampering, fresh salt/nonce, RFC 7914 PBKDF2 vector, file validation, UTF-8 decoding, full restore, rollback on broken files.
- `tests/intents.test.ts`: Siri action parsing and validation, applying actions (timer, expense, task, completing ticked tasks), widget tick collection.
- `tests/ai.test.ts`: date/time parsing for quick-add, draft resolution and saving, free-time blocks, exact facts given to the model.
- `tests/components.test.tsx`: shared UI components.
