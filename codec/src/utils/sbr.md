---
order: 10
title: Spectral Band Replication (SBR)
---

PXF SBR reconstructs high-frequency bins `96..127` from lower bins, using 8 bytes of row metadata (2 subgroups x 32-bit words).

## Row Layout

- `SBR_SUBGROUPS_PER_ROW = 2`
- `SBR_BYTES_PER_ROW = 8`
- Each subgroup carries one 32-bit SBR word.

## Dual Modes

Each 32-bit word uses `bit0` as mode flag:
- `0`: Normal mode (single parameter set)
- `1`: Temporal mode (shared slow params + A/B fast params)

### v300 Normal Mode Bit Layout

- `[31:26]` hf gain (6 bits, 1 dB steps, -48..+15)
- `[25:14]` band envelope (4 bands x 3 bits)
- `[13:10]` noise floor ratio (4 bits)
- `[9:7]` tonality (3 bits)
- `[6:5]` patch mode (2 bits)
- `[4:3]` processing mode (2 bits)
- `[2:1]` transient shape (2 bits)
- `[0]` mode flag = 0

### v300 Temporal Mode Bit Layout

- `[31:30]` patch mode (shared)
- `[29:28]` processing mode (shared)
- `[27:26]` tonality (shared, reduced precision)
- `[25:18]` band envelope (4 bands x 2 bits)
- `[17:13]` hf gain A (first half)
- `[12:11]` noise floor A
- `[10]` transient A
- `[9:5]` hf gain B (second half)
- `[4:3]` noise floor B
- `[2]` transient B
- `[1]` reserved
- `[0]` mode flag = 1

### v301+ Normal Mode Bit Layout

- `[31:26]` hf gain
- `[25:14]` band envelope (4 bands x 3 bits)
- `[13:10]` noise floor ratio (4 bits)
- `[9:8]` tonality (2 bits)
- `[7:5]` stereo cue (3 bits)
- `[4:3]` patch mode (2 bits)
- `[2:1]` transient shape (2 bits)
- `[0]` mode flag = 0

### v301+ Temporal Mode Bit Layout

- `[31:29]` stereo cue
- `[28:27]` patch mode
- `[26:25]` tonality
- `[24:17]` band envelope (4 bands x 2 bits)
- `[16:12]` hf gain A
- `[11:10]` noise floor A
- `[9]` transient A
- `[8:4]` hf gain B
- `[3:2]` noise floor B
- `[1]` transient B
- `[0]` mode flag = 1

## Patch and Processing Modes

Patch mode source tiles:
- `0`: Adjacent (`64..95`)
- `1`: Lower (`48..79`)
- `2`: Bass (`32..63`)
- `3`: Mirror (parity-preserving mirror mapping)

Processing mode:
- `0`: Normal mix
- `1`: Transient/noise-aware
- `2`: Harmonic cubic shaping
- `3`: Inverse odd-bin polarity

Version note:
- `v300` uses processing mode as encoded above.
- `v301+` repurposes those legacy bits for a 3-bit stereo HF cue and always decodes processing mode as neutral.
- Decoder synthesis still supports all four processing modes for legacy `v300` packets.

## Synthesis

For each HF bin:
1. Pick source bin via patch mode.
2. Compute interpolated gain (junction-aware in dB).
3. Apply legacy processing mode transform when decoding `v300`.
4. Mix tonal + deterministic noise components.
5. Write scaled value to bins `96..127`.

Noise is deterministic from a content-derived or external seed, so behavior is reproducible.
For stereo `v301+` decode, the stochastic HF component is synthesized jointly from a shared cue so cancellation-sensitive panning can survive the mid/side round-trip more reliably.

## Encoder Analysis

Row analysis computes subgroup parameters from source/target energy:
- Chooses patch mode with minimal energy mismatch.
- Derives hf gain, band envelope, tonality, and noise ratio.
- Switches to temporal mode when intra-subgroup variation is high (`|hfGainA-hfGainB| > 4 dB` or energy-variation ratio `> 0.5`).
- For stereo `v301+`, also derives a 3-bit cue per subgroup describing HF sign and coherence between mid and side.

## Usage in Format

SBR keeps payload at 96 stored bins per block while reconstructing full 128-bin IMDCT input.
