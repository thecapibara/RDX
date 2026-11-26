/**
 * VideoShaderRenderer v6 — Zero-Leak WebGL2/WebGL1 Cinema Post-Processing & RDX Labs Engine
 *
 * Implements:
 * 1. Deband: branchless gradient dithering/smoothing to eliminate 8-bit color banding
 * 2. CAS (Contrast Adaptive Sharpening): 5-tap halo-free detail enhancement
 * 3. RDX Labs — Vendor-Agnostic Smart Upscaler (Intel UHD/Iris Xe, NVIDIA, AMD, Apple):
 *    - "cinema": Edge-Adaptive Spatial Upscaler (4-direction gradient tangent interpolation + anti-ringing)
 *    - "anime": Anime4K-Fast contour line thinning & highlight clamping for cartoons/anime
 * 4. RDX Labs — Real-Time Frame Boost (24 FPS -> 48/60 FPS):
 *    - "smooth": Ping-pong 2-frame motion-adaptive temporal blending with scene-cut & ghosting guard
 *    - "flow": WebGL2 240x135 pyramid coarse optical flow (computed only 24x/sec on new frames!) +
 *              bidirectional motion-compensated 60Hz warp with occlusion/subtitle confidence fallback
 *
 * Performance & Memory Guarantees:
 * - Zero per-frame GPU texture allocations (`texSubImage2D` in-place + pointer ping-pong swap)
 * - `requestVideoFrameCallback` drives texture uploads ONLY when GStreamer/MSE decodes a real frame
 * - 60Hz VSync loop activates ONLY when Frame Boost is enabled on <=34fps content (capped at ~60fps on 144Hz panels)
 * - Automatic FPS watchdog reports sustained drops so low-end laptops degrade gracefully
 */

import type { FrameBoostMode } from "../services/labs";

export type VideoEnhanceMode = "off" | "deband" | "cas" | "max";
export type ResolvedUpscaleMode = "off" | "cinema" | "anime";

export interface ShaderPipelineConfig {
  enhance: VideoEnhanceMode;
  upscale: ResolvedUpscaleMode;
  frameBoost: FrameBoostMode;
  splitCompare?: boolean;
}

const FLOW_WIDTH = 240;
const FLOW_HEIGHT = 135;
const MAX_UPSCALE_WIDTH = 1920;
const MAX_UPSCALE_HEIGHT = 1080;

// Shared Vertex Shader (WebGL 1 / GLSL 100 compatible — runs identically in WebGL1 & WebGL2)
const VERTEX_SHADER_QUAD = `
attribute vec2 a_position;
attribute vec2 a_texCoord;
uniform float u_flipY;
varying vec2 v_uv;

void main() {
    gl_Position = vec4(a_position, 0.0, 1.0);
    v_uv = vec2(a_texCoord.x, u_flipY > 0.5 ? (1.0 - a_texCoord.y) : a_texCoord.y);
}
`;

// Pass 0 (24x/sec only in "flow" mode): Downscale video texture into 240x135 luma/RGB buffer
const FRAGMENT_DOWNSCALE = `
precision mediump float;
uniform sampler2D u_src;
varying vec2 v_uv;

void main() {
    gl_FragColor = texture2D(u_src, v_uv);
}
`;

// Pass 1 (24x/sec only in "flow" mode): Coarse 240x135 Lucas-Kanade + 5-point block search Optical Flow
// Encodes velocity (vx, vy) in [-4.0 .. +4.0] low-res texels into RG [0..1], and scene/match confidence in B [0..1]
const FRAGMENT_OPTICAL_FLOW = `
precision mediump float;
uniform sampler2D u_prevLow;
uniform sampler2D u_currLow;
uniform vec2 u_lowTexel;
varying vec2 v_uv;

float luma(vec3 c) {
    return dot(c, vec3(0.2126, 0.7152, 0.0722));
}

float patchDiff(vec2 uvPrev, vec2 uvCurr) {
    float c0 = abs(luma(texture2D(u_prevLow, uvPrev).rgb) - luma(texture2D(u_currLow, uvCurr).rgb));
    float cx = abs(
        luma(texture2D(u_prevLow, uvPrev + vec2(u_lowTexel.x, 0.0)).rgb) -
        luma(texture2D(u_currLow, uvCurr + vec2(u_lowTexel.x, 0.0)).rgb)
    );
    float cy = abs(
        luma(texture2D(u_prevLow, uvPrev + vec2(0.0, u_lowTexel.y)).rgb) -
        luma(texture2D(u_currLow, uvCurr + vec2(0.0, u_lowTexel.y)).rgb)
    );
    return (c0 * 2.0 + cx + cy) * 0.25;
}

void main() {
    vec3 currRGB = texture2D(u_currLow, v_uv).rgb;
    vec3 prevRGB = texture2D(u_prevLow, v_uv).rgb;

    float lCurr = luma(currRGB);
    float lPrev = luma(prevRGB);
    float it = lCurr - lPrev;

    // Spatial gradients (averaged across prev & curr for temporal stability)
    float gxCurr = luma(texture2D(u_currLow, v_uv + vec2(u_lowTexel.x, 0.0)).rgb) -
                   luma(texture2D(u_currLow, v_uv - vec2(u_lowTexel.x, 0.0)).rgb);
    float gyCurr = luma(texture2D(u_currLow, v_uv + vec2(0.0, u_lowTexel.y)).rgb) -
                   luma(texture2D(u_currLow, v_uv - vec2(0.0, u_lowTexel.y)).rgb);
    float gxPrev = luma(texture2D(u_prevLow, v_uv + vec2(u_lowTexel.x, 0.0)).rgb) -
                   luma(texture2D(u_prevLow, v_uv - vec2(u_lowTexel.x, 0.0)).rgb);
    float gyPrev = luma(texture2D(u_prevLow, v_uv + vec2(0.0, u_lowTexel.y)).rgb) -
                   luma(texture2D(u_prevLow, v_uv - vec2(0.0, u_lowTexel.y)).rgb);

    float ix = (gxCurr + gxPrev) * 0.25;
    float iy = (gyCurr + gyPrev) * 0.25;

    // Tikhonov-regularized single-step Lucas-Kanade seed
    float denom = ix * ix + iy * iy + 0.0035;
    vec2 lkFlow = clamp(vec2(-it * ix / denom, -it * iy / denom), vec2(-3.5), vec2(3.5));

    // Diamond candidate refinement (0, LK seed, and 4 cardinal +/-1.75 texel probes)
    vec2 bestFlow = vec2(0.0);
    float bestSad = patchDiff(v_uv, v_uv);

    float sadLk = patchDiff(v_uv - lkFlow * u_lowTexel * 0.5, v_uv + lkFlow * u_lowTexel * 0.5);
    if (sadLk < bestSad) {
        bestSad = sadLk;
        bestFlow = lkFlow;
    }

    vec2 d1 = vec2(1.75, 0.0);
    vec2 d2 = vec2(-1.75, 0.0);
    vec2 d3 = vec2(0.0, 1.75);
    vec2 d4 = vec2(0.0, -1.75);

    float s1 = patchDiff(v_uv - d1 * u_lowTexel * 0.5, v_uv + d1 * u_lowTexel * 0.5);
    if (s1 + 0.004 < bestSad) { bestSad = s1; bestFlow = d1; }

    float s2 = patchDiff(v_uv - d2 * u_lowTexel * 0.5, v_uv + d2 * u_lowTexel * 0.5);
    if (s2 + 0.004 < bestSad) { bestSad = s2; bestFlow = d2; }

    float s3 = patchDiff(v_uv - d3 * u_lowTexel * 0.5, v_uv + d3 * u_lowTexel * 0.5);
    if (s3 + 0.004 < bestSad) { bestSad = s3; bestFlow = d3; }

    float s4 = patchDiff(v_uv - d4 * u_lowTexel * 0.5, v_uv + d4 * u_lowTexel * 0.5);
    if (s4 + 0.004 < bestSad) { bestSad = s4; bestFlow = d4; }

    // Sub-texel refinement around best candidate
    vec2 halfStep = bestFlow + lkFlow * 0.35;
    halfStep = clamp(halfStep, vec2(-4.0), vec2(4.0));
    float sRef = patchDiff(v_uv - halfStep * u_lowTexel * 0.5, v_uv + halfStep * u_lowTexel * 0.5);
    if (sRef < bestSad) {
        bestSad = sRef;
        bestFlow = halfStep;
    }

    // Confidence drops cleanly on scene cuts, flashes, or severe disocclusions
    vec3 chromaDiff = abs(currRGB - prevRGB);
    float rawDiff = max(max(chromaDiff.r, chromaDiff.g), chromaDiff.b);
    float conf = (1.0 - smoothstep(0.06, 0.22, bestSad)) * (1.0 - smoothstep(0.28, 0.52, rawDiff));

    vec2 encoded = clamp(bestFlow / 8.0 + 0.5, 0.0, 1.0);
    gl_FragColor = vec4(encoded.x, encoded.y, conf, 1.0);
}
`;

