#!/usr/bin/env python3

from __future__ import annotations

import argparse
import json
import subprocess
import tempfile
from pathlib import Path

ZIGZAG_4X4_FLAT = [0, 1, 4, 8, 5, 2, 3, 6, 9, 12, 13, 10, 7, 11, 14, 15]
ZIGZAG_8X8_FLAT = [
    0, 1, 8, 16, 9, 2, 3, 10,
    17, 24, 32, 25, 18, 11, 4, 5,
    12, 19, 26, 33, 40, 48, 41, 34,
    27, 20, 13, 6, 7, 14, 21, 28,
    35, 42, 49, 56, 57, 50, 43, 36,
    29, 22, 15, 23, 30, 37, 44, 51,
    58, 59, 52, 45, 38, 31, 39, 46,
    53, 60, 61, 54, 47, 55, 62, 63,
]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Generate weighted JPEG quantization ranking presets."
    )
    parser.add_argument("--start", type=int, required=True)
    parser.add_argument("--end", type=int, required=True)
    parser.add_argument("--center", type=int, required=True)
    parser.add_argument("--sampling-factor", default="2x2,1x1,1x1")
    parser.add_argument("--preset-name", required=True)
    parser.add_argument("--report-out", type=Path, required=True)
    parser.add_argument("--json-out", type=Path)
    return parser.parse_args()


def triangular_weight(quality: int, center: int, radius: int) -> int:
    return radius + 1 - abs(quality - center)


def parse_tables(path: Path) -> list[dict[str, object]]:
    data = path.read_bytes()
    if data[:2] != b"\xff\xd8":
        raise ValueError(f"{path} is not a JPEG file")

    tables: list[dict[str, object]] = []
    index = 2
    while index < len(data):
        while index < len(data) and data[index] != 0xFF:
            index += 1
        if index >= len(data):
            break
        while index < len(data) and data[index] == 0xFF:
            index += 1
        if index >= len(data):
            break

        marker = data[index]
        index += 1
        if marker in (0xD9, 0xDA):
            break

        segment_length = (data[index] << 8) | data[index + 1]
        index += 2
        if marker == 0xDB:
            pos = index
            end = index + segment_length - 2
            while pos < end:
                pq_tq = data[pos]
                pos += 1
                precision = pq_tq >> 4
                table_id = pq_tq & 0x0F
                count = 64 * (2 if precision else 1)
                values = list(data[pos:pos + count])
                tables.append({
                    "id": table_id,
                    "precision": precision,
                    "values": values,
                })
                pos += count

        index += segment_length - 2

    return sorted(tables, key=lambda table: int(table["id"]))


def generate_quality_tables(
    start: int,
    end: int,
    sampling_factor: str,
) -> dict[int, list[dict[str, object]]]:
    tables_by_quality: dict[int, list[dict[str, object]]] = {}
    with tempfile.TemporaryDirectory(prefix="jpeg-quant-preset-") as tmpdir:
        tmp = Path(tmpdir)
        source = tmp / "source.png"
        subprocess.run(
            ["magick", "-size", "256x256", "plasma:fractal", str(source)],
            check=True,
        )

        for quality in range(start, end + 1):
            output = tmp / f"q{quality}.jpg"
            subprocess.run(
                [
                    "magick",
                    str(source),
                    "-sampling-factor",
                    sampling_factor,
                    "-quality",
                    str(quality),
                    str(output),
                ],
                check=True,
            )
            tables_by_quality[quality] = parse_tables(output)

    return tables_by_quality


def format_matrix(values: list[int], width: int) -> str:
    rows = []
    for offset in range(0, len(values), width):
        row = " ".join(f"{value:>2}" for value in values[offset:offset + width])
        rows.append(row)
    return "\n".join(rows)


def rank_component(
    tables_by_quality: dict[int, list[dict[str, object]]],
    qualities: list[int],
    weights: dict[int, int],
    table_index: int,
    slot_count: int,
    natural_order: list[int],
    row_width: int,
    center_quality: int,
) -> tuple[list[dict[str, object]], list[int]]:
    rows: list[dict[str, object]] = []
    total_weight = sum(weights[quality] for quality in qualities)

    for slot in range(slot_count):
        weighted_sum = 0
        per_quality: dict[int, int] = {}
        for quality in qualities:
            value = int(tables_by_quality[quality][table_index]["values"][slot])
            per_quality[quality] = value
            weighted_sum += value * weights[quality]

        weighted_average = weighted_sum / total_weight
        natural_index = natural_order[slot]
        rows.append({
            "slot": slot,
            "natural": natural_index,
            "x": natural_index % row_width,
            "y": natural_index // row_width,
            "weighted_average": weighted_average,
            "center_value": per_quality[center_quality],
            "values": per_quality,
        })

    ranked_rows = sorted(
        rows,
        key=lambda row: (
            float(row["weighted_average"]),
            int(row["center_value"]),
            int(row["slot"]),
        ),
    )
    ranked_natural = [int(row["natural"]) for row in ranked_rows]
    return ranked_rows, ranked_natural


