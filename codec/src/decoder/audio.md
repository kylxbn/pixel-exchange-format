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
6. Perform 8\*8 DCT on luma and on the MCU's shared 8\*8 chroma block
7. Reverse spatial scaling and band factors
8. Reverse static MDCT bin whitening (bins 0-95)
9. Synthesize bins 96-127 using SBR row data
10. Perform 128-point IMDCT, windowing, and overlap-add

If row metadata decode fails (or yields invalid values), decoder falls back to neutral defaults (unit scales, unit band factors, no SBR side data) for that row.

## Coefficient Processing

### Spatial to Frequency Domain
- RGB pixels are mapped back to YCbCr coefficients using inverse OBB transform
- Mu-law expansion restores linear point-space values
- DCT converts spatial blocks to frequency domain coefficients
- Adaptive scaling compensates for quantization effects

### Frequency Domain Processing
- Band factors restore original coefficient magnitudes
- SBR synthesizes bins 96-127 from source tiles in lower bands
- Deterministic noise generation ensures reproducible high frequencies
- Stereo decoding synthesizes mid and side jointly: a subgroup stereo cue couples the stochastic HF reconstruction between the two channels. A mid image decoded without its side image uses its own channel-specific SBR seed

## Time Domain Reconstruction

### IMDCT and Windowing
- 128-point IMDCT produces 256 samples per transform
- Sine windowing with 50% overlap (TDAC)
- Overlap-add combines adjacent windows
- When the first image of a file is present, its first stored block is the lead-in block: audio hop `n` is the overlap of stored blocks `n` and `n + 1`, and the first 128 overlap-add output samples are dropped. A set that starts at a later image has no lead-in and starts at its first stored block.

### Channel Reconstruction
- Mono: single channel output
- Stereo mid/side: L = M+S, R = M-S
- Side-only input is rejected unless paired with mid
- If a side image is missing for a mid image, decoder falls back to duplicated mid (mono in stereo container)

## Output Format

Decoded audio is provided as Float32Array channels matching the original sample rate and duration from the header.

## Usage in Format

Audio decoding recovers high-quality PCM audio with perceptual coding optimizations, supporting both batch processing and real-time streaming playback.