// Final Composite Pass: Frame Boost (off / smooth / flow) + Smart Upscaler (off / cinema / anime) + Deband + CAS
const FRAGMENT_MAIN_COMPOSITE = `
precision mediump float;

uniform sampler2D u_currTex;
uniform sampler2D u_prevTex;
uniform sampler2D u_flowTex;

uniform vec2 u_texelSize;     // 1.0 / sourceVideoSize
uniform vec2 u_lowTexelSize;  // 1.0 / vec2(240.0, 135.0)
uniform int u_enhanceMode;    // 0: off, 1: deband, 2: cas, 3: max
uniform int u_upscaleMode;    // 0: off, 1: cinema (Edge-Adaptive), 2: anime (Anime4K-Fast)
uniform int u_boostMode;      // 0: off, 1: smooth, 2: flow
uniform int u_splitCompare;   // 0: full screen, 1: left=raw 24fps, right=60fps Labs
uniform float u_phase;        // 0.0 .. 1.0 sub-frame interpolation factor
uniform float u_sharpness;
uniform float u_debandThreshold;

varying vec2 v_uv;

float luma(vec3 c) {
    return dot(c, vec3(0.2126, 0.7152, 0.0722));
}

// Temporal frame reconstruction (Frame Boost) at arbitrary UV
vec3 sampleBoosted(vec2 uv) {
    vec3 curr = texture2D(u_currTex, uv).rgb;
    if (u_boostMode == 0 || u_phase >= 0.985) {
        return curr;
    }

    vec3 prev = texture2D(u_prevTex, uv).rgb;
    if (u_phase <= 0.015) {
        return prev;
    }

    vec3 diff3 = abs(curr - prev);
    float maxDiff = max(max(diff3.r, diff3.g), diff3.b);

    // Mode 1: Motion-Adaptive Anti-Judder Blending (zero-artifact, scene-cut safe)
    if (u_boostMode == 1) {
        // Scene-cut & fast-slash guard: snap toward current frame when pixel delta is huge
        float blendSafety = 1.0 - smoothstep(0.14, 0.30, maxDiff);
        float effPhase = mix(step(0.5, u_phase), u_phase, blendSafety);
        return mix(prev, curr, effPhase);
    }

    // Mode 2: WebGL2 Pyramid Optical Flow with 5-tap smoothed vector field & occlusion fallback
    vec4 fCenter = texture2D(u_flowTex, uv);
    vec2 fN = texture2D(u_flowTex, uv + vec2(0.0, -u_lowTexelSize.y)).rg;
    vec2 fS = texture2D(u_flowTex, uv + vec2(0.0,  u_lowTexelSize.y)).rg;
    vec2 fW = texture2D(u_flowTex, uv + vec2(-u_lowTexelSize.x, 0.0)).rg;
    vec2 fE = texture2D(u_flowTex, uv + vec2( u_lowTexelSize.x, 0.0)).rg;

    vec2 avgEnc = (fCenter.rg * 2.0 + fN + fS + fW + fE) / 6.0;
    vec2 flowTexels = (avgEnc - 0.5) * 8.0;
    vec2 flowUV = flowTexels * u_lowTexelSize;

    vec2 uvPrev = clamp(uv - flowUV * u_phase, vec2(0.001), vec2(0.999));
    vec2 uvCurr = clamp(uv + flowUV * (1.0 - u_phase), vec2(0.001), vec2(0.999));

    vec3 wPrev = texture2D(u_prevTex, uvPrev).rgb;
    vec3 wCurr = texture2D(u_currTex, uvCurr).rgb;

    // Bidirectional photometric consistency check (protects subtitles, UI logos & disoccluded edges)
    vec3 warpDiff3 = abs(wCurr - wPrev);
    float warpErr = max(max(warpDiff3.r, warpDiff3.g), warpDiff3.b);
    float warpConf = fCenter.b * (1.0 - smoothstep(0.08, 0.22, warpErr));

    vec3 warped = mix(wPrev, wCurr, u_phase);

    // Fallback when motion vector is uncertain: gentle anti-judder or clean snap on cuts
    float fallbackSafety = 1.0 - smoothstep(0.16, 0.32, maxDiff);
    vec3 safeFallback = mix(mix(prev, curr, step(0.5, u_phase)), mix(prev, curr, u_phase), fallbackSafety);

    return mix(safeFallback, warped, warpConf);
}

// Vendor-Agnostic Smart Upscaler (Intel UHD/Iris Xe, NVIDIA, AMD, Apple Silicon)
vec3 sampleUpscaled(vec2 uv) {
    vec3 c = sampleBoosted(uv);
    if (u_upscaleMode == 0) {
        return c;
    }

    vec2 tx = u_texelSize;
    vec3 n  = sampleBoosted(uv + vec2(0.0, -tx.y));
    vec3 s  = sampleBoosted(uv + vec2(0.0,  tx.y));
    vec3 w  = sampleBoosted(uv + vec2(-tx.x, 0.0));
    vec3 e  = sampleBoosted(uv + vec2( tx.x, 0.0));

    // Mode 2: Anime4K-Fast (Gradient-guided line thinning + highlight clamp)
    if (u_upscaleMode == 2) {
        vec3 nw = texture2D(u_currTex, uv + vec2(-tx.x, -tx.y)).rgb;
        vec3 ne = texture2D(u_currTex, uv + vec2( tx.x, -tx.y)).rgb;
        vec3 sw = texture2D(u_currTex, uv + vec2(-tx.x,  tx.y)).rgb;
        vec3 se = texture2D(u_currTex, uv + vec2( tx.x,  tx.y)).rgb;

        float lN = luma(n), lS = luma(s), lW = luma(w), lE = luma(e);
        float lNW = luma(nw), lNE = luma(ne), lSW = luma(sw), lSE = luma(se);

        // Sobel edge gradient
        float gx = (lNE + 2.0 * lE + lSE) - (lNW + 2.0 * lW + lSW);
        float gy = (lSW + 2.0 * lS + lSE) - (lNW + 2.0 * lN + lNE);
        float gradLen = sqrt(gx * gx + gy * gy);

        if (gradLen > 0.025) {
            vec2 normDir = vec2(gx, gy) / gradLen;
            // Push sample toward darker ink contour / sharper cel boundary
            float laplacian = (lN + lS + lW + lE) * 0.25 - luma(c);
            vec2 pushOffset = normDir * tx * clamp(-laplacian * 3.2, -0.48, 0.48);
            vec3 pushed = sampleBoosted(uv + pushOffset);

            // Unsharp cel-clarity boost clamped strictly to neighborhood bounds (0 ringing)
            vec3 minC = min(min(min(n, s), min(w, e)), c);
            vec3 maxC = max(max(max(n, s), max(w, e)), c);
            vec3 crisp = pushed + (pushed - (n + s + w + e) * 0.25) * 0.45;
            return clamp(crisp, minC, maxC);
        }
        return c;
    }

    // Mode 1: Cinema Edge-Adaptive Spatial Upscaler (EASU/RCAS-inspired directional tangent filter)
    vec3 nw = texture2D(u_currTex, uv + vec2(-tx.x, -tx.y)).rgb;
    vec3 ne = texture2D(u_currTex, uv + vec2( tx.x, -tx.y)).rgb;
    vec3 sw = texture2D(u_currTex, uv + vec2(-tx.x,  tx.y)).rgb;
    vec3 se = texture2D(u_currTex, uv + vec2( tx.x,  tx.y)).rgb;

    float gx = (luma(ne) + 2.0 * luma(e) + luma(se)) - (luma(nw) + 2.0 * luma(w) + luma(sw));
    float gy = (luma(sw) + 2.0 * luma(s) + luma(se)) - (luma(nw) + 2.0 * luma(n) + luma(ne));
    float gMag = sqrt(gx * gx + gy * gy) + 0.0001;

    // Edge tangent (perpendicular to gradient) preserves diagonal edges without stair-stepping
    vec2 tangent = vec2(-gy, gx) / gMag;
    vec3 t1 = sampleBoosted(uv + tangent * tx * 0.65);
    vec3 t2 = sampleBoosted(uv - tangent * tx * 0.65);
    vec3 dirSmooth = (c * 2.0 + t1 + t2) * 0.25;

    // Adaptive contrast reconstruction with strict anti-ringing clamp
    vec3 minRGB = min(min(min(n, s), min(w, e)), c);
    vec3 maxRGB = max(max(max(n, s), max(w, e)), c);
    vec3 boxAvg = (n + s + w + e) * 0.25;
    float edgeStrength = smoothstep(0.02, 0.18, gMag);
    vec3 reconstructed = mix(c, dirSmooth, edgeStrength * 0.55) + (dirSmooth - boxAvg) * (0.42 + u_sharpness * 0.22);
    return clamp(reconstructed, minRGB, maxRGB);
}

vec3 applyDeband(vec3 orig, vec2 uv) {
    vec2 db = u_texelSize * 3.5;
    vec3 s1 = texture2D(u_currTex, uv - vec2(db.x, 0.0)).rgb;
    vec3 s2 = texture2D(u_currTex, uv + vec2(db.x, 0.0)).rgb;
    vec3 s3 = texture2D(u_currTex, uv - vec2(0.0, db.y)).rgb;
    vec3 s4 = texture2D(u_currTex, uv + vec2(0.0, db.y)).rgb;

    vec3 avg = (s1 + s2 + s3 + s4) * 0.25;
    vec3 diff = abs(avg - orig);
    float maxDiff = max(max(diff.r, diff.g), diff.b);
    float factor = step(maxDiff, u_debandThreshold) * 0.65;
    return mix(orig, avg, factor);
}

vec3 applyCAS(vec3 center, vec2 uv) {
    vec3 a = texture2D(u_currTex, uv - vec2(0.0, u_texelSize.y)).rgb;
    vec3 b = texture2D(u_currTex, uv - vec2(u_texelSize.x, 0.0)).rgb;
    vec3 c = texture2D(u_currTex, uv + vec2(u_texelSize.x, 0.0)).rgb;
    vec3 d = texture2D(u_currTex, uv + vec2(0.0, u_texelSize.y)).rgb;

    vec3 minRGB = min(min(min(a, b), min(c, d)), center);
    vec3 maxRGB = max(max(max(a, b), max(c, d)), center);

    float minLuma = luma(minRGB);
    float maxLuma = luma(maxRGB);
    float amp = clamp(min(minLuma, 1.0 - maxLuma) / max(maxLuma, 0.0001), 0.0, 1.0);
    float w = -sqrt(amp) * (u_sharpness * 0.20);

    vec3 filtered = (center + w * (a + b + c + d)) / (1.0 + 4.0 * w);
    return clamp(filtered, minRGB, maxRGB);
}

void main() {
    if (u_splitCompare == 1) {
        if (v_uv.x < 0.4988) {
            gl_FragColor = vec4(texture2D(u_currTex, v_uv).rgb, 1.0);
            return;
        }
        if (v_uv.x <= 0.5012) {
            gl_FragColor = vec4(0.95, 0.24, 0.42, 1.0);
            return;
        }
    }

    vec3 color = sampleUpscaled(v_uv);

    if (u_enhanceMode == 1) {
        color = applyDeband(color, v_uv);
    } else if (u_enhanceMode == 2) {
        color = applyCAS(color, v_uv);
    } else if (u_enhanceMode == 3) {
        color = applyCAS(applyDeband(color, v_uv), v_uv);
    }

    gl_FragColor = vec4(color, 1.0);
}
`;

