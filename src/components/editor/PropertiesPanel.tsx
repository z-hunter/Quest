import React from 'react';
import { useEditorStore } from '../../store/editorStore';
import { useGame } from '../../hooks/useGame';
import { Select } from '../../components/common/Select';
import { QuadObject } from '../../entities/QuadObject';
import { Entity } from '../../entities/Entity';
import { Triggerbox } from '../../entities/Triggerbox';
import { readProjectFile } from '../../platform/fileApi';
import { isTauriRuntime } from '../../platform/fileApi';

const SPATIAL_RELATION_OPTIONS = [
  { value: '', label: '(None)' },
  { value: 'in', label: 'In' },
  { value: 'on', label: 'On' },
  { value: 'under', label: 'Under' },
  { value: 'behind', label: 'Behind' },
];

const PROPERTIES_LABEL_TOOLTIPS: Record<string, string> = {
  'Group #ID':
    'Comma-separated tags used to address this object or selection from triggers, switches, scripts, and subscenes.',
  Parent:
    'Chooses the direct spatial parent of this object. The object will be treated as attached to that parent instead of the root scene.',
  Relation:
    'Defines how this object is attached to its parent in the spatial hierarchy: in, on, under, or behind.',
  'Group X':
    'Moves the whole selected group horizontally while preserving the relative layout between the selected objects.',
  'Group Y':
    'Moves the whole selected group vertically while preserving the relative layout between the selected objects.',
  'Group Scale':
    'Scales the whole selected group around its shared center while keeping the objects aligned with each other.',
  X: 'Horizontal position in scene space.',
  Y: 'Vertical position in scene space.',
  H: 'Visible height of the object rectangle.',
  W: 'Visible width of the object rectangle.',
  Scale:
    'Overall size multiplier. For polygon objects it scales the current shape around its center; for sprite objects it changes their model scale.',
  Layer: 'Render and interaction layer. Higher layers are treated as being in front of lower ones.',
  Parallax:
    'Camera parallax factor. Values around 1 move with the scene, while lower or higher values create foreground or background depth drift.',
  'Collider H':
    'Collision height used for walkbox and obstacle interaction. Set to 0 to make the object non-blocking.',
  'Collider W':
    'Collision width used for walkbox and obstacle interaction. Set to 0 to make the object non-blocking.',
  'Disable Depth-scaling':
    'Keeps the object at a fixed visual size instead of letting the scene depth-scaling system resize it by Y position.',
  'Fill Color':
    'Base fill color for the object when no sprite is used, or the tint/fill color used by this visual mode.',
  'Blend Mode': 'Canvas blend mode used to combine this object with the scene behind it.',
  Opacity:
    'Visual transparency. 0% keeps the object fully opaque; 100% makes it invisible and excluded from rendering.',
  Blur: 'Blur radius in pixels. 0 px is sharp; higher values make the object softer.',
  Sprite:
    'Sprite asset used to render this object. Leave empty to keep the plain filled rectangle look.',
  Mode: 'Selects the behavior mode for this object or component.',
  'Depth Sort mode':
    'Chooses which quad rule is used for Y sorting, or disables Y sorting so layer order stays fully manual.',
  'Grid X': 'Number of vertical subdivisions in the retro grid effect.',
  'Grid Y': 'Number of horizontal subdivisions in the retro grid effect.',
  Width: 'Line width or stroke width used by the current visual effect.',
  'Grid Color': 'Color used to draw the retro grid lines.',
  ID: 'Unique identifier used by the engine, scripts, references, and file operations.',
  'ID/File':
    'Unique scene identifier and file path key. Slashes create subfolders when the scene is saved.',
  Title:
    'Text-asset title shown to the player and used by the text layer as the friendly name for this object or scene.',
  'Key Item ID': 'Inventory item ID required to unlock or activate this interaction.',
  Description:
    'Player-facing short description used by text interactions and subscene presentation.',
  'Target ID(s)':
    'One or more target group IDs or object IDs affected by this component or interaction.',
  'Target ID(s) (Optional)':
    'Optional target IDs affected by this component. Leave empty when the component should only provide auxiliary behavior.',
  'Target Trigger (Name/ID)':
    'Name or ID of the triggerbox that this helper area should activate as if it were clicked directly.',
  'Target(s) 1': 'Targets used when the switch is in state 1, usually the closed or default state.',
  'Target(s) 2': 'Targets used when the switch is in state 2, usually the open or alternate state.',
  'Sound 1': 'Sound played when the switch moves into state 1.',
  'Sound 2': 'Sound played when the switch moves into state 2.',
  State: 'Current switch state used as the starting state in the editor and at runtime.',
  Transparent:
    'If enabled, closed contents remain visible to LOOK, but stay blocked for interaction until the switch opens.',
  'Clearly Openable':
    'If enabled, closed contents report that their container is closed instead of using generic hidden or unreachable wording.',
  'Shadow Quad ID': 'Quad that receives or shapes this shadow effect.',
  'Offset X': 'Horizontal offset applied by the component or effect.',
  'Offset Y': 'Vertical offset applied by the component or effect.',
  'Trigger ID(s) (Zone)':
    'Trigger IDs that enable, disable, or otherwise gate this component in specific zones.',
  Axis: 'Axis constrained by the component or comparison rule.',
  Op: 'Comparison operator used by the current component or condition.',
  'Culling Type':
    'Chooses how the object is culled or hidden when it falls outside the active visibility rule.',
  'Vert A (0-3)': 'First quad vertex index used by this link or rule.',
  'Vert B (0-3)': 'Second quad vertex index used by this link or rule.',
  Direction: 'Default facing direction for the actor.',
  'Move Speed': 'Actor movement speed in scene units per step.',
  'Anim Speed (ms)': 'Frame duration for sprite animation playback, in milliseconds.',
  'Cam X': 'Current camera X position in scene space.',
  'Cam Y': 'Current camera Y position in scene space.',
  Zoom: 'Current scene camera zoom.',
  'Auto-Center on Player':
    'Automatically keeps the camera centered on the player instead of relying on manual camera values.',
  'Cam Spd': 'Camera follow speed when auto-centering or camera tracking is active.',
  'Dead X': 'Horizontal deadzone before camera follow begins.',
  'Dead Y': 'Vertical deadzone before camera follow begins.',
  'Min X': 'Minimum allowed X value for this camera range.',
  'Max X': 'Maximum allowed X value for this camera range.',
  'Min Y': 'Minimum allowed Y value for this camera range.',
  'Max Y': 'Maximum allowed Y value for this camera range.',
  'Def X': 'Default camera X used when the scene loads or resets.',
  'Def Y': 'Default camera Y used when the scene loads or resets.',
  'Def Zoom': 'Default camera zoom used when the scene loads or resets.',
  'Enable Depth Scaling':
    'Turns scene depth scaling on or off so objects can grow or shrink according to their Y position.',
  Min: 'Minimum depth-scaling factor used at the horizon end of the scene.',
  Max: 'Maximum depth-scaling factor used at the front end of the scene.',
  'Horizon Y': 'Y coordinate treated as the horizon for depth scaling.',
  'Front Y': 'Y coordinate treated as the foreground limit for depth scaling.',
  'UI Scale': 'Editor interface scale multiplier.',
  'Game Zoom':
    'Scales the game viewport inside the application window. Fit uses the largest size that still stays fully visible.',
  Curvature: 'Strength of the CRT screen curvature effect.',
  Vignette: 'Darkening applied toward the screen edges.',
  'Scanline Count': 'Number of scanlines used by the CRT filter.',
  'Scanline Intensity': 'Visibility strength of the CRT scanlines.',
  'RGB Split': 'Amount of RGB channel separation in the CRT effect.',
  Bloom: 'Glow intensity added by the CRT effect.',
  'Phosphor / Grain': 'Amount of phosphor persistence and grain noise.',
  'Enable CRT Filter': 'Turns the CRT post-processing effect on or off.',
  'Bezel Glow': 'Adds a glow around the virtual CRT bezel.',
  'Lock Object': 'Prevents accidental editing of this object in the editor. Hotkey: Alt-L.',
  Disabled: 'Disables the object so it does not participate in the scene. Hotkey: Alt-D.',
  'Retro Grid':
    'Enables the retro grid line overlay for this quad. It is also useful for alignment, because objects can snap to grid nodes while Alt is held.',
};

const normalizeTooltipLabelText = (rawText: string): string => {
  const text = rawText.replace(/\s+/g, ' ').trim();
  if (!text) return '';
  if (text.startsWith('Opacity')) return 'Opacity';
  if (text.startsWith('Blur')) return 'Blur';
  if (text.startsWith('UI Scale')) return 'UI Scale';
  if (text.startsWith('State')) return 'State';
  if (text.startsWith('Mode:')) return 'Mode';
  if (text === 'Disable Depth Scaling') return 'Disable Depth-scaling';
  return text;
};

