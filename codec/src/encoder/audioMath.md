---
order: 27
title: Audio Row Math (Encoder)
---

`processRow(...)` is the core per-row audio DSP pipeline used by `AudioEncoder`.

## Responsibilities

For each audio row, it:
1. Builds MDCT blocks (128 bins) from windowed audio
2. Runs row-level SBR analysis and serializes 8 SBR bytes
3. Applies static whitening to stored bins `0..95`
4. Computes subgroup band maxima and quantized band factors (A/B)
5. Maps bins to luma/chroma coefficient planes and runs IDCT
6. Computes subgroup scaling factors via `ScalingUtils`
7. Scales, upsamples chroma (4x4 -> 8x8), and writes RGB pixels through OBB mapping
8. Emits row metadata through injected callback (`writeRowMetadata`)

## Storage Mapping

- Luma: bins `0..63` -> `8x8` coefficients (selected by `AUDIO_PSYCHOACOUSTICS.blockMap.luma8x8`)
- Chroma: bins `64..95` interleaved Cb/Cr -> `4x4` coefficients (selected by `AUDIO_PSYCHOACOUSTICS.blockMap.chroma4x4`)

Band factors are computed over bins `0..63` and quantization is mirrored in analysis by `logDecode(logEncode(...))`.
