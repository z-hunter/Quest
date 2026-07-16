---
type: implementation
system: inventory-ui
---

# Inventory UI — implementation

`src/components/inventory/PlayerInventoryPanel.tsx` subscribes to `game.subscribeInventoryUi`, tracks known item names, detects arrivals and schedules a short arrival animation token. It reads `game.inventory`, resolved TextAsset title/description and preview state; clicking calls `openInventoryPreview` and logs description.

`InventoryEntityCanvas.tsx` renders an entity preview into a small canvas without mutating InventoryManager. `UIOverlay` mounts inventory preview/panel and forces refresh via the same subscription.

```text
InventoryManager mutation
  → Game.notifyInventoryUiChange
  → UI subscription
  → React refresh + arrival detection
  → InventoryEntityCanvas / preview
```

UI inventory is a projection. Canonical ownership remains InventoryManager and Game API.

Связанные: [[InventoryManager-Implementation]], [[React-UI-Data-Flow]], [[Asset-and-Text-Pipeline]].
