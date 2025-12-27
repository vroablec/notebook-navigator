/*
 * Notebook Navigator - Plugin for Obsidian
 * Copyright (c) 2025-2026 Johan Sanneblad
 * SPDX-License-Identifier: LicenseRef-NotebookNavigator
 *
 * Licensed under the Notebook Navigator License Agreement (see LICENSE).
 */

import type { MenuItem } from 'obsidian';
import { runAsyncAction } from '../async';

export function setAsyncOnClick(item: MenuItem, handler: () => void | Promise<void>): MenuItem {
    return item.onClick(() => {
        runAsyncAction(handler);
    });
}
