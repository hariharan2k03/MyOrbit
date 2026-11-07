/**
 * @jest-environment node
 */
import { randomBytes } from 'node:crypto';
import { pbkdf2Async } from '@noble/hashes/pbkdf2.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { LATEST_VERSION } from '@/database/migrations';
import { loadSettings, saveSetting } from '@/database/repositories/settings';
import { createTask, listTasks } from '@/database/repositories/tasks';
import { createShift, createWorkplace, listShiftsInRange } from '@/database/repositories/work';
import { decryptBackup, encryptBackup, parseEnvelope } from '@/features/backup/backupCrypto';
import { exportData, restoreData, validatePayload } from '@/features/backup/backupData';
import { monthRange } from '@/utils/time';
import { decodeUtf8 } from '@/utils/utf8';
import { createTestDb } from './helpers/testDb';

const random = (n: number) => new Uint8Array(randomBytes(n));
// Fewer iterations than production keeps the suite fast; the file records the count either way.
const FAST = 100_000;

describe('backup encryption', () => {
  it('round-trips text, including emoji and non-Latin scripts', async () => {
    const text = JSON.stringify({ note: 'Café ☕️ — 学习 🎓' });
    const env = await encryptBackup(text, 'correct horse', random, FAST);
    expect(env.data).not.toContain('Caf');
    expect(await decryptBackup(parseEnvelope(JSON.stringify(env)), 'correct horse')).toBe(text);
  });

  it('rejects a wrong password and a tampered file with the same message', async () => {
    const env = await encryptBackup('{"a":1}', 'correct horse', random, FAST);
    await expect(decryptBackup(env, 'wrong horse')).rejects.toThrow(/Wrong password, or the backup file has been changed/);
    const flipped = { ...env, data: (env.data[0] === '0' ? '1' : '0') + env.data.slice(1) };
    await expect(decryptBackup(flipped, 'correct horse')).rejects.toThrow(/Wrong password, or the backup file has been changed/);
  });

  it('uses a fresh salt and nonce every time', async () => {
    const a = await encryptBackup('same', 'correct horse', random, FAST);
    const b = await encryptBackup('same', 'correct horse', random, FAST);
    expect(a.kdf.salt).not.toBe(b.kdf.salt);
    expect(a.cipher.nonce).not.toBe(b.cipher.nonce);
    expect(a.data).not.toBe(b.data);
  });

  it('derives keys exactly per the PBKDF2-HMAC-SHA256 standard (RFC 7914 test vector), like iOS CommonCrypto', async () => {
    const key = await pbkdf2Async(sha256, new TextEncoder().encode('passwd'), new TextEncoder().encode('salt'), { c: 1, dkLen: 64 });
    expect(Buffer.from(key).toString('hex')).toBe(
      '55ac046e56e3089fec1691c22544b605f94185216dde0465e68b9d57c20dacbc49ca9cccf179b645991664b39d77ef317c71b845b1e30bd509112041d3a19783',
    );
  });

  it('refuses short passwords', async () => {
    await expect(encryptBackup('x', 'short', random, FAST)).rejects.toThrow(/at least 8/);
  });

  it('rejects files that aren’t backups, newer formats, and absurd work factors', async () => {
    const env = await encryptBackup('{}', 'correct horse', random, FAST);
    expect(() => parseEnvelope('not json')).toThrow(/isn’t a MyOrbit backup/);
    expect(() => parseEnvelope('{"format":"something-else"}')).toThrow(/isn’t a MyOrbit backup/);
    expect(() => parseEnvelope(JSON.stringify({ ...env, version: 2 }))).toThrow(/newer version/);
    expect(() => parseEnvelope(JSON.stringify({ ...env, kdf: { ...env.kdf, iterations: 1e9 } }))).toThrow(/damaged/);
    expect(() => parseEnvelope(JSON.stringify({ ...env, kdf: { ...env.kdf, iterations: 10 } }))).toThrow(/damaged/);
  });
});

