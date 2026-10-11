import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { Folder } from '../../src/entities/Folder';
import { FolderProperties } from '../../src/components/editor/properties/FolderProperties';
import {
  PropertiesContext,
  type PropertiesContextValue,
} from '../../src/components/editor/properties/PropertiesContext';

function render(compound: boolean) {
  const folder = new Folder({} as any, 'Group');
  const state = {
    x: 0,
    y: 0,
    z: 0,
    rotationX: 0,
    rotationY: 0,
    rotationZ: 0,
    uniformScale: 1,
    scaleX: 1,
    scaleY: 1,
    scaleZ: 1,
    bottomWidth: 1,
    bottomDepth: 1,
    topWidth: 1,
    topDepth: 1,
    height: 1,
    topOffsetX: 0,
    topOffsetZ: 0,
    pivotX: { x: 0, y: 0, z: 0 },
    pivotY: { x: 0, y: 0, z: 0 },
    pivotZ: { x: 0, y: 0, z: 0 },
    axisMode: 'camera' as const,
    axisRotationX: 0,
    axisRotationY: 0,
    axisRotationZ: 0,
  };
  const context = {
    game: {
      editor: { selectionManager: { getCompoundBox3DState: () => (compound ? state : null) } },
    },
    obj: folder,
    selectedObjectType: 'Folder',
    selectedObjectId: folder.name,
    mode: null,
    selectedVertexIndex: null,
    uiScale: 1,
    handleChange: vi.fn(),
    incrementObjectVersion: vi.fn(),
    incrementHierarchyVersion: vi.fn(),
    formatPanelNumber: (value: unknown) => value as number,
    setSectionRef: () => () => {},
    scrollToSection: vi.fn(),
    lastUndoObjectKeyRef: { current: null },
    anyExpanded: true,
    collapseAll: vi.fn(),
    expandAll: vi.fn(),
  } as unknown as PropertiesContextValue;
  return renderToStaticMarkup(
    React.createElement(
      PropertiesContext.Provider,
      { value: context },
      React.createElement(FolderProperties)
    )
  );
}

describe('FolderProperties Compound Box3D mode', () => {
  it('shows Compound transforms without Cutter or legacy Folder controls', () => {
    const html = render(true);
    expect(html).toContain('Compound Box3D / Frustum');
    expect(html).toContain('Move X');
    expect(html).toContain('Pivot Z');
    expect(html).toContain('Axes: Camera');
    expect(html).not.toContain('Cutter');
    expect(html).not.toContain('Select Contents');
    expect(html).not.toContain('Children Defaults');
  });

  it('keeps the legacy controls for an ordinary Folder', () => {
    const html = render(false);
    expect(html).toContain('Select Contents');
    expect(html).toContain('Children Defaults');
    expect(html).not.toContain('Compound Box3D / Frustum');
  });
});
