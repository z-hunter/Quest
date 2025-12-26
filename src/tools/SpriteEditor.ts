
import { Game } from '../core/Game';
import { useEditorStore } from '../store/editorStore';

export interface SpriteData {
    id: string; // Filename without extension
    imageFile: string;
    x: number;
    y: number;
    width: number;
    height: number;
    frames: number;
}

export class SpriteEditor {
    game: Game;

    get active(): boolean {
        return useEditorStore.getState().spriteEditorEnabled;
    }

    set active(value: boolean) {
        useEditorStore.getState().toggleSpriteEditor(value);
    }

    // Data State
    sprite: SpriteData;
    sourceImage: HTMLImageElement | null = null;

    // Rendering State
    checkerboardPattern: CanvasPattern | null = null;

    // Preview Settings
    previewSpeed: number = 200; // ms
    isPlaying: boolean = true;
    previewBg: 'black' | 'checker' | 'pink' = 'black';
    showRulers: boolean = false;

    constructor(game: Game) {
        this.game = game;

        // Default Sprite
        this.sprite = {
            id: 'new_sprite',
            imageFile: '',
            x: 0,
            y: 0,
            width: 32,
            height: 32,
            frames: 1
        };

        // Bind Global Keys
        // Bind Global Keys (Capture Phase on Document)
        // Using bind to ensure 'this' context and consistent reference
        this.boundKeyHandler = this.handleKey.bind(this);
        document.addEventListener('keydown', this.boundKeyHandler, true);
    }

    private boundKeyHandler: (e: KeyboardEvent) => void;

    toggle(force?: boolean): void {
        const newState = force !== undefined ? force : !this.active;
        this.active = newState;

        const parserInput = document.getElementById('parser-input') as HTMLInputElement;

        if (this.active) {
            console.log('[SpriteEditor] Activated');

            // Disable Parser Input to prevent game commands and focus stealing
            if (parserInput) {
                parserInput.blur();
                parserInput.disabled = true;
            }

            // Ensure checkerboard pattern is ready
            if (!this.checkerboardPattern) {
                this.createCheckerboard();
            }

            // Hide Scene Editor if open
            if (this.game.editor && this.game.editor.enabled) {
                this.game.editor.toggle();
            }

            this.updateUI();

            // Force immediate render after UI is mounted/visible (next tick)
            setTimeout(() => {
                this.updatePreviewCanvas();
            }, 50);
        } else {
            console.log('[SpriteEditor] Deactivated');
            // Re-enable Parser
            if (parserInput) {
                parserInput.disabled = false;
                // Optional: focus it back? Maybe not if we just closed editor.
            }
        }
    }

    // Removed dead initUI code (DOM bindings handled by React now)

    handleKey(e: KeyboardEvent): void {
        // HMR/Reload Protection:
        // If this editor belongs to an old Game instance (zombie), kill the listener.
        if (this.game !== Game.instance) {
            console.warn('[SpriteEditor] Detected Zombie Instance - Removing Listener');
            document.removeEventListener('keydown', this.boundKeyHandler, true);
            return;
        }

        // If not active, let it propagate (e.g. to SceneEditor)
        if (!this.active) return;

        const isInputFocused = document.activeElement instanceof HTMLInputElement;

        // AGGRESSIVE HOTKEY HANDLING
        // We check keys first and return immediately if handled, bypassing input focus checks for specific keys.

        if (e.ctrlKey && e.key.toLowerCase() === 'o') {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            console.log('[SpriteEditor] Ctrl+O Handled');
            this.promptLoadImage();
            return;
        }

        if (e.ctrlKey && e.key.toLowerCase() === 's') {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            this.saveSprite();
            return;
        }

        let handled = false;

        if (e.key === 'F1') { this.switchToSceneEditor(); handled = true; }
        else if (e.key === 'F2') {
            if (e.shiftKey) {
                this.saveSprite(true); // Shift+F2 = Save As
            } else {
                this.saveSprite(false); // F2 = Smart Save
            }
            handled = true;
        }
        else if (e.key === 'F3') { this.loadSprite(); handled = true; }
        else if (e.key === 'F4') { this.newSprite(); handled = true; }
        else if (e.key === 'F5') { this.toggle(false); handled = true; }

        if (handled) {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            return;
        }

        // Only now do we respect input focus for other keys
        if (isInputFocused) return;
    }

