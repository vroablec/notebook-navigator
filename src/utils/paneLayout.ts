/*
 * Notebook Navigator - Plugin for Obsidian
 * Copyright (c) 2025-2026 Johan Sanneblad
 * SPDX-License-Identifier: LicenseRef-NotebookNavigator
 *
 * Licensed under the Notebook Navigator License Agreement (see LICENSE).
 */

import type { BackgroundMode } from '../types';

/** Returns CSS classes for the configured background mode */
export function getBackgroundClasses(mode: BackgroundMode | null | undefined): string[] {
    if (mode === 'primary') {
        return ['nn-bg-primary'];
    }
    if (mode === 'secondary') {
        return ['nn-bg-secondary'];
    }
    return [];
}
