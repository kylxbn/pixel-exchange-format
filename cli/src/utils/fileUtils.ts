// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 Kyle Alexander Buan

import { readFile, writeFile } from 'fs/promises';
import { basename, extname } from 'path';

/**
 * Reads a file from the filesystem
 * @param filepath - Path to the file to read
 * @returns File contents as Buffer
 */
export async function readFileBuffer(filepath: string): Promise<Buffer> {
    return await readFile(filepath);
}

/**
 * Writes a buffer to a file
 * @param filepath - Path where the file should be written
 * @param data - Data to write
 */
export async function writeFileBuffer(filepath: string, data: Buffer | Uint8Array): Promise<void> {
    await writeFile(filepath, data);
}

/**
 * Checks if a file appears to be a WAV audio file based on its header
 * @param buffer - File buffer to check
 * @returns True if the file has a WAV header
 */
export function isWavFile(buffer: Buffer): boolean {
    if (buffer.length < 12) return false;

    // Check for RIFF header
    const riff = buffer.toString('ascii', 0, 4);
    const wave = buffer.toString('ascii', 8, 12);

    return riff === 'RIFF' && wave === 'WAVE';
}

/**
 * Checks if a file appears to be a PNG image based on its header
 * @param buffer - File buffer to check
 * @returns True if the file has a PNG signature
 */
export function isPngFile(buffer: Buffer): boolean {
    if (buffer.length < 8) return false;

    // PNG signature: 89 50 4E 47 0D 0A 1A 0A
    return (
        buffer[0] === 0x89 &&
        buffer[1] === 0x50 &&
        buffer[2] === 0x4E &&
        buffer[3] === 0x47 &&
        buffer[4] === 0x0D &&
        buffer[5] === 0x0A &&
        buffer[6] === 0x1A &&
        buffer[7] === 0x0A
    );
}

/**
 * Checks if a file appears to be a JPEG image based on its header
 * @param buffer - File buffer to check
 * @returns True if the file has a JPEG signature
 */
export function isJpegFile(buffer: Buffer): boolean {
    if (buffer.length < 2) return false;

    // JPEG signature: FF D8
    return buffer[0] === 0xFF && buffer[1] === 0xD8;
}

/**
 * Checks if a file appears to be a GIF image based on its header
 * @param buffer - File buffer to check
 * @returns True if the file has a GIF signature
 */
export function isGifFile(buffer: Buffer): boolean {
    if (buffer.length < 6) return false;

    // GIF signature: GIF87a or GIF89a
    const sig = buffer.toString('ascii', 0, 6);
    return sig === 'GIF87a' || sig === 'GIF89a';
}

/**
 * Checks if a file appears to be a BMP image based on its header
 * @param buffer - File buffer to check
 * @returns True if the file has a BMP signature
 */
export function isBmpFile(buffer: Buffer): boolean {
    if (buffer.length < 2) return false;

    // BMP signature: BM
    return buffer[0] === 0x42 && buffer[1] === 0x4D;
}

/**
 * Checks if a file appears to be a WebP image based on its header
 * @param buffer - File buffer to check
 * @returns True if the file has a WebP signature
 */
export function isWebpFile(buffer: Buffer): boolean {
    if (buffer.length < 12) return false;

    // WebP signature: RIFF....WEBP
    return (
        buffer[0] === 0x52 &&
        buffer[1] === 0x49 &&
        buffer[2] === 0x46 &&
        buffer[3] === 0x46 &&
        buffer[8] === 0x57 &&
        buffer[9] === 0x45 &&
        buffer[10] === 0x42 &&
        buffer[11] === 0x50
    );
}

/**
 * Checks if a file appears to be a TIFF image based on its header
 * @param buffer - File buffer to check
 * @returns True if the file has a TIFF signature
 */
export function isTiffFile(buffer: Buffer): boolean {
    if (buffer.length < 4) return false;

    // TIFF signature: II*\0 (little endian) or MM\0* (big endian)
    return (
        (buffer[0] === 0x49 && buffer[1] === 0x49 && buffer[2] === 0x2A && buffer[3] === 0x00) ||
        (buffer[0] === 0x4D && buffer[1] === 0x4D && buffer[2] === 0x00 && buffer[3] === 0x2A)
    );
}

/**
 * Checks if a file appears to be an image file of any supported format
 * @param buffer - File buffer to check
 * @returns True if the file is a supported image format
 */
export function isImageFile(buffer: Buffer): boolean {
    return (
        isPngFile(buffer) ||
        isJpegFile(buffer) ||
        isGifFile(buffer) ||
        isBmpFile(buffer) ||
        isWebpFile(buffer) ||
        isTiffFile(buffer)
    );
}

/**
 * Gets the image format from a file buffer
 * @param buffer - File buffer to check
 * @returns Image format string or null if not recognized
 */
export function getImageFormat(buffer: Buffer): string | null {
    if (isPngFile(buffer)) return 'png';
    if (isJpegFile(buffer)) return 'jpeg';
    if (isGifFile(buffer)) return 'gif';
    if (isBmpFile(buffer)) return 'bmp';
    if (isWebpFile(buffer)) return 'webp';
    if (isTiffFile(buffer)) return 'tiff';
    return null;
}

/**
 * Extracts the base filename without extension
 * @param filepath - Full file path
 * @returns Filename without extension
 */
export function getFileNameWithoutExtension(filepath: string): string {
    const base = basename(filepath);
    const ext = extname(base);
    return ext ? base.slice(0, -ext.length) : base;
}

/**
 * Generates an output filename based on input and options
 * @param inputPath - Input file path
 * @param outputPath - Optional output path from user
 * @param suffix - Suffix to add to filename
 * @param extension - File extension to use
 * @returns Output filename
 */
export function generateOutputFilename(
    inputPath: string,
    outputPath: string | undefined,
    suffix: string,
    extension: string
): string {
    if (outputPath) {
        // If a custom output path is provided and we have a suffix (stereo),
        // insert the suffix before the extension
        if (suffix) {
            const ext = extname(outputPath);
            const base = ext ? outputPath.slice(0, -ext.length) : outputPath;
            return `${base}${suffix}${ext || '.' + extension}`;
        }
        return outputPath;
    }

    const baseName = getFileNameWithoutExtension(inputPath);
    return `${baseName}${suffix}.${extension}`;
}
