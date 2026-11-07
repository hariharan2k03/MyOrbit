import { SymbolView, type SFSymbol } from 'expo-symbols';
import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text as RNText,
  View,
  type StyleProp,
  type TextProps,
  type ViewStyle,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Circle, Defs, LinearGradient as SvgLinearGradient, Path, RadialGradient, Rect, Stop } from 'react-native-svg';
import { useApp } from '@/services/AppContext';
import { useHaptics } from '@/services/haptics';
import { radius, spacing, TILE_GRADIENTS, type, type TileTone } from '@/theme/tokens';

type Variant = keyof typeof type;
type Tone = 'primary' | 'secondary' | 'tertiary' | 'accent' | 'success' | 'warning' | 'danger';

export function Text({
  variant = 'body',
  tone = 'primary',
  color,
  style,
  ...rest
}: TextProps & { variant?: Variant; tone?: Tone; color?: string }) {
  const { colors } = useApp();
  const toneColor = {
    primary: colors.text,
    secondary: colors.textSecondary,
    tertiary: colors.textTertiary,
    accent: colors.accent,
    success: colors.success,
    warning: colors.warning,
    danger: colors.danger,
  }[tone];
  return <RNText maxFontSizeMultiplier={1.6} style={[type[variant], { color: color ?? toneColor }, style]} {...rest} />;
}

export function Icon({ name, color, size = 20 }: { name: string; color?: string; size?: number }) {
  const { colors } = useApp();
  return <SymbolView name={name as SFSymbol} tintColor={color ?? colors.text} size={size} type="hierarchical" />;
}

/** Scrollable tab/screen body with a large title, safe areas and pull-to-refresh. */
export function Screen({
  title,
  subtitle,
  trailing,
  children,
  onRefresh,
  refreshing = false,
  largeTitle = true,
  overlay,
  scene = false,
}: {
  /** Draws the mountain scene behind the top of the screen (Home). */
  scene?: boolean;
  /** Fixed content above the scroll view, e.g. a floating add button. */
  overlay?: ReactNode;
  title?: string;
  subtitle?: string;
  trailing?: ReactNode;
  children: ReactNode;
  onRefresh?: () => void;
  refreshing?: boolean;
  largeTitle?: boolean;
}) {
  const { colors } = useApp();
  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <Backdrop scene={scene} />
      <ScrollView
      style={{ flex: 1 }}
      contentInsetAdjustmentBehavior="automatic"
      // contentInsetAdjustmentBehavior already insets for the status bar, header and tab bar,
      // so padding here must not add the safe-area insets a second time.
      contentContainerStyle={{
        paddingTop: largeTitle ? spacing.sm : spacing.lg,
        paddingBottom: spacing.xxl,
        paddingHorizontal: spacing.lg,
        gap: spacing.lg,
      }}
      refreshControl={onRefresh ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.textSecondary} /> : undefined}
    >
      {largeTitle && title ? (
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            {subtitle ? (
              <Text variant="footnote" tone="secondary" style={{ textTransform: 'uppercase', letterSpacing: 0.6 }}>
                {subtitle}
              </Text>
            ) : null}
            <Text variant="largeTitle" accessibilityRole="header">
              {title}
            </Text>
          </View>
          {trailing}
        </View>
      ) : null}
      {children}
      <View style={{ height: overlay ? 72 : 0 }} />
      </ScrollView>
      {overlay}
    </View>
  );
}

/** Ocean gradient with a soft glow in the top-right corner, drawn behind screen content. */
export function Backdrop({ scene = false }: { scene?: boolean }) {
  const { colors } = useApp();
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <LinearGradient colors={colors.backgroundGradient} locations={[0, 0.45, 1]} style={StyleSheet.absoluteFill} />
      {scene ? <MountainScene /> : null}
      <Svg width="100%" height={420} style={{ position: 'absolute', top: 0 }}>
        <Defs>
          <RadialGradient id="glow" cx="85%" cy="5%" rx="75%" ry="70%">
            <Stop offset="0" stopColor={colors.glow} stopOpacity="1" />
            <Stop offset="1" stopColor={colors.glow} stopOpacity="0" />
          </RadialGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="420" fill="url(#glow)" />
      </Svg>
    </View>
  );
}

