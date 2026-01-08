/*
 * Notebook Navigator - Plugin for Obsidian
 * Copyright (c) 2025 Johan Sanneblad
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

import type { CachedMetadata, FrontMatterCache, TFile } from 'obsidian';
import { type ContentProviderType } from '../../interfaces/IContentProvider';
import { NotebookNavigatorSettings } from '../../settings';
import { FileData } from '../../storage/IndexedDBStorage';
import { getDBInstance } from '../../storage/fileOperations';
import { getCachedCommaSeparatedList } from '../../utils/commaSeparatedListUtils';
import { isCustomPropertyEnabled } from '../../utils/customPropertyUtils';
import { PreviewTextUtils } from '../../utils/previewTextUtils';
import type { ContentProviderProcessResult } from './BaseContentProvider';
import { findFeatureImageReference, type FeatureImageReference } from './featureImageReferenceResolver';
import { FeatureImageContentProvider } from './FeatureImageContentProvider';

type MarkdownPipelineContext = {
    file: TFile;
    fileData: FileData | null;
    settings: NotebookNavigatorSettings;
    content: string;
    frontmatter: FrontMatterCache | null;
    bodyStartIndex: number;
    isExcalidraw: boolean;
    fileModified: boolean;
    customPropertyEnabled: boolean;
    customPropertyFrontmatterFields: readonly string[];
    hasContent: boolean;
    featureImageReference: FeatureImageReference | null;
};

type MarkdownPipelineUpdate = {
    preview?: string;
    customProperty?: string | null;
    featureImageKey?: string | null;
    featureImage?: Blob | null;
};

type MarkdownPipelineProcessorId = 'preview' | 'customProperty' | 'featureImage';

type MarkdownPipelineProcessor = {
    id: MarkdownPipelineProcessorId;
    needsProcessing: (context: MarkdownPipelineContext) => boolean;
    run: (context: MarkdownPipelineContext) => Promise<MarkdownPipelineUpdate | null>;
};

function resolveMarkdownBodyStartIndex(metadata: CachedMetadata, content: string): number {
    const rawOffset = metadata.frontmatterPosition?.end?.offset;
    if (typeof rawOffset !== 'number' || rawOffset <= 0) {
        return 0;
    }

    let index = Math.min(Math.max(0, rawOffset), content.length);

    while (index < content.length) {
        const char = content[index];
        if (char !== '\n' && char !== '\r') {
            break;
        }
        index += 1;
    }

    return index;
}

// Characters that count individually - NOT in Obsidian's gF letter class
// Tibetan, Hiragana, Katakana, CJK Ideographs each count as 1 word
// Korean Hangul IS in gF and forms words, so not listed here
const INDIVIDUAL_CHARS =
    '\u0F00\u0F40-\u0F47\u0F49-\u0F6C\u0F88-\u0F8C' + // Tibetan
    '\u3041-\u3096\u309D-\u309F' + // Hiragana
    '\u30A1-\u30FA\u30FC-\u30FF' + // Katakana
    '\u4E00-\u9FD5'; // CJK Ideographs

// CJK_SINGLE_CHARS for the pattern alternation (includes Korean for completeness)
const CJK_SINGLE_CHARS =
    '\u0F00\u0F40-\u0F47\u0F49-\u0F6C\u0F88-\u0F8C' + // Tibetan
    '\u3041-\u3096\u309D-\u309F' + // Hiragana
    '\u30A1-\u30FA\u30FC-\u30FF' + // Katakana
    '\u4E00-\u9FD5' + // CJK Ideographs
    '\uAC00-\uD7A3\uA960-\uA97C\uD7B0-\uD7C6'; // Korean Hangul

// Pattern matches Obsidian's word counting behavior:
// 1. Numbers with separators (1,000 or 3.14) grouped with adjacent letters (GPT-5.2)
// 2. Letters with hyphens/apostrophes (don't, mother-in-law)
// 3. CJK characters counted individually via separate alternation
// Apostrophe variants: ' (U+0027), ' (U+2018), ' (U+2019)
// Note: \p{L} includes CJK, but we post-process to split them out
const WORD_PATTERN = new RegExp(`(?:[0-9]+(?:[,.][0-9]+)*|[\\-'\\u2018\\u2019\\p{L}]+)+|[${CJK_SINGLE_CHARS}]`, 'gu');

// Test if match contains characters that should be counted individually
const CONTAINS_INDIVIDUAL = new RegExp(`[${INDIVIDUAL_CHARS}]`);
// Match individual characters (global) for splitting
const MATCH_INDIVIDUAL_GLOBAL = new RegExp(`[${INDIVIDUAL_CHARS}]`, 'g');
// Test for word-forming content (letters or numbers)
const WORD_CONTENT = /[\p{L}0-9]/u;

// Mathematical Alphanumeric Symbols (U+1D400-U+1D7FF) - styled letters/digits
const MATH_ALPHANUMERIC_PATTERN = /[\u{1D400}-\u{1D7FF}]/u;
// Pattern to strip Math Alphanumeric chars (global flag for replace)
const MATH_ALPHANUMERIC_GLOBAL = /[\u{1D400}-\u{1D7FF}]/gu;
// Punctuation that counts as words when isolated from Math Bold text
// Matches Obsidian's behavior where BMP-only letter class leaves punctuation orphaned
const ISOLATED_PUNCT_PATTERN = /[-'\u2018\u2019]/g;

function countWords(content: string, startIndex: number): number {
    const text = startIndex > 0 ? content.slice(startIndex) : content;
    const matches = text.match(WORD_PATTERN);
    if (!matches) return 0;

    let count = 0;
    for (const m of matches) {
        if (MATH_ALPHANUMERIC_PATTERN.test(m)) {
            // Contains Math Bold - Obsidian's BMP-only pattern wouldn't match the Math Bold
            // letters, but would match punctuation (hyphens, apostrophes) as separate words.
            const stripped = m.replace(MATH_ALPHANUMERIC_GLOBAL, '');
            const punct = stripped.match(ISOLATED_PUNCT_PATTERN);
            if (punct) {
                count += punct.length;
            }
        } else if (CONTAINS_INDIVIDUAL.test(m)) {
            // Contains CJK/Tibetan/Hiragana/Katakana that should be counted individually
            // Split the match: each individual char = 1 word, each non-individual run = 1 word
            count += countWithIndividualChars(m);
        } else {
            // Regular word - count as 1
            count += 1;
        }
    }
    return count;
}

// Counts a match containing individual characters (CJK ideographs, Hiragana, Katakana, Tibetan)
// Each individual char counts as 1 word, each non-individual run counts as 1 word
// Example: "HunyuanOCR开源模型" -> ["HunyuanOCR", "开", "源", "模", "型"] = 5 words
function countWithIndividualChars(match: string): number {
    let count = 0;
    let lastEnd = 0;

    for (const charMatch of match.matchAll(MATCH_INDIVIDUAL_GLOBAL)) {
        const start = charMatch.index ?? 0;
        if (start > lastEnd) {
            // Non-individual run before this char - count as 1 word if it has word content
            const run = match.slice(lastEnd, start);
            if (WORD_CONTENT.test(run)) {
                count += 1;
            }
        }
        count += 1; // Each individual char counts as 1 word
        lastEnd = start + charMatch[0].length;
    }

    // Check for trailing non-individual content
    if (lastEnd < match.length) {
        const trailing = match.slice(lastEnd);
        if (WORD_CONTENT.test(trailing)) {
            count += 1;
        }
    }

    return count;
}

function formatFrontmatterValue(value: unknown): string | null {
    if (typeof value === 'string') {
        const trimmed = value.trim();
        return trimmed.length > 0 ? trimmed : null;
    }

    if (typeof value === 'number') {
        if (!Number.isFinite(value)) {
            return null;
        }
        return value.toString();
    }

    if (typeof value === 'boolean') {
        return value ? 'true' : 'false';
    }

    if (Array.isArray(value)) {
        const parts: string[] = [];
        for (const entry of value) {
            const formatted = formatFrontmatterValue(entry);
            if (formatted) {
                parts.push(formatted);
            }
        }
        const joined = parts.join(', ');
        return joined.length > 0 ? joined : null;
    }

    return null;
}

function resolveCustomPropertyFromFrontmatter(frontmatter: FrontMatterCache | null, fields: readonly string[]): string {
    if (!frontmatter) {
        return '';
    }

    for (const field of fields) {
        const formatted = formatFrontmatterValue(frontmatter[field]);
        if (formatted) {
            return formatted;
        }
    }

    return '';
}

export class MarkdownPipelineContentProvider extends FeatureImageContentProvider {
    protected readonly PARALLEL_LIMIT: number = 10;

    private readonly processors: MarkdownPipelineProcessor[] = [
        {
            id: 'preview',
            needsProcessing: context => {
                return (
                    context.settings.showFilePreview &&
                    (!context.fileData || context.fileModified || context.fileData.previewStatus === 'unprocessed') &&
                    (context.hasContent || context.isExcalidraw)
                );
            },
            run: async context => await this.processPreview(context)
        },
        {
            id: 'customProperty',
            needsProcessing: context => {
                if (!context.customPropertyEnabled) {
                    return false;
                }

                const needsContent = context.settings.customPropertyType === 'wordCount' && !context.isExcalidraw;

                return (
                    (!context.fileData || context.fileModified || context.fileData.customProperty === null) &&
                    (!needsContent || context.hasContent)
                );
            },
            run: async context => await this.processCustomProperty(context)
        },
        {
            id: 'featureImage',
            needsProcessing: context => {
                if (!context.settings.showFeatureImage) {
                    return false;
                }

                if (!context.isExcalidraw && !context.featureImageReference && !context.hasContent) {
                    return false;
                }

                return (
                    !context.fileData ||
                    context.fileModified ||
                    context.fileData.featureImageKey === null ||
                    context.fileData.featureImageStatus === 'unprocessed'
                );
            },
            run: async context => await this.processFeatureImage(context)
        }
    ];

    getContentType(): ContentProviderType {
        return 'markdownPipeline';
    }

    getRelevantSettings(): (keyof NotebookNavigatorSettings)[] {
        return [
            'showFilePreview',
            'skipHeadingsInPreview',
            'skipCodeBlocksInPreview',
            'stripHtmlInPreview',
            'previewProperties',
            'showFeatureImage',
            'featureImageProperties',
            'downloadExternalFeatureImages',
            'customPropertyType',
            'customPropertyFrontmatterFields'
        ];
    }

    private getClearFlags(context: { oldSettings: NotebookNavigatorSettings; newSettings: NotebookNavigatorSettings } | undefined): {
        shouldClearPreview: boolean;
        shouldClearCustomProperty: boolean;
        shouldClearFeatureImage: boolean;
    } {
        if (!context) {
            return { shouldClearPreview: true, shouldClearCustomProperty: true, shouldClearFeatureImage: true };
        }

        const { oldSettings, newSettings } = context;

        const shouldClearPreview =
            oldSettings.showFilePreview !== newSettings.showFilePreview ||
            oldSettings.skipHeadingsInPreview !== newSettings.skipHeadingsInPreview ||
            oldSettings.skipCodeBlocksInPreview !== newSettings.skipCodeBlocksInPreview ||
            oldSettings.stripHtmlInPreview !== newSettings.stripHtmlInPreview ||
            JSON.stringify(oldSettings.previewProperties) !== JSON.stringify(newSettings.previewProperties);

        const shouldClearCustomProperty =
            oldSettings.customPropertyType !== newSettings.customPropertyType ||
            (newSettings.customPropertyType === 'frontmatter' &&
                oldSettings.customPropertyFrontmatterFields !== newSettings.customPropertyFrontmatterFields);

        const shouldClearFeatureImage =
            (oldSettings.showFeatureImage && !newSettings.showFeatureImage) ||
            (newSettings.showFeatureImage &&
                (JSON.stringify(oldSettings.featureImageProperties) !== JSON.stringify(newSettings.featureImageProperties) ||
                    oldSettings.downloadExternalFeatureImages !== newSettings.downloadExternalFeatureImages));

        return { shouldClearPreview, shouldClearCustomProperty, shouldClearFeatureImage };
    }

    shouldRegenerate(oldSettings: NotebookNavigatorSettings, newSettings: NotebookNavigatorSettings): boolean {
        const { shouldClearPreview, shouldClearCustomProperty, shouldClearFeatureImage } = this.getClearFlags({
            oldSettings,
            newSettings
        });
        return shouldClearPreview || shouldClearCustomProperty || shouldClearFeatureImage;
    }

    async clearContent(context?: { oldSettings: NotebookNavigatorSettings; newSettings: NotebookNavigatorSettings }): Promise<void> {
        const { shouldClearPreview, shouldClearCustomProperty, shouldClearFeatureImage } = this.getClearFlags(context);

        if (!shouldClearPreview && !shouldClearCustomProperty && !shouldClearFeatureImage) {
            return;
        }

        const db = getDBInstance();

        if (shouldClearPreview) {
            await db.batchClearAllFileContent('preview');
        }

        if (shouldClearCustomProperty) {
            await db.batchClearAllFileContent('customProperty');
        }

        if (shouldClearFeatureImage) {
            await db.batchClearFeatureImageContent('markdown');
        }
    }

    protected needsProcessing(fileData: FileData | null, file: TFile, settings: NotebookNavigatorSettings): boolean {
        if (file.extension !== 'md') {
            return false;
        }

        const customPropertyEnabled = isCustomPropertyEnabled(settings);
        const hasPipelineWork = settings.showFilePreview || settings.showFeatureImage || customPropertyEnabled;
        if (!hasPipelineWork) {
            return false;
        }

        const needsRefresh = fileData !== null && fileData.markdownPipelineMtime !== file.stat.mtime;
        if (!fileData || needsRefresh) {
            return true;
        }

        const needsPreview = settings.showFilePreview && fileData.previewStatus === 'unprocessed';
        const needsFeatureImage =
            settings.showFeatureImage && (fileData.featureImageKey === null || fileData.featureImageStatus === 'unprocessed');
        const needsCustomProperty = customPropertyEnabled && fileData.customProperty === null;

        return needsPreview || needsFeatureImage || needsCustomProperty;
    }

    protected async processFile(
        job: { file: TFile; path: string[] },
        fileData: FileData | null,
        settings: NotebookNavigatorSettings
    ): Promise<ContentProviderProcessResult> {
        if (job.file.extension !== 'md') {
            return { update: null, processed: true };
        }

        const customPropertyFrontmatterFields =
            settings.customPropertyType === 'frontmatter' ? getCachedCommaSeparatedList(settings.customPropertyFrontmatterFields) : [];
        const customPropertyEnabled = isCustomPropertyEnabled(settings);
        const hasPipelineWork = settings.showFilePreview || settings.showFeatureImage || customPropertyEnabled;
        if (!hasPipelineWork) {
            return { update: null, processed: true };
        }

        const cachedMetadata = this.app.metadataCache.getFileCache(job.file);
        if (!cachedMetadata) {
            return { update: null, processed: false };
        }

        const frontmatter = cachedMetadata.frontmatter ?? null;
        const isExcalidraw = PreviewTextUtils.isExcalidrawFile(job.file.name, frontmatter ?? undefined);

        const fileModified = fileData !== null && fileData.markdownPipelineMtime !== job.file.stat.mtime;

        const needsPreview =
            settings.showFilePreview && (!fileData || fileModified || fileData.previewStatus === 'unprocessed') && !isExcalidraw;
        const needsCustomProperty =
            customPropertyEnabled &&
            (!fileData || fileModified || fileData.customProperty === null) &&
            settings.customPropertyType === 'wordCount' &&
            !isExcalidraw;
        const needsFeatureImage =
            settings.showFeatureImage &&
            (!fileData || fileModified || fileData.featureImageKey === null || fileData.featureImageStatus === 'unprocessed') &&
            !isExcalidraw;

        const frontmatterFeatureImageReference =
            needsFeatureImage && frontmatter
                ? findFeatureImageReference({
                      app: this.app,
                      file: job.file,
                      content: '',
                      settings,
                      frontmatter,
                      bodyStartIndex: 0
                  })
                : null;

        const needsContent = needsPreview || needsCustomProperty || (needsFeatureImage && !frontmatterFeatureImageReference);

        const update: {
            path: string;
            preview?: string;
            featureImage?: Blob | null;
            featureImageKey?: string | null;
            customProperty?: string | null;
        } = { path: job.file.path };

        let content: string;
        let hasContent = false;
        let bodyStartIndex = 0;
        try {
            if (needsContent) {
                content = await this.readFileContent(job.file);
                hasContent = true;
                bodyStartIndex = resolveMarkdownBodyStartIndex(cachedMetadata, content);
            } else {
                content = '';
            }
        } catch (error) {
            console.error(`Error reading markdown content for ${job.file.path}:`, error);
            let hasSafeUpdate = false;

            if (customPropertyEnabled && settings.customPropertyType === 'frontmatter') {
                const nextValue = resolveCustomPropertyFromFrontmatter(frontmatter, customPropertyFrontmatterFields);
                if (!fileData || fileData.customProperty !== nextValue) {
                    update.customProperty = nextValue;
                    hasSafeUpdate = true;
                }
            }

            if (needsFeatureImage && frontmatterFeatureImageReference) {
                const featureImageUpdate = await this.processMarkdownFeatureImage({
                    file: job.file,
                    fileData,
                    settings,
                    content: '',
                    frontmatter,
                    bodyStartIndex: 0,
                    isExcalidraw,
                    featureImageReference: frontmatterFeatureImageReference
                });

                if (featureImageUpdate) {
                    update.featureImageKey = featureImageUpdate.featureImageKey;
                    update.featureImage = featureImageUpdate.featureImage;
                    hasSafeUpdate = true;
                }
            }

            if (hasSafeUpdate) {
                return { update, processed: false };
            }

            return { update: null, processed: false };
        }

        const context: MarkdownPipelineContext = {
            file: job.file,
            fileData,
            settings,
            content,
            frontmatter,
            bodyStartIndex,
            isExcalidraw,
            fileModified,
            customPropertyEnabled,
            customPropertyFrontmatterFields,
            hasContent,
            featureImageReference: frontmatterFeatureImageReference
        };

        for (const processor of this.processors) {
            if (!processor.needsProcessing(context)) {
                continue;
            }

            const processorUpdate = await processor.run(context);
            if (!processorUpdate) {
                continue;
            }

            if (processorUpdate.preview !== undefined) {
                update.preview = processorUpdate.preview;
            }
            if (processorUpdate.customProperty !== undefined) {
                update.customProperty = processorUpdate.customProperty;
            }
            if (processorUpdate.featureImageKey !== undefined) {
                update.featureImageKey = processorUpdate.featureImageKey;
            }
            if (processorUpdate.featureImage !== undefined) {
                update.featureImage = processorUpdate.featureImage;
            }
        }

        const hasContentUpdate =
            update.preview !== undefined || update.customProperty !== undefined || update.featureImageKey !== undefined;

        if (hasContentUpdate) {
            return { update, processed: true };
        }

        return { update: null, processed: true };
    }

    private async processPreview(context: MarkdownPipelineContext): Promise<MarkdownPipelineUpdate | null> {
        try {
            const previewText = context.isExcalidraw
                ? ''
                : PreviewTextUtils.extractPreviewText(context.content, context.settings, context.frontmatter ?? undefined);

            if (!context.fileData) {
                return { preview: previewText };
            }

            if (previewText.length === 0 && context.fileData.previewStatus === 'none') {
                return null;
            }

            if (context.fileData.previewStatus === 'has') {
                const db = getDBInstance();
                const cachedPreview = db.getCachedPreviewText(context.file.path);
                if (cachedPreview.length > 0 && cachedPreview === previewText) {
                    return null;
                }
            }

            return { preview: previewText };
        } catch (error) {
            console.error(`Error generating preview for ${context.file.path}:`, error);
            if (!context.fileData || context.fileData.previewStatus === 'unprocessed') {
                return { preview: '' };
            }
            return null;
        }
    }

    private async processCustomProperty(context: MarkdownPipelineContext): Promise<MarkdownPipelineUpdate | null> {
        try {
            let nextValue = '';
            if (context.settings.customPropertyType === 'wordCount') {
                nextValue = context.isExcalidraw ? '' : countWords(context.content, context.bodyStartIndex).toString();
            } else if (context.settings.customPropertyType === 'frontmatter') {
                nextValue = resolveCustomPropertyFromFrontmatter(context.frontmatter, context.customPropertyFrontmatterFields);
            }

            if (!context.fileData || context.fileData.customProperty !== nextValue) {
                return { customProperty: nextValue };
            }

            return null;
        } catch (error) {
            console.error(`Error generating custom property for ${context.file.path}:`, error);
            if (!context.fileData || context.fileData.customProperty === null) {
                return { customProperty: '' };
            }
            return null;
        }
    }

    private async processFeatureImage(context: MarkdownPipelineContext): Promise<MarkdownPipelineUpdate | null> {
        const featureImageUpdate = await this.processMarkdownFeatureImage({
            file: context.file,
            fileData: context.fileData,
            settings: context.settings,
            content: context.content,
            frontmatter: context.frontmatter,
            bodyStartIndex: context.bodyStartIndex,
            isExcalidraw: context.isExcalidraw,
            featureImageReference: context.featureImageReference
        });

        if (!featureImageUpdate) {
            return null;
        }

        return {
            featureImageKey: featureImageUpdate.featureImageKey,
            featureImage: featureImageUpdate.featureImage
        };
    }

    private async processMarkdownFeatureImage(params: {
        file: TFile;
        fileData: FileData | null;
        settings: NotebookNavigatorSettings;
        content: string;
        frontmatter: FrontMatterCache | null;
        bodyStartIndex: number;
        isExcalidraw: boolean;
        featureImageReference: FeatureImageReference | null;
    }): Promise<{ featureImageKey: string; featureImage: Blob } | null> {
        if (params.isExcalidraw) {
            const featureImageKey = this.getExcalidrawFeatureImageKey(params.file);
            if (params.fileData && params.fileData.featureImageKey === featureImageKey) {
                return null;
            }

            const thumbnail = await this.createExcalidrawThumbnail(params.file);
            return {
                featureImageKey,
                featureImage: thumbnail ?? this.createEmptyBlob()
            };
        }

        const reference =
            params.featureImageReference ??
            findFeatureImageReference({
                app: this.app,
                file: params.file,
                content: params.content,
                settings: params.settings,
                frontmatter: params.frontmatter,
                bodyStartIndex: params.bodyStartIndex
            });

        if (!reference) {
            const featureImageKey = '';
            if (params.fileData && params.fileData.featureImageKey === featureImageKey) {
                return null;
            }
            return {
                featureImageKey,
                featureImage: this.createEmptyBlob()
            };
        }

        const featureImageKey = this.getFeatureImageKey(reference);
        const hasStableThumbnail = params.fileData?.featureImageKey === featureImageKey && params.fileData.featureImageStatus === 'has';

        if (hasStableThumbnail) {
            return null;
        }

        try {
            const thumbnail = await this.createThumbnailBlob(reference, params.settings);
            return {
                featureImageKey,
                featureImage: thumbnail ?? this.createEmptyBlob()
            };
        } catch (error) {
            console.error(`Error generating feature image for ${params.file.path}:`, error);
            // Return an empty blob as a durable "attempted" marker so the file doesn't stay `unprocessed` forever.
            return {
                featureImageKey,
                featureImage: this.createEmptyBlob()
            };
        }
    }
}
