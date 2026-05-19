# Facebook JPEG Encoder Probe

This folder contains a local experiment for fingerprinting the JPEG encoder behind Facebook's image pipeline.

## Files

- `generate_probe.py`
  - Generates a 1024x1024 RGB PNG probe designed to expose:
  - RGB-to-YCbCr conversion behavior
  - 4:2:0 chroma downsampling phase/filter behavior
  - FDCT implementation differences
  - coefficient rounding differences
- `compare_encoders.py`
  - Encodes the probe with local candidate encoders
  - Extracts quantized DCT coefficients and JPEG metadata
  - Ranks candidates against a Facebook-returned JPEG when present

## Artifacts

- Probe to upload:
  - [probe.png](/mnt/dev/personal/projects/active/pixel-exchange-format/doc/artifacts/facebook-jpeg-encoder/probe.png)
- Tile manifest:
  - [probe-manifest.json](/mnt/dev/personal/projects/active/pixel-exchange-format/doc/artifacts/facebook-jpeg-encoder/probe-manifest.json)
- Local candidate outputs:
  - `doc/artifacts/facebook-jpeg-encoder/candidates/`
- JSON report:
  - [report.json](/mnt/dev/personal/projects/active/pixel-exchange-format/doc/artifacts/facebook-jpeg-encoder/report.json)
- Expected location for the Facebook round-trip JPEG:
  - `doc/artifacts/facebook-jpeg-encoder/facebook-roundtrip.jpg`

## Environment

The experiment uses a local venv at `doc/.venv-jpeg-lab/` with:

- `pillow`
- `numpy`
- `jpeglib`

Activate it with:

```bash
. doc/.venv-jpeg-lab/bin/activate
```

## Workflow

1. Regenerate the probe if needed:

```bash
python doc/facebook-jpeg-encoder/generate_probe.py
```

2. Upload `doc/artifacts/facebook-jpeg-encoder/probe.png` to Facebook.

3. Download Facebook's JPEG output and place it at:

```text
doc/artifacts/facebook-jpeg-encoder/facebook-roundtrip.jpg
```

4. Run the comparison sweep:

```bash
. doc/.venv-jpeg-lab/bin/activate
python doc/facebook-jpeg-encoder/compare_encoders.py
```

## Current local findings

With the current probe and the encoders already installed on this machine:

- `cjpeg -dct int`
- `cjpeg -dct int -optimize`
- Pillow JPEG save
- Pillow JPEG save with `optimize=True`
- ImageMagick
- GraphicsMagick
- libvips

all produce the same quantized DCT coefficients for this probe at `Q=92` and `4:2:0`.

Two variants do differ at the coefficient level:

- `cjpeg -dct fast`
- `cjpeg -dct float`

That means the first high-signal discriminator is likely the FDCT path rather than the frontend. If Facebook's output matches the dominant group, then the next stage will be to look for:

- entropy-coding/header differences
- metadata marker differences
- other libjpeg-family encoders not yet installed, such as mozjpeg/jpegli

## Current conclusion

The strongest current match for Facebook is:

```bash
cjpeg -quality 92 -sample 2x2,1x1,1x1 -dct int -optimize
```

Interpretation:

- for the **same coefficients**, `-dct int` is the key requirement
- for the same **optimized JPEG stream** apart from Facebook's extra ICC profile marker, add `-optimize`

Related notes:

- Facebook's JPEG adds a `uRGB` ICC profile in `APP2`
- Chromium canvas export matched Facebook's compressed JPEG stream for this probe
- Firefox canvas export used `4:4:4`, so it did not match Facebook's path

See the full write-up in:

- [findings-2026-05-19.md](/mnt/dev/personal/projects/active/pixel-exchange-format/doc/facebook-jpeg-encoder/findings-2026-05-19.md)
