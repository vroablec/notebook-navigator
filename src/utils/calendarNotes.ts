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

import { Platform, TFile, TFolder, normalizePath, type App } from 'obsidian';
import { strings } from '../i18n';
import type { NotebookNavigatorSettings } from '../settings/types';
import {
    createCalendarCustomDateFormatter,
    DEFAULT_CALENDAR_CUSTOM_MONTH_PATTERN,
    DEFAULT_CALENDAR_CUSTOM_QUARTER_PATTERN,
    DEFAULT_CALENDAR_CUSTOM_WEEK_PATTERN,
    DEFAULT_CALENDAR_CUSTOM_YEAR_PATTERN,
    ensureMarkdownFileName,
    isCalendarCustomDatePatternValid,
    isCalendarCustomMonthPatternValid,
    isCalendarCustomQuarterPatternValid,
    isCalendarCustomWeekPatternValid,
    isCalendarCustomYearPatternValid,
    normalizeCalendarCustomRootFolder,
    normalizeCalendarVaultFolderPath,
    splitCalendarCustomPattern
} from './calendarCustomNotePatterns';
import { stripForbiddenNameCharactersAllPlatforms, stripForbiddenNameCharactersWindows } from './fileNameUtils';
import type { MomentApi, MomentInstance } from './moment';

export interface CalendarNoteIndexEntry {
    file: TFile;
    title: string;
    mtime: number;
}

export type CalendarNoteKind = 'day' | 'week' | 'month' | 'quarter' | 'year';

export interface CalendarNoteConfig {
    calendarCustomFilePattern: string;
    fallbackPattern?: string;
    isPatternValid: (pattern: string, momentApi?: MomentApi | null) => boolean;
    parsingErrorText: string;
}

export function getCalendarNoteConfig(kind: CalendarNoteKind, settings: NotebookNavigatorSettings): CalendarNoteConfig {
    switch (kind) {
        case 'day':
            return {
                calendarCustomFilePattern: settings.calendarCustomFilePattern,
                isPatternValid: isCalendarCustomDatePatternValid,
                parsingErrorText: strings.settings.items.calendarCustomFilePattern.parsingError
            };
        case 'week':
            return {
                calendarCustomFilePattern: settings.calendarCustomWeekPattern,
                fallbackPattern: DEFAULT_CALENDAR_CUSTOM_WEEK_PATTERN,
                isPatternValid: isCalendarCustomWeekPatternValid,
                parsingErrorText: strings.settings.items.calendarCustomWeekPattern.parsingError
            };
        case 'month':
            return {
                calendarCustomFilePattern: settings.calendarCustomMonthPattern,
                fallbackPattern: DEFAULT_CALENDAR_CUSTOM_MONTH_PATTERN,
                isPatternValid: isCalendarCustomMonthPatternValid,
                parsingErrorText: strings.settings.items.calendarCustomMonthPattern.parsingError
            };
        case 'quarter':
            return {
                calendarCustomFilePattern: settings.calendarCustomQuarterPattern,
                fallbackPattern: DEFAULT_CALENDAR_CUSTOM_QUARTER_PATTERN,
                isPatternValid: isCalendarCustomQuarterPatternValid,
                parsingErrorText: strings.settings.items.calendarCustomQuarterPattern.parsingError
            };
        case 'year':
            return {
                calendarCustomFilePattern: settings.calendarCustomYearPattern,
                fallbackPattern: DEFAULT_CALENDAR_CUSTOM_YEAR_PATTERN,
                isPatternValid: isCalendarCustomYearPatternValid,
                parsingErrorText: strings.settings.items.calendarCustomYearPattern.parsingError
            };
    }
}

function stripMarkdownExtension(fileName: string): string | null {
    return /\.md$/iu.test(fileName) ? fileName.replace(/\.md$/iu, '') : null;
}

function parseCalendarNoteTitleSuffix(baseName: string, filePrefix: string): string | null {
    if (baseName === filePrefix) {
        return '';
    }

    if (!baseName.startsWith(filePrefix)) {
        return null;
    }

    const nextChar = baseName[filePrefix.length];
    if (!nextChar || !/[\t ]/u.test(nextChar)) {
        return null;
    }

    return baseName.slice(filePrefix.length).trim();
}

function findBestMatchingCalendarNoteInFolder(folder: TFolder, filePrefix: string): CalendarNoteIndexEntry | null {
    let bestEntry: CalendarNoteIndexEntry | null = null;

    for (const child of folder.children) {
        if (!(child instanceof TFile) || child.extension !== 'md') {
            continue;
        }

        const baseName = stripMarkdownExtension(child.name);
        if (!baseName) {
            continue;
        }

        const title = parseCalendarNoteTitleSuffix(baseName, filePrefix);
        if (title === null) {
            continue;
        }

        const mtime = child.stat?.mtime ?? 0;
        if (!bestEntry || mtime > bestEntry.mtime) {
            bestEntry = { file: child, title, mtime };
        }
    }

    return bestEntry;
}

