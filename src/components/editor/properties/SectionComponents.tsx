import React from 'react';
import { usePropertiesContext } from './PropertiesContext';
import { Select } from '../../common/Select';

import { SceneObject } from '../../../entities/SceneObject';
import { Actor } from '../../../entities/Actor';
import { Entity } from '../../../entities/Entity';
import {
  materializeNpcObjectives,
  formatNpcObjectivesForEditor,
  normalizeNpcMemory,
  normalizeNpcObjectives,
  parseNpcObjectivesFromEditor,
} from '../../../mechanics/npcState';

const iconModules = import.meta.glob('../../../assets/components-icon/*.svg', { eager: true });
function getIconUrl(type: string): string | undefined {
  const mod = (iconModules as Record<string, any>)[
    `../../../assets/components-icon/${type.toLowerCase()}.svg`
  ];
  return mod?.default;
}

export const SectionComponents: React.FC = () => {
  const { game, obj, selectedObjectType, setSectionRef, incrementObjectVersion } =
    usePropertiesContext<SceneObject>();
  const o = obj;
  const [stateParserNoteRows, setStateParserNoteRows] = React.useState<
    Record<string, Array<{ id: string; value: string; field: string }>>
  >({});
  const [npcDrafts, setNpcDrafts] = React.useState<
    Record<string, { memory?: string; objectives?: string; objectiveError?: string }>
  >({});
  const title = game.textAssets.getResolvedObjectField(o, 'title');
  const hasTitle = !!title?.trim();
  const hasActorComponent = (o.components || []).some((comp: any) => comp?.type === 'Actor');
  const renderedComponents =
    selectedObjectType === 'Actor' && !hasActorComponent
      ? [{ type: 'Actor', __virtualActorComponent: true }, ...(o.components || [])]
      : o.components || [];
  const hasRenderedComponents = renderedComponents.length > 0;
  const sectionRef = React.useRef<HTMLDivElement | null>(null);
  const relationOptions = [
    { value: 'in', label: 'IN' },
    { value: 'on', label: 'ON' },
    { value: 'under', label: 'UNDER' },
    { value: 'behind', label: 'BEHIND' },
  ];
  const blockedRelationOptions = [
    { value: 'in', label: 'IN' },
    { value: 'on', label: 'ON' },
    { value: 'under', label: 'UNDER' },
    { value: 'behind', label: 'BEHIND' },
    { value: 'none', label: 'NONE' },
  ];
  const directionOptions = [
    { value: 'up', label: 'UP' },
    { value: 'down', label: 'DOWN' },
    { value: 'left', label: 'LEFT' },
    { value: 'right', label: 'RIGHT' },
  ];
  const stateValueTypeOptions = [
    { value: 'boolean', label: 'Boolean' },
    { value: 'number', label: 'Number' },
    { value: 'string', label: 'String' },
  ];
  const getDefaultStateValue = (valueType: string): string | number | boolean => {
    if (valueType === 'string') return '';
    if (valueType === 'number') return 0;
    return false;
  };
  const normalizeStateValue = (value: unknown, valueType: string): string | number | boolean => {
    if (valueType === 'string') return typeof value === 'string' ? value : String(value ?? '');
    if (valueType === 'number') {
      const parsed = typeof value === 'number' ? value : Number(value);
      return Number.isFinite(parsed) ? parsed : 0;
    }
    return typeof value === 'boolean' ? value : value === 'true';
  };
  const getStateParserNoteRowsKey = (idx: number): string => `${o.name || 'object'}:${idx}`;
  const getNpcDraftKey = (idx: number): string => `${o.name || 'object'}:npc:${idx}`;
  const getStateParserNoteRows = (comp: any, idx: number) => {
    const key = getStateParserNoteRowsKey(idx);
    const draft = stateParserNoteRows[key];
    if (draft) return draft;
    return Object.entries(comp.parserNoteTextAssets || {}).map(([value, field]) => ({
      id: `saved:${value}`,
      value,
      field: typeof field === 'string' ? field : String(field ?? ''),
    }));
  };
  const commitStateParserNoteRows = (
    comp: any,
    idx: number,
    rows: Array<{ id: string; value: string; field: string }>
  ) => {
    const key = getStateParserNoteRowsKey(idx);
    setStateParserNoteRows((current) => ({ ...current, [key]: rows }));

    const next = rows.reduce<Record<string, string>>((acc, row) => {
      const value = row.value.trim();
      const field = row.field.trim();
      if (value && field) acc[value] = field;
      return acc;
    }, {});

    if (Object.keys(next).length > 0) {
      comp.parserNoteTextAssets = next;
    } else {
      delete comp.parserNoteTextAssets;
    }

    incrementObjectVersion();
  };
  const updateStateParserNoteRow = (
    comp: any,
    idx: number,
    rowId: string,
    patch: Partial<{ value: string; field: string }>
  ) => {
    const rows = getStateParserNoteRows(comp, idx).map((row) =>
      row.id === rowId ? { ...row, ...patch } : row
    );
    commitStateParserNoteRows(comp, idx, rows);
  };
  const addStateParserNoteRow = (comp: any, idx: number) => {
    const rows = [
      ...getStateParserNoteRows(comp, idx),
      { id: `new:${Date.now()}:${Math.random()}`, value: '', field: '' },
    ];
    setStateParserNoteRows((current) => ({
      ...current,
      [getStateParserNoteRowsKey(idx)]: rows,
    }));
  };
  const removeStateParserNoteRow = (comp: any, idx: number, rowId: string) => {
    const rows = getStateParserNoteRows(comp, idx).filter((row) => row.id !== rowId);
    commitStateParserNoteRows(comp, idx, rows);
  };
  const normalizeContainerRelation = (comp: any): 'in' | 'on' | 'under' | 'behind' => {
    if (comp?.type === 'Inventory') {
      return comp?.relation === 'on' ||
        comp?.relation === 'under' ||
        comp?.relation === 'behind' ||
        comp?.relation === 'in'
        ? comp.relation
        : 'in';
    }
    return comp?.relation === 'in' ||
      comp?.relation === 'on' ||
      comp?.relation === 'under' ||
      comp?.relation === 'behind'
      ? comp.relation
      : 'on';
  };
  const getUsedContainerRelations = (
    ignoreIndex?: number
  ): Array<'in' | 'on' | 'under' | 'behind'> =>
    (o.components || [])
      .map((comp: any, idx: number) =>
        idx !== ignoreIndex && (comp?.type === 'Inventory' || comp?.type === 'Surface')
          ? normalizeContainerRelation(comp)
          : null
      )
      .filter((value: any): value is 'in' | 'on' | 'under' | 'behind' => !!value);
  const getNextAvailableContainerRelation = (): 'in' | 'on' | 'under' | 'behind' | null => {
    const used = new Set(getUsedContainerRelations());
    return (
      (['in', 'on', 'under', 'behind'] as const).find((relation) => !used.has(relation)) || null
    );
  };
  const normalizeSoundPath = (file: string): string => {
    let val = file;
    if (val.startsWith('public/sounds/')) val = val.replace('public/sounds/', '');
    if (val.startsWith('/sounds/')) val = val.replace('/sounds/', '');
    return val;
  };

  const SpatialRelationSelect = ({ comp, idx }: { comp: any; idx: number }) => (
    <div className="e-row">
      <label className="e-label" style={{ fontSize: '10px' }}>
        Spatial Relation
      </label>
      <Select
        value={normalizeContainerRelation(comp)}
        onChange={(value) => {
          const nextRelation = value as 'in' | 'on' | 'under' | 'behind';
          if (getUsedContainerRelations(idx).includes(nextRelation)) {
            game.showNotification?.(
              `Another container already uses relation ${nextRelation.toUpperCase()}.`
            );
            return;
          }
          if (game.editor) game.editor.saveUndoState();
          comp.relation = nextRelation;
          incrementObjectVersion();
        }}
        options={relationOptions}
        style={{ width: '100%' }}
      />
    </div>
  );

  React.useEffect(() => {
    if (hasRenderedComponents) {
      sectionRef.current?.classList.remove('collapsed');
    }
  }, [hasRenderedComponents]);

  React.useEffect(() => {
    if (!o.components) return;
    const npcComp = o.components.find((c: any) => c.type === 'NPC') as any;
    if (!npcComp) return;

    let lastMemory = npcComp.memory;
    let lastObjectives = JSON.stringify(npcComp.objectives);

    const interval = setInterval(() => {
      let changed = false;
      if (npcComp.memory !== lastMemory) {
        lastMemory = npcComp.memory;
        changed = true;
      }
      const currentObj = JSON.stringify(npcComp.objectives);
      if (currentObj !== lastObjectives) {
        lastObjectives = currentObj;
        changed = true;
      }
      if (changed) {
        incrementObjectVersion();
      }
    }, 500);

    return () => clearInterval(interval);
  }, [o, incrementObjectVersion]);

  return (
    <div
      ref={(node) => {
        sectionRef.current = node;
        setSectionRef(3)(node);
      }}
      className={`properties-section-block ${hasRenderedComponents ? '' : 'properties-section-empty'}`}
      data-section={3}
    >
      <div className="properties-section-header properties-section-red">
        <div className="properties-section-title">
          <span className="properties-section-number properties-section-red">3</span>
          <span className="properties-section-label">COMPONENTS</span>
        </div>
        <div className="properties-section-actions">
          <Select
            className="compact-action-select header-dropdown"
            options={[
              { value: 'Item', label: 'Item (Pickup)' },
              { value: 'State', label: 'State' },
              { value: 'Inventory', label: 'Inventory' },
              { value: 'Surface', label: 'Surface' },
              { value: 'Subscene', label: 'Subscene' },
              { value: 'Subtrigger', label: 'Subtrigger' },
              { value: 'Switch', label: 'Switch' },
              { value: 'Blocker', label: 'Blocker' },
              { value: 'Exit', label: 'Exit (Transition)' },
              { value: 'Entry', label: 'Entry (Spawn Point)' },
              ...(selectedObjectType === 'Static' || selectedObjectType === 'Entity'
                ? [{ value: 'Actor', label: 'Actor' }]
                : []),
              ...(selectedObjectType === 'Quad'
                ? [
                    { value: 'Backface', label: 'Backface' },
                    { value: '3d-parallax', label: '3d-parallax' },
                    { value: 'WalkBox', label: 'WalkBox (Collider)' },
                  ]
                : []),
              ...(selectedObjectType === 'Actor'
                ? [
                    { value: 'NPC', label: 'NPC' },
                    { value: 'Shadow', label: 'Shadow' },
                  ]
                : []),
            ].map((opt) => ({ ...opt, icon: getIconUrl(opt.value) }))}
            placeholder="+ ADD"
            onChange={(value) => {
              const type = value;
              if (!type) return;
              if (type === 'Actor') {
                if (game.editor.selectedObject instanceof Entity) {
                  game.editor.convertEntityToActor(game.editor.selectedObject);
                }
                return;
              }
              if (game.editor) game.editor.saveUndoState();
              if (!o.components) o.components = [];
              const relation = hasTitle ? getNextAvailableContainerRelation() : null;

              sectionRef.current?.classList.remove('collapsed');

              if (type === 'Subscene') {
                o.components.unshift({
                  type: 'Subscene',
                  targetGroupId: '',
                  itemScale: 1,
                  title: '',
                  description: '',
                });
              } else if (type === 'Subtrigger') {
                o.components.unshift({ type: 'Subtrigger', target: '' });
              } else if (type === 'Exit') {
                o.components.unshift({ type: 'Exit', targetSceneId: '', targetEntryId: '' });
              } else if (type === 'Entry') {
                o.components.unshift({ type: 'Entry', direction: 'down' });
              } else if (type === 'Item') {
                o.components.unshift({ type: 'Item' });
              } else if (type === 'State') {
                o.components.unshift({
                  type: 'State',
                  id: 'state',
                  valueType: 'boolean',
                  initialValue: false,
                  value: false,
                });
              } else if (type === 'Inventory') {
                if (hasTitle && !relation) {
                  game.showNotification?.('This object already has containers for all relations.');
                  return;
                }
                o.components.unshift({
                  type: 'Inventory',
                  relation: relation || 'in',
                  capacity: 8,
                  groups: [],
                  protected: false,
                  items: [],
                });
              } else if (type === 'Surface') {
                if (hasTitle && !relation) {
                  game.showNotification?.('This object already has containers for all relations.');
                  return;
                }
                o.components.unshift({
                  type: 'Surface',
                  relation: relation || 'in',
                  capacity: 8,
                  groups: [],
                  items: [],
                });
              } else if (type === 'Switch') {
                o.components.unshift({
                  type: 'Switch',
                  groupId1: '',
                  groupId2: '',
                  state: 1,
                  keyId: '',
                  sound1: '',
                  sound2: '',
                  transparent: false,
                  clearlyOpenable: false,
                  blockedRelation: 'in',
                });
              } else if (type === 'Blocker') {
                o.components.unshift({
                  type: 'Blocker',
                  transparent: false,
                  blockedRelation: 'in',
                });
              } else if (type === 'Backface') {
                o.components.unshift({
                  type: 'Backface',
                  vertexA: 0,
                  vertexB: 1,
                  axis: 'x',
                  op: '>',
                  targetId: o.name,
                  cullingType: 'layer',
                });
              } else if (type === 'Shadow') {
                o.components.unshift({
                  type: 'Shadow',
                  shadowQuadId: '',
                  offsetX: 0,
                  offsetY: 0,
                  triggerId: '',
                });
              } else if (type === 'NPC') {
                o.components.unshift({
                  type: 'NPC',
                  enabled: true,
                  memory: [],
                  objectives: [],
                });
              } else if (type === '3d-parallax') {
                o.components.unshift({ type: '3d-parallax' });
              } else if (type === 'WalkBox') {
                o.components.unshift({ type: 'WalkBox', mode: 'Invert' });
              }

              if (game.editor.selectedObject) {
                (game.editor.selectedObject as any).components = o.components;
              }
              incrementObjectVersion();
            }}
            style={{ width: '8em' }}
            value=""
          />
        </div>
      </div>

      {renderedComponents.map((comp: any, displayIdx: number) => {
        const idx =
          selectedObjectType === 'Actor' && !hasActorComponent ? displayIdx - 1 : displayIdx;
        const isVirtualActorComponent = !!comp.__virtualActorComponent;

        return (
          <div
            key={isVirtualActorComponent ? 'actor-component' : idx}
            className="component-block"
            style={{
              marginBottom: '5px',
            }}
          >
            <div
              className="component-header"
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                marginBottom: '5px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', color: 'var(--ui-main-color)' }}>
                {getIconUrl(comp.type) && (
                  <div
                    style={{
                      width: '1em',
                      height: '1em',
                      marginRight: '6px',
                      backgroundColor: 'currentColor',
                      maskImage: `url("${getIconUrl(comp.type)}")`,
                      WebkitMaskImage: `url("${getIconUrl(comp.type)}")`,
                      maskSize: 'contain',
                      maskRepeat: 'no-repeat',
                      maskPosition: 'center',
                    }}
                  />
                )}
                <span className="ui-font-bold">{comp.type}</span>
              </div>
              <button
                className="e-btn e-btn-red e-action-delete-btn"
                onClick={async () => {
                  if (comp.type === 'Actor') {
                    if (game.editor.selectedObject instanceof Actor) {
                      const choice = await game.requestChoiceDialog(
                        'Remove Actor Component',
                        'This object will become Static and permanently lose all Actor settings, including direction, player mode, move speed, visual states, animation sets, and Actor-only components.',
                        [
                          { id: 'cancel', label: 'Cancel', variant: 'neutral' },
                          { id: 'proceed', label: 'Proceed', variant: 'danger' },
                        ]
                      );
                      if (choice === 'proceed') {
                        game.editor.convertActorToEntity(game.editor.selectedObject);
                      }
                    }
                    return;
                  }
                  if (idx < 0) return;
                  if (game.editor) game.editor.saveUndoState();
                  o.components.splice(idx, 1);
                  if (game.editor.selectedObject) {
                    (game.editor.selectedObject as any).components = o.components;
                  }
                  incrementObjectVersion();
                }}
              >
                x
              </button>
            </div>

            {comp.type === 'Actor' && (
              <div
                style={{
                  fontSize: '10px',
                  color: 'var(--ui-label-color)',
                  fontStyle: 'italic',
                  marginBottom: '4px',
                }}
              >
                Enables Actor movement, direction, player mode, and animation sets.
              </div>
            )}

            {comp.type === 'NPC' && (
              <>
                <div
                  style={{
                    fontSize: '10px',
                    color: 'var(--ui-label-color)',
                    fontStyle: 'italic',
                    marginBottom: '4px',
                  }}
                >
                  Enables Puppet Master dialogue, NPC memory, and runtime objectives.
                </div>
                <div className="e-row">
                  <label className="e-label" style={{ fontSize: '10px' }}>
                    <input
                      type="checkbox"
                      checked={comp.enabled !== false}
                      onChange={(e) => {
                        comp.enabled = e.target.checked;
                        incrementObjectVersion();
                      }}
                    />{' '}
                    Enabled
                  </label>
                </div>
                <div className="e-row">
                  <label className="e-label" style={{ fontSize: '10px' }}>
                    Memory (one fact per line)
                  </label>
                  <textarea
                    className="e-input"
                    rows={3}
                    value={(() => {
                      const key = getNpcDraftKey(idx);
                      if (npcDrafts[key]?.memory !== undefined) return npcDrafts[key].memory;
                      const current = normalizeNpcMemory(comp.memory);
                      const revision = game.textAssets.getResolvedNpcMemoryRevision(o);
                      const memory =
                        current.length || comp.memoryTARevision === revision
                          ? current
                          : game.textAssets.getResolvedNpcMemory(o);
                      return memory.join('\n');
                    })()}
                    onChange={(e) => {
                      const key = getNpcDraftKey(idx);
                      setNpcDrafts((current) => ({
                        ...current,
                        [key]: { ...current[key], memory: e.target.value },
                      }));
                    }}
                    onBlur={(e) => {
                      const key = getNpcDraftKey(idx);
                      comp.memory = normalizeNpcMemory(e.target.value.split(/\r?\n/));
                      comp.memoryInitializedFromTA = true;
                      comp.memoryTARevision = game.textAssets.getResolvedNpcMemoryRevision(o);
                      setNpcDrafts((current) => ({
                        ...current,
                        [key]: { ...current[key], memory: undefined },
                      }));
                      incrementObjectVersion();
                    }}
                  />
                </div>
                <div className="e-row">
                  <label className="e-label" style={{ fontSize: '10px' }}>
                    Current Objectives
                  </label>
                  <textarea
                    className="e-input"
                    rows={5}
                    value={(() => {
                      const key = getNpcDraftKey(idx);
                      if (npcDrafts[key]?.objectives !== undefined)
                        return npcDrafts[key].objectives;
                      const current = normalizeNpcObjectives(comp.objectives);
                      const revision = game.textAssets.getResolvedNpcObjectivesRevision(o);
                      const objectives =
                        current.length || comp.objectivesTARevision === revision
                          ? current
                          : game.textAssets.getResolvedNpcObjectives(o);
                      return formatNpcObjectivesForEditor(objectives);
                    })()}
                    onChange={(e) => {
                      const key = getNpcDraftKey(idx);
                      const parsed = parseNpcObjectivesFromEditor(e.target.value);
                      setNpcDrafts((current) => ({
                        ...current,
                        [key]: {
                          ...current[key],
                          objectives: e.target.value,
                          objectiveError: 'error' in parsed ? parsed.error : undefined,
                        },
                      }));
                    }}
                    onBlur={(e) => {
                      const key = getNpcDraftKey(idx);
                      const parsed = parseNpcObjectivesFromEditor(e.target.value);
                      if ('error' in parsed) {
                        setNpcDrafts((current) => ({
                          ...current,
                          [key]: { ...current[key], objectiveError: parsed.error },
                        }));
                        return;
                      }
                      comp.objectives = materializeNpcObjectives(parsed.objectives);
                      comp.objectivesInitializedFromTA = true;
                      comp.objectivesTARevision =
                        game.textAssets.getResolvedNpcObjectivesRevision(o);
                      setNpcDrafts((current) => ({
                        ...current,
                        [key]: {
                          ...current[key],
                          objectives: undefined,
                          objectiveError: undefined,
                        },
                      }));
                      incrementObjectVersion();
                    }}
                  />
                  {npcDrafts[getNpcDraftKey(idx)]?.objectiveError && (
                    <div
                      style={{
                        color: 'var(--ui-danger-color)',
                        fontSize: '10px',
                        marginTop: '3px',
                      }}
                    >
                      {npcDrafts[getNpcDraftKey(idx)]?.objectiveError}
                    </div>
                  )}
                </div>
              </>
            )}

            {comp.type === 'Backface' && (
              <>
                <div
                  style={{
                    fontSize: '0.8em',
                    color: 'var(--ui-label-color)',
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
                    color: 'var(--ui-label-color)',
                    fontStyle: 'italic',
                    marginBottom: '4px',
                  }}
                >
                  Can be picked up by player.
                </div>
                <div className="e-row">
                  <label className="e-label ui-inline-flex-center" style={{ fontSize: '10px' }}>
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

            {comp.type === 'State' && (
              <>
                <div
                  style={{
                    fontSize: '10px',
                    color: 'var(--ui-label-color)',
                    fontStyle: 'italic',
                    marginBottom: '4px',
                  }}
                >
                  Script-readable object state.
                </div>
                <div className="e-row">
                  <label className="e-label" style={{ fontSize: '10px' }}>
                    ID / Type
                  </label>
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'minmax(0, 1fr) 104px',
                      gap: '6px',
                    }}
                  >
                    <input
                      type="text"
                      className="e-input"
                      value={comp.id || ''}
                      onChange={(e) => {
                        comp.id = e.target.value.trim();
                        incrementObjectVersion();
                      }}
                    />
                    <Select
                      value={comp.valueType || 'boolean'}
                      onChange={(value) => {
                        comp.valueType = value;
                        comp.initialValue = getDefaultStateValue(value);
                        comp.value = comp.initialValue;
                        incrementObjectVersion();
                      }}
                      options={stateValueTypeOptions}
                      style={{ width: '100%' }}
                    />
                  </div>
                </div>
                <div className="e-row">
                  <label className="e-label" style={{ fontSize: '10px' }}>
                    Values
                  </label>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
                    <div>
                      <label className="e-label" style={{ fontSize: '9px' }}>
                        Initial
                      </label>
                      {comp.valueType === 'boolean' ? (
                        <Select
                          value={String(normalizeStateValue(comp.initialValue, 'boolean'))}
                          onChange={(value) => {
                            comp.initialValue = value === 'true';
                            comp.value = comp.initialValue;
                            incrementObjectVersion();
                          }}
                          options={[
                            { value: 'false', label: 'False' },
                            { value: 'true', label: 'True' },
                          ]}
                          style={{ width: '100%' }}
                        />
                      ) : (
                        <input
                          type={comp.valueType === 'number' ? 'number' : 'text'}
                          className="e-input"
                          value={String(
                            normalizeStateValue(comp.initialValue, comp.valueType || 'boolean')
                          )}
                          onChange={(e) => {
                            comp.initialValue = normalizeStateValue(
                              e.target.value,
                              comp.valueType || 'boolean'
                            );
                            comp.value = comp.initialValue;
                            incrementObjectVersion();
                          }}
                        />
                      )}
                    </div>
                    <div>
                      <label className="e-label" style={{ fontSize: '9px' }}>
                        Current
                      </label>
                      {comp.valueType === 'boolean' ? (
                        <Select
                          value={String(
                            normalizeStateValue(
                              comp.value === undefined ? comp.initialValue : comp.value,
                              'boolean'
                            )
                          )}
                          onChange={(value) => {
                            comp.value = value === 'true';
                            incrementObjectVersion();
                          }}
                          options={[
                            { value: 'false', label: 'False' },
                            { value: 'true', label: 'True' },
                          ]}
                          style={{ width: '100%' }}
                        />
                      ) : (
                        <input
                          type={comp.valueType === 'number' ? 'number' : 'text'}
                          className="e-input"
                          value={String(
                            normalizeStateValue(
                              comp.value === undefined ? comp.initialValue : comp.value,
                              comp.valueType || 'boolean'
                            )
                          )}
                          onChange={(e) => {
                            comp.value = normalizeStateValue(
                              e.target.value,
                              comp.valueType || 'boolean'
                            );
                            incrementObjectVersion();
                          }}
                        />
                      )}
                    </div>
                  </div>
                </div>
                <div className="e-row">
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: 'minmax(0, 0.7fr) minmax(0, 1fr) 28px',
                        gap: '6px',
                      }}
                    >
                      <label className="e-label" style={{ fontSize: '9px' }}>
                        State Value
                      </label>
                      <label className="e-label" style={{ fontSize: '9px' }}>
                        TA Field
                      </label>
                    </div>
                    {getStateParserNoteRows(comp, idx).map((row) => (
                      <div
                        key={row.id}
                        style={{
                          display: 'grid',
                          gridTemplateColumns: 'minmax(0, 0.7fr) minmax(0, 1fr) 28px',
                          gap: '6px',
                        }}
                      >
                        <input
                          className="e-input"
                          placeholder="state value"
                          value={row.value}
                          onChange={(e) =>
                            updateStateParserNoteRow(comp, idx, row.id, { value: e.target.value })
                          }
                        />
                        <input
                          type="text"
                          className="e-input"
                          placeholder="object TA field"
                          value={row.field}
                          onChange={(e) =>
                            updateStateParserNoteRow(comp, idx, row.id, { field: e.target.value })
                          }
                        />
                        <button
                          type="button"
                          className="e-button"
                          title="Remove"
                          onClick={() => removeStateParserNoteRow(comp, idx, row.id)}
                          style={{
                            alignSelf: 'center',
                            width: '20px',
                            height: '20px',
                            minWidth: 0,
                            padding: 0,
                            lineHeight: '18px',
                            fontSize: '10px',
                          }}
                        >
                          X
                        </button>
                      </div>
                    ))}
                    <button
                      type="button"
                      className="e-button"
                      onClick={() => addStateParserNoteRow(comp, idx)}
                    >
                      Add State Value
                    </button>
                  </div>
                </div>
              </>
            )}

            {comp.type === 'Inventory' && (
              <>
                <div
                  style={{
                    fontSize: '10px',
                    color: 'var(--ui-label-color)',
                    fontStyle: 'italic',
                    marginBottom: '4px',
                  }}
                >
                  Stores picked-up items by id.
                </div>
                {hasTitle && <SpatialRelationSelect comp={comp} idx={idx} />}
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
                  <label className="e-label ui-inline-flex-center" style={{ fontSize: '10px' }}>
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
                    color: 'var(--ui-label-color)',
                    fontStyle: 'italic',
                    marginBottom: '4px',
                  }}
                >
                  Accepts placed items and keeps their local positions.
                </div>
                {hasTitle && <SpatialRelationSelect comp={comp} idx={idx} />}
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
                      color: 'var(--ui-label-color)',
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

            {comp.type === 'Exit' && (
              <>
                <div className="e-row">
                  <div
                    style={{
                      fontSize: '10px',
                      color: 'var(--ui-label-color)',
                      fontStyle: 'italic',
                      marginBottom: '4px',
                    }}
                  >
                    Transitions an Actor to another scene and Entry point.
                  </div>
                  <label className="e-label" style={{ fontSize: '10px' }}>
                    Target Scene ID (e.g. room2.json)
                  </label>
                  <input
                    type="text"
                    className="e-input"
                    value={comp.targetSceneId || ''}
                    onChange={(e) => {
                      comp.targetSceneId = e.target.value;
                      incrementObjectVersion();
                    }}
                  />
                </div>
                <div className="e-row">
                  <label className="e-label" style={{ fontSize: '10px' }}>
                    Target Entry ID (Trigger Name)
                  </label>
                  <input
                    type="text"
                    className="e-input"
                    value={comp.targetEntryId || ''}
                    onChange={(e) => {
                      comp.targetEntryId = e.target.value;
                      incrementObjectVersion();
                    }}
                  />
                </div>
                <div className="e-row">
                  <label className="e-label" style={{ fontSize: '10px' }}>
                    Trigger Options
                  </label>
                  <div
                    style={{
                      display: 'flex',
                      gap: '8px',
                      fontSize: '10px',
                      color: 'var(--ui-label-color)',
                    }}
                  >
                    <label style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <input
                        type="checkbox"
                        checked={comp.collider !== false}
                        onChange={(e) => {
                          comp.collider = e.target.checked;
                          incrementObjectVersion();
                        }}
                      />
                      Collider
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <input
                        type="checkbox"
                        checked={!!comp.portal}
                        onChange={(e) => {
                          comp.portal = e.target.checked;
                          incrementObjectVersion();
                        }}
                      />
                      Portal
                    </label>
                  </div>
                </div>
                <div className="e-row">
                  <button
                    className="e-button"
                    style={{ marginTop: '4px' }}
                    onClick={() => {
                      let sceneId = comp.targetSceneId?.trim() || '';
                      if (sceneId.toLowerCase().endsWith('.json')) {
                        sceneId = sceneId.slice(0, -5);
                      }

                      const entryId = comp.targetEntryId?.trim();
                      if (!sceneId) {
                        sceneId = game.sceneManager.currentScene?.id || '';
                      }
                      if (!sceneId) {
                        game.onMessage?.(
                          'Error: Target Scene ID is empty and no current scene loaded.'
                        );
                        return;
                      }

                      const targetScene = game.sceneManager.scenes.get(sceneId);
                      const descriptor = game.sceneManager.sceneRegistry.get(sceneId);

                      if (!targetScene && !descriptor) {
                        game.onMessage?.(`Error: Scene "${sceneId}" not found in registry.`);
                        return;
                      }

                      let msg = `Scene "${sceneId}" found.`;

                      const targetTitle = targetScene?.name || descriptor?.title;

                      if (!targetTitle?.trim()) {
                        msg += ' Warning: Target scene has no Title.';
                      } else {
                        msg += ` Title: "${targetTitle}".`;
                      }

                      if (entryId) {
                        if (targetScene) {
                          const targetObj = targetScene.getObjectByName(entryId);
                          const hasEntry =
                            targetObj && targetObj.components?.some((c: any) => c.type === 'Entry');
                          if (!hasEntry) {
                            game.onMessage?.(
                              msg + ` Error: Entry "${entryId}" not found in loaded scene.`
                            );
                            return;
                          }
                          msg += ` Entry "${entryId}" found.`;
                        } else if (descriptor?.sourceData) {
                          const sd = descriptor.sourceData;
                          const allObjects = [...(sd.entities || []), ...(sd.triggerboxes || [])];
                          const hasEntry = allObjects.some(
                            (e: any) =>
                              String(e.name || '').trim() === entryId &&
                              (e.components || []).some((c: any) => c.type === 'Entry')
                          );
                          if (!hasEntry) {
                            game.onMessage?.(
                              msg + ` Error: Entry "${entryId}" not found in scene data.`
                            );
                            return;
                          }
                          msg += ` Entry "${entryId}" found.`;
                        } else {
                          msg += ` (Scene not loaded, entry check skipped).`;
                        }
                      }

                      game.onMessage?.(msg);
                    }}
                  >
                    Check
                  </button>
                </div>
              </>
            )}

            {comp.type === 'Entry' && (
              <>
                <div className="e-row">
                  <div
                    style={{
                      fontSize: '10px',
                      color: 'var(--ui-label-color)',
                      fontStyle: 'italic',
                      marginBottom: '4px',
                    }}
                  >
                    Defines a landing point for scene transitions.
                  </div>
                  <label className="e-label" style={{ fontSize: '10px' }}>
                    Facing Direction
                  </label>
                  <Select
                    value={comp.direction || 'down'}
                    onChange={(value) => {
                      comp.direction = value as 'up' | 'down' | 'left' | 'right';
                      incrementObjectVersion();
                    }}
                    options={directionOptions}
                    style={{ width: '100%' }}
                  />
                </div>
              </>
            )}

            {comp.type === '3d-parallax' && (
              <>
                <div className="e-row">
                  <div
                    style={{
                      fontSize: '10px',
                      color: 'var(--ui-label-color)',
                      fontStyle: 'italic',
                    }}
                  >
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
                      color: 'var(--ui-label-color)',
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
                  {(obj as any)?.type === 'Quad' && (
                    <div className="e-row" style={{ marginTop: '8px' }}>
                      <label
                        className="e-label"
                        style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}
                      >
                        <input
                          type="checkbox"
                          checked={!!(comp as any).perspectiveWalk3D}
                          onChange={(e) => {
                            (comp as any).perspectiveWalk3D = e.target.checked;
                            incrementObjectVersion();
                          }}
                          style={{ marginRight: '6px' }}
                        />
                        3d-perspective walk
                      </label>
                    </div>
                  )}
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
                    <label className="e-label" style={{ fontSize: '10px', marginRight: '5px' }}>
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
                      value={comp.keyId || ''}
                      onChange={(e) => {
                        comp.keyId = e.target.value;
                        incrementObjectVersion();
                      }}
                    />
                  </div>
                </div>

                <div className="e-row">
                  <label className="e-label" style={{ fontSize: '10px' }}>
                    Blocked Relation
                  </label>
                  <Select
                    value={comp.blockedRelation || 'in'}
                    onChange={(value) => {
                      comp.blockedRelation = value;
                      incrementObjectVersion();
                    }}
                    options={blockedRelationOptions}
                    style={{ width: '100%' }}
                  />
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
                                comp.sound1 = normalizeSoundPath(file);
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
                                comp.sound2 = normalizeSoundPath(file);
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

            {comp.type === 'Blocker' && (
              <>
                <div
                  style={{
                    fontSize: '10px',
                    color: 'var(--ui-label-color)',
                    fontStyle: 'italic',
                    marginBottom: '4px',
                  }}
                >
                  Semantically blocks objects on a chosen spatial relation.
                </div>
                <div className="e-row">
                  <label className="e-label" style={{ fontSize: '10px' }}>
                    Blocked Relation
                  </label>
                  <Select
                    value={comp.blockedRelation || 'in'}
                    onChange={(value) => {
                      comp.blockedRelation = value;
                      incrementObjectVersion();
                    }}
                    options={blockedRelationOptions}
                    style={{ width: '100%' }}
                  />
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
              </>
            )}

            {comp.type === 'Shadow' && (
              <>
                <div className="e-row">
                  <div
                    style={{
                      fontSize: '10px',
                      color: 'var(--ui-label-color)',
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
                      value={comp.offsetX || 0}
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
                      value={comp.offsetY || 0}
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
        );
      })}
    </div>
  );
};
