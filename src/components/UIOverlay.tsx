import React, { useState, useEffect } from 'react';
import { Game } from '../core/Game';
import { FileBrowser } from './FileBrowser';
import { useEditorStore } from '../store/editorStore';
import { ConsoleOverlay } from './ConsoleOverlay';
import { InventoryEntityCanvas } from './inventory/InventoryEntityCanvas';

interface UIOverlayProps {
  game: Game | null;
}

export const UIOverlay: React.FC<UIOverlayProps> = ({ game }) => {
  const [message, setMessage] = useState<{ id: number; text: string } | null>(null);
  const [fileBrowser, setFileBrowser] = useState<{
    open: boolean;
    mode: 'save' | 'load';
    dir: string;
    onConfirm: (f: string) => void;
    extension?: string;
    title?: string;
    onCancel?: () => void;
  } | null>(null);
  const [choiceDialog, setChoiceDialog] = useState<{
    title: string;
    message: string;
    options: Array<{ id: string; label: string; variant?: 'primary' | 'danger' | 'neutral' }>;
    onResolve: (choiceId: string | null) => void;
  } | null>(null);

  // Console History State
  const [historyIndex, setHistoryIndex] = useState<number>(-1);
  const [, forceInventoryRefresh] = useState(0);

  // Editor Store State
  const { enabled: editorEnabled } = useEditorStore();

  // Console State for Input Unlocking
  const [isConsoleOpen, setIsConsoleOpen] = useState(false);
  const [isConsoleModal, setIsConsoleModal] = useState(false);
  const parserInputRef = React.useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (game) {
      // Bind Game callbacks to React state
      game.onMessage = (text) => setMessage({ id: Date.now(), text });

      // Bind File Browser Request
      game.onRequestFileBrowser = (mode, dir, onConfirm, extension, title, onCancel) => {
        setFileBrowser({ open: true, mode, dir, onConfirm, extension, title, onCancel });
      };
      game.onRequestChoiceDialog = (title, dialogMessage, options, onResolve) => {
        setChoiceDialog({ title, message: dialogMessage, options, onResolve });
      };

      // Initialize UI bindings
      setTimeout(() => {
        game.bindUI();
      }, 0);
    }
  }, [game]);

  useEffect(() => {
    if (!game) return;
    game.setCommandInput(parserInputRef.current);
    return () => game.setCommandInput(null);
  }, [game]);

  // Separate effect for console subscription to handle cleanup properly
  useEffect(() => {
    if (game && game.console) {
      const unsubscribe = game.console.subscribe(() => {
        setIsConsoleOpen(game.console.isOpen);
        setIsConsoleModal(game.console.isClosedModal);
      });
      return unsubscribe;
    }
  }, [game]);

  useEffect(() => {
    if (!game) return;
    return game.subscribeInventoryUi(() => forceInventoryRefresh((value) => value + 1));
  }, [game]);

  const previewEntity = game?.getInventoryPreviewEntity() || null;

  useEffect(() => {
    if (!game) return;
    if (editorEnabled || isConsoleOpen || isConsoleModal) return;

    const timer = window.setTimeout(() => {
      const input = parserInputRef.current;
      if (!input || input.disabled) return;
      input.focus();
      const len = input.value.length;
      input.setSelectionRange(len, len);
    }, 0);

    return () => window.clearTimeout(timer);
  }, [game, editorEnabled, isConsoleOpen, isConsoleModal, previewEntity?.name]);

  useEffect(() => {
    if (message) {
      const timer = setTimeout(() => {
        setMessage(null);
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [message]);

  const handleBrowserConfirm = (filename: string) => {
    if (fileBrowser) {
      fileBrowser.onConfirm(filename);
      setFileBrowser(null);
    }
  };

  const handleBrowserCancel = () => {
    if (fileBrowser?.onCancel) {
      fileBrowser.onCancel();
    }
    setFileBrowser(null);
  };

  const handleChoiceResolve = React.useCallback((choiceId: string | null) => {
    setChoiceDialog((currentDialog) => {
      if (currentDialog) {
        currentDialog.onResolve(choiceId);
      }
      return null;
    });
  }, []);

  useEffect(() => {
    if (!choiceDialog) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        handleChoiceResolve(null);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [choiceDialog, handleChoiceResolve]);

  return (
    <>
      <div id="ui-layer" style={{ pointerEvents: 'none' }}>
        <div id="command-line" style={{ border: 'none', background: 'transparent' }}>
          <input
            type="text"
            id="parser-input"
            ref={parserInputRef}
            autoComplete="off"
            autoFocus={!isConsoleModal && (!editorEnabled || isConsoleOpen)}
            disabled={isConsoleModal || (editorEnabled && !isConsoleOpen)}
            onKeyDown={(e) => {
              if (e.code === 'Backquote' && game?.console.isClosedModal) {
                e.preventDefault();
                game.console.toggle();
                return;
              }

              if (game?.console.continueClosedModal()) {
                e.preventDefault();
                return;
              }

              // Layer 2: React Event Fallback (fires if Global Capture misses or bubbles up)

              // F1: Toggle Scene Editor
              if (e.key === 'F1') {
                e.preventDefault();
                game?.editor.toggle();
                return;
              }

              // F5: Toggle Sprite Editor
              if (e.key === 'F5') {
                e.preventDefault();
                game?.spriteEditor.toggle();
                return;
              }

              // Enter: Parse Command
              if (e.key === 'Enter') {
                e.preventDefault();
                e.stopPropagation();
                e.nativeEvent.stopImmediatePropagation();
                const val = e.currentTarget.value.trim(); // Keep case for now, parser handles upper?
                // GDD: "Input command... displayed in buffer... then sent to parser"

                if (val && game) {
                  const firstWord = val.split(/\s+/)[0] || '';

                  if (firstWord.startsWith('#')) {
                    game.console.processCommand(val);
                  } else {
                    const preprocessed = game.console.preprocessGameplayInput(val);

                    // 1. Log Command to Buffer
                    game.console.log(preprocessed, 'command');

                    // 2. Add to History
                    game.console.addHistory(preprocessed);

                    // 3. Send to gameplay parser
                    void game.parser.parse(preprocessed);
                  }

                  e.currentTarget.value = '';
                  setHistoryIndex(-1); // Reset history index on submit
                }
              }

              // History Navigation: Ctrl + Up/Down
              if (game && (e.ctrlKey || e.metaKey)) {
                const history = game.console.history;
                if (history.length === 0) return;

                if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  // Go back/older
                  // If we are at -1 (new/empty), go to last item (length-1)
                  // If we are at 0 (oldest), stay there? or cycle?
                  // Let's standard terminal behavior: Up = Older

                  let newIndex = historyIndex;
                  if (newIndex === -1) {
                    newIndex = history.length - 1;
                  } else {
                    newIndex = Math.max(0, newIndex - 1);
                  }
                  setHistoryIndex(newIndex);
                  e.currentTarget.value = history[newIndex];
                }

                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  // Go forward/newer
                  // If we are at length-1 (newest), go to -1 (empty)

                  let newIndex = historyIndex;
                  if (newIndex === -1) {
                    // Already at new line, do nothing
                  } else {
                    if (newIndex === history.length - 1) {
                      newIndex = -1;
                      e.currentTarget.value = '';
                    } else {
                      newIndex = Math.min(history.length - 1, newIndex + 1);
                      e.currentTarget.value = history[newIndex];
                    }
                  }
                  setHistoryIndex(newIndex);
                }
              }

              // Ctrl + Backspace: Clear Input
              if ((e.ctrlKey || e.metaKey) && e.key === 'Backspace') {
                e.preventDefault();
                e.currentTarget.value = '';
                setHistoryIndex(-1);
              }
            }}
            style={{
              opacity: 0,
              position: 'absolute',
              bottom: 0,
              left: 0,
              width: '1px',
              height: '1px',
              pointerEvents: 'none',
              zIndex: 9999,
            }}
          />
        </div>
      </div>

      {/* Notification Toast - Keeping for non-game/system messages if any */}
      {message && (
        <div key={message.id} className="notification-toast">
          {message.text}
        </div>
      )}

      {choiceDialog && (
        <div className="editor-choice-dialog-backdrop" style={{ pointerEvents: 'auto' }}>
          <div className="editor-choice-dialog">
            <div className="editor-choice-dialog-title">{choiceDialog.title}</div>
            <div className="editor-choice-dialog-message">{choiceDialog.message}</div>
            <div className="editor-choice-dialog-actions">
              {choiceDialog.options.map((option) => (
                <button
                  key={option.id}
                  className={`e-btn editor-choice-btn editor-choice-btn-${option.variant || 'neutral'}`}
                  onClick={() => handleChoiceResolve(option.id)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Virtual Console Overlay (High Res, Open State) */}
      {game && <ConsoleOverlay game={game} />}

      {game && !editorEnabled && previewEntity && (
        <div
          className="inventory-preview-overlay"
          style={{ pointerEvents: 'auto' }}
          onClick={() => game.closeInventoryPreview()}
        >
          <div className="inventory-preview-card" onClick={(e) => e.stopPropagation()}>
            <InventoryEntityCanvas entity={previewEntity} size={320} />
          </div>
        </div>
      )}

      {/* File Browser Modal */}
      {fileBrowser && fileBrowser.open && (
        <div
          style={{
            pointerEvents: 'auto',
            zIndex: 5000,
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
          }}
        >
          <FileBrowser
            mode={fileBrowser.mode}
            directory={fileBrowser.dir}
            onConfirm={handleBrowserConfirm}
            onCancel={handleBrowserCancel}
            extension={fileBrowser.extension}
            title={fileBrowser.title}
          />
        </div>
      )}

      {/* NEW REACT EDITOR UI */}
      {/* Sprite Editor is now part of App layout */}

      {editorEnabled && <div className="editor-overlay">{/* Panels are now in App.tsx */}</div>}
    </>
  );
};
