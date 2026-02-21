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

import { App, Modal, setIcon } from 'obsidian';
import { strings } from '../i18n';
import type { VaultProfilePropertyKey } from '../settings/types';
import { runAsyncAction } from '../utils/async';
import { addAsyncEventListener } from '../utils/domEventListeners';
import { casefold } from '../utils/recordUtils';
import { naturalCompare } from '../utils/sortUtils';
import { collectVaultPropertyKeys } from '../utils/propertyUtils';
import { clonePropertyKeys } from '../utils/vaultProfiles';

interface PropertyKeyVisibilityModalOptions {
    initialKeys: VaultProfilePropertyKey[];
    onSave: (nextKeys: VaultProfilePropertyKey[]) => Promise<void> | void;
}

type RowState = {
    normalizedKey: string;
    displayKey: string;
    noteCount: number;
    showInNavigation: boolean;
    showInList: boolean;
};

type RowControls = {
    rowEl: HTMLDivElement;
    navigationButton: HTMLButtonElement;
    listButton: HTMLButtonElement;
};

const CHECKBOX_OFF_ICON = 'lucide-square';
const CHECKBOX_ON_ICON = 'lucide-square-check-big';
const NAVIGATION_PANE_TAB_ICON = 'panel-left';
const LIST_PANE_TAB_ICON = 'list';

export class PropertyKeyVisibilityModal extends Modal {
    private options: PropertyKeyVisibilityModalOptions;
    private rows: RowState[] = [];
    private rowsByKey = new Map<string, RowState>();
    private rowControls = new Map<string, RowControls>();
    private headerDisposers: (() => void)[] = [];
    private rowDisposers: (() => void)[] = [];
    private footerDisposers: (() => void)[] = [];
    private applyButton: HTMLButtonElement | null = null;
    private listEl: HTMLDivElement | null = null;
    private filterQuery = '';
    private initialSnapshot = '';
    private isSaving = false;
    private initialOrder: string[] = [];

    constructor(app: App, options: PropertyKeyVisibilityModalOptions) {
        super(app);
        this.options = options;
        this.initializeRows();
    }

    onOpen(): void {
        this.modalEl.addClass('nn-property-keys-modal');
        this.titleEl.setText(strings.modals.propertyKeyVisibility.title);
        this.contentEl.empty();

        const filterInput = this.contentEl.createEl('input', {
            cls: ['nn-input', 'nn-property-keys-search'],
            attr: {
                type: 'text',
                placeholder: strings.modals.propertyKeyVisibility.searchPlaceholder
            }
        });
        this.headerDisposers.push(
            addAsyncEventListener(filterInput, 'input', () => {
                this.filterQuery = filterInput.value;
                this.renderRows();
            })
        );

        const scrollContainer = this.contentEl.createDiv({ cls: 'nn-property-keys-scroll' });
        this.renderColumnHeader(scrollContainer);
        this.listEl = scrollContainer.createDiv({ cls: 'nn-property-keys-list' });
        this.renderRows();

        this.renderFooter();
        this.updateApplyButtonState();

        filterInput.focus();
    }

    onClose(): void {
        this.disposeHeaderDisposers();
        this.disposeRowDisposers();
        this.disposeFooterDisposers();
        this.rowControls.clear();
        this.rows = [];
        this.rowsByKey.clear();
        this.listEl = null;
        this.applyButton = null;
        this.modalEl.removeClass('nn-property-keys-modal');
        this.contentEl.empty();
    }

    private initializeRows(): void {
        const initialKeys = clonePropertyKeys(this.options.initialKeys);
        this.initialOrder = initialKeys.map(entry => casefold(entry.key)).filter(Boolean);

        const configuredByKey = new Map<string, VaultProfilePropertyKey>();
        initialKeys.forEach(entry => {
            const normalizedKey = casefold(entry.key);
            if (!normalizedKey || configuredByKey.has(normalizedKey)) {
                return;
            }
            configuredByKey.set(normalizedKey, entry);
        });

        const available = collectVaultPropertyKeys(this.app);
        const mergedByKey = new Map<string, RowState>();

        configuredByKey.forEach((entry, normalizedKey) => {
            mergedByKey.set(normalizedKey, {
                normalizedKey,
                displayKey: entry.key.trim(),
                noteCount: 0,
                showInNavigation: entry.showInNavigation,
                showInList: entry.showInList
            });
        });

        available.forEach(suggestion => {
            const normalizedKey = casefold(suggestion.key);
            const displayKey = suggestion.key.trim();
            if (!normalizedKey || !displayKey) {
                return;
            }

            const existing = mergedByKey.get(normalizedKey);
            if (existing) {
                existing.noteCount = suggestion.noteCount;
                return;
            }

            mergedByKey.set(normalizedKey, {
                normalizedKey,
                displayKey,
                noteCount: suggestion.noteCount,
                showInNavigation: false,
                showInList: false
            });
        });

        const rows = Array.from(mergedByKey.values());
        rows.sort((left, right) => {
            const compare = naturalCompare(left.displayKey, right.displayKey);
            if (compare !== 0) {
                return compare;
            }
            return left.displayKey.localeCompare(right.displayKey);
        });

        this.rows = rows;
        this.rowsByKey = new Map(rows.map(row => [row.normalizedKey, row]));
        this.initialSnapshot = this.serializeSelection();
    }

