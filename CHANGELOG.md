# Changelog

## 2026-10-04 - Binary mode moved to DCT-domain modulation

Binary mode now writes its bits as PAM symbols on 8x8 DCT coefficients, on the block grid a 4:2:0 JPEG encoder uses, instead of 4-level luma and 1-bit chroma per pixel. Capacity goes from 2480 bytes per 8 px row (2.42 bits per pixel) to 7296 bytes per 16 px strip (3.56 bits per pixel, +47 %), and the mode tolerates more than before. This replaces the v301 binary layout: binary images from earlier builds do not decode, audio is untouched.

- **Layout.** The unit is a 16 px strip of 64 MCUs. A luma block is one DCT block; a chroma block spans the 16x16 MCU and is written pixel-replicated, the same structure audio mode uses. All 128 block columns carry data.
- **Bit loading.** Each coefficient gets a level spacing of 1.15 (luma) or 1.2 (chroma) times its libjpeg quality-90 quantizer step plus 2, and 1 to 5 bits depending on how much pixel range the spacing costs. That is 211 bits per luma block and 85 per chroma block, 3.96 bits per pixel before coding.
- **Parity at payload density.** The per-row metadata blocks are gone. Each strip is one LDPC codeword (`N = 64896`, `K = 58400`, rate 0.90) holding payload, CRC32C and parity, all modulated the same way. Parity used to sit in 1-bit-per-pixel blocks, which is why a lower code rate looked expensive.
- **RGB cube.** Pixels that leave the RGB cube are clipped and the coefficient damage is pushed back iteratively until every coefficient is within 15 % of a spacing of its symbol.
- **Whitening.** The codeword is XORed with a per-strip mask, and the bit permutation is now one fixed permutation over the whole codeword.
- **Decoder.** Pixels in, as before: RGB to YCbCr, 2x2 chroma average, DCT, then per-bit LLRs from a noise level estimated per coefficient position over the image. It does not read quantization tables or coefficients from a JPEG file.
- **LDPC.** The strip code's graph is built at first use by a deck construction (`buildDeckGraph`, 94 ms) instead of shipped as JSON; `graph_20064_19840_*.json` (1.4 MB) is removed. The decoder's inner loop now runs on flat typed arrays; on the strip code that took a 16-strip decode from 5.3 s to 0.44 s.

Measured with libjpeg-turbo 3.2, 64 strips of random payload per case, against the previous build on the same transports:

| Transport | Before (2.42 bits/px) | Now (3.56 bits/px) |
| --- | --- | --- |
| JPEG 4:2:0 Q92, Q90, box chroma upsampling | intact | intact |
| JPEG 4:2:0 Q90, smoothed chroma upsampling | lost | intact |
| JPEG 4:2:0 Q89 | lost (55 of 64 rows) | intact, either upsampling |
| JPEG 4:2:0 Q88 | lost | lost |
| JPEG 4:4:4 Q90 | intact | intact |
| jpegli q95, WebP q95 | intact | intact |
| WebP q90 | intact | lost |
| jpegli q90 | lost | lost |

The code rate is a small lever: in the same test, rate 0.95 (3.76 bits/px) still passes Q90 with box upsampling but not with smoothing, 0.93 (3.68) passes Q90 with both, 0.92 (3.64) adds Q89 with box, 0.90 adds Q89 with both, and 0.875 (3.47) does not yet reach Q88. Below Q89 the limit is the level spacing, not the code. WebP q90 is the one transport that got worse; JPEG 4:2:0 is the design target.

API: `BINARY_*` row constants and `binaryLdpc` are replaced by the strip constants and `getBinaryLdpc()` in `utils/binaryModulation.ts`; `generateBinaryPermutation(rowIndex)` became `getBinaryPermutation()`; `PxfDecoder.computeBinaryLLRs` and the 2-bit and chroma LLR tables are removed. `rowHealth` in the binary debug capture now has one entry per strip.

## 2026-10-04 - SBR noise fields replaced by gain time segments

The SBR word's noise-floor fields are gone and their bits now carry extra gain time resolution. This changes the v301 SBR word, so audio images from earlier v301 builds decode with wrong highband gains.

The noise fields were dead weight: the encoder never wrote anything but 0. That was not a detection fault. At the target transport the source tile (bins 64..95 after JPEG Q92) already carries quantization noise and is as noise-like as the highband it replaces: measured per block on the 36-track corpus at 32 kHz, median spectral flatness is 0.61 for the target highband, 0.59 for the decoded source tile and 0.65 for white noise. Forcing noise in made PEAQ worse monotonically (noise share +25 %: -0.024 ODG, +50 %: -0.056, all noise: -0.079, worse on 35 of 36 tracks), so the decoder's noise synthesis and its per-block seeds were removed as well. Whitening by the tonality field stays.

