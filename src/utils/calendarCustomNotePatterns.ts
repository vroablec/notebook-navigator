/*
 * Notebook Navigator - Plugin for Obsidian
 * Copyright (c) 2025 Johan Sanneblad
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

import { normalizePath } from 'obsidian';

export const DEFAULT_CALENDAR_CUSTOM_FILE_PATTERN = 'YYYY/YYYYMMDD';
export const DEFAULT_CALENDAR_CUSTOM_WEEK_PATTERN = 'gggg/[W]ww';
export const DEFAULT_CALENDAR_CUSTOM_MONTH_PATTERN = 'YYYY/YYYYMM';
export const DEFAULT_CALENDAR_CUSTOM_QUARTER_PATTERN = 'YYYY/[Q]Q';
export const DEFAULT_CALENDAR_CUSTOM_YEAR_PATTERN = 'YYYY';

/** Appends .md extension to file name if not already present */
export function ensureMarkdownFileName(value: string): string {
    const trimmed = value.trim();
    if (!trimmed) {
        return '';
    }
    return /\.md$/iu.test(trimmed) ? trimmed : `${trimmed}.md`;
}

/** Normalizes and sanitizes calendar root folder path, stripping leading/trailing slashes */
export function normalizeCalendarCustomRootFolder(value: string): string {
    const trimmed = value.trim();
    if (!trimmed || trimmed === '/') {
        return '';
    }
    const normalized = normalizePath(trimmed);
    if (!normalized || normalized === '/' || normalized === '.') {
        return '';
    }
    return normalized.replace(/^\/+/u, '').replace(/\/+$/u, '');
}

/** Normalizes file pattern, ensuring .md extension and returning default if invalid */
export function normalizeCalendarCustomFilePattern(value: string, fallback: string = DEFAULT_CALENDAR_CUSTOM_FILE_PATTERN): string {
    const trimmed = value.trim();
    if (!trimmed) {
        return fallback;
    }

    const normalized = normalizePath(trimmed)
        .replace(/ ?\{title\}/gu, '')
        .replace(/\.md$/iu, '');
    if (!normalized || normalized === '/' || normalized === '.') {
        return fallback;
    }

    const normalizedWithoutLeadingSlashes = normalized.replace(/^\/+/u, '');
    const slashIndex = normalizedWithoutLeadingSlashes.lastIndexOf('/');

    if (slashIndex === -1) {
        const fileName = normalizedWithoutLeadingSlashes.trim();
        return fileName || fallback;
    }

    const folderPart = normalizedWithoutLeadingSlashes.slice(0, slashIndex);
    const filePart = normalizedWithoutLeadingSlashes.slice(slashIndex + 1);
    const filePartTrimmed = filePart.trim();
    if (!filePartTrimmed) {
        return fallback;
    }

    return folderPart ? `${folderPart}/${filePartTrimmed}` : filePartTrimmed;
}

/** Splits file pattern into folder and file components based on last slash */
export function splitCalendarCustomPattern(value: string, fallback?: string): { folderPattern: string; filePattern: string } {
    const normalized = normalizeCalendarCustomFilePattern(value, fallback);
    const slashIndex = normalized.lastIndexOf('/');
    if (slashIndex === -1) {
        return { folderPattern: '', filePattern: normalized };
    }
    return {
        folderPattern: normalized.slice(0, slashIndex),
        filePattern: normalized.slice(slashIndex + 1)
    };
}

/** Normalizes folder path for vault operations, returning '/' for root */
export function normalizeCalendarVaultFolderPath(value: string): string {
    const normalized = normalizePath(value);
    if (!normalized || normalized === '.' || normalized === '/') {
        return '/';
    }
    return normalized.replace(/^\/+/u, '');
}

/**
 * Returns true when a custom calendar pattern (folder + filename, without extension) can be parsed as a full date
 * (year, month, day).
 */
