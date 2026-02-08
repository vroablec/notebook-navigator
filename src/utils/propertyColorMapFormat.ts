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

import { casefold } from './recordUtils';

interface PropertyColorMapKeyParts {
    propertyKey: string;
    valueKey: string | null;
}

function normalizePropertyColorMapKeyPart(input: string): string {
    const trimmed = input.trim();
    if (!trimmed) {
        return '';
    }

    const unquoted = tryUnquoteQuotedText(trimmed);
    return casefold(unquoted ?? trimmed);
}

/** Parses a property color key into normalized property/value parts */
export function parsePropertyColorMapKey(input: string): PropertyColorMapKeyParts | null {
    const trimmed = input.trim();
    if (!trimmed) {
        return null;
    }

    const unquoted = tryUnquoteQuotedText(trimmed) ?? trimmed;
    const separatorIndex = findPropertyColorMapKeyValueSeparatorIndex(unquoted);
    if (separatorIndex === -1) {
        const propertyKey = normalizePropertyColorMapKeyPart(unquoted);
        if (!propertyKey) {
            return null;
        }
        return { propertyKey, valueKey: null };
    }

    // The first unquoted ":" defines the property/value split for this grammar.
    // Literal ":" in property names are not represented separately in map keys.
    const propertyKey = normalizePropertyColorMapKeyPart(unquoted.slice(0, separatorIndex));
    const valueKey = normalizePropertyColorMapKeyPart(unquoted.slice(separatorIndex + 1));
    if (!propertyKey || !valueKey) {
        return null;
    }

    return { propertyKey, valueKey };
}

/** Normalizes a property color map key and canonicalizes `property:value` entries */
export function normalizePropertyColorMapKey(input: string): string {
    const parsed = parsePropertyColorMapKey(input);
    if (!parsed) {
        // Invalid key grammar is treated as absent and removed when records are normalized.
        return '';
    }

    if (parsed.valueKey) {
        return `${parsed.propertyKey}:${parsed.valueKey}`;
    }

    return parsed.propertyKey;
}

/** Builds a normalized map key from separate property and optional value inputs */
export function buildPropertyColorMapKey(propertyInput: string, valueInput: string | null | undefined): string {
    const propertyKey = normalizePropertyColorMapKeyPart(propertyInput);
    if (!propertyKey) {
        return '';
    }

    const valueKey = typeof valueInput === 'string' ? normalizePropertyColorMapKeyPart(valueInput) : '';
    if (!valueKey) {
        return propertyKey;
    }

    return `${propertyKey}:${valueKey}`;
}

/** Resolves a color from the map using property:value first, then property */
export function resolvePropertyColorMapColor(map: Record<string, string>, propertyInput: string, valueInput: string): string | undefined {
    const propertyKey = normalizePropertyColorMapKeyPart(propertyInput);
    if (!propertyKey) {
        return undefined;
    }

    const valueKey = normalizePropertyColorMapKeyPart(valueInput);
    if (valueKey) {
        const valueColor = map[`${propertyKey}:${valueKey}`];
        if (typeof valueColor === 'string') {
            const trimmedValueColor = valueColor.trim();
            if (trimmedValueColor.length > 0) {
                return trimmedValueColor;
            }
        }
    }

    const propertyColor = map[propertyKey];
    if (typeof propertyColor !== 'string') {
        return undefined;
    }

    const trimmedPropertyColor = propertyColor.trim();
    if (trimmedPropertyColor.length === 0) {
        return undefined;
    }

    return trimmedPropertyColor;
}

interface NormalizedPropertyColorMapEntry {
    key: string;
    color: string;
}

export interface PropertyColorMapParseResult {
    map: Record<string, string>;
    invalidLines: string[];
}

function normalizePropertyColorMapEntry(
    key: string,
    color: string,
    normalizeKey: (input: string) => string
): NormalizedPropertyColorMapEntry | null {
    const normalizedKey = normalizeKey(key);
    if (!normalizedKey) {
        return null;
    }

    const trimmedColor = color.trim();
    if (!trimmedColor) {
        return null;
    }

    return { key: normalizedKey, color: trimmedColor };
}

