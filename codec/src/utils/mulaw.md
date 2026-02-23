---
order: 6
title: Mu-Law Companding
---

The format employs mu-law companding for efficient quantization of floating-point audio coefficients. This non-linear compression expands small values and compresses large values, improving signal-to-noise ratio for low-amplitude signals.

## Encoding Formula

For a normalized coefficient x (-1 <= x <= 1):

y = sign(x) * ln(1 + mu * |x|) / ln(1 + mu)

Where mu is the companding parameter.

## Decoding Formula

For a companded value y:

x = sign(y) * (exp(|y| * ln(1 + mu)) - 1) / mu

## Parameter Selection

- mu = 0: Linear encoding (no companding)
- mu > 0: Non-linear companding strength increases with mu
- Lower mu values stay closer to linear; higher mu values compress large magnitudes more aggressively

## Usage in Format

In the current OBB mapping path, per-axis values are:
- Luma (`Y`): `mu = 6`
- Chroma (`Cb`): `mu = 2`
- Chroma (`Cr`): `mu = 3`

Binary mode disables mu-law in the OBB mapping (`enableMuLaw = false`).
