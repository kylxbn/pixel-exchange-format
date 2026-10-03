# PXF v300 -> v301: audio quality through the Facebook JPEG channel

Companion to the v301 entry in [CHANGELOG.md](../../CHANGELOG.md). All numbers come from the three benchmark reports under `doc/artifacts/peaq-reports/` and from the codec sources at the commits named below; nothing here was re-measured.

| Report | Codec state | Tracks | Generated |
| --- | --- | ---: | --- |
| `v300/report.json` | `a374eff` (last commit before `61e86ba`) | 25 | 2026-05-21 |
| `v301/report.json` | `65763e1` (v301: mapping order, stereo-cue SBR, silence fix) | 25 | 2026-05-21 |
| `20260702-214454/report.json` | `412b0f5` (v301 + 4:2:0 chroma superblocks) | 36 | 2026-07-02 |

## Headline

- v300 -> v301, 25 tracks, paired: mean ODG -1.401 -> -1.367 (dODG +0.034, SE 0.012), median -1.248 -> -1.242, worst track -3.144 -> -2.899. 20 tracks improved, 4 regressed, 1 unchanged (sign test p = 0.0015; Wilcoxon signed-rank p = 0.0004). At a +/-0.05 ODG threshold: 6 improved, 1 regressed, 18 within. Effective bitrate +1.9 kbps (+0.9 % JPEG bytes).
- v301 -> v301 + chroma superblocks, 23 common tracks, paired: dODG +0.018 (SE 0.007), 17 improved / 6 regressed (sign p = 0.035; Wilcoxon p = 0.010), at +/-0.05: 3 improved / 0 regressed / 20 within. Effective bitrate -1.6 kbps (-0.75 % JPEG bytes). ODG is a small net positive; the measurable effect is on size.
- Cumulative v300 -> v301 + superblocks, 23 common tracks: dODG +0.053 (SE 0.014), 19 improved / 4 regressed, at +/-0.05: 9 / 0 / 14, JPEG bytes +0.15 %.
- Release verification, 36 tracks, both ends built from their commits (section 5b): v300 -1.473 -> v301 release -1.405, dODG +0.068 (SE 0.014), 31 improved / 5 regressed, at +/-0.05: 15 / 0 / 21 (sign p = 1.3e-05); bitrate +0.1 %. v300 images decoded by the release decoder match v300's own decoder within 0.007 ODG per track.
- The gain is concentrated in the tracks that scored worst on v300: the six tracks with v300 ODG <= -2.0 improved by +0.105 on average, the other nineteen by +0.011 (corr(v300 ODG, dODG) = -0.68).

## 1. Methodology

### Pipeline

`scripts/odg_report.py` runs, per WAV:

1. `node cli/dist/index.cjs encode <wav> -o encoded.png` (one or more 1024 px wide PNGs; 2 to 6 per track here).
2. Each PNG through the Facebook-equivalent transport: `magick <png> ppm:- | cjpeg -quality 92 -sample 2x2,1x1,1x1 -dct int -optimize > <jpg>`. This recipe was established in [doc/facebook-jpeg-encoder/findings-2026-05-19.md](../facebook-jpeg-encoder/findings-2026-05-19.md): for the probe image, Facebook's output is a coefficient-exact match for libjpeg's integer DCT at Q92, 4:2:0, baseline, and after stripping the APP2 ICC segment the entropy-coded stream is byte-identical to `cjpeg -dct int -optimize`. `-optimize` only changes Huffman tables, not quantized coefficients, so it affects the size numbers below but not the decoded audio.
3. `node cli/dist/index.cjs decode <jpg...> -o decoded.wav`.
4. `peaq --advanced <source.wav> <decoded.wav>` (GstPEAQ), parsing `Objective Difference Grade` and `Distortion Index`.
5. Sample-domain stats on the 16-bit PCM (RMSE, MAE, max error, SNR).

`scripts/compare_odg_reports.py before.json after.json` prints the paired comparison; the paired statistics below were computed from the same JSON with a throwaway script (exact two-sided sign test and exact Wilcoxon signed-rank with zero-differences dropped and average ranks for ties).

### Corpus

Full-length commercial recordings, all 44.1 kHz / 16-bit / 2-channel WAV (verified from `source_wav` in every row of all three reports). The 25-track set runs 143 s to 439 s per track, 106.9 min total. The 36-track set is 146.5 min total and is not a superset of the 25: 23 tracks are shared, two were dropped (`Fearofdark - Surfing on a Sine Wave`, `日向めぐみ (グミ) - Catch You Catch Me`) and 13 were added, including three 21-23 s EBU SQAM speech excerpts and a 74 s track, so its summary is not directly comparable to the 25-track summaries. Genre spread covers orchestral, piano, jazz, bossa nova, rock, metal, hip hop, reggaeton, synth pop, chiptune, enka and J-pop.

### Metrics

- **ODG** (Objective Difference Grade, PEAQ advanced model, ITU-R BS.1387): 0 = imperceptible difference, -1 = perceptible but not annoying, -2 = slightly annoying, -3 = annoying, -4 = very annoying. GstPEAQ prints three decimals.
- **DI** (Distortion Index): the model's internal pre-mapping output; higher is better, no fixed bounds. Reported because it has more dynamic range than ODG at the extremes (ODG saturates towards -4).
- **Effective bitrate**: `transport_total_bytes * 8 / duration_s / 1000`, i.e. the sum of the post-transport JPEG sizes over the audio duration. PXF has no rate control; image geometry is fixed by the format (one 8x8 block per 128-sample MDCT hop, 124 data blocks + 4 metadata blocks per 1024 px row), so the raw pixel payload per second of audio is constant. What varies between codec versions is how compressible those pixels are for the JPEG entropy coder, and that is what this number measures. It is a cost of the chosen pixel layout, not a dial. The report also carries `png_total_bytes` (pre-transport PNG size) and `encoded_to_source_ratio` (JPEG bytes / WAV bytes).
- **PCM SNR**: 16-bit sample-domain SNR against the source. Of limited meaning for a codec whose top 32 MDCT bins (SBR, bins 96..127) are parametrically synthesized rather than waveform-matched; included because it moves in the same direction as ODG here and separates coefficient-survival effects from perceptual ones.

