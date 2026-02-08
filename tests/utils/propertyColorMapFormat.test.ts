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

import { describe, it, expect } from 'vitest';
import {
    buildPropertyColorMapKey,
    normalizePropertyColorMapKey,
    parsePropertyColorMapKey,
    parsePropertyColorMapText,
    resolvePropertyColorMapColor,
    serializePropertyColorMapRecord
} from '../../src/utils/propertyColorMapFormat';

describe('propertyColorMapFormat', () => {
    it('parses single-quoted keys', () => {
        const result = parsePropertyColorMapText("'Due date'=#ff0000", normalizePropertyColorMapKey);
        expect(result.invalidLines).toEqual([]);
        expect(Object.entries(result.map)).toEqual([['due date', '#ff0000']]);
    });

    it('parses double-quoted keys', () => {
        const result = parsePropertyColorMapText('"Due date"=#ff0000', normalizePropertyColorMapKey);
        expect(result.invalidLines).toEqual([]);
        expect(Object.entries(result.map)).toEqual([['due date', '#ff0000']]);
    });

    it('unescapes quotes inside quoted keys', () => {
        const singleQuoted = parsePropertyColorMapText("'Due\\'s'=#ff0000", normalizePropertyColorMapKey);
        expect(singleQuoted.invalidLines).toEqual([]);
        expect(Object.entries(singleQuoted.map)).toEqual([["due's", '#ff0000']]);

        const doubleQuoted = parsePropertyColorMapText('"a\\"b"=#ff0000', normalizePropertyColorMapKey);
        expect(doubleQuoted.invalidLines).toEqual([]);
        expect(Object.entries(doubleQuoted.map)).toEqual([['a"b', '#ff0000']]);
    });

    it('roundtrips serialized keys with spaces', () => {
        const serialized = serializePropertyColorMapRecord({ 'due date': '#ff0000' });
        const parsed = parsePropertyColorMapText(serialized, normalizePropertyColorMapKey);

        expect(parsed.invalidLines).toEqual([]);
        expect(Object.entries(parsed.map)).toEqual([['due date', '#ff0000']]);
    });

    it('normalizes property:value keys with trim and casefold', () => {
        expect(normalizePropertyColorMapKey(' Status : Active ')).toBe('status:active');
    });

    it('parses property:value keys into normalized parts', () => {
        const parsed = parsePropertyColorMapKey(' Status : Active ');
        expect(parsed).toEqual({
            propertyKey: 'status',
            valueKey: 'active'
        });
    });

    it('parses quoted property:value keys with spaces', () => {
        const parsed = parsePropertyColorMapText("'status:In progress'=#f59e0b", normalizePropertyColorMapKey);
        expect(parsed.invalidLines).toEqual([]);
        expect(Object.entries(parsed.map)).toEqual([['status:in progress', '#f59e0b']]);
    });

    it('parses property:value mappings from text area input', () => {
        const parsed = parsePropertyColorMapText('status:active=#ff0000', normalizePropertyColorMapKey);
        expect(parsed.invalidLines).toEqual([]);
        expect(Object.entries(parsed.map)).toEqual([['status:active', '#ff0000']]);
    });

    it('requires "=" as key/color separator in text area input', () => {
        const parsed = parsePropertyColorMapText('status:done:#ff0000', normalizePropertyColorMapKey);
        expect(parsed.invalidLines).toEqual(['status:done:#ff0000']);
        expect(Object.entries(parsed.map)).toEqual([]);
    });

    it('builds property-only key when value is empty', () => {
        expect(buildPropertyColorMapKey('status', '   ')).toBe('status');
    });

    it('drops keys with invalid property:value grammar during normalization', () => {
        expect(normalizePropertyColorMapKey('status:')).toBe('');
    });

    it('resolves property:value color before property fallback', () => {
        const map = {
            status: '#999999',
            'status:active': '#ff0000'
        };

        expect(resolvePropertyColorMapColor(map, 'Status', 'Active')).toBe('#ff0000');
        expect(resolvePropertyColorMapColor(map, 'Status', 'Finished')).toBe('#999999');
    });

    it('roundtrips keys containing "=" characters', () => {
        const serialized = serializePropertyColorMapRecord({ 'status:a=b': '#ff0000' });
        const parsed = parsePropertyColorMapText(serialized, normalizePropertyColorMapKey);

        expect(parsed.invalidLines).toEqual([]);
        expect(Object.entries(parsed.map)).toEqual([['status:a=b', '#ff0000']]);
    });
});