def build_report(
    preset_name: str,
    qualities: list[int],
    weights: dict[int, int],
    tables_by_quality: dict[int, list[dict[str, object]]],
    luma_rows: list[dict[str, object]],
    luma_order: list[int],
    chroma_rows: list[dict[str, object]],
    chroma_order: list[int],
    sampling_factor: str,
) -> str:
    lines: list[str] = []
    lines.append(f"JPEG quantization tables and derived coefficient rankings for {preset_name}")
    lines.append("")
    lines.append(f"Sampling factor used for derivation: {sampling_factor}")
    lines.append("Source encoder: ImageMagick/libjpeg standard tables")
    lines.append("Weighting rule: triangular weighting centered on the target quality")
    lines.append("Tie-break for equal weighted averages: lower center-quality value, then lower JPEG zigzag slot")
    lines.append("")
    lines.append("Weights by quality")
    for quality in qualities:
        lines.append(f"Q{quality}: {weights[quality]}")
    lines.append("")

    for quality in qualities:
        luma = [int(value) for value in tables_by_quality[quality][0]["values"]]
        chroma = [int(value) for value in tables_by_quality[quality][1]["values"]]
        lines.append(f"Q{quality} luma table (JPEG DQT / zigzag slot order)")
        lines.append(format_matrix(luma, 8))
        lines.append("")
        lines.append(f"Q{quality} chroma table (JPEG DQT / zigzag slot order)")
        lines.append(format_matrix(chroma, 8))
        lines.append("")

    lines.append("Derived luma ranking")
    lines.append("rank slot natural_index (x,y) center weighted_average values")
    for rank, row in enumerate(luma_rows):
        values = " ".join(f"Q{quality}={int(row['values'][quality])}" for quality in qualities)
        lines.append(
            f"{rank:>2} {int(row['slot']):>2} {int(row['natural']):>2} "
            f"({int(row['x'])},{int(row['y'])}) {int(row['center_value']):>2} "
            f"{float(row['weighted_average']):.6f} {values}"
        )
    lines.append("")
    lines.append("Derived luma preset natural-index order")
    lines.append(str(luma_order))
    lines.append("")

    lines.append("Derived chroma ranking from the first 16 JPEG chroma zigzag slots")
    lines.append("rank slot natural_index (x,y) center weighted_average values")
    for rank, row in enumerate(chroma_rows):
        values = " ".join(f"Q{quality}={int(row['values'][quality])}" for quality in qualities)
        lines.append(
            f"{rank:>2} {int(row['slot']):>2} {int(row['natural']):>2} "
            f"({int(row['x'])},{int(row['y'])}) {int(row['center_value']):>2} "
            f"{float(row['weighted_average']):.6f} {values}"
        )
    lines.append("")
    lines.append("Derived chroma preset natural-index order")
    lines.append(str(chroma_order))
    lines.append("")
    lines.append("As Uint8Array literals")
    lines.append("luma8x8 = [")
    for offset in range(0, len(luma_order), 8):
        chunk = ", ".join(f"{value:>2}" for value in luma_order[offset:offset + 8])
        lines.append(f"    {chunk},")
    lines.append("]")
    lines.append("")
    lines.append("chroma4x4 = [")
    for offset in range(0, len(chroma_order), 4):
        chunk = ", ".join(f"{value:>2}" for value in chroma_order[offset:offset + 4])
        lines.append(f"    {chunk},")
    lines.append("]")
    lines.append("")
    return "\n".join(lines)


def main() -> None:
    args = parse_args()
    qualities = list(range(args.start, args.end + 1))
    radius = max(abs(args.center - args.start), abs(args.end - args.center))
    weights = {
        quality: triangular_weight(quality, args.center, radius)
        for quality in qualities
    }

    tables_by_quality = generate_quality_tables(
        start=args.start,
        end=args.end,
        sampling_factor=args.sampling_factor,
    )

    luma_rows, luma_order = rank_component(
        tables_by_quality=tables_by_quality,
        qualities=qualities,
        weights=weights,
        table_index=0,
        slot_count=64,
        natural_order=ZIGZAG_8X8_FLAT,
        row_width=8,
        center_quality=args.center,
    )
    chroma_rows, chroma_order = rank_component(
        tables_by_quality=tables_by_quality,
        qualities=qualities,
        weights=weights,
        table_index=1,
        slot_count=16,
        natural_order=ZIGZAG_4X4_FLAT,
        row_width=4,
        center_quality=args.center,
    )

    report = build_report(
        preset_name=args.preset_name,
        qualities=qualities,
        weights=weights,
        tables_by_quality=tables_by_quality,
        luma_rows=luma_rows,
        luma_order=luma_order,
        chroma_rows=chroma_rows,
        chroma_order=chroma_order,
        sampling_factor=args.sampling_factor,
    )
    args.report_out.write_text(report + "\n", encoding="utf-8")

    payload = {
        "preset_name": args.preset_name,
        "qualities": qualities,
        "weights": weights,
        "luma8x8": luma_order,
        "chroma4x4": chroma_order,
    }
    if args.json_out is not None:
        args.json_out.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")

    print(json.dumps(payload, indent=2))


if __name__ == "__main__":
    main()
