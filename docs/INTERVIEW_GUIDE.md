# MyOrbit — Interview Guide

Everything you need to explain MyOrbit in an interview: what it is, how each part works, why it was built that way, the hard problems, and answers to common questions.

---

## 1. The 30-second pitch

> "MyOrbit is an iPhone app I built for my own life as a student who works casual shifts. It manages my work shifts and pay, money, study and tasks in one place. The standout feature: I photograph my work roster and the app reads it on the phone, finds only my shifts, and adds them — including 'Close' shifts and split shifts. I clock in and out from notifications, and it calculates my pay with night and weekend penalty rates and estimates tax using ATO rates. Everything runs offline on the device — no server, no account — with Face ID lock and encrypted backups. It's React Native with TypeScript, SQLite, and native Swift for text recognition, Siri, widgets and on-device AI. It has 200+ automated tests."

---

## 2. The problem

- I work at Nando's on a weekly roster (a spreadsheet photo with every staff member).
- Copying my shifts by hand was slow and error-prone.
- Pay is complicated: different rates for night, Saturday, Sunday; closing time differs by day.
- I also needed to track spending, uni subjects and tasks, and didn't want 5 different apps or to give my data to a company.

**Goal:** one private app that does all of it, works offline, and is accurate with money.

---

## 3. Main features

| Area | What it does |
|---|---|
| **Roster upload** | Photo/screenshot/PDF of the team roster → reads it on-device → keeps only my rows → I review and save |
| **Roster changes** | Re-uploading a week marks shifts New / Changed (shows old time) / Removed, and sends a notification |
| **Clock in / out** | Buttons unlock 10 min before start / 30 min before end; also from Lock Screen notifications |
| **Pay & tax** | Penalty rates minute-by-minute, night pay start by weekday, ATO 2026–27 tax + Medicare estimate, weekly / fortnightly / monthly |
| **Work records** | Clocked vs rostered hours, earnings, corrections |
| **Money** | Income, expenses, budgets, categories; Apple Pay purchases logged automatically via Shortcuts |
| **Study** | Subjects, assessments, grades, study sessions |
| **Tasks & habits** | Recurring tasks, habit streaks |
| **Calendar** | Shifts, deadlines, and subscribed uni timetable (.ics) in one view |
| **Reminders** | Local notifications for shifts, clock in/out, deadlines, tasks, habits |
| **iOS extras** | Home Screen widget with tick-off buttons, Live Activity timer, Siri / Shortcuts actions |
| **Privacy** | Face ID lock, hidden in app switcher, AES-256 encrypted backups |
| **Personal AI** | Apple's on-device model answers questions about my own data (no internet) |

---

## 4. Tech stack — and why

| Layer | Choice | Why |
|---|---|---|
| App framework | **React Native 0.88 + Expo SDK 58** | One codebase, fast iteration, access to native modules when needed |
| Language | **TypeScript (strict)** | Catches mistakes at compile time — important for money calculations |
| Navigation | **Expo Router** | File-based routes: each file in `src/app/` is a screen |
| Database | **SQLite (expo-sqlite)** | Offline, fast, real SQL, transactions and constraints |
| Native code | **Swift** (Expo Modules) | Apple Vision OCR, PDFKit, App Intents (Siri), Foundation Models (AI), CommonCrypto |
| Security | expo-local-authentication, expo-secure-store | Face ID, Keychain |
| Tests | **Jest** + real SQLite via better-sqlite3 | Tests run the same SQL as the app |

**Why offline-first?** Pay, roster and spending are personal data. No server means no data breach risk, no running costs, and it works with no signal.

---

## 5. Architecture (how the code is organised)

```
Screens (src/app/*.tsx)          ← what you see; Expo Router
        │
Services (src/services/)         ← talk to iOS: notifications, OCR, Face ID, widgets
        │
Features (src/features/*)        ← PURE logic: pay maths, roster parser, tax, reminders plan
        │
Repositories (src/database/repositories/)  ← all SQL lives here
        │
SQLite database  +  migrations (versioned)
```