    switchToSceneEditor(): void {
        this.toggle(false);
        if (this.game.editor && !this.game.editor.enabled) this.game.editor.toggle();
    }

    updateUI(): void {
        useEditorStore.getState().incrementSpriteVersion();
        this.updatePreview();
    }

    // Animation State
    public currentFrame: number = 0;
    private lastFrameTime: number = 0;
    private animationInterval: number | null = null;

    startPreviewLoop(): void {
        if (this.animationInterval) return; // Already running

        const loop = (timestamp: number) => {
            if (!this.active) {
                this.animationInterval = null;
                return;
            }

            // Always request next frame to keep loop alive
            this.animationInterval = requestAnimationFrame(loop);

            if (this.isPlaying) {
                // Update Frame based on variable speed
                if (timestamp - this.lastFrameTime > this.previewSpeed) {
                    this.currentFrame = (this.currentFrame + 1) % (this.sprite.frames || 1);
                    this.lastFrameTime = timestamp;
                    this.updatePreviewCanvas();
                    // Sync UI slider if needed? Usually controlled components update from Model.
                    // We might need to force UI update if Slider needs to move automatically.
                    // But for performance, maybe just let Canvas update.
                    // If user wants to see Slider move, we need to trigger React update.
                    // Let's rely on Canvas for playback visualization, Slider for manual control.
                    useEditorStore.getState().incrementSpriteVersion();
                }
            }
        };

        this.animationInterval = requestAnimationFrame(loop);
    }

    togglePlay(playing?: boolean): void {
        this.isPlaying = playing !== undefined ? playing : !this.isPlaying;
        if (this.isPlaying) {
            this.startPreviewLoop();
        }
        // If paused, we don't kill the loop necessarily, but logic inside stops updating.
        this.updateUI();
    }

    setFrame(frame: number): void {
        this.currentFrame = Math.max(0, Math.min(frame, (this.sprite.frames || 1) - 1));
        this.updatePreviewCanvas();
        this.updateUI();
    }

    stopPreviewLoop(): void {
        if (this.animationInterval) {
            cancelAnimationFrame(this.animationInterval);
            this.animationInterval = null;
        }
    }

    updatePreview(): void {
        // Called when UI changes (e.g. user types new W/H)
        // We just ensure the cycle continues or resets if frames changed
        // Real rendering is done in loop.

        // Ensure loop is running if active
        if (this.active && !this.animationInterval) {
            this.startPreviewLoop();
        }

        // Immediate redraw for responsiveness
        this.updatePreviewCanvas();
    }

    updatePreviewCanvas(): void {
        const canvas = document.getElementById('se-preview-canvas') as HTMLCanvasElement;
        if (canvas) {
            // Force 250x250 to ensure buffer matches visual size
            if (canvas.width !== 250) canvas.width = 250;
            if (canvas.height !== 250) canvas.height = 250;

            const ctx = canvas.getContext('2d');
            if (!ctx) return;

            // Clear
            ctx.clearRect(0, 0, canvas.width, canvas.height);

            // Draw Background
            if (this.previewBg === 'black') {
                ctx.fillStyle = '#000000';
                ctx.fillRect(0, 0, canvas.width, canvas.height);
            } else if (this.previewBg === 'pink') {
                ctx.fillStyle = '#ff00ff';
                ctx.fillRect(0, 0, canvas.width, canvas.height);
            } else if (this.previewBg === 'checker') {
                if (!this.checkerboardPattern) this.createCheckerboard();
                if (this.checkerboardPattern) {
                    ctx.fillStyle = this.checkerboardPattern;
                    ctx.fillRect(0, 0, canvas.width, canvas.height);
                }
            }

            // Draw Rulers (Behind Sprite)
            if (this.showRulers) {
                const cx = canvas.width / 2;
                const cy = canvas.height / 2;
                ctx.strokeStyle = '#00ffff'; // Cyan
                ctx.lineWidth = 1;

                ctx.beginPath();
                ctx.moveTo(cx, 0);
                ctx.lineTo(cx, canvas.height);
                ctx.stroke();

                ctx.beginPath();
                ctx.moveTo(0, cy);
                ctx.lineTo(canvas.width, cy);
                ctx.stroke();
            }

            if (this.sourceImage && this.sourceImage.src) {

                // Use sprite dimensions
                if (this.sprite.width <= 0 || this.sprite.height <= 0) return;

                // Determine scale to fit in current canvas container (200x200) WITH PADDING
                const padding = 10;
                const availW = canvas.width - (padding * 2);
                const availH = canvas.height - (padding * 2);

                // Calculate Scale needed for Width and Height separately
                const scaleW = availW / this.sprite.width;
                const scaleH = availH / this.sprite.height;

                // Use the SMALLER scale to ensure entire sprite fits (Letterboxing)
                let scale = Math.min(scaleW, scaleH);

                // Center the sprite in the canvas (250x250)
                const drawW = this.sprite.width * scale;
                const drawH = this.sprite.height * scale;

                const destX = (canvas.width - drawW) / 2;
                const destY = (canvas.height - drawH) / 2;

                // Source Rect (Current Frame)
                const sx = this.sprite.x;
                const sy = this.sprite.y + (this.currentFrame * this.sprite.height);
                const sw = this.sprite.width;
                const sh = this.sprite.height;

                // Disable smoothing for pixel art
                ctx.imageSmoothingEnabled = false;

                try {
                    ctx.drawImage(this.sourceImage, sx, sy, sw, sh, destX, destY, drawW, drawH);
                } catch (e) {
                    // Image might not be fully loaded or broken coords
                }

                canvas.style.display = 'block';

            } else {
                canvas.style.display = 'none';
            }
        }
    }

