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

import { App } from 'obsidian';
import { strings } from '../i18n';
import { type MaybePromise } from '../utils/async';
import { BaseSuggestModal } from './BaseSuggestModal';

export interface PropertyKeySuggestion {
    key: string;
    noteCount: number;
}

export class PropertyKeySuggestModal extends BaseSuggestModal<PropertyKeySuggestion> {
    constructor(
        app: App,
        private suggestions: readonly PropertyKeySuggestion[],
        onChoosePropertyKey: (key: string) => MaybePromise
    ) {
        super(app, suggestion => onChoosePropertyKey(suggestion.key), strings.modals.propertySuggest.placeholder, {
            navigate: strings.modals.propertySuggest.instructions.navigate,
            action: strings.modals.propertySuggest.instructions.select,
            dismiss: strings.modals.propertySuggest.instructions.dismiss
        });
    }

    getItems(): PropertyKeySuggestion[] {
        return [...this.suggestions];
    }

    getItemText(item: PropertyKeySuggestion): string {
        return item.key;
    }

    protected getDisplayPath(item: PropertyKeySuggestion): string {
        return item.key;
    }

    protected getItemClass(): string {
        return 'nn-property-suggest-item';
    }

    protected renderAdditionalContent(item: PropertyKeySuggestion, itemEl: HTMLElement): void {
        if (item.noteCount <= 0) {
            return;
        }

        itemEl.createSpan({
            text: ` (${item.noteCount.toLocaleString()})`,
            cls: 'nn-tag-suggest-count'
        });
    }
}
