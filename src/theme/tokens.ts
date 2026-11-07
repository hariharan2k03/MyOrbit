export interface Palette {
  background: string;
  /** Top → bottom gradient behind tab screens. */
  backgroundGradient: readonly [string, string, string];
  /** Soft glow drawn in the top corner of tab screens. */
  glow: string;
  /** Colours for the mountain scene behind the Home header. */
  scene: { sky: readonly [string, string]; glow: string; far: string; mid: string; near: string; rim: string; snow: string };
  surface: string;
  surfaceRaised: string;
  border: string;
  text: string;
  textSecondary: string;
  textTertiary: string;
  accent: string;
  accentGradient: readonly [string, string];
  accentSoft: string;
  onAccent: string;
  success: string;
  warning: string;
  danger: string;
  work: string;
  money: string;
  study: string;
  tasks: string;
  habits: string;
  shadow: string;
}

/** Ocean Blue: deep navy with glassy cards. Body text contrast checked ≥ 4.5:1 on the darkest surface. */
export const dark: Palette = {
  background: '#040A18',
  backgroundGradient: ['#0B2752', '#06132C', '#040912'],
  glow: 'rgba(40,140,255,0.35)',
  scene: { sky: ['#0A2A5E', '#071833'], glow: '#2F8CFF', far: '#123A73', mid: '#0B2550', near: '#061430', rim: '#5DB0FF', snow: '#CFE6FF' },
  surface: 'rgba(255,255,255,0.06)',
  surfaceRaised: 'rgba(255,255,255,0.10)',
  border: 'rgba(255,255,255,0.09)',
  text: '#F2F7FF',
  textSecondary: '#A9BEDD',
  textTertiary: '#7D93B5',
  accent: '#3B8BFF',
  accentGradient: ['#5AA2FF', '#1F6BEB'],
  accentSoft: 'rgba(59,139,255,0.20)',
  onAccent: '#FFFFFF',
  success: '#34D399',
  warning: '#FBBF24',
  danger: '#F87171',
  work: '#22D3EE',
  money: '#34D399',
  study: '#60A5FA',
  tasks: '#4ADE80',
  habits: '#2DD4BF',
  shadow: '#000000',
};

export const light: Palette = {
  background: '#F2F6FC',
  backgroundGradient: ['#D9E9FF', '#F2F6FC', '#F7F9FC'],
  glow: 'rgba(40,120,255,0.18)',
  scene: { sky: ['#9CC8FF', '#E3EFFF'], glow: '#FFFFFF', far: '#A9C8EE', mid: '#6E9AD6', near: '#C7DAF3', rim: '#FFFFFF', snow: '#FFFFFF' },
  surface: '#FFFFFF',
  surfaceRaised: '#EAF1FC',
  border: '#DCE5F2',
  text: '#0E1A2E',
  textSecondary: '#47566E',
  textTertiary: '#66748A',
  accent: '#1F6BEB',
  accentGradient: ['#4C93FF', '#1659D6'],
  accentSoft: 'rgba(31,107,235,0.12)',
  onAccent: '#FFFFFF',
  success: '#0F9F6E',
  warning: '#B26B00',
  danger: '#D93B3B',
  work: '#0891B2',
  money: '#0F9F6E',
  study: '#2F6FE4',
  tasks: '#16A34A',
  habits: '#0F9488',
  shadow: '#12305C',
};

/** Gradient pairs for icon tiles, keyed by module. */
export const TILE_GRADIENTS = {
  work: ['#67E8F9', '#0891B2'],
  sky: ['#7DD3FC', '#0284C7'],
  money: ['#6EE7B7', '#059669'],
  expense: ['#FCA5A5', '#DC2626'],
  study: ['#93C5FD', '#2563EB'],
  tasks: ['#86EFAC', '#16A34A'],
  habits: ['#5EEAD4', '#0D9488'],
  accent: ['#7DB8FF', '#1F6BEB'],
  pink: ['#F9A8D4', '#DB2777'],
  amber: ['#FDE68A', '#D97706'],
} as const satisfies Record<string, readonly [string, string]>;

export type TileTone = keyof typeof TILE_GRADIENTS;

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 28 } as const;
export const radius = { sm: 10, md: 14, lg: 22, pill: 999 } as const;

export const type = {
  largeTitle: { fontSize: 34, fontWeight: '700', letterSpacing: 0.37 },
  title: { fontSize: 22, fontWeight: '700', letterSpacing: 0.35 },
  headline: { fontSize: 17, fontWeight: '600' },
  body: { fontSize: 17, fontWeight: '400' },
  callout: { fontSize: 16, fontWeight: '400' },
  subhead: { fontSize: 15, fontWeight: '400' },
  footnote: { fontSize: 13, fontWeight: '400' },
  caption: { fontSize: 12, fontWeight: '500' },
  figure: { fontSize: 30, fontWeight: '700', fontVariant: ['tabular-nums'] },
} as const;

/** User-selectable colours for workplaces, subjects and habits. */
export const SWATCHES = ['#8B6CFF', '#60A5FA', '#34D399', '#22D3EE', '#2DD4BF', '#F472B6', '#FBBF24', '#94A3B8'] as const;
