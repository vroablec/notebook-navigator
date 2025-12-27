/*
 * Notebook Navigator - Plugin for Obsidian
 * Copyright (c) 2025-2026 Johan Sanneblad
 * SPDX-License-Identifier: LicenseRef-NotebookNavigator
 *
 * Licensed under the Notebook Navigator License Agreement (see LICENSE).
 */

export type FolderNoteType = 'markdown' | 'canvas' | 'base';

export type FolderNoteCreationPreference = FolderNoteType | 'ask';

export const FOLDER_NOTE_TYPE_EXTENSIONS: Record<FolderNoteType, string> = {
    markdown: 'md',
    canvas: 'canvas',
    base: 'base'
};

function isFolderNoteType(value: string): value is FolderNoteType {
    return value === 'markdown' || value === 'canvas' || value === 'base';
}

export function isFolderNoteCreationPreference(value: string): value is FolderNoteCreationPreference {
    return value === 'ask' || isFolderNoteType(value);
}
