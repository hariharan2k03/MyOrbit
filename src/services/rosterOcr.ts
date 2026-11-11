import { requireOptionalNativeModule } from 'expo';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import type { OcrLine } from '@/features/work/rosterParse';

interface NativeRoster {
  recognizeText(uri: string, hints: string[]): Promise<OcrLine[]>;
}

// Missing in tests and on builds from before roster upload existed.
const native = requireOptionalNativeModule<NativeRoster>('MyOrbitRoster');

export const rosterReadingAvailable = native !== null;

/**
 * Reads the text on a roster image or PDF on this iPhone (Apple Vision).
 * Nothing is uploaded anywhere. `hints` are words to look out for, e.g. your name.
 */
export async function readRoster(uri: string, hints: string[]): Promise<OcrLine[]> {
  if (!native) throw new Error('Roster reading needs the latest MyOrbit build. Reinstall the app from your Mac.');
  return native.recognizeText(uri, hints);
}

export type RosterSource = 'camera' | 'photos' | 'files';

export interface PickedRoster {
  uri: string;
  /** Shown as a preview; PDFs have none. */
  previewUri: string | null;
  name: string;
}

/** Lets the user take or choose a roster. Null if they cancelled. */
export async function pickRoster(source: RosterSource): Promise<PickedRoster | null> {
  if (source === 'files') {
    const r = await DocumentPicker.getDocumentAsync({ type: ['image/*', 'application/pdf'], copyToCacheDirectory: true });
    const a = r.canceled ? null : r.assets[0];
    if (!a) return null;
    const isPdf = a.mimeType === 'application/pdf' || a.name.toLowerCase().endsWith('.pdf');
    return { uri: a.uri, previewUri: isPdf ? null : a.uri, name: a.name };
  }
  if (source === 'camera') {
    const p = await ImagePicker.requestCameraPermissionsAsync();
    if (!p.granted) throw new Error('Allow camera access for MyOrbit in iOS Settings to photograph your roster.');
  }
  const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 1, allowsEditing: false, exif: false };
  const r = source === 'camera' ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
  const a = r.canceled ? null : r.assets[0];
  if (!a) return null;
  return { uri: a.uri, previewUri: a.uri, name: a.fileName ?? 'Roster photo' };
}
