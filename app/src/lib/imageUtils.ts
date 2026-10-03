// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 Kyle Alexander Buan

import type { RawImageData } from '@pixel-exchange-format/codec';
import { decodeJPEG, isJPEG } from '@pixel-exchange-format/jpeg-decoder';
import * as m from '$lib/paraglide/messages';

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
				if (!ctx) throw new Error(m.error_no_2d_context());
				ctx.drawImage(img, 0, 0);
				const imageData = ctx.getImageData(0, 0, img.width, img.height);
				resolve([
					{
						data: imageData.data,
						width: imageData.width,
						height: imageData.height
					},
					false
				]);
				URL.revokeObjectURL(img.src);
			} catch (err) {
				reject(err);
			}
		};
		img.onerror = () => {
			URL.revokeObjectURL(img.src);
			reject(new Error(m.error_could_not_load_image()));
		};
		img.src = URL.createObjectURL(file);
	});
}