    private serializeSelection(): string {
        const keys = this.buildNextPropertyKeys();
        const stable = keys
            .map(entry => ({
                key: entry.key,
                showInNavigation: entry.showInNavigation,
                showInList: entry.showInList
            }))
            .sort((left, right) => {
                const leftKey = casefold(left.key);
                const rightKey = casefold(right.key);
                if (leftKey < rightKey) {
                    return -1;
                }
                if (leftKey > rightKey) {
                    return 1;
                }
                return 0;
            });
        return JSON.stringify(stable);
    }

    private buildNextPropertyKeys(): VaultProfilePropertyKey[] {
        const initialOrder = this.initialOrder;
        const inInitialOrder = new Set<string>();
        initialOrder.forEach(key => {
            if (key) {
                inInitialOrder.add(key);
            }
        });

        const included: VaultProfilePropertyKey[] = [];

        const includeRow = (row: RowState) => {
            const key = row.displayKey.trim();
            if (!key) {
                return;
            }
            included.push({
                key,
                showInNavigation: row.showInNavigation,
                showInList: row.showInList
            });
        };

        initialOrder.forEach(normalizedKey => {
            const row = this.rowsByKey.get(normalizedKey);
            if (!row) {
                return;
            }
            if (!row.showInNavigation && !row.showInList) {
                return;
            }
            includeRow(row);
        });

        const appended = this.rows.filter(row => {
            if (!row.showInNavigation && !row.showInList) {
                return false;
            }
            return !inInitialOrder.has(row.normalizedKey);
        });

        appended.sort((left, right) => {
            const compare = naturalCompare(left.displayKey, right.displayKey);
            if (compare !== 0) {
                return compare;
            }
            return left.displayKey.localeCompare(right.displayKey);
        });

        appended.forEach(row => includeRow(row));

        return included;
    }

    private getFilteredRows(): RowState[] {
        const query = this.filterQuery.trim();
        if (!query) {
            return this.rows;
        }

        const normalizedQuery = casefold(query);
        if (!normalizedQuery) {
            return this.rows;
        }

        return this.rows.filter(row => row.normalizedKey.includes(normalizedQuery));
    }

    private renderRows(): void {
        if (!this.listEl) {
            return;
        }

        this.disposeRowDisposers();
        this.rowControls.clear();
        this.listEl.empty();

        const rows = this.getFilteredRows();
        if (rows.length === 0) {
            this.listEl.createDiv({ cls: 'nn-property-keys-empty', text: strings.modals.propertyKeyVisibility.emptyState });
            return;
        }

        rows.forEach(row => {
            const rowEl = this.listEl?.createDiv({ cls: 'nn-property-keys-row' });
            if (!rowEl) {
                return;
            }

            rowEl.toggleClass('is-enabled', row.showInNavigation || row.showInList);

            const labelEl = rowEl.createDiv({ cls: 'nn-property-keys-label' });
            labelEl.createSpan({ text: row.displayKey });
            if (row.noteCount > 0) {
                labelEl.createSpan({
                    cls: 'nn-property-keys-count',
                    text: ` (${row.noteCount.toLocaleString()})`
                });
            }

            const actionsEl = rowEl.createDiv({ cls: 'nn-property-keys-actions' });

            const navigationButton = actionsEl.createEl('button', {
                cls: ['nn-action-btn', 'nn-property-keys-toggle'],
                attr: {
                    type: 'button',
                    'aria-label': strings.modals.propertyKeyVisibility.showInNavigation
                }
            });
            navigationButton.toggleClass('is-enabled', row.showInNavigation);
            setIcon(navigationButton, row.showInNavigation ? CHECKBOX_ON_ICON : CHECKBOX_OFF_ICON);

            const listButton = actionsEl.createEl('button', {
                cls: ['nn-action-btn', 'nn-property-keys-toggle'],
                attr: {
                    type: 'button',
                    'aria-label': strings.modals.propertyKeyVisibility.showInList
                }
            });
            listButton.toggleClass('is-enabled', row.showInList);
            setIcon(listButton, row.showInList ? CHECKBOX_ON_ICON : CHECKBOX_OFF_ICON);

            this.rowControls.set(row.normalizedKey, { rowEl, navigationButton, listButton });
            this.rowDisposers.push(
                addAsyncEventListener(navigationButton, 'click', () => {
                    this.toggleRow(row.normalizedKey, 'navigation');
                })
            );
            this.rowDisposers.push(
                addAsyncEventListener(listButton, 'click', () => {
                    this.toggleRow(row.normalizedKey, 'list');
                })
            );
        });
    }

