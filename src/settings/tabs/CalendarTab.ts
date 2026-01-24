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

import { DropdownComponent, Setting } from 'obsidian';
import { getCurrentLanguage, strings } from '../../i18n';
import { isCalendarPlacement, type CalendarWeeksToShow } from '../types';
import type { SettingsTabContext } from './SettingsTabContext';
import {
    createCalendarCustomDateFormatter,
    DEFAULT_CALENDAR_CUSTOM_FILE_PATTERN,
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
    normalizeCalendarCustomFilePattern,
    normalizeCalendarCustomRootFolder,
    normalizeCalendarVaultFolderPath,
    splitCalendarCustomPattern
} from '../../utils/calendarCustomNotePatterns';
import { createSettingGroupFactory } from '../settingGroups';
import { addSettingSyncModeToggle } from '../syncModeToggle';
import { createSubSettingsContainer, setElementVisible } from '../subSettings';
import { getMomentApi } from '../../utils/moment';

const CALENDAR_LOCALE_SYSTEM_DEFAULT = 'system-default';

function parseCalendarWeeksToShow(value: string): CalendarWeeksToShow | null {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed < 1 || parsed > 6) {
        return null;
    }
    return parsed as CalendarWeeksToShow;
}

function formatCalendarWeeksOption(count: number): string {
    return strings.settings.items.calendarWeeksToShow.options.weeksCount.replace('{count}', count.toString());
}

