import type { SceneObject } from '../../../entities/SceneObject';

export function findDuplicateSceneObjectName(
  scene: any,
  name: string,
  currentObject: unknown
): SceneObject | null {
  const finalName = name.trim();
  if (!scene || !finalName) return null;

  const selected = currentObject as SceneObject | null | undefined;
  const allObjects: SceneObject[] = [
    ...(scene.entities || []),
    ...(scene.walkbox || []),
    ...(scene.triggerboxes || []),
  ];

  return (
    allObjects.find((candidate) => candidate.name === finalName && candidate !== selected) || null
  );
}
