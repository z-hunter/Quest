# Что такое React-фасад и зачем он нужен

## 🔍 Текущая проблема (БЕЗ фасада)

### Пример из `HierarchyPanel.tsx`:
```typescript
const handleAdd = (type: string) => {
    Game.instance.editor.startCreating(type);  // ❌ Прямой доступ к внутренностям
};

const handleDelete = () => {
    Game.instance.editor.deleteSelectedObject();  // ❌ Компонент знает про структуру Game
};

const scene = Game.instance?.sceneManager?.currentScene;  // ❌ Цепочка обращений
```

### Пример из `PropertiesPanel.tsx`:
```typescript
const handleChange = (field: string, value: any) => {
    // ❌ Компонент сам разбирается, где находится объект
    let realObj: any = null;
    if (Game.instance.editor.selectedObject === 'SETTINGS') {
        realObj = Game.instance.settings;
    } else if (Game.instance.editor.selectedObject === 'SCENE') {
        realObj = Game.instance.sceneManager.currentScene;
    } else {
        realObj = Game.instance.editor.selectedObject;
    }
    
    // ❌ Прямая мутация объекта
    realObj[field] = value;
};
```

### Проблемы:
1. **Компоненты знают слишком много** — они знают про `Game.instance`, `editor`, `sceneManager`, `settings`
2. **Сложно тестировать** — нужно мокировать весь `Game.instance`
3. **Сложно рефакторить** — если изменится структура `Game`, придётся менять все компоненты
4. **Нарушение инкапсуляции** — компоненты лезут во внутренности движка

---

## ✅ Решение: Фасад (Facade Pattern)

**Фасад** — это простой интерфейс, который скрывает сложность подсистемы.

### Концептуально:

```
┌─────────────────┐
│ React Components│
│  (UI Layer)     │
└────────┬────────┘
         │
         │ Простой API
         │ (фасад)
         ▼
┌─────────────────┐
│  EditorFacade   │  ← Фасад (простой интерфейс)
│  (Facade Layer) │
└────────┬────────┘
         │
         │ Сложные вызовы
         │ (скрыты внутри)
         ▼
┌─────────────────┐
│  Game / Editor  │
│  (Engine Layer) │
└─────────────────┘
```

---

## 📝 Пример реализации фасада

### 1. Создаём интерфейс фасада:

```typescript
// src/facades/EditorFacade.ts

export interface EditorFacade {
    // Операции с объектами
    createObject(type: 'Static' | 'Actor' | 'Walkbox' | 'Triggerbox', params?: any): void;
    deleteObject(id: string): void;
    selectObject(id: string | 'SCENE' | 'SETTINGS'): void;
    updateObject(id: string, patch: Partial<ObjectProperties>): void;
    duplicateObject(id: string): void;
    
    // Операции со сценой
    getCurrentScene(): SceneSnapshot | null;
    updateSceneProperties(patch: Partial<SceneProperties>): void;
    saveScene(saveAs?: boolean): Promise<void>;
    loadScene(filename: string): Promise<void>;
    newScene(): void;
    
    // Операции с файлами
    saveObject(id: string): Promise<void>;
    loadObject(): Promise<void>;
    
    // Утилиты
    openFileBrowser(mode: 'save' | 'load', dir: string, onConfirm: (f: string) => void): void;
}

// Типы для данных (snapshots)
export interface SceneSnapshot {
    id: string;
    name: string;
    entities: EntitySnapshot[];
    walkboxes: WalkboxSnapshot[];
    triggers: TriggerboxSnapshot[];
    camera: CameraSnapshot;
    scaling: ScalingSnapshot;
}

export interface EntitySnapshot {
    id: string;
    type: 'Entity' | 'Actor' | 'Static';
    name: string;
    x: number;
    y: number;
    width: number;
    height: number;
    // ... остальные поля
}
```

### 2. Реализуем фасад:

