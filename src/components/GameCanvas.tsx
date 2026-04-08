import React, { useEffect, useRef, useState } from 'react';
import { Game } from '../core/Game';
import { GAME_DESIGN_HEIGHT, GAME_DESIGN_WIDTH } from '../core/Resolution';

interface GameCanvasProps {
  onGameInit: (game: Game) => void;
}

type ZoomMode = 'fit' | '1' | '1.5' | '2';

export const GameCanvas: React.FC<GameCanvasProps> = ({ onGameInit }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const uiCanvasRef = useRef<HTMLCanvasElement>(null);
  const editorOverlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const gameRef = useRef<Game | null>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const [zoomMode, setZoomMode] = useState<ZoomMode>('fit');
  const [viewportSize, setViewportSize] = useState({
    width: GAME_DESIGN_WIDTH,
    height: GAME_DESIGN_HEIGHT,
    scale: 1,
  });

  useEffect(() => {
    if (
      canvasRef.current &&
      uiCanvasRef.current &&
      editorOverlayCanvasRef.current &&
      !gameRef.current
    ) {
      // Initialize Game with BOTH canvases
      // canvasRef -> WebGL (CRT)
      // uiCanvasRef -> 2D (UI/Input)
      const game = new Game(canvasRef.current, uiCanvasRef.current, editorOverlayCanvasRef.current);
      gameRef.current = game;

      // Start Game Loop
      game.start();

      // Pass game instance up to parent (for UI to bind)
      onGameInit(game);

      const savedZoom = game.settings.editor?.viewportZoom;
      if (savedZoom === 'fit' || savedZoom === '1' || savedZoom === '1.5' || savedZoom === '2') {
        setZoomMode(savedZoom);
      }
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
      if (shellRef.current && viewportRef.current && canvasRef.current && gameRef.current) {
        const { clientWidth, clientHeight } = shellRef.current;
        if (clientWidth <= 0 || clientHeight <= 0) return;

        const fitScale = Math.min(
          clientWidth / GAME_DESIGN_WIDTH,
          clientHeight / GAME_DESIGN_HEIGHT
        );
        const requestedScale = zoomMode === 'fit' ? fitScale : Number.parseFloat(zoomMode);
        const appliedScale = zoomMode === 'fit' ? fitScale : Math.min(fitScale, requestedScale);
        const width = Math.max(1, Math.round(GAME_DESIGN_WIDTH * appliedScale));
        const height = Math.max(1, Math.round(GAME_DESIGN_HEIGHT * appliedScale));
        setViewportSize({ width, height, scale: appliedScale });
        const offsetX = Math.max(0, Math.round((clientWidth - width) / 2));
        const offsetY = Math.max(0, Math.round((clientHeight - height) / 2));

        const container = shellRef.current.parentElement;
        if (container) {
          container.style.setProperty('--game-viewport-width', `${width}px`);
          container.style.setProperty('--game-viewport-height', `${height}px`);
          container.style.setProperty('--game-viewport-left', `${offsetX}px`);
          container.style.setProperty('--game-viewport-top', `${offsetY}px`);
        }

        const viewportWidth = viewportRef.current.clientWidth || width;
        const viewportHeight = viewportRef.current.clientHeight || height;
        const dpr = window.devicePixelRatio || 1;

        // Set RENDERER canvas size to display size * dpr for sharp rendering
        canvasRef.current.width = Math.max(1, Math.round(viewportWidth * dpr));
        canvasRef.current.height = Math.max(1, Math.round(viewportHeight * dpr));

        if (editorOverlayCanvasRef.current) {
          editorOverlayCanvasRef.current.width = Math.max(1, Math.round(viewportWidth * dpr));
          editorOverlayCanvasRef.current.height = Math.max(1, Math.round(viewportHeight * dpr));
        }

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
    if (shellRef.current) {
      resizeObserver.observe(shellRef.current);
    }

    return () => {
      window.removeEventListener('resize', handleResize);
      resizeObserver.disconnect();
    };
  }, [zoomMode]);

  useEffect(() => {
    if (gameRef.current?.settings.editor) {
      gameRef.current.settings.editor.viewportZoom = zoomMode;
    }
  }, [zoomMode]);

  return (
    <div
      ref={shellRef}
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
        width: '100%',
        height: '100%',
        position: 'relative',
        backgroundColor: '#000',
        overflow: 'hidden',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div
        ref={viewportRef}
        style={{
          width: `${viewportSize.width}px`,
          height: `${viewportSize.height}px`,
          position: 'relative',
          backgroundColor: '#000',
          overflow: 'hidden',
          boxShadow: '0 0 20px rgba(0, 0, 0, 0.5)',
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
          width={GAME_DESIGN_WIDTH}
          height={GAME_DESIGN_HEIGHT}
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

        <canvas
          ref={editorOverlayCanvasRef}
          id="editor-overlay-canvas"
          style={{
            width: '100%',
            height: '100%',
            display: 'block',
            position: 'absolute',
            top: 0,
            left: 0,
            zIndex: 3,
            backgroundColor: 'transparent',
            pointerEvents: 'none',
          }}
        />
      </div>
    </div>
  );
};
