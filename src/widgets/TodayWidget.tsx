import { Button, HStack, Image, Spacer, Text, VStack } from '@expo/ui/swift-ui';
import { buttonStyle, containerBackground, font, foregroundStyle, lineLimit, padding, widgetURL } from '@expo/ui/swift-ui/modifiers';
import { createWidget, type WidgetEnvironment } from 'expo-widgets';

/**
 * Props are pre-formatted strings built in the app (see services/widgetSync.ts).
 * The widget runs in an isolated runtime: no imports, hooks or outer constants
 * inside the function body — everything it needs arrives through props.
 */
export interface TodayWidgetProps {
  dateLabel: string;
  /** Empty string = nothing next. (UserDefaults can't store null, so no nulls in props.) */
  nextTitle: string;
  nextTime: string;
  nextColor: string;
  tasksLeft: number;
  habitsDone: number;
  habitsTotal: number;
  agenda: { time: string; title: string; color: string }[];
  /** Up to four open tasks due today, each with a tick button. */
  tasks: { id: number; title: string }[];
  /**
   * Tasks ticked in the widget. Buttons run inside the widget extension, which
   * can't reach the database, so ticks are kept here until the app next opens
   * and completes them (see services/widgetSync.ts).
   */
  doneTaskIds: number[];
  /** Empty unless the user allowed money in widgets. */
  moneyLine: string;
  updated: string;
}