export function isCalendarCustomDatePatternValid(pattern: string, momentApi?: MomentParseApi | null): boolean {
    const normalized = normalizeCalendarCustomMomentPattern(pattern);
    if (!normalized || normalized === '/' || normalized === '.') {
        return false;
    }

    if (!momentApi) {
        return isCalendarCustomDatePatternValidStatic(normalized);
    }

    // Round-trip validation:
    // 1) Format known sample dates using the provided pattern.
    // 2) Strict-parse the formatted strings using the same pattern.
    // 3) Accept the pattern only if the parsed date matches the original date for every sample.
    //
    // This ensures the pattern can uniquely represent a full date (year, month, day) when reading note paths back
    // from the vault, even if it repeats tokens (for example, including the month multiple times).
    //
    // Multiple samples are used to ensure the pattern includes enough information to disambiguate year/month/day.
    return isCalendarCustomMomentPatternRoundTripValid(momentApi, normalized, ['2026-01-16', '2027-02-17'], ['YYYY-MM-DD']);
}

export function isCalendarCustomWeekPatternValid(pattern: string, momentApi?: MomentParseApi | null): boolean {
    const normalized = normalizeCalendarCustomMomentPattern(pattern);
    if (!normalized || normalized === '/' || normalized === '.') {
        return false;
    }

    if (!momentApi) {
        return normalized.includes('w') || normalized.includes('W');
    }

    return isCalendarCustomMomentPatternRoundTripValid(
        momentApi,
        normalized,
        ['2021-01-01', '2026-06-19', '2027-02-17'],
        ['GGGG-[W]WW', 'gggg-[W]ww']
    );
}

export function isCalendarCustomMonthPatternValid(pattern: string, momentApi?: MomentParseApi | null): boolean {
    const normalized = normalizeCalendarCustomMomentPattern(pattern);
    if (!normalized || normalized === '/' || normalized === '.') {
        return false;
    }

    if (!momentApi) {
        return normalized.includes('Y') && normalized.includes('M');
    }

    return isCalendarCustomMomentPatternRoundTripValid(momentApi, normalized, ['2026-01-16', '2027-02-17'], ['YYYY-MM']);
}

export function isCalendarCustomQuarterPatternValid(pattern: string, momentApi?: MomentParseApi | null): boolean {
    const normalized = normalizeCalendarCustomMomentPattern(pattern);
    if (!normalized || normalized === '/' || normalized === '.') {
        return false;
    }

    if (!momentApi) {
        return normalized.includes('Y') && normalized.includes('Q');
    }

    return isCalendarCustomMomentPatternRoundTripValid(momentApi, normalized, ['2026-01-16', '2026-07-15', '2027-04-03'], ['YYYY-[Q]Q']);
}

export function isCalendarCustomYearPatternValid(pattern: string, momentApi?: MomentParseApi | null): boolean {
    const normalized = normalizeCalendarCustomMomentPattern(pattern);
    if (!normalized || normalized === '/' || normalized === '.') {
        return false;
    }

    if (!momentApi) {
        return normalized.includes('Y');
    }

    return isCalendarCustomMomentPatternRoundTripValid(momentApi, normalized, ['2026-01-16', '2027-02-17'], ['YYYY']);
}

export interface CalendarCustomParsedNotePath {
    iso: string;
    title: string;
}

interface MomentFormatLike {
    format: (format?: string) => string;
}

interface MomentParseResult {
    isValid: () => boolean;
    format: (format?: string) => string;
}

interface MomentParseApi {
    (input?: string, format?: string, strict?: boolean): MomentParseResult;
}

