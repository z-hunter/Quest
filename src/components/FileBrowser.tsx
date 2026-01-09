import React, { useState, useEffect } from 'react';

interface FileBrowserProps {
    mode: 'save' | 'load';
    directory: string; // e.g., 'public/scenes'
    defaultFilename?: string;
    onConfirm: (filename: string) => void;
    onCancel: () => void;
    title?: string;
    extension?: string;
}

export const FileBrowser: React.FC<FileBrowserProps> = ({ mode, directory, defaultFilename = '', onConfirm, onCancel, title, extension = '.json' }) => {
    // Current Path State
    const [currentPath, setCurrentPath] = useState(directory);
    // Files State
    const [items, setItems] = useState<{ name: string, isDir: boolean }[]>([]);

    // Selection
    const [filename, setFilename] = useState(defaultFilename);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // Initial Path Sync
    useEffect(() => {
        setCurrentPath(directory);
    }, [directory]);

    // Fetch when currentPath changes
    useEffect(() => {
        setIsLoading(true);
        fetch('/api/list', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: currentPath })
        })
            .then(res => res.json())
            .then(data => {
                if (data.files) {
                    setItems(data.files);
                } else {
                    setError('Failed to list files');
                }
                setIsLoading(false);
            })
            .catch(err => {
                setError(String(err));
                setIsLoading(false);
            });
    }, [currentPath]);

    // Derived: Can we go up?
    const canGoUp = currentPath.replace(/\\/g, '/') !== 'public';

    // Combine items for unified rendering and navigation
    const displayItems = React.useMemo(() => {
        const list: { name: string, isDir: boolean, isUp?: boolean }[] = [];
        if (canGoUp) {
            list.push({ name: '..', isDir: true, isUp: true });
        }
        return list.concat(items);
    }, [items, canGoUp]);

    // Selection Index for Keyboard Navigation
    const [selectedIndex, setSelectedIndex] = useState(0);
    const listRef = React.useRef<HTMLDivElement>(null);
    const itemRefs = React.useRef<(HTMLDivElement | null)[]>([]);

    // Reset selection when path changes
    useEffect(() => {
        setSelectedIndex(0);
        if (listRef.current) listRef.current.scrollTop = 0;
    }, [currentPath]);

    // Scroll into view when selection changes
    useEffect(() => {
        const el = itemRefs.current[selectedIndex];
        if (el && listRef.current) {
            const container = listRef.current;
            const elTop = el.offsetTop;
            const elBottom = elTop + el.offsetHeight;
            const cTop = container.scrollTop;
            const cBottom = cTop + container.clientHeight;

            if (elTop < cTop) {
                container.scrollTop = elTop;
            } else if (elBottom > cBottom) {
                container.scrollTop = elBottom - container.clientHeight;
            }
        }

        // Sync filename if it's a file
        const item = displayItems[selectedIndex];
        if (item && !item.isDir) {
            handleSelect(item);
        }
    }, [selectedIndex, displayItems]);

    const handleConfirm = () => {
        if (!filename) return;
        let finalName = filename;

        // Handle comma-separated extensions (e.g. ".mp3,.wav")
        const allowedExtensions = extension.split(',').map(e => e.trim().toLowerCase()).filter(e => e);

        let hasValidExt = false;
        for (const ext of allowedExtensions) {
            if (finalName.toLowerCase().endsWith(ext)) {
                hasValidExt = true;
                break;
            }
        }

        // If no valid extension found, append the first one (default behavior)
        // But only if we have strict extensions defined.
        if (!hasValidExt && allowedExtensions.length > 0) {
            finalName += allowedExtensions[0];
        }

        const exists = items.some(i => !i.isDir && i.name === finalName);
        if (mode === 'save' && exists) {
            if (!confirm(`Overwrite ${finalName}?`)) {
                return;
            }
        }

        let resultPath = finalName;
        // Relative path logic
        const base = directory.replace(/\\/g, '/');
        const curr = currentPath.replace(/\\/g, '/');

        if (curr !== base && curr.startsWith(base)) {
            const relDir = curr.substring(base.length + 1);
            if (relDir) resultPath = `${relDir}/${finalName}`;
        } else if (curr !== base) {
            // Up logic fallback
            if (curr.startsWith(base)) {
                const diff = curr.substring(base.length);
                if (diff.startsWith('/') || diff.startsWith('\\')) {
                    resultPath = diff.substring(1) + '/' + finalName;
                } else if (diff) {
                    resultPath = diff + '/' + finalName;
                }
            } else {
                const baseParts = base.split('/').filter(x => x);
                const currParts = curr.split('/').filter(x => x);
                let i = 0;
                while (i < baseParts.length && i < currParts.length && baseParts[i] === currParts[i]) i++;
                const upSteps = baseParts.length - i;
                const downSteps = currParts.slice(i);
                const relParts = [];
                for (let j = 0; j < upSteps; j++) relParts.push('..');
                relParts.push(...downSteps);
                relParts.push(finalName);
                resultPath = relParts.join('/');
            }
        }
        onConfirm(resultPath);
    };

    const handleUp = () => {
        const normalized = currentPath.replace(/\\/g, '/');
        if (normalized === 'public' || normalized === 'public/') return;
        const parts = normalized.split('/');
        if (parts.length > 1) {
            parts.pop();
            setCurrentPath(parts.join('/'));
        }
    };

    // Action wrappers for list interaction
    const handleSelect = (item: { name: string, isDir: boolean }) => {
        if (!item.isDir) setFilename(item.name);
    };

    const handleDoubleClick = (item: { name: string, isDir: boolean }) => {
        if (item.isDir) {
            setCurrentPath(prev => `${prev}/${item.name}`.replace('//', '/'));
            setFilename('');
        } else {
            setFilename(item.name);
            setTimeout(() => handleConfirm(), 0);
        }
    };

    const handleListKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            setSelectedIndex(prev => Math.min(prev + 1, displayItems.length - 1));
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setSelectedIndex(prev => Math.max(prev - 1, 0));
        } else if (e.key === 'Enter') {
            e.preventDefault();
            const item = displayItems[selectedIndex];
            if (item) {
                if (item.isUp) handleUp();
                else handleDoubleClick(item);
            }
        }
    };

    // Focus Trap & Esc Key
    const modalRef = React.useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                onCancel();
                return;
            }
            if (e.key === 'Tab' && modalRef.current) {
                const focusableElements = modalRef.current.querySelectorAll(
                    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
                );
                if (focusableElements.length === 0) return;
                const firstElement = focusableElements[0] as HTMLElement;
                const lastElement = focusableElements[focusableElements.length - 1] as HTMLElement;
                if (e.shiftKey) {
                    if (document.activeElement === firstElement) {
                        e.preventDefault();
                        lastElement.focus();
                    }
                } else {
                    if (document.activeElement === lastElement) {
                        e.preventDefault();
                        firstElement.focus();
                    }
                }
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [onCancel]);

    return (
        <div className="modal-overlay" style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.8)', zIndex: 10000,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontFamily: 'monospace', color: 'var(--ui-main-color)'
        }}>
            <div ref={modalRef} className="file-browser" style={{
                width: '500px', maxWidth: '95vw',
                height: '600px', maxHeight: '90vh',
                backgroundColor: '#000',
                border: '2px solid var(--ui-main-color)', display: 'flex', flexDirection: 'column',
                padding: '10px'
            }}>
                <div className="browser-header" style={{ borderBottom: '1px solid var(--ui-main-color)', marginBottom: '10px', paddingBottom: '5px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px' }}>
                        <h3 style={{ margin: 0 }}>{title || (mode === 'save' ? 'Save File' : 'Load File')}</h3>
                        <span style={{ fontSize: '12px', color: '#888' }}>{currentPath}</span>
                    </div>
                    <button
                        onClick={() => {
                            fetch('/api/open-folder', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ path: currentPath })
                            });
                        }}
                        title="Open in System Explorer"
                        style={{
                            background: 'transparent', border: '1px solid var(--ui-btn-border)', color: 'var(--ui-btn-text)', cursor: 'pointer',
                            fontSize: '12px', padding: '2px 6px', marginLeft: '10px'
                        }}
                    >
                        📂 Open Folder
                    </button>
                </div>

                <div
                    className="file-list"
                    ref={listRef}
                    tabIndex={0}
                    onKeyDown={handleListKeyDown}
                    style={{ flex: 1, overflowY: 'auto', border: '1px solid #333', marginBottom: '10px', outline: 'none', position: 'relative' }}
                >
                    {isLoading && <div>Loading...</div>}
                    {error && <div style={{ color: 'red' }}>Error: {error}</div>}

                    {!isLoading && !error && displayItems.map((item, index) => {
                        const isSelected = index === selectedIndex;
                        return (
                            <div
                                key={item.name + (item.isUp ? '_up' : '')}
                                ref={el => { itemRefs.current[index] = el; }}
                                onClick={() => {
                                    setSelectedIndex(index);
                                    if (item.isUp) return;
                                    handleSelect(item);
                                }}
                                onDoubleClick={() => {
                                    if (item.isUp) handleUp();
                                    else handleDoubleClick(item);
                                }}
                                style={{
                                    padding: '5px',
                                    cursor: 'pointer',
                                    backgroundColor: isSelected ? 'var(--ui-selection-bg)' : 'transparent',
                                    color: item.isDir ? '#ffff00' : (isSelected ? 'var(--ui-selection-text)' : 'var(--ui-main-color)'),
                                    border: isSelected ? '1px solid var(--ui-selection-bg)' : '1px solid transparent'
                                }}
                            >
                                {item.isDir ? '📁' : '📄'} {item.name}
                            </div>
                        );
                    })}
                    {!isLoading && displayItems.length === 0 && <div style={{ color: '#666', padding: '5px' }}>Directory is empty</div>}
                </div>

                <div className="browser-footer">
                    <div style={{ display: 'flex', marginBottom: '10px' }}>
                        <label style={{ width: '60px' }}>Name:</label>
                        <input
                            type="text"
                            value={filename}
                            onChange={e => setFilename(e.target.value)}
                            style={{ flex: 1, backgroundColor: '#222', color: '#fff', border: '1px solid #666' }}
                            autoFocus
                        />
                    </div>
                    <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
                        <button onClick={onCancel} style={{ padding: '5px 15px', cursor: 'pointer', background: '#333', color: '#fff', border: '1px solid #666' }}>Cancel</button>
                        <button onClick={handleConfirm} style={{ padding: '5px 15px', cursor: 'pointer', background: 'var(--ui-selection-bg)', color: 'var(--ui-selection-text)', border: '1px solid var(--ui-main-color)' }}>
                            {mode === 'save' ? 'Save' : 'Load'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};
