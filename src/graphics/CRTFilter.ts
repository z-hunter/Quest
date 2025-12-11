export interface CRTSettings {
    curvature: number;      // 0.0 to 1.0 (Approx, was using hardcoded math)
    scanlineCount: number;  // 300 - 1000?
    scanlineIntensity: number; // 0.0 to 1.0
    aberration: number;     // 0.0 to 10.0 (pixels?)
    vignette: number;       // 0.0 to 1.0
    phosphor: number;       // 0.0 to 1.0 (Surface noise/lift)
    bezelGlow: boolean;     // Optimization toggle
    bloom: number;          // 0.0 to 1.0 (Halation intensity)
}

export class CRTFilter {
    canvas: HTMLCanvasElement;
    gl: WebGLRenderingContext | null;
    program: WebGLProgram | null;
    texture: WebGLTexture | null;
    buffer: WebGLBuffer | null;
    positionLocation: number;
    texCoordLocation: number;
    resolutionLocation: WebGLUniformLocation | null;
    timeLocation: WebGLUniformLocation | null;
    scanlineCountLocation: WebGLUniformLocation | null;
    curvatureLocation: WebGLUniformLocation | null;
    aberrationLocation: WebGLUniformLocation | null;
    vignetteLocation: WebGLUniformLocation | null;
    scanlineIntensityLocation: WebGLUniformLocation | null;
    phosphorLocation: WebGLUniformLocation | null;
    bezelGlowLocation: WebGLUniformLocation | null;
    bloomLocation: WebGLUniformLocation | null;

    constructor(canvas: HTMLCanvasElement) {
        this.canvas = canvas;
        this.gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl') as WebGLRenderingContext;

        if (!this.gl) {
            console.error("WebGL not supported");
            this.program = null;
            this.texture = null;
            this.buffer = null;
            this.positionLocation = 0;
            this.texCoordLocation = 0;
            this.resolutionLocation = null;
            this.timeLocation = null;
            this.scanlineCountLocation = null;
            this.curvatureLocation = null;
            this.aberrationLocation = null;
            this.vignetteLocation = null;
            this.scanlineIntensityLocation = null;
            this.phosphorLocation = null;
            this.bezelGlowLocation = null;
            this.bloomLocation = null;
            return;
        }

        this.program = null;
        this.texture = null;
        this.buffer = null;
        this.positionLocation = 0;
        this.texCoordLocation = 0;
        this.resolutionLocation = null;
        this.timeLocation = null;
        this.scanlineCountLocation = null;
        this.curvatureLocation = null;
        this.aberrationLocation = null;
        this.vignetteLocation = null;
        this.scanlineIntensityLocation = null;
        this.phosphorLocation = null;
        this.bezelGlowLocation = null;
        this.bloomLocation = null;

        this.init();
    }

