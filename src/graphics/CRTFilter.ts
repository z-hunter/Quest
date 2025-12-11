export interface CRTSettings {
    curvature: number;      // 0.0 to 1.0 (Approx, was using hardcoded math)
    scanlineCount: number;  // 300 - 1000?
    scanlineIntensity: number; // 0.0 to 1.0
    aberration: number;     // 0.0 to 10.0 (pixels?)
    vignette: number;       // 0.0 to 1.0
    phosphor: number;       // 0.0 to 1.0 (Surface noise/lift)
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

        this.init();
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
            varying vec2 v_texCoord;

            // Curvature
            vec2 curve(vec2 uv) {
                // If curvature is 0, return uv
                if (u_curvature <= 0.0) return uv; // Small optimization/bypass
                
                // Original logic:
                // uv.x *= 1.0 + pow((abs(uv.y) / 5.0), 2.0);
                
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
                
                // Clip
                if (uv_t.x < 0.0 || uv_t.x > 1.0 || uv_t.y < 0.0 || uv_t.y > 1.0) {
                   return vec2(-1.0, -1.0);
                }
                return uv_t;
            }

            void main() {
                vec2 uv = v_texCoord;
                vec2 curvedUV = curve(uv);

                // Screen Surface / Bezel (Gray Background)
                if (curvedUV.x < 0.0) {
                     // Smooth Matte Plastic Look
                     // Calculate distance from center for a subtle radial gradient (lighting)
                     vec2 center = v_texCoord - 0.5;
                     float dist = length(center);
                     
                     // Base dark grey
                     float grey = 0.1;
                     // Darken edges slightly (vignette on the frame itself)
                     grey -= dist * 0.05;
                     
                     gl_FragColor = vec4(grey, grey, grey, 1.0);
                     return;
                }

                // Chromatic Aberration
                // Use u_aberration as offset in pixels relative to resolution?
                // Or just normalized. 0.001 was hardcoded.
                float offset = u_aberration * 0.005; 
                
                float r = texture2D(u_image, curvedUV + vec2(offset, 0.0)).r;
                float g = texture2D(u_image, curvedUV).g;
                float b = texture2D(u_image, curvedUV + vec2(-offset, 0.0)).b;
                vec3 color = vec3(r, g, b);

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
                // Original: pow(vignette * 15.0, 0.25);
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

    render(sourceCanvas: HTMLCanvasElement, settings: CRTSettings): void {
        if (!this.gl || !this.program || !this.buffer || !this.texture) return;

        const gl = this.gl;

        gl.viewport(0, 0, this.canvas.width, this.canvas.height);
        gl.clearColor(0, 0, 0, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);

        gl.useProgram(this.program);

        // Bind attribute/uniforms
        gl.enableVertexAttribArray(this.positionLocation);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
        gl.vertexAttribPointer(this.positionLocation, 2, gl.FLOAT, false, 16, 0);

        gl.enableVertexAttribArray(this.texCoordLocation);
        gl.vertexAttribPointer(this.texCoordLocation, 2, gl.FLOAT, false, 16, 8);

        if (this.resolutionLocation) {
            gl.uniform2f(this.resolutionLocation, this.canvas.width, this.canvas.height);
        }
        if (this.timeLocation) {
            gl.uniform1f(this.timeLocation, performance.now() / 1000);
        }

        // Pass Settings
        if (this.scanlineCountLocation) gl.uniform1f(this.scanlineCountLocation, settings.scanlineCount);
        if (this.curvatureLocation) gl.uniform1f(this.curvatureLocation, settings.curvature);
        if (this.scanlineIntensityLocation) {
            gl.uniform1f(this.scanlineIntensityLocation, settings.scanlineIntensity);
        }
        if (this.aberrationLocation) {
            gl.uniform1f(this.aberrationLocation, settings.aberration);
        }
        if (this.vignetteLocation) {
            gl.uniform1f(this.vignetteLocation, settings.vignette);
        }
        if (this.phosphorLocation) {
            gl.uniform1f(this.phosphorLocation, settings.phosphor || 0.0);
        }

        // Upload texture
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.texture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, sourceCanvas);
        gl.uniform1i(gl.getUniformLocation(this.program, "u_image"), 0);

        // Draw
        gl.drawArrays(gl.TRIANGLES, 0, 6);
    }
}
