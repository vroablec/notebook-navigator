/*
 * Notebook Navigator - Plugin for Obsidian
 * Copyright (c) 2025-2026 Johan Sanneblad
 * SPDX-License-Identifier: LicenseRef-NotebookNavigator
 *
 * Licensed under the Notebook Navigator License Agreement (see LICENSE).
 */

/**
 * Interface for tracking note counts in folders and tags, supporting separate counts
 * for current items and their descendants
 */
export interface NoteCountInfo {
    /** Notes stored directly on the current item */
    current: number;
    /** Notes stored under descendant items */
    descendants: number;
    /** Sum of current and descendant notes */
    total: number;
}