interface PassProgram {
  program: WebGLProgram;
  aPosition: number;
  aTexCoord: number;
  uFlipY: WebGLUniformLocation | null;
}

export class VideoShaderRenderer {
  public static readonly VERSION = 10;
  public readonly version = VideoShaderRenderer.VERSION;

  private canvas: HTMLCanvasElement;
  private video: HTMLVideoElement;
  private gl: WebGLRenderingContext | null = null;

  private mainPass: PassProgram | null = null;
  private downscalePass: PassProgram | null = null;
  private flowPass: PassProgram | null = null;
  private quadBuffer: WebGLBuffer | null = null;

  // Ping-pong full-res video textures
  private currTexture: WebGLTexture | null = null;
  private prevTexture: WebGLTexture | null = null;
  private hasPrevFrame = false;

  // Low-res 240x135 pyramid buffers for Optical Flow
  private currLowTex: WebGLTexture | null = null;
  private currLowFbo: WebGLFramebuffer | null = null;
  private prevLowTex: WebGLTexture | null = null;
  private prevLowFbo: WebGLFramebuffer | null = null;
  private flowTex: WebGLTexture | null = null;
  private flowFbo: WebGLFramebuffer | null = null;
  private flowResourcesAllocated = false;

  // Main composite uniform locations
  private uCurrTexLoc: WebGLUniformLocation | null = null;
  private uPrevTexLoc: WebGLUniformLocation | null = null;
  private uFlowTexLoc: WebGLUniformLocation | null = null;
  private uTexelSizeLoc: WebGLUniformLocation | null = null;
  private uLowTexelSizeLoc: WebGLUniformLocation | null = null;
  private uEnhanceModeLoc: WebGLUniformLocation | null = null;
  private uUpscaleModeLoc: WebGLUniformLocation | null = null;
  private uBoostModeLoc: WebGLUniformLocation | null = null;
  private uSplitCompareLoc: WebGLUniformLocation | null = null;
  private uPhaseLoc: WebGLUniformLocation | null = null;
  private uSharpnessLoc: WebGLUniformLocation | null = null;
  private uDebandThresholdLoc: WebGLUniformLocation | null = null;

