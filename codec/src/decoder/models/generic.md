---
order: 25
title: LLR Lookup Models
---

This module precomputes pixel-to-LLR lookup tables used by soft-decision decoding.

## Tables

- `LLR_LOOKUP_1BIT_LUMA` (size 256)
- `LLR_LOOKUP_1BIT_CHROMA` (size 256)
- `LLR_LOOKUP_2BIT` (size 256 x 2)

All values are clamped to `[-20, +20]`.

## Noise Model

LLRs use a distance-based Laplacian-style model:
- luma sigma: `12.0`
- chroma sigma: `40.0`

Larger sigma gives softer confidence.

## Symbol Assumptions

### 1-bit paths
- Candidate centroids: `0` and `255`
- Positive LLR means bit `0` is more likely
- Negative LLR means bit `1` is more likely

### 2-bit path
- Candidate centroids: `[0, 85, 170, 255]`
- Bitwise grouping:
  - MSB: `{0,85}` vs `{170,255}`
  - LSB: `{0,255}` vs `{85,170}`

These tables are consumed by binary payload and metadata LDPC decode paths.
