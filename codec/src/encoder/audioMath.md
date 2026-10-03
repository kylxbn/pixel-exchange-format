---
order: 27
title: Audio Row Math (Encoder)
---

`processRowPair(...)` is the core audio DSP pipeline used by `AudioEncoder`. Since v301 the encoder works on pairs of data rows, because one 8x8 chroma block spans a 2x2 group of luma blocks (a 16x16 px JPEG 4:2:0 MCU) and audio blocks are stored in MCU order (see Audio Mode Format).

## Responsibilities

`prepareAudioRow(...)` runs per row and:
1. Builds MDCT blocks (128 bins) from windowed audio
2. Runs row-level SBR analysis
3. Applies static whitening to stored bins `0..95`
4. Computes subgroup band maxima and quantized band factors (A/B)
5. Maps bins `0..63` to the 8x8 luma coefficient plane and runs IDCT
6. Computes subgroup luma scaling factors via `ScalingUtils`
7. Keeps the 16 Cb and 16 Cr coefficients (bins `64..95`) for the pair step

`prepareRowPairChroma(top, bottom)` then, per row and per MCU (four consecutive audio blocks):
1. Places each block's 16 chroma coefficients into the MCU's 8x8 chroma plane at importance rank `4k + ordinal`, where `ordinal` is the block's position in the MCU (so the four blocks interleave by importance)
2. Runs one IDCT per MCU and plane
3. Derives the row's chroma scales (`scaleCAX/CAY/CBX/CBY`) from the absolute maximum of each chroma group. Groups are whole MCUs, so every MCU has exactly one scale

`writePreparedAudioRowPair(...)` places blocks in MCU order, scales luma per block, NN-upsamples the MCU's chroma to 16x16 px, writes RGB pixels through OBB mapping, and emits row metadata through the injected callback (`writeRowMetadata`).

`writePreparedAudioRow(...)` is the legacy v300 writer (per-block 4x4 chroma); it is kept for decoder compatibility tests only.

## Storage Mapping

- Luma: bins `0..63` -> `8x8` coefficients (selected by `AUDIO_PSYCHOACOUSTICS.blockMap.luma8x8`)
- Chroma (v301+): bins `64..95` interleaved Cb/Cr -> 16 ranks each of the MCU's shared `8x8` chroma plane (selected by `AUDIO_PSYCHOACOUSTICS.blockMap.chroma8x8`)
- Chroma (v300): bins `64..95` interleaved Cb/Cr -> per-block `4x4` coefficients (selected by `AUDIO_PSYCHOACOUSTICS.blockMap.chroma4x4`)

Band factors are computed over bins `0..63` and quantization is mirrored in analysis by `logDecode(logEncode(...))`.
