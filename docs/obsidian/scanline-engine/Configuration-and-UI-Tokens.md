# Константы, настройки и UI-токены

Это каталог именованных tuning-параметров и пользовательских настроек, подтверждённых текущим кодом. Разовые математические литералы и локальные `Number.MAX_SAFE_INTEGER` не считаются самостоятельной конфигурацией.

## Persisted Game settings

`src/core/Game.ts` хранит настройки в `localStorage` под ключом `quest_settings`. При старте значения merge-ятся с defaults; `saveSettings` сериализует весь объект.

```ts
settings = {
  crt: {
    enabled: true,
    curvature: 0.16,
    scanlineCount: 200,
    scanlineIntensity: 0.4,
    aberration: 0.2,
    vignette: 0.9,
    phosphor: 1.0,
    bezelGlow: true,
    bloom: 0.05
  },
  editor: { uiScale: 1.0, viewportZoom: 'fit' },
  audio: { attachedVolume: 1.0 }
}
```

`SettingsProperties.tsx` редактирует UI Scale, viewport zoom (`fit|1|1.5|2`), attached volume (clamped `0..10`) и CRT sliders/toggles. `GameCanvas`, editor panels и `vetool.tsx` читают те же settings.

## Resolution и rendering

- `src/core/Resolution.ts`: `GAME_DESIGN_WIDTH = 420`, `GAME_DESIGN_HEIGHT = 300`.
- Pixel-art canvas отключает image smoothing для game/UI buffers; editor overlay оставляет smoothing включённым.
- `src/scene/SceneManager.ts`: `GRAPH_WEIGHT_FACTOR = 0.15`, `TEXTURE_BYTES_PER_UNIT = 64 * 1024`.
- `src/scene/Scene.ts`: parser history — 8 последних turns, response каждого turn обрезается до 340 символов.
- `src/scene/SceneLog.ts`: `SCENE_LOG_RETENTION_MS = 10 * 60 * 1000`.

## Parser, NLP и LLM

- `NlpCascade.ts`: `NLP_CONFIDENCE_THRESHOLD = 0.58`; localStorage model cache prefix `quest:nlp:model:v1:`.
- `LlmCascade.ts`: system prompt URL `/text/system/parser-llm-system.md`, service asset domain `parser-llm`, Anthropic cache eligibility threshold `4096` estimated tokens; allowed action/relation sets являются typed guardrails.
- `AnthropicProvider.ts`: proxy `/api/llm`, model `claude-haiku-4-5-20251001`, max tokens `1024`, timeout `10000 ms`.
- `OllamaProvider.ts`: base URL `http://localhost:11434/v1/chat/completions`, model `qwen2.5:3b`, max tokens `1024`, timeout `600000 ms`, temperature `0.2`.
- `createLlmProvider.ts`: `VITE_LLM_PROVIDER=anthropic` (default) или `ollama`; `Game` передаёт один выбранный provider и Parser, и NPC Puppet Master.
- Packaged Tauri: `ANTHROPIC_API_KEY` задаётся в окружении desktop process; optional `OLLAMA_BASE_URL` заменяет локальный URL Ollama. Browser key и CORS не используются.

## NPC Puppet Master

`src/mechanics/NpcPuppetMaster.ts`:

| Константа | Значение | Назначение |
|---|---:|---|
| `PM_STRATEGY_DEFAULT_WAIT_MS` | 30 000 ms | default ожидания strategy |
| `PM_STRATEGY_MIN/MAX_WAIT_MS` | 1 000 / 60 000 ms | clamp `waitMs` |
| `PM_BATCH_DEBOUNCE_MS` | 400 ms (150 в test) | debounce wake batch |
| `PM_REPEAT_WARNING_COUNT` | 2 | warning перед подавлением |
| `PM_REPEAT_SUPPRESS_COUNT` | 3 | terminal повтор |
| `PM_LOOP_COOLDOWN_MS` | 10 000 ms | sleep после loop |
| `PM_RATE_WINDOW_MS` | 10 000 ms | sliding window |
| `PM_MAX_NPC_CALLS_PER_WINDOW` | 6 | budget на NPC |
| `PM_MAX_SCENE_CALLS_PER_WINDOW` | 12 | budget на сцену |
| `PM_MEMORY_CONTINUATION_LIMIT` | 3 | максимум memory-only continuations |
| `PM_PATTERN_LOOP_WINDOW` | 6 | длина окна signatures |
| `PM_PATTERN_LOOP_UNIQUE_LIMIT` | 3 | порог повторяющихся signatures |
| `PM_ACTION_HISTORY_LIMIT` | 10 | размер action history |
| `ANTHROPIC_HAIKU_45_MIN_CACHE_TOKENS` | 4096 | cache eligibility estimate |

