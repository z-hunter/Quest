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
  const [isSaving, setIsSaving] = useState(false);
  const suppressCommandFocusUntilRef = React.useRef(0);

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
    if (!game) return;
    const input = parserInputRef.current;
    if (!input) return;

    const shouldLockCommandFocus = () => {
      return (
        !input.disabled &&
        !fileBrowser &&
        !choiceDialog &&
        !isConsoleModal &&
        (!editorEnabled || isConsoleOpen)
      );
    };

    const isConsoleLogSelectionTarget = (target: EventTarget | null) => {
      return target instanceof Element && !!target.closest('.console-scroll');
    };

    const restoreCommandFocus = () => {
      if (Date.now() < suppressCommandFocusUntilRef.current) return;
      if (!shouldLockCommandFocus()) return;
      const caret = input.selectionStart ?? input.value.length;
      input.focus({ preventScroll: true });
      input.setSelectionRange(caret, caret);
    };

    const scheduleRestoreCommandFocus = (event?: Event) => {
      if (isConsoleLogSelectionTarget(event?.target || null)) {
        suppressCommandFocusUntilRef.current = Date.now() + 1000;
        return;
      }
      window.setTimeout(restoreCommandFocus, 0);
    };

    window.addEventListener('pointerdown', scheduleRestoreCommandFocus, true);
    window.addEventListener('focusin', scheduleRestoreCommandFocus, true);
    input.addEventListener('blur', scheduleRestoreCommandFocus);

    restoreCommandFocus();

    return () => {
      window.removeEventListener('pointerdown', scheduleRestoreCommandFocus, true);
      window.removeEventListener('focusin', scheduleRestoreCommandFocus, true);
      input.removeEventListener('blur', scheduleRestoreCommandFocus);
    };
  }, [game, editorEnabled, isConsoleOpen, isConsoleModal, fileBrowser, choiceDialog]);

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

  const continueConsoleModalFirst = React.useCallback(() => {
    return game?.console.continueClosedModal() || false;
  }, [game]);

  const moveCommandInputCaret = React.useCallback(
    (input: HTMLInputElement, delta: -1 | 1) => {
      const caret = input.selectionStart ?? input.value.length;
      const nextCaret = Math.max(0, Math.min(input.value.length, caret + delta));
      input.setSelectionRange(nextCaret, nextCaret);
      game?.revealCommandCursor();
      setHistoryIndex(-1);
    },
    [game]
  );

  const keepCommandInputFocused = React.useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      game?.focusCommandInput();
    },
    [game]
  );

  const handleSave = () => {
    if (!game || isSaving) return;
    setIsSaving(true);
    void game.saveManager.save().finally(() => {
      setTimeout(() => setIsSaving(false), 600);
    });
  };

  return (
    <>
      {game && !editorEnabled && (
        <button
          className={`save-btn${isSaving ? ' save-btn--saving' : ''}`}
          title="Save game"
          onMouseDown={(e) => e.preventDefault()}
          onClick={handleSave}
        >
          <svg viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
            <path d="M2 1a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V4.5L10.5 1H2zm8.5 0v3.5H13L10.5 1zM4 1.5h5v3H4V1.5zM3 9h10v5H3V9zm2 1v3h2v-3H5zm4 0v3h2v-3H9z" />
          </svg>
        </button>
      )}
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

                  if (
                    firstWord.startsWith('#') ||
                    game.console.hasCommand(firstWord.toUpperCase())
                  ) {
                    game.console.processCommand(val);
                  } else {
                    void game.submitGameplayInput(val);
                  }

                  e.currentTarget.value = '';
                  setHistoryIndex(-1); // Reset history index on submit
                }
              }

              if (!(e.ctrlKey || e.metaKey) && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
                e.preventDefault();
                return;
              }

              if (e.key === 'Home' || e.key === 'End') {
                game?.revealCommandCursor();
              }

              // History Navigation: Ctrl + Up/Down
              if (game && (e.ctrlKey || e.metaKey)) {
                if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                  e.preventDefault();
                  moveCommandInputCaret(e.currentTarget, e.key === 'ArrowLeft' ? -1 : 1);
                  return;
                }

                if (e.key === 'ArrowUp') {
                  const history = game.console.history;
                  if (history.length === 0) return;
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
                  e.currentTarget.setSelectionRange(
                    history[newIndex].length,
                    history[newIndex].length
                  );
                  game.revealCommandCursor();
                }

                if (e.key === 'ArrowDown') {
                  const history = game.console.history;
                  if (history.length === 0) return;
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
                      e.currentTarget.setSelectionRange(0, 0);
                    } else {
                      newIndex = Math.min(history.length - 1, newIndex + 1);
                      e.currentTarget.value = history[newIndex];
                      e.currentTarget.setSelectionRange(
                        history[newIndex].length,
                        history[newIndex].length
                      );
                    }
                    game.revealCommandCursor();
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
          onMouseDown={keepCommandInputFocused}
          onClick={() => {
            if (continueConsoleModalFirst()) return;
            game.closeInventoryPreview();
          }}
        >
          <div
            className="inventory-preview-card"
            onMouseDown={keepCommandInputFocused}
            onClick={(e) => {
              e.stopPropagation();
              continueConsoleModalFirst();
            }}
          >
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