What limited the highband was time resolution, not parameter precision: one gain per subgroup (62 blocks, 248 ms at 32 kHz) in normal mode, two in temporal mode. Simulated on the corpus, the RMS error of the synthesized band-energy envelope was 4.81 dB; with unquantized parameters in the same structure it was still 4.55 dB, while four unquantized gains per subgroup reach 4.07 dB and eight 3.68 dB.

- **Normal mode**: the 4-bit noise field is now a gain delta (-8..+7 dB). `hfGain` applies to the first half of the subgroup, `hfGain + gainDelta` to the second.
- **Temporal mode**: each half's 2-bit noise field is now a quarter delta (-4, 0, +4, +8 dB) that splits the half into two quarters at `gain -/+ delta / 2`, for four gains per subgroup.
- **Band envelope**: the top band's range is shifted down by 4 dB in both modes (-10..+4 and -8.5..+0.5). It sits on the source's anti-alias rolloff: its fitted envelope averaged -4 dB against about 0 dB for the other three bands, and 9 % (normal) and 16 % (temporal) of all envelope values sat at the old lower limit.
- **Mode decision**: the encoder fits both modes and keeps the one whose stored parameters make the decoder's energy envelope land closer to the target, replacing the "halves more than 3 dB apart" rule.

With these the simulated envelope error drops from 4.81 to about 4.1 dB. PEAQ through the Q92 4:2:0 channel on the 36-track corpus: 32 kHz mean ODG -1.988 to -1.967 (21 tracks better, 6 worse; largest drops -0.08 on two dense electronic tracks, largest gain +0.14), 44.1 kHz -1.367 to -1.361.

The app's SBR readout shows the block's effective gain and the gain step in place of the noise share; `SBRParams.noiseFloorRatio` and `SBRParamsTemporal.noiseFloorRatioA/B` became `gainDelta` and `quarterDeltaA/B`, and the seed arguments of `applySBRSynthesis`, `applyJointStereoSBRSynthesis`, `decodeBlock` and `decodeStereoBlocks` were dropped.

## 2026-10-04 - Integer luma centre

The luma centre of the OBB pixel mapping moved from 127.426 to 128 (extents and rotation unchanged). With the fractional centre a zero luma sample was written as gray 127 and read back as about -0.0034, so every silent block that shared a scale group with loud audio carried a constant offset in its DC coefficient. The v300 zigzag map put DC in MDCT bin 0, where it was an inaudible DC offset; the JPEG-tuned maps put it in bin 8, where it became a steady tone at 8 x fs/256 (1000 Hz at 32 kHz, about -54 dBFS before a loud onset). Zero is now gray 128, which is exact in the pixels and a zero DC term in JPEG. The box reaches at most 0.42 past 255 at its extreme corners, within pixel rounding. This changes the pixel values of both audio and binary images, so images from earlier v301 builds decode with a small luma offset.

## 2026-10-04 - v300 decode support removed

The decoder no longer reads format version 300. Any image whose header version is not `301` is rejected at header parse with `Unsupported format version: N. This decoder only supports version 301.`, audio and binary alike. Everything that existed only for v300 is gone: the raster block layout and 62/62, 31/31 scale groups, per-block 4x4 chroma (with its maps, 4x4 DCT and decoder-side chroma row scan), the v300 SBR word layouts, processing modes and synthesis, independent mid/side SBR noise for stereo pairs, and the zigzag-for-v300 map selection. The `formatVersion` parameters on the layout, block-math, SBR and chunking functions were dropped along with `SUPPORTED_FORMAT_VERSIONS`, `isSupportedFormatVersion`, `getBlockMapForVersion`, `PROCESSING_MODE_NAMES` and the `procMode` field of the SBR parameter types. The removal itself does not change the v301 format, the encoder output or the decode of v301 images. Alongside it, the unused per-block decode debug capture was removed, and the header's `totalAudioBlocks` now counts audio hops (it included the lead-in block) and is `0` for binary images, where it used to be derived from the byte count.

## 2026-10-03 - PXF v301 release cleanup (`65763e1545408aedadf4454f230d5a5bd08eb059` -> HEAD)

