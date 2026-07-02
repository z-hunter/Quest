import React, { useEffect, useRef, useState } from 'react';
import { Game } from '../core/Game';
import { type ConsoleLine } from '../core/Console';

interface ConsoleOverlayProps {
  game: Game;
}

export const ConsoleOverlay: React.FC<ConsoleOverlayProps> = ({ game }) => {
  // We need to force update when console buffer changes.
  // Since Game loop is outside React, we can poll or use a listener.
  // For now, let's use a simple polling effect or bind to game loop via requestAnimationFrame
  const [lines, setLines] = useState<ConsoleLine[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Initial sync
    if (game.console) {
      setIsOpen(game.console.isOpen);
      setLines([...game.console.buffer]);
    }

    // Subscribe to console events
    const unsubscribe = game.console?.subscribe(() => {
      setIsOpen(game.console.isOpen);

      // Check if buffer actually changed to avoid unnecessary renders if just toggling
      // But toggle calls notify, so we get here.
      // We can just setLines every time notify is called, or optimize.
      // React's setState matches referential equality, so [...buffer] is new ref.
      // Let's rely on React to handle it, or do a length check if we want.
      // For now, simple:
      setLines([...game.console.buffer]);
    });

    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, [game]);

  // Focus handling when opening
  useEffect(() => {
    if (isOpen) {
      // Use a slight delay to ensure UI is rendered/enabled
      setTimeout(() => {
        game.focusCommandInput();
      }, 10);
    }
  }, [game, isOpen]);

  // Auto-scroll to bottom
  useEffect(() => {
    if (isOpen && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'auto' });
    }
  }, [lines, isOpen]);

  // Scroll Logic (PageUp/PageDown)
  useEffect(() => {
    if (!isOpen) return;

    const handleKeys = (e: KeyboardEvent) => {
      const scrollContainer = scrollRef.current;
      if (!scrollContainer) return;

      if (e.key === 'PageUp') {
        e.preventDefault();
        scrollContainer.scrollBy({ top: -300, behavior: 'auto' });
      }
      if (e.key === 'PageDown') {
        e.preventDefault();
        scrollContainer.scrollBy({ top: 300, behavior: 'auto' });
      }
    };

    window.addEventListener('keydown', handleKeys);
    return () => window.removeEventListener('keydown', handleKeys);
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div
      className="console-overlay"
      style={{
        position: 'absolute',
        top: 'var(--game-viewport-top, 0px)',
        left: 'var(--game-viewport-left, 0px)',
        width: 'var(--game-viewport-width, 100%)',
        height: 'var(--game-viewport-height, 100%)',
        backgroundColor: 'rgba(0, 0, 0, 0.85)',
        color: '#0f0', // Classic terminal green? Or White? GDD says "High resolution... distinct from game"
        fontFamily: 'monospace',
        zIndex: 4000, // Above UI/Game but below Modals
        display: 'flex',
        flexDirection: 'column',
        padding: '20px',
        boxSizing: 'border-box',
        overflow: 'hidden',
        pointerEvents: 'auto', // Allow scrolling
        userSelect: 'text',
        WebkitUserSelect: 'text',
      }}
    >
      <div
        ref={scrollRef}
        style={{
          flex: 1,
          overflowY: 'auto',
          paddingBottom: '10px',
          userSelect: 'text',
          WebkitUserSelect: 'text',
          cursor: 'text',
        }}
        className="console-scroll"
        onMouseDown={(event) => {
          event.stopPropagation();
        }}
      >
        {lines.map((line, i) => (
          <div
            key={i}
            style={{
              marginBottom: '4px',
              color:
                line.type === 'command'
                  ? '#aaa'
                  : line.type === 'error'
                    ? '#f55'
                    : line.type === 'dialogue'
                      ? '#7dd3fc'
                      : line.type === 'info'
                        ? '#888'
                        : '#fff',
              whiteSpace: 'pre-wrap',
              overflowWrap: 'break-word',
              userSelect: 'text',
              WebkitUserSelect: 'text',
            }}
          >
            {line.text}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      <div style={{ borderTop: '1px solid #666', paddingTop: '10px', color: '#fff' }}>
        <InputMirror game={game} />
      </div>
    </div>
  );
};

const InputMirror: React.FC<{ game: Game }> = ({ game }) => {
  const [inputState, setInputState] = useState({ value: '', caret: 0, cursorVisible: false });

  useEffect(() => {
    const input = game.getCommandInput();
    if (!input) return;

    let frame = 0;
    const update = () => {
      const value = input.value;
      const caret = Math.max(0, Math.min(input.selectionStart ?? value.length, value.length));
      const cursorVisible =
        document.activeElement === input && Math.floor(game.cursorBlink / 500) % 2 === 0;

      setInputState((current) => {
        if (
          current.value === value &&
          current.caret === caret &&
          current.cursorVisible === cursorVisible
        ) {
          return current;
        }
        return { value, caret, cursorVisible };
      });
      frame = requestAnimationFrame(update);
    };

    frame = requestAnimationFrame(update);

    return () => {
      cancelAnimationFrame(frame);
    };
  }, [game]);

  const { value, caret, cursorVisible } = inputState;
  const beforeCaret = value.slice(0, caret);
  const cursorChar = value[caret] || '\u00a0';
  const afterCaret = value.slice(caret + (value[caret] ? 1 : 0));

  if (!cursorVisible) {
    return <span>{`> ${value}`}</span>;
  }

  return (
    <span>
      {'> '}
      {beforeCaret}
      <span style={{ display: 'inline-block', minWidth: '1ch', background: '#fff', color: '#000' }}>
        {cursorChar}
      </span>
      {afterCaret}
    </span>
  );
};