    private renderColumnHeader(containerEl: HTMLElement): void {
        const rowEl = containerEl.createDiv({ cls: ['nn-property-keys-row', 'nn-property-keys-header-row', 'is-enabled'] });
        rowEl.createDiv({
            cls: 'nn-property-keys-label',
            text: strings.modals.propertyKeyVisibility.propertyColumnLabel
        });

        const actionsEl = rowEl.createDiv({ cls: 'nn-property-keys-actions' });

        const navigationIconEl = actionsEl.createDiv({ cls: ['nn-property-keys-toggle', 'nn-property-keys-header-icon', 'is-enabled'] });
        navigationIconEl.setAttribute('aria-hidden', 'true');
        setIcon(navigationIconEl, NAVIGATION_PANE_TAB_ICON);

        const listIconEl = actionsEl.createDiv({ cls: ['nn-property-keys-toggle', 'nn-property-keys-header-icon', 'is-enabled'] });
        listIconEl.setAttribute('aria-hidden', 'true');
        setIcon(listIconEl, LIST_PANE_TAB_ICON);
    }

    private toggleRow(normalizedKey: string, toggle: 'navigation' | 'list'): void {
        const row = this.rowsByKey.get(normalizedKey);
        if (!row) {
            return;
        }

        if (toggle === 'navigation') {
            row.showInNavigation = !row.showInNavigation;
        } else {
            row.showInList = !row.showInList;
        }

        const controls = this.rowControls.get(normalizedKey);
        if (controls) {
            const enabled = row.showInNavigation || row.showInList;
            controls.rowEl.toggleClass('is-enabled', enabled);

            controls.navigationButton.toggleClass('is-enabled', row.showInNavigation);
            setIcon(controls.navigationButton, row.showInNavigation ? CHECKBOX_ON_ICON : CHECKBOX_OFF_ICON);

            controls.listButton.toggleClass('is-enabled', row.showInList);
            setIcon(controls.listButton, row.showInList ? CHECKBOX_ON_ICON : CHECKBOX_OFF_ICON);
        }

        this.updateApplyButtonState();
    }

    private renderFooter(): void {
        const footer = this.contentEl.createDiv({ cls: ['nn-button-container', 'nn-property-keys-footer'] });

        const cancelButton = footer.createEl('button', {
            text: strings.common.cancel,
            attr: { type: 'button' }
        });
        this.footerDisposers.push(
            addAsyncEventListener(cancelButton, 'click', () => {
                this.close();
            })
        );

        this.applyButton = footer.createEl('button', {
            cls: 'mod-cta',
            text: strings.modals.propertyKeyVisibility.applyButton,
            attr: { type: 'button' }
        });
        this.footerDisposers.push(
            addAsyncEventListener(this.applyButton, 'click', () => {
                this.applyChanges();
            })
        );
    }

    private updateApplyButtonState(): void {
        if (!this.applyButton) {
            return;
        }

        if (this.isSaving) {
            this.applyButton.disabled = true;
            return;
        }

        const snapshot = this.serializeSelection();
        this.applyButton.disabled = snapshot === this.initialSnapshot;
    }

    private applyChanges(): void {
        if (this.isSaving) {
            return;
        }

        const nextKeys = this.buildNextPropertyKeys();
        const snapshot = this.serializeSelection();
        if (snapshot === this.initialSnapshot) {
            this.close();
            return;
        }

        this.isSaving = true;
        this.updateApplyButtonState();

        runAsyncAction(async () => {
            try {
                await this.options.onSave(nextKeys);
                this.close();
            } finally {
                this.isSaving = false;
                this.updateApplyButtonState();
            }
        });
    }

    private disposeRowDisposers(): void {
        const disposers = this.rowDisposers;
        this.rowDisposers = [];
        disposers.forEach(dispose => {
            try {
                dispose();
            } catch {
                // ignore
            }
        });
    }

    private disposeHeaderDisposers(): void {
        const disposers = this.headerDisposers;
        this.headerDisposers = [];
        disposers.forEach(dispose => {
            try {
                dispose();
            } catch {
                // ignore
            }
        });
    }

    private disposeFooterDisposers(): void {
        const disposers = this.footerDisposers;
        this.footerDisposers = [];
        disposers.forEach(dispose => {
            try {
                dispose();
            } catch {
                // ignore
            }
        });
    }
}