The format itself is unchanged in this range (still `301`, and `300` files still decode), but the audio layout gained one structural change and the whole repository got a pre-release pass.

The structural change is 4:2:0 chroma superblocks. One 8x8 chroma coefficient block now spans a 2x2 group of luma blocks (a 16x16 px superblock), with each luma block's 16 Cb/Cr bins interleaved into the shared block by importance rank. Audio blocks are stored in JPEG 4:2:0 MCU order: data rows come in pairs, the first row of a pair fills the left 31 MCUs and the second the right 31, and inside an MCU the four blocks are consecutive in time (top-left, top-right, bottom-left, bottom-right). The scale groups are whole MCUs (luma and band factors A/B = 16/15 MCUs, chroma AX/AY/BX/BY = 8/8/8/7 MCUs), so every chroma block carries four consecutive audio blocks under a single scale. The decoder reads the whole MCU back through the custom JPEG decoder's nearest-neighbour chroma upsampling. Images written by the first v301 tag, which stored blocks in raster order with 62/62 and 31/31 groups, are not readable; that layout mixed up to four chroma scales in one chroma block.

Four more audio fixes went into the same version number after that. None of them changes the header or the row-metadata framing, but all change what a v301 decoder does, so v301 images from earlier builds do not decode correctly.

- **TDAC across image boundaries.** The last MDCT block of every non-final image was windowed over zero padding instead of the audio that continues in the next image, so its aliasing did not cancel against the next image's first block. The encoder now windows that block into the first hop of the next chunk; only the last block of the final image is zero-padded.
- **Lead-in block.** The first hop of a file had only one MDCT window over it, so its aliasing never cancelled (on a 1 kHz sine the first 2.9 ms came back with an error almost as large as the signal). The first image of a file, and its side image for stereo, now stores one extra block in front of the audio; the header still counts real samples only, and the decoder drops the first hop of overlap-add output. `ChunkingUtils.calculateMaxSamplesForFirstImage` is the new capacity of a single-image file (one hop less than before).
- **SBR analysis is closed-loop.** The encoder used to fit SBR against the clean lowband, while the decoder patches from a lowband that carries JPEG quantization noise and is therefore louder. The encoder now reads each row pair back through a model of the target transport (`encoder/jpegChannel.ts`: baseline JPEG, quality 92, 4:2:0) with the decoder's own block decode, and fits against that. Energies are measured on the MDCT pseudo-spectrum instead of raw coefficients.
- **SBR synthesis.** The 2-bit tonality field now selects how far the source tile is whitened before it is patched, and the tone/noise mix is set by the noise field alone; the encoder whitens only as far as needed and fills the remaining flatness gap with noise. Several defects were fixed along the way: the overall gain was always computed against bins 64..95 even when another source tile was chosen; temporal mode's 2-bit noise field was read on the 4-bit scale, capping noise at 20 %; temporal mode flagged any transient shape as an attack and ran it over the whole subgroup instead of its half; transient shapes lowered the total energy by 2.3 to 3.6 dB; the shape was chosen from the highband's own energy curve although the decoder already follows the source's; and temporal mode was triggered by energy changes that need no extra time resolution. v300 images keep the old synthesis.

Measured with PEAQ through the Q92 4:2:0 channel on the 36-track corpus, relative to the build with only the lead-in block: at 44.1 kHz the mean ODG is unchanged (-1.393 to -1.396), at 32 kHz, where SBR covers the audible range above 12 kHz, it improves from -2.094 to -2.021. The `q92pm8` mapping preset gained an 8x8 chroma map for this.

The cleanup pass fixed two decoder bugs. First, v300 images did not actually decode on the v301 decoder: the coefficient block map was a build-time constant (`q92pm8`), while v300 images were written with the zigzag map, so their luma and chroma bins came back in the wrong order. The decoder now selects the map from the header version. Second, a decoder-side SBR mismatch that had been present since v300: the encoder splits its two SBR subgroups relative to a row's actual block count, but the decoder assumed a fixed 62/62 split, so the last partial row of every image was synthesized with the wrong subgroup parameters. The decoder now shares the encoder's partition and a regression test pins it. The streaming decoder was simplified around a single block locator (fixing block statistics for multi-image mono and sorting images by index regardless of input order), header field reads no longer go negative for 4-byte values, metadata key order is locale-independent, and the duplicated interface declarations across encoder/decoder modules were consolidated.

