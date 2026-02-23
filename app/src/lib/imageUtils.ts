// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 Kyle Alexander Buan

import type { RawImageData } from '@pixel-exchange-format/codec';
import { decodeJPEG, isJPEG } from '@pixel-exchange-format/jpeg-decoder';

export async function fileToRawImageData(file: File): Promise<[RawImageData, boolean]> {
    const buffer = await file.arrayBuffer();

    // Check if it's a JPEG file
    if (isJPEG(buffer)) {
        try {
            // Use custom JPEG decoder with nearest neighbor upsampling
            const jpeg = decodeJPEG(buffer);
            return [jpeg, true];
        } catch (err) {
            console.warn('Custom JPEG decoder failed, falling back to browser decoder:', err);
            // Fall back to browser decoder if decoder fails
        }
    }

    // Fall back to browser's built-in decoder for non-JPEG files or if custom decoder fails
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            try {
                const canvas = document.createElement('canvas');
                canvas.width = img.width;
                canvas.height = img.height;
                const ctx = canvas.getContext('2d');
                if (!ctx) throw new Error("Could not get 2D context");
                ctx.drawImage(img, 0, 0);
                const imageData = ctx.getImageData(0, 0, img.width, img.height);
                resolve(
                    [
                        {
                            data: imageData.data,
                            width: imageData.width,
                            height: imageData.height
                        },
                        false
                    ]
                );
                URL.revokeObjectURL(img.src);
            } catch (err) { reject(err); }
        };
        img.onerror = () => {
            URL.revokeObjectURL(img.src);
            reject(new Error("Could not load image file."));
        };
        img.src = URL.createObjectURL(file);
    });
}

export function rawImageDataToDataUrl(raw: { data: Uint8ClampedArray, width: number, height: number }): string {
    const canvas = document.createElement('canvas');
    canvas.width = raw.width;
    canvas.height = raw.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error("Could not get 2D context");

    const imageData = new ImageData(raw.data as any, raw.width, raw.height);
    ctx.putImageData(imageData, 0, 0);

    return canvas.toDataURL('image/png');
}
