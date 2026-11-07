# Security Audit

Reference: OWASP MASVS v2. This is a developer self-review, **not** an independent security assessment, and MyOrbit shouldn't be described as "completely secure".

_Last reviewed: 7 November 2026_

## Controls in place

| Area | Control | Where |
| --- | --- | --- |
| Storage (MASVS-STORAGE) | All data stays on the device in the app sandbox. iOS Data Protection encrypts the SQLite file at rest while the device is locked. | `src/database/client.ts` |
| Storage | Secrets are reserved for the Keychain (`expo-secure-store`), never SQLite. Backup passwords are never stored anywhere. | `src/database/repositories/settings.ts`, `src/app/backup.tsx` |
| Input validation (MASVS-CODE) | Every write is validated in the repository layer: length limits, control-character stripping, integer cents with bounds, valid dates and times, enum checks, weighting ≤ 100%, mark ≤ total. Settings are validated per key (e.g. reminder lead times from a fixed list, `HH:mm` times). | `src/utils/validation.ts`, `src/database/repositories/*` |
| SQL injection | 100% parameterised queries. Dynamic `WHERE` clauses use fixed fragments; user text is only ever bound. LIKE wildcards in search are escaped. Backup restore only inserts into tables and columns that already exist in this app's schema (checked against `sqlite_master` and `pragma_table_info` first), and quotes identifiers. | repositories, `src/features/backup/backupData.ts` |
| Database integrity | Foreign keys ON, CHECK and UNIQUE constraints, transactions for multi-row changes, migrations rolled back on failure. Restore runs in one transaction with a `foreign_key_check` before commit; any failure changes nothing. | `src/database/migrations.ts`, `backupData.ts` |
| Authentication (MASVS-AUTH) | Optional App Lock with Face ID and passcode fallback. Turning it on or off requires authentication. Auto-lock after a configurable time. Restoring a backup never changes App Lock on this device. | `src/services/AppLock.tsx` |
| Cryptography (MASVS-CRYPTO) | Backups: AES-256-GCM (authenticated, so tampering is detected), key from PBKDF2-HMAC-SHA256 with 310,000 iterations and a random 16-byte salt; random 12-byte nonce per backup. Randomness from `expo-crypto` (the iOS secure random generator). Library: `@noble/ciphers` / `@noble/hashes` (audited, dependency-free). The file records its parameters; out-of-range values are rejected before any work, so a crafted file can't stall the app. | `src/features/backup/backupCrypto.ts` |
| Network (MASVS-NETWORK) | The only network use is downloading calendar feeds the user adds (HTTPS only; `webcal://` is upgraded). 20 s timeout, 5 MB cap, the response is parsed as data only. Nothing is uploaded. | `src/database/repositories/calendarFeeds.ts` |
| Notifications | Local only, no push and no server. Content is limited to titles, times and workplace names; **no money amounts** in notifications. Reminders are rebuilt from the data on every change, so deleted or moved items can't leave stale reminders. | `src/features/reminders/planReminders.ts` |
| Widgets and Live Activities | The App Group holds a minimal snapshot, not the database. Money is hidden in widgets by default (`hideAmountsInWidgets`). The timer Live Activity shows the session name and times only. | `src/services/widgetSync.ts`, `src/widgets/*` |
| Siri / Shortcuts and widget buttons | Intents never touch the database. They queue small JSON actions in the App Group (capped at 50); the app validates each one strictly (type, ranges, dates, lengths) and applies it through the normal repositories, dropping anything malformed. A Siri timer never replaces one that's already running. | `plugins/app-intents/MyOrbitIntents.swift`, `src/features/intents/intentActions.ts` |
| Personal AI | Uses only Apple's **on-device** `SystemLanguageModel`. The Private Cloud Compute model in the iOS 27 SDK is deliberately not used, so no data leaves the iPhone. The model only sees a text summary of the user's own data built for that request; nothing is kept between requests. Quick-add never saves without the user tapping Save, and saves go through the normal validated repositories. | `modules/myorbit-ai`, `src/features/ai/*` |
| Logging | No user data is logged. Users see generic messages for unexpected errors. | throughout |
| Privacy (MASVS-PRIVACY) | No ads, analytics or tracking. Permissions are asked only when a feature needs them: Face ID (App Lock), notifications (Reminders), Live Activities (timer). | `app.json` |
| Destructive actions | Deletes need confirmation. Restore shows the backup's date and record counts and asks before replacing data. | forms, `src/app/backup.tsx` |

## Important distinctions

- App Lock is **access control**, not encryption. It hides the UI; file encryption at rest comes from iOS Data Protection.
- A backup is only as strong as its password. MyOrbit enforces at least 8 characters and suggests using a password manager (iOS offers a strong password in the field). There is no password recovery by design.
- Personal AI answers are generated text and can be wrong. Money figures are computed by MyOrbit and passed to the model to quote, and the screen says that tax is an estimate.

## Remaining risks / to do

1. **App switcher snapshot:** with App Lock on, the last screen can appear in the app switcher. Fix: a privacy cover when the app becomes inactive.
2. **Data Protection class:** confirm in Xcode that `NSFileProtectionCompleteUntilFirstUserAuthentication` is acceptable, or raise it to `Complete`. That would stop widgets refreshing while the phone is locked.
3. **Calendar feed URLs** are stored in SQLite and included in backups (encrypted). Anyone with a feed link can read that timetable; the screen warns users to keep it private.
4. **Optional cloud sync:** not implemented. If added, it needs explicit opt-in, HTTPS, row-level security and no secrets in the app bundle.
5. **Dependency audit (7 Nov 2026):** `npm audit` reports moderate advisories only, all in `glob`, `minimatch` and `deepmerge` inside build and test tooling (Expo CLI, Jest, ESLint). None are bundled into the iPhone app. Don't run `npm audit fix --force`: it would break SDK-pinned versions. Re-check when upgrading the Expo SDK.
6. **Independent review:** before any public release, have the backup format and restore path reviewed by someone else.