Around the codec: the CLI's repeatable `-m` metadata option now actually works (it previously iterated the string character by character), binary output filenames from untrusted images are sanitized to a basename, WAVE_FORMAT_EXTENSIBLE float input is decoded as float, WAV parse failures are errors instead of silent binary encodes (`--binary` forces binary mode), `-f/--force` is implemented, and `check` returns a non-zero exit code on checksum failure. The JPEG decoder now rejects what it cannot decode (progressive, arithmetic, 12-bit, non-interleaved, Adobe RGB/CMYK) instead of returning garbage, tolerates fill bytes and a missing EOI, and carries proper Apache-2.0 attribution for its pdf.js-derived IDCT. The web app dropped the dormant Facebook transcode path (which would have baked `PUBLIC_FACEBOOK_*` secrets into a static build), fixed AudioContext leaks and re-entrant playback in the player, keeps the locale on navigation, stops silently encoding non-PCM WAVs as binary, and passes lint. Line endings were normalized to LF with a `.gitattributes`, CI now runs the app lint and type-check, and the specification reflects the superblock layout.

## 2026-05-19 - PXF v301 (`a374effe2baf3850ad6e99e8f8ae4bcdb21a3c79` -> `65763e1545408aedadf4454f230d5a5bd08eb059`)

v301 is an audio-path revision aimed at one transport: libjpeg Q92, 4:2:0, integer DCT, which is what the Facebook upload pipeline was shown to be (`doc/facebook-jpeg-encoder/findings-2026-05-19.md`). Three things changed: where MDCT bins land inside the JPEG DCT block, what the per-row SBR word carries for stereo, and how silence is handled in SBR. The 4:2:0 chroma superblock layout that the released v301 ships with was added later in the same version number and is described in the entry above; the quality numbers below report it separately.

Detailed analysis with per-track tables: [doc/reports/v300-to-v301-audio-quality.md](doc/reports/v300-to-v301-audio-quality.md).

### Format changes

- `FORMAT_VERSION` is `301`; `SUPPORTED_FORMAT_VERSIONS` is `[300, 301]`. The header, row-metadata and binary-permutation whitening seeds and the LDPC graphs are unchanged from v300, so image geometry, header layout, row-metadata framing and binary mode are bit-identical apart from the version field.
- **Coefficient placement.** MDCT bins 0..63 are placed into the 8x8 luma DCT block, and bins 64..95 into the chroma block, in `q92pm8` order instead of JPEG zigzag. `q92pm8` ranks DCT positions by a triangular-weighted (1..9..1 over Q84..Q100, centred on Q92) average of the ImageMagick/libjpeg quantizer step sizes, smallest step first, ties broken by the Q92 step and then zigzag slot. At Q92 the luma DC step is 3 while the first AC positions have step 2, so DC drops to rank 8 and MDCT bin 0 sits at DCT (2,0). A narrower `q92pm1` preset (Q91..Q93 only) is also defined; both are generated by `codec/scripts/generate_jpeg_quant_preset.py` and the tables are checked in under `doc/notes/jpeg-q*-quant-rankings.txt`. Cb and Cr share one map because the targeted JPEGs share one chroma quantization table.
- **SBR word.** The v300 word's 2-bit processing mode (never written as anything but 0 by the v300 encoder) and one bit of tonality (3 -> 2 bits in normal mode) become a 3-bit stereo cue: sign bit plus a 2-bit coherence class. Temporal mode drops its reserved bit and shifts fields by one. Both layouts are in `codec/src/utils/sbr.ts` and the specification. Processing modes 1..3 are decoded only for v300 words; v301 words always synthesize in the neutral mode.

### Encoder

- `q92pm8` is the default `AUDIO_PSYCHOACOUSTICS.blockMap`.
- Stereo mid/side rows are encoded together (`encodeStereoChannels`). Per subgroup, the weighted mid/side cross-correlation over bins 96..127 gives a coherence in [0, 1] (class thresholds 0.20 / 0.50 / 0.80) and a sign; when the class is 2 or 3 both channels are locked to the single patch mode with the lowest combined energy mismatch and their band envelopes are recomputed for it.
- SBR analysis treats a subgroup whose target band (96..127) and source band (64..95) both average below a per-bin RMS of 1e-4 as silence: gain -48 dB, tonality 0, noise 0. Unmeasurable gain now defaults to -48 dB rather than 0 dB.

### Decoder