### Caveats

- One JPEG operating point only (libjpeg Q92, 4:2:0, int DCT). The q92pm8 mapping is explicitly tuned to that point; its behaviour at other qualities or with other encoders (mozjpeg, jpegli, progressive) is unmeasured.
- The PEAQ advanced model is a model. Differences of a few hundredths of an ODG are not perceptual claims; the +/-0.05 threshold used in the counts below is a working resolution, not a calibrated JND. Paired tests across tracks are the stronger evidence than any single-track delta.
- The 25-track set is the material the codec has been checked against throughout development (the block-order experiments in [doc/EXPERIMENTS.md](../EXPERIMENTS.md) report ODG on an unspecified set and a much older codec state). Treat it as a development set, not a held-out test set. The q92pm8 mapping itself was derived from JPEG quantization tables with no audio in the loop; the stereo-cue thresholds and the SBR silence threshold are hand-set constants.
- All three reports predate the decoder-side SBR subgroup-partition fix described in the 2026-10-03 changelog entry (the decoder assumed a fixed 62/62 split on the last, partial row of each image). Only that row per image is affected, but the final v301 release numbers will differ slightly from these.
- Single run per track; the pipeline is deterministic (seeded SBR noise, integer JPEG DCT), so there is no run-to-run variance to report.

## 2. What changed between the three code states

Mechanism summary; see the changelog for the full list.

**v300 -> v301 (`a374eff` -> `65763e1`)**

1. **Coefficient placement** (`61e86ba`). MDCT bins are placed into the 8x8 luma DCT block (and 4x4 chroma) in `q92pm8` order instead of JPEG zigzag. `q92pm8` sorts the 64 luma positions by a triangular-weighted average (weights 1..9..1 over Q84..Q100, centred on Q92) of ImageMagick/libjpeg quantizer step sizes, lowest step first, ties broken by the Q92 value then zigzag slot (`codec/scripts/generate_jpeg_quant_preset.py`, tables in `doc/notes/jpeg-q84-q100-q92pm8-quant-rankings.txt`). At Q92 the luma DC step is 3 while the first few AC positions have step 2, so DC drops to rank 8 and MDCT bin 0 lands at DCT position (2,0). The intent is that the lowest, most energetic MDCT bins sit in the positions the Q92 quantizer damages least.
2. **Stereo-cue SBR** (`a4af3ce`). The v300 SBR word's 2-bit processing mode (always written as 0 by the v300 encoder) and one bit of tonality (3 -> 2 bits) are repurposed into a 3-bit stereo cue per subgroup: a sign bit and a 2-bit coherence class from the weighted mid/side cross-correlation over bins 96..127 (class thresholds 0.20 / 0.50 / 0.80). The encoder now encodes mid and side rows together; when coherence class >= 2 it locks both channels to one patch mode (minimum combined energy mismatch) and recomputes the band envelopes. The decoder synthesizes the mid/side HF noise from a shared generator mixed by `sqrt(sharedAmount)` with `sharedAmount` in {0, 0.33, 0.67, 1.0}, then projects the mid/side HF bins onto their per-band principal axis with the residual scaled by {1.0, 0.7, 0.35, 0.0}, energy-normalized per bin.
3. **Silence handling** (`65763e1`). SBR analysis returns gain -48 dB / tonality 0 / noise 0 when both the target band (96..127) and the source band (64..95) average below a per-bin RMS of 1e-4, and unmeasurable gain defaults to -48 dB instead of 0 dB. SBR synthesis zeroes any band whose actual source RMS is <= 1e-4 instead of filling it with scaled noise. The synthesis gate is not version-gated, so it also applies when decoding v300 images.

**v301 -> v301 + superblocks (`65763e1` -> `412b0f5`)**

4. **4:2:0 chroma superblocks**. One 8x8 Cb and one 8x8 Cr coefficient block now spans a 2x2 group of luma blocks (16x16 px). Each luma block's 16 chroma bins are interleaved into the shared block at importance rank `4k + ordinal` of the q92pm8 8x8 chroma map, chroma scales are resolved per row pair with an iterative shrink so the summed superblock does not clip, and the decoder reads the whole 16x16 px region back through nearest-neighbour chroma upsampling. Data rows are padded to an even count. Format version stays 301.

## 3. v300 -> v301 (25 tracks)

### Aggregate

| Metric | v300 | v301 | Delta |
| --- | ---: | ---: | ---: |
| ODG mean | -1.401 | -1.367 | +0.034 |
| ODG median | -1.248 | -1.242 | +0.006 |
| ODG min (worst track) | -3.144 | -2.899 | +0.245 |
| ODG max (best track) | -0.463 | -0.406 | +0.057 |
| ODG std dev across tracks | 0.649 | 0.611 | -0.038 |
| Tracks with ODG > -1 | 7 | 7 | 0 |
| Tracks with ODG < -2 | 6 | 4 | -2 |
| DI mean | 0.498 | 0.538 | +0.040 |
| Effective bitrate, per-track mean (kbps) | 212.4 | 214.3 | +1.9 |
| Effective bitrate, overall (kbps) | 213.3 | 215.2 | +1.9 |
| Total JPEG bytes | 171,021,029 | 172,520,146 | +0.88 % |
| Total PNG bytes (pre-transport) | 843,988,557 | 844,103,209 | +0.01 % |
| JPEG / source WAV | 0.1511 | 0.1525 | +0.0013 |
| PCM SNR mean (dB) | 18.35 | 18.75 | +0.40 |

### Paired statistics (per-track differences, v301 - v300)