- **Native Swift modules** (`modules/myorbit-ai/ios/`): roster text recognition, on-device AI, fast PBKDF2, reading the Siri/Shortcuts queue.
- **App Intents** (`plugins/app-intents/`): Siri and Shortcuts actions, copied into the iOS project by a config plugin.

**Key principle:** business logic is *pure functions* (no UI, no database). That makes it easy to test thoroughly — e.g. the roster parser takes text positions in and returns shifts out.

---

## 6. Data design

- **18 tables**: workplaces, work_shifts, expenses, income, budgets, subjects, assessments, tasks, habits, calendar_feeds, pending_purchases, etc.
- **Migrations**: 7 versions. Each runs inside a transaction and updates `PRAGMA user_version`, so the database is never half-upgraded. Users keep their data across app updates.
- **Money is stored as integer cents** (e.g. $30.50 = 3050). Never floats — floats cause rounding errors like 0.1 + 0.2 = 0.30000000000000004.
- **Dates** are local `YYYY-MM-DD` keys; times are exact instants (milliseconds). Shift length uses real elapsed time, so daylight-saving changes are paid correctly.
- **Constraints in SQL**: e.g. `CHECK (end_at > start_at)`, clock-out must be after clock-in, unique shift per workplace and start time.

---

## 7. How each key feature works

### 7.1 Pay calculation (`src/features/work/payRates.ts`)
- Walks the shift **minute by minute**.
- For each minute it checks: is it Saturday? Sunday? inside the night window?
- That minute is paid at the **highest rate** that applies.
- Night pay start can differ by weekday (Mon–Wed 10 PM, Thu–Sun 10:30 PM). After midnight it belongs to the previous night, so only the end time matters.
- Unpaid break is taken from the middle of the shift.
- Result: segments like "Ordinary 4h $120, Night 30m $18".
- **Tax estimate**: annualise the period's pay, apply ATO resident brackets + 2% Medicare levy, divide back. Clearly labelled as an estimate.

### 7.2 Roster upload — the hardest part
**Step 1: Read the text (Swift, Apple Vision).**
The photo/PDF is passed to `VNRecognizeTextRequest` on the phone. It returns each line of text with its **position** (x, y, width, height). Language correction is off, because it "corrects" names and times into dictionary words.

**Step 2: Turn text into "pieces" (TypeScript).**
Each line is scanned with regular expressions for: dates ("16-Nov", "Mon 9/11"), time ranges ("12-4", "6pm–10pm", "0900-1700", "9.30-4.00"), "Close" shifts ("5-Close"), my name, and "OFF".

**Step 3: Find the layout.**
- *Team grid* (days across, people down) — most common.
- *Transposed grid* (people across, days down).
- *List* or *personal* roster.

**Step 4: Find my row and read each day's cell.**
- Find my name (tolerates OCR slips like "HARlHARAN" using edit distance).
- Find the header row(s) above. If there are two header rows ("16-Nov" above "Mon (9.30 PM)"), combine them.
- Work out my **row band**: from just below the name above to just below my name. Spreadsheet rosters put names at the bottom of tall cells, and split shifts have a line above.
- For each column, take every time in my band → handles split shifts ("11-4.00/" + "5-Close").

**Step 5: Fill in missing information.**
- **am/pm guessing**: "12-4" → 12–4 PM; "6-10" → 6–10 PM; "9-5" → 9–5. It picks the most plausible, shortest valid shift.
- **"Close"** → the workplace's closing time *for that weekday* (Mon–Wed 10:30 PM, Thu–Sun 11 PM).
- **Tilted photo** → measures the slope between neighbouring text and straightens everything first (deskew).

**Step 6: Review screen.** I see every shift, tick/untick, edit, then save.

**Real bugs found by testing on my actual roster** (great interview story — see section 9).

