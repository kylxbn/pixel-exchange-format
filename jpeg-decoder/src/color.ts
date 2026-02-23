// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 Kyle Alexander Buan

/**
 * Converts YCbCr color space to RGB
 */
export function ycbcrToRgb(y: number, cb: number, cr: number): [number, number, number] {
  const c = y;
  const d = cb - 128;
  const e = cr - 128;

  const r = c + 1.402 * e;
  const g = c - 0.344136 * d - 0.714136 * e;
  const b = c + 1.772 * d;

  return [
    Math.max(0, Math.min(255, Math.round(r))),
    Math.max(0, Math.min(255, Math.round(g))),
    Math.max(0, Math.min(255, Math.round(b)))
  ];
}

/**
 * Converts component data from a 2D grid of 8x8 blocks to a 2D array representing
 * the component plane at its NATIVE resolution.
 * Handles padding blocks correctly by using the actual image dimensions.
 */
export function blocksToComponent(
  blockGrid: number[][][],
  imageWidth: number,
  imageHeight: number,
  horizontalSampling: number,
  verticalSampling: number,
  maxHorizontalSampling: number,
  maxVerticalSampling: number
): number[][] {
  const scaleX = horizontalSampling / maxHorizontalSampling;
  const scaleY = verticalSampling / maxVerticalSampling;

  const componentWidth = Math.ceil(imageWidth * scaleX);
  const componentHeight = Math.ceil(imageHeight * scaleY);

  const component: number[][] = Array.from({ length: componentHeight }, () =>
    new Array(componentWidth).fill(0)
  );

  for (let gridY = 0; gridY < blockGrid.length; gridY++) {
    for (let gridX = 0; gridX < blockGrid[gridY].length; gridX++) {
      const block = blockGrid[gridY][gridX];
      const pixelStartY = gridY * 8;
      const pixelStartX = gridX * 8;

      for (let y = 0; y < 8; y++) {
        const destY = pixelStartY + y;
        if (destY >= componentHeight) continue;

        for (let x = 0; x < 8; x++) {
          const destX = pixelStartX + x;
          if (destX >= componentWidth) continue;

          component[destY][destX] = block[y * 8 + x];
        }
      }
    }
  }

  return component;
}

/**
 * Combines Y, Cb, Cr components into RGB image data using Nearest Neighbor upsampling
 */
export function combineComponents(
  yComponent: number[][],
  cbComponent: number[][] | null,
  crComponent: number[][] | null,
  width: number,
  height: number,
): Uint8ClampedArray {
  const output = new Uint8ClampedArray(width * height * 4);

  const hasChroma = cbComponent && crComponent;

  const cbHeight = cbComponent?.length || 0;
  const cbWidth = cbComponent?.[0]?.length || 0;
  const crHeight = crComponent?.length || 0;
  const crWidth = crComponent?.[0]?.length || 0;

  const cbScaleX = hasChroma ? cbWidth / width : 0;
  const cbScaleY = hasChroma ? cbHeight / height : 0;
  const crScaleX = hasChroma ? crWidth / width : 0;
  const crScaleY = hasChroma ? crHeight / height : 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const yVal = yComponent[y][x];
      let r, g, b;

      if (hasChroma) {
        // Nearest neighbor mapping
        const cbX = Math.floor(x * cbScaleX);
        const cbY = Math.floor(y * cbScaleY);
        const crX = Math.floor(x * crScaleX);
        const crY = Math.floor(y * crScaleY);

        const cbVal = cbComponent[Math.min(cbY, cbHeight - 1)][Math.min(cbX, cbWidth - 1)];
        const crVal = crComponent[Math.min(crY, crHeight - 1)][Math.min(crX, crWidth - 1)];

        [r, g, b] = ycbcrToRgb(yVal, cbVal, crVal);
      } else {
        // Grayscale
        r = g = b = Math.max(0, Math.min(255, Math.round(yVal)));
      }

      const index = (y * width + x) * 4;
      output[index] = r;
      output[index + 1] = g;
      output[index + 2] = b;
      output[index + 3] = 255;
    }
  }

  return output;
}