| Statistic | ODG | DI | kbps | SNR (dB) |
| --- | ---: | ---: | ---: | ---: |
| Mean delta | +0.034 | +0.040 | +1.87 | +0.40 |
| Median delta | +0.015 | +0.019 | +1.72 | +0.41 |
| Std dev of delta | 0.059 | 0.073 | 1.17 | 0.14 |
| SE of mean delta | 0.012 | 0.015 | 0.23 | 0.03 |
| Improved / regressed / unchanged (strict sign) | 20 / 4 / 1 | | | |
| Improved / regressed / within (+/-0.05) | 6 / 1 / 18 | | | |
| Sign test, two-sided p (24 non-zero) | 0.0015 | | | |
| Wilcoxon signed-rank W+ / W- (n = 24) | 266 / 34 | | | |
| Wilcoxon exact two-sided p | 0.0004 | | | |

Every track's PCM SNR rose (min +0.06 dB, max +0.69 dB). Only two tracks got smaller JPEGs (by under 0.5 kbps); the rest grew by 0.8 to 4.5 kbps.

Split by v300 score: the six tracks at or below -2.0 on v300 (Sacre I, Hotel California, Look Of Love, Katamari, Batucada, Surfing on a Sine Wave) gained +0.105 mean / +0.097 median; the other nineteen gained +0.011 / +0.013.

### Largest movers

Improvements:

| Track | v300 | v301 | dODG |
| --- | ---: | ---: | ---: |
| Orchestre de Paris - Le Sacre du Printemps, I. Introduction | -3.144 | -2.899 | +0.245 |
| Sergio Mendes & Brasil 66 - Batucada | -2.083 | -1.965 | +0.118 |
| Fearofdark - Rolling Down The Street, In My Katamari | -2.258 | -2.153 | +0.105 |
| Sergio Mendes & Brasil 66 - The Look Of Love | -2.271 | -2.182 | +0.089 |
| Chief Keef - Love Sosa | -1.342 | -1.278 | +0.064 |
| Chamillionaire - Ridin' | -0.463 | -0.406 | +0.057 |

Regressions:

| Track | v300 | v301 | dODG |
| --- | ---: | ---: | ---: |
| 広瀬香美 - Groovy! | -1.505 | -1.567 | -0.062 |
| Bad Bunny - Tití Me Preguntó | -1.612 | -1.623 | -0.011 |
| キャラメル - ウッーウッーウマウマ(ﾟ∀ﾟ) (Speedycake Remix) | -0.683 | -0.689 | -0.006 |
| 日向めぐみ (グミ) - Catch You Catch Me | -0.936 | -0.940 | -0.004 |

Only `Groovy!` exceeds the 0.05 working threshold; it recovers +0.043 under the superblock change (section 4).

### Per-track table (25 tracks, sorted by dODG)

| Track | ODG v300 | ODG v301 | dODG | DI v300 | DI v301 | kbps v300 | kbps v301 | SNR v300 | SNR v301 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Orchestre de Paris - Le Sacre du Printemps - Pt. 1: L'Adoration de la Terre: I. Introduction | -3.144 | -2.899 | +0.245 | -1.393 | -1.060 | 183.5 | 183.1 | 20.82 | 21.19 |
| Sergio Mendes & Brasil 66 - Batucada | -2.083 | -1.965 | +0.118 | -0.194 | -0.081 | 198.5 | 201.3 | 17.57 | 18.04 |
| Fearofdark - Rolling Down The Street, In My Katamari | -2.258 | -2.153 | +0.105 | -0.364 | -0.261 | 204.4 | 206.0 | 16.60 | 16.91 |
| Sergio Mendes & Brasil 66 - The Look Of Love (Album Version) | -2.271 | -2.182 | +0.089 | -0.376 | -0.290 | 198.2 | 200.4 | 16.25 | 16.66 |
| Chief Keef - Love Sosa | -1.342 | -1.278 | +0.064 | 0.524 | 0.590 | 208.3 | 212.7 | 23.89 | 24.52 |
| Chamillionaire - Ridin' (Album Version) | -0.463 | -0.406 | +0.057 | 1.638 | 1.742 | 204.4 | 206.8 | 19.09 | 19.53 |
| Samantha James - Rise | -1.048 | -1.010 | +0.038 | 0.839 | 0.882 | 196.2 | 198.0 | 18.99 | 19.41 |
| Fearofdark - Surfing on a Sine Wave | -2.034 | -1.996 | +0.038 | -0.147 | -0.111 | 207.6 | 208.6 | 17.01 | 17.41 |
| Eagles - Hotel California (2013 Remaster) | -2.384 | -2.350 | +0.034 | -0.489 | -0.455 | 203.2 | 204.6 | 17.79 | 18.12 |
| 山下達郎 - RIDE ON TIME (シングル・ヴァージョン) | -1.169 | -1.138 | +0.031 | 0.705 | 0.739 | 216.2 | 220.2 | 19.01 | 19.61 |
| Mariah Carey - All I Want for Christmas Is You | -1.279 | -1.260 | +0.019 | 0.589 | 0.608 | 230.1 | 229.8 | 16.96 | 17.23 |
| Luis Fonsi & Daddy Yankee - Despacito | -1.149 | -1.131 | +0.018 | 0.727 | 0.746 | 209.3 | 211.3 | 18.85 | 19.25 |
| Air Supply - Making Love Out Of Nothing At All (Digitally Remastered 1999) | -0.951 | -0.936 | +0.015 | 0.950 | 0.968 | 229.4 | 230.9 | 19.12 | 19.43 |
| Orchestre de Paris - Le Sacre du Printemps - Pt. 1: L'Adoration de la Terre: II. Les augures printaniers | -1.612 | -1.599 | +0.013 | 0.256 | 0.269 | 200.2 | 201.1 | 19.89 | 20.57 |
| Belphegor - Baphomet | -0.521 | -0.508 | +0.013 | 1.540 | 1.563 | 227.5 | 230.0 | 19.10 | 19.60 |
| 石川さゆり - 女人荒野 | -1.240 | -1.227 | +0.013 | 0.630 | 0.643 | 228.9 | 229.7 | 18.79 | 19.31 |
| Depeche Mode - People Are People (2006 Remaster) | -1.248 | -1.242 | +0.006 | 0.621 | 0.627 | 206.4 | 210.0 | 16.60 | 16.66 |
| Dragonforce - Through The Fire And Flames | -0.710 | -0.705 | +0.005 | 1.257 | 1.264 | 230.2 | 232.3 | 17.43 | 17.71 |
| Scorpions - Always Somewhere | -1.285 | -1.282 | +0.003 | 0.583 | 0.586 | 221.2 | 223.0 | 16.07 | 16.35 |
| New Order - Regret | -0.932 | -0.930 | +0.002 | 0.973 | 0.976 | 219.5 | 221.5 | 17.96 | 18.38 |
| The Winstons - Amen Brother | -1.170 | -1.170 | +0.000 | 0.704 | 0.704 | 224.8 | 226.4 | 18.59 | 19.01 |
| 日向めぐみ (グミ) - Catch You Catch Me | -0.936 | -0.940 | -0.004 | 0.968 | 0.963 | 216.5 | 217.7 | 18.24 | 18.61 |
| キャラメル - ウッーウッーウマウマ(ﾟ∀ﾟ) (Speedycake Remix) | -0.683 | -0.689 | -0.006 | 1.295 | 1.287 | 226.9 | 228.2 | 16.51 | 16.82 |
| Bad Bunny - Tití Me Preguntó | -1.612 | -1.623 | -0.011 | 0.257 | 0.246 | 203.9 | 207.2 | 20.50 | 21.00 |
| 広瀬香美 - Groovy! | -1.505 | -1.567 | -0.062 | 0.361 | 0.300 | 214.2 | 215.5 | 17.22 | 17.46 |