export function normalizePropertyColorMapRecord(
    record: Record<string, string>,
    normalizeKey: (input: string) => string
): Record<string, string> {
    const normalized = Object.create(null) as Record<string, string>;

    Object.entries(record).forEach(([key, value]) => {
        if (typeof value !== 'string') {
            return;
        }

        const normalizedEntry = normalizePropertyColorMapEntry(key, value, normalizeKey);
        if (!normalizedEntry) {
            return;
        }

        normalized[normalizedEntry.key] = normalizedEntry.color;
    });

    return normalized;
}

export function serializePropertyColorMapRecord(map: Record<string, string>): string {
    const entries = Object.entries(map)
        .filter(([key, color]) => Boolean(key) && Boolean(color))
        .sort(([a], [b]) => a.localeCompare(b));

    return entries
        .map(([key, color]) => {
            const serializedKey = shouldQuotePropertyColorMapKey(key) ? `'${escapeSingleQuotedText(key)}'` : key;
            return `${serializedKey}=${color}`;
        })
        .join('\n');
}

export function parsePropertyColorMapText(value: string, normalizeKey: (input: string) => string): PropertyColorMapParseResult {
    const map = Object.create(null) as Record<string, string>;
    const invalidLines: string[] = [];

    const lines = value.replace(/\r\n/g, '\n').split('\n');
    for (let i = 0; i < lines.length; i++) {
        const rawLine = lines[i];
        const trimmed = rawLine.trim();

        if (!trimmed || trimmed.startsWith('#')) {
            continue;
        }

        const splitIndex = findPropertyColorMapSeparatorIndex(trimmed);
        if (splitIndex === -1) {
            invalidLines.push(trimmed);
            continue;
        }

        const rawKey = trimmed.substring(0, splitIndex).trim();
        const rawColor = trimmed.substring(splitIndex + 1).trim();

        const normalizedEntry = normalizePropertyColorMapEntry(rawKey, rawColor, normalizeKey);
        if (!normalizedEntry) {
            invalidLines.push(trimmed);
            continue;
        }

        map[normalizedEntry.key] = normalizedEntry.color;
    }

    return { map, invalidLines };
}

/** Returns true if the key needs to be wrapped in single quotes for serialization */
function shouldQuotePropertyColorMapKey(key: string): boolean {
    return /\s/.test(key) || key.startsWith('#') || key.includes('=');
}

/** Escapes backslashes and single quotes for embedding in a single-quoted string */
function escapeSingleQuotedText(value: string): string {
    return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function tryUnquoteQuotedText(value: string): string | null {
    if (value.length < 2) {
        return null;
    }

    const quote = value[0];
    if (quote !== "'" && quote !== '"') {
        return null;
    }

    if (value[value.length - 1] !== quote) {
        return null;
    }

    return unescapeQuotedText(value.slice(1, -1), quote);
}

function unescapeQuotedText(value: string, quote: "'" | '"'): string {
    let result = '';
    for (let i = 0; i < value.length; i++) {
        const ch = value[i];
        if (ch === '\\' && i + 1 < value.length) {
            const next = value[i + 1];
            if (next === quote || next === '\\') {
                result += next;
                i += 1;
                continue;
            }
        }
        result += ch;
    }
    return result;
}

function findPropertyColorMapSeparatorIndex(value: string): number {
    // Mapping lines require "=" between key and color.
    return findFirstUnquotedCharacterIndex(value, ch => ch === '=');
}

function findPropertyColorMapKeyValueSeparatorIndex(value: string): number {
    return findFirstUnquotedCharacterIndex(value, ch => ch === ':');
}

function findFirstUnquotedCharacterIndex(value: string, matcher: (ch: string) => boolean): number {
    let activeQuote: "'" | '"' | null = null;

    for (let i = 0; i < value.length; i++) {
        const ch = value[i];

        if (activeQuote) {
            if (ch === '\\') {
                i += 1;
                continue;
            }

            if (ch === activeQuote) {
                activeQuote = null;
            }
            continue;
        }

        if (ch === "'" || ch === '"') {
            activeQuote = ch;
            continue;
        }

        if (matcher(ch)) {
            return i;
        }
    }

    return -1;
}
