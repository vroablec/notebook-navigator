/*
 * Notebook Navigator - Plugin for Obsidian
 * Copyright (c) 2025-2026 Johan Sanneblad
 * SPDX-License-Identifier: LicenseRef-NotebookNavigator
 *
 * Licensed under the Notebook Navigator License Agreement (see LICENSE).
 */

import { ItemType } from '../types';
import { normalizeTagPath } from './tagUtils';

export type NavigationIndexKey = string;

/**
 * Normalizes a navigation path for index lookups.
 * Tags use lowercase paths. Folders pass through unchanged.
 */
export function normalizeNavigationPath(itemType: ItemType, path: string): string {
    if (itemType === ItemType.TAG) {
        const normalized = normalizeTagPath(path);
        return normalized ?? path.toLowerCase();
    }
    return path;
}

/**
 * Creates the composite key used for navigation index lookups.
 */
function createNavigationIndexKey(itemType: ItemType, path: string): NavigationIndexKey {
    const normalizedPath = normalizeNavigationPath(itemType, path);
    return `${itemType}:${normalizedPath}`;
}

/**
 * Looks up the index for a navigation item using its type-aware key.
 */
export function getNavigationIndex(indexMap: Map<NavigationIndexKey, number>, itemType: ItemType, path: string): number | undefined {
    return indexMap.get(createNavigationIndexKey(itemType, path));
}

/**
 * Stores the index for a navigation item using its type-aware key.
 */
export function setNavigationIndex(indexMap: Map<NavigationIndexKey, number>, itemType: ItemType, path: string, index: number): void {
    indexMap.set(createNavigationIndexKey(itemType, path), index);
}
