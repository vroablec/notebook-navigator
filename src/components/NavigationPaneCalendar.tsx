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

import React, { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Menu, Notice, TFile, TFolder } from 'obsidian';
import { getWeek, getWeekYear } from 'date-fns';
import { getCurrentLanguage, strings } from '../i18n';
import { ConfirmModal } from '../modals/ConfirmModal';
import { InputModal } from '../modals/InputModal';
import { useServices } from '../context/ServicesContext';
import { useSettingsState } from '../context/SettingsContext';
import { useFileCacheOptional } from '../context/StorageContext';
import { getDBInstanceOrNull } from '../storage/fileOperations';
import { runAsyncAction } from '../utils/async';
import { DateUtils } from '../utils/dateUtils';
import {
    createDailyNote,
    getDailyNoteFile,
    getDailyNoteFilename,
    getDailyNoteSettings as getCoreDailyNoteSettings
} from '../utils/dailyNotes';
import { getMomentApi, resolveMomentLocale, type MomentInstance } from '../utils/moment';
import { getCalendarWeekConfig } from '../utils/dateFnsLocale';
import { ServiceIcon } from './ServiceIcon';
import { useFileOpener } from '../hooks/useFileOpener';
import {
    buildCustomCalendarFilePathForPattern,
    buildCustomCalendarMomentPattern,
    ensureCalendarFolderExists,
    getCalendarNoteConfig,
    resolveExistingCustomCalendarNote,
    sanitizeCalendarTitle,
    type CalendarNoteConfig,
    type CalendarNoteKind,
    type CalendarNoteIndexEntry
} from '../utils/calendarNotes';
import {
    createCalendarCustomDateFormatter,
    createCalendarCustomNotePathParser,
    type CalendarCustomParsedNotePath,
    normalizeCalendarCustomRootFolder,
    normalizeCalendarVaultFolderPath,
    splitCalendarCustomPattern
} from '../utils/calendarCustomNotePatterns';
import { getTooltipPlacement } from '../utils/domUtils';
import { resolveUXIconForMenu } from '../utils/uxIcons';
import type { CalendarWeeksToShow } from '../settings/types';

interface CalendarHoverTooltipData {
    imageUrl: string | null;
    title: string;
    dateTimestamp: number;
    previewPath: string | null;
    previewEnabled: boolean;
    showDate: boolean;
}

interface CalendarDay {
    date: MomentInstance;
    iso: string;
    inMonth: boolean;
    file: TFile | null;
    title: string;
}

interface CalendarWeek {
    key: string;
    weekNumber: number;
    days: CalendarDay[];
}

interface CalendarDayButtonProps {
    className: string;
    ariaText: string;
    dayNumber: number;
    isMobile: boolean;
    onClick: () => void;
    onContextMenu: (event: React.MouseEvent<HTMLButtonElement>) => void;
    style: React.CSSProperties | undefined;
    tooltipEnabled: boolean;
    tooltipData: CalendarHoverTooltipData;
    onHideTooltip: (element: HTMLElement) => void;
    onShowTooltip: (element: HTMLElement, tooltipData: CalendarHoverTooltipData) => void;
}

/** Renders a calendar day button with hover tooltip support on desktop */
function CalendarDayButton({
    className,
    ariaText,
    dayNumber,
    isMobile,
    onClick,
    onContextMenu,
    style,
    tooltipEnabled,
    tooltipData,
    onHideTooltip,
    onShowTooltip
}: CalendarDayButtonProps) {
    const buttonRef = useRef<HTMLButtonElement | null>(null);
    const { dateTimestamp, imageUrl, previewEnabled, previewPath, showDate, title } = tooltipData;
    const tooltipDataMemo = useMemo<CalendarHoverTooltipData>(
        () => ({
            imageUrl,
            title,
            dateTimestamp,
            previewPath,
            previewEnabled,
            showDate
        }),
        [dateTimestamp, imageUrl, previewEnabled, previewPath, showDate, title]
    );

    const handleMouseEnter = useCallback(() => {
        if (isMobile || !tooltipEnabled) {
            return;
        }

        const element = buttonRef.current;
        if (!element) {
            return;
        }

        onShowTooltip(element, tooltipDataMemo);
    }, [isMobile, onShowTooltip, tooltipDataMemo, tooltipEnabled]);

    const handleMouseLeave = useCallback(() => {
        const element = buttonRef.current;
        if (!element || isMobile) {
            return;
        }

        onHideTooltip(element);
    }, [isMobile, onHideTooltip]);

    const handleClick = useCallback(() => {
        const element = buttonRef.current;
        if (element) {
            onHideTooltip(element);
        }

        onClick();
    }, [onClick, onHideTooltip]);

    useEffect(() => {
        const element = buttonRef.current;
        if (!element) {
            return;
        }

        if (isMobile) {
            return;
        }

        if (!tooltipEnabled) {
            return;
        }

        if (!element.matches(':hover')) {
            return;
        }

        onShowTooltip(element, tooltipDataMemo);
    }, [isMobile, onShowTooltip, tooltipDataMemo, tooltipEnabled]);

    return (
        <button
            ref={buttonRef}
            type="button"
            className={className}
            style={style}
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
            onClick={handleClick}
            onContextMenu={onContextMenu}
        >
            <span className="nn-navigation-calendar-day-number" aria-hidden="true">
                {dayNumber}
            </span>
            <span className="nn-visually-hidden">{ariaText}</span>
        </button>
    );
}

function clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max);
}

function formatIsoDate(date: MomentInstance): string {
    return date.format('YYYY-MM-DD');
}

function getDayOfWeek(date: MomentInstance): number {
    // Use the JS Date weekday (0..6, Sunday..Saturday) to avoid relying on locale-specific moment formatting tokens.
    return date.toDate().getDay();
}

function startOfWeek(date: MomentInstance, weekStartsOn: number): MomentInstance {
    // Compute week starts using date-fns locale rules (first day of week) while keeping moment for date math/formatting.
    const dayOfWeek = getDayOfWeek(date);
    const diff = (dayOfWeek - weekStartsOn + 7) % 7;
    return date.clone().subtract(diff, 'day').startOf('day');
}

type CustomCalendarIndexEntry = CalendarNoteIndexEntry;

/** Builds an ISO->note lookup table for files in a single folder, choosing the newest file when duplicates exist */
function buildCustomCalendarFolderIndex(
    folder: TFolder,
    relativeFolderPath: string,
    parsePath: (relativePath: string) => CalendarCustomParsedNotePath | null
): Map<string, CustomCalendarIndexEntry> {
    const index = new Map<string, CustomCalendarIndexEntry>();

    for (const child of folder.children) {
        if (!(child instanceof TFile) || child.extension !== 'md') {
            continue;
        }

        const relativePath = relativeFolderPath ? `${relativeFolderPath}/${child.name}` : child.name;
        const parsed = parsePath(relativePath);
        if (!parsed) {
            continue;
        }

        const mtime = child.stat?.mtime ?? 0;
        const existing = index.get(parsed.iso);
        if (!existing || mtime > existing.mtime) {
            index.set(parsed.iso, { file: child, title: parsed.title, mtime });
        }
    }

    return index;
}

