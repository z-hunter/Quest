import React, { useEffect } from 'react';

// ─── Scrubbing Hook ───────────────────────────────────────────────────────────

export const useNumericScrubbing = (panelRef: React.RefObject<any>) => {
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;

    let activeCleanup: (() => void) | null = null;

    const setInputValue = (input: HTMLInputElement, value: string) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setter?.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    };

    const decimalPlaces = (step: number) => {
      if (!Number.isFinite(step)) return 0;
      const text = String(step);
      return text.includes('.') ? text.split('.')[1].length : 0;
    };

    const handleMouseDown = (event: MouseEvent) => {
      if (event.button !== 0) return;
      const label = (event.target as HTMLElement | null)?.closest('label.e-label');
      if (!label || !panel.contains(label)) return;

      const nextSibling = label.nextElementSibling;
      let input: HTMLInputElement | null = null;

      if (nextSibling) {
        if (
          nextSibling.tagName === 'INPUT' &&
          (nextSibling as HTMLInputElement).type === 'number'
        ) {
          input = nextSibling as HTMLInputElement;
        } else {
          input = nextSibling.querySelector<HTMLInputElement>('input[type="number"]');
        }
      }

      if (!input || input.disabled || input.readOnly) return;

      event.preventDefault();
      const startX = event.clientX;
      const startValue = Number(input.value || 0);
      const step = Number(input.step && input.step !== 'any' ? input.step : 1) || 1;
      const precision = decimalPlaces(step);

      let hasFocused = false;

      const handleMove = (moveEvent: MouseEvent) => {
        if (!hasFocused) {
          hasFocused = true;
          input.focus();
        }

        const delta = moveEvent.clientX - startX;
        let currentStep = step;
        let currentPrecision = precision;

        if (moveEvent.ctrlKey) {
          currentStep *= 10;
        } else if (moveEvent.shiftKey) {
          currentStep /= 10;
          currentPrecision = Math.max(currentPrecision, decimalPlaces(currentStep));
        }

        let next = startValue + Math.round(delta / 6) * currentStep;

        const minVal = input.min !== '' ? Number(input.min) : null;
        const maxVal = input.max !== '' ? Number(input.max) : null;
        if (minVal !== null && !isNaN(minVal) && next < minVal) {
          next = minVal;
        }
        if (maxVal !== null && !isNaN(maxVal) && next > maxVal) {
          next = maxVal;
        }

        setInputValue(
          input,
          currentPrecision > 0 ? next.toFixed(currentPrecision) : String(Math.round(next))
        );
      };

      const cleanupScrubbing = () => {
        document.removeEventListener('mousemove', handleMove);
        document.removeEventListener('mouseup', handleUp);
        document.body.classList.remove('is-scrubbing-number');
        if (hasFocused) {
          input.blur();
        }
        if (activeCleanup === cleanupScrubbing) {
          activeCleanup = null;
        }
      };

      const handleUp = () => {
        cleanupScrubbing();
      };

      activeCleanup = cleanupScrubbing;
      document.body.classList.add('is-scrubbing-number');
      document.addEventListener('mousemove', handleMove);
      document.addEventListener('mouseup', handleUp);
    };

    const handleWindowBlur = () => {
      if (activeCleanup) {
        activeCleanup();
      }
    };

    panel.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('blur', handleWindowBlur);

    return () => {
      panel.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('blur', handleWindowBlur);
      if (activeCleanup) {
        activeCleanup();
      }
    };
  }, [panelRef]);
};

// ─── Number formatting ────────────────────────────────────────────────────────

export const formatPanelNumber = (value: unknown): number | string => {
  if (value === '' || value === null || value === undefined) return '';
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);
  return Number(n.toFixed(3));
};

// ─── Multi-selection helpers ──────────────────────────────────────────────────

export const getSharedValue = (arr: unknown[], getter: (o: unknown) => unknown): unknown => {
  if (!arr.length) return '';
  const first = getter(arr[0]);
  for (let i = 1; i < arr.length; i++) {
    if (getter(arr[i]) !== first) return '';
  }
  return first ?? '';
};