    promptLoadImage(): void {
        this.game.openFileBrowser('load', 'public/assets', (file) => {
            // FileBrowser returns just the filename (e.g. 'hero.png')
            // We need to construct the path relative to project root or public
            // If the file string doesn't include the dir, add it.
            // Assuming FileBrowser returns simple filename from the list.

            // Construct full path
            // If dir is 'public/assets', we want 'public/assets/hero.png' 
            // (which loadImage will then convert to '/assets/hero.png')

            const fullPath = `public/assets/${file}`;
            this.loadImage(fullPath);
        }, '.png');
    }

    loadImage(path: string, keepDimensions: boolean = false): void {
        // Convert local path to relative.
        // The FileBrowser returns "public/assets/foo.png".
        // In Vite, "public/" is the root. So we should request "/assets/foo.png".

        // Strip 'public/' from start if present
        let src = path;
        if (src.startsWith('public/')) {
            src = '/' + src.substring(7); // Remove 'public/'
        }

        // If it starts with 'assets', ensure it has a Slash
        if (!src.startsWith('/') && !src.startsWith('http')) {
            src = '/' + src;
        }

        this.sprite.imageFile = path; // Keep original path in data
        this.sourceImage = new Image();
        this.sourceImage.src = src;
        this.sourceImage.onload = () => {
            console.log(`[SpriteEditor] Loaded image: ${src} (Original: ${path})`);

            // Auto-resize sprite logic requested by user
            // Unless we are loading an existing sprite (keepDimensions = true)
            // or if we are editing an existing sprite, we generally keep W/H unless user loads NEW image manually.

            // Logic:
            // If keepDimensions is TRUE, do not touch width/height.
            // If keepDimensions is FALSE:
            //    If ID is 'new_sprite', we overwrite W/H (First load).
            //    If User manually loaded an image (via button), we might want to reset W/H or keep?
            //    Let's assume if manual load (keepDimensions false), we overwrite if it's 'new_sprite' OR maybe always?
            //    Actually, if user replaces image, they probably want full size initially if frame count is 1.

            if (!keepDimensions) {
                // Only overwrite if it looks like a "new" operation or explicit user load
                // For now, let's stick to the previous logic but respect the flag.
                if (this.sprite.id === 'new_sprite' || this.sprite.frames === 1) {
                    this.sourceImage && (this.sprite.width = this.sourceImage.width);
                    this.sourceImage && (this.sprite.height = this.sourceImage.height);
                }

                // Update ID to match filename (without extension)
                // e.g. /assets/hero.png -> hero
                const filename = src.split('/').pop() || 'sprite';
                const id = filename.split('.')[0];
                this.sprite.id = id;
            }

            this.updateUI();
        };
        this.sourceImage.onerror = (e) => {
            console.error(`[SpriteEditor] Failed to load image: ${src}`, e);
        };
    }

