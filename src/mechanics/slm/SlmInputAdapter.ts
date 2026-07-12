import type { NpcActorContext } from '../npcTypes';
import { SLM_TOKENS, type DynamicEntityMapping } from './SlmVocabulary';

export interface SlmEncodedInput {
  tokens: Int32Array;
  mapping: DynamicEntityMapping;
}

export class SlmInputAdapter {
  /**
   * Tokenizes an NPC's world context into a numerical sequence and creates
   * a dynamic entity mapping (pointer-generator style) for decoding actions later.
   */
  static encode(context: NpcActorContext): SlmEncodedInput {
    const indexToId = new Map<number, string>();
    const idToIndex = new Map<string, number>();
    let currentIndex = SLM_TOKENS.DYNAMIC_ENTITY_BASE;

    const registerEntity = (id: string): number => {
      let idx = idToIndex.get(id);
      if (idx === undefined) {
        idx = currentIndex++;
        idToIndex.set(id, idx);
        indexToId.set(idx, id);
      }
      return idx;
    };

    // 1. Register all entities in context
    const allEntities = new Set<string>();
    if (context.entities) {
      for (const e of context.entities) allEntities.add(e.id);
    }
    if (context.inventory?.itemIds) {
      for (const id of context.inventory.itemIds) allEntities.add(id);
    }
    if (context.visibleItemIds) {
      for (const id of context.visibleItemIds) allEntities.add(id);
    }
    if (context.actors) {
      for (const a of context.actors) allEntities.add(a.id);
    }

    for (const id of allEntities) {
      registerEntity(id);
    }

    const tokens: number[] = [SLM_TOKENS.START];

    // 2. Encode Objectives (identify target entities mentioned in objectives)
    if (context.objectives && context.objectives.length > 0) {
      const objText = context.objectives.join(' ').toLowerCase();
      for (const e of context.entities || []) {
        const words = [
          ...e.id.toLowerCase().split(/[\s_0-9]+/),
          ...(e.title ? e.title.toLowerCase().split(/[\s_]+/) : []),
        ].filter((w) => w.length >= 3);

        if (words.some((word) => objText.includes(word))) {
          const idx = idToIndex.get(e.id);
          if (idx !== undefined) {
            tokens.push(SLM_TOKENS.FLAG_TARGET_OBJECTIVE, idx);
          }
        }
      }
    }

    // 3. Encode Held Inventory
    if (context.inventory?.itemIds) {
      for (const id of context.inventory.itemIds) {
        const idx = idToIndex.get(id);
        if (idx !== undefined) {
          tokens.push(SLM_TOKENS.FLAG_HELD, idx);
        }
      }
    }

    // 4. Encode Visible Entities & Interaction Flags
    if (context.entities) {
      for (const e of context.entities) {
        const idx = idToIndex.get(e.id);
        if (idx === undefined) continue;

        tokens.push(idx);

        if (e.interaction === 'reachable' || e.interaction === 'held') {
          tokens.push(SLM_TOKENS.FLAG_REACHABLE);
        }
        if (e.approach === 'route_available' || e.approach === 'already_reachable') {
          tokens.push(SLM_TOKENS.FLAG_ROUTE_AVAILABLE);
        } else if (e.approach === 'unreachable') {
          tokens.push(SLM_TOKENS.FLAG_UNREACHABLE);
        }

        if (e.switch) {
          if (e.switch.canOpen) tokens.push(SLM_TOKENS.FLAG_CAN_OPEN);
          if (e.switch.canClose) tokens.push(SLM_TOKENS.FLAG_CAN_CLOSE);
          if (e.switch.locked) tokens.push(SLM_TOKENS.FLAG_LOCKED);
          if (e.switch.keyHeld) tokens.push(SLM_TOKENS.FLAG_KEY_HELD);
        }
      }
    }

    // 5. Encode Other Actors
    if (context.actors) {
      for (const a of context.actors) {
        const idx = idToIndex.get(a.id);
        if (idx !== undefined) {
          tokens.push(idx, SLM_TOKENS.FLAG_ACTOR);
        }
      }
    }

    tokens.push(SLM_TOKENS.END);

    return {
      tokens: new Int32Array(tokens),
      mapping: { indexToId, idToIndex },
    };
  }
}
