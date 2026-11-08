/**
 * Video Enhancement Types & Filters for RDX Cinema Player
 * Implements:
 * 1. Deband: High-frequency spatial dithering overlay to eliminate 8-bit color banding
 * 2. CAS (Contrast Adaptive Sharpening): Adaptive unsharp convolution to restore edge crispness
 */

export type VideoEnhanceMode = "off" | "deband" | "cas" | "max";