  // Downscale & flow uniform locations
  private uDownSrcLoc: WebGLUniformLocation | null = null;
  private uFlowPrevLoc: WebGLUniformLocation | null = null;
  private uFlowCurrLoc: WebGLUniformLocation | null = null;
  private uFlowLowTexelLoc: WebGLUniformLocation | null = null;

  private mode: VideoEnhanceMode = "off";
  private upscaleMode: ResolvedUpscaleMode = "off";
  private frameBoostMode: FrameBoostMode = "off";
  private splitCompare = false;
  private sharpness = 0.85;
  private debandThreshold = 0.015;

  private animFrameId: number | null = null;
  private rvfcId: number | null = null;
  private newVideoFrameAvailable = true;
  private isDestroyed = false;
  private isRunning = false;
  private listenersAttached = false;
  private hasReportedSuccess = false;

  private allocatedSrcWidth = 0;
  private allocatedSrcHeight = 0;
  private allocatedOutWidth = 0;
  private allocatedOutHeight = 0;

  private lastRenderedMediaTime = -1;
  private lastVideoFrameWallTime = 0;
  private avgVideoFrameIntervalMs = 41.67; // 24fps initial estimate
  private lastDisplayPaintTime = 0;

  private sourceFps = 24;
  private outputFps = 24;
  private decodedFrameCounter = 0;
  private outputFrameCounter = 0;
  private lastFpsWindowTime = performance.now();
  private lowFpsStrikeCount = 0;

  private onFrameSuccess?: () => void;
  private onFrameError?: () => void;
  private onFpsUpdate?: (fps: number, sourceFps?: number) => void;
  private onPerformanceDrop?: () => void;

  constructor(
    canvas: HTMLCanvasElement,
    video: HTMLVideoElement,
    callbacks?: {
      onFrameSuccess?: () => void;
      onFrameError?: () => void;
      onFpsUpdate?: (fps: number, sourceFps?: number) => void;
      onPerformanceDrop?: () => void;
    }
  ) {
    this.canvas = canvas;
    this.video = video;
    this.onFrameSuccess = callbacks?.onFrameSuccess;
    this.onFrameError = callbacks?.onFrameError;
    this.onFpsUpdate = callbacks?.onFpsUpdate;
    this.onPerformanceDrop = callbacks?.onPerformanceDrop;

    this.initWebGL();
  }

  private get isPipelineActive(): boolean {
    return (
      this.mode !== "off" ||
      this.upscaleMode !== "off" ||
      this.frameBoostMode !== "off"
    );
  }

  private get effectiveBoostMode(): FrameBoostMode {
    if (this.frameBoostMode === "off") return "off";
    // Skip frame interpolation if source stream is already high-framerate (>= 42 fps)
    if (this.sourceFps >= 42) return "off";
    return this.frameBoostMode;
  }

