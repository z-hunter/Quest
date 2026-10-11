---
type: technical-index
scope: scanline-engine
system:
---

# Scanline Engine — техническая карта

Только устройство и реализация движка. Текущий код и JSON-активы остаются источником истины; заметки служат картой для брейншторма.

- [[Architecture]]
- [[SaveState-and-Saved-Games]]
- [[Runtime-and-Rendering]]
- [[Scenes-and-Spatial-Model]]
- [[Scene-Core]]
- [[Scene-Objects]]
- [[Scene-Hierarchy]]
- [[Scene-Manager]]
- [[Scene-Components-and-Storage]]
- [[Scene-Text-Layer]]
- [[Scene-Interaction-and-Camera]]
- [[Scene-Schema]]
- [[Entity-Schema]]
- [[Component-Schema]]
- [[Spatial-API-Index]]
- [[SceneManager-Implementation]]
- [[InventoryManager-Implementation]]
- [[SceneSpatialValidator-Implementation]]
- [[Component-and-State-Events]]
- [[Actor-Access-and-Navigation]]
- [[Scene-Interaction-Implementation]]
- [[Scene-Log-Implementation]]
- [[Parser-Implementation]]
- [[Parser-Cascade-Architecture]]
- [[Parser-Data-Contracts]]
- [[Parser-Subsystems-and-Dataflow]]
- [[NLPJS-Training-and-Model-Cache]]
- [[Parser-World-Model]]
- [[Parser-Cascade-Contracts]]
- [[AI-Cascade-Implementation]]
- [[Core-Game-Implementation]]
- [[Asset-and-Text-Pipeline]]
- [[Text-Assets-Implementation]]
- [[Script-Runtime]]
- [[Editor-Implementation]]
- [[Editor-Persistence]]
- [[Audio-and-Sound-Implementation]]
- [[Parallax-Shadow-Backface]]
- [[SceneRenderer-Implementation]]
- [[React-UI-Data-Flow]]
- [[Inventory-UI-Implementation]]
- [[Editor-Properties-Implementation]]
- [[Audio-Visual-UI-Index]]
- [[Parser-and-AI]]
- [[Game-Master-Implementation]]
- [[NPC-World-Model]]
- [[NPC-Plan-and-Command-Execution]]
- [[LLM-Provider-Contracts]]
- [[LLM-Prompt-Catalog]]
- [[SLM-and-Neural-Runtime]]
- [[SLM-Dataset-Collection]]
- [[AI-Data-Flow]]
- [[AI-Validation-and-Guardrails]]
- [[UI-and-Editor]]
- [[Data-Formats-and-Assets]]
- [[Scripting-and-Game-API]]
- [[Dependencies-and-Platform]]
- [[Validation]]
- [[Console-and-Diagnostics]]
- [[Configuration-and-UI-Tokens]]
- [[Architecture-Audit-and-Roadmap]]

## Главный поток

```text
React/Tauri bootstrap → Game → SceneManager / systems / parser
                                      ↓
                         semantic Game API → state + UI outcome
                                      ↓
                            SceneRenderer → canvas
```
