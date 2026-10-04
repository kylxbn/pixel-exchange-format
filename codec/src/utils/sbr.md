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
- `0`: Normal mode (two gains per subgroup in 1 dB steps, finer band envelope)
- `1`: Temporal mode (four gains per subgroup in coarser steps, coarser band envelope)

### Normal Mode Bit Layout

- `[31:26]` hf gain (6 bits, 1 dB steps, -48..+15), applied to the first half of the subgroup
- `[25:14]` band envelope (4 bands x 3 bits, 2 dB steps, -6..+8)
- `[13:10]` gain delta (4 bits, 1 dB steps, -8..+7): the second half uses `hf gain + gain delta`
- `[9:8]` tonality (2 bits; selects source whitening, see Synthesis)
- `[7:5]` stereo cue (3 bits)
- `[4:3]` patch mode (2 bits)
- `[2:1]` transient shape (2 bits)
- `[0]` mode flag = 0

### Temporal Mode Bit Layout

- `[31:29]` stereo cue
- `[28:27]` patch mode
- `[26:25]` tonality
- `[24:17]` band envelope (4 bands x 2 bits, 3 dB steps, -4.5..+4.5)
- `[16:12]` hf gain A (5 bits, 2 dB steps, -48..+14)
- `[11:10]` quarter delta A (2 bits: -4, 0, +4, +8 dB)
- `[9]` transient A (1 = attack shape over the first half)
- `[8:4]` hf gain B
- `[3:2]` quarter delta B
- `[1]` transient B (1 = attack shape over the second half)
- `[0]` mode flag = 1

### Time Segments

Both modes split the subgroup at `floor(size / 2)`; blocks before the split are the first half (A), the rest the second half (B). Temporal mode splits each half again at `floor(halfLength / 2)`: the first quarter of a half uses `hf gain - quarter delta / 2`, the second `hf gain + quarter delta / 2`. A half or quarter that comes out empty simply has no blocks, so a one-block subgroup is all second half.

### Band Envelope Offset

The top band (bins `120..127`) sits on the anti-alias rolloff of the source and almost always needs less gain than the other three, so its envelope range is shifted down by 4 dB in both modes: -10..+4 in normal mode, -8.5..+0.5 in temporal mode.

## Patch Modes

Patch mode source tiles:
- `0`: Adjacent (`64..95`)
- `1`: Lower (`48..79`)
- `2`: Bass (`32..63`)
- `3`: Mirror (parity-preserving mirror mapping)

## Synthesis

For each block:
1. Read the 32-bin source tile selected by the patch mode.
2. Whiten the tile by `3 - tonality` (0 = untouched, 3 = full). Each bin keeps its sign and has its magnitude raised to the power `1 - level / 3` (level 3 leaves only the signs), then each 8-bin band is rescaled to the energy it had before whitening.
3. Compute the per-bin gain: the gain of the block's time segment plus `bandEnvelope[band]` at the band centres, interpolated in dB, with a junction point toward the baseband.
4. Multiply by the transient shape, evaluated at the block's position `t` in `0..1` within its span:
   - `1` Attack `0.5 + 0.5t`, `2` Decay `1 - 0.5t`, `3` Impulse `1 - 1.5|t - 0.5|`
   - The shape is divided by its RMS over the span (`sqrt(7/12)` for attack and decay, `sqrt(7/16)` for impulse), so it redistributes energy in time without changing the total. In temporal mode the span is the half the block belongs to.
5. Write the scaled tile to bins `96..127`. Bands whose source RMS is at or below `1e-4` stay silent.

Synthesis adds no noise of its own. The source tile is read after the JPEG transport and already carries its quantization noise, which makes it about as noise-like as the highband it stands in for; whitening covers the remaining cases.
For stereo decode, mid and side are synthesized with their own parameters and then projected onto the subgroup's stereo cue, so cancellation-sensitive panning survives the mid/side round-trip more reliably.

## Encoder Analysis

Analysis is closed-loop: the target is the clean highband (bins `96..127`), the source is the lowband as the decoder will read it back after the target JPEG transport (see Audio Row Math). Quantization noise in bins `64..95` therefore counts as source energy, as it will at synthesis.

Energies are measured on the MDCT pseudo-spectrum, `(X[k]^2 + (X[k+1] - X[k-1])^2) / 3`, which sums to the same energy as `X[k]^2` on average but depends far less on the phase of a stationary tone.

Per subgroup:
- **Patch mode**: each mode gets the overall gain that matches its own source tile to the target; the mode whose band energies then deviate least from the target wins. For stereo subgroups with a strongly coherent highband, mid and side share the mode that fits both best.
- **Gains**: each time segment's gain is its target / source energy ratio for the chosen tile. Normal mode stores the first half's gain and the second half's as a delta. Temporal mode fits each half's gain and quarter delta to its two quarter gains by least squares in dB; a quarter with nothing to recreate does not constrain the fit and gets the lower gain.
- **Band envelope**: the per-band target / source ratios over the whole subgroup, relative to its overall gain.
- **Mode**: both parameter sets are fitted, and each is scored by the envelope it makes the decoder synthesize: source energy times the stored (quantized) gains and shapes, compared with the target per band over segments of 8 blocks, as squared dB error limited to 20 dB per segment, skipping segments where the target is silent. Temporal mode is used when it scores strictly better. The decoder follows the source's energy block by block in either mode, so only changes the source does not make itself call for the finer time resolution.
- **Tonality**: spectral flatness is measured per band on time-averaged bin powers. The source tile is whitened only as far as needed to become as flat as the target.
- **Transient shape**: the shape whose envelope, applied to the gained source, tracks the per-block target energy best, used only if it beats the flat envelope by 10 %.
- For stereo, a 3-bit cue per subgroup describes HF sign and coherence between mid and side.

## Usage in Format

SBR keeps payload at 96 stored bins per block while reconstructing full 128-bin IMDCT input.