export const getSharedBooleanState = (
  arr: unknown[],
  getter: (o: unknown) => boolean
): 'on' | 'off' | 'mixed' => {
  if (!arr.length) return 'off';
  const first = !!getter(arr[0]);
  for (let i = 1; i < arr.length; i++) {
    if (!!getter(arr[i]) !== first) return 'mixed';
  }
  return first ? 'on' : 'off';
};

// ─── Geometry helpers ─────────────────────────────────────────────────────────

export const getPolyCentroid = (
  poly: { x: number; y: number }[] = []
): { x: number; y: number } => {
  if (!poly.length) return { x: 0, y: 0 };
  const sum = poly.reduce((acc, pt) => ({ x: acc.x + pt.x, y: acc.y + pt.y }), { x: 0, y: 0 });
  return { x: sum.x / poly.length, y: sum.y / poly.length };
};

export const getQuadCentroid = (quad: {
  vertices?: { x: number; y: number }[];
  x?: number;
  y?: number;
}): { x: number; y: number } => {
  const verts = quad?.vertices || [];
  if (!verts.length) return { x: quad?.x || 0, y: quad?.y || 0 };
  const sum = verts.reduce((acc, v) => ({ x: acc.x + v.x, y: acc.y + v.y }), { x: 0, y: 0 });
  return { x: sum.x / verts.length, y: sum.y / verts.length };
};

export const scalePolyByFactor = (
  poly: { x: number; y: number }[],
  factor: number,
  originX: number,
  originY: number
): { x: number; y: number }[] =>
  poly.map((pt) => ({
    x: Math.round(originX + (pt.x - originX) * factor),
    y: Math.round(originY + (pt.y - originY) * factor),
  }));

export const scaleQuadVerticesByFactor = (
  vertices: { x: number; y: number; [key: string]: unknown }[],
  factor: number,
  originX: number,
  originY: number
): { x: number; y: number; [key: string]: unknown }[] =>
  vertices.map((v) => ({
    ...v,
    x: Math.round(originX + (v.x - originX) * factor),
    y: Math.round(originY + (v.y - originY) * factor),
  }));

// ─── Shared render helpers ────────────────────────────────────────────────────

type SectionColor = 'blue' | 'red' | 'yellow' | 'purple' | 'neutral';

export const renderSection = (
  section: number,
  title: string | null,
  color: SectionColor,
  children: React.ReactNode,
  setSectionRef: (section: number) => (node: HTMLDivElement | null) => void
): React.ReactElement => (
  <div ref={setSectionRef(section)} className="properties-section-block" data-section={section}>
    {title !== null && (
      <div className={`properties-section-header properties-section-${color}`}>
        <div className="properties-section-title">
          <span className={`properties-section-number properties-section-${color}`}>{section}</span>
          <span className="properties-section-label">{title}</span>
        </div>
      </div>
    )}
    <div className="properties-section-body">{children}</div>
  </div>
);

export const renderOpacityBlurControls = (
  opacityValue: number | '',
  blurValue: number | '',
  onOpacityChange: (nextOpacity: number) => void,
  onBlurChange: (nextBlur: number) => void
): React.ReactElement => {
  const normalizedOpacity = opacityValue === '' ? 1 : Number(opacityValue);
  const normalizedBlur = blurValue === '' ? 0 : Number(blurValue);
  const opacityUi = Math.round((1 - normalizedOpacity) * 100);
  const blurUi = Math.max(0, Math.min(50, Math.round(normalizedBlur)));

  return (
    <div className="e-row" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
      <div>
        <label className="e-label">Opacity ({opacityUi}%)</label>
        <input
          type="range"
          className="e-input"
          style={{ width: '100%' }}
          min="0"
          max="100"
          step="5"
          value={opacityUi}
          onChange={(e) => onOpacityChange(1 - parseInt(e.target.value, 10) / 100)}
        />
      </div>
      <div>
        <label className="e-label">Blur ({blurUi}px)</label>
        <input
          type="range"
          className="e-input"
          style={{ width: '100%' }}
          min="0"
          max="50"
          step="1"
          value={blurUi}
          onChange={(e) => onBlurChange(parseInt(e.target.value, 10))}
        />
      </div>
    </div>
  );
};
