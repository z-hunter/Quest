import React from 'react';
import { usePropertiesContext } from './PropertiesContext';
import { renderSection } from './propertiesUtils';
import { getPolyCentroid } from './propertiesUtils';

import { Triggerbox } from '../../../entities/Triggerbox';

interface TriggerboxPropertiesProps {
  translatePolyTo: (targetX: number, targetY: number) => void;
  polygonScaleDraft: string;
  applyPolygonScaleDraft: (nextScaleRaw: string) => void;
}

export const TriggerboxProperties: React.FC<TriggerboxPropertiesProps> = ({
  translatePolyTo,
  polygonScaleDraft,
  applyPolygonScaleDraft,
}) => {
  const { game, obj, handleChange, formatPanelNumber, setSectionRef } =
    usePropertiesContext<Triggerbox>();
  const tb = obj;
  const { x: cx, y: cy } = getPolyCentroid(tb.poly);

  return (
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
                value={formatPanelNumber(cx)}
                onChange={(e) => translatePolyTo(parseFloat(e.target.value) || 0, cy)}
              />
            </div>
            <div>
              <label className="e-label">Y</label>
              <input
                type="number"
                className="e-input"
                value={formatPanelNumber(cy)}
                onChange={(e) => translatePolyTo(cx, parseFloat(e.target.value) || 0)}
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
                value={formatPanelNumber(tb.layer || 0)}
                onChange={(e) => handleChange('layer', e.target.value, true)}
              />
            </div>
            <div>
              <label className="e-label">Parallax</label>
              <input
                type="number"
                step="0.1"
                className="e-input"
                value={formatPanelNumber(tb.parallax ?? 1)}
                onChange={(e) => {
                  const val = parseFloat(e.target.value);
                  const newP = isNaN(val) ? 1.0 : val;
                  const oldP = tb.parallax !== undefined ? tb.parallax : 1.0;
                  const scene = game.sceneManager.currentScene;
                  if (scene && tb.poly?.length) {
                    const dx = scene.camera.x * (newP - oldP);
                    const dy = scene.camera.y * (newP - oldP);
                    tb.poly = tb.poly.map((pt: any) => ({
                      x: Math.round(pt.x + dx),
                      y: Math.round(pt.y + dy),
                    }));
                  }
                  handleChange('parallax', newP, true);
                }}
              />
            </div>
          </div>
        </>,
        setSectionRef
      )}
    </>
  );
};