export const PropertiesPanel: React.FC = () => {
  const game = useGame();
  const isDesktopRuntime = React.useMemo(() => isTauriRuntime(), []);
  const {
    selectedObjectId,
    selectedObjectType,
    incrementHierarchyVersion,
    incrementObjectVersion,
    objectVersion,
    mode,
    selectedVertexIndex,
  } = useEditorStore();
  const [groupIdDraft, setGroupIdDraft] = React.useState('');
  const [multiSpatialParentDraft, setMultiSpatialParentDraft] = React.useState('');
  const [multiSpatialRelationDraft, setMultiSpatialRelationDraft] = React.useState('');
  const [resolvedTitle, setResolvedTitle] = React.useState('');
  const [textAssetPath, setTextAssetPath] = React.useState('');
  const [isReadingTA, setIsReadingTA] = React.useState(false);
  const [hasTextAsset, setHasTextAsset] = React.useState(false);
  const [polygonScaleDraft, setPolygonScaleDraft] = React.useState('1');
  const lastUndoObjectKeyRef = React.useRef<string | null>(null);
  const lastUndoMultiKeyRef = React.useRef<string | null>(null);
  const lastPolygonScaleObjectKeyRef = React.useRef<string | null>(null);
  const polygonScaleSnapshotRef = React.useRef<any>(null);
  const panelRef = React.useRef<HTMLDivElement | null>(null);
  const contentRef = React.useRef<HTMLDivElement | null>(null);
  const sectionRefs = React.useRef<Record<number, HTMLDivElement | null>>({});
  const isPanelHoveredRef = React.useRef(false);

  // Derived Object Binding (Source of Truth)
  // We re-render whenever objectVersion changes.
  let obj: any = null;
  void objectVersion;
  if (game) {
    if (selectedObjectId === 'SETTINGS') {
      obj = game.settings;
    } else if (selectedObjectId === 'SCENE') {
      obj = game.sceneManager.currentScene;
    } else if (game.editor && game.editor.selectedObject) {
      obj = game.editor.selectedObject;
    }
  }

  const uiScale = game?.settings?.editor?.uiScale || 1.0;
  const supportsTextAsset =
    selectedObjectType === 'SCENE' ||
    (selectedObjectType !== 'MULTI' &&
      selectedObjectType !== 'SETTINGS' &&
      game?.editor?.selectedObject?.type !== 'Walkbox');
  const multiObjects = React.useMemo(() => {
    void selectedObjectId;
    void objectVersion;
    return game?.editor?.selectionManager?.hasMultiSelection()
      ? game.editor.selectionManager.getSelectedObjects()
      : [];
  }, [game, selectedObjectId, objectVersion]);
  const getSpatialRelationOptions = React.useCallback(
    (hasParent: boolean) =>
      hasParent
        ? SPATIAL_RELATION_OPTIONS.filter((option) => option.value !== '')
        : SPATIAL_RELATION_OPTIONS,
    []
  );

  const getSpatialDescendantNames = React.useCallback(
    (rootNames: string[]) => {
      const scene = game?.sceneManager?.currentScene;
      if (!scene || !rootNames.length) return new Set<string>();

      const allObjects = [...scene.entities, ...scene.walkbox, ...scene.triggerboxes];
      const childrenByParent = new Map<string, string[]>();

      allObjects.forEach((item: any) => {
        const parentId =
          typeof item?.spatial?.parentNodeId === 'string' ? item.spatial.parentNodeId.trim() : '';
        const name = typeof item?.name === 'string' ? item.name.trim() : '';
        if (!parentId || !name) return;
        const children = childrenByParent.get(parentId) || [];
        children.push(name);
        childrenByParent.set(parentId, children);
      });

      const visited = new Set<string>();
      const stack = [...rootNames.filter(Boolean)];
      while (stack.length) {
        const current = stack.pop()!;
        const children = childrenByParent.get(current) || [];
        children.forEach((child) => {
          if (visited.has(child)) return;
          visited.add(child);
          stack.push(child);
        });
      }

      return visited;
    },
    [game]
  );

  const getSceneSpatialParentOptions = React.useCallback(() => {
    const scene = game?.sceneManager?.currentScene;
    if (!scene || !obj) {
      return [{ value: '', label: '(None)' }];
    }

    const excludedNames = new Set<string>([obj?.name].filter(Boolean));
    getSpatialDescendantNames([obj?.name]).forEach((name) => excludedNames.add(name));

    const allObjects = [...scene.entities, ...scene.walkbox, ...scene.triggerboxes];
    const options = allObjects
      .filter((item: any) => item && !excludedNames.has(item.name))
      .map((item: any) => ({
        value: item.name,
        label: item.customName?.trim() || item.name,
      }));

    return [{ value: '', label: '(None)' }, ...options];
  }, [game, obj, getSpatialDescendantNames]);

  const getMultiSpatialParentOptions = React.useCallback(() => {
    const scene = game?.sceneManager?.currentScene;
    if (!scene || !multiObjects.length) {
      return [{ value: '', label: '(None)' }];
    }

    const selectedNames = new Set(multiObjects.map((item: any) => item?.name).filter(Boolean));
    getSpatialDescendantNames(Array.from(selectedNames)).forEach((name) => selectedNames.add(name));

    const allObjects = [...scene.entities, ...scene.walkbox, ...scene.triggerboxes];
    const options = allObjects
      .filter((item: any) => item && !selectedNames.has(item.name))
      .map((item: any) => ({
        value: item.name,
        label: item.customName?.trim() || item.name,
      }));

    return [{ value: '', label: '(None)' }, ...options];
  }, [game, multiObjects, getSpatialDescendantNames]);

  const getSharedValue = React.useCallback((arr: any[], getter: (o: any) => any) => {
    if (!arr.length) return '';
    const first = getter(arr[0]);
    for (let i = 1; i < arr.length; i++) {
      if (getter(arr[i]) !== first) return '';
    }
    return first ?? '';
  }, []);

  const getSharedBooleanState = (arr: any[], getter: (o: any) => boolean) => {
    if (!arr.length) return 'off';
    const first = !!getter(arr[0]);
    for (let i = 1; i < arr.length; i++) {
      if (!!getter(arr[i]) !== first) return 'mixed';
    }
    return first ? 'on' : 'off';
  };

  const formatPanelNumber = React.useCallback((value: any): number | string => {
    if (value === '' || value === null || value === undefined) return '';
    const n = Number(value);
    if (!Number.isFinite(n)) return value;
    return Number(n.toFixed(3));
  }, []);

  const setSectionRef = React.useCallback(
    (section: number) => (node: HTMLDivElement | null) => {
      sectionRefs.current[section] = node;
    },
    []
  );

  const scrollToSection = React.useCallback((section: number) => {
    const container = contentRef.current;
    const node = sectionRefs.current[section];
    if (!container || !node) return;
    const containerRect = container.getBoundingClientRect();
    const nodeRect = node.getBoundingClientRect();
    const targetTop = container.scrollTop + (nodeRect.top - containerRect.top) - 8;
    container.scrollTo({
      top: Math.max(0, targetTop),
      behavior: 'smooth',
    });
  }, []);

  const isPanelTextEntryFocused = React.useCallback(() => {
    const active = document.activeElement as HTMLElement | null;
    if (!active || !panelRef.current || !panelRef.current.contains(active)) return false;
    if (active.matches('input, textarea, select, [contenteditable="true"]')) return true;
    if (active.closest('.custom-select-container')) return true;
    return false;
  }, []);

  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isPanelHoveredRef.current) return;
      if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
      if (isPanelTextEntryFocused()) return;

      const key = e.key;
      if (!/^[0-6]$/.test(key)) return;

      e.preventDefault();
      scrollToSection(parseInt(key, 10));
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isPanelTextEntryFocused, scrollToSection]);

  React.useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;

    const labels = panel.querySelectorAll('label.e-label');
    labels.forEach((node) => {
      const label = node as HTMLLabelElement;
      if (label.dataset.tooltipFixed === 'true') {
        label.classList.add('e-tooltip-label');
        return;
      }

      const normalized = normalizeTooltipLabelText(label.textContent || '');
      const tooltip = PROPERTIES_LABEL_TOOLTIPS[normalized];
      if (!tooltip) {
        label.removeAttribute('title');
        label.classList.remove('e-tooltip-label');
        return;
      }

      label.title = tooltip;
      label.classList.add('e-tooltip-label');
    });
  });

  const getPolyCentroid = React.useCallback((poly: { x: number; y: number }[] = []) => {
    if (!poly.length) return { x: 0, y: 0 };
    const sum = poly.reduce((acc, pt) => ({ x: acc.x + pt.x, y: acc.y + pt.y }), { x: 0, y: 0 });
    return { x: sum.x / poly.length, y: sum.y / poly.length };
  }, []);

  const translatePolyTo = React.useCallback(
    (targetX: number, targetY: number) => {
      if (!obj?.poly?.length) return;
      const centroid = getPolyCentroid(obj.poly);
      const dx = targetX - centroid.x;
      const dy = targetY - centroid.y;
      obj.poly = obj.poly.map((pt: any) => ({
        x: Math.round(pt.x + dx),
        y: Math.round(pt.y + dy),
      }));
      incrementObjectVersion();
    },
    [getPolyCentroid, incrementObjectVersion, obj]
  );

  const getQuadCentroid = React.useCallback((quad: any) => {
    const verts = quad?.vertices || [];
    if (!verts.length) return { x: quad?.x || 0, y: quad?.y || 0 };
    const sum = verts.reduce((acc: any, v: any) => ({ x: acc.x + v.x, y: acc.y + v.y }), {
      x: 0,
      y: 0,
    });
    return { x: sum.x / verts.length, y: sum.y / verts.length };
  }, []);

  const translateQuadTo = React.useCallback(
    (targetX: number, targetY: number) => {
      if (!obj?.vertices?.length) return;
      const centroid = getQuadCentroid(obj);
      const dx = targetX - centroid.x;
      const dy = targetY - centroid.y;
      obj.vertices = obj.vertices.map((v: any) => ({
        ...v,
        x: v.x + dx,
        y: v.y + dy,
      }));
      obj.x = targetX;
      obj.y = targetY;
      incrementObjectVersion();
    },
    [getQuadCentroid, incrementObjectVersion, obj]
  );

  const scalePolyByFactor = React.useCallback(
    (poly: { x: number; y: number }[], factor: number, originX: number, originY: number) =>
      poly.map((pt) => ({
        x: Math.round(originX + (pt.x - originX) * factor),
        y: Math.round(originY + (pt.y - originY) * factor),
      })),
    []
  );

  const scaleQuadVerticesByFactor = React.useCallback(
    (vertices: any[], factor: number, originX: number, originY: number) =>
      vertices.map((v) => ({
        ...v,
        x: originX + (v.x - originX) * factor,
        y: originY + (v.y - originY) * factor,
      })),
    []
  );

  const applyPolygonScaleDraft = React.useCallback(
    (nextScaleRaw: string) => {
      if (!obj || !(selectedObjectType === 'Triggerbox' || selectedObjectType === 'Quad')) return;
      const nextScale = parseFloat(nextScaleRaw);
      if (!Number.isFinite(nextScale) || nextScale <= 0) return;

      const objectKey = `${selectedObjectType || 'Object'}:${obj.name || ''}`;
      if (lastPolygonScaleObjectKeyRef.current !== objectKey) {
        game?.editor?.saveUndoState();
        if (selectedObjectType === 'Quad' && obj.vertices?.length) {
          polygonScaleSnapshotRef.current = {
            key: objectKey,
            kind: 'quad',
            vertices: obj.vertices.map((v: any) => ({ ...v })),
          };
        } else if (obj.poly?.length) {
          polygonScaleSnapshotRef.current = {
            key: objectKey,
            kind: 'poly',
            poly: obj.poly.map((pt: any) => ({ x: pt.x, y: pt.y })),
          };
        } else {
          polygonScaleSnapshotRef.current = null;
        }
      }

      const snapshot = polygonScaleSnapshotRef.current;
      if (!snapshot || snapshot.key !== objectKey) {
        setPolygonScaleDraft(nextScaleRaw);
        lastPolygonScaleObjectKeyRef.current = objectKey;
        return;
      }

      if (snapshot.kind === 'quad' && selectedObjectType === 'Quad' && snapshot.vertices?.length) {
        const sourceVertices = snapshot.vertices.map((v: any) => ({ ...v }));
        const sourceCentroid = {
          x: sourceVertices.reduce((acc: number, v: any) => acc + v.x, 0) / sourceVertices.length,
          y: sourceVertices.reduce((acc: number, v: any) => acc + v.y, 0) / sourceVertices.length,
        };
        obj.vertices = scaleQuadVerticesByFactor(
          sourceVertices,
          nextScale,
          sourceCentroid.x,
          sourceCentroid.y
        );
        obj.x = Math.round(
          obj.vertices.reduce((acc: number, v: any) => acc + v.x, 0) / obj.vertices.length
        );
        obj.y = Math.round(
          obj.vertices.reduce((acc: number, v: any) => acc + v.y, 0) / obj.vertices.length
        );
      } else if (snapshot.kind === 'poly' && snapshot.poly?.length) {
        const sourcePoly = snapshot.poly.map((pt: any) => ({ x: pt.x, y: pt.y }));
        const sourceCentroid = getPolyCentroid(sourcePoly);
        obj.poly = scalePolyByFactor(sourcePoly, nextScale, sourceCentroid.x, sourceCentroid.y);
      }

      setPolygonScaleDraft(nextScaleRaw);
      lastPolygonScaleObjectKeyRef.current = objectKey;
      incrementObjectVersion();
    },
    [
      game,
      getPolyCentroid,
      incrementObjectVersion,
      obj,
      scalePolyByFactor,
      scaleQuadVerticesByFactor,
      selectedObjectType,
    ]
  );

  const applyToMulti = (fn: (o: any) => void) => {
    const multiKey = `MULTI:${multiObjects
      .map((item: any) => item?.name || '')
      .filter(Boolean)
      .join('|')}`;
    if (game?.editor && lastUndoMultiKeyRef.current !== multiKey) {
      game.editor.saveUndoState();
      lastUndoMultiKeyRef.current = multiKey;
    }
    multiObjects.forEach(fn);
    incrementObjectVersion();
    incrementHierarchyVersion();
  };

  const applyToMultiRoots = (fn: (o: any) => void) => {
    const multiKey = `MULTI:${multiObjects
      .map((item: any) => item?.name || '')
      .filter(Boolean)
      .join('|')}`;
    if (game?.editor && lastUndoMultiKeyRef.current !== multiKey) {
      game.editor.saveUndoState();
      lastUndoMultiKeyRef.current = multiKey;
    }
    const selectedNames = new Set(multiObjects.map((item: any) => item?.name).filter(Boolean));
    multiObjects.forEach((o: any) => {
      const parentId =
        typeof o?.spatial?.parentNodeId === 'string' ? o.spatial.parentNodeId.trim() : '';
      if (parentId && selectedNames.has(parentId)) return;
      fn(o);
    });
    incrementObjectVersion();
    incrementHierarchyVersion();
  };

  React.useEffect(() => {
    if (selectedObjectType !== 'MULTI' || multiObjects.length <= 1) {
      setMultiSpatialParentDraft('');
      setMultiSpatialRelationDraft('');
      return;
    }

    const sharedParent = getSharedValue(multiObjects, (o: any) => o.spatial?.parentNodeId || '');
    const sharedRelation = getSharedValue(multiObjects, (o: any) =>
      o.spatial?.parentNodeId ? o.spatial?.relation || 'in' : o.spatial?.relation || ''
    );

    setMultiSpatialParentDraft(sharedParent === '' ? '' : sharedParent);
    setMultiSpatialRelationDraft(sharedRelation === '' ? '' : sharedRelation);
  }, [selectedObjectType, selectedObjectId, objectVersion, multiObjects, getSharedValue]);

  React.useEffect(() => {
    setPolygonScaleDraft('1');
    lastPolygonScaleObjectKeyRef.current = null;
    polygonScaleSnapshotRef.current = null;
  }, [selectedObjectType, selectedObjectId]);

  const loadResolvedTitle = React.useCallback(
    async (forceReload: boolean = false) => {
      if (!game || !obj || selectedObjectType === 'MULTI' || selectedObjectType === 'SETTINGS') {
        setResolvedTitle('');
        setTextAssetPath('');
        setHasTextAsset(false);
        return;
      }

      if (!supportsTextAsset) {
        setResolvedTitle('');
        setTextAssetPath('');
        setHasTextAsset(false);
        return;
      }

      if (selectedObjectType === 'SCENE') {
        const scene = game.sceneManager.currentScene;
        if (!scene) return;
        const asset = forceReload
          ? await game.textAssets.readSceneAsset(scene, true)
          : await game.textAssets.readSceneAsset(scene, false);
        setHasTextAsset(!!asset);
        setResolvedTitle(game.textAssets.getResolvedSceneField(scene, 'title') || '');
        setTextAssetPath(game.textAssets.getSceneAssetProjectPath(scene.id));
        return;
      }

      if (game.editor?.selectedObject) {
        const selected = game.editor.selectedObject;
        const asset = forceReload
          ? await game.textAssets.readObjectAsset(selected, true)
          : await game.textAssets.readObjectAsset(selected, false);
        setHasTextAsset(!!asset);
        setResolvedTitle(game.textAssets.getResolvedObjectField(selected, 'title') || '');
        setTextAssetPath(game.textAssets.getObjectAssetProjectPath(selected.name));
      }
    },
    [game, obj, selectedObjectType, supportsTextAsset]
  );

  React.useEffect(() => {
    loadResolvedTitle(false).catch((err) => {
      console.error('Failed to load text asset title:', err);
    });
  }, [loadResolvedTitle, selectedObjectId, selectedObjectType]);

  const handleOpenTA = async () => {
    if (!game || !obj) return;
    try {
      if (selectedObjectType === 'SCENE') {
        const scene = game.sceneManager.currentScene;
        if (!scene) return;
        await game.textAssets.openSceneAsset(scene);
      } else if (game.editor?.selectedObject) {
        await game.textAssets.openObjectAsset(game.editor.selectedObject);
      }
      await loadResolvedTitle(true);
    } catch (err) {
      console.error('Failed to open text asset:', err);
      game.showNotification?.(`Failed to open TA: ${err}`);
    }
  };

  const handleReadTA = async () => {
    if (!game || !obj) return;
    setIsReadingTA(true);
    try {
      const path =
        selectedObjectType === 'SCENE'
          ? game.textAssets.getSceneAssetProjectPath(game.sceneManager.currentScene?.id || '')
          : game.editor?.selectedObject
            ? game.textAssets.getObjectAssetProjectPath(game.editor.selectedObject.name)
            : '';
      const defaultContent =
        selectedObjectType === 'SCENE'
          ? JSON.stringify(
              game.textAssets.buildDefaultSceneAsset(game.sceneManager.currentScene as any),
              null,
              2
            )
          : game.editor?.selectedObject
            ? JSON.stringify(
                game.textAssets.buildDefaultObjectAsset(game.editor.selectedObject),
                null,
                2
              )
            : '{}';

      await readProjectFile(path, defaultContent);
      await loadResolvedTitle(true);
      incrementObjectVersion();
      game.showNotification?.('Text asset reloaded');
    } catch (err) {
      console.error('Failed to read text asset:', err);
      game.showNotification?.(`Failed to read TA: ${err}`);
    } finally {
      setIsReadingTA(false);
    }
  };

  const handleDeleteTA = async () => {
    if (!game || !obj || !hasTextAsset) return;
    const confirmed = window.confirm(`Delete text asset?\n${textAssetPath}`);
    if (!confirmed) return;

    try {
      if (selectedObjectType === 'SCENE') {
        const scene = game.sceneManager.currentScene;
        if (!scene) return;
        await game.textAssets.deleteSceneAsset(scene);
      } else if (game.editor?.selectedObject) {
        await game.textAssets.deleteObjectAsset(game.editor.selectedObject);
      }
      await loadResolvedTitle(true);
      incrementObjectVersion();
      game.showNotification?.('Text asset deleted');
    } catch (err) {
      console.error('Failed to delete text asset:', err);
      game.showNotification?.(`Failed to delete TA: ${err}`);
    }
  };

  const renderSection = (
    section: number,
    title: string | null,
    color: 'blue' | 'red' | 'yellow' | 'purple' | 'neutral',
    children: React.ReactNode
  ) => (
    <div ref={setSectionRef(section)} className="properties-section-block" data-section={section}>
      {title !== null && (
        <div className={`properties-section-header properties-section-${color}`}>
          <div className="properties-section-title">
            <span className={`properties-section-number properties-section-${color}`}>
              {section}
            </span>
            <span className="properties-section-label">{title}</span>
          </div>
        </div>
      )}
      {children}
    </div>
  );

  const renderOpacityBlurControls = (
    opacityValue: number | '',
    blurValue: number | '',
    onOpacityChange: (nextOpacity: number) => void,
    onBlurChange: (nextBlur: number) => void
  ) => {
    const normalizedOpacity = opacityValue === '' ? 1 : Number(opacityValue);
    const normalizedBlur = blurValue === '' ? 0 : Number(blurValue);
    const opacityUi = Math.round((1 - normalizedOpacity) * 100);
    const blurUi = Math.max(0, Math.min(50, Math.round(normalizedBlur)));

    return (
      <div
        className="e-row"
        style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}
      >
        <div>
          <label className="e-label">Opacity ({opacityUi}%)</label>
          <input
            type="range"
            className="e-input"
            style={{ width: '100%' }}
            min="0"
            max="100"
            step="5"
            value={opacityUi}
            onChange={(e) => onOpacityChange(1 - parseInt(e.target.value, 10) / 100)}
          />
        </div>
        <div>
          <label className="e-label">Blur ({blurUi}px)</label>
          <input
            type="range"
            className="e-input"
            style={{ width: '100%' }}
            min="0"
            max="50"
            step="1"
            value={blurUi}
            onChange={(e) => onBlurChange(parseInt(e.target.value, 10))}
          />
        </div>
      </div>
    );
  };

  React.useEffect(() => {
    lastUndoObjectKeyRef.current = null;
    lastUndoMultiKeyRef.current = null;
    if (selectedObjectType !== 'MULTI') {
      setGroupIdDraft('');
    }
  }, [selectedObjectType, selectedObjectId]);

  if (!obj || !game) {
    return (
      <div
        ref={panelRef}
        id="editor-panel"
        className="editor-sidebar right"
        onMouseEnter={() => {
          isPanelHoveredRef.current = true;
          if (game) game.isMouseOverUI = true;
        }}
        onMouseLeave={() => {
          isPanelHoveredRef.current = false;
          if (game) game.isMouseOverUI = false;
        }}
        onBlurCapture={() => {
          lastUndoObjectKeyRef.current = null;
          lastUndoMultiKeyRef.current = null;
        }}
        style={{ fontSize: `${12 * uiScale}px` }}
      >
        <div className="editor-header">
          <span>{selectedObjectId === 'SETTINGS' ? 'SETTINGS (Loading...)' : 'PROPERTIES'}</span>
        </div>
        <div ref={contentRef} className="editor-content ui-text-muted ui-text-italic">
          {selectedObjectId === 'SETTINGS' ? 'Loading Settings...' : 'No Selection'}
        </div>
      </div>
    );
  }

  if (selectedObjectType === 'MULTI' && multiObjects.length > 1) {
    const group = game.editor.selectionManager.getGroupTransform();
    const entitiesAndQuads = multiObjects.filter((o: any) => o instanceof Entity);
    const parallaxObjects = multiObjects.filter(
      (o: any) => o instanceof Entity || o instanceof Triggerbox || (o as any).type === 'Quad'
    );
    const quads = multiObjects.filter((o: any) => (o as any).type === 'Quad');
    const sharedLayer = getSharedValue(multiObjects, (o) => o.layer ?? 0);
    const sharedParallax = getSharedValue(parallaxObjects, (o: any) => o.parallax ?? 1);
    const sharedBlendMode = getSharedValue(
      entitiesAndQuads,
      (o: any) => o.blendMode || 'source-over'
    );
    const sharedOpacity = getSharedValue(entitiesAndQuads, (o: any) => o.opacity ?? 1);
    const sharedBlur = getSharedValue(entitiesAndQuads, (o: any) => o.blur || 0);
    const sharedColor = getSharedValue(
      multiObjects.filter((o: any) => (o as any).color !== undefined),
      (o: any) => o.color || '#ffffff'
    );
    const sharedIsGrid = getSharedBooleanState(quads, (q: any) => !!q.isGrid);
    const sharedGridX = getSharedValue(quads, (q: any) => q.gridLinesX ?? 5);
    const sharedGridY = getSharedValue(quads, (q: any) => q.gridLinesY ?? 5);
    const sharedGridWidth = getSharedValue(quads, (q: any) => q.lineWidth ?? 1.0);
    const sharedGridColor = getSharedValue(quads, (q: any) => q.gridColor || '#ffffff');
    const sharedIgnoreScaling = getSharedBooleanState(
      entitiesAndQuads,
      (o: any) => !!o.ignoreScaling
    );
    const sharedParentNodeId = getSharedValue(
      multiObjects,
      (o: any) => o.spatial?.parentNodeId || ''
    );
    const sharedLocked = getSharedBooleanState(multiObjects, (o: any) => !!o.locked);
    const sharedDisabled = getSharedBooleanState(multiObjects, (o: any) => !!o.disabled);

    return (
      <div
        ref={panelRef}
        id="editor-panel"
        className="editor-sidebar right"
        onMouseEnter={() => {
          isPanelHoveredRef.current = true;
          if (game) game.isMouseOverUI = true;
        }}
        onMouseLeave={() => {
          isPanelHoveredRef.current = false;
          if (game) game.isMouseOverUI = false;
        }}
        onBlurCapture={() => {
          lastUndoObjectKeyRef.current = null;
          lastUndoMultiKeyRef.current = null;
        }}
        style={{ fontSize: `${12 * uiScale}px` }}
      >
        <div className="editor-header">
          <span>MULTI SELECTION ({multiObjects.length})</span>
          <button className="e-btn" onClick={() => useEditorStore.getState().toggle(false)}>
            X
          </button>
        </div>
        <div ref={contentRef} className="editor-content">
          {renderSection(
            0,
            null,
            'neutral',
            <>
              <div className="e-row">
                <label
                  className="e-label"
                  data-tooltip-fixed="true"
                  title="Use this field to add or remove group #ID tags for all selected objects at once."
                >
                  Group #ID
                </label>
                <div className="e-label ui-text-muted ui-text-small">
                  (&lt;Enter&gt; = append, &lt;Ctrl+Enter&gt; = remove)
                </div>
                <input
                  type="text"
                  className="e-input"
                  value={groupIdDraft}
                  placeholder="#group"
                  onChange={(e) => setGroupIdDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key !== 'Enter') return;
                    e.preventDefault();
                    const raw = groupIdDraft.trim();
                    if (!raw) return;
                    const prepared = raw
                      .split(',')
                      .map((x) => x.trim())
                      .filter(Boolean)
                      .map((x) => (x.startsWith('#') ? x : `#${x}`));

                    let changedCount = 0;
                    multiObjects.forEach((o: any) => {
                      const existing = (o.groupID || '')
                        .split(',')
                        .map((x: string) => x.trim())
                        .filter(Boolean);

                      if (e.ctrlKey) {
                        const filtered = existing.filter((x: string) => !prepared.includes(x));
                        if (filtered.length !== existing.length) changedCount++;
                        o.groupID = filtered.join(',');
                        return;
                      }

                      const merged = [...new Set([...existing, ...prepared])];
                      if (merged.length !== existing.length) changedCount++;
                      o.groupID = merged.join(',');
                    });

                    if (changedCount > 0) {
                      const multiKey = `MULTI:${multiObjects
                        .map((item: any) => item?.name || '')
                        .filter(Boolean)
                        .join('|')}`;
                      if (game?.editor && lastUndoMultiKeyRef.current !== multiKey) {
                        game.editor.saveUndoState();
                        lastUndoMultiKeyRef.current = multiKey;
                      }
                      incrementObjectVersion();
                      incrementHierarchyVersion();
                      const tagsText = prepared.join(', ');
                      if (e.ctrlKey) {
                        game.showNotification(
                          `Removed ${tagsText} from ${changedCount} object${changedCount === 1 ? '' : 's'}`
                        );
                      } else {
                        game.showNotification(
                          `Appended ${tagsText} to ${changedCount} object${changedCount === 1 ? '' : 's'}`
                        );
                      }
                    }
                    setGroupIdDraft('');
                  }}
                />
              </div>

              <div className="e-row">
                <label className="e-label">Parent</label>
                <Select
                  className="parent-id-select"
                  value={multiSpatialParentDraft}
                  onChange={(value) => {
                    const nextRelation = !value ? '' : multiSpatialRelationDraft || 'in';
                    setMultiSpatialParentDraft(value || '');
                    setMultiSpatialRelationDraft(nextRelation);
                    applyToMultiRoots((o: any) => {
                      o.spatial = {
                        ...(o.spatial || {}),
                        parentNodeId: value || null,
                        relation: value ? nextRelation || 'in' : null,
                      };
                    });
                  }}
                  options={getMultiSpatialParentOptions()}
                  style={{ width: '100%' }}
                />
              </div>

              {sharedParentNodeId && (
                <div className="e-row">
                  <label className="e-label">Relation</label>
                  <Select
                    value={multiSpatialRelationDraft}
                    onChange={(value) => {
                      setMultiSpatialRelationDraft(value || '');
                      applyToMultiRoots((o: any) => {
                        o.spatial = {
                          ...(o.spatial || {}),
                          parentNodeId: o.spatial?.parentNodeId || null,
                          relation: value || (o.spatial?.parentNodeId ? 'in' : null),
                        };
                      });
                    }}
                    options={getSpatialRelationOptions(true)}
                    style={{ width: '100%' }}
                  />
                </div>
              )}
            </>
          )}

          {renderSection(
            1,
            'Transform',
            'blue',
            <>
              <div
                className="e-row"
                style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}
              >
                <div>
                  <label className="e-label">Group X</label>
                  <input
                    type="number"
                    className="e-input"
                    value={formatPanelNumber(group.offsetX)}
                    onChange={(e) => {
                      const multiKey = `MULTI:${multiObjects
                        .map((item: any) => item?.name || '')
                        .filter(Boolean)
                        .join('|')}`;
                      if (game?.editor && lastUndoMultiKeyRef.current !== multiKey) {
                        game.editor.saveUndoState();
                        lastUndoMultiKeyRef.current = multiKey;
                      }
                      const x = parseFloat(e.target.value);
                      game.editor.selectionManager.applyGroupTransform(
                        isNaN(x) ? 0 : x,
                        group.offsetY,
                        group.scale
                      );
                      incrementObjectVersion();
                    }}
                  />
                </div>
                <div>
                  <label className="e-label">Group Y</label>
                  <input
                    type="number"
                    className="e-input"
                    value={formatPanelNumber(group.offsetY)}
                    onChange={(e) => {
                      const multiKey = `MULTI:${multiObjects
                        .map((item: any) => item?.name || '')
                        .filter(Boolean)
                        .join('|')}`;
                      if (game?.editor && lastUndoMultiKeyRef.current !== multiKey) {
                        game.editor.saveUndoState();
                        lastUndoMultiKeyRef.current = multiKey;
                      }
                      const y = parseFloat(e.target.value);
                      game.editor.selectionManager.applyGroupTransform(
                        group.offsetX,
                        isNaN(y) ? 0 : y,
                        group.scale
                      );
                      incrementObjectVersion();
                    }}
                  />
                </div>
              </div>

              <div
                className="e-row"
                style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '6px' }}
              >
                <div>
                  <label className="e-label">Group Scale</label>
                  <input
                    type="number"
                    step="0.01"
                    className="e-input"
                    value={formatPanelNumber(group.scale)}
                    onChange={(e) => {
                      const multiKey = `MULTI:${multiObjects
                        .map((item: any) => item?.name || '')
                        .filter(Boolean)
                        .join('|')}`;
                      if (game?.editor && lastUndoMultiKeyRef.current !== multiKey) {
                        game.editor.saveUndoState();
                        lastUndoMultiKeyRef.current = multiKey;
                      }
                      const s = parseFloat(e.target.value);
                      if (isNaN(s) || s <= 0) return;
                      game.editor.selectionManager.applyGroupTransform(
                        group.offsetX,
                        group.offsetY,
                        s
                      );
                      incrementObjectVersion();
                    }}
                  />
                </div>
                <div>
                  <label className="e-label">Layer</label>
                  <input
                    type="number"
                    className="e-input"
                    placeholder="mixed"
                    value={sharedLayer === '' ? '' : formatPanelNumber(sharedLayer)}
                    onChange={(e) => {
                      const v = parseInt(e.target.value);
                      if (isNaN(v)) return;
                      applyToMulti((o) => {
                        o.layer = v;
                      });
                    }}
                  />
                </div>
                <div>
                  {parallaxObjects.length > 0 ? (
                    <>
                      <label className="e-label">Parallax</label>
                      <input
                        type="number"
                        step="0.1"
                        className="e-input ui-text-muted"
                        placeholder="mixed"
                        value={sharedParallax === '' ? '' : formatPanelNumber(sharedParallax)}
                        onChange={(e) => {
                          const v = parseFloat(e.target.value);
                          if (isNaN(v)) return;
                          applyToMulti((o: any) => {
                            if (
                              o instanceof Entity ||
                              o instanceof Triggerbox ||
                              (o as any).type === 'Quad'
                            ) {
                              o.parallax = v;
                            }
                          });
                        }}
                      />
                    </>
                  ) : (
                    <div />
                  )}
                </div>
              </div>

              {entitiesAndQuads.length > 0 && (
                <div className="e-row">
                  <label
                    className="e-label"
                    style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: 0 }}
                  >
                    <input
                      type="checkbox"
                      checked={sharedIgnoreScaling === 'on'}
                      ref={(el) => {
                        if (el) el.indeterminate = sharedIgnoreScaling === 'mixed';
                      }}
                      onChange={(e) => {
                        applyToMulti((o: any) => {
                          if (o instanceof Entity) o.ignoreScaling = e.target.checked;
                        });
                      }}
                    />
                    Disable Depth Scaling
                  </label>
                </div>
              )}
            </>
          )}

          {renderSection(
            2,
            'Visual',
            'yellow',
            <>
              {entitiesAndQuads.length > 0 &&
                renderOpacityBlurControls(
                  sharedOpacity,
                  sharedBlur,
                  (nextOpacity) => {
                    applyToMulti((o: any) => {
                      if (o instanceof Entity) o.opacity = nextOpacity;
                    });
                  },
                  (nextBlur) => {
                    applyToMulti((o: any) => {
                      if (o instanceof Entity) o.blur = nextBlur;
                    });
                  }
                )}

              {entitiesAndQuads.length > 0 && (
                <div
                  className="e-row"
                  style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}
                >
                  <div>
                    <label className="e-label">Fill Color</label>
                    <div style={{ display: 'flex', gap: '5px' }}>
                      <input
                        type="color"
                        className="e-input"
                        style={{ width: '32px', padding: 0 }}
                        value={sharedColor === '' ? '#ffffff' : sharedColor}
                        onChange={(e) => {
                          const v = e.target.value;
                          applyToMulti((o: any) => {
                            if (o.color !== undefined) o.color = v;
                          });
                        }}
                      />
                      <input
                        type="text"
                        className="e-input"
                        placeholder="mixed"
                        value={sharedColor === '' ? '' : sharedColor}
                        onChange={(e) => {
                          const v = e.target.value;
                          applyToMulti((o: any) => {
                            if (o.color !== undefined) o.color = v;
                          });
                        }}
                      />
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'end' }}>
                    <div style={{ width: '100%' }}>
                      <label className="e-label">Blend Mode</label>
                      <Select
                        value={sharedBlendMode === '' ? 'source-over' : sharedBlendMode}
                        onChange={(value) => {
                          applyToMulti((o: any) => {
                            if (o instanceof Entity)
                              o.blendMode = value as GlobalCompositeOperation;
                          });
                        }}
                        options={[
                          { value: 'source-over', label: 'Normal' },
                          { value: 'multiply', label: 'Multiply' },
                          { value: 'screen', label: 'Screen' },
                          { value: 'overlay', label: 'Overlay' },
                          { value: 'lighter', label: 'Add' },
                          { value: 'difference', label: 'Diff' },
                        ]}
                        style={{ width: '100%' }}
                      />
                    </div>
                  </div>
                </div>
              )}

              {quads.length > 0 && (
                <div className="e-row">
                  <label
                    className="e-label"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      color: sharedIsGrid === 'on' ? '#ffffff' : 'inherit',
                    }}
                  >
                    <input
                      type="checkbox"
                      style={{ marginRight: '5px' }}
                      checked={sharedIsGrid === 'on'}
                      ref={(el) => {
                        if (el) el.indeterminate = sharedIsGrid === 'mixed';
                      }}
                      onChange={(e) => {
                        applyToMulti((o: any) => {
                          if ((o as any).type === 'Quad') (o as any).isGrid = e.target.checked;
                        });
                      }}
                    />
                    Retro Grid
                  </label>
                </div>
              )}

              {quads.length > 0 && sharedIsGrid !== 'off' && (
                <>
                  <div
                    className="e-row"
                    style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '5px' }}
                  >
                    <div>
                      <label className="e-label">Grid X</label>
                      <input
                        type="number"
                        className="e-input"
                        placeholder="mixed"
                        value={sharedGridX === '' ? '' : formatPanelNumber(sharedGridX)}
                        onChange={(e) => {
                          const v = parseInt(e.target.value);
                          if (isNaN(v)) return;
                          applyToMulti((o: any) => {
                            if ((o as any).type === 'Quad') (o as any).gridLinesX = v;
                          });
                        }}
                        min={1}
                        max={50}
                      />
                    </div>
                    <div>
                      <label className="e-label">Grid Y</label>
                      <input
                        type="number"
                        className="e-input"
                        placeholder="mixed"
                        value={sharedGridY === '' ? '' : formatPanelNumber(sharedGridY)}
                        onChange={(e) => {
                          const v = parseInt(e.target.value);
                          if (isNaN(v)) return;
                          applyToMulti((o: any) => {
                            if ((o as any).type === 'Quad') (o as any).gridLinesY = v;
                          });
                        }}
                        min={1}
                        max={50}
                      />
                    </div>
                    <div>
                      <label className="e-label">Width</label>
                      <input
                        type="number"
                        className="e-input"
                        placeholder="mixed"
                        value={sharedGridWidth === '' ? '' : formatPanelNumber(sharedGridWidth)}
                        onChange={(e) => {
                          const v = parseFloat(e.target.value);
                          if (isNaN(v)) return;
                          applyToMulti((o: any) => {
                            if ((o as any).type === 'Quad') (o as any).lineWidth = v;
                          });
                        }}
                        step={0.1}
                        min={0.1}
                        max={10}
                      />
                    </div>
                  </div>
                  <div className="e-row">
                    <label className="e-label">Grid Color</label>
                    <div style={{ display: 'flex', gap: '5px' }}>
                      <input
                        type="color"
                        className="e-input"
                        style={{ width: '32px', padding: 0 }}
                        value={sharedGridColor === '' ? '#ffffff' : sharedGridColor}
                        onChange={(e) => {
                          const v = e.target.value;
                          applyToMulti((o: any) => {
                            if ((o as any).type === 'Quad') (o as any).gridColor = v;
                          });
                        }}
                      />
                      <input
                        type="text"
                        className="e-input"
                        placeholder="mixed"
                        value={sharedGridColor === '' ? '' : sharedGridColor}
                        onChange={(e) => {
                          const v = e.target.value;
                          applyToMulti((o: any) => {
                            if ((o as any).type === 'Quad') (o as any).gridColor = v;
                          });
                        }}
                      />
                    </div>
                  </div>
                </>
              )}
            </>
          )}

          {renderSection(
            6,
            null,
            'neutral',
            <>
              <div
                className="e-row"
                style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}
              >
                <label
                  className="e-label"
                  title="Toggle lock hotkey: Alt-L"
                  style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: 0 }}
                >
                  <input
                    type="checkbox"
                    title="Alt-L"
                    checked={sharedLocked === 'on'}
                    ref={(el) => {
                      if (el) el.indeterminate = sharedLocked === 'mixed';
                    }}
                    onChange={(e) => {
                      applyToMulti((o: any) => {
                        o.locked = e.target.checked;
                      });
                    }}
                  />
                  Lock Object
                </label>

                <label
                  className="e-label"
                  title="Toggle disabled hotkey: Alt-D"
                  style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: 0 }}
                >
                  <input
                    type="checkbox"
                    title="Alt-D"
                    checked={sharedDisabled === 'on'}
                    ref={(el) => {
                      if (el) el.indeterminate = sharedDisabled === 'mixed';
                    }}
                    onChange={(e) => {
                      applyToMulti((o: any) => {
                        o.disabled = e.target.checked;
                      });
                    }}
                  />
                  Disabled
                </label>
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  const handleChange = (field: string, value: any, enforceNumber = false) => {
    if (!obj) return;

    if (selectedObjectType !== 'SETTINGS' && game?.editor) {
      const objectKey =
        selectedObjectType === 'SCENE'
          ? `SCENE:${obj.id || ''}`
          : `${selectedObjectType || 'Object'}:${obj.name || ''}`;
      if (lastUndoObjectKeyRef.current !== objectKey) {
        game.editor.saveUndoState();
        lastUndoObjectKeyRef.current = objectKey;
      }
    }

    let finalVal = value;
    if (enforceNumber) {
      finalVal = parseFloat(value);
      if (isNaN(finalVal)) finalVal = 0;
    }

    // Apply directly to the source of truth
    obj[field] = finalVal;

    // Signal update
    incrementObjectVersion();

    // Special handling for Name changes (needs hierarchy refresh)
    if (field === 'name') {
      incrementHierarchyVersion();
    }

    // Special handling for Sprite changes (reload)
    if (field === 'spriteName') {
      if (obj.setSprite) obj.setSprite(finalVal);
    }

    // Special handling for Ignore Scaling (preserve visual size)
    if (field === 'ignoreScaling') {
      const isIgnored = finalVal;
      const scene = game.sceneManager.currentScene;
      if (
        scene &&
        (selectedObjectType === 'Static' ||
          selectedObjectType === 'Actor' ||
          selectedObjectType === 'Entity')
      ) {
        const ent = obj;
        const currentVisW = ent.width;
        const currentVisH = ent.height;
        const modelScale = ent.modelScale || 1.0;

        let targetFactor = modelScale;

        if (!isIgnored) {
          let depthFactor = 1.0;
          if (scene.scaling && scene.scaling.enabled) {
            depthFactor = scene.getScaling(ent.y);
          }
          targetFactor = modelScale * depthFactor;
        }

        if (targetFactor !== 0) {
          ent.baseWidth = currentVisW / targetFactor;
          ent.baseHeight = currentVisH / targetFactor;
        } else {
          ent.baseWidth = currentVisW;
          ent.baseHeight = currentVisH;
        }

        ent.scale = targetFactor;
        // No need to setObj, direct mod is done.
      }
    }

    // Special handling for Animation Speed (Live Update)
    if (field === 'animationSpeed') {
      if (obj.animator) {
        obj.animator.frameDuration = finalVal;
      }
    }
  };

  const isEntityLike =
    selectedObjectType === 'Entity' ||
    selectedObjectType === 'Actor' ||
    selectedObjectType === 'Static';
  const isTriggerbox = selectedObjectType === 'Triggerbox';
  const isWalkbox = selectedObjectType === 'Walkbox';
  const isScene = selectedObjectType === 'SCENE';
  const isSettings = selectedObjectType === 'SETTINGS';
  const isObjectWithScriptEvents =
    !isSettings && !isScene && !isWalkbox && selectedObjectType !== 'MULTI';

  return (
    <div
      ref={panelRef}
      id="editor-panel"
      className="editor-sidebar right"
      onMouseEnter={() => {
        isPanelHoveredRef.current = true;
        if (game) game.isMouseOverUI = true;
      }}
      onMouseLeave={() => {
        isPanelHoveredRef.current = false;
        if (game) game.isMouseOverUI = false;
      }}
      style={{ fontSize: `${12 * uiScale}px` }}
    >
      <div className="editor-header">
        <span>
          {selectedObjectType === 'SETTINGS' ? 'SETTINGS' : selectedObjectType?.toUpperCase()}
        </span>
        <button className="e-btn" onClick={() => useEditorStore.getState().toggle(false)}>
          X
        </button>
      </div>

      <div ref={contentRef} className="editor-content">
        {!isSettings &&
          renderSection(
            0,
            null,
            'neutral',
            <>
              <div className="e-row">
                <label className="e-label">{isScene ? 'ID/File' : 'ID'}</label>
                <input
                  type="text"
                  className="e-input"
                  value={isScene ? obj.id || '' : obj.name || ''}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (isScene) obj.id = val;
                    else obj.name = val;
                    incrementObjectVersion();
                  }}
                  onBlur={(e) => {
                    const rawVal = e.target.value;
                    const finalVal = rawVal.trim();
                    const field = isScene ? 'id' : 'name';

                    let isValid = true;
                    const scene = game?.sceneManager?.currentScene;

                    if (!isScene && scene) {
                      const dupEntity = scene.entities.find(
                        (ent) => ent.name === finalVal && ent !== game?.editor?.selectedObject
                      );
                      const dupTrigger = scene.triggerboxes
                        ? scene.triggerboxes.find(
                            (tb) => tb.name === finalVal && tb !== game?.editor?.selectedObject
                          )
                        : null;

                      if (dupEntity || dupTrigger) {
                        console.warn(`[PropertiesPanel] Duplicate Name '${finalVal}' rejected.`);
                        // @ts-ignore
                        if (game.showMessage)
                          game.showMessage(`Name '${finalVal}' already exists!`);
                        isValid = false;
                      }
                    }

                    if (isValid) {
                      handleChange(field, finalVal);
                    } else {
                      let realObj: any = null;
                      if (game?.editor) realObj = game.editor.selectedObject;

                      if (realObj) {
                        if (isScene) obj.id = realObj.id;
                        else obj.name = realObj.name;
                        incrementObjectVersion();
                      }
                    }
                  }}
                />
              </div>

              {supportsTextAsset && (
                <div className="e-row">
                  <label className="e-label">Title</label>
                  <input
                    type="text"
                    className="e-input"
                    value={resolvedTitle}
                    readOnly
                    tabIndex={-1}
                    onFocus={(e) => e.currentTarget.blur()}
                    style={{ pointerEvents: 'none' }}
                  />
                  {textAssetPath && (
                    <>
                      <div
                        style={{ display: 'flex', gap: '6px', marginTop: '4px', flexWrap: 'wrap' }}
                      >
                        <button className="e-btn" onClick={handleOpenTA}>
                          {hasTextAsset ? 'Open TA' : 'Create TA'}
                        </button>
                        <button className="e-btn" onClick={handleReadTA} disabled={isReadingTA}>
                          {isReadingTA ? 'Syncing...' : 'Sync TA'}
                        </button>
                        {hasTextAsset && (
                          <button className="e-btn" onClick={handleDeleteTA}>
                            Delete TA
                          </button>
                        )}
                      </div>
                      <div className="e-label ui-text-muted ui-text-small">{textAssetPath}</div>
                    </>
                  )}
                </div>
              )}

              {!isScene && !isSettings && (
                <div className="e-row">
                  <label className="e-label">Group #ID</label>
                  <input
                    type="text"
                    className="e-input"
                    value={obj.groupID || ''}
                    onChange={(e) => {
                      const val = e.target.value;
                      const tokens = val.split(',');
                      const newTokens = tokens.map((t) => {
                        if (t.length === 0) return '';

                        let clean = t;
                        const trimmed = t.trimStart();
                        if (trimmed.length > 0 && !trimmed.startsWith('#')) {
                          const firstCharIdx = t.length - trimmed.length;
                          clean = t.substring(0, firstCharIdx) + '#' + trimmed;
                        }
                        return clean;
                      });

                      handleChange('groupID', newTokens.join(','));
                    }}
                  />
                </div>
              )}

              {!isScene && !isSettings && !isWalkbox && (
                <div
                  className="e-row"
                  style={{
                    display: obj.spatial?.parentNodeId ? 'grid' : 'block',
                    gridTemplateColumns: obj.spatial?.parentNodeId ? '1fr 1fr' : undefined,
                    gap: obj.spatial?.parentNodeId ? '5px' : undefined,
                  }}
                >
                  <div>
                    <label className="e-label">Parent</label>
                    <Select
                      className="parent-id-select"
                      value={obj.spatial?.parentNodeId || ''}
                      onChange={(value) => {
                        game.editor.saveUndoState();
                        obj.spatial = {
                          ...(obj.spatial || {}),
                          parentNodeId: value || null,
                          relation: value ? obj.spatial?.relation || 'in' : null,
                        };
                        incrementObjectVersion();
                        incrementHierarchyVersion();
                      }}
                      options={getSceneSpatialParentOptions()}
                      style={{ width: '100%' }}
                    />
                  </div>
                  {obj.spatial?.parentNodeId && (
                    <div>
                      <label className="e-label">Relation</label>
                      <Select
                        value={obj.spatial?.relation || 'in'}
                        onChange={(value) => {
                          game.editor.saveUndoState();
                          obj.spatial = {
                            ...(obj.spatial || {}),
                            parentNodeId: obj.spatial?.parentNodeId || null,
                            relation: value || (obj.spatial?.parentNodeId ? 'in' : null),
                          };
                          incrementObjectVersion();
                          incrementHierarchyVersion();
                        }}
                        options={getSpatialRelationOptions(true)}
                        style={{ width: '100%' }}
                      />
                    </div>
                  )}
                </div>
              )}
            </>
          )}

        {isEntityLike && (
          <>
            {renderSection(
              1,
              'Transform',
              'blue',
              <>
                <div
                  className="e-row"
                  style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '5px' }}
                >
                  <div>
                    <label className="e-label">X</label>
                    <input
                      type="number"
                      className="e-input"
                      value={formatPanelNumber(obj.x ?? 0)}
                      onChange={(e) => handleChange('x', e.target.value, true)}
                    />
                  </div>
                  <div>
                    <label className="e-label">Y</label>
                    <input
                      type="number"
                      className="e-input"
                      value={formatPanelNumber(obj.y ?? 0)}
                      onChange={(e) => handleChange('y', e.target.value, true)}
                    />
                  </div>
                  <div>
                    <label className="e-label">H</label>
                    <input
                      type="number"
                      className="e-input"
                      value={formatPanelNumber(obj.height ?? 0)}
                      onChange={(e) => handleChange('height', e.target.value, true)}
                    />
                  </div>
                  <div>
                    <label className="e-label">W</label>
                    <input
                      type="number"
                      className="e-input"
                      value={formatPanelNumber(obj.width ?? 0)}
                      onChange={(e) => handleChange('width', e.target.value, true)}
                    />
                  </div>
                </div>

                <div
                  className="e-row"
                  style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '5px' }}
                >
                  <div>
                    <label className="e-label">Scale</label>
                    <input
                      type="number"
                      step="0.1"
                      className="e-input"
                      value={formatPanelNumber(obj.modelScale || 1)}
                      onChange={(e) => handleChange('modelScale', e.target.value, true)}
                    />
                  </div>
                  <div>
                    <label className="e-label">Layer</label>
                    <input
                      type="number"
                      className="e-input"
                      value={formatPanelNumber(obj.layer || 0)}
                      onChange={(e) => handleChange('layer', e.target.value, true)}
                    />
                  </div>
                  <div>
                    <label className="e-label">Parallax</label>
                    <input
                      type="number"
                      step="0.1"
                      className="e-input"
                      value={formatPanelNumber(obj.parallax ?? 1)}
                      onChange={(e) => {
                        const val = parseFloat(e.target.value);
                        const newP = isNaN(val) ? 1.0 : val;
                        const oldP = obj.parallax !== undefined ? obj.parallax : 1.0;
                        const scene = game.sceneManager.currentScene;
                        if (scene && game.editor.selectedObject) {
                          const camX = scene.camera.x;
                          const camY = scene.camera.y;
                          obj.x += camX * (newP - oldP);
                          obj.y += camY * (newP - oldP);
                          if (
                            game.editor &&
                            game.editor.selectedObject &&
                            'x' in game.editor.selectedObject
                          ) {
                            (game.editor.selectedObject as any).x = obj.x;
                            (game.editor.selectedObject as any).y = obj.y;
                          }
                        }
                        handleChange('parallax', newP, true);
                      }}
                    />
                  </div>
                </div>

                <div
                  className="e-row"
                  style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '5px' }}
                >
                  <div>
                    <label className="e-label">Collider H</label>
                    <input
                      type="number"
                      className="e-input"
                      value={formatPanelNumber(obj.colliderHeight ?? 0)}
                      onChange={(e) => handleChange('colliderHeight', e.target.value, true)}
                    />
                  </div>
                  <div>
                    <label className="e-label">Collider W</label>
                    <input
                      type="number"
                      className="e-input"
                      value={formatPanelNumber(obj.colliderWidth ?? 0)}
                      onChange={(e) => handleChange('colliderWidth', e.target.value, true)}
                    />
                  </div>
                </div>

                <div className="e-row">
                  <label className="e-label" style={{ display: 'flex', alignItems: 'center' }}>
                    <input
                      type="checkbox"
                      style={{ marginRight: '5px' }}
                      checked={!!obj.ignoreScaling}
                      onChange={(e) => handleChange('ignoreScaling', e.target.checked)}
                    />
                    Disable Depth-scaling
                  </label>
                </div>
              </>
            )}

            {renderSection(
              2,
              'Visual',
              'yellow',
              <>
                <div
                  className="e-row"
                  style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: '5px' }}
                >
                  <div>
                    <label className="e-label">Fill Color</label>
                    <div style={{ display: 'flex', gap: '5px' }}>
                      <input
                        type="color"
                        className="e-input"
                        style={{
                          width: '30px',
                          padding: 0,
                          height: '20px',
                          cursor: 'pointer',
                          border: 'none',
                        }}
                        value={obj.color || '#AAAAAA'}
                        onChange={(e) => handleChange('color', e.target.value)}
                      />
                      <input
                        type="text"
                        className="e-input"
                        style={{ flex: 1, minWidth: 0 }}
                        value={obj.color || ''}
                        onChange={(e) => handleChange('color', e.target.value)}
                      />
                    </div>
                  </div>
                  <div>
                    <label className="e-label">Blend Mode</label>
                    <Select
                      value={obj.blendMode || 'source-over'}
                      onChange={(value) => handleChange('blendMode', value)}
                      options={[
                        { value: 'source-over', label: 'Normal' },
                        { value: 'multiply', label: 'Multiply' },
                        { value: 'screen', label: 'Screen' },
                        { value: 'overlay', label: 'Overlay' },
                        { value: 'lighter', label: 'Add' },
                        { value: 'difference', label: 'Diff' },
                      ]}
                      style={{ width: '100%' }}
                    />
                  </div>
                </div>

                {renderOpacityBlurControls(
                  obj.opacity !== undefined ? obj.opacity : 1.0,
                  obj.blur || 0,
                  (nextOpacity) => handleChange('opacity', nextOpacity, true),
                  (nextBlur) => handleChange('blur', nextBlur)
                )}

                <div className="e-row">
                  <label className="e-label">Sprite</label>
                  <div style={{ display: 'flex', gap: '5px' }}>
                    <input
                      type="text"
                      className="e-input"
                      style={{ flex: 1 }}
                      value={obj.spriteName || ''}
                      onChange={(e) => handleChange('spriteName', e.target.value)}
                    />
                    <button
                      className="e-btn"
                      onClick={() =>
                        game.openFileBrowser('load', 'public/sprites', (f) =>
                          handleChange('spriteName', f)
                        )
                      }
                    >
                      ...
                    </button>
                  </div>
                </div>
              </>
            )}
          </>
        )}

        {selectedObjectType === 'Walkbox' && (
          <div className="e-row">
            <div className="e-row">
              <label className="e-label">Mode</label>
              <Select
                value={obj.mode || 'Invert'}
                onChange={(value) => handleChange('mode', value)}
                options={[
                  { value: 'Invert', label: 'Invert (Standard)' },
                  { value: 'Add', label: 'Add (Bridge)' },
                  { value: 'Subtract', label: 'Subtract (Hole)' },
                ]}
                style={{ width: '100%', marginBottom: '5px' }}
              />
            </div>
            <button
              className="e-btn e-btn-yellow"
              style={{ width: '100%', marginBottom: '5px' }}
              onClick={(e) => {
                if (confirm('Redraw polygon? Current points will be cleared.')) {
                  game.editor.redrawSelected();
                  (e.target as HTMLElement).blur();
                }
              }}
            >
              Redraw Polygon
            </button>
            <div className="e-label">
              {mode && mode.includes('DRAW')
                ? 'Click to add points. Press ENTER to finish. Hold Shift for 22.5° snap.'
                : 'To edit, drag vertices on screen. Hold Shift for 22.5° snap.'}
            </div>
          </div>
        )}

        {isTriggerbox && (
          <>
            {renderSection(
              1,
              'Transform',
              'blue',
              <>
                <div
                  className="e-row"
                  style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '5px' }}
                >
                  <div>
                    <label className="e-label">X</label>
                    <input
                      type="number"
                      className="e-input"
                      value={formatPanelNumber(getPolyCentroid(obj.poly).x)}
                      onChange={(e) =>
                        translatePolyTo(
                          parseFloat(e.target.value) || 0,
                          getPolyCentroid(obj.poly).y
                        )
                      }
                    />
                  </div>
                  <div>
                    <label className="e-label">Y</label>
                    <input
                      type="number"
                      className="e-input"
                      value={formatPanelNumber(getPolyCentroid(obj.poly).y)}
                      onChange={(e) =>
                        translatePolyTo(
                          getPolyCentroid(obj.poly).x,
                          parseFloat(e.target.value) || 0
                        )
                      }
                    />
                  </div>
                </div>
                <div
                  className="e-row"
                  style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '5px' }}
                >
                  <div>
                    <label className="e-label">Scale</label>
                    <input
                      type="number"
                      step="0.01"
                      min="0.01"
                      className="e-input"
                      value={polygonScaleDraft}
                      onChange={(e) => applyPolygonScaleDraft(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="e-label">Layer</label>
                    <input
                      type="number"
                      className="e-input"
                      value={formatPanelNumber(obj.layer || 0)}
                      onChange={(e) => handleChange('layer', e.target.value, true)}
                    />
                  </div>
                  <div>
                    <label className="e-label">Parallax</label>
                    <input
                      type="number"
                      step="0.1"
                      className="e-input"
                      value={formatPanelNumber(obj.parallax ?? 1)}
                      onChange={(e) => {
                        const val = parseFloat(e.target.value);
                        const newP = isNaN(val) ? 1.0 : val;
                        const oldP = obj.parallax !== undefined ? obj.parallax : 1.0;
                        const scene = game.sceneManager.currentScene;
                        if (scene && obj.poly?.length) {
                          const dx = scene.camera.x * (newP - oldP);
                          const dy = scene.camera.y * (newP - oldP);
                          obj.poly = obj.poly.map((pt: any) => ({
                            x: Math.round(pt.x + dx),
                            y: Math.round(pt.y + dy),
                          }));
                        }
                        handleChange('parallax', newP, true);
                      }}
                    />
                  </div>
                </div>
              </>
            )}
          </>
        )}

        {/* Quad Properties */}
        {selectedObjectType === 'Quad' && (
          <div className="e-row">
            <div ref={setSectionRef(1)} className="properties-section-block">
              <div className="properties-section-header properties-section-blue">
                <div className="properties-section-title">
                  <span className="properties-section-number properties-section-blue">1</span>
                  <span className="properties-section-label">Transform</span>
                </div>
              </div>
            </div>

            <div
              className="e-row"
              style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '5px' }}
            >
              <div>
                <label className="e-label">X</label>
                <input
                  type="number"
                  className="e-input"
                  value={formatPanelNumber(getQuadCentroid(obj).x)}
                  onChange={(e) =>
                    translateQuadTo(parseFloat(e.target.value) || 0, getQuadCentroid(obj).y)
                  }
                />
              </div>
              <div>
                <label className="e-label">Y</label>
                <input
                  type="number"
                  className="e-input"
                  value={formatPanelNumber(getQuadCentroid(obj).y)}
                  onChange={(e) =>
                    translateQuadTo(getQuadCentroid(obj).x, parseFloat(e.target.value) || 0)
                  }
                />
              </div>
              <div>
                <label className="e-label">Layer</label>
                <input
                  type="number"
                  className="e-input"
                  value={formatPanelNumber(obj.layer || 0)}
                  onChange={(e) => handleChange('layer', e.target.value, true)}
                />
              </div>
            </div>

            <div
              className="e-row"
              style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '5px' }}
            >
              <div>
                <label className="e-label">Parallax</label>
                <input
                  type="number"
                  step="0.1"
                  className="e-input"
                  value={formatPanelNumber(obj.parallax ?? 1)}
                  onChange={(e) => handleChange('parallax', e.target.value, true)}
                />
              </div>
              <div>
                <label className="e-label">Scale</label>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  className="e-input"
                  value={polygonScaleDraft}
                  onChange={(e) => applyPolygonScaleDraft(e.target.value)}
                />
              </div>
              <div>
                <label className="e-label">Depth Sort mode</label>
                <Select
                  value={obj.sortMode || 'ignore'}
                  onChange={(value) => handleChange('sortMode', value)}
                  options={[
                    { value: 'ignore', label: 'Ignore Y (Manual Layer)' },
                    { value: 'v0', label: 'By Vertex 0 (TL)' },
                    { value: 'v1', label: 'By Vertex 1 (TR)' },
                    { value: 'v2', label: 'By Vertex 2 (BR)' },
                    { value: 'v3', label: 'By Vertex 3 (BL)' },
                  ]}
                  style={{ width: '100%' }}
                />
              </div>
            </div>

            <div
              className="e-label ui-text-accent-blue ui-font-bold"
              style={{ marginTop: '6px', marginBottom: '6px' }}
            >
              Vertices
            </div>
            {obj.vertices &&
              obj.vertices.map((v: any, i: number) => {
                const isSelected = selectedVertexIndex === i;
                return (
                  <div
                    key={i}
                    style={{
                      marginBottom: '5px',
                      background: '#222',
                      padding: '4px',
                      borderRadius: '4px',
                      border: isSelected ? '1px solid yellow' : '1px solid transparent',
                    }}
                  >
                    <div className="ui-text-muted ui-text-tiny" style={{ marginBottom: '2px' }}>
                      Vertex {i}{' '}
                      {i === 0
                        ? '(TL)'
                        : i === 1
                          ? '(TR)'
                          : i === 2
                            ? '(BR)'
                            : i === 3
                              ? '(BL)'
                              : ''}
                      {v.binding && (
                        <span
                          style={{
                            color: '#00FFFF',
                            marginLeft: '5px',
                            display: 'inline-flex',
                            alignItems: 'center',
                          }}
                        >
                          L:
                          {v.binding.targetName.length > 8
                            ? v.binding.targetName.slice(0, 8) + '..'
                            : v.binding.targetName}
                          <button
                            title="Unbind Vertex"
                            style={{
                              background: '#444',
                              border: '1px solid #666',
                              color: '#fff',
                              fontSize: '0.7em',
                              marginLeft: '4px',
                              cursor: 'pointer',
                              padding: '0 4px',
                              borderRadius: '2px',
                              height: '16px',
                              lineHeight: '14px',
                            }}
                            onClick={() => {
                              const binding = v.binding;
                              delete v.binding;
                              incrementObjectVersion();

                              if (game.editor.selectedObject) {
                                const sel = game.editor.selectedObject as any;
                                if (sel.vertices[i].binding) delete sel.vertices[i].binding;

                                if (binding && binding.type === 'vertex') {
                                  const scene = game.sceneManager.currentScene;
                                  if (scene) {
                                    const target = scene.entities.find(
                                      (e: any) => e.name === binding.targetName
                                    );
                                    if (target && (target as any).type === 'Quad') {
                                      const tQuad = target as any;
                                      const tIdx = binding.index;
                                      if (tIdx !== undefined && tQuad.vertices[tIdx]) {
                                        const tV = tQuad.vertices[tIdx];
                                        if (
                                          tV.binding &&
                                          tV.binding.type === 'vertex' &&
                                          tV.binding.targetName === sel.name &&
                                          tV.binding.index === i
                                        ) {
                                          delete tV.binding;
                                        }
                                      }
                                    }
                                  }
                                }

                                game.editor.saveUndoState();
                              }
                            }}
                          >
                            U
                          </button>
                        </span>
                      )}
                    </div>
                    <div style={{ display: 'flex', gap: '2px' }}>
                      <input
                        type="number"
                        className="e-input"
                        style={{ width: '33%' }}
                        value={formatPanelNumber(v.x)}
                        onChange={(e) => {
                          const val = parseFloat(e.target.value);
                          if (v.x !== val) {
                            const diff = val - v.x;
                            const scene = game.sceneManager.currentScene;
                            if (scene && (game.editor.selectedObject as any).type === 'Quad') {
                              const group = QuadObject.getConnectedVertices(
                                scene,
                                game.editor.selectedObject as QuadObject,
                                i
                              );
                              group.forEach((ref) => {
                                ref.v.x += diff;
                              });
                            } else {
                              v.x = val;
                            }

                            incrementObjectVersion();
                            game.editor.saveUndoState();
                          }
                        }}
                      />
                      <input
                        type="number"
                        className="e-input"
                        style={{ width: '33%' }}
                        value={formatPanelNumber(v.y)}
                        onChange={(e) => {
                          const val = parseFloat(e.target.value);
                          if (v.y !== val) {
                            const diff = val - v.y;
                            const scene = game.sceneManager.currentScene;
                            if (scene && (game.editor.selectedObject as any).type === 'Quad') {
                              const group = QuadObject.getConnectedVertices(
                                scene,
                                game.editor.selectedObject as QuadObject,
                                i
                              );
                              group.forEach((ref) => {
                                ref.v.y += diff;
                              });
                            } else {
                              v.y = val;
                            }

                            incrementObjectVersion();
                            game.editor.saveUndoState();
                          }
                        }}
                      />
                      <input
                        type="number"
                        className="e-input"
                        style={{ width: '33%' }}
                        step="0.1"
                        value={formatPanelNumber(v.p)}
                        onChange={(e) => {
                          const newP = parseFloat(e.target.value);
                          const oldP = v.p;
                          const diffP = newP - oldP;

                          const scene = game.sceneManager.currentScene;
                          if (scene && (game.editor.selectedObject as any).type === 'Quad') {
                            const group = QuadObject.getConnectedVertices(
                              scene,
                              game.editor.selectedObject as QuadObject,
                              i
                            );

                            group.forEach((ref) => {
                              const camX = scene.camera.x;
                              const camY = scene.camera.y;
                              ref.v.x += camX * diffP;
                              ref.v.y += camY * diffP;
                              ref.v.p = newP;
                            });
                          } else {
                            if (scene) {
                              const camX = scene.camera.x;
                              const camY = scene.camera.y;
                              v.x += camX * diffP;
                              v.y += camY * diffP;
                            }
                            v.p = newP;
                          }

                          incrementObjectVersion();
                          game.editor.saveUndoState();
                        }}
                      />
                    </div>
                  </div>
                );
              })}

            {/* Opacity / Blur */}
            <div ref={setSectionRef(2)} className="properties-section-block">
              <div className="properties-section-header properties-section-yellow">
                <div className="properties-section-title">
                  <span className="properties-section-number properties-section-yellow">2</span>
                  <span className="properties-section-label">Visual</span>
                </div>
              </div>
            </div>
            {renderOpacityBlurControls(
              obj.opacity !== undefined ? obj.opacity : 1.0,
              obj.blur || 0,
              (nextOpacity) => handleChange('opacity', nextOpacity, true),
              (nextBlur) => handleChange('blur', nextBlur)
            )}

            {/* Fill Color */}
            <div className="e-row">
              <label
                className="e-label"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  marginBottom: '4px',
                  color: obj.filled !== false ? '#ffffff' : 'inherit',
                }}
              >
                <input
                  type="checkbox"
                  style={{ marginRight: '5px' }}
                  checked={obj.filled !== false}
                  onChange={(e) => handleChange('filled', e.target.checked)}
                />
                Fill Color
              </label>
              {obj.filled !== false && (
                <div style={{ display: 'flex', gap: '5px' }}>
                  <input
                    type="color"
                    className="e-input"
                    style={{ width: '30px', padding: 0, height: '20px' }}
                    value={obj.color || '#888888'}
                    onChange={(e) => handleChange('color', e.target.value)}
                  />
                  <input
                    type="text"
                    className="e-input"
                    style={{ flex: 1 }}
                    value={obj.color || ''}
                    onChange={(e) => handleChange('color', e.target.value)}
                  />
                </div>
              )}
            </div>

            {/* Retro Grid */}
            <div className="e-row">
              <label
                className="e-label"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  color: obj.isGrid ? '#ffffff' : 'inherit',
                }}
              >
                <input
                  type="checkbox"
                  style={{ marginRight: '5px' }}
                  checked={obj.isGrid || false}
                  onChange={(e) => handleChange('isGrid', e.target.checked)}
                />
                Retro Grid
              </label>
            </div>

            {obj.isGrid && (
              <>
                <div
                  className="e-row"
                  style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '5px' }}
                >
                  <div>
                    <label className="e-label">Grid X</label>
                    <input
                      type="number"
                      className="e-input"
                      value={formatPanelNumber(obj.gridLinesX ?? 5)}
                      onChange={(e) => handleChange('gridLinesX', parseInt(e.target.value))}
                      min={1}
                      max={50}
                    />
                  </div>
                  <div>
                    <label className="e-label">Grid Y</label>
                    <input
                      type="number"
                      className="e-input"
                      value={formatPanelNumber(obj.gridLinesY ?? 5)}
                      onChange={(e) => handleChange('gridLinesY', parseInt(e.target.value))}
                      min={1}
                      max={50}
                    />
                  </div>
                  <div>
                    <label className="e-label">Width</label>
                    <input
                      type="number"
                      className="e-input"
                      value={formatPanelNumber(obj.lineWidth ?? 1.0)}
                      onChange={(e) => handleChange('lineWidth', parseFloat(e.target.value))}
                      step={0.1}
                      min={0.1}
                      max={10}
                    />
                  </div>
                </div>
                <div className="e-row">
                  <label className="e-label">Grid Color</label>
                  <div style={{ display: 'flex', gap: '5px' }}>
                    <input
                      type="color"
                      className="e-input"
                      style={{ width: '30px', padding: 0, height: '20px' }}
                      value={obj.gridColor || '#ffffff'}
                      onChange={(e) => handleChange('gridColor', e.target.value)}
                    />
                    <input
                      type="text"
                      className="e-input"
                      style={{ flex: 1 }}
                      value={obj.gridColor || ''}
                      onChange={(e) => handleChange('gridColor', e.target.value)}
                    />
                  </div>
                </div>
              </>
            )}

            {/* Blend */}
            <div
              className="e-row"
              style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '5px' }}
            >
              <div>
                <label className="e-label">Blend Mode</label>
                <Select
                  value={obj.blendMode || 'source-over'}
                  onChange={(value) => handleChange('blendMode', value)}
                  options={[
                    { value: 'source-over', label: 'Normal' },
                    { value: 'multiply', label: 'Multiply' },
                    { value: 'screen', label: 'Screen' },
                    { value: 'overlay', label: 'Overlay' },
                    { value: 'lighter', label: 'Add (Lighter)' },
                    { value: 'difference', label: 'Difference' },
                  ]}
                  style={{ width: '100%' }}
                />
              </div>
            </div>
          </div>
        )}

        {/* Trigger Components */}
        {(selectedObjectType === 'Triggerbox' ||
          selectedObjectType === 'Walkbox' ||
          selectedObjectType === 'Entity' ||
          selectedObjectType === 'Actor' ||
          selectedObjectType === 'Static' ||
          selectedObjectType === 'Quad') && (
          <div ref={setSectionRef(3)} className="properties-section-block">
            <div className="properties-section-header properties-section-red">
              <div className="properties-section-title">
                <span className="properties-section-number properties-section-red">3</span>
                <span className="properties-section-label">COMPONENTS</span>
              </div>
              <div className="properties-section-actions">
                <Select
                  options={[
                    { value: 'Item', label: 'Item (Pickup)' },
                    { value: 'Inventory', label: 'Inventory' },
                    { value: 'Surface', label: 'Surface' },
                    { value: 'Subscene', label: 'Subscene' },
                    { value: 'Subtrigger', label: 'Subtrigger' },
                    { value: 'Switch', label: 'Switch' },
                    ...(selectedObjectType === 'Quad'
                      ? [
                          { value: 'Backface', label: 'Backface' },
                          { value: '3d-parallax', label: '3d-parallax' },
                          { value: 'WalkBox', label: 'WalkBox (Collider)' },
                        ]
                      : []),
                    ...(selectedObjectType === 'Actor'
                      ? [{ value: 'Shadow', label: 'Shadow' }]
                      : []),
                  ]}
                  placeholder="+ Add Component"
                  onChange={(value) => {
                    const type = value;
                    if (!type) return;
                    if (game.editor) game.editor.saveUndoState();
                    if (!obj.components) obj.components = [];

                    if (type === 'Subscene') {
                      obj.components.push({
                        type: 'Subscene',
                        targetGroupId: '',
                        itemScale: 1,
                        title: '',
                        description: '',
                      });
                    } else if (type === 'Subtrigger') {
                      obj.components.push({ type: 'Subtrigger', target: '' });
                    } else if (type === 'Item') {
                      obj.components.push({ type: 'Item' });
                    } else if (type === 'Inventory') {
                      obj.components.push({
                        type: 'Inventory',
                        capacity: 8,
                        groups: [],
                        protected: false,
                        items: [],
                      });
                    } else if (type === 'Surface') {
                      obj.components.push({
                        type: 'Surface',
                        capacity: 8,
                        groups: [],
                        items: [],
                      });
                    } else if (type === 'Switch') {
                      obj.components.push({
                        type: 'Switch',
                        groupId1: '',
                        groupId2: '',
                        state: 1,
                        idKey: '',
                        sound1: '',
                        sound2: '',
                        transparent: false,
                        clearlyOpenable: false,
                      });
                    } else if (type === 'Backface') {
                      obj.components.push({
                        type: 'Backface',
                        vertexA: 0,
                        vertexB: 1,
                        axis: 'x',
                        op: '>',
                        targetId: obj.name, // Auto-fill with self
                        cullingType: 'layer', // Default
                      });
                    } else if (type === 'Shadow') {
                      obj.components.push({
                        type: 'Shadow',
                        shadowQuadId: '',
                        offsetX: 0,
                        offsetY: 0,
                        triggerId: '',
                      });
                    } else if (type === '3d-parallax') {
                      obj.components.push({ type: '3d-parallax' });
                    } else if (type === 'WalkBox') {
                      obj.components.push({ type: 'WalkBox', mode: 'Invert' });
                    }

                    if (game.editor.selectedObject) {
                      (game.editor.selectedObject as any).components = obj.components;
                    }
                    incrementObjectVersion();
                    // No need to reset value as Select component handles it or we pass empty value
                  }}
                  style={{ width: '100%' }}
                  value=""
                />
              </div>
            </div>

            {obj.components &&
              obj.components.map((comp: any, idx: number) => (
                <div
                  key={idx}
                  style={{
                    background: '#332',
                    padding: '5px',
                    marginBottom: '5px',
                    borderRadius: '4px',
                    border: '1px solid #553',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      marginBottom: '5px',
                    }}
                  >
                    <span className="ui-font-bold" style={{ color: '#fb8' }}>
                      {comp.type}
                    </span>
                    <button
                      className="e-btn e-btn-red"
                      style={{ padding: '0 5px' }}
                      onClick={() => {
                        if (game.editor) game.editor.saveUndoState();
                        obj.components.splice(idx, 1);
                        if (game.editor.selectedObject) {
                          (game.editor.selectedObject as any).components = obj.components;
                        }
                        incrementObjectVersion();
                      }}
                    >
                      x
                    </button>
                  </div>

                  {comp.type === 'Backface' && (
                    <>
                      <div
                        style={{
                          fontSize: '0.8em',
                          color: '#ccc',
                          fontStyle: 'italic',
                          marginBottom: '4px',
                        }}
                      >
                        Lowers Layer if A [op] B (e.g. A.x &gt; B.x).
                      </div>
                      <div className="e-row" style={{ display: 'flex', gap: '5px' }}>
                        <div style={{ flex: 1 }}>
                          <label className="e-label" style={{ fontSize: '0.75em' }}>
                            Vert A (0-3)
                          </label>
                          <input
                            type="number"
                            className="e-input"
                            min="0"
                            max="3"
                            value={comp.vertexA}
                            onChange={(e) => {
                              comp.vertexA = parseInt(e.target.value);
                              incrementObjectVersion();
                            }}
                          />
                        </div>
                        <div style={{ flex: 1 }}>
                          <label className="e-label" style={{ fontSize: '0.75em' }}>
                            Vert B (0-3)
                          </label>
                          <input
                            type="number"
                            className="e-input"
                            min="0"
                            max="3"
                            value={comp.vertexB}
                            onChange={(e) => {
                              comp.vertexB = parseInt(e.target.value);
                              incrementObjectVersion();
                            }}
                          />
                        </div>
                      </div>
                      <div className="e-row" style={{ display: 'flex', gap: '5px' }}>
                        <div style={{ flex: 1 }}>
                          <label className="e-label" style={{ fontSize: '0.75em' }}>
                            Axis
                          </label>
                          <Select
                            value={comp.axis}
                            onChange={(value) => {
                              comp.axis = value;
                              incrementObjectVersion();
                            }}
                            options={[
                              { value: 'x', label: 'X' },
                              { value: 'y', label: 'Y' },
                            ]}
                            style={{ width: '40px' }}
                          />
                        </div>
                        <div style={{ flex: 1 }}>
                          <label className="e-label" style={{ fontSize: '0.75em' }}>
                            Op
                          </label>
                          <Select
                            value={comp.op}
                            onChange={(value) => {
                              comp.op = value;
                              incrementObjectVersion();
                            }}
                            options={[
                              { value: '>', label: '>' },
                              { value: '<', label: '<' },
                            ]}
                            style={{ width: '40px' }}
                          />
                        </div>
                      </div>

                      <div className="e-row">
                        <label className="e-label" style={{ fontSize: '9px' }}>
                          Culling Type
                        </label>
                        <Select
                          value={comp.cullingType || 'layer'}
                          onChange={(value) => {
                            comp.cullingType = value;
                            incrementObjectVersion();
                          }}
                          options={[
                            { value: 'layer', label: 'Change Layer' },
                            { value: 'render', label: 'Disable Render' },
                          ]}
                          style={{ width: '100%' }}
                        />
                      </div>
                      <div className="e-row">
                        <label className="e-label" style={{ fontSize: '10px' }}>
                          Target ID(s) (Optional)
                        </label>
                        <input
                          type="text"
                          className="e-input"
                          value={comp.targetId || ''}
                          onChange={(e) => {
                            comp.targetId = e.target.value;
                            incrementObjectVersion();
                          }}
                        />
                      </div>
                    </>
                  )}

                  {comp.type === 'Item' && (
                    <>
                      <div
                        style={{
                          fontSize: '10px',
                          color: '#ccc',
                          fontStyle: 'italic',
                          marginBottom: '4px',
                        }}
                      >
                        Can be picked up by player.
                      </div>
                      <div className="e-row">
                        <label
                          className="e-label ui-text-accent-blue ui-inline-flex-center"
                          style={{ fontSize: '10px' }}
                        >
                          <input
                            type="checkbox"
                            style={{ marginRight: '5px' }}
                            checked={!!comp.ignoreDistance}
                            onChange={(e) => {
                              comp.ignoreDistance = e.target.checked;
                              incrementObjectVersion();
                            }}
                          />
                          Ignore Distance (Always Pickup)
                        </label>
                      </div>
                    </>
                  )}

                  {comp.type === 'Inventory' && (
                    <>
                      <div
                        style={{
                          fontSize: '10px',
                          color: '#ccc',
                          fontStyle: 'italic',
                          marginBottom: '4px',
                        }}
                      >
                        Stores picked-up items by id.
                      </div>
                      <div className="e-row">
                        <label className="e-label" style={{ fontSize: '10px' }}>
                          Capacity
                        </label>
                        <input
                          type="number"
                          min="0"
                          className="e-input"
                          value={comp.capacity ?? 0}
                          onChange={(e) => {
                            comp.capacity = Math.max(0, parseInt(e.target.value || '0', 10) || 0);
                            incrementObjectVersion();
                          }}
                        />
                      </div>
                      <div className="e-row">
                        <label className="e-label" style={{ fontSize: '10px' }}>
                          Allowed Groups
                        </label>
                        <input
                          type="text"
                          className="e-input"
                          value={Array.isArray(comp.groups) ? comp.groups.join(', ') : ''}
                          onChange={(e) => {
                            comp.groups = e.target.value
                              .split(',')
                              .map((value) => value.trim())
                              .filter(Boolean);
                            incrementObjectVersion();
                          }}
                        />
                      </div>
                      <div className="e-row">
                        <label
                          className="e-label ui-text-accent-blue ui-inline-flex-center"
                          style={{ fontSize: '10px' }}
                        >
                          <input
                            type="checkbox"
                            style={{ marginRight: '5px' }}
                            checked={!!comp.protected}
                            onChange={(e) => {
                              comp.protected = e.target.checked;
                              incrementObjectVersion();
                            }}
                          />
                          Protected
                        </label>
                      </div>
                      <div className="e-row">
                        <label className="e-label" style={{ fontSize: '10px' }}>
                          Item IDs
                        </label>
                        <input
                          type="text"
                          className="e-input"
                          value={Array.isArray(comp.items) ? comp.items.join(', ') : ''}
                          onChange={(e) => {
                            comp.items = e.target.value
                              .split(',')
                              .map((value) => value.trim())
                              .filter(Boolean);
                            incrementObjectVersion();
                          }}
                        />
                      </div>
                    </>
                  )}

                  {comp.type === 'Surface' && (
                    <>
                      <div
                        style={{
                          fontSize: '10px',
                          color: '#ccc',
                          fontStyle: 'italic',
                          marginBottom: '4px',
                        }}
                      >
                        Accepts placed items and keeps their local positions.
                      </div>
                      <div className="e-row">
                        <label className="e-label" style={{ fontSize: '10px' }}>
                          Capacity
                        </label>
                        <input
                          type="number"
                          min="0"
                          className="e-input"
                          value={comp.capacity ?? 0}
                          onChange={(e) => {
                            comp.capacity = Math.max(0, parseInt(e.target.value || '0', 10) || 0);
                            incrementObjectVersion();
                          }}
                        />
                      </div>
                      <div className="e-row">
                        <label className="e-label" style={{ fontSize: '10px' }}>
                          Allowed Groups
                        </label>
                        <input
                          type="text"
                          className="e-input"
                          value={Array.isArray(comp.groups) ? comp.groups.join(', ') : ''}
                          onChange={(e) => {
                            comp.groups = e.target.value
                              .split(',')
                              .map((value) => value.trim())
                              .filter(Boolean);
                            incrementObjectVersion();
                          }}
                        />
                      </div>
                      <div className="e-row">
                        <label className="e-label" style={{ fontSize: '10px' }}>
                          Items Preview
                        </label>
                        <input
                          type="text"
                          className="e-input"
                          value={
                            Array.isArray(comp.items)
                              ? comp.items
                                  .map((item: any) => item?.id)
                                  .filter(Boolean)
                                  .join(', ')
                              : ''
                          }
                          onChange={(e) => {
                            comp.items = e.target.value
                              .split(',')
                              .map((value) => value.trim())
                              .filter(Boolean)
                              .map((id) => ({ id, x: 0, y: 0 }));
                            incrementObjectVersion();
                          }}
                        />
                      </div>
                    </>
                  )}

                  {comp.type === 'Subscene' && (
                    <>
                      <div className="e-row">
                        <label className="e-label" style={{ fontSize: '10px' }}>
                          Target ID(s)
                        </label>
                        <input
                          type="text"
                          className="e-input"
                          value={comp.targetGroupId || ''}
                          onChange={(e) => {
                            comp.targetGroupId = e.target.value;
                            incrementObjectVersion();
                          }}
                        />
                      </div>
                      <div className="e-row">
                        <label className="e-label" style={{ fontSize: '10px' }}>
                          Title
                        </label>
                        <input
                          type="text"
                          className="e-input"
                          value={comp.title || ''}
                          onChange={(e) => {
                            comp.title = e.target.value;
                            incrementObjectVersion();
                          }}
                        />
                      </div>
                      <div className="e-row">
                        <label className="e-label" style={{ fontSize: '10px' }}>
                          Item Scale
                        </label>
                        <input
                          type="number"
                          step="0.1"
                          min="0.1"
                          className="e-input"
                          value={
                            typeof comp.itemScale === 'number' && Number.isFinite(comp.itemScale)
                              ? comp.itemScale
                              : 1
                          }
                          onChange={(e) => {
                            const parsed = Number(e.target.value);
                            comp.itemScale = Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
                            incrementObjectVersion();
                          }}
                        />
                      </div>
                      <div className="e-row">
                        <label className="e-label" style={{ fontSize: '10px' }}>
                          Description
                        </label>
                        <input
                          type="text"
                          className="e-input"
                          value={comp.description || ''}
                          onChange={(e) => {
                            comp.description = e.target.value;
                            incrementObjectVersion();
                          }}
                        />
                      </div>
                    </>
                  )}

                  {comp.type === 'Subtrigger' && (
                    <>
                      <div className="e-row">
                        <div
                          style={{
                            fontSize: '10px',
                            color: '#ccc',
                            fontStyle: 'italic',
                            marginBottom: '4px',
                          }}
                        >
                          Delegates click to another Triggerbox.
                        </div>
                        <label className="e-label" style={{ fontSize: '10px' }}>
                          Target Trigger (Name/ID)
                        </label>
                        <input
                          type="text"
                          className="e-input"
                          value={comp.target || ''}
                          onChange={(e) => {
                            comp.target = e.target.value;
                            incrementObjectVersion();
                          }}
                        />
                      </div>
                    </>
                  )}

                  {comp.type === '3d-parallax' && (
                    <>
                      <div className="e-row">
                        <div style={{ fontSize: '10px', color: '#ccc', fontStyle: 'italic' }}>
                          Interpolates Actor Parallax based on Quad's vertexes P.
                        </div>
                      </div>
                    </>
                  )}

                  {comp.type === 'WalkBox' && (
                    <>
                      <div className="e-row">
                        <div
                          style={{
                            fontSize: '10px',
                            color: '#ccc',
                            fontStyle: 'italic',
                            marginBottom: '5px',
                          }}
                        >
                          Treats this Quad as a Walkbox collider.
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center' }}>
                          <label className="e-label" style={{ marginRight: '5px' }}>
                            Mode:
                          </label>
                          <Select
                            value={comp.mode || 'Invert'}
                            onChange={(value) => {
                              comp.mode = value;
                              incrementObjectVersion();
                            }}
                            options={[
                              { value: 'Invert', label: 'Invert (Walk Inside)' },
                              { value: 'Add', label: 'Add (Walk Inside)' },
                              { value: 'Subtract', label: 'Subtract (Hole)' },
                            ]}
                            style={{ width: '100%' }}
                          />
                        </div>
                      </div>
                    </>
                  )}

                  {comp.type === 'Switch' && (
                    <>
                      <div className="e-row" style={{ display: 'flex', gap: '2px' }}>
                        <div style={{ flex: 1 }}>
                          <label className="e-label" style={{ fontSize: '9px' }}>
                            Target(s) 1
                          </label>
                          <input
                            type="text"
                            className="e-input"
                            style={{ width: '100%' }}
                            value={comp.groupId1 || ''}
                            onChange={(e) => {
                              comp.groupId1 = e.target.value;
                              incrementObjectVersion();
                            }}
                          />
                        </div>
                        <div style={{ flex: 1 }}>
                          <label className="e-label" style={{ fontSize: '9px' }}>
                            Target(s) 2
                          </label>
                          <input
                            type="text"
                            className="e-input"
                            style={{ width: '100%' }}
                            value={comp.groupId2 || ''}
                            onChange={(e) => {
                              comp.groupId2 = e.target.value;
                              incrementObjectVersion();
                            }}
                          />
                        </div>
                      </div>

                      <div
                        className="e-row"
                        style={{ display: 'flex', gap: '5px', alignItems: 'center' }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center' }}>
                          <label
                            className="e-label"
                            style={{ fontSize: '10px', marginRight: '5px' }}
                          >
                            State:
                          </label>
                          <Select
                            value={String(comp.state)}
                            onChange={(value) => {
                              comp.state = parseInt(value);
                              incrementObjectVersion();
                            }}
                            options={[
                              { value: '1', label: '1' },
                              { value: '2', label: '2' },
                            ]}
                            style={{ width: '40px' }}
                          />
                        </div>
                        <div style={{ flex: 1 }}>
                          <label className="e-label" style={{ fontSize: '9px' }}>
                            Key Item ID
                          </label>
                          <input
                            type="text"
                            className="e-input"
                            style={{ width: '100%' }}
                            value={comp.idKey || ''}
                            onChange={(e) => {
                              comp.idKey = e.target.value;
                              incrementObjectVersion();
                            }}
                          />
                        </div>
                      </div>

                      <div className="e-row">
                        <label className="e-label" style={{ fontSize: '10px' }}>
                          <input
                            type="checkbox"
                            checked={!!comp.transparent}
                            onChange={(e) => {
                              comp.transparent = e.target.checked;
                              incrementObjectVersion();
                            }}
                          />{' '}
                          Transparent
                        </label>
                      </div>

                      <div className="e-row">
                        <label className="e-label" style={{ fontSize: '10px' }}>
                          <input
                            type="checkbox"
                            checked={!!comp.clearlyOpenable}
                            onChange={(e) => {
                              comp.clearlyOpenable = e.target.checked;
                              incrementObjectVersion();
                            }}
                          />{' '}
                          Clearly Openable
                        </label>
                      </div>

                      <div
                        className="e-row"
                        style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}
                      >
                        <div style={{ flex: 1 }}>
                          <label className="e-label" style={{ fontSize: '9px' }}>
                            Sound 1
                          </label>
                          <div style={{ display: 'flex' }}>
                            <input
                              type="text"
                              className="e-input"
                              style={{ width: '100%' }}
                              value={comp.sound1 || ''}
                              onChange={(e) => {
                                comp.sound1 = e.target.value;
                                incrementObjectVersion();
                              }}
                            />
                            <button
                              className="e-btn"
                              style={{ fontSize: '10px', padding: '0 4px', marginLeft: '2px' }}
                              onClick={() => {
                                if (game) {
                                  game.openFileBrowser(
                                    'load',
                                    'public/sounds',
                                    (file) => {
                                      // Strip 'public/sounds/' prefix if present? Or keeps relative?
                                      // AssetLoader handles 'public/' prefix.
                                      // Let's store just the filename if it's in public/sounds, or relative path.
                                      // FileBrowser usually returns full path relative to project root or something?
                                      // Game.ts: openFileBrowser ... onConfirm: (f) => ...
                                      // Let's assume f is the filename if we are in that dir?
                                      // Usually FileBrowser returns what's clicked.
                                      // Let's just use the basename if possible, or relative path.
                                      // Actually FileBrowser return value depends on implementation.
                                      // Let's assume it returns relative path 'public/sounds/file.mp3'
                                      let val = file;
                                      if (val.startsWith('public/sounds/'))
                                        val = val.replace('public/sounds/', '');
                                      if (val.startsWith('/sounds/'))
                                        val = val.replace('/sounds/', '');

                                      comp.sound1 = val;
                                      incrementObjectVersion();
                                    },
                                    '.mp3,.wav'
                                  ); // Pass multiple extensions if supported?
                                }
                              }}
                            >
                              ...
                            </button>
                          </div>
                        </div>
                        <div style={{ flex: 1 }}>
                          <label className="e-label" style={{ fontSize: '9px' }}>
                            Sound 2
                          </label>
                          <div style={{ display: 'flex' }}>
                            <input
                              type="text"
                              className="e-input"
                              style={{ width: '100%' }}
                              value={comp.sound2 || ''}
                              onChange={(e) => {
                                comp.sound2 = e.target.value;
                                incrementObjectVersion();
                              }}
                            />
                            <button
                              className="e-btn"
                              style={{ fontSize: '10px', padding: '0 4px', marginLeft: '2px' }}
                              onClick={() => {
                                if (game) {
                                  game.openFileBrowser(
                                    'load',
                                    'public/sounds',
                                    (file) => {
                                      let val = file;
                                      if (val.startsWith('public/sounds/'))
                                        val = val.replace('public/sounds/', '');
                                      if (val.startsWith('/sounds/'))
                                        val = val.replace('/sounds/', '');
                                      comp.sound2 = val;
                                      incrementObjectVersion();
                                    },
                                    '.mp3,.wav'
                                  );
                                }
                              }}
                            >
                              ...
                            </button>
                          </div>
                        </div>
                      </div>
                    </>
                  )}

                  {comp.type === 'Shadow' && (
                    <>
                      <div className="e-row">
                        <div
                          style={{
                            fontSize: '10px',
                            color: '#ccc',
                            fontStyle: 'italic',
                            marginBottom: '4px',
                          }}
                        >
                          Controls a shadow quad based on trigger zones.
                        </div>
                        <label className="e-label" style={{ fontSize: '10px' }}>
                          Shadow Quad ID
                        </label>
                        <input
                          type="text"
                          className="e-input"
                          value={comp.shadowQuadId || ''}
                          onChange={(e) => {
                            comp.shadowQuadId = e.target.value;
                            incrementObjectVersion();
                          }}
                        />
                      </div>
                      <div className="e-row" style={{ display: 'flex', gap: '5px' }}>
                        <div style={{ flex: 1 }}>
                          <label className="e-label" style={{ fontSize: '10px' }}>
                            Offset X
                          </label>
                          <input
                            type="number"
                            className="e-input"
                            value={formatPanelNumber(comp.offsetX || 0)}
                            onChange={(e) => {
                              comp.offsetX = parseFloat(e.target.value);
                              incrementObjectVersion();
                            }}
                          />
                        </div>
                        <div style={{ flex: 1 }}>
                          <label className="e-label" style={{ fontSize: '10px' }}>
                            Offset Y
                          </label>
                          <input
                            type="number"
                            className="e-input"
                            value={formatPanelNumber(comp.offsetY || 0)}
                            onChange={(e) => {
                              comp.offsetY = parseFloat(e.target.value);
                              incrementObjectVersion();
                            }}
                          />
                        </div>
                      </div>
                      <div className="e-row">
                        <label className="e-label" style={{ fontSize: '10px' }}>
                          Trigger ID(s) (Zone)
                        </label>
                        <input
                          type="text"
                          className="e-input"
                          value={comp.triggerId || ''}
                          onChange={(e) => {
                            comp.triggerId = e.target.value;
                            incrementObjectVersion();
                          }}
                        />
                      </div>
                    </>
                  )}
                </div>
              ))}
          </div>
        )}

        {selectedObjectType === 'Actor' && (
          <>
            <div ref={setSectionRef(4)} className="properties-section-block">
              <div className="properties-section-header properties-section-blue">
                <div className="properties-section-title">
                  <span className="properties-section-number properties-section-blue">4</span>
                  <span className="properties-section-label">ACTOR PROP.</span>
                </div>
              </div>
            </div>

            {/* Is Player */}
            <div className="e-row">
              <label className="e-label ui-inline-flex-center ui-text-accent-blue">
                <input
                  type="checkbox"
                  style={{ marginRight: '5px' }}
                  checked={!!obj.isPlayer}
                  onChange={(e) => handleChange('isPlayer', e.target.checked)}
                />
                Is Player
              </label>
            </div>

            {/* Direction */}
            <div className="e-row">
              <label className="e-label">Direction</label>
              <Select
                value={obj.direction || 'down'}
                onChange={(value) => {
                  handleChange('direction', value);
                  if (
                    game.editor.selectedObject &&
                    (game.editor.selectedObject as any).setDirection
                  ) {
                    (game.editor.selectedObject as any).setDirection(value);
                  }
                }}
                options={[
                  { value: 'down', label: 'Down' },
                  { value: 'up', label: 'Up' },
                  { value: 'left', label: 'Left' },
                  { value: 'right', label: 'Right' },
                ]}
                style={{ width: '100%', marginBottom: '5px' }}
              />
            </div>

            {/* Speed */}
            <div className="e-row">
              <label className="e-label">Move Speed</label>
              <input
                type="number"
                step="0.01"
                className="e-input"
                value={formatPanelNumber(obj.speed !== undefined ? obj.speed : 0.1)}
                onChange={(e) => handleChange('speed', e.target.value, true)}
              />
            </div>

            {/* Anim Speed */}
            <div className="e-row">
              <label className="e-label">Anim Speed (ms)</label>
              <input
                type="number"
                step="10"
                className="e-input"
                value={formatPanelNumber(
                  obj.animationSpeed !== undefined ? obj.animationSpeed : 150
                )}
                onChange={(e) => handleChange('animationSpeed', e.target.value, true)}
              />
            </div>

            {/* Animation Sets */}
            <div className="e-row" style={{ marginTop: '10px' }}>
              <div
                className="e-label ui-text-accent-blue ui-font-bold"
                style={{ display: 'flex', justifyContent: 'space-between' }}
              >
                <span>ANIMATION SETS</span>
                <button
                  className="e-btn"
                  style={{ padding: '0 5px', fontSize: '10px' }}
                  onClick={() => {
                    if (!obj.animSets) obj.animSets = {};
                    // Auto naming
                    let newId = 'idle';
                    if (obj.animSets['idle']) newId = 'walk';
                    if (obj.animSets['walk']) newId = 'state_' + Object.keys(obj.animSets).length;

                    // Add to local obj
                    obj.animSets[newId] = {
                      id: newId,
                      up: null,
                      down: null,
                      left: null,
                      right: null,
                    };

                    // Add to real obj
                    if (
                      game.editor.selectedObject &&
                      (game.editor.selectedObject as any).addAnimSet
                    ) {
                      (game.editor.selectedObject as any).addAnimSet(newId);
                    }
                    incrementObjectVersion();
                  }}
                >
                  + ADD
                </button>
              </div>
            </div>

            {/* List Sets */}
            {obj.animSets &&
              Object.keys(obj.animSets).map((setId) => {
                const set = obj.animSets[setId];
                return (
                  <div
                    key={setId}
                    style={{
                      background: '#222',
                      padding: '5px',
                      marginBottom: '5px',
                      borderRadius: '4px',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        marginBottom: '5px',
                      }}
                    >
                      <input
                        type="text"
                        className="e-input"
                        style={{
                          fontWeight: 'bold',
                          color: '#ddd',
                          background: 'transparent',
                          border: 'none',
                          borderBottom: '1px solid #444',
                          maxWidth: '100px',
                        }}
                        defaultValue={setId}
                        onBlur={(e) => {
                          const newName = e.target.value.trim();
                          if (newName && newName !== setId) {
                            if (obj.animSets[newName]) {
                              alert(`Animation set '${newName}' already exists!`);
                              e.target.value = setId;
                              return;
                            }
                            obj.animSets[newName] = obj.animSets[setId];
                            if (obj.animSets[newName].id) obj.animSets[newName].id = newName;
                            delete obj.animSets[setId];
                            incrementObjectVersion();
                          }
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') e.currentTarget.blur();
                        }}
                      />
                      <button
                        className="e-btn e-btn-red"
                        style={{ padding: '0 5px' }}
                        onClick={() => {
                          if (confirm(`Delete animation set '${setId}'?`)) {
                            delete obj.animSets[setId];
                            if (
                              game.editor.selectedObject &&
                              (game.editor.selectedObject as any).removeAnimSet
                            ) {
                              (game.editor.selectedObject as any).removeAnimSet(setId);
                            }
                            incrementObjectVersion();
                          }
                        }}
                      >
                        x
                      </button>
                    </div>

                    {/* Directions */}
                    {['down', 'up', 'left', 'right'].map((dir) => (
                      <div
                        key={dir}
                        style={{
                          display: 'flex',
                          gap: '5px',
                          marginBottom: '2px',
                          alignItems: 'center',
                        }}
                      >
                        <div className="ui-text-muted ui-text-micro" style={{ width: '30px' }}>
                          {dir.toUpperCase()}
                        </div>
                        <input
                          type="text"
                          className="e-input"
                          style={{ flex: 1, fontSize: '10px', padding: '1px' }}
                          value={set[dir] || ''}
                          readOnly
                        />
                        <button
                          className="e-btn"
                          style={{ padding: '0 5px' }}
                          onClick={() => {
                            game.openFileBrowser('load', 'public/sprites', (f) => {
                              set[dir] = f;
                              // Sync to real object
                              if (
                                game.editor.selectedObject &&
                                (game.editor.selectedObject as any).animSets
                              ) {
                                const realSet = (game.editor.selectedObject as any).animSets[setId];
                                if (realSet) realSet[dir] = f;
                                // If this is the current state, update sprite immediately
                                (game.editor.selectedObject as any).updateSpriteForState();
                              }
                              incrementObjectVersion();
                            });
                          }}
                        >
                          ...
                        </button>
                      </div>
                    ))}
                  </div>
                );
              })}
          </>
        )}

        {isObjectWithScriptEvents && (
          <div ref={setSectionRef(5)} className="properties-section-block">
            <div className="properties-section-header properties-section-purple">
              <div className="properties-section-title">
                <span className="properties-section-number properties-section-purple">5</span>
                <span className="properties-section-label">SCRIPT EVENTS</span>
              </div>
              <div className="properties-section-actions">
                <Select
                  value=""
                  className="compact-action-select"
                  placeholder="+ ADD"
                  onChange={(value) => {
                    const verb = value;
                    if (!verb) return;
                    if (!obj.interactions) obj.interactions = {};
                    if (!obj.interactions[verb]) {
                      obj.interactions[verb] = '';
                      if (game.editor.selectedObject) {
                        if (!(game.editor.selectedObject as any).interactions) {
                          (game.editor.selectedObject as any).interactions = {};
                        }
                        (game.editor.selectedObject as any).interactions[verb] = '';
                      }
                      incrementObjectVersion();
                    }
                  }}
                  options={[
                    { value: 'look', label: 'Look' },
                    { value: 'use', label: 'Use' },
                    { value: 'talk', label: 'Talk' },
                    { value: 'pickup', label: 'Pickup' },
                  ]}
                  style={{ width: '8em' }}
                />
              </div>
            </div>

            {obj.interactions &&
              Object.keys(obj.interactions).map((verb) => (
                <div key={verb} style={{ display: 'flex', alignItems: 'center', marginTop: '2px' }}>
                  <div className="ui-text-light" style={{ width: '40px', fontSize: '0.85em' }}>
                    {verb.toUpperCase()}
                  </div>
                  <input
                    type="text"
                    className="e-input"
                    style={{ flex: 1, fontSize: '0.85em' }}
                    placeholder="Script ID"
                    value={obj.interactions[verb]}
                    onChange={(e) => {
                      obj.interactions[verb] = e.target.value;
                      if (game.editor.selectedObject) {
                        (game.editor.selectedObject as any).interactions[verb] = e.target.value;
                      }
                      incrementObjectVersion();
                    }}
                  />
                  <button
                    className="e-btn e-btn-red"
                    style={{ marginLeft: '2px', padding: '0 4px', fontSize: '0.85em' }}
                    onClick={() => {
                      delete obj.interactions[verb];
                      if (game.editor.selectedObject) {
                        delete (game.editor.selectedObject as any).interactions[verb];
                      }
                      incrementObjectVersion();
                    }}
                  >
                    x
                  </button>
                </div>
              ))}
          </div>
        )}

        {!isSettings && !isScene && !isWalkbox && (
          <div ref={setSectionRef(6)} className="properties-section-block">
            {isTriggerbox && (
              <>
                <button
                  className="e-btn e-btn-yellow"
                  style={{ width: '100%', marginBottom: '5px' }}
                  onClick={(e) => {
                    if (confirm('Redraw polygon? Current points will be cleared.')) {
                      game.editor.redrawSelected();
                      (e.target as HTMLElement).blur();
                    }
                  }}
                >
                  Redraw Polygon
                </button>
                <div className="e-label">
                  {mode && mode.includes('DRAW')
                    ? 'Click to add points. Press ENTER to finish. Hold Shift for 22.5° snap.'
                    : 'To edit, drag vertices on screen. Hold Shift for 22.5° snap.'}
                </div>
              </>
            )}

            {selectedObjectType === 'Quad' && (
              <div
                className="e-label ui-text-dim"
                style={{
                  marginTop: '10px',
                  fontSize: '10px',
                  fontStyle: 'italic',
                  paddingTop: '5px',
                }}
              >
                Drag VERTEX: Hold ALT to snap to vertices/grid.
                <br />
                Hold SHIFT for angle snap.
              </div>
            )}

            <div
              className="e-row"
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: '6px',
                marginTop: isTriggerbox || selectedObjectType === 'Quad' ? '10px' : 0,
              }}
            >
              <label
                className="e-label"
                title="Toggle lock hotkey: Alt-L"
                style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: 0 }}
              >
                <input
                  type="checkbox"
                  title="Alt-L"
                  checked={!!obj.locked}
                  onChange={(e) => handleChange('locked', e.target.checked)}
                />
                Lock Object
              </label>

              <label
                className="e-label"
                title="Toggle disabled hotkey: Alt-D"
                style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: 0 }}
              >
                <input
                  type="checkbox"
                  title="Alt-D"
                  checked={!!obj.disabled}
                  onChange={(e) => handleChange('disabled', e.target.checked)}
                />
                Disabled
              </label>
            </div>
          </div>
        )}

        {/* SCENE Properties */}
        {selectedObjectType === 'SCENE' && (
          <>
            {(obj.camera || obj.defaultCamera) &&
              renderSection(
                1,
                'Camera',
                'blue',
                <>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '5px' }}>
                    <div>
                      <label className="e-label">Cam X</label>
                      <input
                        type="number"
                        className="e-input"
                        value={obj.camera ? formatPanelNumber(obj.camera.x) : 0}
                        onChange={(e) => {
                          if (obj.camera) {
                            obj.camera.x = parseFloat(e.target.value);
                            incrementObjectVersion();
                          }
                        }}
                      />
                    </div>
                    <div>
                      <label className="e-label">Cam Y</label>
                      <input
                        type="number"
                        className="e-input"
                        value={obj.camera ? formatPanelNumber(obj.camera.y) : 0}
                        onChange={(e) => {
                          if (obj.camera) {
                            obj.camera.y = parseFloat(e.target.value);
                            incrementObjectVersion();
                          }
                        }}
                      />
                    </div>
                    <div>
                      <label className="e-label">Zoom</label>
                      <input
                        type="number"
                        step="0.1"
                        className="e-input"
                        value={obj.camera ? formatPanelNumber(obj.camera.zoom) : 1}
                        onChange={(e) => {
                          if (obj.camera) {
                            obj.camera.zoom = parseFloat(e.target.value);
                            incrementObjectVersion();
                          }
                        }}
                      />
                    </div>
                  </div>

                  <div className="e-row" style={{ marginTop: '5px' }}>
                    <label className="e-label" style={{ display: 'flex', alignItems: 'center' }}>
                      <input
                        type="checkbox"
                        style={{ marginRight: '5px' }}
                        checked={!!obj.autoCenter}
                        onChange={(e) => handleChange('autoCenter', e.target.checked)}
                      />
                      Auto-Center on Player
                    </label>
                  </div>

                  <div
                    className="e-row"
                    style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '5px' }}
                  >
                    <div>
                      <label className="e-label">Cam Spd</label>
                      <input
                        type="number"
                        step="0.1"
                        className="e-input"
                        value={formatPanelNumber(obj.cameraSpeed || 5)}
                        onChange={(e) =>
                          handleChange('cameraSpeed', parseFloat(e.target.value), true)
                        }
                      />
                    </div>
                    <div>
                      <label className="e-label">Dead X</label>
                      <input
                        type="number"
                        className="e-input"
                        value={formatPanelNumber(
                          obj.camDeadzoneX !== undefined ? obj.camDeadzoneX : 50
                        )}
                        onChange={(e) =>
                          handleChange('camDeadzoneX', parseFloat(e.target.value), true)
                        }
                      />
                    </div>
                    <div>
                      <label className="e-label">Dead Y</label>
                      <input
                        type="number"
                        className="e-input"
                        value={formatPanelNumber(
                          obj.camDeadzoneY !== undefined ? obj.camDeadzoneY : 30
                        )}
                        onChange={(e) =>
                          handleChange('camDeadzoneY', parseFloat(e.target.value), true)
                        }
                      />
                    </div>
                  </div>

                  <div className="e-row" style={{ marginTop: '5px' }}>
                    <div className="e-label ui-text-accent-blue">Camera Bounds (Min/Max)</div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '5px' }}>
                      <div>
                        <label className="e-label">Min X</label>
                        <input
                          type="number"
                          className="e-input"
                          placeholder="None"
                          value={obj.camMinX !== undefined ? formatPanelNumber(obj.camMinX) : ''}
                          onChange={(e) =>
                            handleChange(
                              'camMinX',
                              e.target.value === '' ? undefined : parseFloat(e.target.value),
                              false
                            )
                          }
                        />
                      </div>
                      <div>
                        <label className="e-label">Max X</label>
                        <input
                          type="number"
                          className="e-input"
                          placeholder="None"
                          value={obj.camMaxX !== undefined ? formatPanelNumber(obj.camMaxX) : ''}
                          onChange={(e) =>
                            handleChange(
                              'camMaxX',
                              e.target.value === '' ? undefined : parseFloat(e.target.value),
                              false
                            )
                          }
                        />
                      </div>
                      <div>
                        <label className="e-label">Min Y</label>
                        <input
                          type="number"
                          className="e-input"
                          placeholder="None"
                          value={obj.camMinY !== undefined ? formatPanelNumber(obj.camMinY) : ''}
                          onChange={(e) =>
                            handleChange(
                              'camMinY',
                              e.target.value === '' ? undefined : parseFloat(e.target.value),
                              false
                            )
                          }
                        />
                      </div>
                      <div>
                        <label className="e-label">Max Y</label>
                        <input
                          type="number"
                          className="e-input"
                          placeholder="None"
                          value={obj.camMaxY !== undefined ? formatPanelNumber(obj.camMaxY) : ''}
                          onChange={(e) =>
                            handleChange(
                              'camMaxY',
                              e.target.value === '' ? undefined : parseFloat(e.target.value),
                              false
                            )
                          }
                        />
                      </div>
                    </div>
                  </div>

                  {obj.defaultCamera && (
                    <div className="e-row" style={{ marginTop: '5px' }}>
                      <div className="e-label ui-text-accent-blue">Default Camera</div>
                      <div
                        style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '5px' }}
                      >
                        <div>
                          <label className="e-label">Def X</label>
                          <input
                            type="number"
                            className="e-input"
                            value={formatPanelNumber(obj.defaultCamera.x)}
                            onChange={(e) => {
                              obj.defaultCamera.x = parseFloat(e.target.value);
                              incrementObjectVersion();
                            }}
                          />
                        </div>
                        <div>
                          <label className="e-label">Def Y</label>
                          <input
                            type="number"
                            className="e-input"
                            value={formatPanelNumber(obj.defaultCamera.y)}
                            onChange={(e) => {
                              obj.defaultCamera.y = parseFloat(e.target.value);
                              incrementObjectVersion();
                            }}
                          />
                        </div>
                        <div>
                          <label className="e-label">Def Zoom</label>
                          <input
                            type="number"
                            step="0.1"
                            className="e-input"
                            value={formatPanelNumber(obj.defaultCamera.zoom)}
                            onChange={(e) => {
                              obj.defaultCamera.zoom = parseFloat(e.target.value);
                              incrementObjectVersion();
                            }}
                          />
                        </div>
                      </div>
                      <div className="e-row" style={{ marginTop: '5px' }}>
                        <button
                          className="e-btn"
                          style={{ width: '100%' }}
                          onClick={() => {
                            if (obj.camera && obj.defaultCamera) {
                              obj.defaultCamera.x = obj.camera.x;
                              obj.defaultCamera.y = obj.camera.y;
                              obj.defaultCamera.zoom = obj.camera.zoom;
                              incrementObjectVersion();
                            }
                          }}
                        >
                          Set Current as Default
                        </button>
                      </div>
                    </div>
                  )}
                </>
              )}

            {game.sceneManager.currentScene &&
              renderSection(
                2,
                'Scaling',
                'yellow',
                (() => {
                  const s = game.sceneManager.currentScene.scaling;
                  return (
                    <>
                      <div className="e-row">
                        <label
                          className="e-label"
                          style={{ display: 'flex', alignItems: 'center' }}
                        >
                          <input
                            type="checkbox"
                            style={{ marginRight: '5px' }}
                            checked={s.enabled}
                            onChange={(e) => {
                              game.editor.setScalingEnabled(e.target.checked);
                              incrementObjectVersion();
                            }}
                          />
                          Enable Depth Scaling
                        </label>
                      </div>
                      {s.enabled && (
                        <div
                          style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '5px' }}
                        >
                          <div>
                            <label className="e-label">Min</label>
                            <input
                              type="number"
                              step="0.1"
                              className="e-input"
                              value={formatPanelNumber(s.min)}
                              onChange={(e) => {
                                s.min = parseFloat(e.target.value);
                                incrementObjectVersion();
                              }}
                            />
                          </div>
                          <div>
                            <label className="e-label">Max</label>
                            <input
                              type="number"
                              step="0.1"
                              className="e-input"
                              value={formatPanelNumber(s.max)}
                              onChange={(e) => {
                                s.max = parseFloat(e.target.value);
                                incrementObjectVersion();
                              }}
                            />
                          </div>
                          <div>
                            <label className="e-label">Horizon Y</label>
                            <input
                              type="number"
                              className="e-input"
                              value={formatPanelNumber(s.horizon)}
                              onChange={(e) => {
                                s.horizon = parseFloat(e.target.value);
                                incrementObjectVersion();
                              }}
                            />
                          </div>
                          <div>
                            <label className="e-label">Front Y</label>
                            <input
                              type="number"
                              className="e-input"
                              value={formatPanelNumber(s.front)}
                              onChange={(e) => {
                                s.front = parseFloat(e.target.value);
                                incrementObjectVersion();
                              }}
                            />
                          </div>
                        </div>
                      )}
                    </>
                  );
                })()
              )}
          </>
        )}

        {/* SETTINGS Properties */}
        {selectedObjectType === 'SETTINGS' && (
          <>
            <div className="e-row">
              <label
                className="e-label ui-text-accent-green ui-font-bold"
                style={{ marginBottom: '10px' }}
              >
                EDITOR SETTINGS
              </label>
            </div>

            {/* UI Scale */}
            <div className="e-row">
              <label
                className="e-label"
                style={{ display: 'flex', justifyContent: 'space-between' }}
              >
                UI Scale <span>{formatPanelNumber(obj.editor?.uiScale || 1.0)}x</span>
              </label>
              <input
                type="number"
                className="e-input"
                min="0.5"
                max="2.0"
                step="0.1"
                value={formatPanelNumber(obj.editor?.uiScale || 1.0)}
                onChange={(e) => {
                  if (!obj.editor) obj.editor = { uiScale: 1.0 };
                  obj.editor.uiScale = parseFloat(e.target.value);
                  incrementObjectVersion();
                  // Trigger re-render of other panels that might depend on this?
                  // Hierarchy panel subscribes to hierarchyVersion, but maybe we need a global UI version?
                  // For now, let's just force update via state.
                  useEditorStore.getState().incrementHierarchyVersion();
                }}
              />
            </div>

            {isDesktopRuntime && (
              <div className="e-row">
                <label className="e-label">Game Zoom</label>
                <Select
                  value={obj.editor?.viewportZoom || 'fit'}
                  onChange={(value) => {
                    if (!obj.editor) obj.editor = { uiScale: 1.0, viewportZoom: 'fit' };
                    obj.editor.viewportZoom = value as 'fit' | '1' | '1.5' | '2';
                    incrementObjectVersion();
                  }}
                  options={[
                    { value: 'fit', label: 'Fit to Window' },
                    { value: '1', label: '100%' },
                    { value: '1.5', label: '150%' },
                    { value: '2', label: '200%' },
                  ]}
                  style={{ width: '100%' }}
                />
              </div>
            )}

            <div className="e-row" style={{ marginTop: '10px' }}>
              <label
                className="e-label ui-text-accent-green ui-font-bold"
                style={{ marginBottom: '10px' }}
              >
                CRT EFFECT SETTINGS
              </label>
            </div>

            {/* Enabled Toggle */}
            <div className="e-row">
              <label className="e-label" style={{ display: 'flex', alignItems: 'center' }}>
                <input
                  type="checkbox"
                  style={{ marginRight: '5px' }}
                  checked={obj.crt?.enabled ?? true}
                  onChange={(e) => {
                    if (obj.crt) {
                      obj.crt.enabled = e.target.checked;
                      incrementObjectVersion();
                    }
                  }}
                />
                Enable CRT Filter
              </label>
            </div>

            {/* Controls (Only if enabled) */}
            {obj.crt?.enabled && (
              <>
                <div className="e-row">
                  <label
                    className="e-label"
                    style={{ display: 'flex', justifyContent: 'space-between' }}
                  >
                    Curvature <span>{formatPanelNumber(obj.crt.curvature)}</span>
                  </label>
                  <input
                    type="range"
                    className="e-input"
                    min="0"
                    max="0.5"
                    step="0.01"
                    value={formatPanelNumber(obj.crt.curvature)}
                    onChange={(e) => {
                      obj.crt.curvature = parseFloat(e.target.value);
                      incrementObjectVersion();
                    }}
                  />
                </div>
                <div className="e-row">
                  <label
                    className="e-label"
                    style={{ display: 'flex', justifyContent: 'space-between' }}
                  >
                    Vignette <span>{formatPanelNumber(obj.crt.vignette)}</span>
                  </label>
                  <input
                    type="range"
                    className="e-input"
                    min="0"
                    max="1"
                    step="0.05"
                    value={formatPanelNumber(obj.crt.vignette)}
                    onChange={(e) => {
                      obj.crt.vignette = parseFloat(e.target.value);
                      incrementObjectVersion();
                    }}
                  />
                </div>
                <div className="e-row">
                  <label
                    className="e-label"
                    style={{ display: 'flex', justifyContent: 'space-between' }}
                  >
                    Scanline Count <span>{formatPanelNumber(obj.crt.scanlineCount)}</span>
                  </label>
                  <input
                    type="range"
                    className="e-input"
                    min="100"
                    max="2000"
                    step="50"
                    value={formatPanelNumber(obj.crt.scanlineCount)}
                    onChange={(e) => {
                      obj.crt.scanlineCount = parseFloat(e.target.value);
                      incrementObjectVersion();
                    }}
                  />
                </div>
                <div className="e-row">
                  <label
                    className="e-label"
                    style={{ display: 'flex', justifyContent: 'space-between' }}
                  >
                    Scanline Intensity <span>{formatPanelNumber(obj.crt.scanlineIntensity)}</span>
                  </label>
                  <input
                    type="range"
                    className="e-input"
                    min="0"
                    max="1"
                    step="0.05"
                    value={formatPanelNumber(obj.crt.scanlineIntensity)}
                    onChange={(e) => {
                      obj.crt.scanlineIntensity = parseFloat(e.target.value);
                      incrementObjectVersion();
                    }}
                  />
                </div>
                <div className="e-row">
                  <label
                    className="e-label"
                    style={{ display: 'flex', justifyContent: 'space-between' }}
                  >
                    RGB Split <span>{formatPanelNumber(obj.crt.aberration)}</span>
                  </label>
                  <input
                    type="range"
                    className="e-input"
                    min="0"
                    max="5"
                    step="0.1"
                    value={formatPanelNumber(obj.crt.aberration)}
                    onChange={(e) => {
                      obj.crt.aberration = parseFloat(e.target.value);
                      incrementObjectVersion();
                    }}
                  />
                </div>
                <div className="e-row">
                  <label
                    className="e-label"
                    style={{ display: 'flex', justifyContent: 'space-between' }}
                  >
                    Bloom <span>{formatPanelNumber(obj.crt.bloom)}</span>
                  </label>
                  <input
                    type="range"
                    className="e-input"
                    min="0"
                    max="1"
                    step="0.05"
                    value={formatPanelNumber(obj.crt.bloom)}
                    onChange={(e) => {
                      obj.crt.bloom = parseFloat(e.target.value);
                      incrementObjectVersion();
                    }}
                  />
                </div>
                <div className="e-row">
                  <label
                    className="e-label"
                    style={{ display: 'flex', justifyContent: 'space-between' }}
                  >
                    Phosphor / Grain <span>{formatPanelNumber(obj.crt.phosphor || 0)}</span>
                  </label>
                  <input
                    type="range"
                    className="e-input"
                    min="0"
                    max="1"
                    step="0.05"
                    value={formatPanelNumber(obj.crt.phosphor || 0)}
                    onChange={(e) => {
                      obj.crt.phosphor = parseFloat(e.target.value);
                      incrementObjectVersion();
                    }}
                  />
                </div>
                <div className="e-row">
                  <label className="e-label" style={{ display: 'flex', alignItems: 'center' }}>
                    <input
                      type="checkbox"
                      style={{ marginRight: '5px' }}
                      checked={obj.crt.bezelGlow}
                      onChange={(e) => {
                        obj.crt.bezelGlow = e.target.checked;
                        incrementObjectVersion();
                      }}
                    />
                    Bezel Glow
                  </label>
                </div>
              </>
            )}

            <div
              className="e-row ui-divider-neutral"
              style={{ marginTop: '20px', paddingTop: '10px' }}
            >
              <button
                className="e-btn"
                style={{ width: '100%', padding: '8px' }}
                onClick={() => {
                  if (game && game.saveSettings) {
                    game.saveSettings();
                  }
                }}
              >
                SAVE SETTINGS
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
