import React, { useEffect, useRef, useState } from 'react';
import { Game } from '../core/Game';
import { GAME_DESIGN_HEIGHT, GAME_DESIGN_WIDTH } from '../core/Resolution';
import { getQuestScreenMode } from '../core/displaySettings';
import { useEditorStore } from '../store/editorStore';

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
  const objectVersion = useEditorStore((state) => state.objectVersion);

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

        const mode = getQuestScreenMode(
          gameRef.current.settings.screenProfile.virtualScreen.modeId
        );
        const designWidth = mode.width ?? GAME_DESIGN_WIDTH;
        const designHeight = mode.height ?? GAME_DESIGN_HEIGHT;
        const fitScale = Math.min(clientWidth / designWidth, clientHeight / designHeight);
        const requestedScale = zoomMode === 'fit' ? fitScale : Number.parseFloat(zoomMode);
        const appliedScale = zoomMode === 'fit' ? fitScale : Math.min(fitScale, requestedScale);
        const width = Math.max(1, Math.round(designWidth * appliedScale));
        const height = Math.max(1, Math.round(designHeight * appliedScale));
        setViewportSize({ width, height, scale: appliedScale });
        const offsetX = Math.max(0, Math.round((clientWidth - width) / 2));
        const offsetY = Math.max(0, Math.round((clientHeight - height) / 2));

        const container = shellRef.current.parentElement;
        if (container) {
          container.style.setProperty('--game-viewport-width', `${width}px`);
          container.style.setProperty('--game-viewport-height', `${height}px`);
          container.style.setProperty('--game-viewport-left', `${offsetX}px`);
          container.style.setProperty('--game-viewport-top', `${offsetY}px`);
          container.style.setProperty(
            '--game-console-height',
            `${Math.round(34 * appliedScale)}px`
          );
        }

        const dpr = window.devicePixelRatio || 1;

        const pixelWidth = Math.max(1, Math.round(width * dpr));
        const pixelHeight = Math.max(1, Math.round(height * dpr));

        // Keep every post-SVS canvas in sync before the next game frame.
        gameRef.current.resize(pixelWidth, pixelHeight);
        if (uiCanvasRef.current) {
          uiCanvasRef.current.width = pixelWidth;
          uiCanvasRef.current.height = pixelHeight;
        }
        if (editorOverlayCanvasRef.current) {
          editorOverlayCanvasRef.current.width = pixelWidth;
          editorOverlayCanvasRef.current.height = pixelHeight;
        }
      }
    };

    // Initial resize (best-effort)
    handleResize();

    // Layout often stabilizes 1–2 frames later (flex panels, fonts, DPR, etc).
    // Ensure we resize again after paint to avoid "wrong initial CRT scaling" until user triggers editor layout.
    let raf1 = 0;
    let raf2 = 0;
    raf1 = window.requestAnimationFrame(() => {
      handleResize();
      raf2 = window.requestAnimationFrame(() => {
        handleResize();
      });
    });
    const t = window.setTimeout(() => handleResize(), 75);

    // Listen for window resize
    window.addEventListener('resize', handleResize);

    // Also use ResizeObserver for container changes
    const resizeObserver = new ResizeObserver(handleResize);
    if (shellRef.current) {
      resizeObserver.observe(shellRef.current);
    }
    // In some layouts, the parent flex container changes size while this node doesn't emit reliably.
    // Observing the parent makes the resize robust when editor panels mount/unmount.
    const parent = shellRef.current?.parentElement;
    if (parent) {
      resizeObserver.observe(parent);
    }

    return () => {
      window.removeEventListener('resize', handleResize);
      resizeObserver.disconnect();
      window.cancelAnimationFrame(raf1);
      window.cancelAnimationFrame(raf2);
      window.clearTimeout(t);
    };
  }, [objectVersion, zoomMode]);

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
          active.id !== 'parser-input' &&
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