- Accepts headers with version 300 or 301; the error for anything else lists both. Mid and side images with different versions are rejected.
- SBR word decoding, tonality scaling (3-bit /7 vs 2-bit /3) and processing-mode handling are selected by the header version.
- v301 stereo pairs use a joint SBR synthesis: the mid and side HF noise comes from one shared generator mixed by `sqrt(sharedAmount)` with `sharedAmount` in {0, 0.33, 0.67, 1.0} by coherence class, then the mid/side HF bins are projected onto their per-band principal axis with the residual scaled by {1.0, 0.7, 0.35, 0.0} and energy-normalized per bin. If only one of the pair carries SBR bytes, the other's HF is derived from it through the cue. v300 pairs keep the independent per-channel seeds.
- SBR synthesis zeroes any band whose actual source RMS is <= 1e-4 instead of filling it with scaled noise. This gate is not version-gated and also applies when decoding v300 images.
- The web decoder's row inspector shows the stereo cue for v301 rows in place of the processing mode.

### Compatibility

- The encoder writes 301 only.
- v300 decoders reject v301 images at header parse (`Unsupported version: 301. This decoder expects 300.`), audio and binary alike. There is no partial decode.
- The v301 decoder parses v300 headers, SBR words, per-block 4x4 chroma and the v300 stereo seeding by header version. In the `65763e1`..`412b0f5` builds the coefficient block map was a build-time constant (`q92pm8`) rather than a per-version choice, so a genuine v300 image (written with the zigzag map) decoded with its luma and chroma bins in the wrong order. The release cleanup (section above) selects the map from the header version (`getBlockMapForVersion`), so v300 images decode correctly from this release on.
- Images written by any pre-release v301 build (`65763e1`..`d484c07`) carry the same version number as the released layout but do not decode correctly on the released decoder: builds before the superblock change use per-block chroma and raster block order, `412b0f5`..`5659dab` use superblocks in raster order, and builds before `35545b8` expect the older SBR synthesis (and, before `d484c07`, no lead-in block). None were published.

### Audio quality results

Round trip through `magick <png> ppm:- | cjpeg -quality 92 -sample 2x2,1x1,1x1 -dct int -optimize`, scored with GstPEAQ in advanced mode (ODG: 0 imperceptible .. -4 very annoying). Corpus: full-length 44.1 kHz / 16-bit stereo commercial recordings; 25 tracks (106.9 min) for v300 vs v301, 36 tracks for the superblock run of which 23 overlap the 25. Effective bitrate is JPEG bytes over audio duration; PXF has no rate control, so it measures how compressible the pixel layout is, not a setting. Reports: `doc/artifacts/peaq-reports/{v301,20260702-214454}/report.json`; the 25-track May v300 report was later replaced by the 36-track release run at `v300/report.json` and survives only in git history (`ad11d0f`).

| | v300 (25) | v301 (25) | v301 (23 common) | v301 + superblocks (23 common) | v301 + superblocks (36) |
| --- | ---: | ---: | ---: | ---: | ---: |
| ODG mean | -1.401 | -1.367 | -1.359 | -1.341 | -1.404 |
| ODG median | -1.248 | -1.242 | -1.242 | -1.243 | -1.269 |
| ODG min / max | -3.144 / -0.463 | -2.899 / -0.406 | -2.899 / -0.406 | -2.895 / -0.407 | -3.209 / -0.175 |
| DI mean | 0.498 | 0.538 | 0.548 | 0.566 | 0.509 |
| Effective bitrate, overall (kbps) | 213.3 | 215.2 | 215.4 | 213.8 | 210.2 |
| JPEG / source WAV | 0.1511 | 0.1525 | 0.1526 | 0.1515 | 0.1489 |
| PCM SNR mean (dB) | 18.35 | 18.75 | 18.82 | 18.82 | 19.32 |

Paired per-track comparisons:

| | v300 -> v301 (25) | v301 -> v301 + SB (23) | v300 -> v301 + SB (23) |
| --- | ---: | ---: | ---: |
| Mean dODG (SE) | +0.034 (0.012) | +0.018 (0.007) | +0.053 (0.014) |
| Median dODG | +0.015 | +0.017 | +0.032 |
| Improved / regressed / unchanged | 20 / 4 / 1 | 17 / 6 / 0 | 19 / 4 / 0 |
| At +/-0.05: improved / regressed / within | 6 / 1 / 18 | 3 / 0 / 20 | 9 / 0 / 14 |
| Sign test p (two-sided) | 0.0015 | 0.035 | 0.0026 |
| Wilcoxon signed-rank p (exact, two-sided) | 0.0004 | 0.010 | 0.0003 |
| Mean dDI | +0.040 | +0.019 | +0.061 |
| JPEG bytes | +0.88 % | -0.75 % | +0.15 % |
| PNG bytes (pre-transport) | +0.01 % | +0.92 % | +0.93 % |
| Mean dSNR (dB) | +0.40 | -0.00 | +0.40 |