## 4. v301 -> v301 + chroma superblocks

### 23 common tracks, paired

| Metric | v301 | v301 + SB | Delta |
| --- | ---: | ---: | ---: |
| ODG mean | -1.359 | -1.341 | +0.018 |
| ODG median | -1.242 | -1.243 | -0.001 |
| ODG min | -2.899 | -2.895 | +0.004 |
| ODG max | -0.406 | -0.407 | -0.001 |
| DI mean | 0.548 | 0.566 | +0.019 |
| Effective bitrate, per-track mean (kbps) | 214.3 | 212.8 | -1.6 |
| Effective bitrate, overall (kbps) | 215.4 | 213.8 | -1.6 |
| Total JPEG bytes | 158,433,514 | 157,246,093 | -0.75 % |
| Total PNG bytes (pre-transport) | 775,265,321 | 782,372,417 | +0.92 % |
| JPEG / source WAV | 0.1526 | 0.1515 | -0.0011 |
| PCM SNR mean (dB) | 18.82 | 18.82 | -0.00 |

| Statistic | ODG | DI | kbps | SNR (dB) |
| --- | ---: | ---: | ---: | ---: |
| Mean delta | +0.018 | +0.019 | -1.57 | -0.00 |
| Median delta | +0.017 | +0.019 | -1.64 | +0.00 |
| Std dev of delta | 0.031 | 0.032 | 0.74 | 0.03 |
| SE of mean delta | 0.007 | 0.007 | 0.15 | 0.01 |
| Improved / regressed / unchanged (strict sign) | 17 / 6 / 0 | | | |
| Improved / regressed / within (+/-0.05) | 3 / 0 / 20 | | | |
| Sign test, two-sided p | 0.035 | | | |
| Wilcoxon signed-rank W+ / W- (n = 23) | 220.5 / 55.5 | | | |
| Wilcoxon exact two-sided p | 0.010 | | | |

22 of 23 tracks produced smaller JPEGs (per-track byte ratio 0.987 to 1.002, mean 0.993) while the PNGs got about 1 % larger. PCM SNR is unchanged to within 0.07 dB on every track, which is consistent with the change touching only chroma (bins 64..95) and not the luma path. The ODG movement is small, positive on average, and statistically distinguishable from zero on the paired tests, but only three tracks clear the +/-0.05 threshold and none regress past it; the change should be read as a size/robustness change that did not cost quality, not as a quality change.

Largest movers:

| Track | v301 | v301 + SB | dODG |
| --- | ---: | ---: | ---: |
| Eagles - Hotel California (2013 Remaster) | -2.350 | -2.233 | +0.117 |
| Air Supply - Making Love Out Of Nothing At All | -0.936 | -0.884 | +0.052 |
| Sergio Mendes & Brasil 66 - The Look Of Love | -2.182 | -2.131 | +0.051 |
| 広瀬香美 - Groovy! | -1.567 | -1.524 | +0.043 |
| Scorpions - Always Somewhere | -1.282 | -1.321 | -0.039 |
| Samantha James - Rise | -1.010 | -1.031 | -0.021 |
| Depeche Mode - People Are People (2006 Remaster) | -1.242 | -1.262 | -0.020 |

### Per-track table (23 tracks, sorted by dODG)

