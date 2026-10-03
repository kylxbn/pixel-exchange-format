# Changelog

## 2026-10-03 - PXF v301 release cleanup (`65763e1545408aedadf4454f230d5a5bd08eb059` -> HEAD)

The format itself is unchanged in this range (still `301`, and `300` files still decode), but the audio layout gained one structural change and the whole repository got a pre-release pass.

The structural change is 4:2:0 chroma superblocks. One 8x8 chroma coefficient block now spans a 2x2 group of luma blocks (a 16x16 px superblock), with each luma block's 16 Cb/Cr bins interleaved into the shared block by importance rank. Audio blocks are stored in JPEG 4:2:0 MCU order: data rows come in pairs, the first row of a pair fills the left 31 MCUs and the second the right 31, and inside an MCU the four blocks are consecutive in time (top-left, top-right, bottom-left, bottom-right). The scale groups are whole MCUs (luma and band factors A/B = 16/15 MCUs, chroma AX/AY/BX/BY = 8/8/8/7 MCUs), so every chroma block carries four consecutive audio blocks under a single scale. The decoder reads the whole MCU back through the custom JPEG decoder's nearest-neighbour chroma upsampling. Images written by the first v301 tag, which stored blocks in raster order with 62/62 and 31/31 groups, are not readable; that layout mixed up to four chroma scales in one chroma block.

Three more audio fixes went into the same version number after that. None of them changes the header or the row-metadata framing, but all change what a v301 decoder does, so v301 images from earlier builds do not decode correctly.

- **Lead-in block.** The first hop of a file had only one MDCT window over it, so its aliasing never cancelled (on a 1 kHz sine the first 2.9 ms came back with an error almost as large as the signal). The first image of a file, and its side image for stereo, now stores one extra block in front of the audio; the header still counts real samples only, and the decoder drops the first hop of overlap-add output. `ChunkingUtils.calculateMaxSamplesForFirstImage` is the new capacity of a single-image file (one hop less than before). MDCT framing across image boundaries was already continuous.
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
- Images written by the intermediate v301 encoders before the chroma superblock change (`65763e1`..`7d37f19`) carry the same version number as the released layout but a different chroma layout; the released decoder reads their luma correctly and their chroma bins (64..95) incorrectly. None were published.

### Audio quality results

Round trip through `magick <png> ppm:- | cjpeg -quality 92 -sample 2x2,1x1,1x1 -dct int -optimize`, scored with GstPEAQ in advanced mode (ODG: 0 imperceptible .. -4 very annoying). Corpus: full-length 44.1 kHz / 16-bit stereo commercial recordings; 25 tracks (106.9 min) for v300 vs v301, 36 tracks for the superblock run of which 23 overlap the 25. Effective bitrate is JPEG bytes over audio duration; PXF has no rate control, so it measures how compressible the pixel layout is, not a setting. Reports: `doc/artifacts/peaq-reports/{v300,v301,20260702-214454}/report.json`.

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


Release verification (2026-10-03), same corpus and recipe, 36 tracks, both ends built from the respective commits (`a374eff` for v300, the released cleanup for v301). Reports: `doc/artifacts/peaq-reports/{v300-full,v301-release,v300-decoded-by-v301}/report.json`.

| | v300 (36) | v301 release (36) | v300 -> v301 release, paired (36) |
| --- | ---: | ---: | ---: |
| ODG mean | -1.473 | -1.405 | +0.068 (SE 0.014) |
| ODG median | -1.282 | -1.270 | +0.034 |
| ODG min / max | -3.249 / -0.234 | -3.208 / -0.175 | |
| Effective bitrate, overall (kbps) | 210.0 | 210.2 | +0.1 % |
| At +/-0.05: improved / regressed / within | | | 15 / 0 / 21 |

Largest gains are speech (`EBU SQAM` male English +0.284, male German +0.261, female English +0.211), `Le Sacre du Printemps I` +0.246 and `doodle` +0.230; worst is `Always Somewhere` -0.034. The fresh v300 run reproduces the May v300 report on the 23 shared tracks to within 0.003 ODG. Decoding the v300-encoded images with the release decoder (`v300-decoded-by-v301`) scores -1.474 mean against v300's own -1.473, max per-track difference 0.007, which confirms the block-map fix above restores v300 compatibility in practice.

Caveats: single JPEG operating point; the tracks are the development set, not a held-out set; the +/-0.05 threshold is a working resolution for the PEAQ model, not a calibrated JND. The three May/July reports predate the decoder-side SBR subgroup-partition fix; the release verification run includes it (effect vs the July superblock run: -0.001 mean ODG, max per-track 0.007).
