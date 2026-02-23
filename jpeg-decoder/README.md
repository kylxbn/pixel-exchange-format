# Custom JPEG decoder

This is a custom JPEG decoder made just for PXF.

Most (all?) JPEG decoders use bilinear interpolation for upscaling chroma channels
in 4:2:0 JPEG images. However, this results in an unintentional reduction of saturation compared to the
actual encoded CbCr values.

This decoder uses nearest neighbor interpolation for the chroma channels to preserve saturation.

This leads to better data integrity in binary mode, and better HF preservation on audio mode.

In any case, though, audio mode already tries to compensate by scaling CbCr values so that
they fit in `[-1..1]`.

## License

BSD 3-Clause License (BSD-3-Clause). See `LICENSE`.

Unless otherwise noted, all source code in this repository is licensed under the BSD 3-Clause License.