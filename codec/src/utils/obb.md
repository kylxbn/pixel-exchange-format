---
order: 11
title: Oriented Bounding Box Mapping
---

The format uses an optimized oriented bounding box (OBB) mapping to encode three-dimensional audio coefficient data into RGB pixel values, maximizing the utilization of the RGB color space for quantization.

## OBB Parameters

Precomputed optimal bounding box for RGB color space utilization:
- **Center**: [127.426, 128.000, 128.000] in YCbCr space
- **Extents**: [41.159, 61.527, 48.638] (half-widths in YCbCr)
- **Rotation Matrix**: X axis fixed, Y/Z plane rotated by ~90.005deg for fit
- **Inverse Rotation**: Transpose for decoding

## Encoding Process

For a 3D point p = [x, y, z] in normalized coefficient space (-1 to 1):

1. Apply mu-law compression per axis:
   - x' = sign(x) * ln(1 + mu_luma * |x|) / ln(1 + mu_luma)
   - y' = sign(y) * ln(1 + mu_cb * |y|) / ln(1 + mu_cb)  
   - z' = sign(z) * ln(1 + mu_cr * |z|) / ln(1 + mu_cr)

2. Scale by extents:
   - s = [x' * hx, y' * hy, z' * hz]

3. Rotate into OBB orientation:
   - r = R * s

4. Translate by center:
   - ycbcr = r + center

5. Convert YCbCr to RGB using BT.601 matrix

## Decoding Process

Reverse the encoding:

1. Convert RGB to YCbCr using BT.601 inverse
2. Subtract center: shifted = ycbcr - center
3. Rotate back: rotated = R^T * shifted
4. Divide by extents: normed = rotated / extents
5. Apply mu-law expansion per axis (audio mode path)

## mu-Law Parameters

- Luma (Y): mu = 6
- Chroma Cb: mu = 2
- Chroma Cr: mu = 3

Binary mode bypasses mu-law in this mapping.

## BT.601 Color Conversion

Forward (YCbCr -> RGB):
- R = Y + 1.402 * (Cr - 128)
- G = Y - 0.34414 * (Cb - 128) - 0.71414 * (Cr - 128)
- B = Y + 1.772 * (Cb - 128)

Inverse (RGB -> YCbCr):
- Y = 0.299 * R + 0.587 * G + 0.114 * B
- Cb = -0.1687 * R - 0.3313 * G + 0.5 * B + 128
- Cr = 0.5 * R - 0.4187 * G - 0.0813 * B + 128

## Usage in Format

OBB mapping enables efficient storage of quantized audio coefficients in image pixels, optimizing for the perceptual characteristics of the RGB color space.
