import React, { useEffect, useRef } from 'react';
import { Game } from '../core/Game';

interface GameCanvasProps {
    onGameInit: (game: Game) => void;
}

export const GameCanvas: React.FC<GameCanvasProps> = ({ onGameInit }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const gameRef = useRef<Game | null>(null);

    useEffect(() => {
        if (canvasRef.current && !gameRef.current) {
            // Initialize Game
            const game = new Game(canvasRef.current);
            gameRef.current = game;

            // Start Game Loop
            game.start();

            // Pass game instance up to parent (for UI to bind)
            onGameInit(game);
        }

        return () => {
            if (gameRef.current) {
                gameRef.current.stop();
                gameRef.current = null;
            }
        };
    }, [onGameInit]);

    return (
        <canvas
            ref={canvasRef}
            id="game-canvas"
            width={420}
            height={300}
            style={{
                width: '100%',
                height: '100%',
                display: 'block',
                imageRendering: 'pixelated'
            }}
        />
    );
};
