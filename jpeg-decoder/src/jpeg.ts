// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 Kyle Alexander Buan

import type { RawImageData } from '@pixel-exchange-format/codec';
import { parseJPEG } from './parser';
import { decodeImage } from './decoder';

export function decodeJPEG(buffer: ArrayBuffer): RawImageData {
  const jpegData = parseJPEG(new Uint8Array(buffer));

  const result = decodeImage(jpegData);

  return result;
}

export function isJPEG(buffer: ArrayBuffer): boolean {
  const view = new DataView(buffer);
  if (buffer.byteLength < 2) return false;

  // Check for SOI marker (Start of Image)
  return view.getUint16(0, false) === 0xFFD8;
}
