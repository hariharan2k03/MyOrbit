import { router } from 'expo-router';
import { ActionSheetIOS } from 'react-native';
import { setShiftStatus, type Shift } from '@/database/repositories/work';
import type { SqlDb } from '@/database/types';
import { formatDateKey, formatTimeRange } from '@/utils/time';

/** Edit / complete / cancel menu for a shift, shared by Work and My Shifts. */
export function openShiftActions(db: SqlDb, s: Shift, onChanged: () => void) {
  ActionSheetIOS.showActionSheetWithOptions(
    {
      title: s.workplaceName,
      message: `${formatDateKey(s.shiftDate, { weekday: true })}, ${formatTimeRange(s.startAt, s.endAt)}`,
      options: ['Edit', s.status === 'completed' ? 'Mark scheduled' : 'Mark completed', s.status === 'cancelled' ? 'Restore shift' : 'Cancel shift', 'Close'],
      destructiveButtonIndex: s.status === 'cancelled' ? undefined : 2,
      cancelButtonIndex: 3,
    },
    (i) => {
      if (i === 0) router.push(`/shift/${s.id}`);
      if (i === 1) void setShiftStatus(db, s.id, s.status === 'completed' ? 'scheduled' : 'completed').then(onChanged);
      if (i === 2) void setShiftStatus(db, s.id, s.status === 'cancelled' ? 'scheduled' : 'cancelled').then(onChanged);
    },
  );
}
