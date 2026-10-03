# Custom JPEG decoder

This is a custom JPEG decoder made just for PXF.

Typical JPEG decoders smooth the chroma channels when upsampling 4:2:0 images
(libjpeg's default "fancy upsampling" is a triangle filter; `djpeg -nosmooth` gives plain
box replication instead). The smoothing reduces saturation compared to the actual encoded
CbCr values.

This decoder uses nearest neighbor (box) upsampling for the chroma channels to preserve
saturation, matching `djpeg -nosmooth -dct int` to within a couple of LSB.

This leads to better data integrity in binary mode, and better HF preservation on audio mode.

In any case, though, audio mode already tries to compensate by scaling CbCr values so that
they fit in `[-1..1]`.

## Limitations

The decoder throws on anything outside this subset, so callers can fall back to a
general-purpose decoder:

- Baseline DCT only (SOF0, 8-bit). Progressive, extended sequential, lossless and
  arithmetic-coded files are rejected.
- A single interleaved scan covering all components. Non-interleaved (multi-scan)
  files are rejected.
- 1 (grayscale) or 3 (YCbCr) components. CMYK/YCCK and Adobe RGB (APP14 transform 0,
  or `R`/`G`/`B` component IDs) are rejected.
- EXIF orientation is ignored.

Restart intervals, missing EOI, and 0xFF fill bytes before markers are handled.

## Usage

`dist/` is plain ESM with explicit `.js` relative imports, so it works both under bundlers
and directly in Node.

```ts
import { decodeJPEG, isJPEG } from '@pixel-exchange-format/jpeg-decoder';

if (isJPEG(arrayBuffer)) {
    const { data, width, height } = decodeJPEG(arrayBuffer); // RGBA Uint8ClampedArray
}
```

## License

BSD 3-Clause License (BSD-3-Clause). See `LICENSE`.

Unless otherwise noted, all source code in this repository is licensed under the BSD 3-Clause License.