const SCENE_HEIGHT = 320;

/**
 * Layered mountain ridges with a light rim and a glow behind the peak,
 * fading into the background. Decorative, so hidden from VoiceOver.
 */
function MountainScene() {
  const { colors } = useApp();
  const c = colors.scene;
  // Blend into the page gradient at the point where the scene ends.
  const fadeTo = colors.backgroundGradient[1];
  const ridge = 'M0 196 L46 176 L92 188 L150 150 L196 120 L232 100 L262 78 L292 58 L318 80 L340 96 L368 122 L400 138';
  return (
    <View style={{ position: 'absolute', top: 0, left: 0, right: 0, height: SCENE_HEIGHT }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Svg width="100%" height="100%" viewBox="0 0 400 320" preserveAspectRatio="xMidYMin slice">
        <Defs>
          <SvgLinearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={c.sky[0]} />
            <Stop offset="1" stopColor={c.sky[1]} />
          </SvgLinearGradient>
          <RadialGradient id="peakGlow" cx="74%" cy="26%" rx="48%" ry="34%">
            <Stop offset="0" stopColor={c.glow} stopOpacity="0.8" />
            <Stop offset="1" stopColor={c.glow} stopOpacity="0" />
          </RadialGradient>
          <SvgLinearGradient id="peakFill" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={c.mid} />
            <Stop offset="1" stopColor={c.near} />
          </SvgLinearGradient>
          <SvgLinearGradient id="fade" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0.5" stopColor={fadeTo} stopOpacity="0" />
            <Stop offset="1" stopColor={fadeTo} stopOpacity="1" />
          </SvgLinearGradient>
        </Defs>
        <Rect x="0" y="0" width="400" height="320" fill="url(#sky)" />
        <Rect x="0" y="0" width="400" height="320" fill="url(#peakGlow)" />
        {/* Far range */}
        <Path d="M0 170 L40 148 L84 160 L128 126 L166 142 L204 112 L236 130 L268 116 L300 134 L340 108 L400 126 L400 320 L0 320 Z" fill={c.far} opacity={0.75} />
        {/* Main peak with snow cap and rim light */}
        <Path d={`${ridge} L400 320 L0 320 Z`} fill="url(#peakFill)" />
        <Path d="M292 58 L318 80 L308 86 L298 78 L288 90 L278 82 L268 88 L262 78 Z" fill={c.snow} opacity={0.92} />
        <Path d={ridge} fill="none" stroke={c.rim} strokeWidth={1.4} strokeOpacity={0.75} />
        {/* Near hills */}
        <Path d="M0 236 L58 214 L120 228 L180 200 L238 222 L296 204 L350 220 L400 210 L400 320 L0 320 Z" fill={c.near} />
        <Rect x="0" y="0" width="400" height="320" fill="url(#fade)" />
      </Svg>
    </View>
  );
}

export function Card({ children, style, onPress, accessibilityLabel }: { children: ReactNode; style?: StyleProp<ViewStyle>; onPress?: () => void; accessibilityLabel?: string }) {
  const { colors, isDark } = useApp();
  const haptic = useHaptics();
  // Glass card: translucent fill + hairline border in dark mode, soft violet shadow in light.
  const base: ViewStyle = {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    // Shadows only in light mode, where the card is opaque (translucent views can't cast efficient shadows).
    ...(isDark ? null : { shadowColor: colors.shadow, shadowOpacity: 0.08, shadowRadius: 16, shadowOffset: { width: 0, height: 6 } }),
    gap: spacing.md,
  };
  if (!onPress) return <View style={[base, style]}>{children}</View>;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={() => {
        haptic('tap');
        onPress();
      }}
      style={({ pressed }) => [base, style, pressed && { opacity: 0.85, transform: [{ scale: 0.99 }] }]}
    >
      {children}
    </Pressable>
  );
}

