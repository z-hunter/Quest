import React from 'react';
import { usePropertiesContext } from './PropertiesContext';
import { Select } from '../../common/Select';
import { getQuadCentroid, renderOpacityBlurControls } from './propertiesUtils';
import { QuadObject } from '../../../entities/QuadObject';

interface QuadPropertiesProps {
  polygonScaleDraft: string;
  applyPolygonScaleDraft: (nextScaleRaw: string) => void;
  translateQuadTo: (targetX: number, targetY: number) => void;
}

export const QuadProperties: React.FC<QuadPropertiesProps> = ({
  polygonScaleDraft,
  applyPolygonScaleDraft,
  translateQuadTo,
}) => {
  const {
    game,
    obj,
    handleChange,
    formatPanelNumber,
    setSectionRef,
    selectedVertexIndex,
    incrementObjectVersion,
  } = usePropertiesContext<QuadObject>();
  const quad = obj;
  const centroid = getQuadCentroid(quad);

  return (
    <div className="e-row">
      {/* Section 1: Transform header */}
      <div ref={setSectionRef(1)} className="properties-section-block" data-section={1}>
        <div className="properties-section-header properties-section-blue">
          <div className="properties-section-title">
            <span className="properties-section-number properties-section-blue">1</span>
            <span className="properties-section-label">Transform</span>
          </div>
        </div>
        <div className="properties-section-body">
          {/* Position / Layer */}
          <div
            className="e-row"
            style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '5px' }}
          >
            <div>
              <label className="e-label">X</label>
              <input
                type="number"
                className="e-input"
                value={formatPanelNumber(centroid.x)}
                onChange={(e) => translateQuadTo(parseFloat(e.target.value) || 0, centroid.y)}
              />
            </div>
            <div>
              <label className="e-label">Y</label>
              <input
                type="number"
                className="e-input"
                value={formatPanelNumber(centroid.y)}
                onChange={(e) => translateQuadTo(centroid.x, parseFloat(e.target.value) || 0)}
              />
            </div>
            <div>
              <label className="e-label">Layer</label>
              <input
                type="number"
                className="e-input"
                value={formatPanelNumber(quad.layer || 0)}
                onChange={(e) => handleChange('layer', e.target.value, true)}
              />
            </div>
          </div>

          {/* Parallax / Scale / Depth Sort */}
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
                value={formatPanelNumber(quad.parallax ?? 1)}
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
                value={quad.sortMode || 'ignore'}
                onChange={(value) => handleChange('sortMode', value)}
                options={[
                  { value: 'ignore', label: 'Ignore Y (Manual)' },
                  { value: 'v0', label: 'By Vertex 0 (TL)' },
                  { value: 'v1', label: 'By Vertex 1 (TR)' },
                  { value: 'v2', label: 'By Vertex 2 (BR)' },
                  { value: 'v3', label: 'By Vertex 3 (BL)' },
                ]}
                style={{ width: '100%' }}
              />
            </div>
          </div>

          {/* Vertices */}
          <div
            className="e-label ui-text-accent-blue ui-font-bold"
            style={{ marginTop: '6px', marginBottom: '6px' }}
          >
            Vertices
          </div>
          {quad.vertices &&
            quad.vertices.map((v: any, i: number) => {
              const isSelected = selectedVertexIndex === i;
              return (
                <div
                  key={i}
                  className="component-block"
                  style={{
                    marginBottom: '5px',
                    padding: '4px',
                    borderColor: isSelected ? 'var(--sec-color-2)' : 'var(--ui-input-border)',
                  }}
                >
                  <div className="ui-text-muted ui-text-tiny" style={{ marginBottom: '2px' }}>
                    Vertex {i}{' '}
                    {i === 0 ? '(TL)' : i === 1 ? '(TR)' : i === 2 ? '(BR)' : i === 3 ? '(BL)' : ''}
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
                          className="e-btn e-btn-small"
                          title="Unbind Vertex"
                          style={{
                            fontSize: '0.7em',
                            marginLeft: '4px',
                            cursor: 'pointer',
                            padding: '0 4px',
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
        </div>
      </div>

      {/* Section 2: Visual header */}
      <div ref={setSectionRef(2)} className="properties-section-block" data-section={2}>
        <div className="properties-section-header properties-section-yellow">
          <div className="properties-section-title">
            <span className="properties-section-number properties-section-yellow">2</span>
            <span className="properties-section-label">Visual</span>
          </div>
        </div>
        <div className="properties-section-body">
          {/* Opacity / Blur */}
          {renderOpacityBlurControls(
            quad.opacity !== undefined ? quad.opacity : 1.0,
            quad.blur || 0,
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
              }}
            >
              <input
                type="checkbox"
                style={{ marginRight: '5px' }}
                checked={quad.filled !== false}
                onChange={(e) => handleChange('filled', e.target.checked)}
              />
              Fill Color
            </label>
            {quad.filled !== false && (
              <div style={{ display: 'flex', gap: '5px' }}>
                <input
                  type="color"
                  className="e-input"
                  style={{ width: '30px', padding: 0, height: '20px' }}
                  value={quad.color || '#888888'}
                  onChange={(e) => handleChange('color', e.target.value)}
                />
                <input
                  type="text"
                  className="e-input"
                  style={{ flex: 1 }}
                  value={quad.color || ''}
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
              }}
            >
              <input
                type="checkbox"
                style={{ marginRight: '5px' }}
                checked={quad.isGrid || false}
                onChange={(e) => handleChange('isGrid', e.target.checked)}
              />
              Retro Grid
            </label>
          </div>

          {quad.isGrid && (
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
                    value={formatPanelNumber(quad.gridLinesX ?? 5)}
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
                    value={formatPanelNumber(quad.gridLinesY ?? 5)}
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
                    value={formatPanelNumber(quad.lineWidth ?? 1.0)}
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
                    value={quad.gridColor || '#ffffff'}
                    onChange={(e) => handleChange('gridColor', e.target.value)}
                  />
                  <input
                    type="text"
                    className="e-input"
                    style={{ flex: 1 }}
                    value={quad.gridColor || ''}
                    onChange={(e) => handleChange('gridColor', e.target.value)}
                  />
                </div>
              </div>

              <div
                className="e-row"
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
              >
                <label
                  className="e-label"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    cursor: 'pointer',
                  }}
                >
                  <input
                    type="checkbox"
                    style={{ marginRight: '5px' }}
                    checked={quad.gridPerspective ?? true}
                    onChange={(e) => handleChange('gridPerspective', e.target.checked)}
                  />
                  Perspective
                </label>
              </div>

              {(quad.gridPerspective ?? true) && (
                <div className="e-row">
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                    }}
                  >
                    <label className="e-label">Amount</label>
                    <span style={{ fontSize: '11px', opacity: 0.8 }}>
                      {formatPanelNumber(quad.gridPerspectiveAmount ?? 1.0)}
                    </span>
                  </div>
                  <input
                    type="range"
                    style={{ width: '100%', cursor: 'pointer' }}
                    min={0}
                    max={2}
                    step={0.05}
                    value={quad.gridPerspectiveAmount ?? 1.0}
                    onChange={(e) =>
                      handleChange('gridPerspectiveAmount', parseFloat(e.target.value))
                    }
                  />
                </div>
              )}
            </>
          )}

          {/* Blend Mode */}
          <div
            className="e-row"
            style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '5px' }}
          >
            <div>
              <label className="e-label">Blend Mode</label>
              <Select
                value={quad.blendMode || 'source-over'}
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
      </div>
    </div>
  );
};
