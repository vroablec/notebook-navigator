/*
 * Notebook Navigator - Plugin for Obsidian
 * Copyright (c) 2025-2026 Johan Sanneblad
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

import { Setting } from 'obsidian';
import { strings } from '../../i18n';
import { PropertyKeySuggestModal, type PropertyKeySuggestion } from '../../modals/PropertyKeySuggestModal';
import { formatCommaSeparatedList, getCachedCommaSeparatedList, normalizeCommaSeparatedList } from '../../utils/commaSeparatedListUtils';
import { showNotice } from '../../utils/noticeUtils';
import { casefold } from '../../utils/recordUtils';
import { naturalCompare } from '../../utils/sortUtils';
import { isRecord } from '../../utils/typeGuards';
import { isTagSortOrder } from '../types';
import type { SettingsTabContext } from './SettingsTabContext';
import { createSettingGroupFactory } from '../settingGroups';
import { addSettingSyncModeToggle } from '../syncModeToggle';
import { wireToggleSettingWithSubSettings } from '../subSettings';

interface PropertyKeyAggregate {
    displayKey: string;
    noteCount: number;
}

function collectAvailablePropertyKeySuggestions(context: SettingsTabContext): PropertyKeySuggestion[] {
    const { app, plugin } = context;
    const keyMap = new Map<string, PropertyKeyAggregate>();

    const registerPropertyKey = (rawKey: string, incrementNoteCount: boolean): void => {
        const trimmedKey = rawKey.trim();
        const normalizedKey = casefold(trimmedKey);
        if (!normalizedKey) {
            return;
        }

        const existing = keyMap.get(normalizedKey);
        if (existing) {
            if (incrementNoteCount) {
                existing.noteCount += 1;
            }
            return;
        }

        keyMap.set(normalizedKey, {
            displayKey: trimmedKey,
            noteCount: incrementNoteCount ? 1 : 0
        });
    };

    app.vault.getMarkdownFiles().forEach(file => {
        const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter;
        if (!isRecord(frontmatter)) {
            return;
        }

        Object.keys(frontmatter).forEach(propertyKey => {
            registerPropertyKey(propertyKey, true);
        });
    });

    getCachedCommaSeparatedList(plugin.settings.propertyFields).forEach(propertyKey => {
        registerPropertyKey(propertyKey, false);
    });

    const suggestions = Array.from(keyMap.values()).map(value => ({ key: value.displayKey, noteCount: value.noteCount }));
    suggestions.sort((left, right) => {
        const naturalResult = naturalCompare(left.key, right.key);
        if (naturalResult !== 0) {
            return naturalResult;
        }
        return left.key.localeCompare(right.key);
    });
    return suggestions;
}

function appendPropertyField(propertyFields: string, propertyKey: string): string {
    const existingFields = getCachedCommaSeparatedList(propertyFields);
    const normalizedFields = new Set<string>();
    existingFields.forEach(field => {
        const normalized = casefold(field);
        if (!normalized) {
            return;
        }
        normalizedFields.add(normalized);
    });

    const trimmedPropertyKey = propertyKey.trim();
    const normalizedPropertyKey = casefold(trimmedPropertyKey);
    if (!normalizedPropertyKey || normalizedFields.has(normalizedPropertyKey)) {
        return formatCommaSeparatedList(existingFields);
    }

    return formatCommaSeparatedList([...existingFields, trimmedPropertyKey]);
}

function setPropertyFieldsInputValue(setting: Setting, value: string): void {
    const inputEl = setting.controlEl.querySelector('input');
    if (inputEl instanceof HTMLInputElement) {
        inputEl.value = value;
    }
}

/** Renders the properties settings tab */
export function renderPropertiesTab(context: SettingsTabContext): void {
    const { containerEl, plugin, app } = context;
    const createGroup = createSettingGroupFactory(containerEl);

    const propertiesGroup = createGroup(undefined);

    const showPropertiesSetting = propertiesGroup.addSetting(setting => {
        setting.setName(strings.settings.items.showProperties.name).setDesc(strings.settings.items.showProperties.desc);
    });

    const propertiesSubSettingsEl = wireToggleSettingWithSubSettings(
        showPropertiesSetting,
        () => plugin.settings.showProperties,
        async value => {
            plugin.settings.showProperties = value;
            await plugin.saveSettingsAndUpdate();
        }
    );

    const propertyFieldsSetting = context.createDebouncedTextSetting(
        propertiesSubSettingsEl,
        strings.settings.items.propertyFields.name,
        strings.settings.items.propertyFields.desc,
        strings.settings.items.propertyFields.placeholder,
        () => plugin.settings.propertyFields,
        value => {
            plugin.settings.propertyFields = normalizeCommaSeparatedList(value);
        }
    );
    propertyFieldsSetting.controlEl.addClass('nn-setting-wide-input');
    propertyFieldsSetting.addExtraButton(button =>
        button
            .setIcon('lucide-plus')
            .setTooltip(strings.settings.items.propertyFields.addButtonTooltip)
            .onClick(() => {
                const suggestions = collectAvailablePropertyKeySuggestions(context);
                if (suggestions.length === 0) {
                    showNotice(strings.settings.items.propertyFields.emptySelectorNotice, { variant: 'warning' });
                    return;
                }

                const modal = new PropertyKeySuggestModal(app, suggestions, async selectedKey => {
                    const nextValue = appendPropertyField(plugin.settings.propertyFields, selectedKey);
                    if (nextValue === plugin.settings.propertyFields) {
                        return;
                    }

                    plugin.settings.propertyFields = normalizeCommaSeparatedList(nextValue);
                    setPropertyFieldsInputValue(propertyFieldsSetting, plugin.settings.propertyFields);
                    await plugin.saveSettingsAndUpdate();
                });
                modal.open();
            })
    );

    new Setting(propertiesSubSettingsEl)
        .setName(strings.settings.items.showPropertyIcons.name)
        .setDesc(strings.settings.items.showPropertyIcons.desc)
        .addToggle(toggle =>
            toggle.setValue(plugin.settings.showPropertyIcons).onChange(async value => {
                plugin.settings.showPropertyIcons = value;
                await plugin.saveSettingsAndUpdate();
            })
        );

    new Setting(propertiesSubSettingsEl)
        .setName(strings.settings.items.inheritPropertyColors.name)
        .setDesc(strings.settings.items.inheritPropertyColors.desc)
        .addToggle(toggle =>
            toggle.setValue(plugin.settings.inheritPropertyColors).onChange(async value => {
                plugin.settings.inheritPropertyColors = value;
                await plugin.saveSettingsAndUpdate();
            })
        );

    const propertySortOrderSetting = new Setting(propertiesSubSettingsEl)
        .setName(strings.settings.items.propertySortOrder.name)
        .setDesc(strings.settings.items.propertySortOrder.desc)
        .addDropdown(dropdown => {
            const frequencyAscLabel = `${strings.settings.items.propertySortOrder.options.frequency} (${strings.settings.items.propertySortOrder.options.lowToHigh})`;
            const frequencyDescLabel = `${strings.settings.items.propertySortOrder.options.frequency} (${strings.settings.items.propertySortOrder.options.highToLow})`;

            dropdown
                .addOption('alpha-asc', strings.settings.items.propertySortOrder.options.alphaAsc)
                .addOption('alpha-desc', strings.settings.items.propertySortOrder.options.alphaDesc)
                .addOption('frequency-asc', frequencyAscLabel)
                .addOption('frequency-desc', frequencyDescLabel)
                .setValue(plugin.getPropertySortOrder())
                .onChange(value => {
                    if (!isTagSortOrder(value)) {
                        return;
                    }
                    plugin.setPropertySortOrder(value);
                });
        });

    addSettingSyncModeToggle({ setting: propertySortOrderSetting, plugin, settingId: 'propertySortOrder' });

    new Setting(propertiesSubSettingsEl)
        .setName(strings.settings.items.showAllPropertiesFolder.name)
        .setDesc(strings.settings.items.showAllPropertiesFolder.desc)
        .addToggle(toggle =>
            toggle.setValue(plugin.settings.showAllPropertiesFolder).onChange(async value => {
                plugin.settings.showAllPropertiesFolder = value;
                await plugin.saveSettingsAndUpdate();
            })
        );
}
