// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 Kyle Alexander Buan

export interface EncodedImageResult {
    data: Uint8ClampedArray;
    width: number;
    height: number;
    name: string;
}

export interface AudioData {
    channels: Float32Array[];
    sampleRate: number;
}

export interface SimpleImageData {
    data: Uint8ClampedArray;
    width: number;
    height: number;
}

export interface EncodeOptions {
    maxHeight?: number;
}
