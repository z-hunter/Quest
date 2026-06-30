import React, { useState, useEffect, useRef, useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import { saveProjectFile, readProjectFileExisting } from './platform/fileApi';
import { calculateSpritesheetLayout } from './utils/vetoolLayout';
import { FileBrowser } from './components/FileBrowser';
import './index.css';
import './editor.css';
import './vetool.css';

interface Box {
  id: string; // Internal unique ID
  spriteId: string; // Target sprite ID (e.g., hero_run)
  targetPng: string; // Target PNG file (e.g., public/sprites/hero.png)
  colIndex: number; // Target spritesheet column index
  x: number;
  y: number;
  w: number;
  h: number;
}

export function VetoolApp() {
  // Video and Playback State
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [videoFilename, setVideoFilename] = useState<string>('');
  const [videoDuration, setVideoDuration] = useState<number>(0);
  const [videoWidth, setVideoWidth] = useState<number>(0);
  const [videoHeight, setVideoHeight] = useState<number>(0);
  const [fps, setFps] = useState<number>(30);
  const [currentFrame, setCurrentFrame] = useState<number>(0);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [stepSize, setStepSize] = useState<number>(1);
  const [loopStart, setLoopStart] = useState<number>(0); // in seconds
  const [loopEnd, setLoopEnd] = useState<number>(0); // in seconds
  const [videoLoadError, setVideoLoadError] = useState<boolean>(false);

  // Bounding Boxes State
  const [boxes, setBoxes] = useState<Box[]>([]);
  const [activeBoxId, setActiveBoxId] = useState<string | null>(null);

  // Export State
  const [exportProgress, setExportProgress] = useState<number | null>(null);
  const [exportStatusText, setExportStatusText] = useState<string>('');
  const [uiScale, setUiScale] = useState<number>(1.0);
  const [toastMessage, setToastMessage] = useState<{ id: number; text: string } | null>(null);

  const showToast = React.useCallback((text: string) => {
    setToastMessage({ id: Date.now(), text });
  }, []);

  useEffect(() => {
    if (toastMessage) {
      const timer = setTimeout(() => {
        setToastMessage(null);
      }, 2500);
      return () => clearTimeout(timer);
    }
  }, [toastMessage]);

  // File Browser / Configuration State
  const [browserMode, setBrowserMode] = useState<'save' | 'load' | null>(null);
  const browserFilename = 'vetool_config.json';

  // Refs
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const frameCache = useRef<(HTMLCanvasElement | null)[]>([]);
  const canCache = useRef<boolean>(true);
  const lastFrameTime = useRef<number>(0);
  const currentFrameRef = useRef<number>(0);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const pendingConfigRef = useRef<any>(null);
  const loadedLoopBoundsRef = useRef<{ start: number; end: number } | null>(null);

  // Dragging & Resizing Refs/State
  const dragInfo = useRef<{
    action: 'none' | 'drawing' | 'dragging' | 'resizing';
    handle?: 'tl' | 'tr' | 'bl' | 'br';
    boxId?: string;
    startX: number;
    startY: number;
    originalBox?: { x: number; y: number; w: number; h: number };
  }>({ action: 'none', startX: 0, startY: 0 });

  const totalFrames = useMemo(() => {
    if (!videoDuration) return 0;
    return Math.floor(videoDuration * fps);
  }, [videoDuration, fps]);

  // Reset cache when FPS or URL changes
  useEffect(() => {
    if (videoDuration) {
      const total = Math.max(1, Math.floor(videoDuration * fps));
      frameCache.current = new Array(total).fill(null);
    }
  }, [fps, videoUrl, videoDuration]);

  const setFrameIndex = (frame: number) => {
    setCurrentFrame(frame);
    currentFrameRef.current = frame;
  };

  const activeBox = useMemo(() => {
    return boxes.find((b) => b.id === activeBoxId) || null;
  }, [boxes, activeBoxId]);

  // Video playback loop & seek update
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    let animFrame: number;

    const updateLoop = () => {
      if (!isPlaying) {
        drawCanvas(currentFrameRef.current);
        return;
      }

      const now = performance.now();
      const frameDuration = 1000 / fps;
      const elapsed = now - lastFrameTime.current;

      const startFrame = Math.floor(loopStart * fps);
      const endFrame = Math.floor(loopEnd * fps);

      let nextFrame = currentFrameRef.current;
      if (elapsed >= frameDuration) {
        nextFrame = currentFrameRef.current + stepSize;
        if (nextFrame > endFrame || nextFrame < startFrame) {
          nextFrame = startFrame;
        }
      }

      const isNextFrameCached = canCache.current && frameCache.current[nextFrame] !== null;

      if (isNextFrameCached) {
        if (elapsed >= frameDuration) {
          setFrameIndex(nextFrame);
          lastFrameTime.current = now - (elapsed % frameDuration);
        }
        if (!video.paused) {
          video.pause();
        }
        drawCanvas(nextFrame);
      } else {
        if (video.paused && isPlaying) {
          video.play().catch(() => setIsPlaying(false));
        }

        if (!video.seeking) {
          if (video.currentTime >= loopEnd || video.currentTime < loopStart) {
            video.currentTime = loopStart;
            nextFrame = startFrame;
          } else {
            const rawFrame = Math.floor(video.currentTime * fps);
            const rel = rawFrame - startFrame;
            const snappedRel = Math.floor(rel / stepSize) * stepSize;
            nextFrame = startFrame + snappedRel;
          }
          setFrameIndex(nextFrame);
        }
        drawCanvas(nextFrame);
        lastFrameTime.current = now;
      }

      animFrame = requestAnimationFrame(updateLoop);
    };

    if (isPlaying) {
      lastFrameTime.current = performance.now();
      animFrame = requestAnimationFrame(updateLoop);
    } else {
      video.pause();
      // Seek video to current frame when pausing so user sees the correct frame
      video.currentTime = currentFrameRef.current / fps;
    }

    return () => {
      cancelAnimationFrame(animFrame);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying, loopStart, loopEnd, fps]);

  // Seek event handler for video
  const handleSeeked = () => {
    const video = videoRef.current;
    if (!video) return;

    const rawFrame = Math.floor(video.currentTime * fps);
    const startFrame = Math.floor(loopStart * fps);
    const endFrame = Math.floor(loopEnd * fps);

    let frameIdx = rawFrame;
    if (rawFrame >= startFrame && rawFrame <= endFrame) {
      const rel = rawFrame - startFrame;
      const snappedRel = Math.floor(rel / stepSize) * stepSize;
      frameIdx = startFrame + snappedRel;
    }

    setFrameIndex(frameIdx);
    drawCanvas(frameIdx);
  };

  // Draw main viewport canvas
  const drawCanvas = (frameIndex: number = currentFrame) => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Draw Video Frame (use cache if available)
    if (canCache.current && frameCache.current[frameIndex]) {
      ctx.drawImage(frameCache.current[frameIndex]!, 0, 0);
    } else if (!video.seeking) {
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      // Cache this frame if possible
      if (canCache.current && video.readyState >= 2) {
        const offscreen = document.createElement('canvas');
        offscreen.width = canvas.width;
        offscreen.height = canvas.height;
        const oCtx = offscreen.getContext('2d');
        if (oCtx) {
          oCtx.drawImage(video, 0, 0);
          frameCache.current[frameIndex] = offscreen;
        }
      }
    }

    // Draw Bounding Boxes
    boxes.forEach((box, index) => {
      const isActive = box.id === activeBoxId;

      ctx.save();

      // Set styling
      if (isActive) {
        ctx.strokeStyle = '#79efa4';
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 4]);
      } else {
        ctx.strokeStyle = '#4aa07f';
        ctx.lineWidth = 1;
        ctx.setLineDash([]);
      }

      // Draw bounding box
      ctx.strokeRect(box.x, box.y, box.w, box.h);

      // Label background & text
      const label = `[${index}] ${box.spriteId || 'sprite'} (${box.w}x${box.h})`;
      ctx.font = '10px Courier New';
      const textWidth = ctx.measureText(label).width;

      ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
      ctx.fillRect(box.x, box.y - 15, textWidth + 6, 14);

      ctx.fillStyle = isActive ? '#79efa4' : '#4aa07f';
      ctx.fillText(label, box.x + 3, box.y - 4);

      // Draw resizing corner handles for active box
      if (isActive) {
        ctx.fillStyle = '#79efa4';
        const hs = 6; // handle size
        ctx.fillRect(box.x - hs / 2, box.y - hs / 2, hs, hs); // tl
        ctx.fillRect(box.x + box.w - hs / 2, box.y - hs / 2, hs, hs); // tr
        ctx.fillRect(box.x - hs / 2, box.y + box.h - hs / 2, hs, hs); // bl
        ctx.fillRect(box.x + box.w - hs / 2, box.y + box.h - hs / 2, hs, hs); // br
      }

      ctx.restore();
    });
  };

  // Convert client coordinate to absolute canvas (video) coordinate
  const getCanvasCoords = (e: React.MouseEvent<HTMLCanvasElement>): { x: number; y: number } => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const x = Math.floor(((e.clientX - rect.left) / rect.width) * canvas.width);
    const y = Math.floor(((e.clientY - rect.top) / rect.height) * canvas.height);
    // Bound coordinates
    return {
      x: Math.max(0, Math.min(canvas.width, x)),
      y: Math.max(0, Math.min(canvas.height, y)),
    };
  };

  // Handle Mouse Events on Canvas
  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!videoUrl || e.button !== 0) return;
    const { x, y } = getCanvasCoords(e);

    // Check if clicked near resizing handles of the active box
    if (activeBox) {
      const hs = 8; // handle tolerance area
      const b = activeBox;

      const isNear = (hx: number, hy: number) => {
        return Math.abs(x - hx) < hs && Math.abs(y - hy) < hs;
      };

      if (isNear(b.x, b.y)) {
        dragInfo.current = {
          action: 'resizing',
          handle: 'tl',
          boxId: b.id,
          startX: x,
          startY: y,
          originalBox: { ...b },
        };
        return;
      }
      if (isNear(b.x + b.w, b.y)) {
        dragInfo.current = {
          action: 'resizing',
          handle: 'tr',
          boxId: b.id,
          startX: x,
          startY: y,
          originalBox: { ...b },
        };
        return;
      }
      if (isNear(b.x, b.y + b.h)) {
        dragInfo.current = {
          action: 'resizing',
          handle: 'bl',
          boxId: b.id,
          startX: x,
          startY: y,
          originalBox: { ...b },
        };
        return;
      }
      if (isNear(b.x + b.w, b.y + b.h)) {
        dragInfo.current = {
          action: 'resizing',
          handle: 'br',
          boxId: b.id,
          startX: x,
          startY: y,
          originalBox: { ...b },
        };
        return;
      }
    }

    // Check if clicked inside any box to start dragging
    for (let i = boxes.length - 1; i >= 0; i--) {
      const b = boxes[i];
      if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) {
        setActiveBoxId(b.id);
        dragInfo.current = {
          action: 'dragging',
          boxId: b.id,
          startX: x,
          startY: y,
          originalBox: { ...b },
        };
        return;
      }
    }

    // Otherwise, start drawing a new box if count < 10
    if (boxes.length < 10) {
      const newId = 'box_' + Date.now();
      const newBox: Box = {
        id: newId,
        spriteId: `sprite_box_${boxes.length}`,
        targetPng: `public/assets/exported_sprites.png`,
        colIndex: boxes.length,
        x,
        y,
        w: 0,
        h: 0,
      };

      setBoxes((prev) => [...prev, newBox]);
      setActiveBoxId(newId);
      dragInfo.current = { action: 'drawing', boxId: newId, startX: x, startY: y };
    }
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (dragInfo.current.action === 'none') return;
    const { x, y } = getCanvasCoords(e);
    const info = dragInfo.current;

    setBoxes((prev) =>
      prev.map((b) => {
        if (b.id !== info.boxId) return b;

        if (info.action === 'drawing') {
          const w = x - info.startX;
          const h = y - info.startY;
          return {
            ...b,
            x: w < 0 ? x : info.startX,
            y: h < 0 ? y : info.startY,
            w: Math.abs(w),
            h: Math.abs(h),
          };
        }

        if (info.action === 'dragging' && info.originalBox) {
          const dx = x - info.startX;
          const dy = y - info.startY;
          return {
            ...b,
            x: Math.max(0, Math.min(videoWidth - b.w, info.originalBox.x + dx)),
            y: Math.max(0, Math.min(videoHeight - b.h, info.originalBox.y + dy)),
          };
        }

        if (info.action === 'resizing' && info.originalBox) {
          const dx = x - info.startX;
          const dy = y - info.startY;
          const ob = info.originalBox;

          if (info.handle === 'br') {
            return { ...b, w: Math.max(5, ob.w + dx), h: Math.max(5, ob.h + dy) };
          }
          if (info.handle === 'tl') {
            return {
              ...b,
              x: Math.min(ob.x + ob.w - 5, ob.x + dx),
              y: Math.min(ob.y + ob.h - 5, ob.y + dy),
              w: Math.max(5, ob.w - dx),
              h: Math.max(5, ob.h - dy),
            };
          }
          if (info.handle === 'tr') {
            return {
              ...b,
              y: Math.min(ob.y + ob.h - 5, ob.y + dy),
              w: Math.max(5, ob.w + dx),
              h: Math.max(5, ob.h - dy),
            };
          }
          if (info.handle === 'bl') {
            return {
              ...b,
              x: Math.min(ob.x + ob.w - 5, ob.x + dx),
              w: Math.max(5, ob.w - dx),
              h: Math.max(5, ob.h + dy),
            };
          }
        }

        return b;
      })
    );
  };

  const handleMouseUp = () => {
    if (dragInfo.current.action === 'drawing' && dragInfo.current.boxId) {
      // Validate drawn box size
      const boxId = dragInfo.current.boxId;
      setBoxes((prev) => {
        const drawn = prev.find((b) => b.id === boxId);
        if (drawn && (drawn.w < 5 || drawn.h < 5)) {
          setActiveBoxId(null);
          return prev.filter((b) => b.id !== boxId);
        }
        return prev;
      });
    }

    dragInfo.current = { action: 'none', startX: 0, startY: 0 };
    drawCanvas();
  };

  // Handle Box Property Edits
  const handleBoxPropertyChange = (field: keyof Box, value: any) => {
    if (!activeBoxId) return;
    setBoxes((prev) =>
      prev.map((b) => {
        if (b.id !== activeBoxId) return b;
        const updated = { ...b, [field]: value };
        // Clean coordinates bounds
        if (field === 'x') updated.x = Math.max(0, Math.min(videoWidth - b.w, Number(value)));
        if (field === 'y') updated.y = Math.max(0, Math.min(videoHeight - b.h, Number(value)));
        if (field === 'w') updated.w = Math.max(5, Math.min(videoWidth - b.x, Number(value)));
        if (field === 'h') updated.h = Math.max(5, Math.min(videoHeight - b.y, Number(value)));
        return updated;
      })
    );
  };

  // Reset/Clear all frames

  // Load local file input
  const handleLocalFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const url = URL.createObjectURL(file);
      setVideoUrl(url);
      setVideoFilename(file.name);
      setVideoLoadError(false);
      setIsPlaying(false);

      // If there is a pending configuration, apply it now
      if (pendingConfigRef.current) {
        const data = pendingConfigRef.current;
        pendingConfigRef.current = null;

        if (data.fps) setFps(data.fps);
        if (data.stepSize) setStepSize(data.stepSize);
        if (data.boxes) setBoxes(data.boxes);
        if (data.loopStart !== undefined && data.loopEnd !== undefined) {
          loadedLoopBoundsRef.current = { start: data.loopStart, end: data.loopEnd };
        }
        showToast('Configuration loaded successfully.');
      }
    }
  };

  // Video loaded metadata handler
  const handleLoadedMetadata = () => {
    const video = videoRef.current;
    if (!video) return;

    setVideoDuration(video.duration);
    setVideoWidth(video.videoWidth);
    setVideoHeight(video.videoHeight);

    if (loadedLoopBoundsRef.current) {
      setLoopStart(loadedLoopBoundsRef.current.start);
      setLoopEnd(loadedLoopBoundsRef.current.end);
      loadedLoopBoundsRef.current = null;
    } else {
      setLoopStart(0);
      setLoopEnd(video.duration);
    }
    setFrameIndex(0);

    // Initialize frame cache
    const total = Math.max(1, Math.floor(video.duration * fps));
    frameCache.current = new Array(total).fill(null);
    const volume = video.videoWidth * video.videoHeight * total;
    canCache.current = volume < 400_000_000; // Limit cache size to avoid browser OOM

    // Resize canvas buffer
    const canvas = canvasRef.current;
    if (canvas) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
    }

    setTimeout(() => {
      drawCanvas();
    }, 100);
  };

  // Helper utility to seek video asynchronously and wait for seeked event
  const seekVideo = (video: HTMLVideoElement, time: number): Promise<void> => {
    return new Promise((resolve) => {
      const onSeeked = () => {
        video.removeEventListener('seeked', onSeeked);
        resolve();
      };
      video.addEventListener('seeked', onSeeked);
      video.currentTime = time;
    });
  };

  // EXPORT PROCESS
  const handleExport = React.useCallback(async () => {
    if (boxes.length === 0) {
      alert('Draw at least one bounding box to export.');
      return;
    }

    const video = videoRef.current;
    if (!video) return;

    // Pause playback
    setIsPlaying(false);
    video.pause();

    // Compute list of frame indexes to export
    const frameTime = 1 / fps;
    const startFrame = Math.floor(loopStart * fps);
    const endFrame = Math.floor(loopEnd * fps);

    const exportFrames: number[] = [];
    for (let f = startFrame; f <= endFrame; f += stepSize) {
      exportFrames.push(f);
    }

    if (exportFrames.length === 0) {
      alert('Selected loop region contains 0 frames.');
      return;
    }

    setExportProgress(0);
    setExportStatusText('Initializing export...');

    try {
      // Group boxes by their target PNG spritesheet filenames (always saving under public/assets/)
      const groups: Record<string, Box[]> = {};
      boxes.forEach((box) => {
        const rawPath = box.targetPng.trim() || 'exported_sprites.png';
        const filename = rawPath.split(/[/\\]/).pop() || 'exported_sprites.png';
        const targetPath = `public/assets/${filename}`;

        if (!groups[targetPath]) groups[targetPath] = [];
        groups[targetPath].push(box);
      });

      const totalSteps = Object.keys(groups).length * exportFrames.length;
      let completedSteps = 0;

      // Temporary frame canvas to hold cropped video frame
      const frameCanvas = document.createElement('canvas');
      frameCanvas.width = videoWidth;
      frameCanvas.height = videoHeight;
      const frameCtx = frameCanvas.getContext('2d');
      if (!frameCtx) throw new Error('Could not create temporary 2D context.');

      // Process each spritesheet group
      for (const targetPath of Object.keys(groups)) {
        const groupBoxes = groups[targetPath];

        const { colX, totalWidth, totalHeight } = calculateSpritesheetLayout(
          groupBoxes.map((b) => ({ id: b.id, colIndex: b.colIndex, w: b.w, h: b.h })),
          exportFrames.length
        );

        // Create spritesheet canvas
        const sheetCanvas = document.createElement('canvas');
        sheetCanvas.width = totalWidth;
        sheetCanvas.height = totalHeight;
        const sheetCtx = sheetCanvas.getContext('2d');
        if (!sheetCtx) throw new Error('Could not create sheet 2D context.');

        // Clear transparent
        sheetCtx.clearRect(0, 0, totalWidth, totalHeight);

        // Render each frame sequentially
        for (let frameSeqIdx = 0; frameSeqIdx < exportFrames.length; frameSeqIdx++) {
          const frameIdx = exportFrames[frameSeqIdx];
          const time = frameIdx * frameTime;

          setExportStatusText(
            `Exporting spritesheet [${targetPath.split('/').pop()}]: frame ${frameSeqIdx + 1}/${exportFrames.length}...`
          );

          // Seek and wait
          await seekVideo(video, time);

          // Draw current video frame onto frameCanvas
          frameCtx.drawImage(video, 0, 0, videoWidth, videoHeight);

          // Copy cropped regions for each box onto sheetCanvas
          groupBoxes.forEach((box) => {
            const sx = box.x;
            const sy = box.y;
            const sw = box.w;
            const sh = box.h;

            const dx = colX[box.id];
            const dy = frameSeqIdx * box.h;

            sheetCtx.drawImage(frameCanvas, sx, sy, sw, sh, dx, dy, sw, sh);
          });

          completedSteps++;
          setExportProgress(Math.floor((completedSteps / totalSteps) * 100));
        }

        // Save Spritesheet PNG File
        const dataUrl = sheetCanvas.toDataURL('image/png');
        setExportStatusText(`Saving image file to ${targetPath}...`);
        await saveProjectFile(targetPath, dataUrl);

        // Save JSON config files for each sprite
        for (const box of groupBoxes) {
          const spriteJsonPath = `public/sprites/${box.spriteId}.json`;
          setExportStatusText(`Saving sprite metadata: ${box.spriteId}.json...`);

          const spriteData = {
            id: box.spriteId,
            imageFile: targetPath,
            x: colX[box.id],
            y: 0,
            width: box.w,
            height: box.h,
            frames: exportFrames.length,
          };

          await saveProjectFile(spriteJsonPath, JSON.stringify(spriteData, null, 2));
        }
      }

      setExportStatusText('Export complete! All files saved successfully.');
      setTimeout(() => {
        setExportProgress(null);
      }, 2000);
    } catch (err: any) {
      console.error(err);
      alert(`Export failed: ${err.message || String(err)}`);
      setExportProgress(null);
    }
  }, [boxes, fps, loopStart, loopEnd, stepSize, videoWidth, videoHeight]);

  // CONFIGURATION SAVE / LOAD
  const handleOpenSaveConfig = React.useCallback(() => {
    setBrowserMode('save');
  }, []);

  const handleOpenLoadConfig = React.useCallback(() => {
    setBrowserMode('load');
  }, []);

  const handleNewProject = React.useCallback(() => {
    if (window.confirm('Start a new project? This will clear all boxes and reset settings.')) {
      setBoxes([]);
      setActiveBoxId(null);
      setVideoUrl(null);
      setVideoFilename('');
      setVideoDuration(0);
      setVideoWidth(0);
      setVideoHeight(0);
      setLoopStart(0);
      setLoopEnd(0);
      setFrameIndex(0);
      setVideoLoadError(false);
      frameCache.current = [];
    }
  }, []);

  const handleBrowserConfirm = React.useCallback(
    async (selectedFile: string) => {
      setBrowserMode(null);
      if (!selectedFile) return;

      if (browserMode === 'save') {
        try {
          const config = {
            _isVetoolConfig: true,
            videoFilename,
            loopStart,
            loopEnd,
            fps,
            stepSize,
            boxes,
          };
          const filePath = `public/vetool/${selectedFile}`;
          await saveProjectFile(filePath, JSON.stringify(config, null, 2));
          showToast('Configuration saved successfully.');
        } catch (err: any) {
          alert(`Failed to save configuration: ${err.message || String(err)}`);
        }
      } else if (browserMode === 'load') {
        try {
          const rawContent = await readProjectFileExisting(`public/vetool/${selectedFile}`);
          if (!rawContent) {
            throw new Error('File is empty or could not be read.');
          }
          const data = JSON.parse(rawContent);
          if (!data._isVetoolConfig) {
            alert('Selected file is not a valid Video Export Tool configuration.');
            return;
          }

          const applyConfig = (configData: any) => {
            if (configData.fps) setFps(configData.fps);
            if (configData.stepSize) setStepSize(configData.stepSize);
            if (configData.loopStart !== undefined) setLoopStart(configData.loopStart);
            if (configData.loopEnd !== undefined) setLoopEnd(configData.loopEnd);
            if (configData.boxes) setBoxes(configData.boxes);
            frameCache.current = [];
          };

          if (data.videoFilename) {
            if (videoUrl && videoFilename === data.videoFilename) {
              // Video matches currently loaded video, apply config immediately
              applyConfig(data);
              showToast('Configuration loaded successfully.');
            } else {
              // Video doesn't match or not loaded. Store config and prompt user to select the video
              pendingConfigRef.current = data;
              showToast(`Please select the video "${data.videoFilename}" from your computer.`);
              fileInputRef.current?.click();
            }
          } else {
            // No video associated with this config, just apply the boxes/settings
            applyConfig(data);
            showToast('Configuration loaded successfully.');
          }
        } catch (err: any) {
          alert(`Failed to load configuration: ${err.message || String(err)}`);
        }
      }
    },
    [browserMode, videoFilename, videoUrl, loopStart, loopEnd, fps, stepSize, boxes, showToast]
  );

  // Keyboard navigation & playback loop
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if user is inside an input field
      if (document.activeElement instanceof HTMLInputElement) return;

      const video = videoRef.current;
      if (!video) return;

      const frameTime = 1 / fps;

      if (e.key === 'ArrowRight') {
        e.preventDefault();
        const nextTime = Math.min(video.duration, video.currentTime + stepSize * frameTime);
        video.currentTime = nextTime;
        setIsPlaying(false);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        const prevTime = Math.max(0, video.currentTime - stepSize * frameTime);
        video.currentTime = prevTime;
        setIsPlaying(false);
      } else if (e.key === ' ') {
        e.preventDefault();
        setIsPlaying((prev) => !prev);
      } else if (e.key === 'Home') {
        e.preventDefault();
        if (e.ctrlKey) {
          video.currentTime = 0;
        } else {
          video.currentTime = loopStart;
        }
        setIsPlaying(false);
      } else if (e.key === 'End') {
        e.preventDefault();
        if (e.ctrlKey) {
          video.currentTime = video.duration;
        } else {
          video.currentTime = loopEnd;
        }
        setIsPlaying(false);
      } else if (e.key === '[') {
        e.preventDefault();
        setLoopStart(video.currentTime);
      } else if (e.key === ']') {
        e.preventDefault();
        setLoopEnd(video.currentTime);
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (activeBoxId) {
          e.preventDefault();
          setBoxes((prev) => prev.filter((b) => b.id !== activeBoxId));
          setActiveBoxId(null);
        }
      } else if (e.key === 'F1') {
        e.preventDefault();
        window.location.href = '/';
      } else if (e.key === 'F2') {
        e.preventDefault();
        handleOpenSaveConfig();
      } else if (e.key === 'F3') {
        e.preventDefault();
        handleOpenLoadConfig();
      } else if (e.key === 'F4') {
        e.preventDefault();
        handleNewProject();
      } else if (e.key === 'F5') {
        e.preventDefault();
        window.location.href = '/#sprite-editor';
      } else if (e.key === 'F6') {
        e.preventDefault();
        setIsPlaying((prev) => !prev);
      } else if (e.key === 'F7') {
        e.preventDefault();
        const cur = video.currentTime;
        setLoopStart(cur);
        if (loopEnd < cur) setLoopEnd(video.duration);
      } else if (e.key === 'F8') {
        e.preventDefault();
        handleExport();
      } else if (e.key === 'F9') {
        e.preventDefault();
        const cur = video.currentTime;
        if (cur > loopStart) setLoopEnd(cur);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [
    fps,
    stepSize,
    loopStart,
    loopEnd,
    activeBoxId,
    videoDuration,
    handleExport,
    handleOpenSaveConfig,
    handleOpenLoadConfig,
    handleNewProject,
  ]);

  // Draw initial state of canvas if video is not playing
  useEffect(() => {
    if (videoUrl) {
      drawCanvas();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boxes, activeBoxId, videoUrl, currentFrame]);

  // Load UI Scale settings
  useEffect(() => {
    const updateScale = () => {
      try {
        const json = localStorage.getItem('quest_settings');
        if (json) {
          const loaded = JSON.parse(json);
          const loadedEditor = loaded?.editor ?? loaded?.settings?.editor;
          if (loadedEditor && typeof loadedEditor.uiScale === 'number') {
            setUiScale(loadedEditor.uiScale);
          }
        }
      } catch (e) {
        console.error('Failed to load quest_settings in vetool:', e);
      }
    };

    updateScale();

    window.addEventListener('storage', updateScale);
    return () => window.removeEventListener('storage', updateScale);
  }, []);

  return (
    <div className="vetool-container">
      {/* 1. Header */}
      <header className="vetool-header" style={{ fontSize: `${12 * uiScale}px` }}>
        <div className="vetool-title">Video Export Tool (vetool)</div>
        <div className="ui-inline-flex-center gap-10">
          {videoFilename && (
            <span className="ui-text-accent-green ui-font-bold">
              VIDEO: {videoFilename} ({videoWidth}x{videoHeight})
            </span>
          )}
        </div>
      </header>

      {/* 2. Main Workspace */}
      <div className="vetool-main">
        <div className="vetool-center-column">
          {/* Left Side: Video Viewport & Timeline */}
          <div className="vetool-workspace">
            {/* Video Viewport Box */}
            <div
              className={`vetool-viewport-card ${!videoUrl || videoLoadError ? 'vetool-checkerboard' : ''}`}
            >
              {videoUrl && !videoLoadError ? (
                <>
                  <video
                    ref={videoRef}
                    src={videoUrl}
                    style={{ display: 'none' }}
                    onLoadedMetadata={handleLoadedMetadata}
                    onSeeked={handleSeeked}
                    onError={() => setVideoLoadError(true)}
                    loop={false}
                  />
                  <canvas
                    ref={canvasRef}
                    className="vetool-video-canvas"
                    onMouseDown={handleMouseDown}
                    onMouseMove={handleMouseMove}
                    onMouseUp={handleMouseUp}
                  />
                </>
              ) : videoLoadError ? (
                <div className="ui-text-dim text-center">
                  <h2 style={{ color: '#ff4d4d' }}>VIDEO LOAD FAILED</h2>
                  <p>Could not load "{videoFilename}" automatically from server assets.</p>
                  <p style={{ marginTop: '8px' }}>
                    Please click <strong>CHOOSE FILE</strong> in the sidebar to load the video from
                    your local computer.
                  </p>
                  <video
                    ref={videoRef}
                    src={videoUrl || undefined}
                    style={{ display: 'none' }}
                    onError={() => setVideoLoadError(true)}
                    loop={false}
                  />
                </div>
              ) : (
                <div className="ui-text-dim text-center">
                  <h2>NO VIDEO LOADED</h2>
                  <p>Use controls in the sidebar to load an MPEG-4 file.</p>
                </div>
              )}
            </div>

            {/* Timeline & Controls */}
            {videoUrl && (
              <div className="vetool-timeline-panel">
                <div className="vetool-timeline-container">
                  {/* Highlighted Loop Range */}
                  <div
                    className="vetool-loop-range-bar"
                    style={{
                      left: `${(loopStart / videoDuration) * 100}%`,
                      width: `${((loopEnd - loopStart) / videoDuration) * 100}%`,
                    }}
                  />
                  {/* Timeline slider */}
                  <input
                    type="range"
                    className="vetool-timeline-slider"
                    min={0}
                    max={totalFrames - 1}
                    value={currentFrame}
                    onChange={(e) => {
                      if (videoRef.current) {
                        videoRef.current.currentTime = Number(e.target.value) / fps;
                        setIsPlaying(false);
                      }
                    }}
                  />
                </div>

                {/* Time display readouts */}
                <div className="vetool-timeline-readout">
                  <span>
                    LOOP START: <span className="ui-text-accent-cyan">{loopStart.toFixed(3)}s</span>{' '}
                    (F: {Math.floor(loopStart * fps)})
                  </span>
                  <span className="ui-text-bright ui-font-bold">
                    TIME: {videoRef.current ? videoRef.current.currentTime.toFixed(3) : '0.000'}s /{' '}
                    {videoDuration.toFixed(3)}s | FRAME: {currentFrame} / {totalFrames}
                  </span>
                  <span>
                    LOOP END: <span className="ui-text-accent-red">{loopEnd.toFixed(3)}s</span> (F:{' '}
                    {Math.floor(loopEnd * fps)})
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* 3. Bottom Actions */}
          <div className="editor-bottom-menu" style={{ zIndex: 2000 }}>
            <div className="mem-counter">VETOOL</div>

            <button className="e-menu-btn" onClick={() => (window.location.href = '/')}>
              <span className="hotkey-accent">F1</span>Game
            </button>
            <button className="e-menu-btn" onClick={handleOpenSaveConfig} disabled={!videoUrl}>
              <span className="hotkey-accent">F2</span>Save
            </button>
            <button className="e-menu-btn" onClick={handleOpenLoadConfig}>
              <span className="hotkey-accent">F3</span>Load
            </button>
            <button className="e-menu-btn" onClick={handleNewProject}>
              <span className="hotkey-accent">F4</span>New
            </button>
            <button
              className="e-menu-btn"
              onClick={() => (window.location.href = '/#sprite-editor')}
            >
              <span className="hotkey-accent">F5</span>Sprite
            </button>
            <button
              className="e-menu-btn"
              onClick={() => setIsPlaying((p) => !p)}
              disabled={!videoUrl}
            >
              <span className="hotkey-accent">F6</span>
              {isPlaying ? 'Pause' : 'Play'}
            </button>
            <button
              className="e-menu-btn"
              disabled={!videoUrl}
              onClick={() => {
                if (videoRef.current) {
                  const cur = videoRef.current.currentTime;
                  setLoopStart(cur);
                  if (loopEnd < cur) setLoopEnd(videoDuration);
                }
              }}
            >
              <span className="hotkey-accent">F7</span>Set Start
            </button>
            <button className="e-menu-btn" onClick={handleExport} disabled={!videoUrl}>
              <span className="hotkey-accent">F8</span>Export
            </button>
            <button
              className="e-menu-btn"
              disabled={!videoUrl}
              onClick={() => {
                if (videoRef.current) {
                  const cur = videoRef.current.currentTime;
                  if (cur > loopStart) setLoopEnd(cur);
                }
              }}
            >
              <span className="hotkey-accent">F9</span>Set End
            </button>

            <div className="fps-counter">FPS: {fps}</div>
          </div>
        </div>

        {/* Right Side: Sidebar Controls */}
        <div className="vetool-sidebar" style={{ fontSize: `${12 * uiScale}px` }}>
          {/* File Operations */}
          <div className="vetool-sidebar-section">
            <h3>Video File</h3>
            <div className="vetool-form-group">
              <label>Video File (.mp4)</label>
              <input
                type="file"
                ref={fileInputRef}
                accept="video/mp4,video/*"
                onChange={handleLocalFileChange}
                style={{ display: 'none' }}
              />
              <button
                className="e-btn"
                onClick={() => fileInputRef.current?.click()}
                style={{ width: '100%', marginTop: '4px' }}
              >
                CHOOSE FILE
              </button>
            </div>
          </div>

          {/* Loop & Playback Settings */}
          {videoUrl && (
            <div className="vetool-sidebar-section">
              <h3>Loop & Step Settings</h3>
              <div className="vetool-grid-2">
                <div className="vetool-form-group">
                  <label>Frame Rate (FPS)</label>
                  <select value={fps} onChange={(e) => setFps(Number(e.target.value))}>
                    <option value={24}>24 FPS</option>
                    <option value={25}>25 FPS</option>
                    <option value={30}>30 FPS</option>
                    <option value={50}>50 FPS</option>
                    <option value={60}>60 FPS</option>
                  </select>
                </div>
                <div className="vetool-form-group">
                  <label>Step Size</label>
                  <select value={stepSize} onChange={(e) => setStepSize(Number(e.target.value))}>
                    <option value={1}>1 frame (All)</option>
                    <option value={2}>2 frames (1/2)</option>
                    <option value={3}>3 frames (1/3)</option>
                    <option value={4}>4 frames (1/4)</option>
                  </select>
                </div>
              </div>
              <div className="vetool-grid-2" style={{ marginTop: '6px' }}>
                <button
                  className="e-btn"
                  onClick={() => videoRef.current && setLoopStart(videoRef.current.currentTime)}
                >
                  Set Loop Start [
                </button>
                <button
                  className="e-btn"
                  onClick={() => videoRef.current && setLoopEnd(videoRef.current.currentTime)}
                >
                  Set Loop End ]
                </button>
              </div>
              <button
                className="e-btn"
                style={{ width: '100%', marginTop: '6px' }}
                onClick={() => {
                  setLoopStart(0);
                  setLoopEnd(videoDuration);
                }}
              >
                Reset Loop Bounds
              </button>
            </div>
          )}

          {/* Active Box Properties */}
          {videoUrl && (
            <div className="vetool-sidebar-section">
              <h3>Box Properties</h3>
              {activeBox ? (
                <>
                  <div className="vetool-form-group">
                    <label>Sprite JSON ID</label>
                    <input
                      type="text"
                      className="e-input"
                      value={activeBox.spriteId}
                      onChange={(e) => handleBoxPropertyChange('spriteId', e.target.value)}
                    />
                  </div>
                  <div className="vetool-form-group">
                    <label>Target PNG Path</label>
                    <input
                      type="text"
                      className="e-input"
                      value={activeBox.targetPng}
                      onChange={(e) => handleBoxPropertyChange('targetPng', e.target.value)}
                    />
                  </div>
                  <div className="vetool-form-group">
                    <label>Target Column Index</label>
                    <input
                      type="number"
                      className="e-input"
                      value={activeBox.colIndex}
                      onChange={(e) => handleBoxPropertyChange('colIndex', Number(e.target.value))}
                    />
                  </div>

                  <div className="vetool-grid-2">
                    <div className="vetool-form-group">
                      <label>Box X</label>
                      <input
                        type="number"
                        className="e-input"
                        value={activeBox.x}
                        onChange={(e) => handleBoxPropertyChange('x', Number(e.target.value))}
                      />
                    </div>
                    <div className="vetool-form-group">
                      <label>Box Y</label>
                      <input
                        type="number"
                        className="e-input"
                        value={activeBox.y}
                        onChange={(e) => handleBoxPropertyChange('y', Number(e.target.value))}
                      />
                    </div>
                  </div>
                  <div className="vetool-grid-2">
                    <div className="vetool-form-group">
                      <label>Width</label>
                      <input
                        type="number"
                        className="e-input"
                        value={activeBox.w}
                        onChange={(e) => handleBoxPropertyChange('w', Number(e.target.value))}
                      />
                    </div>
                    <div className="vetool-form-group">
                      <label>Height</label>
                      <input
                        type="number"
                        className="e-input"
                        value={activeBox.h}
                        onChange={(e) => handleBoxPropertyChange('h', Number(e.target.value))}
                      />
                    </div>
                  </div>
                  <button
                    className="e-btn e-btn-red"
                    style={{ width: '100%', marginTop: '6px' }}
                    onClick={() => {
                      setBoxes((prev) => prev.filter((b) => b.id !== activeBoxId));
                      setActiveBoxId(null);
                    }}
                  >
                    Delete Selected Box
                  </button>
                </>
              ) : (
                <div className="ui-text-dim text-center py-10">
                  No active box. Drag on the video to draw a box or select an existing one.
                </div>
              )}
            </div>
          )}

          {/* List of all boxes */}
          {videoUrl && boxes.length > 0 && (
            <div className="vetool-sidebar-section" style={{ flex: 1 }}>
              <h3>Active Boxes ({boxes.length}/10)</h3>
              <div style={{ maxHeight: '180px', overflowY: 'auto' }}>
                {boxes.map((box, index) => (
                  <div
                    key={box.id}
                    className={`vetool-box-list-item ${box.id === activeBoxId ? 'active' : ''}`}
                    onClick={() => setActiveBoxId(box.id)}
                  >
                    <div className="vetool-box-info">
                      <span className="vetool-box-title">
                        [{index}] {box.spriteId || 'sprite'}
                      </span>
                      <span className="vetool-box-meta">
                        Col: {box.colIndex} | Size: {box.w}x{box.h} | Pos: {box.x},{box.y}
                      </span>
                    </div>
                    <button
                      className="e-btn e-btn-small e-btn-red"
                      onClick={(e) => {
                        e.stopPropagation();
                        setBoxes((prev) => prev.filter((b) => b.id !== box.id));
                        if (activeBoxId === box.id) setActiveBoxId(null);
                      }}
                    >
                      X
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* File Browser Modal for Config Save/Load */}
      {browserMode !== null && (
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
            mode={browserMode}
            directory="public/vetool"
            defaultFilename={browserFilename}
            onConfirm={handleBrowserConfirm}
            onCancel={() => setBrowserMode(null)}
            extension=".json"
            title={browserMode === 'save' ? 'Save Vetool Config' : 'Load Vetool Config'}
          />
        </div>
      )}

      {/* Export Progress Modal */}
      {exportProgress !== null && (
        <div className="vetool-modal-backdrop">
          <div className="vetool-modal" style={{ textAlign: 'center' }}>
            <div className="vetool-modal-header" style={{ justifyContent: 'center' }}>
              <span>EXPORTING SPRITES</span>
            </div>
            <div className="vetool-modal-body">
              <p className="ui-text-accent-green" style={{ fontWeight: 'bold' }}>
                {exportStatusText}
              </p>
              <div className="vetool-progress-bar-container">
                <div className="vetool-progress-bar" style={{ width: `${exportProgress}%` }} />
              </div>
              <p style={{ marginTop: '8px', color: '#888' }}>{exportProgress}% complete</p>
            </div>
          </div>
        </div>
      )}

      {/* Toast Notification */}
      {toastMessage && (
        <div key={toastMessage.id} className="notification-toast">
          {toastMessage.text}
        </div>
      )}
    </div>
  );
}

// React Root Mounting
const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(
    <React.StrictMode>
      <VetoolApp />
    </React.StrictMode>
  );
}