export function buildCustomCalendarMomentPattern(calendarCustomFilePattern: string, fallbackPattern?: string): string {
    const { folderPattern, filePattern } = splitCalendarCustomPattern(calendarCustomFilePattern, fallbackPattern);
    return folderPattern ? `${folderPattern}/${filePattern}` : filePattern;
}

export function buildCustomCalendarFilePathForPattern(
    date: MomentInstance,
    settings: {
        calendarCustomRootFolder: string;
    },
    calendarCustomFilePattern: string,
    title: string,
    fallbackPattern?: string
): { folderPath: string; fileName: string; filePath: string; formattedFilePattern: string } {
    const customRootFolder = normalizeCalendarCustomRootFolder(settings.calendarCustomRootFolder);
    const { folderPattern: customFolderPattern, filePattern: customFilePattern } = splitCalendarCustomPattern(
        calendarCustomFilePattern,
        fallbackPattern
    );

    const folderFormatter = createCalendarCustomDateFormatter(customFolderPattern);
    const fileFormatter = createCalendarCustomDateFormatter(customFilePattern);

    const folderSuffix = folderFormatter(date);
    const rawFolderPath = customRootFolder ? (folderSuffix ? `${customRootFolder}/${folderSuffix}` : customRootFolder) : folderSuffix;
    const folderPath = normalizeCalendarVaultFolderPath(rawFolderPath || '/');

    const formattedFilePattern = fileFormatter(date).trim();
    const titleSuffix = title ? ` ${title}` : '';
    const fileName = ensureMarkdownFileName(`${formattedFilePattern}${titleSuffix}`.trim());
    const filePath = folderPath === '/' ? fileName : normalizePath(`${folderPath}/${fileName}`);

    return { folderPath, fileName, filePath, formattedFilePattern };
}

export function resolveExistingCustomCalendarNote(params: {
    app: App;
    date: MomentInstance;
    settings: {
        calendarCustomRootFolder: string;
    };
    calendarCustomFilePattern: string;
    fallbackPattern?: string;
    allowTitleSuffixMatch?: boolean;
}): CalendarNoteIndexEntry | null {
    const { folderPath, filePath, formattedFilePattern } = buildCustomCalendarFilePathForPattern(
        params.date,
        params.settings,
        params.calendarCustomFilePattern,
        '',
        params.fallbackPattern
    );

    if (!formattedFilePattern || !filePath) {
        return null;
    }

    const direct = params.app.vault.getAbstractFileByPath(filePath);
    if (direct instanceof TFile) {
        return { file: direct, title: '', mtime: direct.stat?.mtime ?? 0 };
    }

    const folder = folderPath === '/' ? params.app.vault.getRoot() : params.app.vault.getAbstractFileByPath(folderPath);
    if (!(folder instanceof TFolder)) {
        return null;
    }

    if (params.allowTitleSuffixMatch === false) {
        return null;
    }

    return findBestMatchingCalendarNoteInFolder(folder, formattedFilePattern);
}

/** Creates nested folders recursively if they don't exist, returns final folder or null when a path segment is not a folder. */
export async function ensureCalendarFolderExists(app: App, folderPath: string): Promise<TFolder | null> {
    if (folderPath === '/' || !folderPath) {
        return app.vault.getRoot();
    }

    const normalized = normalizePath(folderPath);
    if (!normalized || normalized === '/' || normalized === '.') {
        return app.vault.getRoot();
    }

    const parts = normalized.split('/').filter(Boolean);
    let current = '';
    for (const part of parts) {
        current = current ? `${current}/${part}` : part;
        const existing = app.vault.getAbstractFileByPath(current);
        if (!existing) {
            await app.vault.createFolder(current);
            continue;
        }
        if (!(existing instanceof TFolder)) {
            return null;
        }
    }

    const folder = app.vault.getAbstractFileByPath(normalized);
    return folder instanceof TFolder ? folder : null;
}

/** Strips forbidden filename characters from calendar note title based on platform. */
export function sanitizeCalendarTitle(rawTitle: string): string {
    const trimmed = rawTitle.trim();
    if (!trimmed) {
        return '';
    }

    let sanitized = stripForbiddenNameCharactersAllPlatforms(trimmed);
    if (Platform.isWin) {
        sanitized = stripForbiddenNameCharactersWindows(sanitized);
    }

    return sanitized.trim();
}