| Track | ODG v301 | ODG v301+SB | dODG | DI v301 | DI v301+SB | kbps v301 | kbps v301+SB | SNR v301 | SNR v301+SB |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Eagles - Hotel California (2013 Remaster) | -2.350 | -2.233 | +0.117 | -0.455 | -0.340 | 204.6 | 203.0 | 18.12 | 18.12 |
| Air Supply - Making Love Out Of Nothing At All (Digitally Remastered 1999) | -0.936 | -0.884 | +0.052 | 0.968 | 1.031 | 230.9 | 228.7 | 19.43 | 19.42 |
| Sergio Mendes & Brasil 66 - The Look Of Love (Album Version) | -2.182 | -2.131 | +0.051 | -0.290 | -0.240 | 200.4 | 199.4 | 16.66 | 16.69 |
| 広瀬香美 - Groovy! | -1.567 | -1.524 | +0.043 | 0.300 | 0.342 | 215.5 | 213.2 | 17.46 | 17.44 |
| Fearofdark - Rolling Down The Street, In My Katamari | -2.153 | -2.117 | +0.036 | -0.261 | -0.227 | 206.0 | 203.4 | 16.91 | 16.92 |
| 山下達郎 - RIDE ON TIME (シングル・ヴァージョン) | -1.138 | -1.103 | +0.035 | 0.739 | 0.777 | 220.2 | 218.5 | 19.61 | 19.61 |
| New Order - Regret | -0.930 | -0.900 | +0.030 | 0.976 | 1.012 | 221.5 | 219.5 | 18.38 | 18.38 |
| The Winstons - Amen Brother | -1.170 | -1.149 | +0.021 | 0.704 | 0.726 | 226.4 | 224.9 | 19.01 | 19.02 |
| 石川さゆり - 女人荒野 | -1.227 | -1.207 | +0.020 | 0.643 | 0.664 | 229.7 | 227.2 | 19.31 | 19.31 |
| Sergio Mendes & Brasil 66 - Batucada | -1.965 | -1.948 | +0.017 | -0.081 | -0.065 | 201.3 | 201.7 | 18.04 | 18.06 |
| Dragonforce - Through The Fire And Flames | -0.705 | -0.688 | +0.017 | 1.264 | 1.288 | 232.3 | 231.5 | 17.71 | 17.71 |
| Mariah Carey - All I Want for Christmas Is You | -1.260 | -1.243 | +0.017 | 0.608 | 0.627 | 229.8 | 227.5 | 17.23 | 17.25 |
| キャラメル - ウッーウッーウマウマ(ﾟ∀ﾟ) (Speedycake Remix) | -0.689 | -0.673 | +0.016 | 1.287 | 1.309 | 228.2 | 227.2 | 16.82 | 16.77 |
| Orchestre de Paris - Le Sacre du Printemps - Pt. 1: L'Adoration de la Terre: II. Les augures printaniers | -1.599 | -1.584 | +0.015 | 0.269 | 0.283 | 201.1 | 200.6 | 20.57 | 20.57 |
| Luis Fonsi & Daddy Yankee - Despacito | -1.131 | -1.119 | +0.012 | 0.746 | 0.759 | 211.3 | 209.1 | 19.25 | 19.25 |
| Orchestre de Paris - Le Sacre du Printemps - Pt. 1: L'Adoration de la Terre: I. Introduction | -2.899 | -2.895 | +0.004 | -1.060 | -1.055 | 183.1 | 181.6 | 21.19 | 21.18 |
| Chief Keef - Love Sosa | -1.278 | -1.277 | +0.001 | 0.590 | 0.591 | 212.7 | 211.8 | 24.52 | 24.54 |
| Chamillionaire - Ridin' (Album Version) | -0.406 | -0.407 | -0.001 | 1.742 | 1.739 | 206.8 | 205.5 | 19.53 | 19.54 |
| Belphegor - Baphomet | -0.508 | -0.512 | -0.004 | 1.563 | 1.556 | 230.0 | 229.0 | 19.60 | 19.60 |
| Bad Bunny - Tití Me Preguntó | -1.623 | -1.631 | -0.008 | 0.246 | 0.239 | 207.2 | 205.1 | 21.00 | 21.01 |
| Depeche Mode - People Are People (2006 Remaster) | -1.242 | -1.262 | -0.020 | 0.627 | 0.607 | 210.0 | 208.1 | 16.66 | 16.64 |
| Samantha James - Rise | -1.010 | -1.031 | -0.021 | 0.882 | 0.858 | 198.0 | 196.5 | 19.41 | 19.45 |
| Scorpions - Always Somewhere | -1.282 | -1.321 | -0.039 | 0.586 | 0.545 | 223.0 | 220.9 | 16.35 | 16.28 |

### 36-track summary (v301 + superblocks only; no paired baseline)

| Metric | 36 tracks | 23 shared with the 25-set | 13 new |
| --- | ---: | ---: | ---: |
| ODG mean | -1.404 | -1.341 | -1.516 |
| ODG median | -1.269 | -1.243 | -1.371 |
| ODG min | -3.209 (Moonlight Sonata) | -2.895 | -3.209 |
| ODG max | -0.175 (ヒビカセ) | -0.407 | -0.175 |
| DI mean | 0.509 | 0.566 | 0.408 |
| Effective bitrate, per-track mean (kbps) | 205.4 | 212.8 | 192.5 |
| Effective bitrate, overall (kbps) | 210.2 | 213.8 | |
| JPEG / source WAV | 0.1489 | 0.1515 | |
| PCM SNR mean (dB) | 19.32 | 18.82 | 20.22 |
| Total duration (min) | 146.5 | 98.1 | 48.4 |

The 36-track mean (-1.404) is lower than the 25-track v301 mean (-1.367) because the added material is harder, not because the superblock change regressed: the 23 shared tracks moved from -1.359 to -1.341. The three new tracks under -2.0 are solo piano (`Moonlight Sonata`, -3.209, 152.8 kbps), speech (`EBU SQAM Female English`, -2.370) and a sparse chiptune (`doodle`, -2.678); together with `Sacre I` they describe the codec's current weak spot (sparse, quiet, tonal material with a long decay) better than the 25-set did.

