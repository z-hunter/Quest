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
      onMouseEnter={() => {
        // Blur active inputs when entering game view
        const active = document.activeElement as HTMLElement;
        if (
          active &&
          (active.tagName === 'INPUT' ||
            active.tagName === 'TEXTAREA' ||
            active.tagName === 'SELECT')
        ) {
          active.blur();
        }
        // Ensure UI flag is cleared
        if (gameRef.current) gameRef.current.isMouseOverUI = false;
      }}
      style={{
        // Center the 840x600 canvas in the 840x640 container
        width: '840px',
        height: '600px',
        position: 'relative',
        backgroundColor: '#000', // Restore bg color as well
        overflow: 'hidden', // Restore clipping
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
          zIndex: 1,
        }}
      />

      {/* Layer 2: UI/Editor (2D, No CRT) */}
      <canvas
        ref={uiCanvasRef}
        id="ui-canvas"
        width={420} // Internal Resolution
        height={300}
        style={{
          width: '100%',
          height: '100%',
          display: 'block',
          position: 'absolute',
          top: 0,
          left: 0,
          zIndex: 2,
          backgroundColor: 'transparent',
          imageRendering: 'pixelated',
          pointerEvents: 'auto',
        }}
      />
    </div>
  );
};