### 7.3 Roster changes (`rosterSync.ts`)
- Compares the new roster with saved shifts in the same weeks.
- Matches by **same day + most overlap**, so a shift moved from 12–4 to 1–5 shows as *Changed*, not *New + Removed*.
- **Never changes a shift already worked** (completed or clocked in).
- Saves everything in **one database transaction**: cancellations first, then moves, then new — so if anything fails, nothing is half-saved.

### 7.4 Clock in / out (`clock.ts`, `ClockCard.tsx`)
- A small **state machine**: not yet → can clock in → working → done (or missed / cancelled).
- Clock In opens X minutes before start; Clock Out opens Y minutes before end (configurable).
- Clocking out late saves immediately at the real time, then offers "use rostered finish instead".
- **Lock Screen**: notifications have **Clock In / Clock Out buttons** (iOS notification categories, Face ID required).
- Removed the live timer / Live Activity during shifts to **save battery** (user feedback).
- Once clocked out, hours and pay use **clocked** times instead of rostered.

### 7.5 Reminders (`planReminders.ts`)
- iOS allows only **64 pending notifications per app**.
- So the app **re-plans all reminders from the data** whenever data changes: cancel all, schedule the next ≤60. Simple and can never leave a stale reminder for a deleted shift.

### 7.6 Apple Pay auto-tracking
- iOS doesn't let apps read bank data, so it uses a **Shortcuts Wallet automation**: "when I tap my card → run MyOrbit's *Log Apple Pay Purchase* action".
- The action (an **App Intent** in Swift) doesn't touch the database. It writes a small JSON item into a shared **App Group** queue; the app applies it next time it opens, with its normal validation.
- **Category guessing**: first learns from my past choices for that store, then known Australian stores (Woolworths → Groceries, Myki → Transport…), else "Other".
- **Debugging story**: added an "Automation status" screen that records the last run. It showed Wallet was sending an empty amount — so purchases without an amount are now kept as "Needs an amount" instead of being lost.

### 7.7 Encrypted backup
- **AES-256-GCM** encryption, key from my password with **PBKDF2-SHA256, 310,000 iterations** (OWASP guidance).
- PBKDF2 in JavaScript took ~1 minute, so I moved it to **native Swift (CommonCrypto)** — under a second, same output.
- GCM also detects tampering or a wrong password.

### 7.8 On-device AI
- Uses **Apple Foundation Models** (iOS 26+), which run on the phone.
- The app builds a short summary of my own data (shifts, spending, deadlines) and asks the model. Nothing leaves the device.

### 7.9 Face ID & privacy
- App Lock with Face ID / passcode; re-locks after leaving the app for a set time.
- Content is covered in the app switcher so pay and shifts don't show.

---

## 8. Testing

- **202 automated tests** in 13 files (~2,000 lines).
- Tests use a **real SQLite database** (better-sqlite3 in memory), running the exact production SQL.
- Pure logic (pay, tax, roster parser, reminders, clock rules) is tested with many edge cases: overnight shifts, daylight saving, tilted photos, split shifts, OCR mistakes.
- Tests run with a fixed timezone (Australia/Melbourne) so date tests are reliable.
- I also tested the roster reader on **my real Nando's rosters** using the same Apple Vision settings on my Mac, then wrote anonymised tests that copy their layout.
- Typecheck (`tsc`) and lint run before every install.

---

## 9. Hard problems I solved (tell these as stories)

**1. "Close" shifts and split shifts on the real roster.**
*Situation*: the first version worked on test images but missed most of my real shifts. *Cause*: real rosters say "5-Close" (no end time), have split shifts on two lines, two header rows, and names at the bottom of tall cells. *Fix*: added closing times per weekday, read every time in a cell, merged header rows, and defined the row band from "just below the name above". *Result*: all 3 real rosters read exactly right.

**2. A row picking up the neighbour's shifts.**
Rows on the roster were only ~1.3 text-lines apart, so the cell below could be mistaken as mine. I measured the actual positions, found the boundary was off by 0.001, and changed the rule to use the name above as the boundary.