    createShader(gl: WebGLRenderingContext, type: number, source: string): WebGLShader | null {
        const shader = gl.createShader(type);
        if (!shader) return null;
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            console.error(gl.getShaderInfoLog(shader));
            gl.deleteShader(shader);
            return null;
        }
        return shader;
    }

    createProgram(gl: WebGLRenderingContext, vsSource: string, fsSource: string): WebGLProgram | null {
        const vs = this.createShader(gl, gl.VERTEX_SHADER, vsSource);
        const fs = this.createShader(gl, gl.FRAGMENT_SHADER, fsSource);
        if (!vs || !fs) return null;

        const program = gl.createProgram();
        if (!program) return null;

        gl.attachShader(program, vs);
        gl.attachShader(program, fs);
        gl.linkProgram(program);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
            console.error(gl.getProgramInfoLog(program));
            return null;
        }
        return program;
    }

    init(): void {
        if (!this.gl) return;
        const gl = this.gl;

        // Vertex Shader
        const vsSource = `
            attribute vec2 a_position;
            attribute vec2 a_texCoord;
            varying vec2 v_texCoord;
            void main() {
                gl_Position = vec4(a_position, 0.0, 1.0);
                v_texCoord = a_texCoord;
            }
        `;

        // Fragment Shader (The CRT Magic)
        const fsSource = `
            precision mediump float;
            uniform sampler2D u_image;
            uniform vec2 u_resolution;
            uniform float u_time;
            uniform float u_scanlineCount;
            uniform float u_curvature;
            uniform float u_aberration;
            uniform float u_vignette;
            uniform float u_scanlineIntensity;
            uniform float u_phosphor;
            uniform float u_bezelGlow;
            uniform float u_bloom;
            varying vec2 v_texCoord;

            // Curvature
            vec2 curve(vec2 uv) {
                // If curvature is 0, return uv
                if (u_curvature <= 0.0) return uv; // Small optimization/bypass
                
                // Parameterized:
                // Use u_curvature to scale the distortion
                // u_curvature = 1.0 is "normal" strong distortion.
                
                vec2 center = uv - 0.5;
                float r2 = dot(center, center);
                // Simple pincushion: uv = center * (1.0 + k * r2) + 0.5
                
                // Using the previous "fancy" math but parameterized:
                vec2 uv_t = (uv - 0.5) * 2.0;
                uv_t *= 1.0 + (u_curvature * 0.1); // Zoom out slightly to fit
                
                uv_t.x *= 1.0 + pow((abs(uv_t.y) / 5.0), 2.0) * u_curvature * 5.0;
                uv_t.y *= 1.0 + pow((abs(uv_t.x) / 4.0), 2.0) * u_curvature * 5.0;
                
                uv_t  = (uv_t / 2.0) + 0.5;
                
                // Clip logic moved to main() so we can use "overscan" UVs for glow
                return uv_t;
            }

             // Helper to prevent texture wrapping/clamping artifacts
             vec3 sampleScreen(vec2 uv) {
                 vec3 color = texture2D(u_image, uv).rgb;
                 float inBounds = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
                 return color * inBounds;
             }

             void main() {
                 vec2 uv = v_texCoord;
                 vec2 curvedUV = curve(uv);

                 // Check invalid/bezel area explicitely
                 bool isBezel = (curvedUV.x < 0.0 || curvedUV.x > 1.0 || curvedUV.y < 0.0 || curvedUV.y > 1.0);

                 // Screen Surface / Bezel (Gray Background)
                 if (isBezel) {
                      // Smooth Matte Plastic Look
                      vec2 center = v_texCoord - 0.5;
                      float dist = length(center);
                      
                      float grey = 0.1;
                      grey -= dist * 0.05;
                      
                      vec3 finalColor = vec3(grey);

                      // BEZEL GLOW (Single Pass - 16 Tap Spiral Blur)
                      // No FBO. No Multi-Texture. We sample u_image directly.
                      if (u_bezelGlow > 0.5) {
                           // Spiral Blur Logic
                           // Radius: 0.08 (Was 0.05) - Wider blur to support longer reach
                           float maxRadius = 0.08; 
                           
                           vec3 glow = vec3(0.0);
                           float totalWeight = 0.0;
                           
                           // Dither to hide loop artifacts
                           vec3 magic = vec3(0.06711056, 0.00583715, 52.9829189);
                           float dither = fract(magic.z * fract(dot(v_texCoord * u_resolution, magic.xy)));
                           float startAngle = dither * 6.2831853;
                           
                           // 16 Samples
                           for (int i = 0; i < 16; i++) {
                                float r = sqrt(float(i) / 16.0) * maxRadius;
                                float theta = startAngle + float(i) * 2.39996323; // Golden Angle
                                
                                vec2 offset = vec2(cos(theta), sin(theta)) * r;
                                
                                // CLAMP to Valid Screen Area to prevent infinite edge stretching
                                // We offset from the CURRENT pixel (the bezel pixel) back towards the screen.
                                // Actually, we just need to sample the Screen.
                                // Since 'curvedUV' is outside 0..1, we can't use it directly as a base unless we clamp.
                                
                                // Better Approach: We want to sample the NEAREST edge of the screen.
                                // The 'curvedUV' tells us where we are relative to the screen.
                                // Let's clamp 'curvedUV' to the edge (0.01-0.99) to find the "source" pixel,
                                // THEN apply the blur offset.
                                vec2 sourceUV = clamp(curvedUV, 0.01, 0.99);
                                vec2 sampleUV = clamp(sourceUV + offset, 0.01, 0.99);
                                
                                // MASK Edges (Simulate Black Borders on the internal screen)
                                // If the sample works its way to the outer 1% of the screen, we consider it black.
                                // This prevents the "Refraction" of the edge sprite while keeping glow visible.
                                vec2 center = sampleUV - 0.5;
                                vec2 d = abs(center) * 2.0;
                                float mask = 1.0 - step(0.98, max(d.x, d.y));
                                
                                glow += texture2D(u_image, sampleUV).rgb * mask;
                                totalWeight += 1.0;
                           }
                           glow /= totalWeight;
                           
                           // Distance Fade relative to the edge
                           vec2 distVec = max(vec2(0.0), max(0.0 - curvedUV, curvedUV - 1.0));
                           float dist = length(distVec);
                           // Fade out over distance (Was 0.15, now 0.25 for greater reach)
                           float fade = 1.0 - smoothstep(0.0, 0.25, dist);
                           
                           // Apply Gamma/Threshold (2.0 gamma for tighter/darker falloff)
                           glow = pow(glow, vec3(2.0));
                           // Boost (Reduced from 4.0 to 2.5 to avoid "mirror" look)
                           finalColor += glow * 2.5 * fade;
                      }

                     gl_FragColor = vec4(finalColor, 1.0);
                     return;
                }

                // Chromatic Aberration
                float offset = u_aberration * 0.005;
                
                float r = texture2D(u_image, curvedUV + vec2(offset, 0.0)).r;
                float g = texture2D(u_image, curvedUV).g;
                float b = texture2D(u_image, curvedUV + vec2(-offset, 0.0)).b;

                vec3 color = vec3(r, g, b);

                // BLOOM / HALATION (Electron Bleed)
                // Adds a soft glow around bright pixels by sampling neighbors.
                if (u_bloom > 0.0) {
                     float bloomRadius = 0.025; // Wide spread for Halo
                     vec3 bloomSum = vec3(0.0);
                     
                     // Simple 12-tap Golden Angle spiral
                     // Reuse the bezel dither logic or just a constant pattern
                     for (int i = 0; i < 12; i++) {
                          // Standard Golden Angle Distribution
                          float theta = float(i) * 2.39996323; 
                          float r = float(i) / 12.0; // Linear distribution
                          r = sqrt(r) * bloomRadius; // Square root for even area coverage
                          
                          vec2 b_offset = vec2(cos(theta), sin(theta)) * r;
                          
                          // Correct aspect ratio distortion (screen is wider than tall)
                          // if we want circular glow, we should scale offset.y by aspect ratio.
                          // But 420x300 is 1.4, so u_resolution.x/y is needed.
                          // Simplified: just stretch Y slightly more or assume square UVs good enough for "glitchy" CRT.
                          b_offset.y *= 0.75; // 300/420 approx correction

                          vec3 sample = texture2D(u_image, curvedUV + b_offset).rgb;
                          // Thresholding: Only bright things glow
                          sample = pow(sample, vec3(2.2)); 
                          bloomSum += sample;
                     }
                     // Average
                     bloomSum /= 12.0;

                     // Apply Bloom Amount
                     vec3 bloomHigh = bloomSum * u_bloom * 5.0; // Boosted intensity for visibility

                     // BLEND MODE: SCREEN (Prevents overexposure/clipping)
                     // Formula: Result = A + B - (A * B)
                     color = color + bloomHigh - (color * bloomHigh);
                }

                // Phosphor Surface Simulation (The "Greyish" look)
                if (u_phosphor > 0.0) {
                     // 1. Lift blacks slightly scaling with phosphor setting
                    color += 0.05 * u_phosphor; 

                    // 2. Add subtle background noise (phosphor grain) - CHAOTIC STATIC
                    // Use u_time to randomize the seed vector every frame
                    float noise = fract(sin(dot(curvedUV, vec2(12.9898, 78.233) + u_time)) * 43758.5453);
                    color += noise * 0.05 * u_phosphor;
                }

                // Scanlines
                // Use cos() to align scanline peak with integer coordinates (avoids center gap)
                // Clamp to 0.0-1.0 to ensure we only darken (gaps), never lighten (negative values)
                float scanline = clamp(cos(curvedUV.y * u_scanlineCount * 3.14159 * 2.0), 0.0, 1.0);
                // Scale scanline by intensity
                color -= scanline * u_scanlineIntensity * 0.1;

                // Vignette
                float vignette = uv.x * uv.y * (1.0 - uv.x) * (1.0 - uv.y);
                // Power controls falloff. Multiply by strength.
                // Parameterized:
                float vig = pow(vignette * (15.0), 0.25); // Base curve
                // Interpolate between 1.0 (no vignette) and vig based on u_vignette
                color *= mix(1.0, vig, u_vignette);

                // Brightness boost (static for now)
                color *= 1.1;

                gl_FragColor = vec4(color, 1.0);
            }
        `;

        this.program = this.createProgram(gl, vsSource, fsSource);
        if (!this.program) return;

        // Look up locations
        this.positionLocation = gl.getAttribLocation(this.program, "a_position");
        this.texCoordLocation = gl.getAttribLocation(this.program, "a_texCoord");
        this.resolutionLocation = gl.getUniformLocation(this.program, "u_resolution");
        this.timeLocation = gl.getUniformLocation(this.program, "u_time");
        this.scanlineCountLocation = gl.getUniformLocation(this.program, "u_scanlineCount");
        this.curvatureLocation = gl.getUniformLocation(this.program, "u_curvature");
        this.aberrationLocation = gl.getUniformLocation(this.program, "u_aberration");
        this.vignetteLocation = gl.getUniformLocation(this.program, "u_vignette");
        this.scanlineIntensityLocation = gl.getUniformLocation(this.program, "u_scanlineIntensity");
        this.phosphorLocation = gl.getUniformLocation(this.program, "u_phosphor");
        this.bezelGlowLocation = gl.getUniformLocation(this.program, "u_bezelGlow");
        this.bloomLocation = gl.getUniformLocation(this.program, "u_bloom");

        // Create buffer for a quad (2 triangles)
        this.buffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
            -1.0, -1.0, 0.0, 1.0,
            1.0, -1.0, 1.0, 1.0,
            -1.0, 1.0, 0.0, 0.0,
            -1.0, 1.0, 0.0, 0.0,
            1.0, -1.0, 1.0, 1.0,
            1.0, 1.0, 1.0, 0.0,
        ]), gl.STATIC_DRAW);

        // Create texture
        this.texture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, this.texture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    }

    render(sourceCanvas: HTMLCanvasElement, settings: CRTSettings): void {
        if (!this.gl || !this.program || !this.buffer || !this.texture) return;
        const gl = this.gl;

        // ---------------------------------------------------------
        // SINGLE PASS CRT (Render to Screen)
        // ---------------------------------------------------------
        gl.viewport(0, 0, this.canvas.width, this.canvas.height);
        gl.clearColor(0, 0, 0, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);

        gl.useProgram(this.program);

        // Bind attributes
        gl.enableVertexAttribArray(this.positionLocation);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
        gl.vertexAttribPointer(this.positionLocation, 2, gl.FLOAT, false, 16, 0);

        gl.enableVertexAttribArray(this.texCoordLocation);
        gl.vertexAttribPointer(this.texCoordLocation, 2, gl.FLOAT, false, 16, 8);

        // Uniforms
        if (this.resolutionLocation) gl.uniform2f(this.resolutionLocation, this.canvas.width, this.canvas.height);
        if (this.timeLocation) gl.uniform1f(this.timeLocation, performance.now() / 1000);

        if (this.scanlineCountLocation) gl.uniform1f(this.scanlineCountLocation, settings.scanlineCount);
        if (this.curvatureLocation) gl.uniform1f(this.curvatureLocation, settings.curvature);
        if (this.scanlineIntensityLocation) gl.uniform1f(this.scanlineIntensityLocation, settings.scanlineIntensity);
        if (this.aberrationLocation) gl.uniform1f(this.aberrationLocation, settings.aberration);
        if (this.vignetteLocation) gl.uniform1f(this.vignetteLocation, settings.vignette);
        if (this.phosphorLocation) gl.uniform1f(this.phosphorLocation, settings.phosphor || 0.0);
        if (this.bezelGlowLocation) gl.uniform1f(this.bezelGlowLocation, settings.bezelGlow ? 1.0 : 0.0);
        if (this.bloomLocation) gl.uniform1f(this.bloomLocation, settings.bloom || 0.0);

        // Texture Unit 0: Main Image (Already bound/uploaded)
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.texture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, sourceCanvas);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.uniform1i(gl.getUniformLocation(this.program, "u_image"), 0);

        // Draw Main
        gl.drawArrays(gl.TRIANGLES, 0, 6);
    }
}
