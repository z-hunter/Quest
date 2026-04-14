import React from 'react';
import { useEditorStore } from '../../store/editorStore';
import { useGame } from '../../hooks/useGame';
import { Select } from '../../components/common/Select';
import { EditorToolbar } from './EditorToolbar';

export const HierarchyPanel: React.FC = () => {
  const game = useGame();
  const { hierarchyVersion, selectedObjectId, selectedObjectKeys } = useEditorStore();
  const [filterText, setFilterText] = React.useState('');
  const [collapsedFolders, setCollapsedFolders] = React.useState<Set<string>>(new Set());
  const filterInputRef = React.useRef<HTMLInputElement | null>(null);

  // Drag-and-drop state
  interface DragState {
    dragging: boolean;
    draggedNames: Set<string>;
    dropTarget: { type: 'before' | 'into'; targetName: string } | null;
    startY: number;
  }
  const [dragState, setDragState] = React.useState<DragState>({
    dragging: false,
    draggedNames: new Set(),
    dropTarget: null,
    startY: 0,
  });
  const dragPending = React.useRef<{ startY: number; item: any } | null>(null);

  // Force re-render on hierarchy version change (subscription)
  React.useEffect(() => {
    // This effect solely exists to subscribe to hierarchyVersion updates
  }, [hierarchyVersion]);

  const handleAdd = (type: string) => {
    game.editor.startCreating(type);
  };

  const scene = game?.sceneManager?.currentScene;
  const filterMode = filterText.startsWith('#') ? 'group' : 'name';
  const filterNeedle = React.useMemo(() => filterText.trim().toLowerCase(), [filterText]);

  const matchesFilter = React.useCallback(
    (item: any) => {
      if (!filterNeedle) return true;
      if (!item || typeof item !== 'object') return true;

      if (filterMode === 'group') {
        return String(item.groupID || '')
          .toLowerCase()
          .includes(filterNeedle);
      }

      return String(item.name || '')
        .toLowerCase()
        .includes(filterNeedle);
    },
    [filterMode, filterNeedle]
  );

  const filteredEntities = [...(scene?.entities || []), ...(scene?.folders || [])].filter(
    (item: any) => matchesFilter(item)
  );
  const filteredWalkboxes = [...(scene?.walkbox || [])].filter((item: any) => matchesFilter(item));
  const filteredTriggers = [...(scene?.triggerboxes || [])].filter((item: any) =>
    matchesFilter(item)
  );
  const filteredObjects = React.useMemo(
    () => [...filteredEntities, ...filteredWalkboxes, ...filteredTriggers],
    [filteredEntities, filteredWalkboxes, filteredTriggers]
  );
  const filteredObjectOrder = React.useMemo(
    () => new Map(filteredObjects.map((item: any, index: number) => [item.name, index])),
    [filteredObjects]
  );
  const hierarchicalObjects = React.useMemo(() => {
    const objectByName = new Map(filteredObjects.map((item: any) => [item.name, item]));
    const folderIdToName = new Map<string, string>();
    filteredObjects.forEach((item: any) => {
      if (item.type === 'Folder' && item.folderId) {
        folderIdToName.set(item.folderId, item.name);
      }
    });

    const childrenByParent = new Map<string, any[]>();
    const roots: any[] = [];

    const pushChild = (parentName: string, item: any) => {
      const children = childrenByParent.get(parentName) || [];
      children.push(item);
      childrenByParent.set(parentName, children);
    };

    filteredObjects.forEach((item: any) => {
      const fid = typeof item?.folder === 'string' ? item.folder : '';
      const folderParentName = fid ? folderIdToName.get(fid) || '' : '';
      if (
        folderParentName &&
        folderParentName !== item.name &&
        objectByName.has(folderParentName)
      ) {
        pushChild(folderParentName, item);
        return;
      }
      const parentId =
        typeof item?.spatial?.parentNodeId === 'string' ? item.spatial.parentNodeId.trim() : '';
      if (parentId && parentId !== item.name && objectByName.has(parentId)) {
        pushChild(parentId, item);
      } else {
        roots.push(item);
      }
    });

    const sortBySceneOrder = (items: any[]) =>
      [...items].sort(
        (left, right) =>
          (filteredObjectOrder.get(left.name) ?? Number.MAX_SAFE_INTEGER) -
          (filteredObjectOrder.get(right.name) ?? Number.MAX_SAFE_INTEGER)
      );

    const ordered: Array<{ item: any; depth: number }> = [];
    const visited = new Set<string>();

    const walk = (item: any, depth: number) => {
      if (!item || visited.has(item.name)) return;
      visited.add(item.name);
      ordered.push({ item, depth });
      const children = sortBySceneOrder(childrenByParent.get(item.name) || []);
      children.forEach((child) => walk(child, depth + 1));
    };

    sortBySceneOrder(roots).forEach((item) => walk(item, 0));

    sortBySceneOrder(filteredObjects)
      .filter((item) => !visited.has(item.name))
      .forEach((item) => walk(item, 0));

    return ordered;
  }, [filteredObjects, filteredObjectOrder]);

  const toggleFolderCollapse = React.useCallback((folderName: string) => {
    setCollapsedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(folderName)) next.delete(folderName);
      else next.add(folderName);
      return next;
    });
  }, []);

  const visibleObjects = React.useMemo(() => {
    const collapsedFolderIds = new Set<string>();
    for (const { item } of hierarchicalObjects) {
      if (item.type === 'Folder' && collapsedFolders.has(item.name)) {
        collapsedFolderIds.add(item.folderId);
      }
    }
    const isFolderCollapsed = (folderId: string): boolean => {
      if (!folderId) return false;
      if (collapsedFolderIds.has(folderId)) return true;
      const folderItem = hierarchicalObjects.find(
        (e) => e.item.type === 'Folder' && e.item.folderId === folderId
      );
      if (folderItem?.item?.folder) {
        return isFolderCollapsed(folderItem.item.folder);
      }
      return false;
    };
    return hierarchicalObjects.filter(({ item }) => {
      const fid = typeof item?.folder === 'string' ? item.folder : '';
      if (!fid) return true;
      return !isFolderCollapsed(fid);
    });
  }, [hierarchicalObjects, collapsedFolders]);

  const selectFolderContents = React.useCallback(
    (folderName: string) => {
      const scene = game?.sceneManager?.currentScene;
      if (!scene) return;
      const folder = (scene.folders || []).find(
        (e: any) => e.type === 'Folder' && e.name === folderName
      );
      if (!folder) return;
      const fid = (folder as any).folderId;
      const children = hierarchicalObjects
        .filter(({ item }) => item.folder === fid)
        .map(({ item }) => item);
      if (children.length > 0) {
        game.editor.selectionManager.setMultiSelection(children);
      }
    },
    [game, hierarchicalObjects]
  );

  const getDisplayId = (item: any): string => {
    if (item === 'SCENE') return 'SCENE';
    if (item && typeof item === 'object') {
      if (item.type === 'Walkbox') return item.name || 'Walkbox';
      if (item.type === 'Triggerbox') return item.name || 'Triggerbox';
      return item.name;
    }
    return String(item);
  };

  const getSelectionKey = (item: any): string => {
    if (item === 'SCENE') return 'SCENE';
    if (item && typeof item === 'object') {
      if (item.type === 'Folder') return `Folder:${item.name}`;
      if (item.type === 'Quad') return `Quad:${item.name}`;
      if (item.type === 'Walkbox') return `Walkbox:${item.name || 'Walkbox'}`;
      if (item.type === 'Triggerbox') return `Triggerbox:${item.name || 'Triggerbox'}`;
      if (item.type === 'Actor') return `Actor:${item.name}`;
      return `Entity:${item.name}`;
    }
    return String(item);
  };

  const isHovered = React.useRef(false);

  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isHovered.current) return;

      if (
        document.activeElement instanceof HTMLInputElement ||
        document.activeElement instanceof HTMLTextAreaElement
      ) {
        return;
      }

      const allItems = ['SCENE', ...hierarchicalObjects.map((entry) => entry.item)];

      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();

        // Helper to normalize slashes for comparison
        const normalize = (s: string | null) => (s || '').replace(/\\/g, '/');

        // Find the current selected object's index using the consistent display ID
        const currentIndex = allItems.findIndex(
          (item: any) => normalize(getDisplayId(item)) === normalize(selectedObjectId)
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
          game.editor.selectObject(itemToSelect);
        }
      } else if (e.key === 'Delete') {
        if (selectedObjectId && selectedObjectId !== 'SCENE') {
          e.preventDefault();
          game.editor.deleteSelectedObject();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [hierarchicalObjects, hierarchyVersion, selectedObjectId, game.editor]);

  const centerCameraOn = (item: any) => {
    const scene = game?.sceneManager?.currentScene;
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
        let sumX = 0,
          sumY = 0;
        poly.forEach((p: any) => {
          sumX += p.x;
          sumY += p.y;
        });
        targetX = sumX / poly.length;
        targetY = sumY / poly.length;
      }
    }

    scene.camera.x = targetX;
    scene.camera.y = targetY;
    scene.autoCenter = false; // Disable auto-follow
    useEditorStore.getState().incrementObjectVersion();
  };

  // Normalize helper for consistent ID comparison
  const normalize = (s: string | null) => (s || '').replace(/\\/g, '/');

  const isItemSelected = React.useCallback(
    (item: any) => {
      const key = getSelectionKey(item);
      if (selectedObjectKeys?.length) {
        return selectedObjectKeys.includes(key) || selectedObjectKeys.includes(getDisplayId(item));
      }
      return normalize(getDisplayId(item)) === normalize(selectedObjectId);
    },
    [selectedObjectKeys, selectedObjectId]
  );

  // --- Drag-and-drop handlers ---
  const handleDragMouseDown = React.useCallback(
    (e: React.MouseEvent, item: any) => {
      if (e.button !== 0) return;
      if (!isItemSelected(item)) {
        game.editor.selectObject(item);
      }
      const startY = e.clientY;
      dragPending.current = { startY, item };

      const armDragIfMoved = (ev: MouseEvent) => {
        if (Math.abs(ev.clientY - startY) <= 4) return;
        const names = new Set<string>();
        if (selectedObjectKeys?.length > 1) {
          for (const entry of visibleObjects) {
            if (isItemSelected(entry.item)) names.add(entry.item.name);
          }
        }
        if (names.size === 0 && item?.name) names.add(item.name);
        dragPending.current = null;
        window.removeEventListener('mousemove', armDragIfMoved);
        window.removeEventListener('mouseup', cancelPending);
        setDragState({
          dragging: true,
          draggedNames: names,
          dropTarget: null,
          startY: ev.clientY,
        });
      };
      const cancelPending = () => {
        dragPending.current = null;
        window.removeEventListener('mousemove', armDragIfMoved);
        window.removeEventListener('mouseup', cancelPending);
      };
      window.addEventListener('mousemove', armDragIfMoved);
      window.addEventListener('mouseup', cancelPending);
    },
    [isItemSelected, game, selectedObjectKeys, visibleObjects]
  );

  const applyDrop = React.useCallback(
    (draggedNames: Set<string>, dropTarget: NonNullable<DragState['dropTarget']>) => {
      const scene = game?.sceneManager?.currentScene;
      if (!scene) return;

      game.editor.saveUndoState();

      if (dropTarget.type === 'into') {
        const targetFolder = (scene.folders || []).find(
          (e: any) => e.type === 'Folder' && e.name === dropTarget.targetName
        );
        const targetFolderId = (targetFolder as any)?.folderId || null;
        for (const entry of visibleObjects) {
          if (draggedNames.has(entry.item.name)) {
            if (entry.item.type === 'Folder') continue;
            entry.item.folder = targetFolderId;
          }
        }
      } else {
        const targetName = dropTarget.targetName;
        const draggedEntities: any[] = [];
        const draggedFolders: any[] = [];
        const draggedWalkboxes: any[] = [];
        const draggedTriggers: any[] = [];

        scene.entities = scene.entities.filter((e: any) => {
          if (draggedNames.has(e.name)) {
            draggedEntities.push(e);
            return false;
          }
          return true;
        });
        scene.folders = scene.folders.filter((f: any) => {
          if (draggedNames.has(f.name)) {
            draggedFolders.push(f);
            return false;
          }
          return true;
        });
        scene.walkbox = scene.walkbox.filter((w: any) => {
          if (draggedNames.has(w.name)) {
            draggedWalkboxes.push(w);
            return false;
          }
          return true;
        });
        scene.triggerboxes = scene.triggerboxes.filter((t: any) => {
          if (draggedNames.has(t.name)) {
            draggedTriggers.push(t);
            return false;
          }
          return true;
        });

        let newFolder: string | null = null;
        if (targetName !== '__end__') {
          const targetObj = [
            ...scene.entities,
            ...scene.folders,
            ...scene.walkbox,
            ...scene.triggerboxes,
          ].find((o: any) => o.name === targetName);
          if (targetObj) {
            newFolder = (targetObj as any).folder || null;
          }
        }

        for (const obj of [...draggedEntities, ...draggedWalkboxes, ...draggedTriggers]) {
          if (obj.folder && obj.folder !== newFolder && obj.inheritedProps instanceof Set) {
            obj.inheritedProps.clear();
          }
          obj.folder = newFolder;
        }

        if (targetName === '__end__') {
          scene.entities.push(...draggedEntities);
          scene.folders.push(...draggedFolders);
          scene.walkbox.push(...draggedWalkboxes);
          scene.triggerboxes.push(...draggedTriggers);
        } else {
          const insertAt = (arr: any[], items: any[]) => {
            if (items.length === 0) return;
            const idx = arr.findIndex((o: any) => o.name === targetName);
            if (idx >= 0) arr.splice(idx, 0, ...items);
            else arr.push(...items);
          };
          insertAt(scene.entities, draggedEntities);
          insertAt(scene.folders, draggedFolders);
          insertAt(scene.walkbox, draggedWalkboxes);
          insertAt(scene.triggerboxes, draggedTriggers);
        }
      }

      useEditorStore.getState().incrementHierarchyVersion();
      useEditorStore.getState().incrementObjectVersion();
    },
    [game, visibleObjects]
  );

  React.useEffect(() => {
    if (!dragState.dragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const panel = document.getElementById('hierarchy-panel');
      if (!panel) return;

      const panelRect = panel.getBoundingClientRect();
      if (
        e.clientX < panelRect.left ||
        e.clientX > panelRect.right ||
        e.clientY < panelRect.top ||
        e.clientY > panelRect.bottom
      ) {
        setDragState({ dragging: false, draggedNames: new Set(), dropTarget: null, startY: 0 });
        return;
      }

      const rows = panel.querySelectorAll('[data-hierarchy-name]');
      let newTarget: DragState['dropTarget'] = null;
      const draggingFolders = visibleObjects.some(
        ({ item }) => dragState.draggedNames.has(item.name) && item.type === 'Folder'
      );

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i] as HTMLElement;
        const rect = row.getBoundingClientRect();
        const name = row.getAttribute('data-hierarchy-name') || '';
        const type = row.getAttribute('data-hierarchy-type') || '';

        if (dragState.draggedNames.has(name)) continue;

        if (e.clientY >= rect.top && e.clientY <= rect.bottom) {
          const midY = rect.top + rect.height / 2;
          if (
            type === 'Folder' &&
            !draggingFolders &&
            e.clientY > rect.top + rect.height * 0.25 &&
            e.clientY < rect.top + rect.height * 0.75
          ) {
            newTarget = { type: 'into', targetName: name };
          } else if (e.clientY < midY) {
            newTarget = { type: 'before', targetName: name };
          } else {
            let nextName: string | null = null;
            for (let j = i + 1; j < rows.length; j++) {
              const nn = rows[j].getAttribute('data-hierarchy-name') || '';
              if (!dragState.draggedNames.has(nn)) {
                nextName = nn;
                break;
              }
            }
            newTarget = nextName
              ? { type: 'before', targetName: nextName }
              : { type: 'before', targetName: '__end__' };
          }
          break;
        }
      }

      setDragState((prev) => ({ ...prev, dropTarget: newTarget }));
    };

    const handleMouseUp = () => {
      dragPending.current = null;
      if (dragState.dragging && dragState.dropTarget) {
        applyDrop(dragState.draggedNames, dragState.dropTarget);
      }
      setDragState({ dragging: false, draggedNames: new Set(), dropTarget: null, startY: 0 });
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [dragState.dragging, dragState.draggedNames, dragState.dropTarget, applyDrop, visibleObjects]);

  const uiScale = game?.settings?.editor?.uiScale || 1.0;

  // Index of the drop-before target — items from here onward shift down
  const dropBeforeIdx =
    dragState.dragging && dragState.dropTarget?.type === 'before'
      ? visibleObjects.findIndex(({ item }) => item.name === dragState.dropTarget!.targetName)
      : -1;

  // Custom drag cursors (single document / stack of documents)
  const singleDocCursor = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='18' height='20' viewBox='0 0 18 20'%3E%3Crect x='1' y='1' width='14' height='18' rx='2' fill='%23334' stroke='%2399aacc' stroke-width='1'/%3E%3Cline x1='4' y1='6' x2='12' y2='6' stroke='%2377889a' stroke-width='1'/%3E%3Cline x1='4' y1='9' x2='12' y2='9' stroke='%2377889a' stroke-width='1'/%3E%3Cline x1='4' y1='12' x2='9' y2='12' stroke='%2377889a' stroke-width='1'/%3E%3C/svg%3E") 9 10, grabbing`;
  const stackDocCursor = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='22' height='24' viewBox='0 0 22 24'%3E%3Crect x='5' y='1' width='14' height='18' rx='2' fill='%23445' stroke='%238899bb' stroke-width='1'/%3E%3Crect x='3' y='3' width='14' height='18' rx='2' fill='%23334' stroke='%2399aacc' stroke-width='1'/%3E%3Cline x1='6' y1='8' x2='14' y2='8' stroke='%2377889a' stroke-width='1'/%3E%3Cline x1='6' y1='11' x2='14' y2='11' stroke='%2377889a' stroke-width='1'/%3E%3Cline x1='6' y1='14' x2='11' y2='14' stroke='%2377889a' stroke-width='1'/%3E%3C/svg%3E") 9 10, grabbing`;
  const dragCursor = dragState.dragging
    ? dragState.draggedNames.size > 1
      ? stackDocCursor
      : singleDocCursor
    : undefined;

  if (!scene) return <div className="p-2 text-gray-500">No Scene</div>;

  return (
    <div
      id="hierarchy-panel"
      className="editor-sidebar left"
      onMouseEnter={() => {
        isHovered.current = true;
        if (game) game.isMouseOverUI = true;
      }}
      onMouseLeave={() => {
        isHovered.current = false;
        if (game) game.isMouseOverUI = false;
      }}
      style={{
        fontSize: `${12 * uiScale}px`,
        cursor: dragState.dragging ? dragCursor : undefined,
      }}
    >
      <div
        className="editor-header"
        style={{ flexDirection: 'column', alignItems: 'stretch', gap: '5px' }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>OBJECTS</div>
        </div>
        <div style={{ marginBottom: '5px' }}>
          <EditorToolbar />

          <div style={{ marginTop: '5px' }}>
            <Select
              options={[
                { value: 'Folder', label: 'Folder (F)' },
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

          <div style={{ marginTop: '5px', position: 'relative' }}>
            <input
              type="text"
              ref={filterInputRef}
              id="hierarchy-filter-input"
              className="e-input"
              value={filterText}
              placeholder='Filter by ID or "#group"'
              onChange={(e) => setFilterText(e.target.value)}
              style={{
                width: '100%',
                paddingRight: filterText ? '28px' : undefined,
              }}
            />
            {filterText && (
              <button
                className="toolbar-icon-btn"
                type="button"
                title="Clear filter"
                onClick={() => setFilterText('')}
                style={{
                  position: 'absolute',
                  right: '2px',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  width: '22px',
                  height: '22px',
                  padding: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                x
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="editor-content">
        {/* Scene Node */}
        <div
          className="e-list-item"
          style={{
            padding: '4px',
            paddingLeft: '2px',
            marginBottom: '2px',
            cursor: 'pointer',
            borderRadius: '4px',
            background: isItemSelected('SCENE') ? 'var(--ui-selection-bg)' : 'transparent',
            color: isItemSelected('SCENE') ? 'var(--ui-selection-text)' : '#aaa',
          }}
          onClick={(e) => {
            if (e.ctrlKey) return;
            game.editor.selectObject('SCENE');
          }}
          onDoubleClick={() => centerCameraOn('SCENE')}
        >
          <span
            style={{
              filter: isItemSelected('SCENE')
                ? 'grayscale(100%) brightness(0)'
                : 'grayscale(100%) sepia(100%) hue-rotate(75deg) saturate(400%)',
              marginRight: '6px',
              display: 'inline-block',
            }}
          >
            🎥
          </span>
          Scene
        </div>

        {visibleObjects.map(({ item, depth }, i) => {
          const isSelected = isItemSelected(item);
          const isDragged = dragState.dragging && dragState.draggedNames.has(item.name);
          const isDropInto =
            dragState.dropTarget?.type === 'into' && dragState.dropTarget.targetName === item.name;
          const isDropBefore =
            dragState.dropTarget?.type === 'before' &&
            dragState.dropTarget.targetName === item.name;
          const isFolder = item.type === 'Folder';
          const isCollapsed = isFolder && collapsedFolders.has(item.name);
          const icon = isFolder
            ? isCollapsed
              ? '📁'
              : '📂'
            : item.type === 'Actor'
              ? '👤'
              : item.type === 'Quad'
                ? '▰'
                : item.type === 'Walkbox'
                  ? '👣'
                  : item.type === 'Triggerbox'
                    ? '⚡'
                    : '📦';
          const label =
            item.type === 'Walkbox'
              ? item.name || `Walkbox ${i}`
              : item.type === 'Triggerbox'
                ? item.name || `Trigger ${i}`
                : item.name;
          // Folders are shifted left (like Finder), regular objects get extra indent inside folders
          const paddingLeft = isFolder ? `${4 + depth * 14}px` : `${18 + depth * 14}px`;
          // Shift down: this item and all after the drop-before target
          const shouldShiftDown = !isDragged && dropBeforeIdx >= 0 && i >= dropBeforeIdx;
          return (
            <div
              className="hierarchy-row"
              key={`${item.type}:${item.name || i}`}
              data-hierarchy-name={item.name}
              data-hierarchy-type={item.type}
              style={{
                position: 'relative',
                padding: '4px',
                paddingLeft,
                marginBottom: '2px',
                cursor: dragState.dragging ? dragCursor : 'pointer',
                borderRadius: '4px',
                background: isDropInto
                  ? 'rgba(100, 160, 255, 0.25)'
                  : isSelected
                    ? 'var(--ui-selection-bg)'
                    : 'transparent',
                color: isSelected ? 'var(--ui-selection-text)' : '#aaa',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                opacity: isDragged ? 0.35 : 1.0,
                borderTop: isDropBefore ? '2px solid #5599ff' : undefined,
                transform: shouldShiftDown ? 'translateY(3px)' : undefined,
                transition: dragState.dragging ? 'transform 0.12s ease' : undefined,
              }}
              onClick={(e) => {
                if (dragState.dragging) return;
                if (e.ctrlKey) game.editor.toggleObjectSelection(item);
                else game.editor.selectObject(item);
              }}
              onDoubleClick={() => {
                if (dragState.dragging) return;
                if (isFolder) selectFolderContents(item.name);
                else centerCameraOn(item);
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  opacity: item.disabled ? 0.5 : 1.0,
                }}
              >
                <span
                  style={{
                    filter: isSelected
                      ? 'grayscale(100%) brightness(0)'
                      : 'grayscale(100%) sepia(100%) hue-rotate(75deg) saturate(400%)',
                    marginRight: '6px',
                    display: 'inline-block',
                    textDecoration: item.disabled ? 'line-through' : 'none',
                  }}
                >
                  {icon}
                </span>
                <span className="hierarchy-id-text">{label}</span>
                {isFolder && (
                  <span
                    style={{
                      marginLeft: '5px',
                      fontSize: '8px',
                      cursor: 'pointer',
                      userSelect: 'none',
                      color: isSelected ? 'var(--ui-selection-text)' : '#888',
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleFolderCollapse(item.name);
                    }}
                  >
                    {isCollapsed ? '▶' : '▼'}
                  </span>
                )}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                {item.locked && <span style={{ fontSize: '10px' }}>🔒</span>}
                <span
                  className="drag-handle"
                  style={{
                    cursor: 'grab',
                    fontSize: '10px',
                    color: '#666',
                    userSelect: 'none',
                    padding: '0 2px',
                    lineHeight: 1,
                  }}
                  onMouseDown={(e) => {
                    e.stopPropagation();
                    handleDragMouseDown(e, item);
                  }}
                >
                  ⠿
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
