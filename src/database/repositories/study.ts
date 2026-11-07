import { unwrap, ValidationError } from '@/utils/result';
import { toDateKey, type DateKey, type DateRange } from '@/utils/time';
import { cleanText, LIMITS } from '@/utils/validation';
import type { SqlDb } from '../types';

export interface Subject {
  id: number;
  code: string | null;
  name: string;
  color: string;
  targetPercent: number | null;
  weeklyGoalMinutes: number;
}

export type AssessmentStatus = 'pending' | 'submitted' | 'marked';
export const ASSESSMENT_KINDS = ['assignment', 'exam', 'quiz', 'other'] as const;
export type AssessmentKind = (typeof ASSESSMENT_KINDS)[number];

export interface Assessment {
  id: number;
  subjectId: number;
  subjectName: string;
  subjectColor: string;
  kind: AssessmentKind;
  title: string;
  dueAt: number | null;
  weightBp: number;
  markObtained: number | null;
  markTotal: number | null;
  status: AssessmentStatus;
  notes: string | null;
}

export interface StudySession {
  id: number;
  subjectId: number;
  subjectName: string;
  sessionDate: DateKey;
  startedAt: number;
  endedAt: number | null;
  plannedMinutes: number;
}

export interface SubjectInput {
  code?: string | null;
  name: string;
  color?: string;
  targetPercent?: number | null;
  weeklyGoalMinutes?: number;
}

function cleanSubject(input: SubjectInput) {
  const target = input.targetPercent ?? null;
  if (target !== null && (!Number.isInteger(target) || target < 0 || target > 100)) {
    throw new ValidationError('Target grade must be between 0 and 100.');
  }
  const goal = input.weeklyGoalMinutes ?? 0;
  if (!Number.isInteger(goal) || goal < 0 || goal > 100 * 60) throw new ValidationError('Weekly goal must be 0–100 hours.');
  return {
    code: unwrap(cleanText(input.code, 'Subject code', LIMITS.code)).toUpperCase() || null,
    name: unwrap(cleanText(input.name, 'Subject name', LIMITS.name, { required: true })),
    color: /^#[0-9A-Fa-f]{6}$/.test(input.color ?? '') ? input.color! : '#A78BFA',
    target,
    goal,
  };
}

export async function listSubjects(db: SqlDb): Promise<Subject[]> {
  const rows = await db.getAllAsync<{
    id: number;
    code: string | null;
    name: string;
    color: string;
    target_percent: number | null;
    weekly_goal_minutes: number;
  }>('SELECT * FROM subjects WHERE archived = 0 ORDER BY name');
  return rows.map((r) => ({
    id: r.id,
    code: r.code,
    name: r.name,
    color: r.color,
    targetPercent: r.target_percent,
    weeklyGoalMinutes: r.weekly_goal_minutes,
  }));
}