    saveSprite(forceSaveAs: boolean = false): void {
        // Validation:
        // If forceSaveAs is FALSE and I have a valid ID, save directly.
        // Allow backslashes in ID now
        const id = this.sprite.id.trim();
        const isValidId = id && id !== 'new_sprite' && !id.includes('.');

        if (!forceSaveAs && isValidId) {
            // Smart Save
            // Convert ID to filename path: chars\hero -> chars/hero.json
            const filename = `${id.replace(/\\/g, '/')}.json`;
            this.doSave(filename);
            return;
        }

        // Save As / Fallback
        this.game.openFileBrowser('save', 'public/sprites', (file) => {
            // Derive ID from path: chars/hero.json -> chars\hero
            const name = file.split(/[\\/]/).pop() || 'sprite.json';
            // Wait, file from browser might be "chars/hero.json" if we navigated. 
            // We need to respect the full relative path returned.

            // Check if file contains separate path parts
            // FileBrowser returns relative path from 'public/sprites' if we are deeper?
            // Actually FileBrowser logic constructs relative path from root of search.

            // Let's assume 'file' is the relative path we want to save to.
            this.doSave(file);

            // Update ID to match the save path
            const newId = file.replace('.json', '').replace(/\//g, '\\');
            this.sprite.id = newId;
            this.updateUI();
        });
    }

    async doSave(filename: string): Promise<void> {
        // Ensure filename has .json
        if (!filename.toLowerCase().endsWith('.json')) filename += '.json';

        // Normalize path separators
        const normalizedFilename = filename.replace(/\\/g, '/');

        const filePath = `public/sprites/${normalizedFilename}`;

        const data = JSON.stringify(this.sprite, null, 2);

        try {
            const response = await fetch('/api/save', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path: filePath, content: data })
            });

