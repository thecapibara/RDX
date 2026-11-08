/**
 * VideoShaderRenderer — WebGL post-processing engine for RDX Cinema Player
 * Implements:
 * 1. Deband: pseudo-random spatial dithering to remove color banding in compressed H.264 streams
 * 2. CAS (Contrast Adaptive Sharpening): AMD-style adaptive unsharp masking without halo artifacts
 */

export type VideoEnhanceMode = "off" | "deband" | "cas" | "max";

const VERTEX_SHADER_SOURCE = `
attribute vec2 a_position;
attribute vec2 a_texCoord;
varying vec2 v_texCoord;

void main() {
    gl_Position = vec4(a_position, 0.0, 1.0);
    // Invert Y coordinate so WebGL matches video frame orientation
    v_texCoord = vec2(a_texCoord.x, 1.0 - a_texCoord.y);
}
`;

const FRAGMENT_SHADER_SOURCE = `
precision mediump float;

uniform sampler2D u_image;
uniform vec2 u_resolution;
uniform int u_mode; // 0: off/passthrough, 1: deband, 2: cas, 3: max (deband + cas)
uniform float u_sharpness; // 0.0 to 1.0
uniform float u_deband_threshold; // e.g. 0.035
uniform float u_time;

varying vec2 v_texCoord;

// Pseudo-random noise generator
float rand(vec2 co) {
    return fract(sin(dot(co, vec2(12.9898, 78.233) + u_time)) * 43758.5453);
}

// Convert RGB to perceived luminance (ITU-R BT.709)
float luma(vec3 color) {
    return dot(color, vec3(0.2126, 0.7152, 0.0722));
}

// 1. Deband algorithm with pseudo-random spatial dithering
vec3 applyDeband(vec2 uv, vec2 dxdy, vec3 origColor) {
    float r = rand(uv);
    float angle = r * 6.2831853;
    float radius = 12.0 + r * 6.0;

    vec2 dir1 = vec2(cos(angle), sin(angle)) * dxdy * radius;
    vec2 dir2 = vec2(-sin(angle), cos(angle)) * dxdy * (radius * 0.75);
    vec2 dir3 = -dir1 * 0.85;
    vec2 dir4 = -dir2 * 0.85;

    vec3 s1 = texture2D(u_image, uv + dir1).rgb;
    vec3 s2 = texture2D(u_image, uv + dir2).rgb;
    vec3 s3 = texture2D(u_image, uv + dir3).rgb;
    vec3 s4 = texture2D(u_image, uv + dir4).rgb;

    vec3 diff1 = abs(s1 - origColor);
    vec3 diff2 = abs(s2 - origColor);
    vec3 diff3 = abs(s3 - origColor);
    vec3 diff4 = abs(s4 - origColor);

    float threshold = u_deband_threshold;
    vec3 avg = origColor;
    float totalWeight = 1.0;

    if (max(max(diff1.r, diff1.g), diff1.b) < threshold) {
        avg += s1;
        totalWeight += 1.0;
    }
    if (max(max(diff2.r, diff2.g), diff2.b) < threshold) {
        avg += s2;
        totalWeight += 1.0;
    }
    if (max(max(diff3.r, diff3.g), diff3.b) < threshold) {
        avg += s3;
        totalWeight += 1.0;
    }
    if (max(max(diff4.r, diff4.g), diff4.b) < threshold) {
        avg += s4;
        totalWeight += 1.0;
    }

    vec3 debanded = avg / totalWeight;

    // Subtle 1/255 dither noise to prevent re-quantization
    float dither = (rand(uv * 1.5) - 0.5) * (1.5 / 255.0);
    return clamp(debanded + vec3(dither), 0.0, 1.0);
}

// 2. AMD Contrast Adaptive Sharpening (CAS)
vec3 applyCAS(vec2 uv, vec2 dxdy, vec3 center) {
    // Sample cardinal neighbors
    vec3 a = texture2D(u_image, uv + vec2(0.0, -dxdy.y)).rgb;
    vec3 b = texture2D(u_image, uv + vec2(-dxdy.x, 0.0)).rgb;
    vec3 c = texture2D(u_image, uv + vec2(dxdy.x, 0.0)).rgb;
    vec3 d = texture2D(u_image, uv + vec2(0.0, dxdy.y)).rgb;

    // Corner samples for robust contrast range
    vec3 e = texture2D(u_image, uv + vec2(-dxdy.x, -dxdy.y)).rgb;
    vec3 f = texture2D(u_image, uv + vec2(dxdy.x, -dxdy.y)).rgb;
    vec3 g = texture2D(u_image, uv + vec2(-dxdy.x, dxdy.y)).rgb;
    vec3 h = texture2D(u_image, uv + vec2(dxdy.x, dxdy.y)).rgb;

    // Min and max of cross neighbors
    vec3 minRGB = min(min(min(a, b), min(c, d)), min(center, min(min(e, f), min(g, h))));
    vec3 maxRGB = max(max(max(a, b), max(c, d)), max(center, max(max(e, f), max(g, h))));

    float minLuma = luma(minRGB);
    float maxLuma = luma(maxRGB);

    // Adaptive sharpening weight (suppresses ringing in high-contrast edges)
    float amp = clamp(min(minLuma, 1.0 - maxLuma) / max(maxLuma, 0.0001), 0.0, 1.0);
    float w = -sqrt(amp) * (u_sharpness * 0.28);

    // Filter output
    vec3 filtered = (center + w * (a + b + c + d)) / (1.0 + 4.0 * w);
    return clamp(filtered, minRGB, maxRGB);
}

void main() {
    vec2 dxdy = 1.0 / u_resolution;
    vec3 color = texture2D(u_image, v_texCoord).rgb;

    if (u_mode == 1) {
        // Deband only
        color = applyDeband(v_texCoord, dxdy, color);
    } else if (u_mode == 2) {
        // CAS only
        color = applyCAS(v_texCoord, dxdy, color);
    } else if (u_mode == 3) {
        // Max: Deband first to clean banding, then CAS to restore edge crispness
        vec3 debanded = applyDeband(v_texCoord, dxdy, color);
        color = applyCAS(v_texCoord, dxdy, debanded);
    }

    gl_FragColor = vec4(color, 1.0);
}
`;

