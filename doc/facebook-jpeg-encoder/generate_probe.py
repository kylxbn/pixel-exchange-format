#!/usr/bin/env python3
from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np
from PIL import Image

IMAGE_SIZE = 1024
TILE_SIZE = 256
BLOCK_SIZE = 8
MID = 128.0

ROOT = Path(__file__).resolve().parents[2]
ARTIFACT_DIR = ROOT / "doc" / "artifacts" / "facebook-jpeg-encoder"
PNG_PATH = ARTIFACT_DIR / "probe.png"
MANIFEST_PATH = ARTIFACT_DIR / "probe-manifest.json"


def clamp_u8(values: np.ndarray) -> np.ndarray:
    return np.clip(np.rint(values), 0, 255).astype(np.uint8)


def ycbcr_to_rgb(y: np.ndarray, cb: np.ndarray, cr: np.ndarray) -> np.ndarray:
    cb_shift = cb - MID
    cr_shift = cr - MID
    r = y + 1.402 * cr_shift
    g = y - 0.344136 * cb_shift - 0.714136 * cr_shift
    b = y + 1.772 * cb_shift
    return np.stack([r, g, b], axis=-1)


def make_coords(size: int = TILE_SIZE) -> tuple[np.ndarray, np.ndarray]:
    yy, xx = np.mgrid[0:size, 0:size]
    return xx.astype(np.float64), yy.astype(np.float64)


def fill_ycbcr(y: np.ndarray, cb: np.ndarray | float, cr: np.ndarray | float) -> np.ndarray:
    if np.isscalar(cb):
        cb = np.full_like(y, float(cb))
    if np.isscalar(cr):
        cr = np.full_like(y, float(cr))
    return clamp_u8(ycbcr_to_rgb(y, cb, cr))


def dct_basis_block(u: int, v: int, amplitude: float, base: float = MID) -> np.ndarray:
    x = np.arange(BLOCK_SIZE, dtype=np.float64)
    y = np.arange(BLOCK_SIZE, dtype=np.float64)
    alpha_u = 1.0 / math.sqrt(2.0) if u == 0 else 1.0
    alpha_v = 1.0 / math.sqrt(2.0) if v == 0 else 1.0
    basis = (
        0.25
        * alpha_u
        * alpha_v
        * np.cos((2.0 * x + 1.0) * u * math.pi / 16.0)[None, :]
        * np.cos((2.0 * y + 1.0) * v * math.pi / 16.0)[:, None]
    )
    return base + amplitude * basis


