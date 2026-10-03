---
order: 19
title: Row Scaling Strategy
---

`ScalingUtils` computes per-row gains that keep encoded spatial values inside safe range before OBB mapping.

## Subgroup Layout

Each audio row (124 consecutive audio blocks) is split into luma subgroups A/B, and each of those into chroma groups X/Y.

v301 groups are whole MCUs (4 blocks each, 31 MCUs per row), so no chroma block ever mixes two scales:
- A = blocks `0..63` (16 MCUs), B = blocks `64..123` (15 MCUs)
- AX = `0..31`, AY = `32..63`, BX = `64..95`, BY = `96..123` (8/8/8/7 MCUs)

v300 groups:
- A/B halves by block index (`SUBGROUP_A_SIZE = 62`)
- X/Y split inside each half (`SUBGROUP_X_SIZE = 31`)

Band factors use the same A/B split as the luma scales.

This yields six scale factors:
- `scaleYA`, `scaleYB` (luma)
- `scaleCAX`, `scaleCAY`, `scaleCBX`, `scaleCBY` (chroma)

## Computation

For each subgroup, encoder scans absolute maxima:
- Luma: max over 64 spatial Y samples per block
- Chroma (v301): max over the 64 spatial Cb and 64 spatial Cr samples of each MCU's shared chroma block
- Chroma (v300): max over 16 spatial Cb and 16 spatial Cr samples per block

Scale is then:
- `min(65504, 1 / maxAbs)` when signal is above `SILENCE_THRESHOLD`
- `65504` for silent groups

`65504` is used because it is the largest finite IEEE binary16 value and protects row-metadata half-float storage from overflow.