```typescript
// src/facades/EditorFacadeImpl.ts

import { Game } from '../core/Game';
import { useEditorStore } from '../store/editorStore';
import type { EditorFacade, SceneSnapshot, EntitySnapshot } from './EditorFacade';

export class EditorFacadeImpl implements EditorFacade {
    private get game(): Game {
        if (!Game.instance) {
            throw new Error('Game not initialized');
        }
        return Game.instance;
    }

    createObject(type: 'Static' | 'Actor' | 'Walkbox' | 'Triggerbox', params?: any): void {
        this.game.editor.startCreating(type);
        // Внутри фасада может быть дополнительная логика:
        // - валидация параметров
        // - логирование
        // - обновление store
        useEditorStore.getState().incrementHierarchyVersion();
    }

    deleteObject(id: string): void {
        const obj = this.findObjectById(id);
        if (!obj) {
            console.warn(`Object ${id} not found`);
            return;
        }
        
        this.game.editor.deleteSelectedObject();
        useEditorStore.getState().incrementHierarchyVersion();
    }

    selectObject(id: string | 'SCENE' | 'SETTINGS'): void {
        if (id === 'SCENE' || id === 'SETTINGS') {
            this.game.editor.selectObject(id);
        } else {
            const obj = this.findObjectById(id);
            if (obj) {
                this.game.editor.selectObject(obj);
            }
        }
        // Фасад сам обновляет store
        const obj = this.game.editor.selectedObject;
        const type = this.getObjectType(obj);
        useEditorStore.getState().selectObject(id, type);
    }

    updateObject(id: string, patch: Partial<ObjectProperties>): void {
        const obj = this.findObjectById(id);
        if (!obj) {
            console.warn(`Object ${id} not found`);
            return;
        }

        // Фасад знает, как правильно обновить объект
        // Вместо прямой мутации, используем методы редактора
        this.game.editor.updateObjectProperties(obj, patch);
        
        // Обновляем store
        useEditorStore.getState().incrementObjectVersion();
        if (patch.name) {
            useEditorStore.getState().incrementHierarchyVersion();
        }
    }

    getCurrentScene(): SceneSnapshot | null {
        const scene = this.game.sceneManager.currentScene;
        if (!scene) return null;

        // Фасад преобразует внутренние объекты в snapshots
        return {
            id: scene.id,
            name: scene.name,
            entities: scene.entities.map(e => this.entityToSnapshot(e)),
            walkboxes: scene.walkbox.map(w => this.walkboxToSnapshot(w)),
            triggers: scene.triggerboxes.map(t => this.triggerboxToSnapshot(t)),
            camera: {
                x: scene.camera.x,
                y: scene.camera.y,
                zoom: scene.camera.zoom,
            },
            scaling: { ...scene.scaling },
        };
    }

    // Приватные методы для преобразования
    private entityToSnapshot(entity: Entity): EntitySnapshot {
        return {
            id: entity.name,
            type: entity.type || 'Entity',
            name: entity.name,
            x: entity.x,
            y: entity.y,
            // ... остальные поля
        };
    }

    private findObjectById(id: string): any {
        const scene = this.game.sceneManager.currentScene;
        if (!scene) return null;

        // Ищем в entities
        const entity = scene.entities.find(e => e.name === id);
        if (entity) return entity;

        // Ищем в walkboxes
        const walkbox = scene.walkbox.find(w => w.name === id);
        if (walkbox) return walkbox;

        // Ищем в triggers
        const trigger = scene.triggerboxes.find(t => t.name === id);
        if (trigger) return trigger;

        return null;
    }

    private getObjectType(obj: any): string {
        if (obj === 'SCENE') return 'SCENE';
        if (obj === 'SETTINGS') return 'SETTINGS';
        if (obj instanceof Actor) return 'Actor';
        if (obj instanceof Entity) return 'Entity';
        if (obj instanceof Walkbox) return 'Walkbox';
        if (obj instanceof Triggerbox) return 'Triggerbox';
        return 'Unknown';
    }

    // ... остальные методы
}
```

### 3. Создаём React Context для фасада:

```typescript
// src/contexts/EditorContext.tsx

import React, { createContext, useContext } from 'react';
import { EditorFacade } from '../facades/EditorFacade';
import { EditorFacadeImpl } from '../facades/EditorFacadeImpl';

const EditorContext = createContext<EditorFacade | null>(null);

export const EditorProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const facade = React.useMemo(() => new EditorFacadeImpl(), []);
    
    return (
        <EditorContext.Provider value={facade}>
            {children}
        </EditorContext.Provider>
    );
};

export const useEditor = (): EditorFacade => {
    const facade = useContext(EditorContext);
    if (!facade) {
        throw new Error('useEditor must be used within EditorProvider');
    }
    return facade;
};
```

### 4. Используем фасад в компонентах:

