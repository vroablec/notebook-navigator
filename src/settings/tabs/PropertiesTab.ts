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
import { PropertyKeySuggestModal } from '../../modals/PropertyKeySuggestModal';
import { normalizeCommaSeparatedList } from '../../utils/commaSeparatedListUtils';
import { showNotice } from '../../utils/noticeUtils';
import { appendPropertyField, collectAvailablePropertyKeySuggestions } from '../../utils/propertyUtils';
import { isTagSortOrder } from '../types';
import type { SettingsTabContext } from './SettingsTabContext';
import { createSettingGroupFactory } from '../settingGroups';
import { addSettingSyncModeToggle } from '../syncModeToggle';
import { wireToggleSettingWithSubSettings } from '../subSettings';

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
                const suggestions = collectAvailablePropertyKeySuggestions(app, plugin.settings.propertyFields);
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