def repeated_basis_tile(
    channel: str,
    coeffs: list[tuple[int, int]],
    amplitude: float,
    base: float = MID,
) -> np.ndarray:
    tile = np.zeros((TILE_SIZE, TILE_SIZE, 3), dtype=np.uint8)
    for by in range(0, TILE_SIZE, BLOCK_SIZE):
        for bx in range(0, TILE_SIZE, BLOCK_SIZE):
            block_index = (by // BLOCK_SIZE) * (TILE_SIZE // BLOCK_SIZE) + (bx // BLOCK_SIZE)
            u, v = coeffs[block_index % len(coeffs)]
            plane = dct_basis_block(u, v, amplitude=amplitude, base=base)
            y = np.full((BLOCK_SIZE, BLOCK_SIZE), MID, dtype=np.float64)
            cb = np.full((BLOCK_SIZE, BLOCK_SIZE), MID, dtype=np.float64)
            cr = np.full((BLOCK_SIZE, BLOCK_SIZE), MID, dtype=np.float64)
            if channel == "Y":
                y = plane
            elif channel == "Cb":
                cb = plane
            elif channel == "Cr":
                cr = plane
            else:
                raise ValueError(f"unknown channel: {channel}")
            tile[by : by + BLOCK_SIZE, bx : bx + BLOCK_SIZE] = clamp_u8(ycbcr_to_rgb(y, cb, cr))
    return tile


def chroma_bar_tile(horizontal: bool, axis: str) -> np.ndarray:
    xx, yy = make_coords()
    if horizontal:
        phase = yy
    else:
        phase = xx
    stripe = ((phase.astype(np.int32) % 2) * 2 - 1).astype(np.float64)
    y = np.full((TILE_SIZE, TILE_SIZE), MID, dtype=np.float64)
    cb = np.full_like(y, MID)
    cr = np.full_like(y, MID)
    if axis in {"Cb", "Both"}:
        cb += 52.0 * stripe
    if axis in {"Cr", "Both"}:
        cr += 52.0 * -stripe
    return clamp_u8(ycbcr_to_rgb(y, cb, cr))


def impulse_tile(chroma: bool) -> np.ndarray:
    y = np.full((TILE_SIZE, TILE_SIZE), MID, dtype=np.float64)
    cb = np.full_like(y, MID)
    cr = np.full_like(y, MID)
    offsets = [(1, 1), (2, 5), (5, 2), (6, 6)]
    for by in range(0, TILE_SIZE, BLOCK_SIZE):
        for bx in range(0, TILE_SIZE, BLOCK_SIZE):
            offset_y, offset_x = offsets[((by // BLOCK_SIZE) + (bx // BLOCK_SIZE)) % len(offsets)]
            if chroma:
                cb[by + offset_y, bx + offset_x] = 196
                cr[by + offset_y, bx + offset_x] = 68
            else:
                y[by + offset_y, bx + offset_x] = 216
    return clamp_u8(ycbcr_to_rgb(y, cb, cr))


def chirp_tile(horizontal: bool) -> np.ndarray:
    xx, yy = make_coords()
    axis = xx if horizontal else yy
    cross = yy if horizontal else xx
    freq = 0.3 + 2.7 * (cross / (TILE_SIZE - 1))
    phase = 2.0 * math.pi * freq * axis / 16.0
    y = MID + 46.0 * np.cos(phase)
    cb = MID + 12.0 * np.cos(phase / 3.0 + 0.5)
    cr = MID + 10.0 * np.sin(phase / 2.0 + 0.8)
    return clamp_u8(ycbcr_to_rgb(y, cb, cr))


def mcu_phase_tile() -> np.ndarray:
    xx, yy = make_coords()
    y = np.full((TILE_SIZE, TILE_SIZE), MID, dtype=np.float64)
    cb = np.full_like(y, MID)
    cr = np.full_like(y, MID)
    for band in range(16):
        left = band * 16
        right = left + 16
        threshold = left + band
        mask = xx[:, left:right] >= threshold
        cb[:, left:right][mask] = 188
        cb[:, left:right][~mask] = 68
        cr[:, left:right][mask] = 76
        cr[:, left:right][~mask] = 180
    y += 18.0 * np.sin(2.0 * math.pi * yy / 32.0)
    return clamp_u8(ycbcr_to_rgb(y, cb, cr))


def saturated_quads_tile() -> np.ndarray:
    xx, yy = make_coords()
    y = np.where(xx < TILE_SIZE / 2, 92.0, 196.0)
    y = np.where(yy < TILE_SIZE / 2, y, 255.0 - y)
    cb = np.where(xx + yy < TILE_SIZE, 52.0, 210.0)
    cr = np.where(xx > yy, 206.0, 60.0)
    y += 18.0 * (((xx + yy) % 16) < 8)
    return clamp_u8(ycbcr_to_rgb(y, cb, cr))


def smooth_ramps_tile() -> np.ndarray:
    xx, yy = make_coords()
    r = 20.0 + 220.0 * xx / (TILE_SIZE - 1)
    g = 20.0 + 220.0 * yy / (TILE_SIZE - 1)
    b = 30.0 + 180.0 * (xx + yy) / (2.0 * (TILE_SIZE - 1))
    r += 6.0 * np.sin(2.0 * math.pi * yy / 32.0)
    g += 6.0 * np.cos(2.0 * math.pi * xx / 32.0)
    return clamp_u8(np.stack([r, g, b], axis=-1))


def zone_plate_tile() -> np.ndarray:
    xx, yy = make_coords()
    x = (xx - TILE_SIZE / 2) / TILE_SIZE
    y = (yy - TILE_SIZE / 2) / TILE_SIZE
    radius_sq = x * x + y * y
    theta = 120.0 * radius_sq
    luma = MID + 52.0 * np.cos(2.0 * math.pi * theta)
    cb = MID + 18.0 * np.sin(2.0 * math.pi * (theta * 0.7 + x * 3.0))
    cr = MID + 18.0 * np.cos(2.0 * math.pi * (theta * 0.5 - y * 2.0))
    return clamp_u8(ycbcr_to_rgb(luma, cb, cr))


def deterministic_noise_tile() -> np.ndarray:
    xx, yy = make_coords()
    seed = ((xx.astype(np.int64) * 1103515245) ^ (yy.astype(np.int64) * 12345) ^ 0x5A17) & 0xFFFFFFFF
    noise = ((seed >> 8) & 0xFF).astype(np.float64)
    noise = noise - noise.mean()
    y = MID + 0.45 * noise + 18.0 * np.sin(2.0 * math.pi * xx / 64.0)
    cb = MID + 0.18 * noise + 12.0 * np.cos(2.0 * math.pi * yy / 40.0)
    cr = MID - 0.16 * noise + 10.0 * np.sin(2.0 * math.pi * (xx + yy) / 48.0)
    return clamp_u8(ycbcr_to_rgb(y, cb, cr))


def build_probe() -> tuple[np.ndarray, list[dict[str, object]]]:
    coeffs_low = [(0, 1), (1, 0), (1, 1), (0, 2), (2, 0), (2, 1), (1, 2), (2, 2)]
    coeffs_high = [(0, 5), (5, 0), (3, 4), (4, 3), (5, 2), (2, 5), (6, 1), (1, 6)]
    tiles: list[tuple[np.ndarray, str, str]] = [
        (
            repeated_basis_tile("Y", coeffs_low, amplitude=84.0),
            "y_basis_low",
            "Repeated 8x8 luma blocks with low-frequency single-coefficient basis patterns.",
        ),
        (
            repeated_basis_tile("Y", coeffs_high, amplitude=72.0),
            "y_basis_high",
            "Repeated 8x8 luma blocks with higher-frequency single-coefficient basis patterns.",
        ),
        (
            repeated_basis_tile("Cb", coeffs_low, amplitude=82.0),
            "cb_basis_low",
            "Repeated 8x8 chroma-Cb basis patterns at constant luma.",
        ),
        (
            repeated_basis_tile("Cr", coeffs_low, amplitude=82.0),
            "cr_basis_low",
            "Repeated 8x8 chroma-Cr basis patterns at constant luma.",
        ),
        (
            chirp_tile(horizontal=True),
            "y_chirp_horizontal",
            "Continuous horizontal luma chirp with mild chroma motion to expose non-block-aligned energy handling.",
        ),
        (
            chirp_tile(horizontal=False),
            "y_chirp_vertical",
            "Continuous vertical luma chirp with mild chroma motion to expose non-block-aligned energy handling.",
        ),
        (
            chroma_bar_tile(horizontal=False, axis="Both"),
            "chroma_bars_vertical",
            "One-pixel vertical chroma bars at constant luma to stress 4:2:0 downsampling and chroma phase.",
        ),
        (
            chroma_bar_tile(horizontal=True, axis="Both"),
            "chroma_bars_horizontal",
            "One-pixel horizontal chroma bars at constant luma to stress 4:2:0 downsampling and chroma phase.",
        ),
        (
            chroma_bar_tile(horizontal=False, axis="Cb"),
            "cb_only_bars",
            "One-pixel vertical Cb-only bars with neutral Cr to isolate blue-difference chroma handling.",
        ),
        (
            mcu_phase_tile(),
            "mcu_phase_edges",
            "Sharp chroma transitions stepped through all 16 horizontal phases inside 16x16 MCUs.",
        ),
        (
            impulse_tile(chroma=True),
            "chroma_impulses",
            "Single-pixel chroma impulses at varying offsets within each 8x8 block.",
        ),
        (
            impulse_tile(chroma=False),
            "luma_impulses",
            "Single-pixel luma impulses at varying offsets within each 8x8 block.",
        ),
        (
            saturated_quads_tile(),
            "saturated_quads",
            "Large saturated color fields, hard edges, and diagonal seams for color conversion and clipping behavior.",
        ),
        (
            smooth_ramps_tile(),
            "smooth_ramps",
            "Smooth RGB ramps with gentle periodic modulation to reveal rounding and low-amplitude bias.",
        ),
        (
            zone_plate_tile(),
            "zone_plate",
            "Radial zone-plate style luma/chroma pattern to distribute energy across many frequencies.",
        ),
        (
            deterministic_noise_tile(),
            "deterministic_noise",
            "Deterministic pseudo-random texture with structured low-frequency content for realistic coefficient distributions.",
        ),
    ]

    canvas = np.zeros((IMAGE_SIZE, IMAGE_SIZE, 3), dtype=np.uint8)
    manifest: list[dict[str, object]] = []
    for index, (tile, name, description) in enumerate(tiles):
        row = index // 4
        col = index % 4
        top = row * TILE_SIZE
        left = col * TILE_SIZE
        canvas[top : top + TILE_SIZE, left : left + TILE_SIZE] = tile
        manifest.append(
            {
                "name": name,
                "description": description,
                "grid_position": [row, col],
                "pixel_bounds": {
                    "left": left,
                    "top": top,
                    "right_exclusive": left + TILE_SIZE,
                    "bottom_exclusive": top + TILE_SIZE,
                },
            }
        )
    return canvas, manifest


def main() -> None:
    ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)
    probe, manifest = build_probe()
    Image.fromarray(probe, mode="RGB").save(PNG_PATH, format="PNG", compress_level=9)
    payload = {
        "image_size": [IMAGE_SIZE, IMAGE_SIZE],
        "tile_size": TILE_SIZE,
        "jpeg_assumptions": {
            "target_sampling": "4:2:0",
            "known_quantization_family": "libjpeg Q92",
        },
        "tiles": manifest,
    }
    MANIFEST_PATH.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print(PNG_PATH)
    print(MANIFEST_PATH)


if __name__ == "__main__":
    main()
