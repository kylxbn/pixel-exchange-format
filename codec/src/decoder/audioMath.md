---
order: 28
title: Audio Block Math (Decoder)
---

`decodeBlock(...)` is the inverse DSP path for one audio block.

## Responsibilities

Given one 8x8 image block plus row metadata, it:
1. Reads RGB pixels and converts to point-space Y/Cb/Cr via inverse OBB
2. Averages chroma from 8x8 samples into 4x4 planes (4:2:0 style)
3. Reverses row scaling (divide by `maxY` / `maxC`)
4. Runs forward DCT (`8x8` luma, `4x4` chroma)
5. Rebuilds flattened coefficient vector (bins `0..95`)
6. Reverses subgroup band scaling (divide by band factors)
7. Reverses static MDCT whitening
8. Reconstructs bins `96..127` with SBR (or zero-fills if no SBR bytes)
9. Runs IMDCT and applies MDCT window

## Determinism Notes

- SBR synthesis accepts an optional external seed for reproducible/noise-controlled decode behavior.
- If scaling or band factors are invalid (`0`), function outputs silence for stability.

## Debug Capture

Optional capture buffers can snapshot:
- raw spatial planes
- flattened MDCT bins before and after reversal stages