| Track | Dur (s) | ODG | DI | kbps | SNR (dB) | In 25-set |
| --- | ---: | ---: | ---: | ---: | ---: | :---: |
| ギガれをる feat. 初音ミク - ヒビカセ | 260 | -0.175 | 2.266 | 208.0 | 16.73 | no |
| Chamillionaire - Ridin' (Album Version) | 303 | -0.407 | 1.739 | 205.5 | 19.54 | yes |
| Belphegor - Baphomet | 287 | -0.512 | 1.556 | 229.0 | 19.60 | yes |
| 黄桜白鶴 - モノクロドロシー | 284 | -0.559 | 1.480 | 233.9 | 17.85 | no |
| キャラメル - ウッーウッーウマウマ(ﾟ∀ﾟ) (Speedycake Remix) | 175 | -0.673 | 1.309 | 227.2 | 16.77 | yes |
| Dragonforce - Through The Fire And Flames | 439 | -0.688 | 1.288 | 231.5 | 17.71 | yes |
| Whitechapel - Diabolic Slumber | 270 | -0.786 | 1.156 | 233.4 | 20.24 | no |
| Air Supply - Making Love Out Of Nothing At All (Digitally Remastered 1999) | 342 | -0.884 | 1.031 | 228.7 | 19.42 | yes |
| New Order - Regret | 251 | -0.900 | 1.012 | 219.5 | 18.38 | yes |
| Samantha James - Rise | 264 | -1.031 | 0.858 | 196.5 | 19.45 | yes |
| 山下達郎 - RIDE ON TIME (シングル・ヴァージョン) | 265 | -1.103 | 0.777 | 218.5 | 19.61 | yes |
| Luis Fonsi & Daddy Yankee - Despacito | 232 | -1.119 | 0.759 | 209.1 | 19.25 | yes |
| Casiopea - Swear | 408 | -1.140 | 0.736 | 204.8 | 17.92 | no |
| The Winstons - Amen Brother | 157 | -1.149 | 0.726 | 224.9 | 19.02 | yes |
| Vengaboys - Boom, Boom, Boom, Boom!! | 202 | -1.168 | 0.706 | 206.2 | 20.14 | no |
| 石川さゆり - 女人荒野 | 260 | -1.207 | 0.664 | 227.2 | 19.31 | yes |
| Mariah Carey - All I Want for Christmas Is You | 242 | -1.243 | 0.627 | 227.5 | 17.25 | yes |
| Depeche Mode - People Are People (2006 Remaster) | 232 | -1.262 | 0.607 | 208.1 | 16.64 | yes |
| Chief Keef - Love Sosa | 246 | -1.277 | 0.591 | 211.8 | 24.54 | yes |
| Scorpions - Always Somewhere | 298 | -1.321 | 0.545 | 220.9 | 16.28 | yes |
| EBU SQAM - Speech, Male German (Track 54) | 21 | -1.329 | 0.538 | 161.8 | 18.73 | no |
| EBU SQAM - Speech, Male English (Track 50) | 22 | -1.371 | 0.495 | 147.2 | 19.81 | no |
| Wolfgang Amadeus Mozart - Requiem - Lacrimosa | 250 | -1.384 | 0.481 | 213.1 | 20.51 | no |
| 広瀬香美 - Groovy! | 262 | -1.524 | 0.342 | 213.2 | 17.44 | yes |
| Orchestre de Paris - Le Sacre du Printemps - Pt. 1: L'Adoration de la Terre: II. Les augures printaniers | 197 | -1.584 | 0.283 | 200.6 | 20.57 | yes |
| PrismCorp Virtual Enterprises - Seasons | 329 | -1.599 | 0.269 | 210.7 | 23.59 | no |
| Bad Bunny - Tití Me Preguntó | 244 | -1.631 | 0.239 | 205.1 | 21.01 | yes |
| Dave Brubeck - Take Five | 325 | -1.935 | -0.053 | 210.1 | 19.40 | no |
| Sergio Mendes & Brasil 66 - Batucada | 143 | -1.948 | -0.065 | 201.7 | 18.06 | yes |
| Fearofdark - Rolling Down The Street, In My Katamari | 276 | -2.117 | -0.227 | 203.4 | 16.92 | yes |
| Sergio Mendes & Brasil 66 - The Look Of Love (Album Version) | 166 | -2.131 | -0.240 | 199.4 | 16.69 | yes |
| Eagles - Hotel California (2013 Remaster) | 391 | -2.233 | -0.340 | 203.0 | 18.12 | yes |
| EBU SQAM - Speech, Female English (Track 49) | 23 | -2.370 | -0.475 | 146.8 | 18.65 | no |
| Zachz Winner - doodle | 74 | -2.678 | -0.800 | 173.1 | 21.40 | no |
| Orchestre de Paris - Le Sacre du Printemps - Pt. 1: L'Adoration de la Terre: I. Introduction | 214 | -2.895 | -1.055 | 181.6 | 21.18 | yes |
| Ludwig van Beethoven - Moonlight Sonata I. Adagio sostenuto | 437 | -3.209 | -1.492 | 152.8 | 27.92 | no |

## 5. Cumulative: v300 -> v301 + superblocks (23 common tracks)

| Metric | v300 | v301 + SB | Delta |
| --- | ---: | ---: | ---: |
| ODG mean | -1.394 | -1.341 | +0.053 |
| ODG median | -1.248 | -1.243 | +0.005 |
| ODG min | -3.144 | -2.895 | +0.249 |
| DI mean | 0.506 | 0.566 | +0.061 |
| Effective bitrate, overall (kbps) | 213.5 | 213.8 | +0.3 |
| Total JPEG bytes | 157,005,905 | 157,246,093 | +0.15 % |
| PCM SNR mean (dB) | 18.42 | 18.82 | +0.40 |

Paired: mean dODG +0.053 (SE 0.014), median +0.032; 19 improved / 4 regressed / 0 unchanged (sign p = 0.0026), Wilcoxon W+ = 248 / W- = 28 (p = 0.0003); at +/-0.05: 9 improved / 0 regressed / 14 within. Five tracks gained more than +0.13 (Sacre I +0.249, Hotel California +0.151, Katamari +0.141, Look Of Love +0.140, Batucada +0.135). The largest cumulative regression is Scorpions - Always Somewhere at -0.036. The bitrate cost of the mapping change (+0.88 %) and the saving from the superblocks (-0.75 %) roughly cancel, so the released v301 layout costs about the same number of JPEG bytes as v300.

## 5b. Release verification: v300 -> v301 release (36 tracks)

Run on 2026-10-03 with both ends built from their commits: v300 from `a374eff` (worktree build), v301 from the released cleanup (`v301-release`). Same corpus, same transport recipe. A third run encodes with v300 and decodes with the release decoder to verify the block-map compatibility fix (`--decode-cli-entry`, recorded in `meta.decode_cli_entry`).

| | v300 (36) | v301 release (36) | v300 enc. -> v301 release dec. (36) |
| --- | ---: | ---: | ---: |
| ODG mean | -1.473 | -1.405 | -1.474 |
| ODG median | -1.282 | -1.270 | -1.282 |
| ODG min / max | -3.249 / -0.234 | -3.208 / -0.175 | -3.248 / -0.234 |
| Effective bitrate, overall (kbps) | 210.0 | 210.2 | 210.0 |

