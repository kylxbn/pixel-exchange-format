---
order: 10
title: Spectral Band Replication (SBR)
---

PXF SBR reconstructs high-frequency bins `96..127` from lower bins, using 8 bytes of row metadata (2 subgroups x 32-bit words).

## Row Layout

- `SBR_SUBGROUPS_PER_ROW = 2`
- Subgroups are partitioned relative to the row's actual data block count (`getSbrSubgroupRange`): subgroup 0 covers blocks `[0, floor(n/2))`, subgroup 1 covers `[floor(n/2), n)`. A full row splits 62/62; a partial last row still gets two subgroups. Encoder analysis and decoder synthesis share this partition.
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
- `[9:8]` tonality (2 bits; selects source whitening, see Synthesis)
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
- `[11:10]` noise floor A (2 bits, noise share = value / 3)
- `[9]` transient A (1 = attack shape over the first half)
- `[8:4]` hf gain B
- `[3:2]` noise floor B
- `[1]` transient B (1 = attack shape over the second half)
- `[0]` mode flag = 1

Temporal mode splits the subgroup at `floor(size / 2)`; blocks before the split use the A parameters and the rest use B.

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

For each block:
1. Read the 32-bin source tile selected by the patch mode.
2. v301+: whiten the tile by `3 - tonality` (0 = untouched, 3 = full). Each bin keeps its sign and has its magnitude raised to the power `1 - level / 3` (level 3 leaves only the signs), then each 8-bin band is rescaled to the energy it had before whitening.
3. Compute the per-bin gain: `hfGain + bandEnvelope[band]` at the band centres, interpolated in dB, with a junction point toward the baseband.
4. Multiply by the transient shape, evaluated at the block's position `t` in `0..1` within its span:
   - `1` Attack `0.5 + 0.5t`, `2` Decay `1 - 0.5t`, `3` Impulse `1 - 1.5|t - 0.5|`
   - v301+: the shape is divided by its RMS over the span (`sqrt(7/12)` for attack and decay, `sqrt(7/16)` for impulse), so it redistributes energy in time without changing the total. In temporal mode the span is the half the block belongs to. v300 used the raw shape over the whole subgroup.
5. Mix the tile with deterministic noise of the same band RMS. With noise share `n` (normal mode `noiseFloorRatio / 15`, temporal mode `noiseFloor / 3`): `out = tile * sqrt(1 - n) + noise * sqrt(n)`. v300 also scaled the tonal part by `tonality / 7` and read the temporal 2-bit noise field on the 4-bit scale.
6. Apply the legacy processing mode transform when decoding `v300`.
7. Write the scaled value to bins `96..127`. Bands whose source RMS is at or below `1e-4` stay silent.

Noise is deterministic from a content-derived or external seed, so behavior is reproducible.
For stereo `v301+` decode, the stochastic HF component is synthesized jointly from a shared cue so cancellation-sensitive panning can survive the mid/side round-trip more reliably.

## Encoder Analysis

Analysis is closed-loop: the target is the clean highband (bins `96..127`), the source is the lowband as the decoder will read it back after the target JPEG transport (see Audio Row Math). Quantization noise in bins `64..95` therefore counts as source energy, as it will at synthesis.

Energies are measured on the MDCT pseudo-spectrum, `(X[k]^2 + (X[k+1] - X[k-1])^2) / 3`, which sums to the same energy as `X[k]^2` on average but depends far less on the phase of a stationary tone.

Per subgroup:
- **Patch mode**: each mode gets the overall gain that matches its own source tile to the target; the mode whose band energies then deviate least from the target wins. For stereo subgroups with a strongly coherent highband, mid and side share the mode that fits both best.
- **Gain and band envelope**: overall gain from total target / source energy of the chosen tile, band envelope from the per-band ratios relative to the quantized gain.
- **Temporal mode** when the two halves of the subgroup need gains more than 3 dB apart. Energy changes that the source tile already follows do not need it.
- **Tonality and noise**: spectral flatness is measured per band on time-averaged bin powers. The source tile is whitened only as far as needed to become as flat as the target; if it is still less flat at full whitening, the remaining gap sets the noise share.
- **Transient shape**: the shape whose envelope, applied to the gained source, tracks the per-block target energy best, used only if it beats the flat envelope by 10 %.
- For stereo `v301+`, a 3-bit cue per subgroup describes HF sign and coherence between mid and side.

## Usage in Format

SBR keeps payload at 96 stored bins per block while reconstructing full 128-bin IMDCT input.