            if (response.ok) {
                console.log(`[SpriteEditor] Saved to server: ${filePath}`);
                // Use Toast Message instead of Alert
                this.game.showMessage(`Sprite saved as ${normalizedFilename}`);
            } else {
                throw new Error(await response.text());
            }
        } catch (e) {
            console.error('[SpriteEditor] Failed to save sprite:', e);
            this.game.showMessage(`Error saving sprite: ${e}`);
        }
    }

    loadSprite(): void {
        this.game.openFileBrowser('load', 'public/sprites', (file) => {
            // Construct path. FileBrowser returns relative path like "sub/file.json"
            const dir = 'public/sprites';
            const path = `/${dir.replace('public/', '')}/${file}`;

            fetch(path).then(res => {
                if (!res.ok) throw new Error("Fetch failed");
                return res.json();
            }).then(data => {
                this.sprite = data;

                // Sync ID with filename path (sub/file -> sub\file)
                const id = file.replace('.json', '').replace(/\//g, '\\');
                this.sprite.id = id;

                if (this.sprite.imageFile) {
                    // PASS TRUE to preserve dimensions from JSON
                    this.loadImage(this.sprite.imageFile, true);
                }
                this.updateUI();
            }).catch(err => {
                console.error("Failed to load sprite json", err);
                alert("Failed to load sprite. Ensure it is accessible via URL.");
            });
        });
    }

    newSprite(): void {
        this.sprite = {
            id: 'new_sprite',
            imageFile: '',
            x: 0,
            y: 0,
            width: 32,
            height: 32,
            frames: 1
        };
        this.sourceImage = null;
        this.updateUI();
    }

    createCheckerboard(): void {
        const canvas = document.createElement('canvas');
        canvas.width = 20;
        canvas.height = 20;
        const ctx = canvas.getContext('2d');
        if (ctx) {
            ctx.fillStyle = '#ccc';
            ctx.fillRect(0, 0, 20, 20);
            ctx.fillStyle = '#999';
            ctx.fillRect(0, 0, 10, 10);
            ctx.fillRect(10, 10, 10, 10);
            this.checkerboardPattern = this.game.ctx?.createPattern(canvas, 'repeat') || null;
        }
    }

    render(ctx: CanvasRenderingContext2D): void {
        if (!this.active) return;

        ctx.save();

        // Ensure opacity
        ctx.globalAlpha = 1.0;

        // Ensure checkerboard pattern exists (fallback if init failed)
        if (!this.checkerboardPattern) {
            this.createCheckerboard();
        }

        // Fill background (Dark Grey usually, but checkerboard handles it)
        if (this.checkerboardPattern) {
            ctx.fillStyle = this.checkerboardPattern;
            ctx.fillRect(0, 0, this.game.canvas.width, this.game.canvas.height);
        } else {
            ctx.fillStyle = '#808080';
            ctx.fillRect(0, 0, this.game.canvas.width, this.game.canvas.height);
        }

        // Available Workspace Calculation
        // Adjusted to shift more left as per user request to optimize space.
        // Screen width: 840 (scaled) -> 420 game pixels.
        // Panel: 250px -> ~125 game pixels.
        // Center of open area is roughly X=147.
        // Let's shift it further left, say X=100.

        const centerX = 170; // Shifted right slightly to accommodate larger max width
        const centerY = this.game.bufferCanvas.height / 2;

        // Draw Source Image
        if (this.sourceImage && this.sourceImage.complete && this.sourceImage.naturalWidth > 0) {

            // Draw Info Text (Filename and Resolution) - Moved to TOP Header
            // Black Header Bar
            ctx.fillStyle = '#000';
            ctx.fillRect(0, 0, this.game.canvas.width, 15);

            ctx.fillStyle = '#fff';
            ctx.font = '10px monospace';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            const filename = this.sprite.imageFile.split('/').pop() || 'image';
            ctx.fillText(`${filename} (${this.sourceImage.width}x${this.sourceImage.height})`, centerX, 8);

            // Auto-Scale Logic
            // If image is larger than workspace, scale down.
            // Workspace approx 350x280 (roughly available in 420x300 canvas minus UI margin)

            // Adjust max dimensions to keep margins
            // User requested ~10% size increase.
            // Max Height 250 -> 280 (Fits in 300 with header)
            // Max Width 300 -> 330 (Might slightly overlap panel but utilizes space better)

            const maxW = 330;
            const maxH = 280;

            let scale = 1.0;
            // Always calculate fit scale, even if image is smaller, to standardizing behavior? 
            // Or only if larger? 
            // Previous logic: if (width > maxW || height > maxH) scale down.
            // If we want to UPSCALING small images to fill view, we'd remove that condition.
            // But usually sprite editors show 1:1 for small pixel art unless "Zoom" is active.
            // Sticking to "fit to max" logic for now, but with larger max.

            if (this.sourceImage.width > maxW || this.sourceImage.height > maxH) {
                const scaleW = maxW / this.sourceImage.width;
                const scaleH = maxH / this.sourceImage.height;
                scale = Math.min(scaleW, scaleH);
            }

            // Allow user to zoom? For now strictly auto-fit or 1:1 if fits.
            // If scale is applied, everything must be scaled.

            // Draw centered in workspace
            // Workspace Center X is purely the canvas center for now, maybe offset by panel?
            // Panel is roughly 1/3 of screen on right. 
            // Canvas Width = 420. Panel width ~120?
            // Center of "Canvas minus Panel" is approx 150.

            const drawW = this.sourceImage.width * scale;
            const drawH = this.sourceImage.height * scale;

            const imgX = Math.floor(centerX - (drawW / 2));
            const imgY = Math.floor(centerY - (drawH / 2));

            ctx.drawImage(this.sourceImage, imgX, imgY, drawW, drawH);

            // Draw Frame Rects (Scaled)
            ctx.strokeStyle = '#00ff00';
            ctx.lineWidth = 1;

            // Frame visualization needs to respect scale
            for (let i = 0; i < this.sprite.frames; i++) {
                // Determine frame position relative to image
                // Scale applies to the position within the image

                // Effective Position on Canvas = ImagePos + (FrameLocalPos * Scale)
                const sx = imgX + (this.sprite.x * scale);
                const sy = imgY + ((this.sprite.y + (i * this.sprite.height)) * scale);

                const sw = this.sprite.width * scale;
                const sh = this.sprite.height * scale;

                ctx.strokeRect(sx, sy, sw, sh);

                // Frame Number
                ctx.fillStyle = '#00ff00';
                ctx.font = '10px monospace';
                ctx.textAlign = 'left';
                ctx.textBaseline = 'alphabetic';
                ctx.fillText(`${i}`, sx + 2, sy + 12);
            }
        }

        ctx.restore();
    }
}