export function SectionHeader({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) {
  return (
    <View style={styles.sectionHeader}>
      <Text variant="headline" accessibilityRole="header">
        {title}
      </Text>
      {action && onAction ? (
        <Pressable accessibilityRole="button" onPress={onAction} hitSlop={10}>
          <Text variant="subhead" tone="accent">
            {action}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

type ButtonKind = 'primary' | 'secondary' | 'danger' | 'plain';

export function Button({
  title,
  onPress,
  kind = 'primary',
  icon,
  disabled,
  loading,
  style,
}: {
  title: string;
  onPress: () => void;
  kind?: ButtonKind;
  icon?: string;
  disabled?: boolean;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const { colors } = useApp();
  const haptic = useHaptics();
  const bg = { primary: colors.accent, secondary: colors.accentSoft, danger: 'transparent', plain: 'transparent' }[kind];
  const fg = { primary: colors.onAccent, secondary: colors.accent, danger: colors.danger, plain: colors.accent }[kind];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled, busy: !!loading }}
      disabled={disabled || loading}
      onPress={() => {
        haptic('tap');
        onPress();
      }}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: kind === 'primary' ? undefined : bg, opacity: disabled ? 0.45 : pressed ? 0.8 : 1, overflow: 'hidden' },
        kind === 'danger' && { borderWidth: 1, borderColor: colors.danger },
        style,
      ]}
    >
      {kind === 'primary' ? (
        <LinearGradient colors={colors.accentGradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
      ) : null}
      {loading ? <ActivityIndicator color={fg} /> : icon ? <Icon name={icon} color={fg} size={17} /> : null}
      <Text variant="headline" color={fg}>
        {title}
      </Text>
    </Pressable>
  );
}

export function IconButton({ icon, onPress, label, color }: { icon: string; onPress: () => void; label: string; color?: string }) {
  const { colors } = useApp();
  const haptic = useHaptics();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={8}
      onPress={() => {
        haptic('tap');
        onPress();
      }}
      style={({ pressed }) => [
        styles.iconButton,
        { backgroundColor: colors.surfaceRaised, borderColor: colors.border, borderWidth: StyleSheet.hairlineWidth, opacity: pressed ? 0.7 : 1 },
      ]}
    >
      <Icon name={icon} color={color ?? colors.text} size={18} />
    </Pressable>
  );
}

export function ListRow({
  title,
  subtitle,
  value,
  valueTone,
  icon,
  iconColor,
  tone,
  onPress,
  trailing,
  strike,
}: {
  /** Solid gradient tile with a white symbol, like iOS Settings. */
  tone?: TileTone;
  title: string;
  subtitle?: string | null;
  value?: string;
  valueTone?: Tone;
  icon?: string;
  iconColor?: string;
  onPress?: () => void;
  trailing?: ReactNode;
  strike?: boolean;
}) {
  const { colors } = useApp();
  const content = (
    <>
      {icon && tone ? (
        <GradientTile icon={icon} tone={tone} size={32} />
      ) : icon ? (
        <View style={[styles.rowIcon, { backgroundColor: (iconColor ?? colors.accent) + '22' }]}>
          <Icon name={icon} color={iconColor ?? colors.accent} size={16} />
        </View>
      ) : null}
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="callout" numberOfLines={1} style={strike && { textDecorationLine: 'line-through', opacity: 0.6 }}>
          {title}
        </Text>
        {subtitle ? (
          <Text variant="footnote" tone="secondary" numberOfLines={2}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {value ? (
        <Text variant="callout" tone={valueTone ?? 'primary'} style={{ fontVariant: ['tabular-nums'] }}>
          {value}
        </Text>
      ) : null}
      {trailing}
      {onPress ? <Icon name="chevron.right" color={colors.textTertiary} size={12} /> : null}
    </>
  );
  if (!onPress) return <View style={styles.row}>{content}</View>;
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.row, pressed && { opacity: 0.6 }]}>
      {content}
    </Pressable>
  );
}

export function Divider() {
  const { colors } = useApp();
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: colors.border }} />;
}

export function ProgressBar({ value, color, height = 8 }: { value: number; color?: string; height?: number }) {
  const { colors } = useApp();
  const pct = Math.max(0, Math.min(1, value));
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: Math.round(pct * 100) }}
      style={{ height, borderRadius: height, backgroundColor: colors.border, overflow: 'hidden' }}
    >
      <View style={{ width: `${pct * 100}%`, height: '100%', borderRadius: height, backgroundColor: color ?? colors.accent }} />
    </View>
  );
}

