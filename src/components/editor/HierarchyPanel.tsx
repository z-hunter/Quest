import React from 'react';
import { useEditorStore } from '../../store/editorStore';
import { Game } from '../../core/Game';
import { Select } from '../../components/common/Select';
import undoIcon from '../../assets/arrow-counter-clockwise.svg';
import pasteIcon from '../../assets/clipboard-text.svg';
import copyIcon from '../../assets/copy-simple.svg';
import saveIcon from '../../assets/floppy-disk.svg';
import loadIcon from '../../assets/folder-open.svg';
import deleteIcon from '../../assets/trash.svg';

export const HierarchyPanel: React.FC = () => {
    const { hierarchyVersion, selectedObjectId } = useEditorStore();

    // Force re-render on hierarchy version change (subscription)
    React.useEffect(() => {
        // This effect solely exists to subscribe to hierarchyVersion updates
    }, [hierarchyVersion]);

    const handleAdd = (type: string) => {
        Game.instance.editor.startCreating(type);
    };

    const handleDelete = () => {
        Game.instance.editor.deleteSelectedObject();
    };

    const scene = Game.instance?.sceneManager?.currentScene;

    if (!scene) return <div className="p-2 text-gray-500">No Scene</div>;

    const entities = scene.entities || [];
    const walkboxes = scene.walkbox || [];
    const triggers = scene.triggerboxes || [];

    // Helper to resolve display ID for an item, matching how it's identified in the UI
    const getDisplayId = (item: any): string => {
        if (item === 'SCENE') return 'SCENE';
        if (item && typeof item === 'object') {
            if (item.type === 'Walkbox') return item.name || 'Walkbox';
            if (item.type === 'Triggerbox') return item.name || 'Triggerbox';
            return item.name; // For entities and other objects
        }
        return String(item); // Fallback, should not be hit with current data structure
    };

    // Unified list for navigation
    // CRITICAL: Must depend on hierarchyVersion because entities/walkboxes/triggers arrays are MUTABLE.
    // React won't see changes to the array reference, so we need the version counter to force refresh.
    const allItems = React.useMemo(() => {
        return ['SCENE', ...entities, ...walkboxes, ...triggers];
    }, [entities, walkboxes, triggers, hierarchyVersion]);

    // Track hover state
    const isHovered = React.useRef(false);

    React.useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (!isHovered.current) return;

            if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                e.preventDefault();

                // Helper to normalize slashes for comparison
                const normalize = (s: string | null) => (s || '').replace(/\\/g, '/');

                // Find the current selected object's index using the consistent display ID
                const currentIndex = allItems.findIndex((item: any) =>
                    normalize(getDisplayId(item)) === normalize(selectedObjectId)
                );

                let nextIndex = currentIndex;

                // If no object is currently selected, start navigation from the first item
                if (currentIndex === -1) {
                    nextIndex = 0;
                } else {
                    if (e.key === 'ArrowUp') {
                        nextIndex = Math.max(0, currentIndex - 1);
                    } else {
                        nextIndex = Math.min(allItems.length - 1, currentIndex + 1);
                    }
                }

                // Only select if the next index is valid and different from the current one
                if (nextIndex !== -1 && nextIndex !== currentIndex) {
                    const itemToSelect = allItems[nextIndex];
                    Game.instance.editor.selectObject(itemToSelect);
                }
            } else if (e.key === 'Delete') {
                if (selectedObjectId && selectedObjectId !== 'SCENE') {
                    e.preventDefault();
                    Game.instance.editor.deleteSelectedObject();
                }
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [allItems, selectedObjectId]);

    const centerCameraOn = (item: any) => {
        const scene = Game.instance?.sceneManager?.currentScene;
        if (!scene) return;

        let targetX = 0;
        let targetY = 0;

        if (item === 'SCENE') {
            targetX = 0;
            targetY = 0;
        } else if (item.x !== undefined && item.y !== undefined) {
            // Entity
            targetX = item.x;
            targetY = item.y;

            // Handle Parallax
            const p = item.parallax !== undefined ? item.parallax : 1.0;
            if (Math.abs(p) > 0.0001) {
                targetX = item.x / p;
                targetY = item.y / p;
            }
        } else if (item.poly) {
            // Walkbox / Triggerbox - Centroid
            const poly = item.poly;
            if (poly.length > 0) {
                let sumX = 0, sumY = 0;
                poly.forEach((p: any) => { sumX += p.x; sumY += p.y; });
                targetX = sumX / poly.length;
                targetY = sumY / poly.length;
            }
        }

        scene.camera.x = targetX;
        scene.camera.y = targetY;
        scene.autoCenter = false; // Disable auto-follow

        // Update UI inputs manually since they are not reactive
        const autoCenterChk = document.getElementById('cam-auto-center') as HTMLInputElement;
        if (autoCenterChk) autoCenterChk.checked = false;

        const cx = document.getElementById('cam-x') as HTMLInputElement;
        const cy = document.getElementById('cam-y') as HTMLInputElement;
        if (cx) cx.value = Math.round(targetX).toString();
        if (cy) cy.value = Math.round(targetY).toString();
    };

    // Normalize helper for consistent ID comparison
    const normalize = (s: string | null) => (s || '').replace(/\\/g, '/');

    const isItemSelected = (id: string | null) => {
        return normalize(id) === normalize(selectedObjectId);
    };

    return (

        <div
            id="hierarchy-panel"
            className="editor-sidebar left"
            onMouseEnter={() => {
                isHovered.current = true;
                if (Game.instance) Game.instance.isMouseOverUI = true;
            }}
            onMouseLeave={() => {
                isHovered.current = false;
                if (Game.instance) Game.instance.isMouseOverUI = false;
            }}
        >
            <div className="editor-header" style={{ flexDirection: 'column', alignItems: 'stretch', gap: '5px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>OBJECTS</div>
                </div>
                <div style={{ marginBottom: '5px' }}>
                    <div style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(6, 1fr)',
                        gap: '2px',
                        marginBottom: '5px'
                    }}>
                        <button
                            className="toolbar-icon-btn"
                            onClick={() => Game.instance.editor.saveObject()}
                            title="Save Object (Ctrl+S)"
                        >
                            <img src={saveIcon} className="toolbar-icon" alt="Save" />
                        </button>
                        <button
                            className="toolbar-icon-btn"
                            onClick={() => Game.instance.editor.loadObject()}
                            title="Load Object (Ctrl+O)"
                        >
                            <img src={loadIcon} className="toolbar-icon" alt="Load" />
                        </button>
                        <button
                            className="toolbar-icon-btn"
                            onClick={() => Game.instance.editor.undo()}
                            title="Undo (Ctrl+Z)"
                        >
                            <img src={undoIcon} className="toolbar-icon" alt="Undo" />
                        </button>
                        <button
                            className="toolbar-icon-btn"
                            onClick={() => Game.instance.editor.copySelectedObjectToClipboard()}
                            title="Copy (Ctrl+C)"
                        >
                            <img src={copyIcon} className="toolbar-icon" alt="Copy" />
                        </button>
                        <button
                            className="toolbar-icon-btn"
                            onClick={() => Game.instance.editor.pasteObjectFromClipboard()}
                            title="Paste (Ctrl+V)"
                        >
                            <img src={pasteIcon} className="toolbar-icon" alt="Paste" />
                        </button>
                        <button
                            className="toolbar-icon-btn"
                            onClick={handleDelete}
                            title="Delete Selected (Del)"
                        >
                            <img src={deleteIcon} className="toolbar-icon" alt="Delete" />
                        </button>
                    </div>

                    <div style={{ marginTop: '5px' }}>
                        <Select
                            options={[
                                { value: 'Static', label: 'Static (S)' },
                                { value: 'Actor', label: 'Actor (A)' },
                                { value: 'Quad', label: 'Quad (Q)' },
                                { value: 'Walkbox', label: 'Walkbox (W)' },
                                { value: 'Triggerbox', label: 'Triggerbox (T)' },
                            ]}
                            placeholder="+ Add Object"
                            onChange={(value) => handleAdd(value)}
                            style={{ width: '100%', fontSize: '12px' }}
                        />
                    </div>
                </div>
            </div>

            <div className="editor-content">
                {/* Scene Node */}
                <div
                    className="e-list-item"
                    style={{
                        padding: '4px', marginBottom: '2px', cursor: 'pointer', borderRadius: '4px',
                        background: isItemSelected('SCENE') ? 'var(--ui-selection-bg)' : 'transparent',
                        color: isItemSelected('SCENE') ? 'var(--ui-selection-text)' : '#aaa'
                    }}
                    onClick={() => Game.instance.editor.selectObject('SCENE')}
                    onDoubleClick={() => centerCameraOn('SCENE')}
                >
                    <span style={{
                        filter: isItemSelected('SCENE')
                            ? 'grayscale(100%) brightness(0)'
                            : 'grayscale(100%) sepia(100%) hue-rotate(75deg) saturate(400%)',
                        marginRight: '6px',
                        display: 'inline-block'
                    }}>
                        🎥
                    </span>
                    Scene
                </div>

                {/* Entities */}
                {entities.map((ent: any) => {
                    const isSelected = isItemSelected(ent.name);
                    return (
                        <div
                            key={ent.name}
                            style={{
                                padding: '4px', paddingLeft: '15px', marginBottom: '2px', cursor: 'pointer', borderRadius: '4px',
                                background: isSelected ? 'var(--ui-selection-bg)' : 'transparent',
                                color: isSelected ? 'var(--ui-selection-text)' : '#aaa',
                                display: 'flex', alignItems: 'center', justifyContent: 'space-between'
                            }}
                            onClick={() => Game.instance.editor.selectObject(ent)}
                            onDoubleClick={() => centerCameraOn(ent)}
                        >
                            <div style={{ display: 'flex', alignItems: 'center', opacity: ent.disabled ? 0.5 : 1.0 }}>
                                <span style={{
                                    filter: isSelected
                                        ? 'grayscale(100%) brightness(0)'
                                        : 'grayscale(100%) sepia(100%) hue-rotate(75deg) saturate(400%)',
                                    marginRight: '6px',
                                    display: 'inline-block',
                                    textDecoration: ent.disabled ? 'line-through' : 'none'
                                }}>
                                    {ent.type === 'Actor' ? '👤' : ent.type === 'Quad' ? '🟦' : '📦'}
                                </span>
                                {ent.name}
                            </div>
                            {ent.locked && <span style={{ fontSize: '10px' }}>🔒</span>}
                        </div>
                    );
                })}

                {/* Walkboxes */}
                {walkboxes.map((wb: any, i: number) => {
                    const id = wb.name || 'Walkbox';
                    const isSelected = isItemSelected(id);
                    return (
                        <div
                            key={wb.name || i}
                            style={{
                                padding: '4px', paddingLeft: '15px', marginBottom: '2px', cursor: 'pointer', borderRadius: '4px',
                                background: isSelected ? 'var(--ui-selection-bg)' : 'transparent',
                                color: isSelected ? 'var(--ui-selection-text)' : '#aaa',
                                display: 'flex', alignItems: 'center', justifyContent: 'space-between'
                            }}
                            onClick={() => Game.instance.editor.selectObject(wb)}
                            onDoubleClick={() => centerCameraOn(wb)}
                        >
                            <div style={{ display: 'flex', alignItems: 'center', opacity: wb.disabled ? 0.5 : 1.0 }}>
                                <span style={{
                                    filter: isSelected
                                        ? 'grayscale(100%) brightness(0)'
                                        : 'grayscale(100%) sepia(100%) hue-rotate(75deg) saturate(400%)',
                                    marginRight: '6px',
                                    display: 'inline-block',
                                    textDecoration: wb.disabled ? 'line-through' : 'none'
                                }}>
                                    👣
                                </span>
                                {wb.name || `Walkbox ${i}`}
                            </div>
                            {wb.locked && <span style={{ fontSize: '10px' }}>🔒</span>}
                        </div>
                    );
                })}

                {/* Triggers */}
                {triggers.map((tb: any, i: number) => {
                    const id = tb.name || 'Triggerbox';
                    const isSelected = isItemSelected(id);
                    return (
                        <div
                            key={tb.name || i}
                            style={{
                                padding: '4px', paddingLeft: '15px', marginBottom: '2px', cursor: 'pointer', borderRadius: '4px',
                                background: isSelected ? 'var(--ui-selection-bg)' : 'transparent',
                                color: isSelected ? 'var(--ui-selection-text)' : '#aaa',
                                display: 'flex', alignItems: 'center', justifyContent: 'space-between'
                            }}
                            onClick={() => Game.instance.editor.selectObject(tb)}
                            onDoubleClick={() => centerCameraOn(tb)}
                        >
                            <div style={{ display: 'flex', alignItems: 'center', opacity: tb.disabled ? 0.5 : 1.0 }}>
                                <span style={{
                                    filter: isSelected
                                        ? 'grayscale(100%) brightness(0)'
                                        : 'grayscale(100%) sepia(100%) hue-rotate(75deg) saturate(400%)',
                                    marginRight: '6px',
                                    display: 'inline-block',
                                    textDecoration: tb.disabled ? 'line-through' : 'none'
                                }}>
                                    ⚡
                                </span>
                                {tb.name || `Trigger ${i}`}
                            </div>
                            {tb.locked && <span style={{ fontSize: '10px' }}>🔒</span>}
                        </div>
                    );
                })}
            </div>
        </div >
    );
};