export class VideoShaderRenderer {
  private gl: WebGLRenderingContext | null = null;
  private canvas: HTMLCanvasElement;
  private video: HTMLVideoElement;
  private program: WebGLProgram | null = null;
  private texture: WebGLTexture | null = null;
  private animFrameId: number | null = null;
  private isDestroyed = false;
  private mode: VideoEnhanceMode = "off";
  private sharpness = 0.55;
  private debandThreshold = 0.038;
  private startTime = Date.now();

  // Uniform locations
  private uImageLoc: WebGLUniformLocation | null = null;
  private uResolutionLoc: WebGLUniformLocation | null = null;
  private uModeLoc: WebGLUniformLocation | null = null;
  private uSharpnessLoc: WebGLUniformLocation | null = null;
  private uDebandThresholdLoc: WebGLUniformLocation | null = null;
  private uTimeLoc: WebGLUniformLocation | null = null;

  constructor(canvas: HTMLCanvasElement, video: HTMLVideoElement) {
    this.canvas = canvas;
    this.video = video;
    this.initGL();
  }

  private initGL() {
    const gl =
      this.canvas.getContext("webgl", {
        alpha: false,
        depth: false,
        antialias: false,
        preserveDrawingBuffer: false,
        powerPreference: "high-performance",
      }) ||
      (this.canvas.getContext(
        "experimental-webgl"
      ) as WebGLRenderingContext | null);

    if (!gl) {
      console.warn("RDX VideoShaders: WebGL not supported on this device.");
      return;
    }
    this.gl = gl;

    // Compile Shaders
    const vertShader = this.compileShader(
      gl.VERTEX_SHADER,
      VERTEX_SHADER_SOURCE
    );
    const fragShader = this.compileShader(
      gl.FRAGMENT_SHADER,
      FRAGMENT_SHADER_SOURCE
    );

    if (!vertShader || !fragShader) return;

    const program = gl.createProgram();
    if (!program) return;

    gl.attachShader(program, vertShader);
    gl.attachShader(program, fragShader);
    gl.linkProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error(
        "RDX VideoShaders: Program link error:",
        gl.getProgramInfoLog(program)
      );
      return;
    }

    this.program = program;
    gl.useProgram(program);

