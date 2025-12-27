/*
 * Notebook Navigator - Plugin for Obsidian
 * Copyright (c) 2025-2026 Johan Sanneblad
 * SPDX-License-Identifier: LicenseRef-NotebookNavigator
 *
 * Licensed under the Notebook Navigator License Agreement (see LICENSE).
 */

import { useListPaneTitle } from '../hooks/useListPaneTitle';

interface ListPaneTitleAreaProps {
    isVisible: boolean;
}

export function ListPaneTitleArea({ isVisible }: ListPaneTitleAreaProps) {
    const { desktopTitle } = useListPaneTitle();

    if (!isVisible) {
        return null;
    }

    return (
        <div className="nn-list-title-area">
            <div className="nn-list-title-content">
                <span className="nn-list-title-text">{desktopTitle}</span>
            </div>
        </div>
    );
}
