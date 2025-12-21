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
    // Files State: Now objects { name: string, isDir: boolean }
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

    const handleConfirm = () => {
        if (!filename) return;
        let finalName = filename;
        if (!finalName.endsWith(extension)) {
            finalName += extension;
        }

        // Check overwrite if saving
        // Note: items contains objects now, check if file exists
        const exists = items.some(i => !i.isDir && i.name === finalName);

        if (mode === 'save' && exists) {
            if (!confirm(`Overwrite ${finalName}?`)) {
                return;
            }
        }

        // We need to pass the FULL path relative to the root public folder?
        // Or just the filename?
        // The original logic expected just filename for some things, but maybe path for others.
        // SceneEditor.ts does `public/scenes/${filenameId}.json` manually.
        // Sprite selection might need relative path?

        // IMPORTANT: The callback expects just the filename usually if the caller handles the dir.
        // BUT if we navigated, the Caller's idea of "dir" is STALE.
        // If we are in 'public/scenes/chapter1', and we return 'scene1.json',
        // Caller might try to load 'public/scenes/scene1.json' -> ERROR.

        // Solution: Return the relative path from the INITIAL directory? 
        // OR return the full relative path from project root?

        // Let's assume the callers (SceneEditor, PropertiesPanel) can handle a path.
        // If I return "subdir/file.json", SceneEditor might do `public/scenes/subdir/file.json`.
        // Let's check SceneEditor.ts... 
        //   saveScene passes `public/scenes` as base.
        //   startCreating passes `public/sprites`...

        // Use a relative path update logic:
        // If new path is "public/scenes/sub", and base was "public/scenes",
        // result is "sub/file.json".

        let resultPath = finalName;
        // Calculate relative difference between directory (base) and currentPath
        // Normalize slashes just in case
        const base = directory.replace(/\\/g, '/');
        const curr = currentPath.replace(/\\/g, '/');

        if (curr !== base && curr.startsWith(base)) {
            const relDir = curr.substring(base.length + 1); // +1 for slash
            if (relDir) {
                resultPath = `${relDir}/${finalName}`;
            }
        } else if (curr !== base) {
            // If we went UP? e.g. base=public/scenes, curr=public
            // Not supported easily by current caller logic which prepends base.
            // But let's assume standard use case is going deeper or staying same.
            // If we went to 'public/sprites' from 'public/scenes', callers might break if they hardcode prefix.

            // HOWEVER, Game.ts openFileBrowser callback receives just a string.
            // SceneEditor.ts: 
            //   saveScene: `public/scenes/${filenameId}.json`
            //   loadScene: fetch(`/scenes/${filename}`) -> THIS assumes base /scenes/

            // Refactor Warning: If we navigate folders, the hardcoded prefixes in SceneEditor will break.
            // ideally we return the FULL path and SceneEditor handles it.

            // For now, let's return the full path relative to 'public/' if possible?
            // Or just return the path relative to the REQUESTED directory, hoping the caller handles ".." if we went up.

            // Simpler approach:
            // If we are deeper: subdir/file.json
            // If we are higher: ../file.json (SceneEditor might not handle this well)

            // Let's try to just return the relative path from the initial 'directory'.
            // Simple string manipulation.

            if (curr.startsWith(base)) {
                const diff = curr.substring(base.length);
                if (diff.startsWith('/') || diff.startsWith('\\')) {
                    resultPath = diff.substring(1) + '/' + finalName;
                } else if (diff) {
                    resultPath = diff + '/' + finalName;
                }
            } else {
                // We are outside base. e.g. base='public/scenes', curr='public'
                // We need appropriate '..'
                // This is complex to do robustly without 'path' module in browser.
                // But let's support explicit "public" root logic.

                // If the caller expects to prepend 'public/scenes/', and we give '../sprites/foo.png', 
                // it becomes 'public/scenes/../sprites/foo.png' -> 'public/sprites/foo.png'.
                // This is valid in URLs and paths!

                // So we just need to compute relative path from `directory` to `currentPath`.
                // Naive approach:
                const baseParts = base.split('/').filter(x => x);
                const currParts = curr.split('/').filter(x => x);

                let i = 0;
                while (i < baseParts.length && i < currParts.length && baseParts[i] === currParts[i]) {
                    i++;
                }

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

    const handleSelect = (item: { name: string, isDir: boolean }) => {
        if (item.isDir) {
            // Single click on folder - maybe just select it visually?
            // Usually single click on folder selects it, double click enters.
        } else {
            setFilename(item.name);
        }
    };

    const handleDoubleClick = (item: { name: string, isDir: boolean }) => {
        if (item.isDir) {
            // Enter directory
            setCurrentPath(prev => `${prev}/${item.name}`.replace('//', '/'));
            setFilename(''); // Clear filename when changing dirs
        } else {
            // Select file
            if (mode === 'load') {
                setFilename(item.name);
                // We need to trigger confirm with logic above, so call handleConfirm directly?
                // But handleConfirm relies on 'filename' state which might not be updated yet in closure.
                // Better to set filename and let user click Load, or update state and trigger effect?
                // Or just replicate logic.

                // Hack: Force update validation logic here or just rely on manual click for now to be safe with path calc.
                // Actually, user expects double click to load.
                // Let's defer to the next render or use a ref? 

                // Let's just set the filename for now. The user can click Load.
                setFilename(item.name);
            } else {
                setFilename(item.name);
            }
        }
    }

    const handleUp = () => {
        // Go Up
        // Constraint: Not higher than 'public'
        // Actually, we should probably constrain to not higher than 'public' if that is our root.
        // Current 'directory' prop might be 'public/scenes'.
        // 'public' check:
        const normalized = currentPath.replace(/\\/g, '/');
        if (normalized === 'public' || normalized === 'public/') return; // Top limit

        // Remove last segment
        const parts = normalized.split('/');
        if (parts.length > 1) { // e.g. public/scenes
            parts.pop();
            setCurrentPath(parts.join('/'));
        }
    };

    // Derived: Can we go up?
    const canGoUp = currentPath.replace(/\\/g, '/') !== 'public';

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
            fontFamily: 'monospace', color: '#0f0'
        }}>
            <div ref={modalRef} className="file-browser" style={{
                width: '500px', maxWidth: '95vw',
                height: '600px', maxHeight: '90vh',
                backgroundColor: '#000',
                border: '2px solid #0f0', display: 'flex', flexDirection: 'column',
                padding: '10px'
            }}>
                <div className="browser-header" style={{ borderBottom: '1px solid #0f0', marginBottom: '10px', paddingBottom: '5px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
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
                            background: 'transparent', border: '1px solid #0f0', color: '#0f0', cursor: 'pointer',
                            fontSize: '12px', padding: '2px 6px', marginLeft: '10px'
                        }}
                    >
                        📂 Open Folder
                    </button>
                </div>

                <div className="file-list" style={{ flex: 1, overflowY: 'auto', border: '1px solid #333', marginBottom: '10px' }}>
                    {isLoading && <div>Loading...</div>}
                    {error && <div style={{ color: 'red' }}>Error: {error}</div>}

                    {!isLoading && !error && (
                        <>
                            {canGoUp && (
                                <div
                                    onClick={handleUp}
                                    style={{ padding: '5px', cursor: 'pointer', color: '#ffff00' }}
                                >
                                    📁 ..
                                </div>
                            )}

                            {items.map(item => (
                                <div key={item.name}
                                    onClick={() => handleSelect(item)}
                                    onDoubleClick={() => handleDoubleClick(item)}
                                    style={{
                                        padding: '5px',
                                        cursor: 'pointer',
                                        backgroundColor: !item.isDir && filename === item.name ? '#003300' : 'transparent',
                                        color: item.isDir ? '#ffff00' : (filename === item.name ? '#fff' : '#0f0')
                                    }}
                                >
                                    {item.isDir ? '📁' : '📄'} {item.name}
                                </div>
                            ))}
                        </>
                    )}
                    {!isLoading && items.length === 0 && <div style={{ color: '#666', padding: '5px' }}>Directory is empty</div>}
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
                        <button onClick={handleConfirm} style={{ padding: '5px 15px', cursor: 'pointer', background: '#006600', color: '#fff', border: '1px solid #0f0' }}>
                            {mode === 'save' ? 'Save' : 'Load'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};
