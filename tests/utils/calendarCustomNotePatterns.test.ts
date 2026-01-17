import { describe, expect, test } from 'vitest';
import moment from 'moment';
import {
    createCalendarCustomDateFormatter,
    createCalendarCustomNotePathParser,
    isCalendarCustomDatePatternValid
} from '../../src/utils/calendarCustomNotePatterns';

describe('calendar custom note patterns', () => {
    test('validates date patterns across folders and filenames', () => {
        expect(isCalendarCustomDatePatternValid('YYYY-MM-DD')).toBe(true);
        expect(isCalendarCustomDatePatternValid('YYYY.MM.DD')).toBe(true);
        expect(isCalendarCustomDatePatternValid('YYYY/MM/DD')).toBe(true);
        expect(isCalendarCustomDatePatternValid('YYYY/YYYY-MM-DD')).toBe(true);
        expect(isCalendarCustomDatePatternValid('YYYY/MM/MMDD')).toBe(true);
        expect(isCalendarCustomDatePatternValid('YYYY/YYYYMMDD')).toBe(true);

        expect(isCalendarCustomDatePatternValid('YYYY-MM')).toBe(false);
        expect(isCalendarCustomDatePatternValid('MM-DD')).toBe(false);
        expect(isCalendarCustomDatePatternValid('')).toBe(false);
        expect(isCalendarCustomDatePatternValid('YY-MM-DD')).toBe(false);
        expect(isCalendarCustomDatePatternValid('YYYY-MMM-DD')).toBe(false);
    });

    test('formats dates using supported tokens only', () => {
        const date = moment('2026-01-16', 'YYYY-MM-DD', true);
        const formatter = createCalendarCustomDateFormatter('YYYY/MM/DD Journal');
        expect(formatter(date)).toBe('2026/01/16 Journal');
    });

    test('parses common calendar note paths', () => {
        const parser = createCalendarCustomNotePathParser(moment, 'YYYY-MM-DD');
        expect(parser?.('2026-01-16.md')).toEqual({ iso: '2026-01-16', title: '' });

        const dotParser = createCalendarCustomNotePathParser(moment, 'YYYY.MM.DD');
        expect(dotParser?.('2026.01.16.md')).toEqual({ iso: '2026-01-16', title: '' });

        const pathParser = createCalendarCustomNotePathParser(moment, 'YYYY/MM/DD');
        expect(pathParser?.('2026/01/16.md')).toEqual({ iso: '2026-01-16', title: '' });

        const repeatedYearParser = createCalendarCustomNotePathParser(moment, 'YYYY/YYYY-MM-DD');
        expect(repeatedYearParser?.('2026/2026-01-16.md')).toEqual({ iso: '2026-01-16', title: '' });

        const combinedMonthDayParser = createCalendarCustomNotePathParser(moment, 'YYYY/MM/MMDD');
        expect(combinedMonthDayParser?.('2026/01/0116.md')).toEqual({ iso: '2026-01-16', title: '' });
    });

    test('parses optional title suffixes', () => {
        const parser = createCalendarCustomNotePathParser(moment, 'YYYY/MM/DD');
        expect(parser?.('2026/01/16 My title.md')).toEqual({ iso: '2026-01-16', title: 'My title' });

        const dashParser = createCalendarCustomNotePathParser(moment, 'YYYY-MM-DD -');
        expect(dashParser?.('2026-01-16 - My title.md')).toEqual({ iso: '2026-01-16', title: 'My title' });

        const literalSuffixParser = createCalendarCustomNotePathParser(moment, 'YYYYMMDD Journal');
        expect(literalSuffixParser?.('20260116 Journal My title.md')).toEqual({ iso: '2026-01-16', title: 'My title' });
    });

    test('rejects invalid dates and strict mismatches', () => {
        const parser = createCalendarCustomNotePathParser(moment, 'YYYY-MM-DD');
        expect(parser?.('2026-13-01.md')).toBeNull();
        expect(parser?.('2026-01-99.md')).toBeNull();

        const strictParser = createCalendarCustomNotePathParser(moment, 'YYYY/MM/DD');
        expect(strictParser?.('2026/1/16.md')).toBeNull();

        const lenientParser = createCalendarCustomNotePathParser(moment, 'YYYY/M/DD');
        expect(lenientParser?.('2026/1/16.md')).toEqual({ iso: '2026-01-16', title: '' });
        expect(lenientParser?.('2026/01/16.md')).toEqual({ iso: '2026-01-16', title: '' });
    });
});
