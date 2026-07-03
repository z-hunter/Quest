export type SpatialRelationType = 'in' | 'on' | 'under' | 'behind' | 'near';

export type SpatialPlacement = {
  parentNodeId?: string | null;
  relation?: SpatialRelationType | null;
};

export type SpatialSubsceneData = {
  nodeId?: string;
  title?: string;
  description?: string | null;
  spatial?: SpatialPlacement;
};

export type SpatialNodeDescriptor = {
  id: string;
  kind: 'entity' | 'subscene';
  title: string | null;
  placement: SpatialPlacement | null;
  sourceName: string;
};

export type SpatialIndex = {
  nodeById: Map<string, SpatialNodeDescriptor>;
  childrenByParentId: Map<string, SpatialNodeDescriptor[]>;
  childrenByParentAndRelation: Map<string, Map<SpatialRelationType, SpatialNodeDescriptor[]>>;
};
