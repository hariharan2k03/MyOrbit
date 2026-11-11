import { defaultWeekStart, findName, parseRoster, resolveRange, type OcrLine } from '@/features/work/rosterParse';

// Sunday 8 Nov 2026; Mon 9 Nov is the start of the next week.
const today = '2026-11-08';
const names = ['HARIHARAN'];
const H = 0.018;
const line = (text: string, x: number, y: number, width = 0.09): OcrLine => ({ text, x, y, width, height: H });
const shifts = (lines: OcrLine[], opts: { weekStart?: string; names?: string[] } = {}) => parseRoster(lines, { names: opts.names ?? names, today, weekStart: opts.weekStart });
const simple = (r: ReturnType<typeof shifts>) => r.shifts.map((s) => `${s.date} ${s.startTime}-${s.endTime}`);

const COLS = [0.25, 0.37, 0.49, 0.61, 0.73];
const header = (y: number, labels: string[]) => labels.map((l, i) => line(l, COLS[i]! - 0.04, y));

describe('time ranges', () => {
  const r = (a: string) => {
    const res = shifts([line('Mon 9/11', 0.05, 0.1), line(a, 0.3, 0.1, 0.2)], { names: [] });
    return simple(res)[0]?.split(' ')[1];
  };

  it.each([
    ['12-4', '12:00-16:00'],
    ['9-5', '09:00-17:00'],
    ['6-10', '18:00-22:00'],
    ['7-3', '07:00-15:00'],
    ['11-3pm', '11:00-15:00'],
    ['10pm-6', '22:00-06:00'],
    ['0900-1700', '09:00-17:00'],
    ['9:30a – 2p', '09:30-14:00'],
    ['6:00 PM - 10:00 PM', '18:00-22:00'],
    ['18:00 to 22:30', '18:00-22:30'],
    ['l2:0O-4:00', '12:00-16:00'],
  ])('reads %s as %s', (text, expected) => {
    expect(r(text)).toBe(expected);
  });

  it('rejects impossible or over-long ranges', () => {
    expect(r('09:00-09:00')).toBeUndefined();
    expect(resolveRange({ h: 6, m: 0, suffix: 'am', is24: false }, { h: 11, m: 0, suffix: 'pm', is24: false })).toBeNull();
  });
});

describe('names', () => {
  it('tolerates small OCR slips and split names', () => {
    expect(findName('HARlHARAN', names)).not.toBeNull();
    expect(findName('Hari Haran S', names)).not.toBeNull();
    expect(findName('HARIHARN', names)).not.toBeNull();
    expect(findName('HARISH', names)).toBeNull();
    expect(findName('HARI', ['HARI'])).not.toBeNull();
    expect(findName('HARRY', ['HARI'])).toBeNull();
  });
});

describe('week start', () => {
  it('assumes next week from Thursday onwards', () => {
    expect(defaultWeekStart('2026-11-08')).toBe('2026-11-09'); // Sunday
    expect(defaultWeekStart('2026-11-10')).toBe('2026-11-09'); // Tuesday
    expect(defaultWeekStart('2026-11-12')).toBe('2026-11-16'); // Thursday
  });
});

