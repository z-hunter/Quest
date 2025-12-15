
import { Game } from '../core/Game';

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
    active: boolean = false;

    // Data State
    sprite: SpriteData;
    sourceImage: HTMLImageElement | null = null;

    // Rendering State
    checkerboardPattern: CanvasPattern | null = null;

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
        window.addEventListener('keydown', (e) => {
            if (!this.active) return;
            if (e.defaultPrevented) return; // Ignore if handled by Scene/Game editor

            // F5: Close Sprite Editor (Return to Game)
            if (e.key === 'F5') {
                e.preventDefault();
                this.toggle(false);
            }
            // F1: Switch to Scene Editor
            else if (e.key === 'F1') {
                e.preventDefault();
                this.switchToSceneEditor();
            }
            // Ctrl+O: Load Sprite
            else if (e.ctrlKey && e.key.toLowerCase() === 'o') {
                e.preventDefault();
                this.loadSprite();
            }
            // Ctrl+S: Save Sprite
            else if (e.ctrlKey && e.key.toLowerCase() === 's') {
                e.preventDefault();
                this.saveSprite();
            }
        });

    }

    toggle(force?: boolean): void {
        this.active = force !== undefined ? force : !this.active;

        const editorWrapper = document.getElementById('sprite-editor-wrapper');

        // Scene Editor handling handled by SceneEditor itself or Game?
        // If we force active=true, we should force SceneEditor=false.

        if (this.active) {
            console.log('[SpriteEditor] Activated');
            // Hide Scene Editor if open
            if (this.game.editor && this.game.editor.enabled) {
                this.game.editor.toggle();
            }

            // Show Sprite Editor UI
            if (editorWrapper) editorWrapper.classList.remove('hidden');

            // Initialize/Bind UI if needed
            this.initUI();
            this.updateUI();

        } else {
            console.log('[SpriteEditor] Deactivated');
            if (editorWrapper) editorWrapper.classList.add('hidden');
        }
    }

    initUI(): void {
        // Prevent multiple bindings?
        // Actually, simple way: remove old listeners if possible, or check flag.
        // For now, let's just bind 'onclick' which overwrites.

        // Bind F-Key Buttons
        const bindBtn = (id: string, cb: () => void) => {
            const btn = document.getElementById(id);
            if (btn) btn.onclick = cb;
        };

        bindBtn('btn-se-f1', () => this.switchToSceneEditor());
        bindBtn('btn-se-f2', () => this.saveSprite());
        bindBtn('btn-se-f3', () => this.loadSprite());
        bindBtn('btn-se-f4', () => this.newSprite());
        bindBtn('btn-se-f5', () => this.toggle(false)); // Close = Return to Game

        // Bind Load Image Button
        bindBtn('btn-se-load-image', () => this.promptLoadImage());

        // Bind Inputs
        const bindInput = (id: string, field: keyof SpriteData) => {
            const el = document.getElementById(id) as HTMLInputElement;
            if (el) {
                el.oninput = () => {
                    if (field === 'id' || field === 'imageFile') {
                        (this.sprite as any)[field] = el.value;
                    } else {
                        (this.sprite as any)[field] = parseFloat(el.value) || 0;
                    }
                };
            }
        };

        bindInput('se-prop-id', 'id');
        bindInput('se-prop-x', 'x');
        bindInput('se-prop-y', 'y');
        bindInput('se-prop-width', 'width');
        bindInput('se-prop-height', 'height');
        bindInput('se-prop-frames', 'frames');

        // Global Keys - We need a bound handler to remove it later?
        // Ideally yes. For now, let's add it ONCE globally in constructor or use a flag,
        // OR add it here and be careful.
        // Only active when this.active is true.
        if (!(this as any).keysBound) {
            document.addEventListener('keydown', (e) => this.handleKey(e));
            (this as any).keysBound = true;
        }

        this.createCheckerboard();
    }

    handleKey(e: KeyboardEvent): void {
        if (!this.active) return;
        // Ignore if typing in input
        if (document.activeElement instanceof HTMLInputElement) return;

        if (e.key === 'F1') { e.preventDefault(); this.switchToSceneEditor(); }
        if (e.key === 'F2') { e.preventDefault(); this.saveSprite(); }
        if (e.key === 'F3') { e.preventDefault(); this.loadSprite(); }
        if (e.key === 'F4') { e.preventDefault(); this.newSprite(); }
        if (e.key === 'F5') { e.preventDefault(); this.toggle(false); }

        // Ctrl+O
        if (e.ctrlKey && e.key.toLowerCase() === 'o') {
            e.preventDefault();
            this.promptLoadImage();
        }
        // Ctrl+S
        if (e.ctrlKey && e.key.toLowerCase() === 's') {
            e.preventDefault();
            this.saveSprite();
        }
    }

    switchToSceneEditor(): void {
        this.toggle(false);
        if (this.game.editor && !this.game.editor.enabled) this.game.editor.toggle();
    }

    updateUI(): void {
        const setVal = (id: string, val: any) => {
            const el = document.getElementById(id) as HTMLInputElement;
            if (el) el.value = val.toString();
        };

        setVal('se-prop-id', this.sprite.id);
        setVal('se-prop-x', this.sprite.x);
        setVal('se-prop-y', this.sprite.y);
        setVal('se-prop-width', this.sprite.width);
        setVal('se-prop-height', this.sprite.height);
        setVal('se-prop-frames', this.sprite.frames);

        this.updatePreview();
    }

    // Animation State
    private currentFrame: number = 0;
    private lastFrameTime: number = 0;
    private animationInterval: number | null = null;

    startPreviewLoop(): void {
        if (this.animationInterval) return; // Already running

        const loop = (timestamp: number) => {
            if (!this.active) {
                this.animationInterval = null;
                return;
            }

            // Update Frame every 400ms (Reduced speed)
            if (timestamp - this.lastFrameTime > 400) {
                this.currentFrame = (this.currentFrame + 1) % (this.sprite.frames || 1);
                this.lastFrameTime = timestamp;
                this.updatePreviewCanvas();
            }

            this.animationInterval = requestAnimationFrame(loop);
        };

        this.animationInterval = requestAnimationFrame(loop);
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
            // Force 200x200 to ensure buffer matches visual size
            if (canvas.width !== 200) canvas.width = 200;
            if (canvas.height !== 200) canvas.height = 200;

            const ctx = canvas.getContext('2d');
            if (!ctx) return;

            // Clear
            ctx.clearRect(0, 0, canvas.width, canvas.height);

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

                // Center the sprite in the canvas (200x200)
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
        if (this.game.editor && this.game.editor.openFileBrowser) {
            const dir = 'public/assets';
            this.game.editor.openFileBrowser('load', dir, (file) => {
                // FileBrowser returns just the filename (e.g. 'hero.png')
                // We need to construct the path relative to project root or public
                // If the file string doesn't include the dir, add it.
                // Assuming FileBrowser returns simple filename from the list.

                // Construct full path
                // If dir is 'public/assets', we want 'public/assets/hero.png' 
                // (which loadImage will then convert to '/assets/hero.png')

                const fullPath = `${dir}/${file}`;
                this.loadImage(fullPath);
            }, '.png');
        }
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
            }

            this.updateUI();
        };
        this.sourceImage.onerror = (e) => {
            console.error(`[SpriteEditor] Failed to load image: ${src}`, e);
        };
    }

    saveSprite(): void {
        if (this.game.editor && this.game.editor.openFileBrowser) {
            // Use separate folder for sprites
            const dir = 'public/sprites';
            this.game.editor.openFileBrowser('save', dir, (file) => {
                this.doSave(file);
            });
        }
    }

    async doSave(filename: string): Promise<void> {
        // Ensure filename has .json
        if (!filename.toLowerCase().endsWith('.json')) filename += '.json';

        // Remove path if user picked one (FileBrowser returns just name usually)
        const name = filename.split(/[\\/]/).pop() || 'sprite.json';
        const filePath = `public/sprites/${name}`;

        const data = JSON.stringify(this.sprite, null, 2);

        try {
            const response = await fetch('/api/save', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path: filePath, content: data })
            });

            if (response.ok) {
                console.log(`[SpriteEditor] Saved to server: ${filePath}`);
                alert(`Sprite saved: ${name}`);
            } else {
                throw new Error(await response.text());
            }
        } catch (e) {
            console.error('[SpriteEditor] Failed to save sprite:', e);
            alert(`Error saving sprite: ${e}`);
        }
    }

    loadSprite(): void {
        if (this.game.editor && this.game.editor.openFileBrowser) {
            const dir = 'public/sprites';
            this.game.editor.openFileBrowser('load', dir, (file) => {
                // Construct path. FileBrowser returns name.
                // We need to fetch from server relative path
                const path = `/${dir.replace('public/', '')}/${file}`;

                fetch(path).then(res => {
                    if (!res.ok) throw new Error("Fetch failed");
                    return res.json();
                }).then(data => {
                    this.sprite = data;
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
