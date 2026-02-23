---
order: 19
title: Row Scaling Strategy
---

`ScalingUtils.calculateRowScalingFactors(...)` computes per-row gains that keep encoded spatial values inside safe range before OBB mapping.

## Subgroup Layout

Each audio data row is split as:
- A/B halves by block index (`SUBGROUP_A_SIZE = 62`)
- X/Y split inside each half (`SUBGROUP_X_SIZE = 31`)

This yields six scale factors:
- `scaleYA`, `scaleYB` (luma)
- `scaleCAX`, `scaleCAY`, `scaleCBX`, `scaleCBY` (chroma)

## Computation

For each subgroup, encoder scans absolute maxima:
- Luma: max over 64 spatial Y samples per block
- Chroma: max over 16 spatial Cb and 16 spatial Cr samples per block

Scale is then:
- `min(65504, 1 / maxAbs)` when signal is above `SILENCE_THRESHOLD`
- `65504` for silent groups

`65504` is used because it is the largest finite IEEE binary16 value and protects row-metadata half-float storage from overflow.
