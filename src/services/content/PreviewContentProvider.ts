/*
 * Notebook Navigator - Plugin for Obsidian
 * Copyright (c) 2025-2026 Johan Sanneblad
 * SPDX-License-Identifier: LicenseRef-NotebookNavigator
 *
 * Licensed under the Notebook Navigator License Agreement (see LICENSE).
 */

import { TFile } from 'obsidian';
import { ContentType } from '../../interfaces/IContentProvider';
import { NotebookNavigatorSettings } from '../../settings';
import { FileData } from '../../storage/IndexedDBStorage';
import { getDBInstance } from '../../storage/fileOperations';
import { PreviewTextUtils } from '../../utils/previewTextUtils';
import { BaseContentProvider } from './BaseContentProvider';

/**
 * Content provider for generating file preview text
 */
export class PreviewContentProvider extends BaseContentProvider {
    getContentType(): ContentType {
        return 'preview';
    }

    getRelevantSettings(): (keyof NotebookNavigatorSettings)[] {
        return ['showFilePreview', 'skipHeadingsInPreview', 'skipCodeBlocksInPreview', 'stripHtmlInPreview', 'previewProperties'];
    }

    shouldRegenerate(oldSettings: NotebookNavigatorSettings, newSettings: NotebookNavigatorSettings): boolean {
        // Clear if preview is disabled
        if (!newSettings.showFilePreview && oldSettings.showFilePreview) {
            return true;
        }

        // Regenerate if preview is enabled and settings changed
        if (newSettings.showFilePreview) {
            return (
                oldSettings.showFilePreview !== newSettings.showFilePreview ||
                oldSettings.skipHeadingsInPreview !== newSettings.skipHeadingsInPreview ||
                oldSettings.skipCodeBlocksInPreview !== newSettings.skipCodeBlocksInPreview ||
                oldSettings.stripHtmlInPreview !== newSettings.stripHtmlInPreview ||
                JSON.stringify(oldSettings.previewProperties) !== JSON.stringify(newSettings.previewProperties)
            );
        }

        return false;
    }

    async clearContent(): Promise<void> {
        const db = getDBInstance();
        await db.batchClearAllFileContent('preview');
    }

    protected needsProcessing(fileData: FileData | null, file: TFile, settings: NotebookNavigatorSettings): boolean {
        if (!settings.showFilePreview || file.extension !== 'md') {
            return false;
        }

        // Skip Excalidraw files
        const metadata = this.app.metadataCache.getFileCache(file);
        if (PreviewTextUtils.isExcalidrawFile(file.name, metadata?.frontmatter)) {
            return false;
        }

        const fileModified = fileData !== null && fileData.mtime !== file.stat.mtime;
        return !fileData || fileData.preview === null || fileModified;
    }

    protected async processFile(
        job: { file: TFile; path: string[] },
        fileData: FileData | null,
        settings: NotebookNavigatorSettings
    ): Promise<{
        path: string;
        tags?: string[] | null;
        preview?: string;
        featureImage?: string;
        metadata?: FileData['metadata'];
    } | null> {
        if (!settings.showFilePreview || job.file.extension !== 'md') {
            return null;
        }

        try {
            const metadata = this.app.metadataCache.getFileCache(job.file);

            // Skip Excalidraw files - return empty preview
            if (PreviewTextUtils.isExcalidrawFile(job.file.name, metadata?.frontmatter)) {
                return {
                    path: job.file.path,
                    preview: ''
                };
            }

            const content = await this.app.vault.cachedRead(job.file);
            const previewText = PreviewTextUtils.extractPreviewText(content, settings, metadata?.frontmatter);

            // Only return update if preview changed
            if (fileData && fileData.preview === previewText) {
                return null;
            }

            return {
                path: job.file.path,
                preview: previewText
            };
        } catch (error) {
            console.error(`Error generating preview for ${job.file.path}:`, error);
            return null;
        }
    }
}