describe('utf8 decoding', () => {
  it('matches TextDecoder, including invalid bytes', () => {
    const samples = [
      new TextEncoder().encode('héllo ☕️ 𝄞 学'),
      new Uint8Array([0x61, 0xff, 0xc3, 0x28, 0xe2, 0x82]),
      new Uint8Array([0xed, 0xa0, 0x80]),
      new Uint8Array([0xe0, 0x80, 0xf0, 0x9f, 0x98, 0xf4, 0x90, 0x80, 0x80, 0xc0, 0xaf]),
    ];
    for (const b of samples) expect(decodeUtf8(b)).toBe(new TextDecoder().decode(b));
  });
});

async function seeded() {
  const db = await createTestDb();
  const wp = await createWorkplace(db, { name: 'Cafe Nero', defaultRateCents: 3050 });
  await createShift(db, { workplaceId: wp, date: '2026-11-10', startTime: '09:00', endTime: '17:00', unpaidBreakMinutes: 30, hourlyRateCents: 3050 });
  await createTask(db, { title: 'Pay rent', priority: 1, category: 'home', dueDate: '2026-11-09', recurrence: 'none' });
  await saveSetting(db, 'displayName', 'Hariharan');
  await saveSetting(db, 'appLockEnabled', true);
  return db;
}

describe('backup data', () => {
  it('restores everything into another database, keeping that device’s App Lock setting', async () => {
    const source = await seeded();
    const text = JSON.stringify(await exportData(source));
    expect(text).not.toContain('appLockEnabled');

    const target = await createTestDb();
    await createTask(target, { title: 'Will be replaced', priority: 2, category: 'personal', dueDate: null, recurrence: 'none' });
    const { payload, summary } = await validatePayload(target, text);
    expect(summary.counts).toMatchObject({ shifts: 1, tasks: 1 });
    await restoreData(target, payload);

    expect((await listTasks(target, {})).map((t) => t.title)).toEqual(['Pay rent']);
    const shifts = await listShiftsInRange(target, monthRange('2026-11-01'));
    expect(shifts.map((s) => s.workplaceName)).toEqual(['Cafe Nero']);
    const settings = await loadSettings(target);
    expect(settings.displayName).toBe('Hariharan');
    expect(settings.appLockEnabled).toBe(false);
  });

  it('rejects backups from a newer schema and data it doesn’t recognise, before changing anything', async () => {
    const db = await seeded();
    const payload = await exportData(db);
    await expect(validatePayload(db, JSON.stringify({ ...payload, schemaVersion: LATEST_VERSION + 1 }))).rejects.toThrow(/newer version/);
    await expect(validatePayload(db, JSON.stringify({ ...payload, tables: { ...payload.tables, secrets: [] } }))).rejects.toThrow(/doesn’t recognise \(secrets\)/);
    const tasks = payload.tables.tasks!.map((t) => ({ ...t, evil: 1 }));
    await expect(validatePayload(db, JSON.stringify({ ...payload, tables: { ...payload.tables, tasks } }))).rejects.toThrow(/tasks\.evil/);
  });

  it('changes nothing if the backup’s records don’t match up', async () => {
    const db = await seeded();
    const payload = await exportData(db);
    // A shift pointing at a workplace that isn't in the file.
    const broken = { ...payload, tables: { ...payload.tables, workplaces: [] } };
    const { payload: checked } = await validatePayload(db, JSON.stringify(broken));
    await expect(restoreData(db, checked)).rejects.toThrow(/don’t match up/);
    expect((await listTasks(db, {})).map((t) => t.title)).toEqual(['Pay rent']);
    expect(await listShiftsInRange(db, monthRange('2026-11-01'))).toHaveLength(1);
    // Foreign keys are back on afterwards.
    expect(await db.getFirstAsync<{ foreign_keys: number }>('PRAGMA foreign_keys')).toEqual({ foreign_keys: 1 });
  });
});
