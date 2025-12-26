export interface SpriteData {
    image: HTMLImageElement;
    json: any;
}

export class AssetLoader {
    private jsonCache: Map<string, any> = new Map();
    private imageCache: Map<string, HTMLImageElement> = new Map();
    private pending: Map<string, Promise<any>> = new Map();

    /**
     * Loads a JSON file with caching and request deduplication.
     */
    async loadJson(path: string): Promise<any> {
        if (this.jsonCache.has(path)) {
            // console.log(`[AssetLoader] JSON Cache Hit: ${path}`);
            return this.jsonCache.get(path);
        }

        if (this.pending.has(path)) {
            // console.log(`[AssetLoader] Joining pending JSON request: ${path}`);
            return this.pending.get(path);
        }

        // console.log(`[AssetLoader] Fetching JSON: ${path}`);
        const promise = fetch(path)
            .then(res => {
                if (!res.ok) throw new Error(`Failed to load JSON: ${res.statusText}`);
                return res.json();
            })
            .then(data => {
                this.jsonCache.set(path, data);
                return data;
            })
            .finally(() => {
                this.pending.delete(path);
            });

        this.pending.set(path, promise);
        return promise;
    }

    /**
     * Loads an Image with caching and request deduplication.
     */
    async loadImage(path: string): Promise<HTMLImageElement> {
        if (this.imageCache.has(path)) {
            // console.log(`[AssetLoader] Image Cache Hit: ${path}`);
            return this.imageCache.get(path)!;
        }

        if (this.pending.has(path)) {
            // console.log(`[AssetLoader] Joining pending Image request: ${path}`);
            return this.pending.get(path);
        }

        // console.log(`[AssetLoader] Loading Image: ${path}`);
        const promise = new Promise<HTMLImageElement>((resolve, reject) => {
            const img = new Image();
            img.src = path;
            img.onload = () => {
                this.imageCache.set(path, img);
                resolve(img);
            };
            img.onerror = (e) => reject(e);
        }).finally(() => {
            this.pending.delete(path);
        });

        this.pending.set(path, promise);
        return promise;
    }

    /**
     * High-level method to load a Sprite by name (not full path).
     * Handles path resolution logic (legacy vs public).
     */
    async loadSprite(spriteName: string): Promise<SpriteData> {
        // Strict JSON support (legacy Entity logic)
        let filename = spriteName;
        if (!filename.toLowerCase().endsWith('.json')) {
            filename += '.json';
        }

        // Path Resolution
        let jsonPath = filename;
        if (jsonPath.startsWith('public/')) {
            jsonPath = '/' + jsonPath.substring(7);
        } else if (!jsonPath.startsWith('/')) {
            jsonPath = '/sprites/' + filename;
        }

        // 1. Load JSON
        const data = await this.loadJson(jsonPath);

        // 2. Resolve Image Path from JSON data
        let imagePath = data.imageFile;
        if (imagePath.startsWith('public/')) {
            imagePath = '/' + imagePath.substring(7);
        } else if (!imagePath.startsWith('/') && !imagePath.startsWith('http')) {
            imagePath = '/assets/' + imagePath;
        }

        // 3. Load Image
        const image = await this.loadImage(imagePath);

        return { json: data, image };
    }
}
