import React from 'react';
import { usePropertiesContext } from './PropertiesContext';
import { Select } from '../../common/Select';

import { SceneObject } from '../../../entities/SceneObject';

export const SectionComponents: React.FC = () => {
  const { game, obj, selectedObjectType, setSectionRef, incrementObjectVersion } =
    usePropertiesContext<SceneObject>();
  const o = obj;
  const title = game.textAssets.getResolvedObjectField(o, 'title');
  const hasTitle = !!title?.trim();
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

  return (
    <div ref={setSectionRef(3)} className="properties-section-block" data-section={3}>
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
              { value: 'Blocker', label: 'Blocker' },
              { value: 'Exit', label: 'Exit (Transition)' },
              { value: 'Entry', label: 'Entry (Spawn Point)' },
              ...(selectedObjectType === 'Quad'
                ? [
                    { value: 'Backface', label: 'Backface' },
                    { value: '3d-parallax', label: '3d-parallax' },
                    { value: 'WalkBox', label: 'WalkBox (Collider)' },
                  ]
                : []),
              ...(selectedObjectType === 'Actor' ? [{ value: 'Shadow', label: 'Shadow' }] : []),
            ]}
            placeholder="+ Add Component"
            onChange={(value) => {
              const type = value;
              if (!type) return;
              if (game.editor) game.editor.saveUndoState();
              if (!o.components) o.components = [];
              const relation = hasTitle ? getNextAvailableContainerRelation() : null;

              if (type === 'Subscene') {
                o.components.push({
                  type: 'Subscene',
                  targetGroupId: '',
                  itemScale: 1,
                  title: '',
                  description: '',
                });
              } else if (type === 'Subtrigger') {
                o.components.push({ type: 'Subtrigger', target: '' });
              } else if (type === 'Exit') {
                o.components.push({ type: 'Exit', targetSceneId: '', targetEntryId: '' });
              } else if (type === 'Entry') {
                o.components.push({ type: 'Entry', direction: 'down' });
              } else if (type === 'Item') {
                o.components.push({ type: 'Item' });
              } else if (type === 'Inventory') {
                if (hasTitle && !relation) {
                  game.showNotification?.('This object already has containers for all relations.');
                  return;
                }
                o.components.push({
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
                o.components.push({
                  type: 'Surface',
                  relation: relation || 'in',
                  capacity: 8,
                  groups: [],
                  items: [],
                });
              } else if (type === 'Switch') {
                o.components.push({
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
                o.components.push({
                  type: 'Blocker',
                  transparent: false,
                  blockedRelation: 'in',
                });
              } else if (type === 'Backface') {
                o.components.push({
                  type: 'Backface',
                  vertexA: 0,
                  vertexB: 1,
                  axis: 'x',
                  op: '>',
                  targetId: o.name,
                  cullingType: 'layer',
                });
              } else if (type === 'Shadow') {
                o.components.push({
                  type: 'Shadow',
                  shadowQuadId: '',
                  offsetX: 0,
                  offsetY: 0,
                  triggerId: '',
                });
              } else if (type === '3d-parallax') {
                o.components.push({ type: '3d-parallax' });
              } else if (type === 'WalkBox') {
                o.components.push({ type: 'WalkBox', mode: 'Invert' });
              }

              if (game.editor.selectedObject) {
                (game.editor.selectedObject as any).components = o.components;
              }
              incrementObjectVersion();
            }}
            style={{ width: '100%' }}
            value=""
          />
        </div>
      </div>

      {o.components &&
        o.components.map((comp: any, idx: number) => (
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

            {comp.type === 'Exit' && (
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
              </>
            )}

            {comp.type === 'Entry' && (
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
                    color: '#ccc',
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
        ))}
    </div>
  );
};
