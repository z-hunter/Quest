import React from 'react';
import { Game } from '../../core/Game';
import { Entity } from '../../entities/Entity';
import { InventoryEntityCanvas } from './InventoryEntityCanvas';

type PlayerInventoryPanelProps = {
  game: Game;
};

export const PlayerInventoryPanel: React.FC<PlayerInventoryPanelProps> = ({ game }) => {
  const [, forceRefresh] = React.useState(0);

  React.useEffect(() => {
    return game.subscribeInventoryUi(() => forceRefresh((value) => value + 1));
  }, [game]);

  React.useEffect(() => {
    let rafId = 0;
    let lastSignature = '';

    const tick = () => {
      const inventorySignature = game.inventory
        .filter((entity) => !entity.disabled)
        .map((entity) => entity.name)
        .join('|');
      const previewSignature = game.getInventoryPreviewEntity()?.name || '';
      const nextSignature = `${inventorySignature}::${previewSignature}`;
      if (nextSignature !== lastSignature) {
        lastSignature = nextSignature;
        forceRefresh((value) => value + 1);
      }
      rafId = window.requestAnimationFrame(tick);
    };

    tick();
    return () => window.cancelAnimationFrame(rafId);
  }, [game]);

  const inventoryItems = [...game.inventory].filter((entity) => !entity.disabled);
  const previewedItem = game.getInventoryPreviewEntity();

  if (inventoryItems.length === 0) return null;

  return (
    <aside className="player-inventory-panel">
      <div className="player-inventory-grid">
        {inventoryItems.map((item: Entity) => {
          const title = game.textAssets.getResolvedObjectField(item, 'title') || item.name;
          const isActive = previewedItem === item;
          return (
            <button
              key={item.name}
              type="button"
              className={`player-inventory-slot${isActive ? ' is-active' : ''}`}
              onClick={() => {
                const outcome = game.examineEntity(item);
                if (outcome.message) {
                  game.log(outcome.message);
                }
              }}
              title={title}
            >
              <InventoryEntityCanvas entity={item} size={60} />
            </button>
          );
        })}
      </div>
    </aside>
  );
};
