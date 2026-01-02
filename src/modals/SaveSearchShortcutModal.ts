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

import { App, Modal } from 'obsidian';
import { strings } from '../i18n';
import { runAsyncAction } from '../utils/async';
import { showNotice } from '../utils/noticeUtils';

/**
 * Options for initializing the SaveSearchShortcutModal
 */
interface SaveSearchShortcutModalOptions {
    initialName: string;
    onSubmit: (name: string) => Promise<boolean> | boolean;
}

/**
 * Modal for saving a search query as a shortcut.
 * Allows user to provide a custom name for the saved search.
 */
export class SaveSearchShortcutModal extends Modal {
    private name: string;
    private readonly onSubmitHandler: SaveSearchShortcutModalOptions['onSubmit'];
    private inputEl!: HTMLInputElement;

    constructor(app: App, { initialName, onSubmit }: SaveSearchShortcutModalOptions) {
        super(app);
        this.name = initialName;
        this.onSubmitHandler = onSubmit;
    }

    onOpen(): void {
        this.modalEl.addClass('nn-save-search-shortcut-modal');
        this.titleEl.setText(strings.searchInput.shortcutModalTitle);

        const inputContainer = this.contentEl.createDiv('nn-save-search-shortcut-input-container');
        const label = inputContainer.createEl('label', { text: strings.searchInput.shortcutNameLabel });
        label.htmlFor = 'nn-save-search-shortcut-input';

        this.inputEl = inputContainer.createEl('input', {
            type: 'text',
            attr: { id: 'nn-save-search-shortcut-input' },
            placeholder: strings.searchInput.shortcutNamePlaceholder,
            value: this.name
        });
        this.inputEl.addClass('nn-input');
        this.inputEl.addEventListener('input', () => {
            this.name = this.inputEl.value;
        });

        const buttonContainer = this.contentEl.createDiv('nn-button-container');
        const cancelBtn = buttonContainer.createEl('button', { text: strings.common.cancel });
        cancelBtn.addEventListener('click', () => this.close());

        const submitBtn = buttonContainer.createEl('button', {
            text: strings.common.submit,
            cls: 'mod-cta'
        });
        submitBtn.addEventListener('click', () => {
            runAsyncAction(() => this.handleSubmit());
        });

        this.scope.register([], 'Enter', event => {
            if (document.activeElement !== this.inputEl) {
                return;
            }

            event.preventDefault();
            runAsyncAction(() => this.handleSubmit());
        });

        this.inputEl.focus();
        this.inputEl.select();
    }

    onClose(): void {
        this.modalEl.removeClass('nn-save-search-shortcut-modal');
        this.contentEl.empty();
    }

    /**
     * Validates input and calls the submit handler.
     * Shows an error notice if the name is empty.
     */
    private async handleSubmit(): Promise<void> {
        const trimmedName = this.name.trim();
        if (trimmedName.length === 0) {
            showNotice(strings.shortcuts.emptySearchName, { variant: 'warning' });
            return;
        }

        const result = await this.onSubmitHandler(trimmedName);
        if (result !== false) {
            this.close();
        }
    }
}
