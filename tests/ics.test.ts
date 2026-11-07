import { normaliseFeedUrl, parseIcs } from '@/features/calendar/ics';

// TZ=Australia/Melbourne (see package.json).
const local = (y: number, m: number, d: number, h: number, min = 0) => new Date(y, m - 1, d, h, min).getTime();
const window = { from: local(2026, 1, 1, 0), to: local(2027, 1, 1, 0) };

const wrap = (body: string) => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Uni//Timetable//EN\r\n${body}\r\nEND:VCALENDAR\r\n`;

describe('ICS parser', () => {
  it('reads a TZID weekly class across the April DST change, with EXDATE and an override', () => {
    const ics = wrap(
      [
        'BEGIN:VEVENT',
        'UID:lec-1@uni.edu.au',
        'SUMMARY:INTE2667 Lecture\\, Week 1',
        'LOCATION:Building 80\\, Level 5',
        'DTSTART;TZID=Australia/Melbourne:20260324T100000',
        'DTEND;TZID=Australia/Melbourne:20260324T120000',
        'RRULE:FREQ=WEEKLY;COUNT=4',
        'EXDATE;TZID=Australia/Melbourne:20260331T100000',
        'END:VEVENT',
        'BEGIN:VEVENT',
        'UID:lec-1@uni.edu.au',
        'RECURRENCE-ID;TZID=Australia/Melbourne:20260407T100000',
        'SUMMARY:INTE2667 Lecture (moved)',
        'DTSTART;TZID=Australia/Melbourne:20260407T140000',
        'DTEND;TZID=Australia/Melbourne:20260407T160000',
        'END:VEVENT',
      ].join('\r\n'),
    );
    const events = parseIcs(ics, window);
    expect(events.map((e) => [e.title, new Date(e.startAt).toString().slice(4, 21)])).toEqual([
      ['INTE2667 Lecture, Week 1', 'Mar 24 2026 10:00'],
      ['INTE2667 Lecture (moved)', 'Apr 07 2026 14:00'],
      ['INTE2667 Lecture, Week 1', 'Apr 14 2026 10:00'], // after DST ends, still 10 AM local
    ]);
    expect(events[0]).toMatchObject({ location: 'Building 80, Level 5', allDay: false });
    expect(events[0]!.endAt - events[0]!.startAt).toBe(2 * 3_600_000);
  });

  it('handles UTC times, Windows zone names, all-day events, folding and cancellations', () => {
    const ics = wrap(
      [
        'BEGIN:VEVENT',
        'UID:a',
        'SUMMARY:Tutorial',
        'DTSTART:20261110T230000Z',
        'DURATION:PT1H30M',
        'END:VEVENT',
        'BEGIN:VEVENT',
        'UID:b',
        'SUMMARY:Census da',
        ' te',
        'DTSTART;VALUE=DATE:20261112',
        'DTEND;VALUE=DATE:20261113',
        'BEGIN:VALARM',
        'SUMMARY:ignored alarm',
        'END:VALARM',
        'END:VEVENT',
        'BEGIN:VEVENT',
        'UID:c',
        'SUMMARY:Workshop',
        'DTSTART;TZID="AUS Eastern Standard Time":20261113T090000',
        'DTEND;TZID="AUS Eastern Standard Time":20261113T100000',
        'END:VEVENT',
        'BEGIN:VEVENT',
        'UID:d',
        'SUMMARY:Cancelled lab',
        'STATUS:CANCELLED',
        'DTSTART:20261114T000000Z',
        'END:VEVENT',
      ].join('\r\n'),
    );
    const events = parseIcs(ics, window);
    expect(events.map((e) => e.title)).toEqual(['Tutorial', 'Census date', 'Workshop']);
    // 23:00 UTC on 10 Nov = 10:00 AM AEDT on 11 Nov
    expect(events[0]!.startAt).toBe(local(2026, 11, 11, 10));
    expect(events[0]!.endAt - events[0]!.startAt).toBe(90 * 60_000);
    expect(events[1]).toMatchObject({ allDay: true, startAt: local(2026, 11, 12, 0), endAt: local(2026, 11, 13, 0) });
    // Sydney and Melbourne share a zone: 9 AM there is 9 AM here
    expect(events[2]!.startAt).toBe(local(2026, 11, 13, 9));
  });

  it('expands BYDAY weekly rules with UNTIL', () => {
    const ics = wrap(
      ['BEGIN:VEVENT', 'UID:w', 'SUMMARY:Lab', 'DTSTART:20261102T010000Z', 'DTEND:20261102T020000Z', 'RRULE:FREQ=WEEKLY;BYDAY=MO,WE;UNTIL=20261111T000000Z', 'END:VEVENT'].join('\r\n'),
    );
    expect(parseIcs(ics, window).map((e) => new Date(e.startAt).getDate())).toEqual([2, 4, 9]);
  });

  it('rejects non-calendar responses and bad links', () => {
    expect(() => parseIcs('<html>login</html>', window)).toThrow(/calendar/);
    expect(normaliseFeedUrl(' webcal://uni.edu.au/cal.ics ')).toBe('https://uni.edu.au/cal.ics');
    expect(() => normaliseFeedUrl('http://insecure.example/cal.ics')).toThrow();
    expect(() => normaliseFeedUrl('javascript:alert(1)')).toThrow();
  });
});
