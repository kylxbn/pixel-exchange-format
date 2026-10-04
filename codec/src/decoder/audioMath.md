---
order: 28
title: Audio Block Math (Decoder)
---

`decodeBlock(...)` is the inverse DSP path for one audio block.

## Responsibilities

Given one 8x8 image block plus row metadata, it:
1. Reads RGB pixels and converts to point-space Y/Cb/Cr via inverse OBB
2. Averages chroma 2x2 (4:2:0 style). The whole 16x16 px MCU containing the block is read, producing one 8x8 chroma plane shared by four luma blocks
3. Reverses luma row scaling (divide by `maxY`)
4. Runs forward DCT (`8x8` luma, `8x8` chroma)
5. Rebuilds flattened coefficient vector (bins `0..95`). This block's chroma bins sit at importance rank `4k + ordinal` of the shared plane, where `ordinal` is the block's position inside the MCU, and are unscaled by the MCU's chroma scale `maxC`
6. Reverses subgroup band scaling (divide by band factors)
7. Reverses static MDCT whitening
8. Reconstructs bins `96..127` with SBR (or zero-fills if no SBR bytes). SBR subgroup selection uses the row's actual data block count, matching the encoder's analysis partition (see SBR)
9. Runs IMDCT and applies MDCT window

## Determinism Notes

- SBR synthesis is a deterministic function of the decoded lowband and the row's SBR bytes.
- If scaling or band factors are invalid (`0`), function outputs silence for stability.
