import React from 'react';
import { Box3DObject } from '../../../entities/Box3DObject';
import { Select } from '../../common/Select';
import { usePropertiesContext } from './PropertiesContext';

const fields: Array<[keyof Box3DObject, string]> = [
  ['x', 'Move X'],
  ['y', 'Move Y'],
  ['z', 'Move Z'],
  ['rotationX', 'Rotate X'],
  ['rotationY', 'Rotate Y'],
  ['rotationZ', 'Rotate Z'],
  ['uniformScale', 'Scale'],
  ['scaleX', 'Scale X'],
  ['scaleY', 'Scale Y'],
  ['scaleZ', 'Scale Z'],
  ['bottomWidth', 'Bottom width'],
  ['bottomDepth', 'Bottom depth'],
  ['topWidth', 'Top width'],
  ['topDepth', 'Top depth'],
  ['height', 'Height'],
  ['topOffsetX', 'Top offset X'],
  ['topOffsetZ', 'Top offset Z'],
];

export const Box3DProperties: React.FC = () => {
  const { obj, handleChange, formatPanelNumber, setSectionRef } =
    usePropertiesContext<Box3DObject>();
  const numberInput = (label: string, value: number, onChange: (value: number) => void) => (
    <label key={label} className="e-label">
      {label}
      <input
        aria-label={label}
        className="e-input"
        type="number"
        step="0.1"
        value={formatPanelNumber(value)}
        onChange={(event) => onChange(Number(event.target.value) || 0)}
      />
    </label>
  );
  const pivotControls = (key: 'pivotX' | 'pivotY' | 'pivotZ', label: string) => (
    <React.Fragment key={key}>
      <div
        className="e-label ui-text-accent-blue"
        style={{ gridColumn: '1 / -1', marginTop: '4px' }}
      >
        {label}
      </div>
      {(['x', 'y', 'z'] as const).map((axis) =>
        numberInput(`${label} ${axis.toUpperCase()}`, obj[key][axis], (value) =>
          handleChange(key, { ...obj[key], [axis]: value })
        )
      )}
    </React.Fragment>
  );
  return (
    <div className="e-row">
      <div ref={setSectionRef(1)} className="properties-section-block" data-section={1}>
        <div className="properties-section-header properties-section-blue">
          <div className="properties-section-title">
            <span className="properties-section-number properties-section-blue">1</span>
            <span className="properties-section-label">Transform 3D / Frustum</span>
          </div>
        </div>
        <div
          className="properties-section-body"
          style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '5px' }}
        >
          <label className="e-label" style={{ gridColumn: '1 / -1' }}>
            <input
              aria-label="Cutter"
              type="checkbox"
              checked={obj.cutter}
              onChange={(event) => handleChange('cutter', event.target.checked)}
            />{' '}
            Cutter
          </label>
          <label className="e-label" style={{ gridColumn: '1 / -1' }}>
            3D Occlusion
            <Select
              value={obj.occlusionMode}
              onChange={(value) => handleChange('occlusionMode', value)}
              options={[
                { value: 'inherit', label: 'Inherit scene' },
                { value: 'fast', label: 'Fast' },
              ]}
            />
          </label>
          {fields.map(([field, label]) =>
            numberInput(label, obj[field] as number, (value) =>
              handleChange(String(field), value, true)
            )
          )}
          {pivotControls('pivotX', 'Pivot X')}
          {pivotControls('pivotY', 'Pivot Y')}
          {pivotControls('pivotZ', 'Pivot Z')}
        </div>
      </div>
    </div>
  );
};
