import React from 'react';
import { useEditorStore } from '../../../store/editorStore';
import { useGame } from '../../../hooks/useGame';
import { readProjectFile } from '../../../platform/fileApi';

import { PropertiesContext, type PropertiesContextValue } from './PropertiesContext';
import {
  SPATIAL_RELATION_OPTIONS,
  PROPERTIES_LABEL_TOOLTIPS,
  normalizeTooltipLabelText,
} from './propertiesConstants';
import {
  formatPanelNumber as _formatPanelNumber,
  getSharedValue,
  getPolyCentroid,
  getQuadCentroid,
  scalePolyByFactor,
  scaleQuadVerticesByFactor,
  useNumericScrubbing,
} from './propertiesUtils';
import { normalizeGroupIdList } from '../../../utils/GroupIds';

import { MultiSelectionProperties } from './MultiSelectionProperties';
import { SectionIdentity } from './SectionIdentity';
import { EntityProperties } from './EntityProperties';
import { WalkboxProperties } from './WalkboxProperties';
import { TriggerboxProperties } from './TriggerboxProperties';
import { QuadProperties } from './QuadProperties';
import { SectionComponents } from './SectionComponents';
import { ActorProperties } from './ActorProperties';
import { SectionScriptEvents } from './SectionScriptEvents';
import { SectionMisc } from './SectionMisc';
import { FolderProperties } from './FolderProperties';
import { SceneProperties } from './SceneProperties';
import { SettingsProperties } from './SettingsProperties';
import { SectionParserNote } from './SectionParserNote';

