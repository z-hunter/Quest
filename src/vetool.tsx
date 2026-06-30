import React, { useState, useEffect, useRef, useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import { listProjectFiles, saveProjectFile } from './platform/fileApi';
import { calculateSpritesheetLayout } from './utils/vetoolLayout';
import './index.css';
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

  // Bounding Boxes State
  const [boxes, setBoxes] = useState<Box[]>([]);
  const [activeBoxId, setActiveBoxId] = useState<string | null>(null);

  // File Browser State (Server Files)
  const [fileBrowserOpen, setFileBrowserOpen] = useState<boolean>(false);
  const [serverFiles, setServerFiles] = useState<{ name: string; isDir: boolean }[]>([]);
  const [currentServerDir, setCurrentServerDir] = useState<string>('public/assets');

  // Export State
  const [exportProgress, setExportProgress] = useState<number | null>(null);
  const [exportStatusText, setExportStatusText] = useState<string>('');

  // Refs
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const frameCache = useRef<(HTMLCanvasElement | null)[]>([]);
  const canCache = useRef<boolean>(true);

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

  const activeBox = useMemo(() => {
    return boxes.find((b) => b.id === activeBoxId) || null;
  }, [boxes, activeBoxId]);

  // Load server assets on mount / when folder changes
  const loadServerFiles = async (dir: string) => {
    try {
      const files = await listProjectFiles(dir);
      // Filter for mp4s or directories
      const filtered = files.filter((f) => f.isDir || f.name.toLowerCase().endsWith('.mp4'));
      setServerFiles(filtered);
      setCurrentServerDir(dir);
    } catch (e) {
      console.error('Failed to list server files', e);
    }
  };

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
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [fps, stepSize, loopStart, loopEnd, activeBoxId]);

  // Video playback loop & seek update
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    let animFrame: number;

    const updateLoop = () => {
      if (video.paused && !isPlaying) return;

      // Handle loop constraints
      if (!video.seeking) {
        if (video.currentTime >= loopEnd || video.currentTime < loopStart) {
          video.currentTime = loopStart;
          setCurrentFrame(Math.floor(loopStart * fps));
        } else {
          // Sync frame index only when not seeking to avoid jitter
          setCurrentFrame(Math.floor(video.currentTime * fps));
        }
      }

      drawCanvas();

      animFrame = requestAnimationFrame(updateLoop);
    };

    if (isPlaying) {
      video.play().catch(() => setIsPlaying(false));
      animFrame = requestAnimationFrame(updateLoop);
    } else {
      video.pause();
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
    setCurrentFrame(Math.floor(video.currentTime * fps));
    drawCanvas();
  };

  // Draw main viewport canvas
  const drawCanvas = () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Draw Video Frame (use cache if available)
    if (canCache.current && frameCache.current[currentFrame]) {
      ctx.drawImage(frameCache.current[currentFrame]!, 0, 0);
    } else {
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      // Cache this frame if possible
      if (canCache.current && video.readyState >= 2) {
        const offscreen = document.createElement('canvas');
        offscreen.width = canvas.width;
        offscreen.height = canvas.height;
        const oCtx = offscreen.getContext('2d');
        if (oCtx) {
          oCtx.drawImage(video, 0, 0);
          frameCache.current[currentFrame] = offscreen;
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
        targetPng: `public/sprites/exported_sprites.png`,
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
  const handleClearBoxes = () => {
    if (window.confirm('Delete all bounding boxes?')) {
      setBoxes([]);
      setActiveBoxId(null);
    }
  };

  // Load local file input
  const handleLocalFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const url = URL.createObjectURL(file);
      setVideoUrl(url);
      setVideoFilename(file.name);
      setIsPlaying(false);
    }
  };

  // Load server asset
  const handleLoadServerAsset = (filename: string) => {
    // Relative path for client
    let clientUrl = `/${currentServerDir.substring(7)}/${filename}`;
    clientUrl = clientUrl.replace(/\/+/g, '/'); // Clean double slashes
    setVideoUrl(clientUrl);
    setVideoFilename(filename);
    setFileBrowserOpen(false);
    setIsPlaying(false);
  };

  // Video loaded metadata handler
  const handleLoadedMetadata = () => {
    const video = videoRef.current;
    if (!video) return;

    setVideoDuration(video.duration);
    setVideoWidth(video.videoWidth);
    setVideoHeight(video.videoHeight);
    setLoopStart(0);
    setLoopEnd(video.duration);
    setCurrentFrame(0);

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
  const handleExport = async () => {
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
      // Group boxes by their target PNG spritesheet paths
      const groups: Record<string, Box[]> = {};
      boxes.forEach((box) => {
        const path = box.targetPng.trim() || 'public/sprites/exported_sprites.png';
        if (!groups[path]) groups[path] = [];
        groups[path].push(box);
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
  };

  // Draw initial state of canvas if video is not playing
  useEffect(() => {
    if (videoUrl) {
      drawCanvas();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boxes, activeBoxId, videoUrl, currentFrame]);

  return (
    <div className="vetool-container">
      {/* 1. Header */}
      <header className="vetool-header">
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
        {/* Left Side: Video Viewport & Timeline */}
        <div className="vetool-workspace">
          {/* Video Viewport Box */}
          <div className={`vetool-viewport-card ${!videoUrl ? 'vetool-checkerboard' : ''}`}>
            {videoUrl ? (
              <>
                <video
                  ref={videoRef}
                  src={videoUrl}
                  style={{ display: 'none' }}
                  onLoadedMetadata={handleLoadedMetadata}
                  onSeeked={handleSeeked}
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

        {/* Right Side: Sidebar Controls */}
        <div className="vetool-sidebar">
          {/* File Operations */}
          <div className="vetool-sidebar-section">
            <h3>Video File</h3>
            <div className="vetool-form-group">
              <label>Load Local File (Browser)</label>
              <label
                className="file-upload"
                style={{ display: 'block', textAlign: 'center', marginTop: '4px' }}
              >
                CHOOSE FILE
                <input type="file" accept="video/mp4,video/*" onChange={handleLocalFileChange} />
              </label>
            </div>
            <div className="vetool-form-group" style={{ marginTop: '8px' }}>
              <label>Workspace Files</label>
              <button
                className="e-btn"
                onClick={() => {
                  loadServerFiles(currentServerDir);
                  setFileBrowserOpen(true);
                }}
              >
                Browse Server Assets
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

      {/* 3. Bottom Actions */}
      {videoUrl && (
        <div className="vetool-bottom-actions">
          <button className="e-btn" onClick={() => setIsPlaying((prev) => !prev)}>
            {isPlaying ? 'PAUSE' : 'PLAY'} [Space]
          </button>
          <button className="e-btn" onClick={handleClearBoxes}>
            CLEAR ALL BOXES [F2]
          </button>
          <button
            className="e-btn"
            onClick={() => {
              if (boxes.length < 10) {
                const newId = 'box_' + Date.now();
                const newBox: Box = {
                  id: newId,
                  spriteId: `sprite_box_${boxes.length}`,
                  targetPng: `public/sprites/exported_sprites.png`,
                  colIndex: boxes.length,
                  x: Math.floor(videoWidth / 2) - 16,
                  y: Math.floor(videoHeight / 2) - 16,
                  w: 32,
                  h: 32,
                };
                setBoxes((prev) => [...prev, newBox]);
                setActiveBoxId(newId);
              }
            }}
          >
            + ADD BOX
          </button>
          <button
            className="e-btn"
            style={{ borderColor: '#79efa4', color: '#79efa4', fontWeight: 'bold' }}
            onClick={handleExport}
          >
            EXPORT ATLAS [F8]
          </button>
        </div>
      )}

      {/* Server File Browser Modal */}
      {fileBrowserOpen && (
        <div className="vetool-modal-backdrop" onClick={() => setFileBrowserOpen(false)}>
          <div className="vetool-modal" onClick={(e) => e.stopPropagation()}>
            <div className="vetool-modal-header">
              <span>Select Server Asset</span>
              <button className="e-btn" onClick={() => setFileBrowserOpen(false)}>
                Close
              </button>
            </div>
            <div className="vetool-modal-body">
              <p style={{ color: '#888', marginBottom: '8px' }}>
                Folder: <span className="ui-text-accent-cyan">{currentServerDir}</span>
              </p>
              {currentServerDir !== 'public/assets' && (
                <div
                  className="vetool-file-list-item ui-text-accent-yellow"
                  onClick={() => {
                    const parts = currentServerDir.split('/');
                    parts.pop();
                    loadServerFiles(parts.join('/'));
                  }}
                >
                  [.. Parent Directory]
                </div>
              )}
              {serverFiles.map((file) => (
                <div
                  key={file.name}
                  className={`vetool-file-list-item ${file.isDir ? 'ui-text-accent-yellow' : ''}`}
                  onClick={() => {
                    if (file.isDir) {
                      loadServerFiles(`${currentServerDir}/${file.name}`);
                    } else {
                      handleLoadServerAsset(file.name);
                    }
                  }}
                >
                  {file.isDir ? `[Dir] ${file.name}` : file.name}
                </div>
              ))}
              {serverFiles.length === 0 && (
                <div className="ui-text-dim text-center py-10">
                  No MP4 files found in this folder.
                </div>
              )}
            </div>
          </div>
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