  private initWebGL() {
    const ctxAttribs: WebGLContextAttributes = {
      alpha: false,
      depth: false,
      stencil: false,
      antialias: false,
      powerPreference: "high-performance",
      preserveDrawingBuffer: false,
    };

    // Use battle-tested WebGL 1 context: all our shaders (including 240x135 RGBA8 FBO Optical Flow)
    // are pure GLSL ES 1.00, and WebKitGTK GStreamer + Intel iHD/i915 handles HTMLVideoElement
    // texSubImage2D reliably in WebGL 1 without WebGL2 internalFormat mismatches.
    const gl =
      this.canvas.getContext("webgl", ctxAttribs) ||
      (this.canvas.getContext("experimental-webgl", ctxAttribs) as WebGLRenderingContext | null) ||
      (this.canvas.getContext("webgl2", ctxAttribs) as WebGLRenderingContext | null);

    if (!gl) {
      console.warn("RDX VideoShaders: WebGL not supported");
      return;
    }

    if (gl.isContextLost()) {
      try {
        gl.getExtension("WEBGL_lose_context")?.restoreContext();
      } catch {}
    }

    this.gl = gl;

    // Shared fullscreen quad
    const quadBuffer = gl.createBuffer();
    if (!quadBuffer) return;
    this.quadBuffer = quadBuffer;
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
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

    this.mainPass = this.buildPass(FRAGMENT_MAIN_COMPOSITE);
    this.downscalePass = this.buildPass(FRAGMENT_DOWNSCALE);
    this.flowPass = this.buildPass(FRAGMENT_OPTICAL_FLOW);

    if (!this.mainPass) return;

    this.currTexture = this.createLinearTexture();
    this.prevTexture = this.createLinearTexture();

    const mp = this.mainPass.program;
    this.uCurrTexLoc = gl.getUniformLocation(mp, "u_currTex");
    this.uPrevTexLoc = gl.getUniformLocation(mp, "u_prevTex");
    this.uFlowTexLoc = gl.getUniformLocation(mp, "u_flowTex");
    this.uTexelSizeLoc = gl.getUniformLocation(mp, "u_texelSize");
    this.uLowTexelSizeLoc = gl.getUniformLocation(mp, "u_lowTexelSize");
    this.uEnhanceModeLoc = gl.getUniformLocation(mp, "u_enhanceMode");
    this.uUpscaleModeLoc = gl.getUniformLocation(mp, "u_upscaleMode");
    this.uBoostModeLoc = gl.getUniformLocation(mp, "u_boostMode");
    this.uSplitCompareLoc = gl.getUniformLocation(mp, "u_splitCompare");
    this.uPhaseLoc = gl.getUniformLocation(mp, "u_phase");
    this.uSharpnessLoc = gl.getUniformLocation(mp, "u_sharpness");
    this.uDebandThresholdLoc = gl.getUniformLocation(mp, "u_debandThreshold");

    if (this.downscalePass) {
      this.uDownSrcLoc = gl.getUniformLocation(this.downscalePass.program, "u_src");
    }
    if (this.flowPass) {
      this.uFlowPrevLoc = gl.getUniformLocation(this.flowPass.program, "u_prevLow");
      this.uFlowCurrLoc = gl.getUniformLocation(this.flowPass.program, "u_currLow");
      this.uFlowLowTexelLoc = gl.getUniformLocation(this.flowPass.program, "u_lowTexel");
    }
  }

  private createLinearTexture(): WebGLTexture | null {
    const gl = this.gl;
    if (!gl) return null;
    const tex = gl.createTexture();
    if (!tex) return null;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    return tex;
  }

  private buildPass(fragSource: string): PassProgram | null {
    const gl = this.gl;
    if (!gl) return null;
    const vs = this.compileShader(gl.VERTEX_SHADER, VERTEX_SHADER_QUAD);
    const fs = this.compileShader(gl.FRAGMENT_SHADER, fragSource);
    if (!vs || !fs) return null;

    const program = gl.createProgram();
    if (!program) return null;
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    gl.deleteShader(vs);
    gl.deleteShader(fs);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error("RDX VideoShaders link error:", gl.getProgramInfoLog(program));
      gl.deleteProgram(program);
      return null;
    }

