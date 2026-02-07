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
                const input = document.getElementById('parser-input');
                if (input) input.focus();
            }, 10);
        }
    }, [isOpen]);

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
            if (e.key === 'PageUp') {
                e.preventDefault();
                const scrollContainer = document.querySelector('.console-scroll');
                if (scrollContainer) {
                    scrollContainer.scrollBy({ top: -300, behavior: 'auto' });
                }
            }
            if (e.key === 'PageDown') {
                e.preventDefault();
                const scrollContainer = document.querySelector('.console-scroll');
                if (scrollContainer) {
                    scrollContainer.scrollBy({ top: 300, behavior: 'auto' });
                }
            }
        };

        window.addEventListener('keydown', handleKeys);
        return () => window.removeEventListener('keydown', handleKeys);
    }, [isOpen]);

    if (!isOpen) return null;

    return (
        <div className="console-overlay" style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            backgroundColor: 'rgba(0, 0, 0, 0.85)',
            color: '#0f0', // Classic terminal green? Or White? GDD says "High resolution... distinct from game"
            fontFamily: 'monospace',
            zIndex: 4000, // Above UI/Game but below Modals
            display: 'flex',
            flexDirection: 'column',
            padding: '20px',
            boxSizing: 'border-box',
            overflow: 'hidden',
            pointerEvents: 'auto' // Allow scrolling
        }}>
            <div style={{ flex: 1, overflowY: 'auto', paddingBottom: '10px' }} className="console-scroll">
                {lines.map((line, i) => (
                    <div key={i} style={{
                        marginBottom: '4px',
                        color: line.type === 'command' ? '#aaa' :
                            line.type === 'error' ? '#f55' :
                                '#fff'
                    }}>
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
    const [val, setVal] = useState('');

    useEffect(() => {
        const input = document.getElementById('parser-input') as HTMLInputElement;

        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Enter') {
                const command = input.value;
                if (command.trim()) {
                    // Send to Game Console Processing
                    if (game.console) {
                        game.console.processCommand(command);
                    } else {
                        // Fallback purely for parser if console not active? 
                        // Actually, if we are in ConsoleOverlay, we want Console logic.
                        // The original game parser logic might still listen to 'Enter' globally?
                        // Let's ensure we don't double submit.
                        // Game.ts -> onKeyDown usually handles parser.
                        // We might need to coordinate who consumes the input.
                        // For now, let's assume this is the Console input.
                    }
                    input.value = '';
                    setVal('');
                }
            }
        };

        const update = () => {
            if (input && input.value !== val) {
                setVal(input.value);
            }
            requestAnimationFrame(update);
        };

        input.addEventListener('keydown', handleKeyDown);
        const rAF = requestAnimationFrame(update);

        return () => {
            input.removeEventListener('keydown', handleKeyDown);
            cancelAnimationFrame(rAF);
        };
    }, [game, val]);

    return <span>{`> ${val}_`}</span>;
};
