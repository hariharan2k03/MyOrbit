import { HStack, Image, ProgressView, Spacer, Text, VStack } from '@expo/ui/swift-ui';
import { activityBackgroundTint, font, labelsHidden, foregroundStyle, frame, lineLimit, monospacedDigit, multilineTextAlignment, padding, tint } from '@expo/ui/swift-ui/modifiers';
import { createLiveActivity, type LiveActivityEnvironment } from 'expo-widgets';

/**
 * Props are plain values (start/end are epoch ms). The countdown itself is
 * drawn by SwiftUI's Text(timerInterval:), so it keeps ticking on the Lock
 * Screen and in the Dynamic Island while MyOrbit is suspended or closed.
 */
export interface TimerActivityProps {
  /** e.g. "FOCUS", "BREAK", "STUDY", "SHIFT" */
  label: string;
  title: string;
  subtitle: string;
  /** SF Symbol name. */
  icon: string;
  color: string;
  startsAt: number;
  endsAt: number;
  /** e.g. "Ends 3:25 PM" or "Starts 9:00 AM". */
  footnote: string;
}

const TimerActivity = (p: TimerActivityProps, env: LiveActivityEnvironment) => {
  'widget';
  const range = { lower: new Date(p.startsAt), upper: new Date(p.endsAt) };
  const white = foregroundStyle('#FFFFFF');
  const muted = foregroundStyle('#A9BEDD');
  const accent = foregroundStyle(p.color);
  // Once the end time passes, iOS marks the activity stale until the app ends it.
  const done = env.isStale === true;

  const clock = (size: number, width?: number) =>
    done ? (
      <Text modifiers={[font({ size, weight: 'semibold', design: 'rounded' }), accent]}>Done</Text>
    ) : (
      <Text
        timerInterval={range}
        countsDown
        modifiers={[
          font({ size, weight: 'semibold', design: 'rounded' }),
          monospacedDigit(),
          accent,
          multilineTextAlignment('trailing'),
          ...(width ? [frame({ width })] : []),
        ]}
      />
    );

  const bar = <ProgressView timerInterval={range} countsDown={false} modifiers={[tint(p.color), labelsHidden()]} />;

  return {
    banner: (
      <VStack alignment="leading" spacing={8} modifiers={[padding({ all: 16 }), activityBackgroundTint('#071530')]}>
        <HStack spacing={10}>
          <Image systemName={p.icon as never} modifiers={[font({ size: 20, weight: 'semibold' }), accent]} />
          <VStack alignment="leading" spacing={1}>
            <Text modifiers={[font({ size: 11, weight: 'semibold' }), muted]}>{p.label}</Text>
            <Text modifiers={[font({ size: 16, weight: 'bold' }), white, lineLimit(1)]}>{p.title}</Text>
          </VStack>
          <Spacer />
          {clock(34)}
        </HStack>
        {bar}
        <HStack>
          <Text modifiers={[font({ size: 12 }), muted, lineLimit(1)]}>{p.subtitle}</Text>
          <Spacer />
          <Text modifiers={[font({ size: 12 }), muted]}>{p.footnote}</Text>
        </HStack>
      </VStack>
    ),
    compactLeading: <Image systemName={p.icon as never} modifiers={[accent]} />,
    compactTrailing: clock(15, 52),
    minimal: <Image systemName={p.icon as never} modifiers={[accent]} />,
    expandedLeading: (
      <HStack spacing={6} modifiers={[padding({ leading: 6 })]}>
        <Image systemName={p.icon as never} modifiers={[font({ size: 18, weight: 'semibold' }), accent]} />
        <Text modifiers={[font({ size: 13, weight: 'semibold' }), muted]}>{p.label}</Text>
      </HStack>
    ),
    expandedTrailing: <HStack modifiers={[padding({ trailing: 6 })]}>{clock(26, 96)}</HStack>,
    expandedBottom: (
      <VStack alignment="leading" spacing={6} modifiers={[padding({ horizontal: 6 })]}>
        <HStack>
          <Text modifiers={[font({ size: 16, weight: 'bold' }), white, lineLimit(1)]}>{p.title}</Text>
          <Spacer />
          <Text modifiers={[font({ size: 12 }), muted]}>{p.footnote}</Text>
        </HStack>
        {bar}
      </VStack>
    ),
  };
};

export default createLiveActivity<TimerActivityProps>('DayPilotTimer', TimerActivity);