export const PropertiesPanel: React.FC = () => {
  const game = useGame();
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

  const [anyExpanded, setAnyExpanded] = React.useState(true);

  const checkAnyExpanded = React.useCallback(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const sections = Array.from(panel.querySelectorAll<HTMLElement>('.properties-section-block'));
    const isExpanded = sections.some((s) => {
      if (s.classList.contains('properties-section-empty')) return false;
      if (!s.querySelector(':scope > .properties-section-header')) return false;
      return !s.classList.contains('collapsed');
    });
    setAnyExpanded(isExpanded);
  }, []);

  const collapseAll = React.useCallback(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const sections = panel.querySelectorAll<HTMLElement>('.properties-section-block');
    sections.forEach((s) => {
      if (s.classList.contains('properties-section-empty')) return;
      if (s.querySelector(':scope > .properties-section-header')) {
        s.classList.add('collapsed');
      }
    });
    checkAnyExpanded();
  }, [checkAnyExpanded]);

  const expandAll = React.useCallback(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const sections = panel.querySelectorAll<HTMLElement>('.properties-section-block');
    sections.forEach((s) => {
      s.classList.remove('collapsed');
    });
    checkAnyExpanded();
  }, [checkAnyExpanded]);

  // ─── Derived object binding ────────────────────────────────────────────────
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

  // ─── Spatial helpers ───────────────────────────────────────────────────────
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
    if (!scene || !obj) return [{ value: '', label: '(None)' }];

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
    if (!scene || !multiObjects.length) return [{ value: '', label: '(None)' }];

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

  // ─── Format helper (memoized version for context) ──────────────────────────
  const formatPanelNumber = React.useCallback(_formatPanelNumber, []);

  // ─── Section scroll refs ───────────────────────────────────────────────────
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
    container.scrollTo({ top: Math.max(0, targetTop), behavior: 'smooth' });
  }, []);

  const openSection = React.useCallback(
    (section: number) => {
      const node = sectionRefs.current[section];
      if (!node) return;
      if (node.classList.contains('properties-section-empty')) return;
      node.classList.remove('collapsed');
      checkAnyExpanded();
      const header = node.querySelector<HTMLElement>('.properties-section-header');
      header?.classList.remove('properties-section-flash');
      window.setTimeout(() => header?.classList.add('properties-section-flash'), 0);
      window.setTimeout(() => header?.classList.remove('properties-section-flash'), 520);
    },
    [checkAnyExpanded]
  );

  const shouldIgnoreKeyboardShortcuts = React.useCallback(() => {
    // If a modal like the file browser is open, yield key events to it
    if (document.querySelector('.file-browser-modal, .modal-overlay, .e-modal, .e-modal-overlay'))
      return true;

    const active = document.activeElement as HTMLElement | null;
    if (!active) return false;

    // Check if any text entry is focused globally
    if (active.matches('input, textarea, select, [contenteditable="true"]')) return true;
    if (active.closest('.custom-select-container')) return true;

    return false;
  }, []);

  // ─── Keyboard section navigation ───────────────────────────────────────────
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!panelRef.current) return;
      if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
      if (shouldIgnoreKeyboardShortcuts()) return;
      const key = e.key;
      if (!/^[0-7]$/.test(key)) return;
      e.preventDefault();
      const section = parseInt(key, 10);
      openSection(section);
      scrollToSection(section);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [shouldIgnoreKeyboardShortcuts, openSection, scrollToSection]);

  React.useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;

    const handleClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      const header = target?.closest('.properties-section-header') as HTMLElement | null;
      if (!header || !panel.contains(header)) return;
      if (target?.closest('button, input, select, textarea, .custom-select-container')) return;
      const section = header.closest('.properties-section-block');
      if (section?.classList.contains('properties-section-empty')) return;
      section?.classList.toggle('collapsed');
      checkAnyExpanded();
    };

    panel.addEventListener('click', handleClick);
    return () => panel.removeEventListener('click', handleClick);
  });

  React.useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const sections = panel.querySelectorAll<HTMLElement>('.properties-section-block[data-section]');
    sections.forEach((section) => {
      const id = Number(section.dataset.section);
      const hasHeader = !!section.querySelector(':scope > .properties-section-header');
      section.classList.toggle(
        'collapsed',
        hasHeader &&
          !section.classList.contains('properties-section-empty') &&
          id !== 0 &&
          id !== 1 &&
          id !== 5 &&
          id !== 7
      );
    });
    // Check initial state after applying defaults
    checkAnyExpanded();
  }, [selectedObjectId, selectedObjectType, checkAnyExpanded]);

  useNumericScrubbing(panelRef);

  // ─── Tooltip injection ─────────────────────────────────────────────────────
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

  // ─── Polygon/Quad geometry ─────────────────────────────────────────────────
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
    [obj, incrementObjectVersion]
  );

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
    [obj, incrementObjectVersion]
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
    [game, obj, selectedObjectType, incrementObjectVersion]
  );

  // ─── Multi-selection helpers ───────────────────────────────────────────────
  const applyToMulti = React.useCallback(
    (fn: (o: any) => void) => {
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
    },
    [game, multiObjects, incrementObjectVersion, incrementHierarchyVersion]
  );

  const applyToMultiRoots = React.useCallback(
    (fn: (o: any) => void) => {
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
    },
    [game, multiObjects, incrementObjectVersion, incrementHierarchyVersion]
  );

  // ─── Multi-selection draft sync ────────────────────────────────────────────
  React.useEffect(() => {
    if (selectedObjectType !== 'MULTI' || multiObjects.length <= 1) {
      setMultiSpatialParentDraft('');
      setMultiSpatialRelationDraft('');
      return;
    }
    const sharedParent = getSharedValue(
      multiObjects,
      (o: any) => o.spatial?.parentNodeId || ''
    ) as string;
    const sharedRelation = getSharedValue(multiObjects, (o: any) =>
      o.spatial?.parentNodeId ? o.spatial?.relation || 'in' : o.spatial?.relation || ''
    ) as string;
    setMultiSpatialParentDraft(sharedParent === '' ? '' : sharedParent);
    setMultiSpatialRelationDraft(sharedRelation === '' ? '' : sharedRelation);
  }, [selectedObjectType, selectedObjectId, objectVersion, multiObjects]);

  React.useEffect(() => {
    setPolygonScaleDraft('1');
    lastPolygonScaleObjectKeyRef.current = null;
    polygonScaleSnapshotRef.current = null;
  }, [selectedObjectType, selectedObjectId]);

  // ─── Text Asset handling ───────────────────────────────────────────────────
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

  // ─── handleChange ──────────────────────────────────────────────────────────
  const handleChange = React.useCallback(
    (field: string, value: unknown, enforceNumber = false) => {
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

      let finalVal: any = value;
      if (enforceNumber) {
        finalVal = parseFloat(String(value));
        if (isNaN(finalVal)) finalVal = 0;
      }
      if (field === 'groupID') {
        finalVal = normalizeGroupIdList(finalVal, { preserveEmptyTokens: true });
      }

      obj[field] = finalVal;

      if (obj.inheritedProps instanceof Set && obj.inheritedProps.has(field)) {
        obj.inheritedProps.delete(field);
      }
      incrementObjectVersion();

      if (field === 'name') incrementHierarchyVersion();
      if (field === 'isPlayer') {
        const scene = game?.sceneManager?.currentScene;
        if (scene && obj && (obj as any).type === 'Actor') {
          if (finalVal) {
            scene.entities.forEach((ent) => {
              if ((ent as any).type === 'Actor' && ent !== obj && (ent as any).isPlayer) {
                (ent as any).isPlayer = false;
              }
            });
            scene.player = obj as any;
          } else {
            if (scene.player === obj) {
              scene.player = null;
            }
          }
        }
      }
      if (field === 'spriteName') {
        if (obj.setSprite) obj.setSprite(finalVal);
      }
      if (field === 'refScale') {
        obj.applySceneCorrectionalScale?.(game?.sceneManager?.currentScene);
      }
      if (field === 'ignoreScaling') {
        const isIgnored = finalVal;
        const scene = game?.sceneManager?.currentScene;
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
        }
      }
      if (field === 'animationSpeed') {
        if (obj.animator) obj.animator.frameDuration = finalVal;
      }
    },
    [obj, selectedObjectType, game, incrementObjectVersion, incrementHierarchyVersion]
  );

  // ─── Reset undo keys on selection change ───────────────────────────────────
  React.useEffect(() => {
    lastUndoObjectKeyRef.current = null;
    lastUndoMultiKeyRef.current = null;
    if (selectedObjectType !== 'MULTI') setGroupIdDraft('');
  }, [selectedObjectType, selectedObjectId]);

  // ─── Build context value ───────────────────────────────────────────────────
  const contextValue: PropertiesContextValue | null = game
    ? {
        game,
        obj,
        selectedObjectType: selectedObjectType || '',
        selectedObjectId: selectedObjectId || null,
        mode: mode || null,
        selectedVertexIndex: selectedVertexIndex ?? null,
        uiScale,
        handleChange,
        incrementObjectVersion,
        incrementHierarchyVersion,
        formatPanelNumber,
        setSectionRef,
        scrollToSection,
        lastUndoObjectKeyRef,
        anyExpanded,
        collapseAll,
        expandAll,
      }
    : null;

  // ─── Type flags ────────────────────────────────────────────────────────────
  const isEntityLike =
    selectedObjectType === 'Entity' ||
    selectedObjectType === 'Actor' ||
    selectedObjectType === 'Static';
  const isTriggerbox = selectedObjectType === 'Triggerbox';
  const isWalkbox = selectedObjectType === 'Walkbox';
  const isScene = selectedObjectType === 'SCENE';
  const isSettings = selectedObjectType === 'SETTINGS';
  const isFolder = selectedObjectType === 'Folder';
  const isObjectWithScriptEvents =
    !isSettings && !isScene && !isWalkbox && !isFolder && selectedObjectType !== 'MULTI';
  const hasComponents =
    selectedObjectType === 'Triggerbox' ||
    selectedObjectType === 'Walkbox' ||
    selectedObjectType === 'Entity' ||
    selectedObjectType === 'Actor' ||
    selectedObjectType === 'Static' ||
    selectedObjectType === 'Quad';

  // ─── Shared panel wrapper props ────────────────────────────────────────────
  const panelEventProps = {
    onMouseEnter: () => {
      isPanelHoveredRef.current = true;
      if (game) game.isMouseOverUI = true;
    },
    onMouseLeave: () => {
      isPanelHoveredRef.current = false;
      if (game) game.isMouseOverUI = false;
    },
    onBlurCapture: () => {
      lastUndoObjectKeyRef.current = null;
      lastUndoMultiKeyRef.current = null;
    },
  };

  // ─── Empty / no-game state ─────────────────────────────────────────────────
  if (!contextValue || !obj || !game) {
    return (
      <div
        ref={panelRef}
        id="editor-panel"
        className="editor-sidebar right"
        style={{ fontSize: `${12 * uiScale}px` }}
        {...panelEventProps}
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

  // ─── Multi-selection path ──────────────────────────────────────────────────
  if (selectedObjectType === 'MULTI' && multiObjects.length > 1) {
    return (
      <PropertiesContext.Provider value={contextValue}>
        <div
          ref={panelRef}
          id="editor-panel"
          className="editor-sidebar right"
          style={{ fontSize: `${12 * uiScale}px` }}
          {...panelEventProps}
        >
          <MultiSelectionProperties
            multiObjects={multiObjects}
            groupIdDraft={groupIdDraft}
            setGroupIdDraft={setGroupIdDraft}
            multiSpatialParentDraft={multiSpatialParentDraft}
            setMultiSpatialParentDraft={setMultiSpatialParentDraft}
            multiSpatialRelationDraft={multiSpatialRelationDraft}
            setMultiSpatialRelationDraft={setMultiSpatialRelationDraft}
            lastUndoMultiKeyRef={lastUndoMultiKeyRef}
            applyToMulti={applyToMulti}
            applyToMultiRoots={applyToMultiRoots}
            getSpatialRelationOptions={getSpatialRelationOptions}
            getMultiSpatialParentOptions={getMultiSpatialParentOptions}
          />
        </div>
      </PropertiesContext.Provider>
    );
  }

  // ─── Single-object path ────────────────────────────────────────────────────
  return (
    <PropertiesContext.Provider value={contextValue}>
      <div
        ref={panelRef}
        id="editor-panel"
        className="editor-sidebar right"
        style={{ fontSize: `${12 * uiScale}px` }}
        {...panelEventProps}
      >
        <div className="editor-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span>
              {selectedObjectType === 'SETTINGS' ? 'SETTINGS' : selectedObjectType?.toUpperCase()}
            </span>
            {selectedObjectType !== 'SETTINGS' && selectedObjectType !== 'SCENE' && (
              <button
                type="button"
                className="toolbar-icon-btn"
                title={anyExpanded ? 'Collapse all' : 'Expand all'}
                onClick={anyExpanded ? collapseAll : expandAll}
                style={{
                  width: '20px',
                  height: '20px',
                  padding: 0,
                  fontSize: '10px',
                  lineHeight: 1,
                }}
              >
                {anyExpanded ? '▼' : '▶'}
              </button>
            )}
          </div>
          <button className="e-btn" onClick={() => useEditorStore.getState().toggle(false)}>
            X
          </button>
        </div>

        <div ref={contentRef} className="editor-content">
          {/* Section 0: Identity */}
          {!isSettings && (
            <SectionIdentity
              isScene={isScene}
              isSettings={isSettings}
              isWalkbox={isWalkbox}
              supportsTextAsset={supportsTextAsset}
              resolvedTitle={resolvedTitle}
              textAssetPath={textAssetPath}
              hasTextAsset={hasTextAsset}
              onOpenTA={handleOpenTA}
              onReadTA={handleReadTA}
              onDeleteTA={handleDeleteTA}
              getSpatialRelationOptions={getSpatialRelationOptions}
              getSceneSpatialParentOptions={getSceneSpatialParentOptions}
            />
          )}

          {/* Entity/Actor/Static: Transform + Visual */}
          {isEntityLike && <EntityProperties />}

          {/* Walkbox: Mode selector */}
          {isWalkbox && <WalkboxProperties />}

          {/* Triggerbox: Transform */}
          {isTriggerbox && (
            <TriggerboxProperties
              translatePolyTo={translatePolyTo}
              polygonScaleDraft={polygonScaleDraft}
              applyPolygonScaleDraft={applyPolygonScaleDraft}
            />
          )}

          {/* Quad: Transform + Vertices + Visual */}
          {selectedObjectType === 'Quad' && (
            <QuadProperties
              polygonScaleDraft={polygonScaleDraft}
              applyPolygonScaleDraft={applyPolygonScaleDraft}
              translateQuadTo={translateQuadTo}
            />
          )}

          {isFolder && <FolderProperties />}

          {/* Section 3: Components */}
          {hasComponents && <SectionComponents />}

          {/* Section 4: Actor-specific */}
          {selectedObjectType === 'Actor' && <ActorProperties />}

          {/* Section 5: Script Events */}
          {isObjectWithScriptEvents && <SectionScriptEvents />}

          {/* Section 6: Lock/Disabled/Misc */}
          {!isSettings && !isScene && !isWalkbox && (
            <SectionMisc isTriggerbox={isTriggerbox} isQuad={selectedObjectType === 'Quad'} />
          )}

          {/* Scene: Camera + Scaling */}
          {isScene && <SceneProperties />}

          {/* Settings: Editor + CRT */}
          {isSettings && <SettingsProperties />}

          {/* Runtime-only entity Parser Note; intentionally last in Properties. */}
          {isEntityLike && !isSettings && !isScene && String(selectedObjectType) !== 'MULTI' && (
            <SectionParserNote />
          )}
        </div>
      </div>
    </PropertiesContext.Provider>
  );
};
