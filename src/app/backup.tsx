import { useState } from 'react';
import { Alert, View } from 'react-native';
import { FormSection, TextField } from '@/components/form';
import { Button, Card, GradientTile, Icon, Row, Screen, Text } from '@/components/ui';
import type { BackupEnvelope } from '@/features/backup/backupCrypto';
import { MIN_PASSWORD_LENGTH } from '@/features/backup/backupCrypto';
import type { BackupPayload, BackupSummary } from '@/features/backup/backupData';
import { useApp } from '@/services/AppContext';
import { openBackup, pickBackup, restoreData, shareBackup } from '@/services/backupFiles';
import { useHaptics } from '@/services/haptics';
import { spacing } from '@/theme/tokens';
import { ValidationError } from '@/utils/result';
import { formatClock, formatDateKey, toDateKey } from '@/utils/time';

function explain(e: unknown, fallback: string): string {
  if (e instanceof ValidationError) return e.message;
  console.error(fallback, e);
  return 'An unexpected error occurred. Please try again.';
}

/**
 * Encrypted backups the user keeps wherever they like. MyOrbit never uploads
 * anything; the share sheet hands the file to Files, AirDrop and so on.
 */
export default function BackupScreen() {
  const { db, colors, notifyDataChanged, reloadSettings } = useApp();
  const haptic = useHaptics();

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [exporting, setExporting] = useState(false);

  const [envelope, setEnvelope] = useState<BackupEnvelope | null>(null);
  const [restorePassword, setRestorePassword] = useState('');
  const [checked, setChecked] = useState<{ payload: BackupPayload; summary: BackupSummary } | null>(null);
  const [busy, setBusy] = useState<'pick' | 'check' | 'restore' | null>(null);

  const mismatch = confirm.length > 0 && confirm !== password;
  const canExport = password.length >= MIN_PASSWORD_LENGTH && confirm === password && !exporting;

  const create = async () => {
    setExporting(true);
    try {
      await shareBackup(db, password);
      haptic('success');
      setPassword('');
      setConfirm('');
    } catch (e) {
      haptic('error');
      Alert.alert('Couldn’t create backup', explain(e, 'Backup failed'));
    } finally {
      setExporting(false);
    }
  };

  const choose = async () => {
    setBusy('pick');
    try {
      const env = await pickBackup();
      if (env) {
        setEnvelope(env);
        setChecked(null);
        setRestorePassword('');
      }
    } catch (e) {
      Alert.alert('Can’t use that file', explain(e, 'Pick backup failed'));
    } finally {
      setBusy(null);
    }
  };

  const check = async () => {
    if (!envelope) return;
    setBusy('check');
    try {
      setChecked(await openBackup(db, envelope, restorePassword));
      haptic('success');
    } catch (e) {
      haptic('error');
      Alert.alert('Can’t open backup', explain(e, 'Open backup failed'));
    } finally {
      setBusy(null);
    }
  };

  const restore = () => {
    if (!checked) return;
    Alert.alert('Replace all data?', 'Everything currently in MyOrbit on this iPhone will be replaced by this backup. This can’t be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Replace',
        style: 'destructive',
        onPress: () =>
          void (async () => {
            setBusy('restore');
            try {
              await restoreData(db, checked.payload);
              await reloadSettings();
              notifyDataChanged('all');
              haptic('success');
              setEnvelope(null);
              setChecked(null);
              setRestorePassword('');
              Alert.alert('Backup restored', 'Your data is back. Reminders and widgets have been updated.');
            } catch (e) {
              haptic('error');
              Alert.alert('Restore failed', `${explain(e, 'Restore failed')} Nothing was changed.`);
            } finally {
              setBusy(null);
            }
          })(),
      },
    ]);
  };

  const s = checked?.summary;
  const made = s ? `${formatDateKey(toDateKey(new Date(s.exportedAt)), { weekday: true })}, ${formatClock(s.exportedAt)}` : '';

  return (
    <Screen largeTitle={false}>
      <Card>
        <Row>
          <GradientTile icon="lock.shield.fill" tone="accent" size={44} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="headline">Encrypted backups</Text>
            <Text variant="footnote" tone="secondary">
              Protected with AES-256 and your backup password. Save the file to Files or iCloud Drive, or AirDrop it to another device.
            </Text>
          </View>
        </Row>
      </Card>

      <FormSection
        title="Create a backup"
        footer={`At least ${MIN_PASSWORD_LENGTH} characters. Keep it somewhere safe — without it, the backup can’t be opened, and MyOrbit can’t recover it.`}
      >
        <TextField label="Password" value={password} onChangeText={setPassword} secureTextEntry textContentType="newPassword" autoCapitalize="none" autoCorrect={false} />
        <TextField label="Confirm" value={confirm} onChangeText={setConfirm} secureTextEntry textContentType="newPassword" autoCapitalize="none" autoCorrect={false} last />
      </FormSection>
      {mismatch ? (
        <Text variant="footnote" tone="danger" style={{ paddingHorizontal: spacing.lg }}>
          The passwords don’t match.
        </Text>
      ) : null}
      <Button title={exporting ? 'Creating backup…' : 'Create backup'} icon="square.and.arrow.up" onPress={() => void create()} loading={exporting} disabled={!canExport} />

      <FormSection title="Restore from a backup">
        <View style={{ padding: spacing.lg, gap: spacing.md }}>
          <Text variant="subhead" tone="secondary">
            {envelope ? 'Backup file selected. Enter its password to check it.' : 'Choose a MyOrbit backup file (.json).'}
          </Text>
          <Button title={envelope ? 'Choose a different file' : 'Choose backup file'} kind="secondary" icon="folder" onPress={() => void choose()} loading={busy === 'pick'} disabled={busy !== null} />
        </View>
      </FormSection>

      {envelope && !checked ? (
        <>
          <FormSection>
            <TextField label="Password" value={restorePassword} onChangeText={setRestorePassword} secureTextEntry textContentType="password" autoCapitalize="none" autoCorrect={false} last />
          </FormSection>
          <Button title={busy === 'check' ? 'Checking…' : 'Check backup'} onPress={() => void check()} loading={busy === 'check'} disabled={!restorePassword || busy !== null} />
        </>
      ) : null}

      {s ? (
        <Card>
          <Row gap={8}>
            <Icon name="checkmark.seal.fill" color={colors.success} size={18} />
            <Text variant="headline">Backup verified</Text>
          </Row>
          <Text variant="subhead" tone="secondary">
            Made {made}
          </Text>
          <Text variant="subhead">
            {s.counts.shifts} shifts · {s.counts.income} income · {s.counts.expenses} expenses · {s.counts.tasks} tasks · {s.counts.assessments} assessments · {s.counts.habits} habits
          </Text>
          <Button title="Replace my data with this backup" kind="danger" onPress={restore} loading={busy === 'restore'} disabled={busy !== null} />
        </Card>
      ) : null}
    </Screen>
  );
}