describe('team grid (people as rows)', () => {
  const grid: OcrLine[] = [
    line('Subway Team Roster', 0.3, 0.03, 0.4),
    line('Name', 0.03, 0.1),
    ...header(0.1, ['Mon 9/11', 'Tue 10/11', 'Wed 11/11', 'Thu 12/11', 'Fri 13/11']),
    line('JOHN SMITH', 0.03, 0.14),
    line('9-5', COLS[0]! - 0.03, 0.14, 0.06),
    line('9-5', COLS[3]! - 0.03, 0.14, 0.06),
    line('HARIHARAN', 0.03, 0.18),
    line('12:00-4:00', COLS[0]! - 0.04, 0.18),
    line('12pm-4pm', COLS[1]! - 0.04, 0.18),
    line('OFF', COLS[2]! - 0.02, 0.18, 0.04),
    line('6-9', COLS[4]! - 0.03, 0.18, 0.06),
    line('PRIYA', 0.03, 0.22),
    line('9-5', COLS[3]! - 0.03, 0.22, 0.06),
    line('5-10', COLS[4]! - 0.03, 0.22, 0.06),
  ];

  it('takes only my row and never borrows a neighbour’s cell', () => {
    const r = shifts(grid);
    expect(r).toMatchObject({ layout: 'grid', nameFound: true, usedWeekStart: false });
    expect(simple(r)).toEqual(['2026-11-09 12:00-16:00', '2026-11-10 12:00-16:00', '2026-11-13 18:00-21:00']);
  });

  it('finds nothing (rather than everyone’s shifts) when my name is missing', () => {
    const r = shifts(grid.filter((l) => l.text !== 'HARIHARAN'));
    expect(r.nameFound).toBe(false);
    expect(r.shifts).toEqual([]);
  });

  it('follows rows across a photo taken at an angle', () => {
    const tilt = 0.06;
    const skewed = grid.map((l) => ({ ...l, y: l.y + tilt * (l.x + l.width / 2) }));
    expect(simple(shifts(skewed))).toEqual(['2026-11-09 12:00-16:00', '2026-11-10 12:00-16:00', '2026-11-13 18:00-21:00']);
  });

  it('reads a start and finish written on two lines in one cell', () => {
    const stacked = [
      ...header(0.1, ['Mon 9/11', 'Tue 10/11', 'Wed 11/11', 'Thu 12/11', 'Fri 13/11']),
      line('JOHN', 0.03, 0.15),
      line('9:00', COLS[1]! - 0.03, 0.14, 0.05),
      line('17:00', COLS[1]! - 0.03, 0.16, 0.05),
      line('HARIHARAN', 0.03, 0.2),
      line('12:00', COLS[0]! - 0.03, 0.19, 0.05),
      line('16:00', COLS[0]! - 0.03, 0.21, 0.05),
    ];
    expect(simple(shifts(stacked))).toEqual(['2026-11-09 12:00-16:00']);
  });

  it('splits a header and a row that were each read as one long line', () => {
    const cells = (xs: string[]) => xs.map((s) => s.padEnd(8)).join('');
    const days = cells(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
    const mine = cells(['12-4', 'OFF', '12-4', 'OFF', '6-10', 'OFF', 'OFF']);
    const r = shifts(
      [line(days, 0.2, 0.1, 0.75), line('Hari Haran', 0.02, 0.15, 0.12), line(mine, 0.2, 0.15, 0.75), line('JOHN', 0.02, 0.2), line(cells(['9-5', '9-5', '9-5', '', '', '', '']), 0.2, 0.2, 0.75)],
      { weekStart: '2026-11-09' },
    );
    expect(r.usedWeekStart).toBe(true);
    expect(simple(r)).toEqual(['2026-11-09 12:00-16:00', '2026-11-11 12:00-16:00', '2026-11-13 18:00-22:00']);
  });
});

describe('transposed grid (people as columns)', () => {
  it('reads my column', () => {
    const r = shifts([
      line('Day', 0.03, 0.1),
      line('JOHN', 0.28, 0.1),
      line('HARIHARAN', 0.46, 0.1),
      line('PRIYA', 0.66, 0.1),
      line('Mon 9/11', 0.03, 0.15),
      line('9-5', 0.29, 0.15, 0.06),
      line('12-4', 0.48, 0.15, 0.06),
      line('Tue 10/11', 0.03, 0.2),
      line('6-10', 0.68, 0.2, 0.06),
      line('Wed 11/11', 0.03, 0.25),
      line('18:00-22:00', 0.47, 0.25),
    ]);
    expect(r.layout).toBe('columns');
    expect(simple(r)).toEqual(['2026-11-09 12:00-16:00', '2026-11-11 18:00-22:00']);
  });
});

describe('lists', () => {
  it('keeps only my lines under each day heading', () => {
    const r = shifts([
      line('Monday 9 November', 0.05, 0.1, 0.3),
      line('HARIHARAN', 0.05, 0.14),
      line('12:00 - 16:00', 0.4, 0.14, 0.15),
      line('JOHN', 0.05, 0.18),
      line('16:00 - 22:00', 0.4, 0.18, 0.15),
      line('Tuesday 10 November', 0.05, 0.24, 0.3),
      line('JOHN 9-5', 0.05, 0.28, 0.2),
      line('HARlHARAN 1pm-5pm', 0.05, 0.32, 0.3),
    ]);
    expect(r.layout).toBe('list');
    expect(simple(r)).toEqual(['2026-11-09 12:00-16:00', '2026-11-10 13:00-17:00']);
  });

  it('takes every shift from a personal roster with no names', () => {
    const r = shifts(
      [
        line('Subway – Team Roster', 0.2, 0.03, 0.5),
        line('Day', 0.1, 0.08),
        line('Shift', 0.5, 0.08),
        line('Mon', 0.1, 0.12, 0.05),
        line('12:00 PM – 4:00 PM', 0.4, 0.12, 0.3),
        line('Tue', 0.1, 0.16, 0.05),
        line('12:00 PM – 4:00 PM', 0.4, 0.16, 0.3),
        line('Wed', 0.1, 0.2, 0.05),
        line('12:00 PM – 4:00 PM', 0.4, 0.2, 0.3),
        line('Fri', 0.1, 0.24, 0.05),
        line('6:00 PM – 9:00 PM', 0.4, 0.24, 0.3),
      ],
      { weekStart: '2026-11-09' },
    );
    expect(r).toMatchObject({ nameFound: false, layout: 'list', usedWeekStart: true });
    expect(simple(r)).toEqual(['2026-11-09 12:00-16:00', '2026-11-10 12:00-16:00', '2026-11-11 12:00-16:00', '2026-11-13 18:00-21:00']);
  });

  it('dates "Mon 10" style headings to the nearest matching date', () => {
    const r = shifts([line('Tue 10', 0.05, 0.1), line('HARIHARAN 12-4', 0.3, 0.1, 0.3)]);
    expect(simple(r)).toEqual(['2026-11-10 12:00-16:00']);
  });
});
