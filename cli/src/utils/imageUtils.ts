// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 Kyle Alexander Buan

import { decodeJPEG, isJPEG } from '@pixel-exchange-format/jpeg-decoder';
import { isJpegFile } from './fileUtils.js';

/**
 * Decodes an image buffer into raw RGBA image data
 * @param imageBuffer - Image file buffer
 * @param format - Image format (optional, auto-detected if not provided)
 * @returns Raw image data with width, height, and RGBA pixel data
 */
export async function decodeImage(
    imageBuffer: Buffer
): Promise<{
    data: Uint8ClampedArray;
    width: number;
    height: number;
}> {
    if (isJpegFile(imageBuffer)) {
        try {
            const slice = imageBuffer.buffer.slice(
                imageBuffer.byteOffset,
                imageBuffer.byteOffset + imageBuffer.byteLength
            );
            const arrayBuffer =
                slice instanceof ArrayBuffer ? slice : new Uint8Array(slice).slice().buffer;
            if (isJPEG(arrayBuffer)) {
                return decodeJPEG(arrayBuffer);
            }
        } catch (err) {
            console.warn('Custom JPEG decoder failed, falling back to sharp:', err);
        }
    }
    try {
        const sharp = await import('sharp');

        // Decode the image to raw RGBA data
        const image = sharp.default(imageBuffer);
        const metadata = await image.metadata();

        // Convert to RGBA format
        const rawBuffer = await image
            .ensureAlpha() // Add alpha channel if missing
            .raw()
            .toBuffer({ resolveWithObject: true });

        return {
            data: new Uint8ClampedArray(rawBuffer.data),
            width: metadata.width!,
            height: metadata.height!
        };
    } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        throw new Error(
            `Image decoding failed: ${errorMessage}\n` +
            'Please ensure the image file is valid and supported.'
        );
    }
}

/**
 * Encodes raw RGBA image data into a PNG buffer
 * @param data - Raw RGBA pixel data
 * @param width - Image width
 * @param height - Image height
 * @returns PNG file buffer
 */
export async function encodePNG(
    data: Uint8ClampedArray,
    width: number,
    height: number
): Promise<Buffer> {
    try {
        const sharp = await import('sharp');

        // Create a buffer from the raw RGBA data
        const buffer = Buffer.from(data);

        // Use Sharp to encode as PNG
        const pngBuffer = await sharp.default(buffer, {
            raw: {
                width: width,
                height: height,
                channels: 4 // RGBA
            }
        })
        .png()
        .toBuffer();

        return pngBuffer;
    } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        throw new Error(
            'PNG encoding failed: ' + errorMessage
        );
    }
}

/**
 * Converts a raw image data format to the codec's expected format
 * @param imageData - Raw image data from PNG decoder
 * @returns Codec-compatible image data
 */
export function toCodecImageData(imageData: {
    data: Uint8ClampedArray;
    width: number;
    height: number;
}): {
    data: Uint8ClampedArray;
    width: number;
    height: number;
} {
    // The format is already compatible
    return imageData;
}
