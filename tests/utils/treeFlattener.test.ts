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

import { describe, expect, it } from 'vitest';
import { TFolder } from 'obsidian';
import { flattenFolderTree } from '../../src/utils/treeFlattener';

function getFolderName(path: string): string {
    if (path === '/') {
        return '/';
    }
    const parts = path.split('/');
    return parts[parts.length - 1] || path;
}

function createFolder(path: string, children: TFolder[] = []): TFolder {
    const folder = new TFolder();
    Reflect.set(folder, 'path', path);
    Reflect.set(folder, 'name', getFolderName(path));
    Reflect.set(folder, 'children', children);
    return folder;
}

describe('treeFlattener flattenFolderTree', () => {
    it('sorts folders by folder name when no custom sort name resolver is provided', () => {
        const alpha = createFolder('alpha');
        const zeta = createFolder('zeta');
        const root = createFolder('/', [zeta, alpha]);
        const expandedFolders = new Set<string>(['/']);

        const items = flattenFolderTree([root], expandedFolders, [], 0, new Set(), {
            defaultSortOrder: 'alpha-asc'
        });

        const childPaths = items.filter(item => item.level === 1).map(item => item.data.path);
        expect(childPaths).toEqual(['alpha', 'zeta']);
    });

    it('sorts folders by provided sort names when a custom resolver is provided', () => {
        const alpha = createFolder('alpha');
        const zeta = createFolder('zeta');
        const root = createFolder('/', [zeta, alpha]);
        const expandedFolders = new Set<string>(['/']);

        const sortNames = new Map<string, string>([
            ['alpha', 'Zulu'],
            ['zeta', 'Alpha']
        ]);

        const items = flattenFolderTree([root], expandedFolders, [], 0, new Set(), {
            defaultSortOrder: 'alpha-asc',
            getFolderSortName: folder => sortNames.get(folder.path) ?? folder.name
        });

        const childPaths = items.filter(item => item.level === 1).map(item => item.data.path);
        expect(childPaths).toEqual(['zeta', 'alpha']);
    });
});
