---
order: 13
title: MDCT Bin Whitening
---

The codec applies deterministic whitening to stored MDCT bins (`0..95`) to flatten average spectral energy before spatial mapping.

## What It Does

- A reference average-magnitude table (measured at 32 kHz) is used as the anchor.
- For arbitrary sample rates, per-bin averages are derived from bin-center frequency:
  - interpolate inside the measured 32 kHz range
  - use a fitted power-law tail for frequencies above that range
- For each stored bin `k`, encoder scales by:
  - `gain[k] = 1 / max(avgAbs[k], 1e-12)`
- Decoder reverses the operation by multiplying by `max(avgAbs[k], 1e-12)`.

## Scope

- Applied only to bins `0..95` (the bins physically stored in blocks).
- Not applied to SBR-reconstructed bins `96..127`.
- In the encoder pipeline, whitening is applied after SBR analysis so SBR sees original MDCT coefficients.

## Determinism

Given a sample rate, whitening/de-whitening is deterministic and bit-reproducible across encoder and decoder.