    return {
      program,
      aPosition: gl.getAttribLocation(program, "a_position"),
      aTexCoord: gl.getAttribLocation(program, "a_texCoord"),
      uFlipY: gl.getUniformLocation(program, "u_flipY"),
    };
  }

  private compileShader(type: number, source: string): WebGLShader | null {
    const gl = this.gl;
    if (!gl) return null;
    const shader = gl.createShader(type);
    if (!shader) return null;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);

    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.error("RDX VideoShaders compile error:", gl.getShaderInfoLog(shader));
      gl.deleteShader(shader);
      return null;
    }
    return shader;
  }

  private bindQuad(pass: PassProgram, flipY: boolean) {
    const gl = this.gl;
    if (!gl || !this.quadBuffer) return;
    gl.useProgram(pass.program);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
    gl.enableVertexAttribArray(pass.aPosition);
    gl.vertexAttribPointer(pass.aPosition, 2, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(pass.aTexCoord);
    gl.vertexAttribPointer(pass.aTexCoord, 2, gl.FLOAT, false, 16, 8);
    gl.uniform1f(pass.uFlipY, flipY ? 1.0 : 0.0);
  }

  private ensureFlowBuffers(): boolean {
    if (this.flowResourcesAllocated) return true;
    const gl = this.gl;
    if (!gl || !this.downscalePass || !this.flowPass) return false;

    const makeLowTarget = () => {
      const tex = this.createLinearTexture();
      const fbo = gl.createFramebuffer();
      if (!tex || !fbo) return null;
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        FLOW_WIDTH,
        FLOW_HEIGHT,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        null
      );
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      return { tex, fbo };
    };

    const tCurr = makeLowTarget();
    const tPrev = makeLowTarget();
    const tFlow = makeLowTarget();
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    if (!tCurr || !tPrev || !tFlow) return false;

    this.currLowTex = tCurr.tex;
    this.currLowFbo = tCurr.fbo;
    this.prevLowTex = tPrev.tex;
    this.prevLowFbo = tPrev.fbo;
    this.flowTex = tFlow.tex;
    this.flowFbo = tFlow.fbo;
    this.flowResourcesAllocated = true;
    return true;
  }

  public setConfig(config: ShaderPipelineConfig) {
    const nextSplit = Boolean(config.splitCompare);
    const changed =
      this.mode !== config.enhance ||
      this.upscaleMode !== config.upscale ||
      this.frameBoostMode !== config.frameBoost ||
      this.splitCompare !== nextSplit;

    this.mode = config.enhance;
    this.upscaleMode = config.upscale;
    this.frameBoostMode = config.frameBoost;
    this.splitCompare = nextSplit;

    if (!changed) return;

    this.hasReportedSuccess = false;
    this.lowFpsStrikeCount = 0;
    this.newVideoFrameAvailable = true;

    if (!this.isPipelineActive) {
      this.stop();
    } else {
      this.start();
      this.renderFrame(true);
    }
  }

  public setMode(mode: VideoEnhanceMode) {
    this.setConfig({
      enhance: mode,
      upscale: this.upscaleMode,
      frameBoost: this.frameBoostMode,
    });
  }

  public setSharpness(val: number) {
    this.sharpness = Math.max(0.0, Math.min(1.0, val));
    if (this.isPipelineActive) this.renderFrame(true);
  }

  public setDebandThreshold(val: number) {
    this.debandThreshold = Math.max(0.01, Math.min(0.1, val));
    if (this.isPipelineActive) this.renderFrame(true);
  }

  private setupRvfc(forceReset = false) {
    if (forceReset) {
      this.teardownRvfc();
    }
    if (this.rvfcId !== null) return;
    const vid = this.video as HTMLVideoElement & {
      requestVideoFrameCallback?: (cb: (now: number, meta: { mediaTime: number }) => void) => number;
    };
    if (typeof vid.requestVideoFrameCallback === "function") {
      const onFrame = (now: number) => {
        if (this.isDestroyed || !this.isRunning) {
          this.rvfcId = null;
          return;
        }
        if (this.lastVideoFrameWallTime > 0) {
          const delta = now - this.lastVideoFrameWallTime;
          if (delta >= 14 && delta <= 80) {
            this.avgVideoFrameIntervalMs = this.avgVideoFrameIntervalMs * 0.82 + delta * 0.18;
          }
        }
        this.lastVideoFrameWallTime = now;
        this.newVideoFrameAvailable = true;
        this.decodedFrameCounter++;

        if (!document.hidden && this.isPipelineActive && this.animFrameId === null) {
          this.animFrameId = requestAnimationFrame(this.renderLoop);
        }
        this.rvfcId = vid.requestVideoFrameCallback!(onFrame);
      };
      this.rvfcId = vid.requestVideoFrameCallback(onFrame);
    }
  }

  private teardownRvfc() {
    if (this.rvfcId !== null) {
      const vid = this.video as HTMLVideoElement & {
        cancelVideoFrameCallback?: (id: number) => void;
      };
      if (typeof vid.cancelVideoFrameCallback === "function") {
        try {
          vid.cancelVideoFrameCallback(this.rvfcId);
        } catch {}
      }
      this.rvfcId = null;
    }
  }

  private handleVideoPlay = () => {
    if (
      this.isRunning &&
      !this.isDestroyed &&
      this.isPipelineActive &&
      !document.hidden
    ) {
      this.decodedFrameCounter = 0;
      this.outputFrameCounter = 0;
      this.lastFpsWindowTime = performance.now();
      this.newVideoFrameAvailable = true;
      // Always re-arm rVFC on play/loadeddata because video.load() discards previous callbacks!
      this.setupRvfc(true);
      if (this.animFrameId === null) {
        this.animFrameId = requestAnimationFrame(this.renderLoop);
      }
    }
  };

  private handleVideoLoadedData = () => {
    if (this.isRunning && !this.isDestroyed && this.isPipelineActive) {
      this.hasPrevFrame = false;
      this.lastRenderedMediaTime = -1;
      this.newVideoFrameAvailable = true;
      this.setupRvfc(true);
      this.renderFrame(true);
      if (!this.video.paused && !document.hidden && this.animFrameId === null) {
        this.animFrameId = requestAnimationFrame(this.renderLoop);
      }
    }
  };

  private handleVideoSeeked = () => {
    if (this.isRunning && !this.isDestroyed && this.isPipelineActive) {
      this.hasPrevFrame = false;
      this.newVideoFrameAvailable = true;
      this.setupRvfc(true);
      this.renderFrame(true);
    }
  };

  private handleVisibilityChange = () => {
    if (
      !document.hidden &&
      this.isRunning &&
      !this.isDestroyed &&
      this.isPipelineActive &&
      !this.video.paused &&
      !this.video.ended
    ) {
      this.decodedFrameCounter = 0;
      this.outputFrameCounter = 0;
      this.lastFpsWindowTime = performance.now();
      this.setupRvfc(true);
      if (this.animFrameId === null) {
        this.animFrameId = requestAnimationFrame(this.renderLoop);
      }
    }
  };

  private attachListeners() {
    if (this.listenersAttached) return;
    this.video.addEventListener("play", this.handleVideoPlay);
    this.video.addEventListener("playing", this.handleVideoPlay);
    this.video.addEventListener("loadeddata", this.handleVideoLoadedData);
    this.video.addEventListener("seeked", this.handleVideoSeeked);
    document.addEventListener("visibilitychange", this.handleVisibilityChange);
    this.listenersAttached = true;
  }

  private detachListeners() {
    if (!this.listenersAttached) return;
    this.video.removeEventListener("play", this.handleVideoPlay);
    this.video.removeEventListener("playing", this.handleVideoPlay);
    this.video.removeEventListener("loadeddata", this.handleVideoLoadedData);
    this.video.removeEventListener("seeked", this.handleVideoSeeked);
    document.removeEventListener("visibilitychange", this.handleVisibilityChange);
    this.listenersAttached = false;
  }

  public start() {
    if (!this.isPipelineActive || this.isDestroyed) return;
    if (this.isRunning && (this.animFrameId !== null || this.rvfcId !== null)) {
      if (this.effectiveBoostMode !== "off" && this.animFrameId === null && !document.hidden) {
        this.animFrameId = requestAnimationFrame(this.renderLoop);
      }
      return;
    }
    this.isRunning = true;
    this.hasReportedSuccess = false;
    this.hasPrevFrame = false;
    this.newVideoFrameAvailable = true;
    this.decodedFrameCounter = 0;
    this.outputFrameCounter = 0;
    this.lastFpsWindowTime = performance.now();
    this.attachListeners();
    this.setupRvfc();
    if (this.animFrameId === null && !document.hidden) {
      this.animFrameId = requestAnimationFrame(this.renderLoop);
    }
  }

  public stop() {
    this.isRunning = false;
    this.detachListeners();
    this.teardownRvfc();
    if (this.animFrameId !== null) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
  }

  private renderLoop = (now: number) => {
    this.animFrameId = null;
    if (
      !this.isRunning ||
      this.isDestroyed ||
      !this.isPipelineActive ||
      document.hidden ||
      this.video.paused ||
      this.video.ended
    ) {
      return;
    }

    const boostActive = this.effectiveBoostMode !== "off";

    // On 120Hz/144Hz/165Hz panels, cap Frame Boost output cadence to ~60 FPS (15.2ms)
    // so laptops stay cool and Linux SHM transport never copies redundant >60Hz buffers
    if (boostActive && !this.newVideoFrameAvailable && now - this.lastDisplayPaintTime < 15.2) {
      this.animFrameId = requestAnimationFrame(this.renderLoop);
      return;
    }

    this.renderFrame(false, now);

    // Continuous VSync loop when Frame Boost is interpolating, or fallback when rVFC is absent
    if (boostActive || this.rvfcId === null) {
      this.animFrameId = requestAnimationFrame(this.renderLoop);
    }
  };

  private computeTargetOutputSize(srcW: number, srcH: number): { outW: number; outH: number } {
    if (this.upscaleMode === "off" || srcH >= MAX_UPSCALE_HEIGHT || srcW >= MAX_UPSCALE_WIDTH) {
      return { outW: srcW, outH: srcH };
    }
    // Upscale sub-1080p streams (e.g. 1280x720 or 1280x534) proportionally up to Full HD 1920x1080
    const scale = Math.min(MAX_UPSCALE_WIDTH / srcW, MAX_UPSCALE_HEIGHT / srcH, 1.5);
    if (scale <= 1.05) {
      return { outW: srcW, outH: srcH };
    }
    return {
      outW: Math.round((srcW * scale) / 2) * 2,
      outH: Math.round((srcH * scale) / 2) * 2,
    };
  }

  private ensureTextureAllocation(srcW: number, srcH: number): boolean {
    const gl = this.gl;
    if (!gl || !this.currTexture || !this.prevTexture) return false;

    const { outW, outH } = this.computeTargetOutputSize(srcW, srcH);

    if (this.allocatedSrcWidth !== srcW || this.allocatedSrcHeight !== srcH) {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.currTexture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, srcW, srcH, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);

      gl.bindTexture(gl.TEXTURE_2D, this.prevTexture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, srcW, srcH, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);

      this.allocatedSrcWidth = srcW;
      this.allocatedSrcHeight = srcH;
      this.hasPrevFrame = false;
    }

    if (this.allocatedOutWidth !== outW || this.allocatedOutHeight !== outH) {
      this.canvas.width = outW;
      this.canvas.height = outH;
      this.allocatedOutWidth = outW;
      this.allocatedOutHeight = outH;
    }

    return true;
  }

  private updateOpticalFlowPyramid() {
    const gl = this.gl;
    if (
      !gl ||
      !this.downscalePass ||
      !this.flowPass ||
      !this.currTexture ||
      !this.ensureFlowBuffers() ||
      !this.currLowTex ||
      !this.currLowFbo ||
      !this.prevLowTex ||
      !this.prevLowFbo ||
      !this.flowFbo
    ) {
      return;
    }

    // Swap low-res ping-pong targets so previous currLow becomes prevLow
    const tmpTex = this.prevLowTex;
    const tmpFbo = this.prevLowFbo;
    this.prevLowTex = this.currLowTex;
    this.prevLowFbo = this.currLowFbo;
    this.currLowTex = tmpTex;
    this.currLowFbo = tmpFbo;

    // 1. Downscale new currTexture -> currLowFbo (240x135)
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.currLowFbo);
    gl.viewport(0, 0, FLOW_WIDTH, FLOW_HEIGHT);
    this.bindQuad(this.downscalePass, false);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.currTexture);
    gl.uniform1i(this.uDownSrcLoc, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    if (!this.hasPrevFrame) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      return;
    }

    // 2. Compute coarse motion vectors between prevLowTex & currLowTex -> flowFbo (240x135)
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.flowFbo);
    gl.viewport(0, 0, FLOW_WIDTH, FLOW_HEIGHT);
    this.bindQuad(this.flowPass, false);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.prevLowTex);
    gl.uniform1i(this.uFlowPrevLoc, 0);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.currLowTex);
    gl.uniform1i(this.uFlowCurrLoc, 1);

    gl.uniform2f(this.uFlowLowTexelLoc, 1.0 / FLOW_WIDTH, 1.0 / FLOW_HEIGHT);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  public renderFrame(force = false, wallNow = performance.now()) {
    const gl = this.gl;
    if (!gl || !this.mainPass || !this.currTexture || !this.prevTexture) return;
    if (this.video.seeking || this.video.readyState < 2) return;

    const srcW = this.video.videoWidth || 1920;
    const srcH = this.video.videoHeight || 1080;
    if (srcW <= 0 || srcH <= 0) return;

    const prevOutW = this.allocatedOutWidth;
    const prevOutH = this.allocatedOutHeight;
    if (!this.ensureTextureAllocation(srcW, srcH)) return;
    const resized = prevOutW !== this.allocatedOutWidth || prevOutH !== this.allocatedOutHeight;

    const curMediaTime = this.video.currentTime;
    let shouldUploadNewVideoFrame = force || resized || this.lastRenderedMediaTime === -1;

    if (!shouldUploadNewVideoFrame) {
      const minFrameDelta = 0.033 * Math.max(0.5, this.video.playbackRate || 1);
      const mediaAdvanced = Math.abs(curMediaTime - this.lastRenderedMediaTime) >= minFrameDelta;
      const sinceLastFrame = wallNow - this.lastVideoFrameWallTime;

      if (this.rvfcId !== null && sinceLastFrame < 95) {
        shouldUploadNewVideoFrame = this.newVideoFrameAvailable;
      } else if (mediaAdvanced) {
        // Hybrid fallback: if WebKitGTK dropped rVFC after video.load() or quality switch,
        // advance smoothly on media clock delta and re-arm rVFC automatically!
        shouldUploadNewVideoFrame = true;
        if (this.lastVideoFrameWallTime > 0 && sinceLastFrame >= 14 && sinceLastFrame <= 80) {
          this.avgVideoFrameIntervalMs =
            this.avgVideoFrameIntervalMs * 0.82 + sinceLastFrame * 0.18;
        }
        this.lastVideoFrameWallTime = wallNow;
        this.decodedFrameCounter++;
        if (this.rvfcId !== null && sinceLastFrame > 250) {
          this.setupRvfc(true);
        }
      }
    }

    const activeBoost = this.effectiveBoostMode;

    // If Frame Boost is off and no new film frame arrived, skip drawing completely
    if (!shouldUploadNewVideoFrame && activeBoost === "off") {
      return;
    }

    if (shouldUploadNewVideoFrame) {
      // Zero-copy pointer swap: previous currTexture becomes prevTexture
      if (this.lastRenderedMediaTime !== -1 && !force && !resized) {
        const tmp = this.prevTexture;
        this.prevTexture = this.currTexture;
        this.currTexture = tmp;
        this.hasPrevFrame = true;
      }

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.currTexture);
      try {
        gl.texSubImage2D(
          gl.TEXTURE_2D,
          0,
          0,
          0,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          this.video
        );
        this.lastRenderedMediaTime = curMediaTime;
        this.newVideoFrameAvailable = false;
      } catch (err) {
        // Fallback to full texImage2D upload once in case driver rejected sub-upload stride
        try {
          gl.texImage2D(
            gl.TEXTURE_2D,
            0,
            gl.RGBA,
            gl.RGBA,
            gl.UNSIGNED_BYTE,
            this.video
          );
          this.lastRenderedMediaTime = curMediaTime;
          this.newVideoFrameAvailable = false;
        } catch (err2) {
          console.warn("RDX VideoShaders frame upload blocked:", err, err2);
          if (this.onFrameError) this.onFrameError();
          return;
        }
      }

      // If previous frame wasn't initialized yet, prime prevTexture too so first blend has valid pixels
      if (!this.hasPrevFrame) {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.prevTexture);
        try {
          gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, this.video);
        } catch {
          try {
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.video);
          } catch {}
        }
      }

      if (activeBoost === "flow") {
        this.updateOpticalFlowPyramid();
      }
    }

    // Compute sub-frame phase [0..1] between prevTexture (t=0) and currTexture (t=1)
    let phase = 1.0;
    if (activeBoost !== "off" && this.hasPrevFrame && !this.video.paused) {
      const elapsedSinceArrival = Math.max(0, wallNow - this.lastVideoFrameWallTime);
      const interval = Math.max(24, this.avgVideoFrameIntervalMs / Math.max(0.5, this.video.playbackRate || 1));
      phase = Math.min(1.0, elapsedSinceArrival / interval);
    }

    // Final screen composite pass
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.allocatedOutWidth, this.allocatedOutHeight);
    this.bindQuad(this.mainPass, true);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.currTexture);
    gl.uniform1i(this.uCurrTexLoc, 0);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.prevTexture);
    gl.uniform1i(this.uPrevTexLoc, 1);

    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.flowTex || this.currTexture);
    gl.uniform1i(this.uFlowTexLoc, 2);

    gl.uniform2f(this.uTexelSizeLoc, 1.0 / srcW, 1.0 / srcH);
    gl.uniform2f(this.uLowTexelSizeLoc, 1.0 / FLOW_WIDTH, 1.0 / FLOW_HEIGHT);

    let enhanceInt = 0;
    if (this.mode === "deband") enhanceInt = 1;
    else if (this.mode === "cas") enhanceInt = 2;
    else if (this.mode === "max") enhanceInt = 3;

    let upscaleInt = 0;
    if (this.upscaleMode === "cinema") upscaleInt = 1;
    else if (this.upscaleMode === "anime") upscaleInt = 2;

    let boostInt = 0;
    if (activeBoost === "smooth") boostInt = 1;
    else if (activeBoost === "flow" && this.flowResourcesAllocated) boostInt = 2;
    else if (activeBoost === "flow") boostInt = 1;

    gl.uniform1i(this.uEnhanceModeLoc, enhanceInt);
    gl.uniform1i(this.uUpscaleModeLoc, upscaleInt);
    gl.uniform1i(this.uBoostModeLoc, boostInt);
    gl.uniform1i(this.uSplitCompareLoc, this.splitCompare ? 1 : 0);
    gl.uniform1f(this.uPhaseLoc, phase);
    gl.uniform1f(this.uSharpnessLoc, this.sharpness);
    gl.uniform1f(this.uDebandThresholdLoc, this.debandThreshold);

    gl.drawArrays(gl.TRIANGLES, 0, 6);
    this.lastDisplayPaintTime = wallNow;
    this.outputFrameCounter++;

    // Sliding 800ms FPS telemetry + hardware overload watchdog
    const elapsedMs = wallNow - this.lastFpsWindowTime;
    if (elapsedMs >= 800) {
      const nextOutFps = Math.round((this.outputFrameCounter * 1000) / elapsedMs);
      const nextSrcFps = Math.max(
        1,
        Math.round((this.decodedFrameCounter * 1000) / elapsedMs)
      );
      this.outputFrameCounter = 0;
      this.decodedFrameCounter = 0;
      this.lastFpsWindowTime = wallNow;

      if (nextSrcFps >= 12 && nextSrcFps <= 120) {
        this.sourceFps = nextSrcFps;
      }

      if (this.outputFps !== nextOutFps || this.onFpsUpdate) {
        this.outputFps = nextOutFps;
        this.onFpsUpdate?.(nextOutFps, this.sourceFps);
      }

      // Hardware Watchdog: if Frame Boost is active during 1x playback and output FPS stays < 34 for ~3.5s
      if (
        activeBoost !== "off" &&
        !this.video.paused &&
        (this.video.playbackRate || 1) >= 0.9 &&
        nextOutFps > 0 &&
        nextOutFps < 34
      ) {
        this.lowFpsStrikeCount++;
        if (this.lowFpsStrikeCount >= 4) {
          this.lowFpsStrikeCount = 0;
          this.onPerformanceDrop?.();
        }
      } else {
        this.lowFpsStrikeCount = 0;
      }
    }

    if (this.onFrameSuccess && !this.hasReportedSuccess) {
      this.hasReportedSuccess = true;
      this.onFrameSuccess();
    }
  }

  public destroy() {
    this.isDestroyed = true;
    this.stop();
    const gl = this.gl;
    if (gl) {
      if (this.quadBuffer) gl.deleteBuffer(this.quadBuffer);
      if (this.mainPass) gl.deleteProgram(this.mainPass.program);
      if (this.downscalePass) gl.deleteProgram(this.downscalePass.program);
      if (this.flowPass) gl.deleteProgram(this.flowPass.program);
      if (this.currTexture) gl.deleteTexture(this.currTexture);
      if (this.prevTexture) gl.deleteTexture(this.prevTexture);
      if (this.currLowTex) gl.deleteTexture(this.currLowTex);
      if (this.prevLowTex) gl.deleteTexture(this.prevLowTex);
      if (this.flowTex) gl.deleteTexture(this.flowTex);
      if (this.currLowFbo) gl.deleteFramebuffer(this.currLowFbo);
      if (this.prevLowFbo) gl.deleteFramebuffer(this.prevLowFbo);
      if (this.flowFbo) gl.deleteFramebuffer(this.flowFbo);
    }
    this.quadBuffer = null;
    this.mainPass = null;
    this.downscalePass = null;
    this.flowPass = null;
    this.currTexture = null;
    this.prevTexture = null;
    this.currLowTex = null;
    this.prevLowTex = null;
    this.flowTex = null;
    this.currLowFbo = null;
    this.prevLowFbo = null;
    this.flowFbo = null;
    this.flowResourcesAllocated = false;

    // Free backing framebuffer memory without calling WEBGL_lose_context.loseContext(),
    // because React 19 StrictMode / HMR reuses the same <canvas> DOM node and loseContext()
    // permanently bricks subsequent getContext("webgl") calls on that <canvas>!
    this.canvas.width = 1;
    this.canvas.height = 1;
    this.gl = null;
  }
}
