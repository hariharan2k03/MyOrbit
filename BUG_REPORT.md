# Bug Report

Bugs found during development, with root cause, fix and regression test.

## Fixed

### B-001 Nested SQLite transaction in category budgets
- **Reproduce:** Money â Budget â Category budgets â set two categories â Save.
- **Root cause:** The screen wrapped several `setBudget` calls in `withTransactionAsync`, but `setBudget` opens its own transaction. expo-sqlite can't nest transactions, so the save would fail at runtime.
- **Fix:** Validate every field first, then apply each budget with its own transaction (`src/app/budget/[id].tsx`).
- **Regression test:** The test database adapter now throws on nested transactions, matching expo-sqlite, so any repository that nests would fail `tests/database.test.ts`. 66/66 pass.

### B-002 Linked study session left open when a timer was replaced or expired
- **Reproduce:** Start a study timer, then start a focus timer, or kill the app and reopen it after the study timer would have ended.
- **Root cause:** Ending or replacing an activity only updated `activity_sessions`; the linked `study_sessions` row kept `ended_at = NULL`, so those minutes never counted.
- **Fix:** `endActivitySession` closes the linked study session at `min(now, ends_at)`; `startActivitySession` ends the previous session through the same path.
- **Regression test:** "closes the linked study session when a timed study activity ends or expires".

### B-003 ProgressBar not exposed to VoiceOver
- **Reproduce:** Turn on VoiceOver and swipe through a budget or study card. The progress value isn't announced.
- **Root cause:** `accessibilityRole="progressbar"` on a `View` without `accessible`.
- **Fix:** Added `accessible` (`src/components/ui.tsx`).
- **Regression test:** "clamps progress and exposes it to VoiceOver".

### B-004 React Compiler lint errors (refs mutated and impure calls during render)
- **Root cause:** `useQuery` mutated a ref during render and spread its deps array; Work and Focus called `Date.now()` during render; App Lock and bootstrap set state synchronously inside effects.
- **Fix:** Ref updated in an effect; deps compared via a stable key; `now` captured in query results and lazy state; the Face ID prompt fires from the lock screen's `onLayout`.
- **Regression test:** `npm run lint` passes with 0 errors.

### B-005 Double top safe-area gap on every tab
- **Reproduce:** Launch the app. A large blank gap appears above the Home title (seen in the iPhone 18 Pro Simulator).
- **Root cause:** `Screen` set `contentInsetAdjustmentBehavior="automatic"`, which already insets for the status bar and tab bar, and also added `insets.top` and `insets.bottom` padding.
- **Fix:** Removed the manual safe-area padding in `src/components/ui.tsx`.
- **Regression check:** Verified visually in the Simulator; Home now sits directly under the status bar.

### B-006 Deprecated native tabs import
- **Root cause:** `expo-router/unstable-native-tabs` is deprecated in SDK 58 and showed a warning banner.
- **Fix:** Import from `expo-router/native-tabs`.

### B-007 Save could use an outdated copy of the form
- **Found:** Simulator testing. Save in a native header button runs whatever function the header was last rendered with.
- **Root cause:** `useSaveAction` captured the form's `onSave` in its closure, so a stale header button could save older values.
- **Fix:** `run` reads the latest save function from a ref and ignores double taps while a save is in flight (`src/components/form.tsx`).
- **Regression tests:** "always saves the latest form values, even from a stale run reference" (fails on the old code, passes on the fix) and "ignores a double tap while a save is running".

### B-008 Form header re-rendered on every keystroke; Save didn't commit the focused field
- **Found:** Simulator testing, where some saves stored a truncated title (for example "Buy printer").
- **What was proven:** the Simulator tool reports typing as finished before it has delivered the keystrokes, so the test tapped Save mid-typing. A person can't do that, so the truncation itself is **not shown to be a user-facing bug**.
- **Real issues fixed along the way:** the form rebuilt its native header options on every keystroke (a native update per character), and Save read state without committing the focused field.
- **Fix:** memoised header options; Save now ends editing, waits for the field's end-editing event (which carries the final native text), then lets React commit before validating.
- **Verified:** instant type-then-Save in the Simulator stores the full text ("Book dentist appointment soon", "Myki top up" with ,234.56).

### B-009 Switches sat mid-row instead of at the right edge
- **Found:** Simulator (iOS 27.2), task form and Settings.
- **Root cause:** the switch was wrapped in an `alignItems: flex-end` box, which doesn't hold with the wider modern iOS switch.
- **Fix:** standard row layout, with the label stretched and the switch last. Verified in the Simulator.

### B-010 Dark theme left native UI light
- **Found:** Simulator. With the in-app theme on Dark, the status bar text was dark and the tab bar used light glass.
- **Root cause:** the theme only changed JS colours; iOS still used the system appearance. After a modal closed, the root status-bar setting was also lost, because each screen controls its own status bar (`UIViewControllerBasedStatusBarAppearance`).
- **Fix:** `Appearance.setColorScheme` applies the theme to iOS, and `statusBarStyle` is set per stack screen. Verified: the status bar stays white after opening and closing a sheet.

### B-011 Timer sheet had no Close button
- **Fix:** added a Close header button. The timer keeps running, so the label is "Close", not "Cancel".

### B-012 Smaller polish
- Deprecated date picker `onChange` replaced with `onValueChange` (removed the in-app warning banner).
- Stat rows top-aligned so labels line up ("Saved" vs "vs last month").
- Study card shows "No marks yet" instead of "Confirmed 0% of 0% marked".

## Known issues / not yet verified

- Not yet exercised in the Simulator: assessment form, habits, income, category budgets, transactions search, App Lock (Face ID needs Features → Face ID → Enrolled in the Simulator). Nothing has been run on a physical iPhone.
- On a DST spring-forward gap (for example 02:30 when clocks jump from 02:00 to 03:00) a shift time resolves forward, as JavaScript `Date` does. This matches iOS Calendar but isn't flagged to the user.
- The app switcher snapshot can show content while App Lock is on (no privacy cover yet).