v300 -> v301: the gain is concentrated where v300 was worst. The six tracks at ODG <= -2.0 on v300 moved +0.105 on average (`Le Sacre du Printemps I` -3.144 -> -2.899, `Batucada` +0.118, `Katamari` +0.105, `The Look Of Love` +0.089); the other nineteen moved +0.011. PCM SNR rose on every track (+0.06 to +0.69 dB) with the PNGs unchanged in size, which is the expected signature of the mapping change: the same coefficients are written, fewer are rounded away at Q92, and the JPEG grows ~0.9 % because energy moved from DC into early AC positions. The one regression past the 0.05 threshold is `広瀬香美 - Groovy!` (-0.062), which recovers +0.043 under the superblock layout. The stereo-cue SBR is expected to be mostly invisible to PEAQ (not a spatial model) and the silence handling only touches quiet passages; neither was ablated, so attribution between the three changes is by mechanism, not measurement.

v301 -> v301 + superblocks: neutral to slightly positive on ODG (only `Hotel California` +0.117, `Air Supply` +0.052 and `The Look Of Love` +0.051 clear the threshold; worst regression `Scorpions - Always Somewhere` -0.039), SNR unchanged to within 0.07 dB on every track, and 22 of 23 JPEGs smaller (-0.75 % overall) while the PNGs grew ~0.9 %. This is the intended outcome of writing one 8x8 chroma block per 16x16 px: the JPEG chroma DCT now quantizes the block that was designed as a block. The 36-track mean is lower than the 25-track means because the added material is harder (solo piano `Moonlight Sonata` -3.209 at 152.8 kbps, speech, sparse chiptune), not because of a regression on shared tracks.


Release verification (2026-10-03), same corpus and recipe, 36 tracks, both ends built from the respective commits (`a374eff` for v300, the final v301 build `35545b8` with MCU-order superblocks, cross-image TDAC, the lead-in block and the SBR changes). Reports: `doc/artifacts/peaq-reports/{v300,v301-release}/report.json`.

| | v300 (36) | v301 release (36) | v300 -> v301 release, paired (36) |
| --- | ---: | ---: | ---: |
| ODG mean | -1.473 | -1.396 | +0.078 (SE 0.016) |
| ODG median | -1.282 | -1.259 | +0.052 |
| ODG min / max | -3.249 / -0.234 | -3.202 / -0.148 | |
| DI mean | 0.430 | 0.520 | |
| PCM SNR mean (dB) | 18.82 | 19.34 | |
| Effective bitrate, overall (kbps) | 210.0 | 208.9 | -0.5 % |
| Improved / regressed / unchanged | | | 33 / 3 / 0 |
| At +/-0.05: improved / regressed / within | | | 19 / 2 / 15 |
| Sign test p (two-sided) | | | 2.3e-07 |

Largest gains are `Hotel California` +0.341, `doodle` +0.340, `EBU SQAM` male English speech +0.282, `Le Sacre du Printemps I` +0.249, `The Look Of Love` +0.145 and `Batucada` +0.133. Two tracks regress past the threshold: `Casiopea - Swear` -0.112 and `Scorpions - Always Somewhere` -0.109. JPEG bytes fall 0.5 % while the PNGs grow 0.6 %. Against the July superblock run on the same 36 tracks the release build is +0.008 mean ODG, with per-track differences from -0.196 to +0.192.

v300 compatibility was verified on the same final build (`v300-decoded-by-v301`): v300-encoded images decoded by the release decoder score -1.474 mean against v300's own -1.473, max per-track difference 0.005, which confirms that the block-map fix above restores v300 compatibility and that the later layout, lead-in and SBR changes leave the v300 decode path alone. The output is not bit-identical to the v300 decoder's: the SBR silence gate and the subgroup-partition fix apply to v300 images too, and the CLI's WAV writer now rounds instead of truncating.

Caveats: single JPEG operating point; the tracks are the development set, not a held-out set; the +/-0.05 threshold is a working resolution for the PEAQ model, not a calibrated JND. The three May/July reports predate the decoder-side SBR subgroup-partition fix; the release verification run includes it, together with the later layout and SBR changes, so the difference between those runs is not attributable to any single fix.