function isCalendarCustomMomentPatternRoundTripValid(
    momentApi: MomentParseApi,
    normalizedPattern: string,
    sampleIsoDates: readonly string[],
    compareFormats: readonly string[]
): boolean {
    for (const compareFormat of compareFormats) {
        let allSamplesMatch = true;

        for (const sampleIso of sampleIsoDates) {
            const sampleDate = momentApi(sampleIso, 'YYYY-MM-DD', true);
            if (!sampleDate.isValid()) {
                allSamplesMatch = false;
                break;
            }

            const rendered = sampleDate.format(normalizedPattern);
            if (!rendered) {
                allSamplesMatch = false;
                break;
            }

            const parsed = momentApi(rendered, normalizedPattern, true);
            if (!parsed.isValid()) {
                allSamplesMatch = false;
                break;
            }

            if (parsed.format(compareFormat) !== sampleDate.format(compareFormat)) {
                allSamplesMatch = false;
                break;
            }
        }

        if (allSamplesMatch) {
            return true;
        }
    }

    return false;
}

function normalizeCalendarCustomMomentPattern(pattern: string): string {
    return pattern
        .trim()
        .replace(/\.md$/iu, '')
        .replace(/ ?\{title\}/gu, '');
}

function isCalendarCustomDatePatternValidStatic(pattern: string): boolean {
    const normalized = normalizeCalendarCustomMomentPattern(pattern);
    if (!normalized || normalized === '/' || normalized === '.') {
        return false;
    }

    const hasYear = normalized.includes('YYYY');
    const hasMonth = normalized.includes('MM') || normalized.includes('M');
    const hasDay = normalized.includes('DD') || normalized.includes('D');

    return hasYear && hasMonth && hasDay;
}

export function createCalendarCustomDateFormatter(pattern: string): (date: MomentFormatLike) => string {
    const normalized = normalizeCalendarCustomMomentPattern(pattern);
    if (!normalized) {
        return () => '';
    }

    return (date: MomentFormatLike) => date.format(normalized);
}

function stripMarkdownExtension(value: string): string | null {
    return /\.md$/iu.test(value) ? value.replace(/\.md$/iu, '') : null;
}

function tryParseCalendarCustomMoment(momentApi: MomentParseApi, input: string, format: string): string | null {
    const parsed = momentApi(input, format, true);
    return parsed.isValid() ? parsed.format('YYYY-MM-DD') : null;
}

/**
 * Creates a parser for calendar note paths (relative to the configured root folder) that extracts ISO dates and
 * optional title suffixes.
 */
export function createCalendarCustomNotePathParser(
    momentApi: MomentParseApi,
    datePattern: string
): ((relativePath: string) => CalendarCustomParsedNotePath | null) | null {
    const trimmedPattern = normalizeCalendarCustomMomentPattern(datePattern);
    if (!trimmedPattern || !isCalendarCustomDatePatternValid(trimmedPattern, momentApi)) {
        return null;
    }

    const format = trimmedPattern;

    return (relativePath: string): CalendarCustomParsedNotePath | null => {
        const withoutExt = stripMarkdownExtension(relativePath);
        if (!withoutExt) {
            return null;
        }

        const directIso = tryParseCalendarCustomMoment(momentApi, withoutExt, format);
        if (directIso) {
            return { iso: directIso, title: '' };
        }

        const slashIndex = withoutExt.lastIndexOf('/');
        const folderPrefix = slashIndex === -1 ? '' : withoutExt.slice(0, slashIndex + 1);
        const filePart = slashIndex === -1 ? withoutExt : withoutExt.slice(slashIndex + 1);

        const whitespacePattern = /[ \t]+/gu;
        const matches = [...filePart.matchAll(whitespacePattern)];
        for (let index = matches.length - 1; index >= 0; index--) {
            const match = matches[index];
            const start = match.index;
            if (start === undefined) {
                continue;
            }

            const title = filePart.slice(start + match[0].length).trim();
            if (!title) {
                continue;
            }

            const candidateFile = filePart.slice(0, start);
            if (!candidateFile) {
                continue;
            }

            const candidatePath = `${folderPrefix}${candidateFile}`;
            const iso = tryParseCalendarCustomMoment(momentApi, candidatePath, format);
            if (!iso) {
                continue;
            }

            return { iso, title };
        }

        return null;
    };
}
