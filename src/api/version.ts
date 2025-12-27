/*
 * Notebook Navigator - Plugin for Obsidian
 * Copyright (c) 2025-2026 Johan Sanneblad
 * SPDX-License-Identifier: LicenseRef-NotebookNavigator
 *
 * Licensed under the Notebook Navigator License Agreement (see LICENSE).
 */

/**
 * API Version Management
 *
 * Semantic versioning for the API:
 * - MAJOR: Breaking changes
 * - MINOR: New features (backwards compatible)
 * - PATCH: Bug fixes (backwards compatible)
 */

function formatApiVersion(version: { major: number; minor: number; patch: number }): string {
    return `${version.major}.${version.minor}.${version.patch}`;
}

export const API_VERSION = {
    major: 1,
    minor: 1,
    patch: 0,
    toString(): string {
        return formatApiVersion(API_VERSION);
    }
} as const;