export async function createSubject(db: SqlDb, input: SubjectInput): Promise<number> {
  const s = cleanSubject(input);
  const now = Date.now();
  const r = await db.runAsync(
    `INSERT INTO subjects (code, name, color, target_percent, weekly_goal_minutes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [s.code, s.name, s.color, s.target, s.goal, now, now],
  );
  return r.lastInsertRowId;
}

export async function updateSubject(db: SqlDb, id: number, input: SubjectInput): Promise<void> {
  const s = cleanSubject(input);
  await db.runAsync(
    `UPDATE subjects SET code = ?, name = ?, color = ?, target_percent = ?, weekly_goal_minutes = ?, updated_at = ? WHERE id = ?`,
    [s.code, s.name, s.color, s.target, s.goal, Date.now(), id],
  );
}

/** Deletes a subject and (via ON DELETE CASCADE) its assessments and sessions. The UI confirms first. */
export async function deleteSubject(db: SqlDb, id: number): Promise<void> {
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `DELETE FROM reminders WHERE entity_type = 'assessment' AND entity_id IN (SELECT id FROM assessments WHERE subject_id = ?)`,
      [id],
    );
    await db.runAsync('DELETE FROM subjects WHERE id = ?', [id]);
  });
}

// ── Assessments ─────────────────────────────────────────────────────────────

export interface AssessmentInput {
  subjectId: number;
  kind?: AssessmentKind;
  title: string;
  dueAt: number | null;
  weightBp: number;
  markObtained?: number | null;
  markTotal?: number | null;
  notes?: string | null;
}

function cleanAssessment(input: AssessmentInput) {
  if (!Number.isInteger(input.weightBp) || input.weightBp < 0 || input.weightBp > 10_000) {
    throw new ValidationError('Weighting must be between 0% and 100%.');
  }
  const obtained = input.markObtained ?? null;
  const total = input.markTotal ?? null;
  if ((obtained === null) !== (total === null)) throw new ValidationError('Enter both the mark and the total, or neither.');
  if (total !== null && obtained !== null) {
    if (!(total > 0) || total > 10_000) throw new ValidationError('Mark total must be greater than zero.');
    if (!(obtained >= 0) || obtained > total) throw new ValidationError('Mark must be between 0 and the total.');
  }
  if (input.dueAt !== null && !Number.isFinite(input.dueAt)) throw new ValidationError('Due date is invalid.');
  const kind = input.kind ?? 'assignment';
  if (!ASSESSMENT_KINDS.includes(kind)) throw new ValidationError('Choose an assessment type.');
  return {
    title: unwrap(cleanText(input.title, 'Title', LIMITS.title, { required: true })),
    notes: unwrap(cleanText(input.notes, 'Notes', LIMITS.notes)) || null,
    obtained,
    total,
    status: (obtained !== null ? 'marked' : 'pending') as AssessmentStatus,
    kind,
  };
}

/** Rejects edits that would push a subject's total weighting above 100%. */
async function assertWeightFits(db: SqlDb, subjectId: number, weightBp: number, excludeId: number | null) {
  const r = await db.getFirstAsync<{ total: number }>(
    'SELECT COALESCE(SUM(weight_bp), 0) AS total FROM assessments WHERE subject_id = ? AND id != ?',
    [subjectId, excludeId ?? -1],
  );
  const total = (r?.total ?? 0) + weightBp;
  if (total > 10_000) throw new ValidationError(`Weightings for this subject would total ${total / 100}%, which is over 100%.`);
}

export async function createAssessment(db: SqlDb, input: AssessmentInput): Promise<number> {
  const a = cleanAssessment(input);
  await assertWeightFits(db, input.subjectId, input.weightBp, null);
  const now = Date.now();
  const r = await db.runAsync(
    `INSERT INTO assessments (subject_id, kind, title, due_at, weight_bp, mark_obtained, mark_total, status, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [input.subjectId, a.kind, a.title, input.dueAt, input.weightBp, a.obtained, a.total, a.status, a.notes, now, now],
  );
  return r.lastInsertRowId;
}

export async function updateAssessment(db: SqlDb, id: number, input: AssessmentInput): Promise<void> {
  const a = cleanAssessment(input);
  await assertWeightFits(db, input.subjectId, input.weightBp, id);
  await db.runAsync(
    `UPDATE assessments SET subject_id = ?, kind = ?, title = ?, due_at = ?, weight_bp = ?, mark_obtained = ?, mark_total = ?,
       status = ?, notes = ?, updated_at = ? WHERE id = ?`,
    [input.subjectId, a.kind, a.title, input.dueAt, input.weightBp, a.obtained, a.total, a.status, a.notes, Date.now(), id],
  );
}

export async function deleteAssessment(db: SqlDb, id: number): Promise<void> {
  await db.withTransactionAsync(async () => {
    await db.runAsync(`DELETE FROM reminders WHERE entity_type = 'assessment' AND entity_id = ?`, [id]);
    await db.runAsync('DELETE FROM assessments WHERE id = ?', [id]);
  });
}

type AssessmentRow = {
  id: number;
  subject_id: number;
  subject_name: string;
  subject_color: string;
  kind: AssessmentKind;
  title: string;
  due_at: number | null;
  weight_bp: number;
  mark_obtained: number | null;
  mark_total: number | null;
  status: AssessmentStatus;
  notes: string | null;
};

const toAssessment = (r: AssessmentRow): Assessment => ({
  id: r.id,
  subjectId: r.subject_id,
  subjectName: r.subject_name,
  subjectColor: r.subject_color,
  kind: r.kind,
  title: r.title,
  dueAt: r.due_at,
  weightBp: r.weight_bp,
  markObtained: r.mark_obtained,
  markTotal: r.mark_total,
  status: r.status,
  notes: r.notes,
});

const ASSESSMENT_SELECT = `SELECT a.*, s.name AS subject_name, s.color AS subject_color
  FROM assessments a JOIN subjects s ON s.id = a.subject_id`;

export async function listAssessments(db: SqlDb, subjectId?: number): Promise<Assessment[]> {
  const rows = await db.getAllAsync<AssessmentRow>(
    `${ASSESSMENT_SELECT} ${subjectId ? 'WHERE a.subject_id = ?' : ''} ORDER BY a.due_at IS NULL, a.due_at`,
    subjectId ? [subjectId] : [],
  );
  return rows.map(toAssessment);
}

export async function listUpcomingAssessments(db: SqlDb, now: number, limit = 5): Promise<Assessment[]> {
  const rows = await db.getAllAsync<AssessmentRow>(
    `${ASSESSMENT_SELECT} WHERE a.status = 'pending' AND a.due_at >= ? AND s.archived = 0 ORDER BY a.due_at LIMIT ?`,
    [now, limit],
  );
  return rows.map(toAssessment);
}

// ── Study sessions ──────────────────────────────────────────────────────────

export async function startStudySession(
  db: SqlDb,
  subjectId: number,
  plannedMinutes: number,
  now = Date.now(),
): Promise<number> {
  if (!Number.isInteger(plannedMinutes) || plannedMinutes < 1 || plannedMinutes > 600) {
    throw new ValidationError('Session length must be 1–600 minutes.');
  }
  const r = await db.runAsync(
    `INSERT INTO study_sessions (subject_id, session_date, started_at, planned_minutes, created_at) VALUES (?, ?, ?, ?, ?)`,
    [subjectId, toDateKey(new Date(now)), now, plannedMinutes, now],
  );
  return r.lastInsertRowId;
}

export async function endStudySession(db: SqlDb, id: number, now = Date.now()): Promise<void> {
  await db.runAsync('UPDATE study_sessions SET ended_at = MAX(?, started_at) WHERE id = ? AND ended_at IS NULL', [now, id]);
}

/** Logs a session that already happened (manual entry). */
export async function logStudySession(db: SqlDb, subjectId: number, date: DateKey, startedAt: number, minutes: number): Promise<number> {
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 600) throw new ValidationError('Session length must be 1–600 minutes.');
  const r = await db.runAsync(
    `INSERT INTO study_sessions (subject_id, session_date, started_at, ended_at, planned_minutes, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [subjectId, date, startedAt, startedAt + minutes * 60_000, minutes, Date.now()],
  );
  return r.lastInsertRowId;
}

export async function deleteStudySession(db: SqlDb, id: number): Promise<void> {
  await db.runAsync('DELETE FROM study_sessions WHERE id = ?', [id]);
}

export async function listStudySessions(db: SqlDb, range: DateRange): Promise<StudySession[]> {
  const rows = await db.getAllAsync<{
    id: number;
    subject_id: number;
    subject_name: string;
    session_date: string;
    started_at: number;
    ended_at: number | null;
    planned_minutes: number;
  }>(
    `SELECT ss.*, s.name AS subject_name FROM study_sessions ss JOIN subjects s ON s.id = ss.subject_id
     WHERE ss.session_date >= ? AND ss.session_date < ? ORDER BY ss.started_at`,
    [range.start, range.end],
  );
  return rows.map((r) => ({
    id: r.id,
    subjectId: r.subject_id,
    subjectName: r.subject_name,
    sessionDate: r.session_date,
    startedAt: r.started_at,
    endedAt: r.ended_at,
    plannedMinutes: r.planned_minutes,
  }));
}

/** Completed minutes per subject in a range (open sessions are excluded). */
export async function studyMinutesBySubject(db: SqlDb, range: DateRange): Promise<Map<number, number>> {
  const rows = await db.getAllAsync<{ subject_id: number; minutes: number }>(
    `SELECT subject_id, CAST(SUM((ended_at - started_at) / 60000) AS INTEGER) AS minutes FROM study_sessions
     WHERE ended_at IS NOT NULL AND session_date >= ? AND session_date < ? GROUP BY subject_id`,
    [range.start, range.end],
  );
  return new Map(rows.map((r) => [r.subject_id, r.minutes]));
}