const TodayWidget = (p: TodayWidgetProps, env: WidgetEnvironment) => {
  'widget';
  const fam = env.widgetFamily;
  const bg = containerBackground(
    { type: 'linearGradient', colors: ['#0E3570', '#061226'], startPoint: { x: 0, y: 0 }, endPoint: { x: 1, y: 1 } },
    'widget',
  );
  const white = foregroundStyle('#FFFFFF');
  const muted = foregroundStyle('#A9BEDD');
  const accent = foregroundStyle('#5AA2FF');
  const habits = p.habitsTotal > 0 ? `${p.habitsDone}/${p.habitsTotal} habits` : 'No habits';
  const tasks = `${p.tasksLeft} ${p.tasksLeft === 1 ? 'task' : 'tasks'} left`;

  if (fam === 'accessoryInline') {
    return <Text modifiers={[widgetURL('daypilot://')]}>{p.nextTitle ? `${p.nextTime} ${p.nextTitle}`.trim() : tasks}</Text>;
  }

  if (fam === 'accessoryCircular') {
    return (
      <VStack spacing={0} modifiers={[bg, widgetURL('daypilot://tasks')]}>
        <Text modifiers={[font({ size: 22, weight: 'bold', design: 'rounded' })]}>{String(p.tasksLeft)}</Text>
        <Text modifiers={[font({ size: 10, weight: 'medium' })]}>tasks</Text>
      </VStack>
    );
  }

  if (fam === 'accessoryRectangular') {
    return (
      <VStack alignment="leading" spacing={1} modifiers={[bg, widgetURL('daypilot://calendar')]}>
        <Text modifiers={[font({ size: 14, weight: 'semibold' }), lineLimit(1)]}>{p.nextTitle || 'Nothing next'}</Text>
        {p.nextTime ? <Text modifiers={[font({ size: 12 })]}>{p.nextTime}</Text> : null}
        <Text modifiers={[font({ size: 12 })]}>{tasks}</Text>
      </VStack>
    );
  }

  const header = (
    <HStack>
      <Text modifiers={[font({ size: 13, weight: 'semibold' }), accent]}>{p.dateLabel}</Text>
      <Spacer />
      <Text modifiers={[font({ size: 11 }), muted]}>MyOrbit</Text>
    </HStack>
  );

  const next = (
    <VStack alignment="leading" spacing={2}>
      <Text modifiers={[font({ size: 11, weight: 'medium' }), muted]}>NEXT</Text>
      <Text modifiers={[font({ size: fam === 'systemSmall' ? 15 : 16, weight: 'bold' }), white, lineLimit(2)]}>{p.nextTitle || 'Nothing scheduled'}</Text>
      {p.nextTime ? <Text modifiers={[font({ size: 12 }), foregroundStyle(p.nextColor)]}>{p.nextTime}</Text> : null}
    </VStack>
  );

  if (fam === 'systemSmall') {
    return (
      <VStack alignment="leading" spacing={6} modifiers={[bg, widgetURL('daypilot://')]}>
        {header}
        {next}
        <Spacer />
        <Text modifiers={[font({ size: 12, weight: 'semibold' }), white]}>{tasks}</Text>
        <Text modifiers={[font({ size: 11 }), muted]}>{habits}</Text>
      </VStack>
    );
  }

  const todo = (max: number) => (
    <VStack alignment="leading" spacing={6}>
      {p.tasks.slice(0, max).map((t) => (
        <HStack key={`task-${t.id}`} spacing={8}>
          <Button
            target={`done-${t.id}`}
            // Returns the widget's new props: the task disappears at once and its id is queued for the app.
            onPress={
              (() => ({
                tasks: p.tasks.filter((x) => x.id !== t.id),
                doneTaskIds: [...p.doneTaskIds, t.id],
                tasksLeft: Math.max(0, p.tasksLeft - 1),
                // The ticked task may also be the one shown as "Next".
                ...(p.nextTitle === t.title && p.nextTime === 'Today' ? { nextTitle: '', nextTime: '' } : {}),
              })) as () => void
            }
            modifiers={[buttonStyle('plain')]}
          >
            <Image systemName="circle" modifiers={[font({ size: 17, weight: 'semibold' }), accent]} />
          </Button>
          <Text modifiers={[font({ size: 13, weight: 'medium' }), white, lineLimit(1)]}>{t.title}</Text>
          <Spacer />
        </HStack>
      ))}
    </VStack>
  );

  const rows = p.agenda.slice(0, fam === 'systemLarge' ? 4 : 3);
  const agenda = (
    <VStack alignment="leading" spacing={6}>
      {rows.length === 0 ? <Text modifiers={[font({ size: 13 }), muted]}>Nothing else today</Text> : null}
      {rows.map((r, i) => (
        <HStack key={i} spacing={6}>
          <Text modifiers={[font({ size: 13, weight: 'heavy' }), foregroundStyle(r.color)]}>|</Text>
          <VStack alignment="leading" spacing={0}>
            <Text modifiers={[font({ size: 13, weight: 'semibold' }), white, lineLimit(1)]}>{r.title}</Text>
            <Text modifiers={[font({ size: 11 }), muted]}>{r.time}</Text>
          </VStack>
          <Spacer />
        </HStack>
      ))}
    </VStack>
  );

  if (fam === 'systemMedium') {
    return (
      <HStack alignment="top" spacing={14} modifiers={[bg, widgetURL('daypilot://calendar')]}>
        <VStack alignment="leading" spacing={6}>
          <Text modifiers={[font({ size: 13, weight: 'semibold' }), accent]}>{p.dateLabel}</Text>
          {next}
          <Spacer />
          <Text modifiers={[font({ size: 12, weight: 'semibold' }), white]}>{tasks}</Text>
          <Text modifiers={[font({ size: 11 }), muted]}>{habits}</Text>
        </VStack>
        <VStack alignment="leading" spacing={6}>
          <Text modifiers={[font({ size: 11, weight: 'medium' }), muted]}>{p.tasks.length > 0 ? 'TO DO' : 'TODAY'}</Text>
          {p.tasks.length > 0 ? todo(3) : agenda}
          <Spacer />
        </VStack>
      </HStack>
    );
  }

  return (
    <VStack alignment="leading" spacing={10} modifiers={[bg, padding({ all: 2 }), widgetURL('daypilot://')]}>
      {header}
      {next}
      <Text modifiers={[font({ size: 11, weight: 'medium' }), muted]}>TODAY</Text>
      {agenda}
      {p.tasks.length > 0 ? <Text modifiers={[font({ size: 11, weight: 'medium' }), muted]}>TO DO</Text> : null}
      {p.tasks.length > 0 ? todo(4) : null}
      <Spacer />
      <HStack>
        <Text modifiers={[font({ size: 13, weight: 'semibold' }), white]}>{tasks}</Text>
        <Spacer />
        <Text modifiers={[font({ size: 13 }), muted]}>{habits}</Text>
      </HStack>
      {p.moneyLine ? <Text modifiers={[font({ size: 12 }), muted]}>{p.moneyLine}</Text> : null}
      <Text modifiers={[font({ size: 10 }), muted]}>Updated {p.updated}</Text>
    </VStack>
  );
};

export default createWidget<TodayWidgetProps>('DayPilotToday', TodayWidget, {
  dateLabel: 'Today',
  nextTitle: '',
  nextTime: '',
  nextColor: '#5AA2FF',
  tasksLeft: 0,
  habitsDone: 0,
  habitsTotal: 0,
  agenda: [],
  tasks: [],
  doneTaskIds: [],
  moneyLine: '',
  updated: '—',
});