Paired v300 -> v301 release: mean dODG +0.068 (SE 0.014), median +0.034; improved / regressed / unchanged 31 / 5 / 0; at +/-0.05: 15 / 0 / 21; sign test p = 1.3e-05.

Consistency checks: the fresh v300 run matches the May `v300` report on the 23 shared tracks to within 0.003 ODG; the release build matches the July superblock run (`20260702-214454`) to within 0.007 per track (-0.001 mean), so the SBR subgroup-partition fix is neutral at PEAQ resolution. The cross-version column tracks the pure v300 column to within 0.007 per track (-0.001 mean): v300 images decode correctly on the release decoder.

### Per-track table (36 tracks, sorted by dODG)

| Track | v300 | v301 release | dODG | v300 dec. by v301 |
| --- | ---: | ---: | ---: | ---: |
| EBU SQAM - Speech, Male English (Track 50) | -1.657 | -1.373 | +0.284 | -1.661 |
| EBU SQAM - Speech, Male German (Track 54) | -1.597 | -1.336 | +0.261 | -1.603 |
| Orchestre de Paris - Le Sacre du Printemps - Pt. 1: L'Adoration de la Terre: I. Introduction | -3.145 | -2.899 | +0.246 | -3.152 |
| Zachz Winner - doodle | -2.910 | -2.680 | +0.230 | -2.911 |
| EBU SQAM - Speech, Female English (Track 49) | -2.583 | -2.372 | +0.211 | -2.584 |
| Eagles - Hotel California (2013 Remaster) | -2.382 | -2.234 | +0.148 | -2.385 |
| Fearofdark - Rolling Down The Street, In My Katamari | -2.258 | -2.116 | +0.142 | -2.259 |
| Sergio Mendes & Brasil 66 - Batucada | -2.082 | -1.947 | +0.135 | -2.083 |
| Sergio Mendes & Brasil 66 - The Look Of Love (Album Version) | -2.268 | -2.136 | +0.132 | -2.270 |
| Dave Brubeck - Take Five | -2.021 | -1.936 | +0.085 | -2.023 |
| Air Supply - Making Love Out Of Nothing At All (Digitally Remastered 1999) | -0.951 | -0.884 | +0.067 | -0.951 |
| Chief Keef - Love Sosa | -1.342 | -1.276 | +0.066 | -1.341 |
| 山下達郎 - RIDE ON TIME (シングル・ヴァージョン) | -1.170 | -1.104 | +0.066 | -1.170 |
| ギガれをる feat. 初音ミク - ヒビカセ | -0.234 | -0.175 | +0.059 | -0.234 |
| Chamillionaire - Ridin' (Album Version) | -0.463 | -0.407 | +0.056 | -0.464 |
| Ludwig van Beethoven - Moonlight Sonata I. Adagio sostenuto | -3.249 | -3.208 | +0.041 | -3.248 |
| Wolfgang Amadeus Mozart - Requiem - Lacrimosa | -1.422 | -1.385 | +0.037 | -1.423 |
| Mariah Carey - All I Want for Christmas Is You | -1.279 | -1.244 | +0.035 | -1.279 |
| Vengaboys - Boom, Boom, Boom, Boom!! | -1.201 | -1.168 | +0.033 | -1.201 |
| New Order - Regret | -0.932 | -0.899 | +0.033 | -0.933 |
| 石川さゆり - 女人荒野 | -1.240 | -1.207 | +0.033 | -1.239 |
| PrismCorp Virtual Enterprises - Seasons | -1.631 | -1.600 | +0.031 | -1.631 |
| Luis Fonsi & Daddy Yankee - Despacito | -1.148 | -1.119 | +0.029 | -1.148 |
| Orchestre de Paris - Le Sacre du Printemps - Pt. 1: L'Adoration de la Terre: II. Les augures printaniers | -1.612 | -1.585 | +0.027 | -1.613 |
| Dragonforce - Through The Fire And Flames | -0.711 | -0.689 | +0.022 | -0.711 |
| The Winstons - Amen Brother | -1.169 | -1.149 | +0.020 | -1.171 |
| Samantha James - Rise | -1.047 | -1.031 | +0.016 | -1.049 |
| キャラメル - ウッーウッーウマウマ(ﾟ∀ﾟ) (Speedycake Remix) | -0.683 | -0.673 | +0.010 | -0.683 |
| Whitechapel - Diabolic Slumber | -0.794 | -0.785 | +0.009 | -0.794 |
| Belphegor - Baphomet | -0.521 | -0.512 | +0.009 | -0.522 |
| 黄桜白鶴 - モノクロドロシー | -0.565 | -0.559 | +0.006 | -0.565 |
| Depeche Mode - People Are People (2006 Remaster) | -1.246 | -1.264 | -0.018 | -1.243 |
| Bad Bunny - Tití Me Preguntó | -1.613 | -1.632 | -0.019 | -1.613 |
| 広瀬香美 - Groovy! | -1.502 | -1.525 | -0.023 | -1.505 |
| Casiopea - Swear | -1.111 | -1.140 | -0.029 | -1.112 |
| Scorpions - Always Somewhere | -1.285 | -1.319 | -0.034 | -1.286 |

## 6. Interpretation

Everything in this section is interpretation from the mechanisms, not measured attribution: the v300 -> v301 report bundles three changes and was not ablated.