export function Stat({ label, value, tone, hint }: { label: string; value: string; tone?: Tone; hint?: string }) {
  return (
    <View style={{ flex: 1, gap: 2 }}>
      <Text variant="caption" tone="secondary" style={{ textTransform: 'uppercase', letterSpacing: 0.5 }}>
        {label}
      </Text>
      <Text variant="title" tone={tone} style={{ fontVariant: ['tabular-nums'] }} adjustsFontSizeToFit numberOfLines={1}>
        {value}
      </Text>
      {hint ? (
        <Text variant="footnote" tone="tertiary">
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

export function Chip({ label, selected, onPress, color }: { label: string; selected?: boolean; onPress?: () => void; color?: string }) {
  const { colors } = useApp();
  const haptic = useHaptics();
  const c = color ?? colors.accent;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: !!selected }}
      onPress={() => {
        haptic('select');
        onPress?.();
      }}
      style={[styles.chip, { backgroundColor: selected ? c : colors.surfaceRaised, borderColor: selected ? c : colors.border }]}
    >
      <Text variant="subhead" color={selected ? colors.onAccent : colors.text}>
        {label}
      </Text>
    </Pressable>
  );
}

export function EmptyState({ icon, title, message, action, onAction }: { icon: string; title: string; message: string; action?: string; onAction?: () => void }) {
  const { colors } = useApp();
  return (
    <View style={styles.empty}>
      <Icon name={icon} color={colors.textTertiary} size={30} />
      <Text variant="headline" style={{ textAlign: 'center' }}>
        {title}
      </Text>
      <Text variant="subhead" tone="secondary" style={{ textAlign: 'center' }}>
        {message}
      </Text>
      {action && onAction ? <Button title={action} kind="secondary" onPress={onAction} style={{ marginTop: spacing.sm }} /> : null}
    </View>
  );
}

export function ErrorView({ error, onRetry }: { error: Error; onRetry?: () => void }) {
  const { colors } = useApp();
  return (
    <Card>
      <View style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'center' }}>
        <Icon name="exclamationmark.triangle.fill" color={colors.danger} />
        <Text variant="headline">Something went wrong</Text>
      </View>
      <Text variant="subhead" tone="secondary">
        {error.message}
      </Text>
      {onRetry ? <Button title="Try again" kind="secondary" onPress={onRetry} /> : null}
    </Card>
  );
}

export function Loading() {
  const { colors } = useApp();
  return (
    <View style={{ paddingVertical: spacing.xxl, alignItems: 'center' }}>
      <ActivityIndicator color={colors.textSecondary} />
    </View>
  );
}

/** Renders loading/error states for a query and the children once data is ready. */
export function QueryView<T>({
  query,
  children,
}: {
  query: { data: T | undefined; error: Error | null; loading: boolean; refresh: () => Promise<void> };
  children: (data: T) => ReactNode;
}) {
  if (query.error) return <ErrorView error={query.error} onRetry={() => void query.refresh()} />;
  if (query.data === undefined) return <Loading />;
  return <>{children(query.data)}</>;
}

/** Horizontal row. Use `align="start"` for stat rows so items of different heights line up at the top. */
export function Row({
  children,
  gap = spacing.md,
  style,
  align = 'center',
}: {
  children: ReactNode;
  gap?: number;
  style?: StyleProp<ViewStyle>;
  align?: 'center' | 'start';
}) {
  return <View style={[{ flexDirection: 'row', alignItems: align === 'start' ? 'flex-start' : 'center', gap }, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.md, marginBottom: spacing.xs },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.sm },
  button: {
    minHeight: 50,
    borderRadius: radius.md,
    paddingHorizontal: spacing.xl,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  iconButton: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 44 },
  rowIcon: { width: 32, height: 32, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  chip: { paddingHorizontal: spacing.md, paddingVertical: 7, borderRadius: radius.pill, borderWidth: 1 },
  empty: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xl, paddingHorizontal: spacing.lg },
  fab: {
    position: 'absolute',
    right: spacing.xl,
    bottom: 110,
    width: 56,
    height: 56,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    shadowOpacity: 0.45,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
  },
});

