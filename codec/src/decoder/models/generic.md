---
order: 25
title: LLR Lookup Models
---

This module precomputes the pixel-to-LLR lookup table used by soft-decision decoding of 1-bit-per-pixel blocks.

## Tables

- `LLR_LOOKUP_1BIT_LUMA` (size 256)

All values are clamped to `[-20, +20]`.

## Noise Model

LLRs use a distance-based Laplacian-style model with sigma `12.0`.

Larger sigma gives softer confidence.

## Symbol Assumptions

- Candidate centroids: `0` and `255`
- Positive LLR means bit `0` is more likely
- Negative LLR means bit `1` is more likely

The table is consumed by the header and row-metadata LDPC decode paths. Binary payload strips compute their LLRs from DCT coefficients instead (see Binary Modulation).