    // Quad geometry: 2 triangles covering NDC [-1, 1]
    const posBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([
        -1, -1, 0, 0,
         1, -1, 1, 0,
        -1,  1, 0, 1,
        -1,  1, 0, 1,
         1, -1, 1, 0,
         1,  1, 1, 1,
      ]),
      gl.STATIC_DRAW
    );

    const aPosition = gl.getAttribLocation(program, "a_position");
    const aTexCoord = gl.getAttribLocation(program, "a_texCoord");

    gl.enableVertexAttribArray(aPosition);
    gl.vertexAttribPointer(aPosition, 2, gl.FLOAT, false, 16, 0);

    gl.enableVertexAttribArray(aTexCoord);
    gl.vertexAttribPointer(aTexCoord, 2, gl.FLOAT, false, 16, 8);

    // Texture setup
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    this.texture = texture;

    // Cache Uniform Locations
    this.uImageLoc = gl.getUniformLocation(program, "u_image");
    this.uResolutionLoc = gl.getUniformLocation(program, "u_resolution");
    this.uModeLoc = gl.getUniformLocation(program, "u_mode");
    this.uSharpnessLoc = gl.getUniformLocation(program, "u_sharpness");
    this.uDebandThresholdLoc = gl.getUniformLocation(
      program,
      "u_deband_threshold"
    );
    this.uTimeLoc = gl.getUniformLocation(program, "u_time");
  }

  private compileShader(type: number, source: string): WebGLShader | null {
    if (!this.gl) return null;
    const shader = this.gl.createShader(type);
    if (!shader) return null;
    this.gl.shaderSource(shader, source);
    this.gl.compileShader(shader);

    if (!this.gl.getShaderParameter(shader, this.gl.COMPILE_STATUS)) {
      console.error(
        "RDX VideoShaders: Shader compile error:",
        this.gl.getShaderInfoLog(shader)
      );
      this.gl.deleteShader(shader);
      return null;
    }
    return shader;
  }

  public setMode(mode: VideoEnhanceMode) {
    this.mode = mode;
    if (mode === "off") {
      this.stop();
    } else {
      this.start();
    }
  }

  public setSharpness(val: number) {
    this.sharpness = Math.max(0.0, Math.min(1.0, val));
  }

  public setDebandThreshold(val: number) {
    this.debandThreshold = Math.max(0.01, Math.min(0.1, val));
  }

  public start() {
    if (this.animFrameId !== null || this.mode === "off" || this.isDestroyed) {
      return;
    }
    this.renderLoop();
  }

  public stop() {
    if (this.animFrameId !== null) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
  }

  private renderLoop = () => {
    if (this.isDestroyed || this.mode === "off") {
      this.animFrameId = null;
      return;
    }

    this.renderFrame();
    this.animFrameId = requestAnimationFrame(this.renderLoop);
  };

  private renderFrame() {
    const gl = this.gl;
    if (!gl || !this.program || !this.texture) return;
    if (this.video.readyState < 2) return; // HAVE_CURRENT_DATA

    const videoWidth = this.video.videoWidth || 1920;
    const videoHeight = this.video.videoHeight || 1080;

    // Synchronize internal canvas buffer size
    if (
      this.canvas.width !== videoWidth ||
      this.canvas.height !== videoHeight
    ) {
      this.canvas.width = videoWidth;
      this.canvas.height = videoHeight;
      gl.viewport(0, 0, videoWidth, videoHeight);
    }

    gl.useProgram(this.program);

    // Upload video frame to texture
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    try {
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        this.video
      );
    } catch {
      // Occurs if video element is not ready or transient error
      return;
    }

    // Set uniforms
    gl.uniform1i(this.uImageLoc, 0);
    gl.uniform2f(this.uResolutionLoc, videoWidth, videoHeight);

    let modeInt = 0;
    if (this.mode === "deband") modeInt = 1;
    else if (this.mode === "cas") modeInt = 2;
    else if (this.mode === "max") modeInt = 3;

    gl.uniform1i(this.uModeLoc, modeInt);
    gl.uniform1f(this.uSharpnessLoc, this.sharpness);
    gl.uniform1f(this.uDebandThresholdLoc, this.debandThreshold);
    gl.uniform1f(this.uTimeLoc, (Date.now() - this.startTime) / 1000.0);

    // Draw full-screen quad
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  public destroy() {
    this.isDestroyed = true;
    this.stop();
    if (this.gl && this.program) {
      this.gl.deleteProgram(this.program);
      this.program = null;
    }
    if (this.gl && this.texture) {
      this.gl.deleteTexture(this.texture);
      this.texture = null;
    }
    this.gl = null;
  }
}