/** Rounded gradient square with a white SF Symbol — the app's module icon style. */
/**
 * Text button for the navigation bar. iOS draws its own glass capsule behind
 * header items, so the label uses the main text colour to stay readable on it.
 */
export function HeaderButton({ title, onPress, bold = true }: { title: string; onPress: () => void; bold?: boolean }) {
  const { colors } = useApp();
  return (
    <Pressable accessibilityRole="button" onPress={onPress} hitSlop={10}>
      <Text variant={bold ? 'headline' : 'body'} color={colors.text} style={{ paddingHorizontal: 4 }}>
        {title}
      </Text>
    </Pressable>
  );
}

export function GradientTile({ icon, tone = 'accent', color, size = 40 }: { icon: string; tone?: TileTone; color?: string; size?: number }) {
  // A custom colour (e.g. a subject colour) fades from a lighter tint to the full colour.
  const gradient: readonly [string, string] = color ? [color + 'B3', color] : TILE_GRADIENTS[tone];
  return (
    <LinearGradient
      colors={gradient}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={{ width: size, height: size, borderRadius: size * 0.3, alignItems: 'center', justifyContent: 'center' }}
    >
      <SymbolView name={icon as SFSymbol} tintColor="#FFFFFF" size={size * 0.5} type="monochrome" />
    </LinearGradient>
  );
}

/** Floating add button pinned to the bottom-right of a screen, above the tab bar. */
export function Fab({ onPress, label, icon = 'plus' }: { onPress: () => void; label: string; icon?: string }) {
  const { colors } = useApp();
  const haptic = useHaptics();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={() => {
        haptic('tap');
        onPress();
      }}
      style={({ pressed }) => [styles.fab, { backgroundColor: colors.accent, shadowColor: colors.accent, opacity: pressed ? 0.85 : 1, transform: [{ scale: pressed ? 0.96 : 1 }] }]}
    >
      <LinearGradient colors={colors.accentGradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[StyleSheet.absoluteFill, { borderRadius: 18 }]} />
      <Icon name={icon} color={colors.onAccent} size={22} />
    </Pressable>
  );
}

/** Circular progress ring; `value` is clamped to 0–1. */
export function ProgressRing({
  value,
  size = 44,
  stroke = 5,
  color,
  children,
}: {
  value: number;
  size?: number;
  stroke?: number;
  color?: string;
  children?: ReactNode;
}) {
  const { colors } = useApp();
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(1, value));
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: Math.round(pct * 100) }}
      style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}
    >
      <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={colors.border} strokeWidth={stroke} fill="none" />
        {pct > 0 ? (
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={color ?? colors.accent}
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${c * pct} ${c}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
        ) : null}
      </Svg>
      {children}
    </View>
  );
}

export interface DonutSegment {
  value: number;
  color: string;
}

/** Multi-segment donut chart. Zero totals draw an empty track. */
export function Donut({ segments, size = 120, stroke = 14, children }: { segments: DonutSegment[]; size?: number; stroke?: number; children?: ReactNode }) {
  const { colors } = useApp();
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const total = segments.reduce((s, x) => s + Math.max(0, x.value), 0);
  const gap = total > 0 && segments.filter((s) => s.value > 0).length > 1 ? 4 : 0;
  let offset = 0;
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={colors.border} strokeWidth={stroke} fill="none" />
        {total > 0
          ? segments.map((s, i) => {
              if (s.value <= 0) return null;
              const len = (s.value / total) * c;
              const el = (
                <Circle
                  key={i}
                  cx={size / 2}
                  cy={size / 2}
                  r={r}
                  stroke={s.color}
                  strokeWidth={stroke}
                  fill="none"
                  strokeLinecap="round"
                  strokeDasharray={`${Math.max(0, len - gap)} ${c}`}
                  strokeDashoffset={-offset}
                  transform={`rotate(-90 ${size / 2} ${size / 2})`}
                />
              );
              offset += len;
              return el;
            })
          : null}
      </Svg>
      {children}
    </View>
  );
}

/** Small coloured tag, e.g. a task category. */
export function Tag({ label, color }: { label: string; color: string }) {
  return (
    <View style={{ alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6, backgroundColor: color + '2E' }}>
      <Text variant="caption" color={color}>
        {label}
      </Text>
    </View>
  );
}