**3. Apple Pay purchases not appearing.**
Instead of guessing, I added diagnostics: the automation saves what it received. That showed Wallet sent no amount. I changed the design so nothing is lost: purchases without an amount ask me to add it.

**4. App stopped opening after a week.**
Free Apple developer signing lasts 7 days, and Xcode kept reusing the old profile. I diagnosed it from the signing profile dates and changed the install script to remove expiring profiles and print the real expiry date.

**5. Building inside iCloud Drive broke code signing.**
iCloud adds hidden file attributes ("resource fork… not allowed"). I moved build output out of iCloud and kept large generated folders in `.nosync` folders.

**6. Battery.** User feedback: a live timer during an 8-hour shift wastes battery. Replaced it with clock in/out from notifications and a once-a-minute "worked" time in the app.

---

## 10. Trade-offs and what I'd do next

- **Offline vs bank sync**: bank sync (Open Banking) would be fully automatic but needs a server, a paid provider, and data leaving the phone. I chose privacy; next step is importing bank SMS alerts or statements.
- **Free signing** means reinstalling weekly; a paid Apple Developer account would allow TestFlight.
- **OCR is heuristic**: unusual roster layouts may need tuning, so the review screen always lets me correct before saving.
- **Next features**: payslip check (detect underpayment), visa 48-hour fortnight tracker, weekly summary.

---

## 11. Likely interview questions — sample answers

**Q: Why React Native and not Swift only?**
A: Most of the app is UI and logic that's faster to build in TypeScript, and I could still write Swift where iOS-only APIs were needed (Vision, App Intents, Foundation Models). It's the best of both.

**Q: How do you store money?**
A: As integer cents, never floating point, to avoid rounding errors. Rounding happens once, per pay segment, half up.

**Q: How do you handle database changes between app versions?**
A: Versioned migrations. Each runs in a transaction and bumps `PRAGMA user_version`. If one fails it rolls back, so data is never left half-migrated.

**Q: How does the roster reader know which shifts are yours?**
A: It finds my name (allowing small OCR mistakes), finds the day headers above, then reads only the cells in my row's vertical band and each day's column. It straightens tilted photos first.

**Q: What was the hardest bug?**
A: Real rosters. (Tell story 1 or 2 from section 9.)

**Q: How did you test OCR, which is unpredictable?**
A: I separated it: Swift returns text + positions, and the parser is a pure TypeScript function. I recorded real OCR output, then wrote unit tests with the same shapes — tilted, merged lines, split cells, misread letters.

**Q: How do you keep reminders correct when shifts change?**
A: I never edit individual notifications. I rebuild the whole plan from the database on every change, within iOS's 64-notification limit.

**Q: How is the data secured?**
A: It never leaves the phone. Face ID lock, hidden in app switcher, iOS file encryption, and backups encrypted with AES-256-GCM using a PBKDF2-derived key.

**Q: How would you scale this to many users?**
A: Add optional sync with end-to-end encryption, publish via TestFlight/App Store, add crash reporting, and make roster layouts configurable per employer.

**Q: What did you learn?**
A: Test with real data early — my synthetic tests passed, but the real roster exposed layout issues. Also: add diagnostics before guessing (the Apple Pay status screen).

---

## 12. Numbers to remember

- ~14,000 lines of TypeScript, ~540 lines of Swift
- 32 screens, 18 database tables, 7 migrations
- 202 automated tests
- Penalty pay calculated per minute; tax with ATO 2026–27 rates + 2% Medicare
- Backup: AES-256-GCM, PBKDF2 310,000 iterations
- iOS notification limit: 64 (app keeps ≤60)

---

## 13. Be honest about how it was built

If you used AI tools while building it, say so confidently — employers expect it now. A good way to put it:

> "I used AI coding assistance. My part was defining what the app must do, testing it on my real roster and phone, finding the problems — like Close shifts, battery drain and Apple Pay amounts — and deciding the fixes and trade-offs. I can walk you through any part of the code."

Then make sure that last sentence is true: open each file mentioned in section 7, read it with this guide, and practise explaining it out loud.
