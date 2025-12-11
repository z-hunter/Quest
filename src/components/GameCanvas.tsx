import React, { useEffect, useRef } from 'react';
import { Game } from '../core/Game';

interface GameCanvasProps {
    onGameInit: (game: Game) => void;
}

export const GameCanvas: React.FC<GameCanvasProps> = ({ onGameInit }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const uiCanvasRef = useRef<HTMLCanvasElement>(null);
    const gameRef = useRef<Game | null>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (canvasRef.current && uiCanvasRef.current && !gameRef.current) {
            // Initialize Game with BOTH canvases
            // canvasRef -> WebGL (CRT)
            // uiCanvasRef -> 2D (UI/Input)
            const game = new Game(canvasRef.current, uiCanvasRef.current);
            gameRef.current = game;

            // Start Game Loop
            game.start();

            // Pass game instance up to parent (for UI to bind)
            onGameInit(game);
        }

        return () => {
            if (gameRef.current) {
                gameRef.current.destroy();
                gameRef.current = null;
            }
        };
    }, [onGameInit]);

    useEffect(() => {
        const handleResize = () => {
            if (containerRef.current && canvasRef.current && gameRef.current) {
                const { clientWidth, clientHeight } = containerRef.current;
                const dpr = window.devicePixelRatio || 1;

                // Set RENDERER canvas size to display size * dpr for sharp rendering
                canvasRef.current.width = clientWidth * dpr;
                canvasRef.current.height = clientHeight * dpr;

                // Notify game of resize
                gameRef.current.resize(canvasRef.current.width, canvasRef.current.height);
            }
        };

        // Initial resize
        handleResize();

        // Listen for window resize
        window.addEventListener('resize', handleResize);

        // Also use ResizeObserver for container changes
        const resizeObserver = new ResizeObserver(handleResize);
        if (containerRef.current) {
            resizeObserver.observe(containerRef.current);
        }

        return () => {
            window.removeEventListener('resize', handleResize);
            resizeObserver.disconnect();
        };
    }, []);

    return (
        <div
            ref={containerRef}
            style={{
                width: '100%',
                height: '100%',
                overflow: 'hidden',
                backgroundColor: '#000',
                position: 'relative' // Needed for absolute positioning of children
            }}
        >
            {/* Layer 1: Game (WebGL + CRT) */}
            <canvas
                ref={canvasRef}
                id="game-canvas"
                style={{
                    width: '100%',
                    height: '100%',
                    display: 'block',
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    zIndex: 1
                }}
            />

            {/* Layer 2: UI/Editor (2D, No CRT) */}
            {/* We keep this at 420x300 to match game logic coordinates. CSS scales it up. */}
            <canvas
                ref={uiCanvasRef}
                id="ui-canvas"
                width={420}
                height={300}
                style={{
                    width: '100%',
                    height: '100%',
                    display: 'block',
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    zIndex: 2,
                    backgroundColor: 'transparent', // Ensure it's transparent
                    imageRendering: 'pixelated', // Keep pixel art look for UI if needed
                    pointerEvents: 'auto' // Capture clicks here
                }}
            />
        </div>
    );
};