```typescript
// src/components/editor/HierarchyPanel.tsx (ПОСЛЕ)

import React from 'react';
import { useEditor } from '../../contexts/EditorContext';
import { useEditorStore } from '../../store/editorStore';

export const HierarchyPanel: React.FC = () => {
    const editor = useEditor();  // ✅ Получаем фасад через Context
    const { hierarchyVersion, selectedObjectId } = useEditorStore();
    
    // ✅ Простой API, компонент не знает про Game.instance
    const handleAdd = (type: string) => {
        editor.createObject(type as any);
    };

    const handleDelete = () => {
        if (selectedObjectId) {
            editor.deleteObject(selectedObjectId);
        }
    };

    // ✅ Фасад возвращает простые данные (snapshots)
    const scene = editor.getCurrentScene();

    if (!scene) return <div>No Scene</div>;

    return (
        <div>
            {/* Рендерим scene.entities, scene.walkboxes и т.д. */}
            {scene.entities.map(entity => (
                <div key={entity.id} onClick={() => editor.selectObject(entity.id)}>
                    {entity.name}
                </div>
            ))}
        </div>
    );
};
```

```typescript
// src/components/editor/PropertiesPanel.tsx (ПОСЛЕ)

import React from 'react';
import { useEditor } from '../../contexts/EditorContext';
import { useEditorStore } from '../../store/editorStore';

export const PropertiesPanel: React.FC = () => {
    const editor = useEditor();  // ✅ Фасад вместо Game.instance
    const { selectedObjectId, selectedObjectType } = useEditorStore();
    
    const [obj, setObj] = useState<EntitySnapshot | null>(null);

    useEffect(() => {
        if (!selectedObjectId) {
            setObj(null);
            return;
        }

        // ✅ Фасад возвращает snapshot, а не реальный объект
        const snapshot = editor.getObjectSnapshot(selectedObjectId);
        setObj(snapshot);
    }, [selectedObjectId, editor]);

    const handleChange = (field: string, value: any) => {
        if (!selectedObjectId) return;

        // ✅ Простой API: "обнови объект с такими полями"
        editor.updateObject(selectedObjectId, { [field]: value });
        
        // Обновляем локальный state для немедленного отображения
        setObj(prev => prev ? { ...prev, [field]: value } : null);
    };

    // ... остальной код
};
```

---

## 🎯 Преимущества фасада

### 1. **Изоляция React от движка**
- Компоненты не знают про `Game.instance`, `editor`, `sceneManager`
- Если изменится структура движка, меняем только фасад

### 2. **Простое тестирование**
```typescript
// Можно легко создать мок-фасад для тестов
const mockFacade: EditorFacade = {
    createObject: jest.fn(),
    deleteObject: jest.fn(),
    // ...
};

// В тесте:
render(<HierarchyPanel />, { wrapper: ({ children }) => 
    <EditorContext.Provider value={mockFacade}>
        {children}
    </EditorContext.Provider>
});
```

### 3. **Типобезопасность**
- Фасад возвращает типизированные snapshots
- Нет `any`, есть автодополнение в IDE

### 4. **Единая точка входа**
- Вся логика работы с редактором в одном месте
- Легко добавить логирование, валидацию, кэширование

### 5. **Гибкость**
- Можно легко заменить реализацию (например, для разных режимов редактора)
- Можно добавить middleware (например, для undo/redo)

---

## 📊 Сравнение: До и После

### ❌ БЕЗ фасада:
```typescript
// Компонент знает про:
Game.instance.editor.startCreating(type);
Game.instance.sceneManager.currentScene.entities
Game.instance.editor.selectedObject
Game.instance.settings.crt.enabled
```

### ✅ С фасадом:
```typescript
// Компонент знает только про:
editor.createObject(type);
editor.getCurrentScene().entities
editor.getSelectedObject()
editor.getSettings().crt.enabled
```

---

## 🔄 Интеграция с существующим кодом

Фасад можно вводить постепенно:

1. **Создать фасад** рядом с существующим кодом
2. **Перевести один компонент** на фасад (например, `HierarchyPanel`)
3. **Проверить, что всё работает**
4. **Постепенно переводить остальные компоненты**

Старый код (`Game.instance.*`) может работать параллельно, пока не переведёшь всё.

---

## 💡 Итог

**Фасад** — это "переводчик" между React-компонентами и игровым движком:
- Компоненты говорят на простом языке: "создай объект", "удали объект"
- Фасад переводит это в сложные вызовы: `Game.instance.editor.startCreating(...)`
- Компоненты получают простые данные (snapshots) вместо сложных объектов движка

Это делает код:
- ✅ Проще для понимания
- ✅ Легче для тестирования
- ✅ Удобнее для рефакторинга
- ✅ Более типобезопасным