- **Mapping order -> coefficient survival.** The rise in PCM SNR on every track (+0.06 to +0.69 dB) with essentially unchanged PNG size (+0.01 %) is the signature expected from placing the energetic low MDCT bins into the DCT positions with the smallest Q92 quantizer steps: the same information is written, but less of it is rounded away by the quantizer. The JPEG grew by 0.88 % for the same reason: energy moved out of DC (step 3, cheap to code via DPCM) into early AC positions (step 2) where it costs more entropy-coded bits. SNR is a luma-dominated, waveform-level metric and cannot see the SBR changes, so this is the most direct evidence that the mapping change is doing what the quantizer tables predict. The q92pm8 rankings are tuned to one encoder family; a different quantizer (mozjpeg's tuned tables, jpegli, or Q != 92) would want a different permutation.
- **Why the worst tracks gained most.** The tracks at ODG <= -2 on v300 (orchestral, bossa nova, chiptune, classic rock) are the ones where the Q92 quantizer was already destroying a material fraction of the stored coefficients; a few extra surviving low-bin coefficients matter more there than on dense, loud material that was already at -0.5 to -1.0. The negative correlation between v300 score and gain (-0.68) is consistent with that reading. It also means the mean dODG understates the change where it matters and overstates it for the typical pop track (median +0.015).
- **Stereo-cue SBR -> HF stereo image.** v300 synthesized mid and side HF noise from independent seeds, so above bin 96 the stereo image was always decorrelated regardless of the source. v301 makes the shared-noise fraction and the mid/side projection follow the measured coherence class. PEAQ advanced scores each channel's signal and is not a spatial model, so this change is expected to be nearly invisible to ODG; its benefit is in listening, not in these tables. The patch-mode lock for coherence class >= 2 can also change which source band is copied, and that is visible to PEAQ, in either direction. `Groovy!` (-0.062) is the one track where a per-track regression is large enough to be worth a listen with the stereo cue in mind.
- **Silence handling -> quiet passages.** Before `65763e1`, a subgroup with silent source and target bands got `hfGain = 0 dB`, and its spectral flatness (near 1 for silence) pushed the noise ratio to maximum; synthesis then scaled unit noise by the band's source RMS plus a floor of 1e-3 and applied 0 dB gain, producing a low-level pseudo-random hiss in silence. The fix zeroes those bands outright. On full-length commercial material the affected fraction of blocks is small (track intros, fades, rests), so the aggregate ODG effect is expected to be small; `Sacre I` (quiet, sparse, +0.245) is the obvious candidate for where this and the mapping change stack. PEAQ does weight noise in silence heavily, so where it applies the effect can be large.
- **Chroma superblocks -> JPEG chroma behaviour.** In v300 each 8x8 luma block carried its own 4x4 chroma block, drawn at 2x2 px per chroma sample; after libjpeg's 4:2:0 downsampling, that 4x4 pattern sits inside one quadrant of the 8x8 chroma DCT block the JPEG encoder actually quantizes, and the quantizer sees a block whose four quadrants come from four different audio blocks. v301 + SB writes exactly one 8x8 chroma block per 16x16 px, i.e. the same block the JPEG chroma DCT will see, with the four audio blocks' bins interleaved by importance rank rather than by position. The 0.75 % JPEG saving with a 0.92 % PNG increase is consistent with that: the pixels are less regular (PNG filters like the old repeated 2x2 structure) but the JPEG chroma DCT is now coding a block that was designed as a single DCT block. ODG is flat to slightly positive and SNR unchanged, which is what one expects from a change confined to bins 64..95 (the upper-mid band) at a quantizer where the chroma tables are nearly flat beyond the first few slots (Q92 chroma: 3,3,3,4,3,4,8,4,4,8,16,...).

## 7. Compatibility

- **Encoder** writes format version 301 only. There is no option to emit 300. The header, row-metadata and binary-mode whitening/permutation seeds and the LDPC graphs are unchanged from v300 (the constants keep their `PXF:v300:` derivation), so the framing, header layout and binary mode are bit-identical apart from the version field; only the audio row payload semantics changed.
- **v300 decoders reading v301 images** fail at header parse: the v300 `HeaderDecoder` checks `version !== FORMAT_VERSION` and throws `Unsupported version: 301. This decoder expects 300.`. No partial or garbled decode; this applies to binary images as well, since the version field is written for every mode.
- **v301 decoder reading v300 images.** `SUPPORTED_FORMAT_VERSIONS = [300, 301]` and the decoder gates on the header version for: SBR word layout (legacy bits, 3-bit tonality with the /7 divisor, processing modes honoured), per-block 4x4 chroma instead of superblocks, per-channel independent SBR noise instead of joint synthesis, and the expected image height (v300 data rows are not padded to an even count). The SBR silence gate in synthesis is not version-gated and will also zero near-silent HF bands in v300 images.
- **v300 support in the `65763e1`..`412b0f5` builds was broken.** The coefficient block map (`AUDIO_PSYCHOACOUSTICS.blockMap`, `q92pm8`) was a module-level constant in both encoder and decoder and not selected by header version, while genuine v300 images were written with the `zigzag` map, so those decoders recovered v300 coefficients in scrambled order. Fixed in the 2026-10-03 release cleanup: the decoder now picks the map via `getBlockMapForVersion(headerVersion)`, and `chroma420.test.ts` pins v300 -> zigzag. Verified end-to-end in section 5b: v300-encoded images decoded by the release decoder score within 0.007 ODG per track of v300's own decoder.
- **Mixed pairs.** Mid and side images with different format versions are rejected (`Mid and side channel data do not belong together (format version mismatch)`).
- **v301 without superblocks (`65763e1`) vs with (`412b0f5`).** Both write version 301, but the chroma layout differs and the decoder has no way to tell them apart from the header. Images produced by the intermediate `65763e1`..`7d37f19` encoders decode with correct luma (bins 0..63) but corrupted chroma bins (64..95) on the released decoder, and vice versa. No such images were published; the only ones that existed were the `v301/` benchmark round-trips.

## Appendix: reproducing

```
# rebuild the CLI, then:
python3 scripts/odg_report.py                       # all WAVs in the default input dir
python3 scripts/compare_odg_reports.py \
    doc/artifacts/peaq-reports/v300/report.json \
    doc/artifacts/peaq-reports/v301/report.json
python3 scripts/compare_odg_reports.py \
    doc/artifacts/peaq-reports/v301/report.json \
    doc/artifacts/peaq-reports/20260702-214454/report.json
```

Requires `node`, GstPEAQ's `peaq`, ImageMagick's `magick` and libjpeg-turbo's `cjpeg` on `PATH`. A full 36-track run takes on the order of two hours.
