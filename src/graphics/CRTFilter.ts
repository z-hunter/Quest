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
            return;
        }

        this.program = null;
        this.texture = null;
        this.buffer = null;
        this.positionLocation = 0;
        this.texCoordLocation = 0;
        this.resolutionLocation = null;
        this.timeLocation = null;

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
            varying vec2 v_texCoord;

            // Curvature
            vec2 curve(vec2 uv) {
                uv = (uv - 0.5) * 2.0;
                uv *= 1.1;	
                uv.x *= 1.0 + pow((abs(uv.y) / 5.0), 2.0);
                uv.y *= 1.0 + pow((abs(uv.x) / 4.0), 2.0);
                uv  = (uv / 2.0) + 0.5;
                uv =  uv *0.92 + 0.04;
                return uv;
            }

            void main() {
                vec2 uv = v_texCoord;
                vec2 curvedUV = curve(uv);

                // Black out outside of screen
                if (curvedUV.x < 0.0 || curvedUV.x > 1.0 || curvedUV.y < 0.0 || curvedUV.y > 1.0) {
                    gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
                    return;
                }

                // Chromatic Aberration
                float r = texture2D(u_image, curvedUV + vec2(0.001, 0.0)).r;
                float g = texture2D(u_image, curvedUV).g;
                float b = texture2D(u_image, curvedUV + vec2(-0.001, 0.0)).b;
                vec3 color = vec3(r, g, b);

                // Scanlines
                float scanline = sin(curvedUV.y * u_resolution.y * 2.0 * 3.14159) * 0.04;
                color -= scanline;

                // Vignette
                float vignette = uv.x * uv.y * (1.0 - uv.x) * (1.0 - uv.y);
                vignette = pow(vignette * 15.0, 0.25);
                color *= vignette;

                // Brightness boost
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

    render(sourceCanvas: HTMLCanvasElement): void {
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

        // Upload texture
        gl.bindTexture(gl.TEXTURE_2D, this.texture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, sourceCanvas);

        // Draw
        gl.drawArrays(gl.TRIANGLES, 0, 6);
    }
}
