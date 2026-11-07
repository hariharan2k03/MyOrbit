import * as Crypto from 'expo-crypto';
import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import type { SqlDb } from '@/database/types';
import { decryptBackup, encryptBackup, parseEnvelope, type BackupEnvelope } from '@/features/backup/backupCrypto';
import { exportData, restoreData, validatePayload, type BackupPayload, type BackupSummary } from '@/features/backup/backupData';
import { ValidationError } from '@/utils/result';
import { todayKey } from '@/utils/time';

/** Backups are a few hundred KB for years of data; anything far bigger isn't ours. */
const MAX_BYTES = 25 * 1024 * 1024;

/**
 * Encrypts everything into a file and opens the share sheet, so the user picks
 * where it goes (Files/iCloud Drive, AirDrop, …). The temporary copy is
 * deleted afterwards; nothing is uploaded by MyOrbit itself.
 */
export async function shareBackup(db: SqlDb, password: string): Promise<void> {
  if (!(await Sharing.isAvailableAsync())) throw new ValidationError('Sharing isn’t available on this device.');
  const payload = await exportData(db);
  const envelope = await encryptBackup(JSON.stringify(payload), password, Crypto.getRandomBytes);
  const file = new File(Paths.cache, `MyOrbit-Backup-${todayKey()}.json`);
  file.create({ overwrite: true });
  await file.write(JSON.stringify(envelope));
  try {
    await Sharing.shareAsync(file.uri, { mimeType: 'application/json', UTI: 'public.json', dialogTitle: 'Save MyOrbit backup' });
  } finally {
    if (file.exists) file.delete();
  }
}

/** Lets the user choose a backup file. Returns null if they cancel. */
export async function pickBackup(): Promise<BackupEnvelope | null> {
  const result = await DocumentPicker.getDocumentAsync({ type: ['application/json', 'public.json', '*/*'], copyToCacheDirectory: true });
  if (result.canceled || !result.assets[0]) return null;
  const asset = result.assets[0];
  if ((asset.size ?? 0) > MAX_BYTES) throw new ValidationError('That file is too big to be a MyOrbit backup.');
  const file = new File(asset.uri);
  try {
    return parseEnvelope(await file.text());
  } finally {
    if (file.exists) file.delete();
  }
}

/** Decrypts and checks a backup without changing anything. */
export async function openBackup(db: SqlDb, envelope: BackupEnvelope, password: string): Promise<{ payload: BackupPayload; summary: BackupSummary }> {
  return validatePayload(db, await decryptBackup(envelope, password));
}

export { restoreData };
