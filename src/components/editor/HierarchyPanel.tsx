import React from 'react';
import { useEditorStore } from '../../store/editorStore';
import { useGame } from '../../hooks/useGame';
import { Select } from '../../components/common/Select';
import { EditorToolbar } from './EditorToolbar';

export const HierarchyPanel: React.FC = () => {
  const game = useGame();
  const { hierarchyVersion, selectedObjectId, selectedObjectKeys } = useEditorStore();
  const [filterText, setFilterText] = React.useState('');
  const filterInputRef = React.useRef<HTMLInputElement | null>(null);

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

  const filteredEntities = [...(scene?.entities || [])].filter((item: any) => matchesFilter(item));
  const filteredWalkboxes = [...(scene?.walkbox || [])].filter((item: any) => matchesFilter(item));
  const filteredTriggers = [...(scene?.triggerboxes || [])].filter((item: any) =>
    matchesFilter(item)
  );
  const filteredEntityOrder = React.useMemo(
    () => new Map(filteredEntities.map((entity: any, index: number) => [entity.name, index])),
    [filteredEntities]
  );
  const hierarchicalEntities = React.useMemo(() => {
    const entityByName = new Map(filteredEntities.map((entity: any) => [entity.name, entity]));
    const childrenByParent = new Map<string, any[]>();
    const roots: any[] = [];

    const pushChild = (parentId: string, entity: any) => {
      const children = childrenByParent.get(parentId) || [];
      children.push(entity);
      childrenByParent.set(parentId, children);
    };

    filteredEntities.forEach((entity: any) => {
      const parentId =
        typeof entity?.spatial?.parentNodeId === 'string' ? entity.spatial.parentNodeId.trim() : '';
      if (parentId && parentId !== entity.name && entityByName.has(parentId)) {
        pushChild(parentId, entity);
      } else {
        roots.push(entity);
      }
    });

    const sortBySceneOrder = (items: any[]) =>
      [...items].sort(
        (left, right) =>
          (filteredEntityOrder.get(left.name) ?? Number.MAX_SAFE_INTEGER) -
          (filteredEntityOrder.get(right.name) ?? Number.MAX_SAFE_INTEGER)
      );

    const ordered: Array<{ entity: any; depth: number }> = [];
    const visited = new Set<string>();

    const walk = (entity: any, depth: number) => {
      if (!entity || visited.has(entity.name)) return;
      visited.add(entity.name);
      ordered.push({ entity, depth });
      const children = sortBySceneOrder(childrenByParent.get(entity.name) || []);
      children.forEach((child) => walk(child, depth + 1));
    };

    sortBySceneOrder(roots).forEach((entity) => walk(entity, 0));

    sortBySceneOrder(filteredEntities)
      .filter((entity) => !visited.has(entity.name))
      .forEach((entity) => walk(entity, 0));

    return ordered;
  }, [filteredEntities, filteredEntityOrder]);

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

  const getSelectionKey = (item: any): string => {
    if (item === 'SCENE') return 'SCENE';
    if (item && typeof item === 'object') {
      if (item.type === 'Quad') return `Quad:${item.name}`;
      if (item.type === 'Walkbox') return `Walkbox:${item.name || 'Walkbox'}`;
      if (item.type === 'Triggerbox') return `Triggerbox:${item.name || 'Triggerbox'}`;
      if (item.type === 'Actor') return `Actor:${item.name}`;
      return `Entity:${item.name}`;
    }
    return String(item);
  };

  // Track hover state
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

      const allItems = [
        'SCENE',
        ...hierarchicalEntities.map((item) => item.entity),
        ...filteredWalkboxes,
        ...filteredTriggers,
      ];

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
  }, [
    hierarchicalEntities,
    filteredWalkboxes,
    filteredTriggers,
    hierarchyVersion,
    selectedObjectId,
    game.editor,
  ]);

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

  const isItemSelected = (item: any) => {
    const key = getSelectionKey(item);
    if (selectedObjectKeys?.length) {
      return selectedObjectKeys.includes(key) || selectedObjectKeys.includes(getDisplayId(item));
    }
    return normalize(getDisplayId(item)) === normalize(selectedObjectId);
  };

  const uiScale = game?.settings?.editor?.uiScale || 1.0;

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
      style={{ fontSize: `${12 * uiScale}px` }}
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

        {/* Entities */}
        {hierarchicalEntities.map(({ entity: ent, depth }) => {
          const isSelected = isItemSelected(ent);
          return (
            <div
              key={ent.name}
              style={{
                padding: '4px',
                paddingLeft: `${8 + depth * 14}px`,
                marginBottom: '2px',
                cursor: 'pointer',
                borderRadius: '4px',
                background: isSelected ? 'var(--ui-selection-bg)' : 'transparent',
                color: isSelected ? 'var(--ui-selection-text)' : '#aaa',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
              onClick={(e) => {
                if (e.ctrlKey) game.editor.toggleObjectSelection(ent);
                else game.editor.selectObject(ent);
              }}
              onDoubleClick={() => centerCameraOn(ent)}
            >
              <div
                style={{ display: 'flex', alignItems: 'center', opacity: ent.disabled ? 0.5 : 1.0 }}
              >
                <span
                  style={{
                    filter: isSelected
                      ? 'grayscale(100%) brightness(0)'
                      : 'grayscale(100%) sepia(100%) hue-rotate(75deg) saturate(400%)',
                    marginRight: '6px',
                    display: 'inline-block',
                    textDecoration: ent.disabled ? 'line-through' : 'none',
                  }}
                >
                  {ent.type === 'Actor' ? '👤' : ent.type === 'Quad' ? '▰' : '📦'}
                </span>
                {ent.name}
              </div>
              {ent.locked && <span style={{ fontSize: '10px' }}>🔒</span>}
            </div>
          );
        })}

        {/* Walkboxes */}
        {filteredWalkboxes.map((wb: any, i: number) => {
          const isSelected = isItemSelected(wb);
          return (
            <div
              key={wb.name || i}
              style={{
                padding: '4px',
                paddingLeft: '15px',
                marginBottom: '2px',
                cursor: 'pointer',
                borderRadius: '4px',
                background: isSelected ? 'var(--ui-selection-bg)' : 'transparent',
                color: isSelected ? 'var(--ui-selection-text)' : '#aaa',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
              onClick={(e) => {
                if (e.ctrlKey) game.editor.toggleObjectSelection(wb);
                else game.editor.selectObject(wb);
              }}
              onDoubleClick={() => centerCameraOn(wb)}
            >
              <div
                style={{ display: 'flex', alignItems: 'center', opacity: wb.disabled ? 0.5 : 1.0 }}
              >
                <span
                  style={{
                    filter: isSelected
                      ? 'grayscale(100%) brightness(0)'
                      : 'grayscale(100%) sepia(100%) hue-rotate(75deg) saturate(400%)',
                    marginRight: '6px',
                    display: 'inline-block',
                    textDecoration: wb.disabled ? 'line-through' : 'none',
                  }}
                >
                  👣
                </span>
                {wb.name || `Walkbox ${i}`}
              </div>
              {wb.locked && <span style={{ fontSize: '10px' }}>🔒</span>}
            </div>
          );
        })}

        {/* Triggers */}
        {filteredTriggers.map((tb: any, i: number) => {
          const isSelected = isItemSelected(tb);
          return (
            <div
              key={tb.name || i}
              style={{
                padding: '4px',
                paddingLeft: '15px',
                marginBottom: '2px',
                cursor: 'pointer',
                borderRadius: '4px',
                background: isSelected ? 'var(--ui-selection-bg)' : 'transparent',
                color: isSelected ? 'var(--ui-selection-text)' : '#aaa',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
              onClick={(e) => {
                if (e.ctrlKey) game.editor.toggleObjectSelection(tb);
                else game.editor.selectObject(tb);
              }}
              onDoubleClick={() => centerCameraOn(tb)}
            >
              <div
                style={{ display: 'flex', alignItems: 'center', opacity: tb.disabled ? 0.5 : 1.0 }}
              >
                <span
                  style={{
                    filter: isSelected
                      ? 'grayscale(100%) brightness(0)'
                      : 'grayscale(100%) sepia(100%) hue-rotate(75deg) saturate(400%)',
                    marginRight: '6px',
                    display: 'inline-block',
                    textDecoration: tb.disabled ? 'line-through' : 'none',
                  }}
                >
                  ⚡
                </span>
                {tb.name || `Trigger ${i}`}
              </div>
              {tb.locked && <span style={{ fontSize: '10px' }}>🔒</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
};