/** Converts an absolute vault folder path to a path relative to the configured custom calendar root */
function getPathRelativeToCustomCalendarRoot(folderPath: string, customRootFolder: string): string {
    if (folderPath === '/' || folderPath === customRootFolder) {
        return '';
    }

    if (!customRootFolder) {
        return folderPath === '/' ? '' : folderPath;
    }

    const prefix = `${customRootFolder}/`;
    return folderPath.startsWith(prefix) ? folderPath.slice(prefix.length) : folderPath;
}

export interface NavigationPaneCalendarProps {
    onWeekCountChange?: (count: number) => void;
    layout?: 'overlay' | 'panel';
    weeksToShowOverride?: CalendarWeeksToShow;
}

interface CalendarHoverTooltipState {
    anchorEl: HTMLElement;
    tooltipData: CalendarHoverTooltipData;
}

type CustomCalendarNoteKind = CalendarNoteKind;
type CustomCalendarNoteConfig = CalendarNoteConfig;
const MAX_CUSTOM_CALENDAR_LOOKUP_CACHE_ENTRIES = 512;

function parseCalendarBasenameTitle(basename: string): { title: string; showDate: boolean } {
    const trimmed = basename.trim();
    if (!trimmed) {
        return { title: '', showDate: false };
    }

    const match = /^(\d{8}|\d{4}-\d{2}-\d{2})(?:[ \t]+(.+))?$/u.exec(trimmed);
    if (!match) {
        return { title: trimmed, showDate: false };
    }

    const suffix = match[2]?.trim() ?? '';
    if (suffix) {
        return { title: suffix, showDate: true };
    }

    return { title: '', showDate: false };
}

