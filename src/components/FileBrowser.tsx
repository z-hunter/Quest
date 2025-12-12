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
    const [files, setFiles] = useState<string[]>([]);
    const [filename, setFilename] = useState(defaultFilename);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        // Fetch file list
        fetch('/api/list', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: directory })
        })
            .then(res => res.json())
            .then(data => {
                if (data.files) {
                    setFiles(data.files);
                } else {
                    setError('Failed to list files');
                }
                setIsLoading(false);
            })
            .catch(err => {
                setError(String(err));
                setIsLoading(false);
            });
    }, [directory]);

    const handleConfirm = () => {
        if (!filename) return;
        let finalName = filename;
        if (!finalName.endsWith(extension)) {
            finalName += extension;
        }

        if (mode === 'save' && files.includes(finalName)) {
            if (!confirm(`Overwrite ${finalName}?`)) {
                return;
            }
        }

        onConfirm(finalName);
    };

    const handleSelect = (f: string) => {
        setFilename(f);
        // If loading, double click logic? For now single click selects. 
    };

    const handleDoubleClick = (f: string) => {
        if (mode === 'load') {
            // For load, name is enough, but ensure hook calls update
            setFilename(f);
            // Slight delay to ensure state update or just pass f directly
            onConfirm(f);
        } else {
            setFilename(f);
        }
    }

    return (
        <div className="modal-overlay" style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.8)', zIndex: 10000,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontFamily: 'monospace', color: '#0f0'
        }}>
            <div className="file-browser" style={{
                width: '400px', height: '500px', backgroundColor: '#000',
                border: '2px solid #0f0', display: 'flex', flexDirection: 'column',
                padding: '10px'
            }}>
                <div className="browser-header" style={{ borderBottom: '1px solid #0f0', marginBottom: '10px', paddingBottom: '5px' }}>
                    <h3 style={{ margin: 0 }}>{title || (mode === 'save' ? 'Save File' : 'Load File')}</h3>
                </div>

                <div className="file-list" style={{ flex: 1, overflowY: 'auto', border: '1px solid #333', marginBottom: '10px' }}>
                    {isLoading && <div>Loading...</div>}
                    {error && <div style={{ color: 'red' }}>Error: {error}</div>}
                    {!isLoading && !error && files.map(f => (
                        <div key={f}
                            onClick={() => handleSelect(f)}
                            onDoubleClick={() => handleDoubleClick(f)}
                            style={{
                                padding: '5px',
                                cursor: 'pointer',
                                backgroundColor: filename === f ? '#003300' : 'transparent',
                                color: filename === f ? '#fff' : '#0f0'
                            }}
                        >
                            {f}
                        </div>
                    ))}
                    {!isLoading && files.length === 0 && <div style={{ color: '#666', padding: '5px' }}>Directory is empty</div>}
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
