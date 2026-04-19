import React from 'react';
import { Entity } from '../../entities/Entity';

type InventoryEntityCanvasProps = {
  entity: Entity;
  size: number;
  className?: string;
};

function drawEntityToCanvas(canvas: HTMLCanvasElement, entity: Entity, size: number): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const dpr = window.devicePixelRatio || 1;
  const pixelSize = Math.max(1, Math.round(size * dpr));
  if (canvas.width !== pixelSize || canvas.height !== pixelSize) {
    canvas.width = pixelSize;
    canvas.height = pixelSize;
  }

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, size, size);
  ctx.imageSmoothingEnabled = true;

  const padding = Math.max(2, size * 0.08);
  const availableWidth = Math.max(1, size - padding * 2);
  const availableHeight = Math.max(1, size - padding * 2);
  const sourceWidth = Math.max(1, entity.width || entity.baseWidth || 1);
  const sourceHeight = Math.max(1, entity.height || entity.baseHeight || 1);
  const scale = Math.min(availableWidth / sourceWidth, availableHeight / sourceHeight);
  const drawWidth = Math.max(1, sourceWidth * scale);
  const drawHeight = Math.max(1, sourceHeight * scale);
  const drawX = (size - drawWidth) / 2;
  const drawY = (size - drawHeight) / 2;

  const frame =
    entity.animator && typeof entity.animator.getCurrentFrame === 'function'
      ? entity.animator.getCurrentFrame()
      : null;

  if (entity.opacity < 1) ctx.globalAlpha = entity.opacity;

  if (frame && entity.image && entity.image.complete && entity.image.naturalWidth !== 0) {
    ctx.drawImage(
      entity.image,
      frame.x,
      frame.y,
      frame.w,
      frame.h,
      drawX,
      drawY,
      drawWidth,
      drawHeight
    );
    return;
  }

  if (entity.image && entity.image.complete && entity.image.naturalWidth !== 0) {
    ctx.drawImage(entity.image, drawX, drawY, drawWidth, drawHeight);
    return;
  }

  ctx.fillStyle = entity.color || '#AAAAAA';
  ctx.fillRect(drawX, drawY, drawWidth, drawHeight);
}

export const InventoryEntityCanvas: React.FC<InventoryEntityCanvasProps> = ({
  entity,
  size,
  className,
}) => {
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);

  React.useEffect(() => {
    let rafId = 0;

    const render = () => {
      if (canvasRef.current) {
        drawEntityToCanvas(canvasRef.current, entity, size);
      }
      rafId = window.requestAnimationFrame(render);
    };

    render();
    return () => window.cancelAnimationFrame(rafId);
  }, [entity, size]);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{
        width: `${size}px`,
        height: `${size}px`,
        display: 'block',
        background: 'transparent',
      }}
    />
  );
};
