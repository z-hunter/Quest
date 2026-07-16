---
type: technology
---

# Технологии и зависимости

| Пакет/технология | Роль |
| --- | --- |
| TypeScript | типизированный engine/UI code |
| React + React DOM | app, UI и editor |
| Vite | dev server и production build |
| Vanilla CSS | app/editor/tool styles |
| Zustand | editor state |
| `@nlpjs/core`, `@nlpjs/nlp`, `@nlpjs/lang-en-min` | NLP cascade |
| `onnxruntime-web` | browser/local SLM inference |
| `@tauri-apps/api`, `@tauri-apps/cli` | desktop integration/build |
| Vitest | tests |

## Platform bridge

`src/platform/fileApi.ts` абстрагирует файловые операции для браузера/Tauri; desktop-конфигурация — `src-tauri/tauri.conf.json`. LLM backends подключаются через `ILlmProvider` и не должны просачиваться в parser contract.

## Команды

```text
npm run dev
npm run typecheck
npm test
npm run lint
npm run build
npm run tauri:dev
npm run tauri:build
```

Связанные заметки: [[Architecture]], [[Parser-and-AI]], [[Validation]].