export function NavigationPaneCalendar({ onWeekCountChange, layout = 'overlay', weeksToShowOverride }: NavigationPaneCalendarProps) {
    const { app, fileSystemOps, isMobile } = useServices();
    const settings = useSettingsState();
    const weeksToShowSetting = weeksToShowOverride ?? settings.calendarWeeksToShow;
    const fileCache = useFileCacheOptional();
    const [dbFallback, setDbFallback] = useState(() => getDBInstanceOrNull());
    const db = fileCache?.getDB() ?? dbFallback;
    const openFile = useFileOpener();
    const calendarLabelId = useId();

    const momentApi = getMomentApi();
    const [cursorDate, setCursorDate] = useState<MomentInstance | null>(() => (momentApi ? momentApi().startOf('day') : null));
    const todayIso = momentApi ? formatIsoDate(momentApi().startOf('day')) : null;

    const [vaultVersion, setVaultVersion] = useState(0);
    const [contentVersion, setContentVersion] = useState(0);
    const visibleDailyNotePathsRef = useRef<Set<string>>(new Set());
    const hoverTooltipStateRef = useRef<CalendarHoverTooltipState | null>(null);

    useEffect(() => {
        if (typeof window === 'undefined') {
            return;
        }

        if (fileCache) {
            return;
        }

        if (dbFallback) {
            return;
        }

        let isActive = true;
        const intervalId = window.setInterval(() => {
            if (!isActive) {
                return;
            }

            const instance = getDBInstanceOrNull();
            if (!instance) {
                return;
            }

            window.clearInterval(intervalId);
            setDbFallback(instance);
        }, 250);

        return () => {
            isActive = false;
            window.clearInterval(intervalId);
        };
    }, [dbFallback, fileCache]);

    useEffect(() => {
        const onVaultUpdate = () => setVaultVersion(v => v + 1);
        const createRef = app.vault.on('create', onVaultUpdate);
        const deleteRef = app.vault.on('delete', onVaultUpdate);
        const renameRef = app.vault.on('rename', onVaultUpdate);

        return () => {
            app.vault.offref(createRef);
            app.vault.offref(deleteRef);
            app.vault.offref(renameRef);
        };
    }, [app.vault]);

    useEffect(() => {
        if (!db) {
            return;
        }

        return db.onContentChange(changes => {
            const visiblePaths = visibleDailyNotePathsRef.current;
            const hasCalendarRelevantChange = changes.some(change => {
                if (!visiblePaths.has(change.path)) {
                    return false;
                }
                return (
                    change.changes.preview !== undefined ||
                    change.changes.featureImage !== undefined ||
                    change.changes.featureImageKey !== undefined ||
                    change.changes.featureImageStatus !== undefined
                );
            });

            if (hasCalendarRelevantChange) {
                setContentVersion(v => v + 1);
            }
        });
    }, [db]);

    useEffect(() => {
        // Obsidian exposes `window.moment` after startup; in tests (or very early) it may be unavailable.
        if (!momentApi || cursorDate) {
            return;
        }
        setCursorDate(momentApi().startOf('day'));
    }, [cursorDate, momentApi]);

    const displayLocale = useMemo(() => {
        if (!momentApi) {
            return 'en';
        }

        // Month name / weekday labels follow the current UI language by default.
        const currentLanguage = getCurrentLanguage();
        const fallback = momentApi.locale() || 'en';
        const requested = (currentLanguage || fallback).replace(/_/g, '-');

        return resolveMomentLocale(requested, momentApi, fallback);
    }, [momentApi]);

    const calendarRulesLocale = useMemo(() => {
        if (!momentApi) {
            return 'en';
        }
        // Week rules (week starts on, week number calculation) can differ from display locale; allow override.
        const requested = settings.calendarLocale === 'system-default' ? displayLocale : settings.calendarLocale;
        return resolveMomentLocale(requested, momentApi, displayLocale);
    }, [displayLocale, momentApi, settings.calendarLocale]);

    const customCalendarLookupCacheScopeKey = useMemo(() => {
        return [
            displayLocale,
            calendarRulesLocale,
            settings.calendarCustomRootFolder,
            settings.calendarCustomFilePattern,
            settings.calendarCustomWeekPattern,
            settings.calendarCustomMonthPattern,
            settings.calendarCustomQuarterPattern,
            settings.calendarCustomYearPattern
        ].join('\u0000');
    }, [
        calendarRulesLocale,
        displayLocale,
        settings.calendarCustomFilePattern,
        settings.calendarCustomMonthPattern,
        settings.calendarCustomQuarterPattern,
        settings.calendarCustomRootFolder,
        settings.calendarCustomWeekPattern,
        settings.calendarCustomYearPattern
    ]);

    const weekConfig = useMemo(() => getCalendarWeekConfig(calendarRulesLocale), [calendarRulesLocale]);
    const weekStartsOn = weekConfig.weekStartsOn;

    const weekdays = useMemo(() => {
        if (!momentApi) {
            return [];
        }

        const firstDay = weekStartsOn;
        const localeData = momentApi().locale(displayLocale).localeData();
        const labels = layout === 'panel' ? localeData.weekdaysShort() : localeData.weekdaysMin();
        if (!Array.isArray(labels) || labels.length !== 7) {
            return [];
        }
        const ordered = [...labels.slice(firstDay), ...labels.slice(0, firstDay)];
        if (layout === 'panel') {
            return ordered.map(label => {
                const normalized = label.trim().replace(/\./g, '');
                return normalized.length > 3 ? normalized.slice(0, 3) : normalized;
            });
        }
        return ordered.map(label => Array.from(label.trim())[0] ?? '');
    }, [displayLocale, layout, momentApi, weekStartsOn]);

    const dailyNoteSettings = useMemo(() => {
        // Force refresh when vault contents change so `getDailyNoteFile()` reflects created/renamed/deleted daily notes.
        void vaultVersion;
        if (settings.calendarIntegrationMode !== 'daily-notes') {
            return null;
        }
        return getCoreDailyNoteSettings(app);
    }, [app, settings.calendarIntegrationMode, vaultVersion]);

    const weeks = useMemo<CalendarWeek[]>(() => {
        if (!momentApi || !cursorDate) {
            return [];
        }

        // Force refresh when vault contents change so custom calendar resolution reflects created/renamed/deleted notes.
        void vaultVersion;

        const integrationMode = settings.calendarIntegrationMode;
        const customRootFolder = normalizeCalendarCustomRootFolder(settings.calendarCustomRootFolder);
        const { folderPattern: customFolderPattern, filePattern: customFilePattern } = splitCalendarCustomPattern(
            settings.calendarCustomFilePattern
        );
        const customPattern = customFolderPattern ? `${customFolderPattern}/${customFilePattern}` : customFilePattern;
        const customNotePathParser =
            integrationMode === 'notebook-navigator' ? createCalendarCustomNotePathParser(momentApi, customPattern) : null;
        const folderIndexCache = new Map<string, Map<string, CustomCalendarIndexEntry> | null>();
        const folderFormatter = createCalendarCustomDateFormatter(customFolderPattern);

        const weeksToShow = clamp(weeksToShowSetting, 1, 6);
        const cursor = cursorDate.clone().startOf('day');
        const cursorWeekStart = startOfWeek(cursor.clone(), weekStartsOn);
        const targetMonth = cursor.month();
        const targetYear = cursor.year();

        let windowStart: MomentInstance;
        let weekCount: number;

        if (weeksToShow === 6) {
            // `6` means "full month": render as many week rows as needed to cover the month grid (capped at 6).
            const monthStart = cursor.clone().startOf('month');
            const gridStart = startOfWeek(monthStart, weekStartsOn);
            const monthEnd = monthStart.clone().endOf('month');
            const gridEndWeekStart = startOfWeek(monthEnd, weekStartsOn);
            const totalWeeks = clamp(gridEndWeekStart.diff(gridStart, 'weeks') + 1, 1, 6);

            windowStart = gridStart;
            weekCount = totalWeeks;
        } else {
            // For 1..5 weeks: show a sliding N-week window around the cursor week (page navigation never skips weeks).
            const offset = Math.floor((weeksToShow - 1) / 2);
            windowStart = cursorWeekStart.clone().subtract(offset, 'week');
            weekCount = weeksToShow;
        }

        const visibleWeeks: CalendarWeek[] = [];
        for (let weekOffset = 0; weekOffset < weekCount; weekOffset++) {
            const weekStart = windowStart.clone().add(weekOffset, 'week');
            const weekNumber = getWeek(weekStart.toDate(), weekConfig);
            const weekYear = getWeekYear(weekStart.toDate(), weekConfig);

            const days: CalendarDay[] = [];
            for (let dayOffset = 0; dayOffset < 7; dayOffset++) {
                const date = weekStart.clone().add(dayOffset, 'day');
                const inMonth = date.month() === targetMonth && date.year() === targetYear;
                const iso = formatIsoDate(date);
                let file: TFile | null = null;
                let title = '';

                if (integrationMode === 'notebook-navigator') {
                    const folderSuffix = folderFormatter(date);
                    const rawFolderPath = customRootFolder
                        ? folderSuffix
                            ? `${customRootFolder}/${folderSuffix}`
                            : customRootFolder
                        : folderSuffix;
                    const folderPath = normalizeCalendarVaultFolderPath(rawFolderPath || '/');
                    if (customNotePathParser) {
                        let folderIndex = folderIndexCache.get(folderPath);
                        if (folderIndex === undefined) {
                            const folder = folderPath === '/' ? app.vault.getRoot() : app.vault.getAbstractFileByPath(folderPath);
                            const relativeFolderPath = getPathRelativeToCustomCalendarRoot(folderPath, customRootFolder);
                            folderIndex =
                                folder instanceof TFolder
                                    ? buildCustomCalendarFolderIndex(folder, relativeFolderPath, customNotePathParser)
                                    : null;
                            folderIndexCache.set(folderPath, folderIndex);
                        }

                        const entry = folderIndex?.get(iso);
                        if (entry) {
                            file = entry.file;
                            title = entry.title;
                        }
                    }
                } else {
                    file = dailyNoteSettings ? getDailyNoteFile(app, date, dailyNoteSettings) : null;
                }

                days.push({ date, iso, inMonth, file, title });
            }

            visibleWeeks.push({
                key: `week-${weekYear}-W${weekNumber}`,
                weekNumber,
                days
            });
        }

        return visibleWeeks;
    }, [
        app,
        cursorDate,
        dailyNoteSettings,
        momentApi,
        vaultVersion,
        settings.calendarCustomFilePattern,
        settings.calendarCustomRootFolder,
        settings.calendarIntegrationMode,
        weeksToShowSetting,
        weekConfig,
        weekStartsOn
    ]);

    const visibleDailyNotePaths = useMemo(() => {
        const paths = new Set<string>();
        for (const week of weeks) {
            for (const day of week.days) {
                if (day.file) {
                    paths.add(day.file.path);
                }
            }
        }
        return paths;
    }, [weeks]);
    visibleDailyNotePathsRef.current = visibleDailyNotePaths;

    const featureImageKeysByIso = useMemo(() => {
        // Force refresh when calendar-relevant content changes so feature-image keys reflect the latest metadata.
        void contentVersion;

        if (!settings.calendarShowFeatureImage) {
            return new Map<string, string>();
        }

        if (!db) {
            return new Map<string, string>();
        }

        const keys = new Map<string, string>();

        for (const week of weeks) {
            for (const day of week.days) {
                if (!day.file) {
                    continue;
                }

                const record = db.getFile(day.file.path);
                const featureKey = record?.featureImageKey ?? null;
                const featureStatus = record?.featureImageStatus ?? null;
                if (featureStatus !== 'has' || !featureKey || featureKey === '') {
                    continue;
                }

                keys.set(day.iso, featureKey);
            }
        }

        return keys;
    }, [contentVersion, db, settings.calendarShowFeatureImage, weeks]);

    useLayoutEffect(() => {
        if (weeks.length === 0) {
            return;
        }
        onWeekCountChange?.(weeks.length);
    }, [onWeekCountChange, weeks.length]);

    const featureImageUrlMapRef = useRef<Map<string, { key: string; url: string }>>(new Map());
    const [featureImageUrls, setFeatureImageUrls] = useState<Record<string, string>>({});
    // Hover tooltip state for showing feature images and titles on desktop
    const [hoverTooltip, setHoverTooltip] = useState<CalendarHoverTooltipState | null>(null);
    const [hoverTooltipStyle, setHoverTooltipStyle] = useState<React.CSSProperties | null>(null);
    const hoverTooltipRef = useRef<HTMLDivElement | null>(null);
    const hoverTooltipAnchorRef = useRef<HTMLElement | null>(null);
    const lastHoverTooltipPreviewVisibleRef = useRef<boolean | null>(null);

    const hoverTooltipPreviewText =
        hoverTooltip && db && hoverTooltip.tooltipData.previewEnabled && hoverTooltip.tooltipData.previewPath
            ? db.getCachedPreviewText(hoverTooltip.tooltipData.previewPath)
            : '';
    const shouldShowHoverTooltipPreview = hoverTooltipPreviewText.trim().length > 0;
    const hoverTooltipDateText =
        hoverTooltip && hoverTooltip.tooltipData.showDate
            ? DateUtils.formatDate(hoverTooltip.tooltipData.dateTimestamp, settings.dateFormat)
            : '';

    const clearFeatureImageUrls = useCallback((resetState: boolean) => {
        const existing = featureImageUrlMapRef.current;
        if (existing.size === 0) {
            if (resetState) {
                setFeatureImageUrls(previous => (Object.keys(previous).length === 0 ? previous : {}));
            }
            return;
        }

        for (const entry of existing.values()) {
            URL.revokeObjectURL(entry.url);
        }
        existing.clear();

        if (resetState) {
            setFeatureImageUrls(previous => (Object.keys(previous).length === 0 ? previous : {}));
        }
    }, []);

    useEffect(() => {
        return () => {
            // Always release object URLs on unmount to avoid leaking blobs.
            clearFeatureImageUrls(false);
        };
    }, [clearFeatureImageUrls]);

    useEffect(() => {
        let isActive = true;

        if (!db || !settings.calendarShowFeatureImage) {
            clearFeatureImageUrls(true);
            return () => {
                isActive = false;
            };
        }

        // Only days with a daily note AND a computed feature-image key participate in background image loading.
        const noteDays: { iso: string; file: TFile; key: string }[] = [];

        for (const week of weeks) {
            for (const day of week.days) {
                if (!day.file) {
                    continue;
                }

                const featureKey = featureImageKeysByIso.get(day.iso);
                if (!featureKey) {
                    continue;
                }

                noteDays.push({ iso: day.iso, file: day.file, key: featureKey });
            }
        }

        const previousMap = featureImageUrlMapRef.current;
        const nextMap = new Map<string, { key: string; url: string }>();

        const createdUrls: string[] = [];

        const fetchUrls = async () => {
            try {
                await Promise.all(
                    noteDays.map(async entry => {
                        // Reuse existing object URLs when the feature image key is unchanged for that day.
                        const existing = previousMap.get(entry.iso);
                        if (existing && existing.key === entry.key) {
                            nextMap.set(entry.iso, existing);
                            return;
                        }

                        let blob: Blob | null = null;
                        try {
                            blob = await db.getFeatureImageBlob(entry.file.path, entry.key);
                        } catch {
                            return;
                        }

                        if (!blob) {
                            return;
                        }

                        const url = URL.createObjectURL(blob);
                        createdUrls.push(url);
                        nextMap.set(entry.iso, { key: entry.key, url });
                    })
                );

                if (!isActive) {
                    // Component was unmounted while blobs were loading; release newly created URLs.
                    createdUrls.forEach(url => URL.revokeObjectURL(url));
                    return;
                }

                // Release URLs that are no longer referenced by the next map.
                for (const [iso, entry] of previousMap.entries()) {
                    const next = nextMap.get(iso);
                    if (!next || next.url !== entry.url) {
                        URL.revokeObjectURL(entry.url);
                    }
                }

                featureImageUrlMapRef.current = nextMap;
                setFeatureImageUrls(Object.fromEntries([...nextMap.entries()].map(([iso, entry]) => [iso, entry.url])));
            } catch (error) {
                createdUrls.forEach(url => URL.revokeObjectURL(url));
                if (isActive) {
                    console.error('Failed to load calendar feature images', error);
                }
            }
        };

        runAsyncAction(() => fetchUrls());

        return () => {
            isActive = false;
        };
    }, [clearFeatureImageUrls, db, featureImageKeysByIso, settings.calendarShowFeatureImage, weeks]);

    useEffect(() => {
        hoverTooltipStateRef.current = hoverTooltip;
    }, [hoverTooltip]);

    /** Calculates and updates tooltip position relative to anchor element, handling viewport boundaries */
    const updateHoverTooltipPosition = useCallback(() => {
        if (!hoverTooltip) {
            setHoverTooltipStyle(null);
            return;
        }

        if (typeof window === 'undefined') {
            setHoverTooltipStyle(null);
            return;
        }

        if (!hoverTooltip.anchorEl.isConnected) {
            setHoverTooltip(null);
            setHoverTooltipStyle(null);
            return;
        }

        const tooltipElement = hoverTooltipRef.current;
        if (!tooltipElement) {
            setHoverTooltipStyle({
                top: 0,
                left: 0,
                transform: 'translateY(-50%)',
                visibility: 'hidden'
            });
            return;
        }
        const tooltipWidth = tooltipElement?.offsetWidth ?? 0;
        const tooltipHeight = tooltipElement?.offsetHeight ?? 0;

        const rect = hoverTooltip.anchorEl.getBoundingClientRect();
        const preferredPlacement = getTooltipPlacement();
        const offset = 10;
        const margin = 8;

        const rawCenterY = rect.top + rect.height / 2;
        const halfHeight = tooltipHeight / 2;
        const minCenterY = margin + halfHeight;
        const maxCenterY = window.innerHeight - margin - halfHeight;
        const centerY =
            Number.isFinite(minCenterY) && Number.isFinite(maxCenterY) && maxCenterY >= minCenterY
                ? clamp(rawCenterY, minCenterY, maxCenterY)
                : clamp(rawCenterY, margin, window.innerHeight - margin);

        const availableRight = window.innerWidth - rect.right - margin;
        const availableLeft = rect.left - margin;
        const requiredWidth = tooltipWidth + offset;

        const fitsRight = availableRight >= requiredWidth;
        const fitsLeft = availableLeft >= requiredWidth;

        let placement: 'left' | 'right' = preferredPlacement;
        if (preferredPlacement === 'right' && !fitsRight && fitsLeft) {
            placement = 'left';
        } else if (preferredPlacement === 'left' && !fitsLeft && fitsRight) {
            placement = 'right';
        } else if (!fitsLeft && !fitsRight) {
            placement = availableRight >= availableLeft ? 'right' : 'left';
        }

        const minLeft = margin;
        const maxLeft = window.innerWidth - margin - tooltipWidth;
        let left: number = placement === 'right' ? rect.right + offset : rect.left - offset - tooltipWidth;
        if (Number.isFinite(minLeft) && Number.isFinite(maxLeft) && maxLeft >= minLeft) {
            left = clamp(left, minLeft, maxLeft);
        }

        setHoverTooltipStyle({
            top: centerY,
            left,
            transform: 'translateY(-50%)',
            visibility: 'visible'
        });
    }, [hoverTooltip]);

    useLayoutEffect(() => {
        updateHoverTooltipPosition();
    }, [updateHoverTooltipPosition]);

    useLayoutEffect(() => {
        if (!hoverTooltip || isMobile) {
            lastHoverTooltipPreviewVisibleRef.current = null;
            return;
        }

        const previous = lastHoverTooltipPreviewVisibleRef.current;
        lastHoverTooltipPreviewVisibleRef.current = shouldShowHoverTooltipPreview;

        if (previous === null || previous === shouldShowHoverTooltipPreview) {
            return;
        }

        updateHoverTooltipPosition();
    }, [hoverTooltip, isMobile, shouldShowHoverTooltipPreview, updateHoverTooltipPosition]);

    useEffect(() => {
        if (!hoverTooltip) {
            return;
        }

        if (typeof window === 'undefined') {
            return;
        }

        let frameId: number | null = null;

        const schedulePositionUpdate = () => {
            if (frameId !== null) {
                return;
            }

            frameId = window.requestAnimationFrame(() => {
                frameId = null;
                updateHoverTooltipPosition();
            });
        };

        window.addEventListener('resize', schedulePositionUpdate);
        window.addEventListener('scroll', schedulePositionUpdate, true);
        return () => {
            if (frameId !== null) {
                window.cancelAnimationFrame(frameId);
            }
            window.removeEventListener('resize', schedulePositionUpdate);
            window.removeEventListener('scroll', schedulePositionUpdate, true);
        };
    }, [hoverTooltip, updateHoverTooltipPosition]);

    const handleShowTooltip = useCallback(
        (element: HTMLElement, tooltipData: CalendarHoverTooltipData) => {
            if (hoverTooltipAnchorRef.current !== element) {
                hoverTooltipAnchorRef.current = element;
                setHoverTooltipStyle(null);
            }

            const existing = hoverTooltipStateRef.current;
            const current = existing && existing.anchorEl === element ? existing.tooltipData : null;
            const isUnchanged =
                current !== null &&
                current.imageUrl === tooltipData.imageUrl &&
                current.title === tooltipData.title &&
                current.dateTimestamp === tooltipData.dateTimestamp &&
                current.previewPath === tooltipData.previewPath &&
                current.previewEnabled === tooltipData.previewEnabled &&
                current.showDate === tooltipData.showDate;

            const previewPath = tooltipData.previewPath;
            if (!isUnchanged && tooltipData.previewEnabled && previewPath && db) {
                runAsyncAction(() => db.ensurePreviewTextLoaded(previewPath));
            }

            setHoverTooltip(existing => {
                if (existing && existing.anchorEl === element) {
                    const current = existing.tooltipData;
                    if (
                        current.imageUrl === tooltipData.imageUrl &&
                        current.title === tooltipData.title &&
                        current.dateTimestamp === tooltipData.dateTimestamp &&
                        current.previewPath === tooltipData.previewPath &&
                        current.previewEnabled === tooltipData.previewEnabled &&
                        current.showDate === tooltipData.showDate
                    ) {
                        return existing;
                    }
                }

                return { anchorEl: element, tooltipData };
            });
        },
        [db]
    );

    const handleHideTooltip = useCallback((element: HTMLElement) => {
        if (hoverTooltipAnchorRef.current === element) {
            hoverTooltipAnchorRef.current = null;
            setHoverTooltipStyle(null);
        }

        setHoverTooltip(existing => {
            if (!existing || existing.anchorEl !== element) {
                return existing;
            }
            return null;
        });
    }, []);

    const handleNavigate = useCallback(
        (delta: number) => {
            if (!momentApi) {
                return;
            }
            setHoverTooltip(null);
            const weeksToShow = clamp(weeksToShowSetting, 1, 6);
            const unit = weeksToShow === 6 ? 'month' : 'week';
            const step = weeksToShow === 6 ? delta : delta * weeksToShow;

            setCursorDate(prev => (prev ?? momentApi().startOf('day')).clone().add(step, unit));
        },
        [momentApi, weeksToShowSetting]
    );

    const handleToday = useCallback(() => {
        if (!momentApi) {
            return;
        }
        setHoverTooltip(null);
        setCursorDate(momentApi().startOf('day'));
    }, [momentApi]);

    const collapseNavigationIfMobile = useCallback(() => {
        if (!isMobile || !app.workspace.leftSplit) {
            return;
        }
        // On mobile, opening a daily note should feel like navigating away from the sidebar.
        app.workspace.leftSplit.collapse();
    }, [app, isMobile]);

    const getCustomCalendarNoteConfig = useCallback(
        (kind: CustomCalendarNoteKind): CustomCalendarNoteConfig => getCalendarNoteConfig(kind, settings),
        [settings]
    );

    const customCalendarLookupCacheRef = useRef<Map<string, CustomCalendarIndexEntry | null>>(new Map());

    const getExistingCustomCalendarNoteEntry = useCallback(
        (kind: CustomCalendarNoteKind, date: MomentInstance): CustomCalendarIndexEntry | null => {
            const config = getCustomCalendarNoteConfig(kind);
            const momentPattern = buildCustomCalendarMomentPattern(config.calendarCustomFilePattern, config.fallbackPattern);
            if (!config.isPatternValid(momentPattern, momentApi)) {
                return null;
            }

            const { folderPath, formattedFilePattern } = buildCustomCalendarFilePathForPattern(
                date,
                { calendarCustomRootFolder: settings.calendarCustomRootFolder },
                config.calendarCustomFilePattern,
                '',
                config.fallbackPattern
            );

            if (!formattedFilePattern || !folderPath) {
                return null;
            }

            const cacheKey = `${vaultVersion}\u0000${customCalendarLookupCacheScopeKey}\u0000${kind}\u0000${folderPath}\u0000${formattedFilePattern}`;
            const cache = customCalendarLookupCacheRef.current;
            if (cache.has(cacheKey)) {
                const cached = cache.get(cacheKey) ?? null;
                if (!cached || app.vault.getAbstractFileByPath(cached.file.path) instanceof TFile) {
                    return cached;
                }
                cache.delete(cacheKey);
            }

            const resolved = resolveExistingCustomCalendarNote({
                app,
                date,
                settings: { calendarCustomRootFolder: settings.calendarCustomRootFolder },
                calendarCustomFilePattern: config.calendarCustomFilePattern,
                fallbackPattern: config.fallbackPattern,
                allowTitleSuffixMatch: true
            });

            if (cache.size >= MAX_CUSTOM_CALENDAR_LOOKUP_CACHE_ENTRIES) {
                const oldest = cache.keys().next();
                if (!oldest.done) {
                    cache.delete(oldest.value);
                }
            }
            cache.set(cacheKey, resolved);

            return resolved;
        },
        [app, customCalendarLookupCacheScopeKey, getCustomCalendarNoteConfig, momentApi, settings.calendarCustomRootFolder, vaultVersion]
    );

    const openOrCreateCustomCalendarNote = useCallback(
        (kind: CustomCalendarNoteKind, date: MomentInstance, existingFile: TFile | null) => {
            if (existingFile) {
                openFile(existingFile, { active: true });
                collapseNavigationIfMobile();
                return;
            }

            const config = getCustomCalendarNoteConfig(kind);
            const momentPattern = buildCustomCalendarMomentPattern(config.calendarCustomFilePattern, config.fallbackPattern);
            if (!config.isPatternValid(momentPattern, momentApi)) {
                new Notice(config.parsingErrorText);
                return;
            }

            setHoverTooltip(null);

            const createCustomNote = async (noteTitle: string) => {
                const { folderPath, fileName, filePath } = buildCustomCalendarFilePathForPattern(
                    date,
                    settings,
                    config.calendarCustomFilePattern,
                    noteTitle,
                    config.fallbackPattern
                );
                if (!filePath) {
                    new Notice(strings.common.unknownError);
                    return;
                }

                const existing = app.vault.getAbstractFileByPath(filePath);
                if (existing instanceof TFile) {
                    openFile(existing, { active: true });
                    collapseNavigationIfMobile();
                    return;
                }

                let parentFolder: TFolder | null = null;
                try {
                    parentFolder = await ensureCalendarFolderExists(app, folderPath);
                } catch (error) {
                    console.error('Failed to create calendar folder', error);
                    new Notice(strings.common.unknownError);
                    return;
                }
                if (!parentFolder) {
                    new Notice(strings.common.unknownError);
                    return;
                }

                const baseName = fileName.replace(/\.md$/iu, '').trim();
                if (!baseName) {
                    new Notice(strings.common.unknownError);
                    return;
                }

                let created: TFile;
                try {
                    created = await app.fileManager.createNewMarkdownFile(parentFolder, baseName);
                } catch (error) {
                    console.error('Failed to create calendar note', error);
                    new Notice(strings.common.unknownError);
                    return;
                }

                setVaultVersion(v => v + 1);
                openFile(created, { active: true });
                collapseNavigationIfMobile();
            };

            const promptAndCreate = () => {
                const modal = new InputModal(
                    app,
                    strings.settings.items.calendarCustomFilePattern.titlePlaceholder,
                    strings.navigationCalendar.promptDailyNoteTitle.placeholder,
                    value => {
                        const noteTitle = sanitizeCalendarTitle(value);
                        runAsyncAction(() => createCustomNote(noteTitle));
                    },
                    '',
                    { submitButtonText: strings.navigationCalendar.createDailyNote.confirmButton }
                );
                modal.open();
            };

            const createWithoutPrompt = () => {
                const { filePath } = buildCustomCalendarFilePathForPattern(
                    date,
                    settings,
                    config.calendarCustomFilePattern,
                    '',
                    config.fallbackPattern
                );
                const createFile = () => runAsyncAction(() => createCustomNote(''));

                if (settings.calendarConfirmBeforeCreate) {
                    new ConfirmModal(
                        app,
                        strings.paneHeader.newNote,
                        strings.navigationCalendar.createDailyNote.message.replace('{filename}', filePath),
                        createFile,
                        strings.navigationCalendar.createDailyNote.confirmButton,
                        { confirmButtonClass: 'mod-cta' }
                    ).open();
                    return;
                }

                createFile();
            };

            if (settings.calendarCustomPromptForTitle) {
                // Title prompt acts as the confirmation step; do not show a separate confirm dialog.
                promptAndCreate();
                return;
            }

            createWithoutPrompt();
        },
        [app, collapseNavigationIfMobile, getCustomCalendarNoteConfig, momentApi, openFile, settings, setHoverTooltip]
    );

    const openOrCreateDailyNote = useCallback(
        (date: MomentInstance, existingFile: TFile | null) => {
            if (existingFile) {
                openFile(existingFile, { active: true });
                collapseNavigationIfMobile();
                return;
            }

            if (settings.calendarIntegrationMode === 'daily-notes') {
                const dailySettings = dailyNoteSettings;
                if (!dailySettings) {
                    new Notice(strings.navigationCalendar.dailyNotesNotEnabled);
                    return;
                }

                const filename = getDailyNoteFilename(date, dailySettings);

                const createFile = async () => {
                    const created = await createDailyNote(app, date, dailySettings);
                    if (!created) {
                        return;
                    }

                    setVaultVersion(v => v + 1);
                    openFile(created, { active: true });

                    collapseNavigationIfMobile();
                };

                if (settings.calendarConfirmBeforeCreate) {
                    new ConfirmModal(
                        app,
                        strings.navigationCalendar.createDailyNote.title,
                        strings.navigationCalendar.createDailyNote.message.replace('{filename}', filename),
                        () => {
                            runAsyncAction(createFile);
                        },
                        strings.navigationCalendar.createDailyNote.confirmButton,
                        { confirmButtonClass: 'mod-cta' }
                    ).open();
                    return;
                }

                runAsyncAction(() => createFile());
                return;
            }

            openOrCreateCustomCalendarNote('day', date, null);
        },
        [app, collapseNavigationIfMobile, dailyNoteSettings, openFile, openOrCreateCustomCalendarNote, settings]
    );

    const showCalendarNoteContextMenu = useCallback(
        (
            event: React.MouseEvent<HTMLElement>,
            target: {
                kind: CustomCalendarNoteKind;
                date: MomentInstance;
                existingFile: TFile | null;
                canCreate: boolean;
            }
        ) => {
            event.preventDefault();
            event.stopPropagation();

            setHoverTooltip(null);

            const menu = new Menu();

            const existingFile = target.existingFile;
            if (existingFile) {
                menu.addItem(item => {
                    item.setTitle(strings.contextMenu.file.deleteNote)
                        .setIcon('lucide-trash')
                        .onClick(() => {
                            runAsyncAction(() =>
                                fileSystemOps.deleteFile(existingFile, settings.confirmBeforeDelete, () => {
                                    setVaultVersion(v => v + 1);
                                    collapseNavigationIfMobile();
                                })
                            );
                        });
                });
            } else {
                menu.addItem(item => {
                    item.setTitle(strings.contextMenu.folder.newNote)
                        .setIcon(resolveUXIconForMenu(settings.interfaceIcons, 'list-new-note', 'lucide-pen-box'))
                        .setDisabled(!target.canCreate)
                        .onClick(() => {
                            if (!target.canCreate) {
                                return;
                            }

                            if (target.kind === 'day') {
                                runAsyncAction(() => openOrCreateDailyNote(target.date, null));
                                return;
                            }

                            runAsyncAction(() => openOrCreateCustomCalendarNote(target.kind, target.date, null));
                        });
                });
            }

            menu.showAtMouseEvent(event.nativeEvent);
        },
        [
            fileSystemOps,
            collapseNavigationIfMobile,
            openOrCreateCustomCalendarNote,
            openOrCreateDailyNote,
            setHoverTooltip,
            setVaultVersion,
            settings.confirmBeforeDelete,
            settings.interfaceIcons
        ]
    );

    const showWeekNumbers = settings.calendarShowWeekNumber;
    const highlightToday = settings.calendarHighlightToday;

    const isCustomCalendar = settings.calendarIntegrationMode === 'notebook-navigator';
    const weekNotesEnabled = isCustomCalendar && settings.calendarCustomWeekEnabled;
    const monthNotesEnabled = isCustomCalendar && settings.calendarCustomMonthEnabled;
    const quarterNotesEnabled = isCustomCalendar && settings.calendarCustomQuarterEnabled;
    const yearNotesEnabled = isCustomCalendar && settings.calendarCustomYearEnabled;

    const headerPeriodNoteEntries = useMemo(() => {
        void vaultVersion;
        if (!momentApi || !cursorDate) {
            return { month: null, quarter: null, year: null };
        }

        const date = cursorDate.clone().locale(displayLocale);

        const month = monthNotesEnabled ? getExistingCustomCalendarNoteEntry('month', date) : null;
        const year = yearNotesEnabled ? getExistingCustomCalendarNoteEntry('year', date) : null;
        const quarter = settings.calendarShowQuarter && quarterNotesEnabled ? getExistingCustomCalendarNoteEntry('quarter', date) : null;

        return { month, quarter, year };
    }, [
        cursorDate,
        displayLocale,
        getExistingCustomCalendarNoteEntry,
        momentApi,
        monthNotesEnabled,
        quarterNotesEnabled,
        settings.calendarShowQuarter,
        vaultVersion,
        yearNotesEnabled
    ]);

    const weekNoteEntriesByKey = useMemo(() => {
        void vaultVersion;
        if (!momentApi || !cursorDate) {
            return new Map<string, CustomCalendarIndexEntry | null>();
        }

        if (!showWeekNumbers || !weekNotesEnabled) {
            return new Map<string, CustomCalendarIndexEntry | null>();
        }

        const entries = new Map<string, CustomCalendarIndexEntry | null>();
        for (const week of weeks) {
            const weekStart = week.days[0]?.date;
            if (!weekStart) {
                continue;
            }

            const weekDate = weekStart.clone().locale(calendarRulesLocale);
            const entry = getExistingCustomCalendarNoteEntry('week', weekDate);

            entries.set(week.key, entry);
        }

        return entries;
    }, [
        calendarRulesLocale,
        cursorDate,
        getExistingCustomCalendarNoteEntry,
        momentApi,
        showWeekNumbers,
        vaultVersion,
        weekNotesEnabled,
        weeks
    ]);

    if (!momentApi || !cursorDate) {
        return null;
    }

    const monthYearHeaderDate = cursorDate.clone().locale(displayLocale);
    const monthLabel = monthYearHeaderDate.format('MMMM');
    const yearLabel = monthYearHeaderDate.format('YYYY');
    const quarterLabel = monthYearHeaderDate.format('[Q]Q');

    return (
        <>
            {hoverTooltip && !isMobile
                ? createPortal(
                      <div
                          ref={hoverTooltipRef}
                          className="nn-navigation-calendar-hover-tooltip"
                          style={
                              hoverTooltipStyle ?? {
                                  top: 0,
                                  left: 0,
                                  transform: 'translateY(-50%)',
                                  visibility: 'hidden'
                              }
                          }
                          role="tooltip"
                      >
                          {hoverTooltip.tooltipData.imageUrl ? (
                              <div
                                  className="nn-navigation-calendar-hover-tooltip-image"
                                  style={{ backgroundImage: `url(${hoverTooltip.tooltipData.imageUrl})` }}
                              />
                          ) : null}
                          <div className="nn-compact-file-text-content">
                              <div
                                  className="nn-file-name"
                                  style={{ '--filename-rows': 2, height: 'auto', minHeight: 0 } as React.CSSProperties}
                              >
                                  {hoverTooltip.tooltipData.title}
                              </div>
                              {shouldShowHoverTooltipPreview ? (
                                  <div className="nn-file-preview" style={{ '--preview-rows': 2 } as React.CSSProperties}>
                                      {hoverTooltipPreviewText}
                                  </div>
                              ) : null}
                              {hoverTooltipDateText ? <div className="nn-file-date">{hoverTooltipDateText}</div> : null}
                          </div>
                      </div>,
                      document.body
                  )
                : null}
            <div
                className="nn-navigation-calendar"
                role="group"
                aria-labelledby={calendarLabelId}
                data-highlight-today={highlightToday ? 'true' : undefined}
                data-layout={layout}
                data-weeknumbers={showWeekNumbers ? 'true' : undefined}
            >
                <span id={calendarLabelId} className="nn-visually-hidden">
                    {strings.navigationCalendar.ariaLabel}
                </span>
                <div className="nn-navigation-calendar-header">
                    <div className="nn-navigation-calendar-month">
                        {monthNotesEnabled ? (
                            <button
                                type="button"
                                className={['nn-navigation-calendar-period-button', headerPeriodNoteEntries.month ? 'has-period-note' : '']
                                    .filter(Boolean)
                                    .join(' ')}
                                onClick={() =>
                                    openOrCreateCustomCalendarNote(
                                        'month',
                                        cursorDate.clone().locale(displayLocale),
                                        headerPeriodNoteEntries.month?.file ?? null
                                    )
                                }
                                onContextMenu={event =>
                                    showCalendarNoteContextMenu(event, {
                                        kind: 'month',
                                        date: cursorDate.clone().locale(displayLocale),
                                        existingFile: headerPeriodNoteEntries.month?.file ?? null,
                                        canCreate: monthNotesEnabled
                                    })
                                }
                            >
                                {monthLabel}
                            </button>
                        ) : (
                            <span
                                className="nn-navigation-calendar-period-label"
                                onContextMenu={event =>
                                    showCalendarNoteContextMenu(event, {
                                        kind: 'month',
                                        date: cursorDate.clone().locale(displayLocale),
                                        existingFile: headerPeriodNoteEntries.month?.file ?? null,
                                        canCreate: monthNotesEnabled
                                    })
                                }
                            >
                                {monthLabel}
                            </span>
                        )}

                        {yearNotesEnabled ? (
                            <button
                                type="button"
                                className={['nn-navigation-calendar-period-button', headerPeriodNoteEntries.year ? 'has-period-note' : '']
                                    .filter(Boolean)
                                    .join(' ')}
                                onClick={() =>
                                    openOrCreateCustomCalendarNote(
                                        'year',
                                        cursorDate.clone().locale(displayLocale),
                                        headerPeriodNoteEntries.year?.file ?? null
                                    )
                                }
                                onContextMenu={event =>
                                    showCalendarNoteContextMenu(event, {
                                        kind: 'year',
                                        date: cursorDate.clone().locale(displayLocale),
                                        existingFile: headerPeriodNoteEntries.year?.file ?? null,
                                        canCreate: yearNotesEnabled
                                    })
                                }
                            >
                                {yearLabel}
                            </button>
                        ) : (
                            <span
                                className="nn-navigation-calendar-period-label"
                                onContextMenu={event =>
                                    showCalendarNoteContextMenu(event, {
                                        kind: 'year',
                                        date: cursorDate.clone().locale(displayLocale),
                                        existingFile: headerPeriodNoteEntries.year?.file ?? null,
                                        canCreate: yearNotesEnabled
                                    })
                                }
                            >
                                {yearLabel}
                            </span>
                        )}

                        {settings.calendarShowQuarter ? (
                            quarterNotesEnabled ? (
                                <button
                                    type="button"
                                    className={[
                                        'nn-navigation-calendar-period-button',
                                        'nn-navigation-calendar-quarter-button',
                                        headerPeriodNoteEntries.quarter ? 'has-period-note' : ''
                                    ]
                                        .filter(Boolean)
                                        .join(' ')}
                                    onClick={() =>
                                        openOrCreateCustomCalendarNote(
                                            'quarter',
                                            cursorDate.clone().locale(displayLocale),
                                            headerPeriodNoteEntries.quarter?.file ?? null
                                        )
                                    }
                                    onContextMenu={event =>
                                        showCalendarNoteContextMenu(event, {
                                            kind: 'quarter',
                                            date: cursorDate.clone().locale(displayLocale),
                                            existingFile: headerPeriodNoteEntries.quarter?.file ?? null,
                                            canCreate: settings.calendarShowQuarter && quarterNotesEnabled
                                        })
                                    }
                                >
                                    <span aria-hidden="true">(</span>
                                    {quarterLabel}
                                    <span aria-hidden="true">)</span>
                                </button>
                            ) : (
                                <span
                                    className="nn-navigation-calendar-period-label nn-navigation-calendar-quarter-label"
                                    onContextMenu={event =>
                                        showCalendarNoteContextMenu(event, {
                                            kind: 'quarter',
                                            date: cursorDate.clone().locale(displayLocale),
                                            existingFile: headerPeriodNoteEntries.quarter?.file ?? null,
                                            canCreate: settings.calendarShowQuarter && quarterNotesEnabled
                                        })
                                    }
                                >
                                    <span aria-hidden="true">(</span>
                                    {quarterLabel}
                                    <span aria-hidden="true">)</span>
                                </span>
                            )
                        ) : null}
                    </div>
                    <div className="nn-navigation-calendar-nav">
                        <button
                            type="button"
                            className="nn-navigation-calendar-nav-button"
                            aria-label={strings.common.previous}
                            onClick={() => handleNavigate(-1)}
                        >
                            <ServiceIcon iconId="lucide-chevron-left" aria-hidden={true} />
                        </button>
                        <button
                            type="button"
                            className="nn-navigation-calendar-today"
                            aria-label={strings.dateGroups.today}
                            onClick={handleToday}
                        >
                            {strings.dateGroups.today}
                        </button>
                        <button
                            type="button"
                            className="nn-navigation-calendar-nav-button"
                            aria-label={strings.common.next}
                            onClick={() => handleNavigate(1)}
                        >
                            <ServiceIcon iconId="lucide-chevron-right" aria-hidden={true} />
                        </button>
                    </div>
                </div>

                <div className="nn-navigation-calendar-grid" data-weeknumbers={showWeekNumbers ? 'true' : undefined}>
                    <div className="nn-navigation-calendar-weekdays" data-weeknumbers={showWeekNumbers ? 'true' : undefined}>
                        {showWeekNumbers ? <div className="nn-navigation-calendar-weeknumber-spacer" /> : null}
                        {showWeekNumbers ? <div className="nn-navigation-calendar-weeknumber-divider" aria-hidden="true" /> : null}
                        {weekdays.map((day, index) => (
                            <div key={(weekStartsOn + index) % 7} className="nn-navigation-calendar-weekday">
                                {day}
                            </div>
                        ))}
                    </div>

                    <div className="nn-navigation-calendar-weeks" data-weeknumbers={showWeekNumbers ? 'true' : undefined}>
                        {weeks.map(week => (
                            <div key={week.key} className="nn-navigation-calendar-week">
                                {showWeekNumbers ? (
                                    <>
                                        {weekNotesEnabled ? (
                                            <button
                                                type="button"
                                                className={[
                                                    'nn-navigation-calendar-weeknumber',
                                                    'nn-navigation-calendar-weeknumber-button',
                                                    weekNoteEntriesByKey.get(week.key) ? 'has-period-note' : ''
                                                ]
                                                    .filter(Boolean)
                                                    .join(' ')}
                                                onClick={() => {
                                                    const weekStart = week.days[0]?.date;
                                                    if (!weekStart) {
                                                        return;
                                                    }

                                                    openOrCreateCustomCalendarNote(
                                                        'week',
                                                        weekStart.clone().locale(calendarRulesLocale),
                                                        weekNoteEntriesByKey.get(week.key)?.file ?? null
                                                    );
                                                }}
                                                onContextMenu={event => {
                                                    const weekStart = week.days[0]?.date;
                                                    if (!weekStart) {
                                                        return;
                                                    }

                                                    showCalendarNoteContextMenu(event, {
                                                        kind: 'week',
                                                        date: weekStart.clone().locale(calendarRulesLocale),
                                                        existingFile: weekNoteEntriesByKey.get(week.key)?.file ?? null,
                                                        canCreate: weekNotesEnabled
                                                    });
                                                }}
                                            >
                                                {week.weekNumber}
                                            </button>
                                        ) : (
                                            <div
                                                className="nn-navigation-calendar-weeknumber"
                                                aria-hidden="true"
                                                onContextMenu={event => {
                                                    const weekStart = week.days[0]?.date;
                                                    if (!weekStart) {
                                                        return;
                                                    }

                                                    showCalendarNoteContextMenu(event, {
                                                        kind: 'week',
                                                        date: weekStart.clone().locale(calendarRulesLocale),
                                                        existingFile: null,
                                                        canCreate: weekNotesEnabled
                                                    });
                                                }}
                                            >
                                                {week.weekNumber}
                                            </div>
                                        )}
                                        <div className="nn-navigation-calendar-weeknumber-divider" aria-hidden="true" />
                                    </>
                                ) : null}
                                {week.days.map(day => {
                                    const dayNumber = day.date.date();
                                    const hasDailyNote = Boolean(day.file);
                                    const featureImageUrl = featureImageUrls[day.iso] ?? null;
                                    const hasFeatureImageKey = featureImageKeysByIso.has(day.iso);
                                    const isToday = todayIso === day.iso;
                                    const dayOfWeek = day.date.toDate().getDay();
                                    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

                                    const className = [
                                        'nn-navigation-calendar-day',
                                        day.inMonth ? 'is-in-month' : 'is-outside-month',
                                        isToday ? 'is-today' : '',
                                        isWeekend ? 'is-weekend' : 'is-weekday',
                                        hasDailyNote ? 'has-daily-note' : '',
                                        hasFeatureImageKey ? 'has-feature-image-key' : '',
                                        featureImageUrl ? 'has-feature-image' : ''
                                    ]
                                        .filter(Boolean)
                                        .join(' ');

                                    const style: React.CSSProperties | undefined = featureImageUrl
                                        ? { backgroundImage: `url(${featureImageUrl})` }
                                        : undefined;

                                    const ariaLabel = day.date.clone().locale(displayLocale).format('LL');
                                    const dateTimestamp = day.date.toDate().getTime();
                                    const basenameTitle = day.file ? parseCalendarBasenameTitle(day.file.basename) : null;
                                    const tooltipTitleCandidate = day.title || basenameTitle?.title || '';
                                    const tooltipTitle =
                                        tooltipTitleCandidate.length > 0
                                            ? tooltipTitleCandidate
                                            : DateUtils.formatDate(dateTimestamp, settings.dateFormat);
                                    const showDate = Boolean(day.title || basenameTitle?.showDate);
                                    const tooltipAriaText = tooltipTitleCandidate ? `${ariaLabel}, ${tooltipTitleCandidate}` : ariaLabel;
                                    const tooltipEnabled = Boolean(day.file || featureImageUrl);
                                    const tooltipData: CalendarHoverTooltipData = {
                                        imageUrl: featureImageUrl,
                                        title: tooltipTitle || ariaLabel,
                                        dateTimestamp,
                                        previewPath: day.file?.path ?? null,
                                        previewEnabled: Boolean(day.file && day.file.extension === 'md'),
                                        showDate
                                    };

                                    return (
                                        <CalendarDayButton
                                            key={day.iso}
                                            className={className}
                                            ariaText={tooltipAriaText}
                                            style={style}
                                            tooltipEnabled={tooltipEnabled}
                                            tooltipData={tooltipData}
                                            dayNumber={dayNumber}
                                            isMobile={isMobile}
                                            onShowTooltip={handleShowTooltip}
                                            onHideTooltip={handleHideTooltip}
                                            onClick={() => openOrCreateDailyNote(day.date, day.file)}
                                            onContextMenu={event =>
                                                showCalendarNoteContextMenu(event, {
                                                    kind: 'day',
                                                    date: day.date,
                                                    existingFile: day.file,
                                                    canCreate:
                                                        settings.calendarIntegrationMode !== 'daily-notes' || Boolean(dailyNoteSettings)
                                                })
                                            }
                                        />
                                    );
                                })}
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </>
    );
}