/** Renders the calendar settings tab */
export function renderCalendarTab(context: SettingsTabContext): void {
    const { containerEl, plugin, createDebouncedTextSetting } = context;
    const createGroup = createSettingGroupFactory(containerEl);

    const topGroup = createGroup(undefined);

    const calendarPlacementSetting = topGroup.addSetting(setting => {
        setting.setName(strings.settings.items.calendarPlacement.name).setDesc(strings.settings.items.calendarPlacement.desc);
    });

    calendarPlacementSetting.addDropdown((dropdown: DropdownComponent) => {
        dropdown
            .addOption('left-sidebar', strings.settings.items.calendarPlacement.options.leftSidebar)
            .addOption('right-sidebar', strings.settings.items.calendarPlacement.options.rightSidebar)
            .setValue(plugin.settings.calendarPlacement)
            .onChange(value => {
                if (!isCalendarPlacement(value)) {
                    return;
                }

                plugin.setCalendarPlacement(value);
            });
    });

    addSettingSyncModeToggle({ setting: calendarPlacementSetting, plugin, settingId: 'calendarPlacement' });

    const momentApi = getMomentApi();
    // Offer moment locales as options; the selected locale is used for week rules (start-of-week + week numbering).
    const localeOptions = momentApi ? [...momentApi.locales()].sort((a, b) => a.localeCompare(b)) : [];

    // This is only used to show a hint in the UI for "system default".
    const systemLocale = typeof navigator !== 'undefined' ? (navigator.language ?? '').toLowerCase() : '';
    const currentLocale = momentApi?.locale() || systemLocale;

    topGroup
        .addSetting(setting => {
            setting.setName(strings.settings.items.calendarLocale.name).setDesc(strings.settings.items.calendarLocale.desc);
        })
        .addDropdown((dropdown: DropdownComponent) => {
            dropdown.addOption(
                CALENDAR_LOCALE_SYSTEM_DEFAULT,
                `${strings.settings.items.calendarLocale.options.systemDefault} (${currentLocale || 'en'})`
            );
            for (const locale of localeOptions) {
                dropdown.addOption(locale, locale);
            }

            dropdown.setValue(plugin.settings.calendarLocale).onChange(async value => {
                plugin.settings.calendarLocale = value;
                await plugin.saveSettingsAndUpdate();
            });
        });

    topGroup
        .addSetting(setting => {
            setting
                .setName(strings.settings.items.calendarConfirmBeforeCreate.name)
                .setDesc(strings.settings.items.calendarConfirmBeforeCreate.desc);
        })
        .addToggle(toggle =>
            toggle.setValue(plugin.settings.calendarConfirmBeforeCreate).onChange(async value => {
                plugin.settings.calendarConfirmBeforeCreate = value;
                await plugin.saveSettingsAndUpdate();
            })
        );

    const appearanceGroup = createGroup(strings.settings.groups.navigation.appearance);

    const calendarWeeksToShowSetting = appearanceGroup.addSetting(setting => {
        setting.setName(strings.settings.items.calendarWeeksToShow.name).setDesc(strings.settings.items.calendarWeeksToShow.desc);
    });

    calendarWeeksToShowSetting.addDropdown((dropdown: DropdownComponent) => {
        dropdown.addOption('1', strings.settings.items.calendarWeeksToShow.options.oneWeek);
        for (let count = 2; count <= 5; count++) {
            dropdown.addOption(String(count), formatCalendarWeeksOption(count));
        }
        dropdown.addOption('6', strings.settings.items.calendarWeeksToShow.options.fullMonth);

        dropdown.setValue(String(plugin.settings.calendarWeeksToShow)).onChange(value => {
            const parsed = parseCalendarWeeksToShow(value);
            if (parsed === null) {
                return;
            }

            plugin.setCalendarWeeksToShow(parsed);
        });
    });

    addSettingSyncModeToggle({ setting: calendarWeeksToShowSetting, plugin, settingId: 'calendarWeeksToShow' });

    appearanceGroup
        .addSetting(setting => {
            setting.setName(strings.settings.items.calendarHighlightToday.name).setDesc(strings.settings.items.calendarHighlightToday.desc);
        })
        .addToggle(toggle =>
            toggle.setValue(plugin.settings.calendarHighlightToday).onChange(async value => {
                plugin.settings.calendarHighlightToday = value;
                await plugin.saveSettingsAndUpdate();
            })
        );

    appearanceGroup
        .addSetting(setting => {
            setting
                .setName(strings.settings.items.calendarShowFeatureImage.name)
                .setDesc(strings.settings.items.calendarShowFeatureImage.desc);
        })
        .addToggle(toggle =>
            toggle.setValue(plugin.settings.calendarShowFeatureImage).onChange(async value => {
                plugin.settings.calendarShowFeatureImage = value;
                await plugin.saveSettingsAndUpdate();
            })
        );

    appearanceGroup
        .addSetting(setting => {
            setting.setName(strings.settings.items.calendarShowWeekNumber.name).setDesc(strings.settings.items.calendarShowWeekNumber.desc);
        })
        .addToggle(toggle =>
            toggle.setValue(plugin.settings.calendarShowWeekNumber).onChange(async value => {
                plugin.settings.calendarShowWeekNumber = value;
                await plugin.saveSettingsAndUpdate();
            })
        );

    appearanceGroup
        .addSetting(setting => {
            setting.setName(strings.settings.items.calendarShowQuarter.name).setDesc(strings.settings.items.calendarShowQuarter.desc);
        })
        .addToggle(toggle =>
            toggle.setValue(plugin.settings.calendarShowQuarter).onChange(async value => {
                plugin.settings.calendarShowQuarter = value;
                await plugin.saveSettingsAndUpdate();
            })
        );

    const calendarIntegrationGroup = createGroup(strings.settings.groups.navigation.calendarIntegration);

    const calendarIntegrationSetting = calendarIntegrationGroup.addSetting(setting => {
        setting
            .setName(strings.settings.items.calendarIntegrationMode.name)
            .setDesc(strings.settings.items.calendarIntegrationMode.desc)
            .addDropdown(dropdown =>
                dropdown
                    .addOption('daily-notes', strings.settings.items.calendarIntegrationMode.options.dailyNotes)
                    .addOption('notebook-navigator', strings.settings.items.calendarIntegrationMode.options.notebookNavigator)
                    .setValue(plugin.settings.calendarIntegrationMode)
                    .onChange(async value => {
                        if (value !== 'daily-notes' && value !== 'notebook-navigator') {
                            return;
                        }
                        plugin.settings.calendarIntegrationMode = value;
                        await plugin.saveSettingsAndUpdate();
                        renderCalendarIntegrationVisibility();
                    })
            );
    });

    const dailyNotesInfoSettingsEl = createSubSettingsContainer(calendarIntegrationSetting);
    const customCalendarSettingsEl = createSubSettingsContainer(calendarIntegrationSetting, '');

    const dailyNotesInfoSetting = new Setting(dailyNotesInfoSettingsEl).setName('').setDesc('');
    dailyNotesInfoSetting.settingEl.addClass('nn-setting-info-container');
    dailyNotesInfoSetting.settingEl.addClass('nn-setting-info-centered');
    dailyNotesInfoSetting.descEl.empty();
    dailyNotesInfoSetting.descEl.createDiv({ text: strings.settings.items.calendarIntegrationMode.info.dailyNotes });

    const calendarCustomRootFolderSetting = createDebouncedTextSetting(
        customCalendarSettingsEl,
        strings.settings.items.calendarCustomRootFolder.name,
        strings.settings.items.calendarCustomRootFolder.desc,
        strings.settings.items.calendarCustomRootFolder.placeholder,
        () => normalizeCalendarCustomRootFolder(plugin.settings.calendarCustomRootFolder),
        value => {
            plugin.settings.calendarCustomRootFolder = normalizeCalendarCustomRootFolder(value);
        }
    );
    calendarCustomRootFolderSetting.controlEl.addClass('nn-setting-wide-input');

    const currentLanguage = String(getCurrentLanguage() ?? '').toLowerCase();
    const renderMomentPatternDescription = (container: HTMLElement): void => {
        if (currentLanguage === 'en' || currentLanguage.startsWith('en-')) {
            const descriptionEl = container.createDiv();
            descriptionEl.appendText(strings.settings.items.calendarCustomFilePattern.momentDescPrefix);
            const linkEl = descriptionEl.createEl('a', {
                text: strings.settings.items.calendarCustomFilePattern.momentLinkText,
                href: 'https://momentjs.com/docs/#/displaying/format/'
            });
            linkEl.setAttr('rel', 'noopener noreferrer');
            linkEl.setAttr('target', '_blank');
            descriptionEl.appendText(strings.settings.items.calendarCustomFilePattern.momentDescSuffix);
            return;
        }

        container.createDiv({ text: strings.settings.items.calendarCustomFilePattern.desc });
    };

    const createCalendarCustomPatternSetting = (params: {
        name: string;
        placeholder: string;
        getValue: () => string;
        setValue: (value: string) => void;
        onAfterUpdate?: () => void;
    }) => {
        const setting = createDebouncedTextSetting(
            customCalendarSettingsEl,
            params.name,
            '',
            params.placeholder,
            params.getValue,
            params.setValue,
            undefined,
            params.onAfterUpdate
        );
        setting.controlEl.addClass('nn-setting-wide-input');

        const descEl = setting.descEl;
        descEl.empty();
        renderMomentPatternDescription(descEl);

        const exampleEl = descEl.createDiv({ cls: 'nn-setting-calendar-pattern-example nn-setting-hidden' });
        const exampleTextEl = exampleEl.createSpan({ cls: 'nn-setting-calendar-pattern-example-text' });
        const inputEl = setting.controlEl.querySelector<HTMLInputElement>('input');

        return { setting, descEl, exampleEl, exampleTextEl, inputEl };
    };

    const calendarCustomFilePattern = createCalendarCustomPatternSetting({
        name: strings.settings.items.calendarCustomFilePattern.name,
        placeholder: strings.settings.items.calendarCustomFilePattern.placeholder,
        getValue: () => normalizeCalendarCustomFilePattern(plugin.settings.calendarCustomFilePattern),
        setValue: value => {
            plugin.settings.calendarCustomFilePattern = normalizeCalendarCustomFilePattern(value);
        },
        onAfterUpdate: () => renderCalendarIntegrationVisibility()
    });

    const calendarCustomFilePatternErrorEl = calendarCustomFilePattern.descEl.createDiv({
        cls: 'setting-item-description nn-setting-hidden nn-setting-warning'
    });

    const calendarCustomWeekPattern = createCalendarCustomPatternSetting({
        name: strings.settings.items.calendarCustomWeekPattern.name,
        placeholder: DEFAULT_CALENDAR_CUSTOM_WEEK_PATTERN,
        getValue: () => normalizeCalendarCustomFilePattern(plugin.settings.calendarCustomWeekPattern, ''),
        setValue: value => {
            plugin.settings.calendarCustomWeekPattern = normalizeCalendarCustomFilePattern(value, '');
        },
        onAfterUpdate: () => renderCalendarCustomPatternPreviews()
    });

    const calendarCustomWeekPatternErrorEl = calendarCustomWeekPattern.descEl.createDiv({
        cls: 'setting-item-description nn-setting-hidden nn-setting-warning'
    });

    const calendarCustomMonthPattern = createCalendarCustomPatternSetting({
        name: strings.settings.items.calendarCustomMonthPattern.name,
        placeholder: DEFAULT_CALENDAR_CUSTOM_MONTH_PATTERN,
        getValue: () => normalizeCalendarCustomFilePattern(plugin.settings.calendarCustomMonthPattern, ''),
        setValue: value => {
            plugin.settings.calendarCustomMonthPattern = normalizeCalendarCustomFilePattern(value, '');
        },
        onAfterUpdate: () => renderCalendarCustomPatternPreviews()
    });

    const calendarCustomMonthPatternErrorEl = calendarCustomMonthPattern.descEl.createDiv({
        cls: 'setting-item-description nn-setting-hidden nn-setting-warning'
    });

    const calendarCustomQuarterPattern = createCalendarCustomPatternSetting({
        name: strings.settings.items.calendarCustomQuarterPattern.name,
        placeholder: DEFAULT_CALENDAR_CUSTOM_QUARTER_PATTERN,
        getValue: () => normalizeCalendarCustomFilePattern(plugin.settings.calendarCustomQuarterPattern, ''),
        setValue: value => {
            plugin.settings.calendarCustomQuarterPattern = normalizeCalendarCustomFilePattern(value, '');
        },
        onAfterUpdate: () => renderCalendarCustomPatternPreviews()
    });

    const calendarCustomQuarterPatternErrorEl = calendarCustomQuarterPattern.descEl.createDiv({
        cls: 'setting-item-description nn-setting-hidden nn-setting-warning'
    });

    const calendarCustomYearPattern = createCalendarCustomPatternSetting({
        name: strings.settings.items.calendarCustomYearPattern.name,
        placeholder: DEFAULT_CALENDAR_CUSTOM_YEAR_PATTERN,
        getValue: () => normalizeCalendarCustomFilePattern(plugin.settings.calendarCustomYearPattern, ''),
        setValue: value => {
            plugin.settings.calendarCustomYearPattern = normalizeCalendarCustomFilePattern(value, '');
        },
        onAfterUpdate: () => renderCalendarCustomPatternPreviews()
    });

    const calendarCustomYearPatternErrorEl = calendarCustomYearPattern.descEl.createDiv({
        cls: 'setting-item-description nn-setting-hidden nn-setting-warning'
    });

    // Read current input values while typing; the setting values are updated via debounced callbacks.
    const getInputValue = (element: HTMLInputElement | null, fallback: string): string => element?.value ?? fallback;

    /** Updates the preview paths shown under the custom calendar pattern settings */
    const renderCalendarCustomPatternPreviews = (): void => {
        const momentApi = getMomentApi();
        const exampleTemplate = strings.settings.items.calendarCustomFilePattern.example;

        const previewTargets = [
            calendarCustomFilePattern,
            calendarCustomWeekPattern,
            calendarCustomMonthPattern,
            calendarCustomQuarterPattern,
            calendarCustomYearPattern
        ] as const;

        const setExampleText = (target: { exampleEl: HTMLElement; exampleTextEl: HTMLElement }, text: string): void => {
            target.exampleTextEl.setText(text);
            setElementVisible(target.exampleEl, text.trim() !== '');
        };

        const clearExamples = (): void => {
            previewTargets.forEach(target => setExampleText(target, ''));
        };

        if (!momentApi) {
            clearExamples();
            return;
        }

        const sampleDate = momentApi('2026-01-19', 'YYYY-MM-DD', true);
        if (!sampleDate.isValid()) {
            clearExamples();
            return;
        }

        const formatExample = (patternRaw: string, fallback: string): string => {
            const normalized = normalizeCalendarCustomFilePattern(patternRaw, fallback);
            if (!normalized) {
                return '';
            }
            const slashIndex = normalized.lastIndexOf('/');
            const folderPattern = slashIndex === -1 ? '' : normalized.slice(0, slashIndex);
            const filePattern = slashIndex === -1 ? normalized : normalized.slice(slashIndex + 1);
            const folderFormatter = createCalendarCustomDateFormatter(folderPattern);
            const fileFormatter = createCalendarCustomDateFormatter(filePattern);

            const folderSuffix = folderFormatter(sampleDate);
            const folderPath = normalizeCalendarVaultFolderPath(folderSuffix || '/');
            const folderPathRelative = folderPath === '/' ? '' : folderPath;

            const formattedFilePattern = fileFormatter(sampleDate).trim();
            const fileName = ensureMarkdownFileName(formattedFilePattern);
            if (!fileName) {
                return '';
            }
            return folderPathRelative ? `${folderPathRelative}/${fileName}` : fileName;
        };

        const dailyPatternRaw = getInputValue(calendarCustomFilePattern.inputEl, plugin.settings.calendarCustomFilePattern);
        const dailyExamplePath = formatExample(dailyPatternRaw, DEFAULT_CALENDAR_CUSTOM_FILE_PATTERN);
        setExampleText(calendarCustomFilePattern, dailyExamplePath ? exampleTemplate.replace('{path}', dailyExamplePath) : '');

        const weekPatternRaw = getInputValue(calendarCustomWeekPattern.inputEl, plugin.settings.calendarCustomWeekPattern);
        const weekExamplePath = formatExample(weekPatternRaw, '');
        setExampleText(calendarCustomWeekPattern, weekExamplePath ? exampleTemplate.replace('{path}', weekExamplePath) : '');

        const monthPatternRaw = getInputValue(calendarCustomMonthPattern.inputEl, plugin.settings.calendarCustomMonthPattern);
        const monthExamplePath = formatExample(monthPatternRaw, '');
        setExampleText(calendarCustomMonthPattern, monthExamplePath ? exampleTemplate.replace('{path}', monthExamplePath) : '');

        const quarterPatternRaw = getInputValue(calendarCustomQuarterPattern.inputEl, plugin.settings.calendarCustomQuarterPattern);
        const quarterExamplePath = formatExample(quarterPatternRaw, '');
        setExampleText(calendarCustomQuarterPattern, quarterExamplePath ? exampleTemplate.replace('{path}', quarterExamplePath) : '');

        const yearPatternRaw = getInputValue(calendarCustomYearPattern.inputEl, plugin.settings.calendarCustomYearPattern);
        const yearExamplePath = formatExample(yearPatternRaw, '');
        setExampleText(calendarCustomYearPattern, yearExamplePath ? exampleTemplate.replace('{path}', yearExamplePath) : '');
    };

    /** Updates calendar integration sub-setting visibility and validates the custom file pattern */
    const renderCalendarIntegrationVisibility = (): void => {
        const isDailyNotes = plugin.settings.calendarIntegrationMode === 'daily-notes';
        const isCustom = plugin.settings.calendarIntegrationMode === 'notebook-navigator';

        const setAllErrorsHidden = () => {
            setElementVisible(calendarCustomFilePatternErrorEl, false);
            setElementVisible(calendarCustomWeekPatternErrorEl, false);
            setElementVisible(calendarCustomMonthPatternErrorEl, false);
            setElementVisible(calendarCustomQuarterPatternErrorEl, false);
            setElementVisible(calendarCustomYearPatternErrorEl, false);
        };

        setElementVisible(dailyNotesInfoSettingsEl, isDailyNotes);
        setElementVisible(customCalendarSettingsEl, isCustom);

        if (!isCustom) {
            setAllErrorsHidden();
            return;
        }

        const momentApi = getMomentApi();

        const buildCustomPattern = (value: string, fallback: string): string => {
            const { folderPattern, filePattern } = splitCalendarCustomPattern(value, fallback);
            return folderPattern ? `${folderPattern}/${filePattern}` : filePattern;
        };

        const dailyPatternRaw = getInputValue(calendarCustomFilePattern.inputEl, plugin.settings.calendarCustomFilePattern);
        const dailyCustomPattern = buildCustomPattern(dailyPatternRaw, DEFAULT_CALENDAR_CUSTOM_FILE_PATTERN);
        const showDailyError = !isCalendarCustomDatePatternValid(dailyCustomPattern, momentApi);
        calendarCustomFilePatternErrorEl.setText(showDailyError ? strings.settings.items.calendarCustomFilePattern.parsingError : '');
        setElementVisible(calendarCustomFilePatternErrorEl, showDailyError);

        const weekPatternRaw = getInputValue(calendarCustomWeekPattern.inputEl, plugin.settings.calendarCustomWeekPattern);
        const weekCustomPattern = buildCustomPattern(weekPatternRaw, '');
        const showWeekError = weekPatternRaw.trim() !== '' && !isCalendarCustomWeekPatternValid(weekCustomPattern, momentApi);
        calendarCustomWeekPatternErrorEl.setText(showWeekError ? strings.settings.items.calendarCustomWeekPattern.parsingError : '');
        setElementVisible(calendarCustomWeekPatternErrorEl, showWeekError);

        const monthPatternRaw = getInputValue(calendarCustomMonthPattern.inputEl, plugin.settings.calendarCustomMonthPattern);
        const monthCustomPattern = buildCustomPattern(monthPatternRaw, '');
        const showMonthError = monthPatternRaw.trim() !== '' && !isCalendarCustomMonthPatternValid(monthCustomPattern, momentApi);
        calendarCustomMonthPatternErrorEl.setText(showMonthError ? strings.settings.items.calendarCustomMonthPattern.parsingError : '');
        setElementVisible(calendarCustomMonthPatternErrorEl, showMonthError);

        const quarterPatternRaw = getInputValue(calendarCustomQuarterPattern.inputEl, plugin.settings.calendarCustomQuarterPattern);
        const quarterCustomPattern = buildCustomPattern(quarterPatternRaw, '');
        const showQuarterError = quarterPatternRaw.trim() !== '' && !isCalendarCustomQuarterPatternValid(quarterCustomPattern, momentApi);
        calendarCustomQuarterPatternErrorEl.setText(
            showQuarterError ? strings.settings.items.calendarCustomQuarterPattern.parsingError : ''
        );
        setElementVisible(calendarCustomQuarterPatternErrorEl, showQuarterError);

        const yearPatternRaw = getInputValue(calendarCustomYearPattern.inputEl, plugin.settings.calendarCustomYearPattern);
        const yearCustomPattern = buildCustomPattern(yearPatternRaw, '');
        const showYearError = yearPatternRaw.trim() !== '' && !isCalendarCustomYearPatternValid(yearCustomPattern, momentApi);
        calendarCustomYearPatternErrorEl.setText(showYearError ? strings.settings.items.calendarCustomYearPattern.parsingError : '');
        setElementVisible(calendarCustomYearPatternErrorEl, showYearError);

        renderCalendarCustomPatternPreviews();
    };

    const previewInputs = [
        calendarCustomFilePattern.inputEl,
        calendarCustomWeekPattern.inputEl,
        calendarCustomMonthPattern.inputEl,
        calendarCustomQuarterPattern.inputEl,
        calendarCustomYearPattern.inputEl
    ];
    previewInputs.forEach(input => {
        input?.addEventListener('input', () => renderCalendarIntegrationVisibility());
    });

    context.registerSettingsUpdateListener('calendar-tab-calendar-integration', () => {
        renderCalendarIntegrationVisibility();
    });

    renderCalendarIntegrationVisibility();
}
