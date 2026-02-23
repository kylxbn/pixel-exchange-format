---
order: 24
title: Audio Mode Decoding
---

Audio mode decoding reconstructs PCM audio from Pixel Exchange Format images. The process reverses the encoding pipeline to recover time-domain audio samples.

## Multi-Image Processing

Images are grouped by random seed and sorted by index. If multiple groups are present, the decoder uses the largest group. Stereo mid/side pairs are identified and decoded together. Incomplete sequences are handled gracefully.

For stereo sources, implementation validation includes:
- Mid indices must be odd; side indices must be even
- `totalImages` must be even
- Mid/side partners must match on `randomBytes` and `totalSamples`

## Row Processing

For each data row, decoders must:

1. Decode row metadata (32 bytes) with LDPC + whitening
2. Process 124 data blocks containing quantized coefficients
3. Extract RGB pixel values from 8*8 blocks
4. Apply inverse OBB mapping to recover YCbCr coefficients
5. Apply mu-law expansion (audio mode path)
6. Perform 8\*8 IDCT on luma and 4\*4 IDCT on chroma
7. Reverse spatial scaling and band factors
8. Reverse static MDCT bin whitening (bins 0-95)
9. Synthesize bins 96-127 using SBR row data
10. Perform 128-point IMDCT, windowing, and overlap-add

If row metadata decode fails (or yields invalid values), decoder falls back to neutral defaults (unit scales, unit band factors, no SBR side data) for that row.

## Coefficient Processing

### Spatial to Frequency Domain
- RGB pixels are mapped back to YCbCr coefficients using inverse OBB transform
- Mu-law expansion restores linear point-space values
- IDCT converts spatial blocks to frequency domain coefficients
- Adaptive scaling compensates for quantization effects
- Chroma scaling includes a row scan compensation step in the implementation to counter chroma attenuation from RGB round-trip effects

### Frequency Domain Processing
- Band factors restore original coefficient magnitudes
- SBR synthesizes bins 96-127 from source tiles in lower bands
- Deterministic noise generation ensures reproducible high frequencies
- Stereo mid/side decoding uses channel-specific SBR seeds so synthesized noise is decorrelated between mid and side channels

## Time Domain Reconstruction

### IMDCT and Windowing
- 128-point IMDCT produces 256 samples per transform
- Sine windowing with 50% overlap (TDAC)
- Overlap-add combines adjacent windows

### Channel Reconstruction
- Mono: single channel output
- Stereo mid/side: L = M+S, R = M-S
- Side-only input is rejected unless paired with mid
- If a side image is missing for a mid image, decoder falls back to duplicated mid (mono in stereo container)

## Output Format

Decoded audio is provided as Float32Array channels matching the original sample rate and duration from the header.

## Usage in Format

Audio decoding recovers high-quality PCM audio with perceptual coding optimizations, supporting both batch processing and real-time streaming playback.
