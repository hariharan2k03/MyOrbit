# Database Schema

SQLite file `daypilot.db` in the app's sandbox. The source of truth is [`src/database/migrations.ts`](src/database/migrations.ts).

## Conventions

| Suffix | Type | Meaning |
| --- | --- | --- |
| `*_at` | INTEGER | Instant, epoch milliseconds |
| `*_date` | TEXT | Local calendar date `YYYY-MM-DD` (never shifts with timezone) |
| `*_cents` | INTEGER | Money in AUD cents |
| `*_bp` | INTEGER | Percentage in basis points (25% = 2500) |

`PRAGMA foreign_keys = ON` and `journal_mode = WAL` are set on every connection.

## Tables

| Table | Purpose | Key constraints |
| --- | --- | --- |
| `settings` | Typed app settings as JSON values | PK `key` |
| `workplaces` | Employers and default hourly rate | UNIQUE `name` (case-insensitive) |
| `work_shifts` | Shifts with resolved start/end instants | FK workplace (RESTRICT); UNIQUE (workplace, start); CHECK end > start; status ∈ scheduled/completed/cancelled |
| `expense_categories` | 9 seeded categories | UNIQUE name |
| `expenses` | Spending | FK category (RESTRICT); CHECK amount > 0; index (date), (category, date) |
| `income` | Money actually received | FK workplace (SET NULL); category enum |
| `budgets` | Overall (`category_id` NULL) and per-category limits | UNIQUE category; partial unique index for one overall budget; start day 1–28 |
| `subjects` | University units | target 0–100, weekly goal minutes |
| `assessments` | Assessment items | FK subject (CASCADE); weight 0–10000 bp; mark ≤ total |
| `study_sessions` | Logged or timed study | FK subject (CASCADE), assessment (SET NULL); ended ≥ started |
| `tasks` | To-dos, optionally recurring | priority 1–3; category and recurrence enums |
| `habits` | Daily/weekly habits | target 1–7 |
| `habit_logs` | One completion per habit per day | FK habit (CASCADE); UNIQUE (habit, date) |
| `events` | Important one-off events (UI pending) | |
| `reminders` | Scheduled notification bookkeeping (UI pending) | UNIQUE (entity type, entity id, kind) |
| `activity_sessions` | Persisted timers that drive Live Activities | partial UNIQUE index: at most one `active` row |

## Relationships

```
workplaces 1─* work_shifts
workplaces 1─* income            (optional)
expense_categories 1─* expenses
expense_categories 1─1 budgets   (optional; NULL = overall)
subjects 1─* assessments
subjects 1─* study_sessions
assessments 1─* study_sessions   (optional)
habits 1─* habit_logs
activity_sessions ─> study_sessions | work_shifts   (soft link: entity_type + entity_id)
reminders ─> any entity          (soft link; cleaned up when the entity is deleted)
```

## Migrations

- Tracked with `PRAGMA user_version`.
- Each migration runs in its own transaction and rolls back fully on error.
- An app version older than the database refuses to open it rather than risk corruption.
- Migrations are append-only and never drop user data.

| Version | Description |
| --- | --- |
| 1 | Initial schema (all tables above, seeded expense categories) |
