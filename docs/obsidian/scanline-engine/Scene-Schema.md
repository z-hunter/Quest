---
type: schema
---

# SceneData: JSON-контракт сцены

Источник декларации: `src/scene/Scene.ts`, `SceneData`.

```ts
type SceneData = {
  id: string;
  name: string;
  description?: string;
  textRedirects?: Record<string, string>;
  filename?: string;
  walkbox: { poly: { x: number; y: number }[]; name: string; mode?: 'Invert'|'Add'|'Subtract' }[];
  triggerboxes: { poly: { x: number; y: number }[]; name: string; script: string; components?: any[] }[];
  scaling: { enabled: boolean; min: number; max: number; horizon: number; front: number; correctionalScale?: number };
  entities: EntityData[];
  folders?: any[];
  displayOrder?: string[];
  camera?: { x: number; y: number; zoom: number };
  autoCenter?: boolean;
  cameraSpeed?: number;
  camDeadzoneX?: number; camDeadzoneY?: number;
  camMinX?: number; camMaxX?: number; camMinY?: number; camMaxY?: number;
  soundEnv?: Partial<SceneSoundEnv>;
  sceneLog?: SceneLogData;
}
```

## Runtime-only fields

`renderer`, `background`, animation queues, `collisionCamera`, active subscene, revealed entity set, parser notes/recent turns и editor/runtime references не являются обычными authored SceneData полями. Parser notes специально остаются runtime memory.

## Camera и scaling

`camera`/`defaultCamera` сохраняют x/y/zoom. `autoCenter`, speed, deadzone и optional bounds управляют camera follow. `scaling` задаёт perspective scale по y; `correctionalScale` фиксирует authored normalization.

## Пример фактического JSON

`public/scenes/headroom.json` содержит `id`, `name`, `filename`, `walkbox`, `triggerboxes`, `scaling`, массив `entities`, `camera`, `autoCenter`, `cameraSpeed`, deadzones. Entity Quad содержит `type`, `name`, x/y, color, layer, parallax, components/interactions, visual fields и vertices.

Связанные: [[Entity-Schema]], [[Component-Schema]], [[Data-Formats-and-Assets]].