## Console и editor tooling

- `Console.ts`: buffer `2000` lines, command history `50`, closed-console viewport `2` lines, wrap `68` columns.
- `EditorUndoManager.ts`: undo history `50` entries.
- `EditorSnappingSystem.ts`: geometric epsilon `0.0001`.
- `SlmInferenceEngine.ts`: ONNX model path `/models/slm_routine_v1.onnx`.

## Audio tuning

`src/systems/SoundManager.ts` defaults:

```ts
audioMaxDistance: 10000
reverbMaxDist: 1750
reverbMinPercent: 0.2
zoomSensitivity: 0.7
pannerRefDistance: 100
pannerRolloffFactor: 0.7
panningModel: 'HRTF'
distanceModel: 'linear'
defaultReverbIR: ''
```

Derived constants: `AUDIO_MAX_DISTANCE = 10000`, `PARALLAX_TO_Z_MULTIPLIER = 400`, `REVERB_WET_OUTPUT_GAIN = 0.025`, `REVERB_DISTANCE_EXPONENT = 1.5`, `REVERB_WET_FADE_IN_SECONDS = 0.12`, minimum reverb/dry levels `0.3`.

## UI colors и fonts

Основные CSS custom properties объявлены в `src/index.css` и используются также `src/editor.css`/`src/vetool.css`:

| Token | Значение |
|---|---|
| `--ui-main-color` | `#4aa07f` |
| `--ui-bg-color` | `#050a07` |
| `--ui-panel-header-bg` | `#111a14` |
| `--ui-label-color` | `#888888` |
| `--ui-display-font` | `Space Grotesk`, fallback `Segoe UI`, sans-serif |
| `--ui-mono-font` | `Courier New`, fallback `Courier`, monospace |
| `--ui-selection-bg` / `--ui-selection-text` | `#4ca149` / `#000000` |
| `--ui-selection-item-hover-bg` | `rgba(121,239,164,0.2)` |
| `--ui-input-bg` / `--ui-input-text` | `#000000` / `#79efa4` |
| `--ui-input-border` / focus | `#2a523d` / `#79efa4` |
| `--ui-dropdown-bg` / text / selection | `#050a07` / `#79efa4` / `#204638` |
| `--ui-btn-bg` / text / border | `#000000` / `#52c966` / `#79efa4` |
| `--ui-btn-border-muted` | `#387d60` |
| `--ui-fkey-text` / hotkey | `#79efa4` / `#468a5f` |

Semantic secondary palette: `--sec-color-0 #7dd3fc`, `--sec-color-1 #3b82f6`, `--sec-color-2 #fde047`, `--sec-color-3 #fca5a5`, `--sec-color-4 #60a5fa`, `--sec-color-5 #c4b5fd`, `--sec-color-6 #9ca3af`.

Console overlay имеет отдельные inline colors (`#0f0`, `#fff`, `#000`, `#666`) для terminal/debug readability; они не заменяют global CSS tokens.

## Связи

[[Console-and-Diagnostics]] · [[LLM-Provider-Contracts]] · [[LLM-Prompt-Catalog]] · [[SLM-and-Neural-Runtime]] · [[Audio-and-Sound-Implementation]] · [[Editor-Implementation]] · [[Runtime-and-Rendering]]
