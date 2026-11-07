import { gcm } from '@noble/ciphers/aes.js';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/ciphers/utils.js';
import { pbkdf2Async } from '@noble/hashes/pbkdf2.js';
import { requireOptionalNativeModule } from 'expo';
import { sha256 } from '@noble/hashes/sha2.js';
import { ValidationError } from '@/utils/result';
import { decodeUtf8 } from '@/utils/utf8';

/**
 * Backup file envelope. The data is AES-256-GCM encrypted with a key derived
 * from the user's backup password (PBKDF2-SHA256), so a backup copied to
 * iCloud Drive, AirDrop or email is unreadable without the password. GCM's
 * authentication tag also detects any change to the file.
 */
export interface BackupEnvelope {
  format: 'myorbit-backup';
  version: 1;
  kdf: { name: 'PBKDF2-SHA256'; iterations: number; salt: string };
  cipher: { name: 'AES-256-GCM'; nonce: string };
  /** Hex ciphertext + tag. */
  data: string;
}

/** OWASP's PBKDF2-SHA256 guidance (2021). Stored in the file, so it can be raised later. */
export const PBKDF2_ITERATIONS = 310_000;
export const MIN_PASSWORD_LENGTH = 8;
/** Envelopes outside these bounds are rejected before any work (a crafted file can't hang the app). */
const MAX_ITERATIONS = 5_000_000;

export type RandomBytes = (n: number) => Uint8Array;

// Native CommonCrypto PBKDF2 on iOS (fast); the identical JS version runs in tests.
const native = requireOptionalNativeModule<{ pbkdf2Sha256(password: string, saltHex: string, iterations: number, keyLength: number): Promise<string> }>('MyOrbitCrypto');

async function deriveKey(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const pw = password.normalize('NFKC');
  if (native) return hexToBytes(await native.pbkdf2Sha256(pw, bytesToHex(salt), iterations, 32));
  return pbkdf2Async(sha256, utf8ToBytes(pw), salt, { c: iterations, dkLen: 32 });
}

export async function encryptBackup(plaintext: string, password: string, random: RandomBytes, iterations = PBKDF2_ITERATIONS): Promise<BackupEnvelope> {
  if (password.length < MIN_PASSWORD_LENGTH) throw new ValidationError(`Use a backup password of at least ${MIN_PASSWORD_LENGTH} characters.`);
  const salt = random(16);
  const nonce = random(12);
  const key = await deriveKey(password, salt, iterations);
  const data = gcm(key, nonce).encrypt(utf8ToBytes(plaintext));
  return {
    format: 'myorbit-backup',
    version: 1,
    kdf: { name: 'PBKDF2-SHA256', iterations, salt: bytesToHex(salt) },
    cipher: { name: 'AES-256-GCM', nonce: bytesToHex(nonce) },
    data: bytesToHex(data),
  };
}

const HEX = /^[0-9a-f]*$/;

/** Validates the outer file before touching the password. */
export function parseEnvelope(text: string): BackupEnvelope {
  let e: unknown;
  try {
    e = JSON.parse(text);
  } catch {
    throw new ValidationError('This isn’t a MyOrbit backup file.');
  }
  const env = e as Partial<BackupEnvelope>;
  if (env?.format !== 'myorbit-backup') throw new ValidationError('This isn’t a MyOrbit backup file.');
  if (env.version !== 1) throw new ValidationError('This backup was made by a newer version of MyOrbit. Update the app first.');
  const it = env.kdf?.iterations;
  const ok =
    env.kdf?.name === 'PBKDF2-SHA256' &&
    Number.isInteger(it) &&
    it! >= 100_000 &&
    it! <= MAX_ITERATIONS &&
    typeof env.kdf.salt === 'string' &&
    env.kdf.salt.length === 32 &&
    HEX.test(env.kdf.salt) &&
    env.cipher?.name === 'AES-256-GCM' &&
    typeof env.cipher.nonce === 'string' &&
    env.cipher.nonce.length === 24 &&
    HEX.test(env.cipher.nonce) &&
    typeof env.data === 'string' &&
    env.data.length % 2 === 0 &&
    env.data.length >= 32 &&
    HEX.test(env.data);
  if (!ok) throw new ValidationError('This backup file is damaged.');
  return env as BackupEnvelope;
}

export async function decryptBackup(env: BackupEnvelope, password: string): Promise<string> {
  const key = await deriveKey(password, hexToBytes(env.kdf.salt), env.kdf.iterations);
  let bytes: Uint8Array;
  try {
    bytes = gcm(key, hexToBytes(env.cipher.nonce)).decrypt(hexToBytes(env.data));
  } catch {
    // GCM can't tell a wrong password from a modified file — both fail authentication.
    throw new ValidationError('Wrong password, or the backup file has been changed.');
  }
  return decodeUtf8(bytes);
}
