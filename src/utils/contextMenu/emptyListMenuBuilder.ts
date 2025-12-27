/*
 * Notebook Navigator - Plugin for Obsidian
 * Copyright (c) 2025-2026 Johan Sanneblad
 * SPDX-License-Identifier: LicenseRef-NotebookNavigator
 *
 * Licensed under the Notebook Navigator License Agreement (see LICENSE).
 */

import { FolderMenuBuilderParams } from './menuTypes';
import { buildFolderCreationMenu } from './folderMenuBuilder';

/**
 * Builds the context menu for empty space inside the list pane.
 * Reuses the folder creation builder so options stay in sync with folder context menus.
 */
export function buildEmptyListMenu(params: FolderMenuBuilderParams): void {
    buildFolderCreationMenu(params);
}
