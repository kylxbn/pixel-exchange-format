#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import math
import shutil
import subprocess
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

import jpeglib
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
ARTIFACT_DIR = ROOT / "doc" / "artifacts" / "facebook-jpeg-encoder"
DEFAULT_PROBE = ARTIFACT_DIR / "probe.png"
DEFAULT_TARGET = ARTIFACT_DIR / "facebook-roundtrip.jpg"
DEFAULT_CANDIDATE_DIR = ARTIFACT_DIR / "candidates"
DEFAULT_REPORT = ARTIFACT_DIR / "report.json"


@dataclass(frozen=True)
class Candidate:
    name: str
    encoder: str
    note: str
    runner: Callable[[Path, Path, Path], None]


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def run_command(args: list[str]) -> None:
    subprocess.run(args, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)


def save_probe_ppm(probe_path: Path, ppm_path: Path) -> None:
    Image.open(probe_path).convert("RGB").save(ppm_path, format="PPM")


def cjpeg_runner(dct_method: str, optimize: bool = False) -> Callable[[Path, Path, Path], None]:
    def runner(probe_path: Path, output_path: Path, scratch_dir: Path) -> None:
        ppm_path = scratch_dir / "probe.ppm"
        save_probe_ppm(probe_path, ppm_path)
        args = [
            "cjpeg",
            "-quality",
            "92",
            "-sample",
            "2x2,1x1,1x1",
            "-dct",
            dct_method,
        ]
        if optimize:
            args.append("-optimize")
        args.extend(["-outfile", str(output_path), str(ppm_path)])
        run_command(args)

    return runner


def pillow_runner(optimize: bool = False) -> Callable[[Path, Path, Path], None]:
    def runner(probe_path: Path, output_path: Path, _scratch_dir: Path) -> None:
        Image.open(probe_path).convert("RGB").save(
            output_path,
            format="JPEG",
            quality=92,
            subsampling=2,
            optimize=optimize,
            progressive=False,
        )

    return runner


def magick_runner(probe_path: Path, output_path: Path, _scratch_dir: Path) -> None:
    run_command(
        [
            "magick",
            str(probe_path),
            "-sampling-factor",
            "4:2:0",
            "-interlace",
            "none",
            "-quality",
            "92",
            str(output_path),
        ]
    )


def gm_runner(probe_path: Path, output_path: Path, _scratch_dir: Path) -> None:
    run_command(
        [
            "gm",
            "convert",
            str(probe_path),
            "-sampling-factor",
            "2x2",
            "-interlace",
            "none",
            "-quality",
            "92",
            str(output_path),
        ]
    )


def vips_runner(probe_path: Path, output_path: Path, _scratch_dir: Path) -> None:
    run_command(
        [
            "vips",
            "copy",
            str(probe_path),
            f"{output_path}[Q=92,optimize-coding=0,interlace=0,subsample-mode=on,keep=none]",
        ]
    )


def build_candidates() -> list[Candidate]:
    return [
        Candidate("cjpeg_int", "cjpeg", "libjpeg-turbo integer FDCT", cjpeg_runner("int")),
        Candidate("cjpeg_fast", "cjpeg", "libjpeg-turbo fast integer FDCT", cjpeg_runner("fast")),
        Candidate("cjpeg_float", "cjpeg", "libjpeg-turbo float FDCT", cjpeg_runner("float")),
        Candidate("cjpeg_int_opt", "cjpeg", "libjpeg-turbo integer FDCT with optimized Huffman tables", cjpeg_runner("int", optimize=True)),
        Candidate("pillow", "pillow", "Pillow save() using libjpeg backend", pillow_runner()),
        Candidate("pillow_opt", "pillow", "Pillow save() with optimize=True", pillow_runner(optimize=True)),
        Candidate("magick", "magick", "ImageMagick JPEG writer", magick_runner),
        Candidate("gm", "gm", "GraphicsMagick JPEG writer", gm_runner),
        Candidate("vips", "vips", "libvips jpegsave", vips_runner),
    ]


def jpeg_components(jpeg: jpeglib.DCTJPEG) -> dict[str, np.ndarray]:
    components: dict[str, np.ndarray] = {"Y": jpeg.Y}
    if getattr(jpeg, "Cb", None) is not None:
        components["Cb"] = jpeg.Cb
    if getattr(jpeg, "Cr", None) is not None:
        components["Cr"] = jpeg.Cr
    return components


def component_hashes(jpeg: jpeglib.DCTJPEG) -> dict[str, str]:
    hashes: dict[str, str] = {}
    for name, array in jpeg_components(jpeg).items():
        hashes[name] = sha256_bytes(np.ascontiguousarray(array).tobytes())
    return hashes


def jpeg_summary(path: Path) -> dict[str, object]:
    jpeg = jpeglib.read_dct(str(path))
    coeff_hash_parts = [component_hashes(jpeg)[name] for name in sorted(jpeg_components(jpeg))]
    return {
        "path": str(path.relative_to(ROOT)),
        "size_bytes": path.stat().st_size,
        "progressive": bool(jpeg.progressive_mode),
        "sampling_factors": np.asarray(jpeg.samp_factor).tolist(),
        "block_dims": np.asarray(jpeg.block_dims).tolist(),
        "quant_table_slots": np.asarray(jpeg.quant_tbl_no).tolist(),
        "quant_tables": np.asarray(jpeg.qt).tolist(),
        "quant_table_hash": sha256_bytes(np.ascontiguousarray(jpeg.qt).tobytes()),
        "coeff_hash": sha256_bytes("".join(coeff_hash_parts).encode("ascii")),
        "component_hashes": component_hashes(jpeg),
        "markers": [repr(marker) for marker in jpeg.markers],
    }


def compare_component_arrays(target: np.ndarray, candidate: np.ndarray) -> dict[str, object]:
    if target.shape != candidate.shape:
        return {"same_shape": False, "target_shape": list(target.shape), "candidate_shape": list(candidate.shape)}
    diff = candidate.astype(np.int32) - target.astype(np.int32)
    flat = diff.reshape(-1, 64)
    abs_flat = np.abs(flat)
    dc = flat[:, 0]
    ac = flat[:, 1:]
    abs_dc = np.abs(dc)
    abs_ac = np.abs(ac)
    return {
        "same_shape": True,
        "shape": list(target.shape),
        "coeff_count": int(flat.size),
        "exact_ratio": float(np.mean(flat == 0)),
        "mae": float(abs_flat.mean()),
        "rmse": float(np.sqrt(np.mean(flat.astype(np.float64) ** 2))),
        "max_abs": int(abs_flat.max(initial=0)),
        "dc_exact_ratio": float(np.mean(dc == 0)),
        "dc_mae": float(abs_dc.mean()),
        "ac_exact_ratio": float(np.mean(ac == 0)),
        "ac_mae": float(abs_ac.mean()),
    }


def compare_jpegs(target_path: Path, candidate_path: Path) -> dict[str, object]:
    target = jpeglib.read_dct(str(target_path))
    candidate = jpeglib.read_dct(str(candidate_path))
    target_components = jpeg_components(target)
    candidate_components = jpeg_components(candidate)
    component_results: dict[str, object] = {}
    total_coeffs = 0
    weighted_exact = 0.0
    weighted_mae = 0.0
    weighted_rmse_sq = 0.0
    for name in sorted(target_components):
        result = compare_component_arrays(target_components[name], candidate_components[name])
        component_results[name] = result
        if result.get("same_shape"):
            coeff_count = int(result["coeff_count"])
            total_coeffs += coeff_count
            weighted_exact += coeff_count * float(result["exact_ratio"])
            weighted_mae += coeff_count * float(result["mae"])
            weighted_rmse_sq += coeff_count * float(result["rmse"]) ** 2
    summary = {
        "same_sampling": np.array_equal(target.samp_factor, candidate.samp_factor),
        "same_quant_tables": np.array_equal(target.qt, candidate.qt),
        "same_quant_slots": np.array_equal(target.quant_tbl_no, candidate.quant_tbl_no),
        "same_progressive_flag": bool(target.progressive_mode) == bool(candidate.progressive_mode),
        "components": component_results,
    }
    if total_coeffs:
        summary["overall"] = {
            "coeff_count": total_coeffs,
            "exact_ratio": weighted_exact / total_coeffs,
            "mae": weighted_mae / total_coeffs,
            "rmse": math.sqrt(weighted_rmse_sq / total_coeffs),
        }
        summary["score"] = (
            (5000.0 if summary["same_quant_tables"] else 0.0)
            + (500.0 if summary["same_sampling"] else 0.0)
            + (250.0 if summary["same_progressive_flag"] else 0.0)
            + 1000.0 * float(summary["overall"]["exact_ratio"])
            - 20.0 * float(summary["overall"]["mae"])
        )
    return summary


def encode_candidates(probe_path: Path, candidate_dir: Path) -> tuple[list[dict[str, object]], list[dict[str, object]]]:
    candidate_dir.mkdir(parents=True, exist_ok=True)
    successes: list[dict[str, object]] = []
    failures: list[dict[str, object]] = []
    with tempfile.TemporaryDirectory(prefix="fb-jpeg-encoder-") as tmpdir:
        scratch_dir = Path(tmpdir)
        for candidate in build_candidates():
            output_path = candidate_dir / f"{candidate.name}.jpg"
            if candidate.encoder not in {"pillow"} and shutil.which(candidate.encoder) is None:
                failures.append({"name": candidate.name, "reason": f"missing executable: {candidate.encoder}"})
                continue
            try:
                candidate.runner(probe_path, output_path, scratch_dir)
                summary = jpeg_summary(output_path)
                summary["name"] = candidate.name
                summary["encoder"] = candidate.encoder
                summary["note"] = candidate.note
                successes.append(summary)
            except Exception as exc:  # noqa: BLE001
                failures.append({"name": candidate.name, "reason": str(exc)})
                output_path.unlink(missing_ok=True)
    successes.sort(key=lambda item: str(item["name"]))
    failures.sort(key=lambda item: str(item["name"]))
    return successes, failures


def exact_equivalence_pairs(candidates: list[dict[str, object]]) -> list[list[str]]:
    pairs: list[list[str]] = []
    for index, left in enumerate(candidates):
        for right in candidates[index + 1 :]:
            if (
                left["coeff_hash"] == right["coeff_hash"]
                and left["quant_table_hash"] == right["quant_table_hash"]
                and left["sampling_factors"] == right["sampling_factors"]
                and left["progressive"] == right["progressive"]
            ):
                pairs.append([str(left["name"]), str(right["name"])])
    return pairs


def compare_against_target(target_path: Path, candidates: list[dict[str, object]], candidate_dir: Path) -> list[dict[str, object]]:
    results: list[dict[str, object]] = []
    for candidate in candidates:
        candidate_path = candidate_dir / f"{candidate['name']}.jpg"
        comparison = compare_jpegs(target_path, candidate_path)
        comparison["name"] = candidate["name"]
        comparison["encoder"] = candidate["encoder"]
        comparison["note"] = candidate["note"]
        results.append(comparison)
    results.sort(key=lambda item: float(item.get("score", float("-inf"))), reverse=True)
    return results


def print_summary(candidates: list[dict[str, object]], failures: list[dict[str, object]], target_results: list[dict[str, object]] | None) -> None:
    print(f"Probe candidates generated: {len(candidates)}")
    if failures:
        print(f"Skipped/failed candidates: {len(failures)}")
        for item in failures:
            print(f"  - {item['name']}: {item['reason']}")
    print("Candidate fingerprints:")
    for item in candidates:
        print(
            "  - "
            f"{item['name']}: size={item['size_bytes']} "
            f"progressive={item['progressive']} "
            f"sampling={item['sampling_factors']} "
            f"qt={str(item['quant_table_hash'])[:12]} "
            f"coeff={str(item['coeff_hash'])[:12]}"
        )
    pairs = exact_equivalence_pairs(candidates)
    if pairs:
        print("Exact coefficient-equivalent candidate pairs:")
        for left, right in pairs:
            print(f"  - {left} == {right}")
    if target_results is not None:
        print("Ranking against target:")
        for item in target_results[:8]:
            overall = item.get("overall", {})
            print(
                "  - "
                f"{item['name']}: score={item.get('score', 0.0):.2f} "
                f"qt={item['same_quant_tables']} "
                f"sampling={item['same_sampling']} "
                f"progressive={item['same_progressive_flag']} "
                f"exact={overall.get('exact_ratio', 0.0):.6f} "
                f"mae={overall.get('mae', 0.0):.4f}"
            )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate local JPEG candidates and compare them with a Facebook round-trip JPEG.")
    parser.add_argument("--probe", type=Path, default=DEFAULT_PROBE, help="Input PNG probe image.")
    parser.add_argument("--target", type=Path, default=DEFAULT_TARGET, help="Facebook-returned JPEG to compare against.")
    parser.add_argument("--candidate-dir", type=Path, default=DEFAULT_CANDIDATE_DIR, help="Directory for locally encoded JPEGs.")
    parser.add_argument("--report", type=Path, default=DEFAULT_REPORT, help="Path for the JSON report.")
    parser.add_argument("--skip-encode", action="store_true", help="Reuse existing candidate JPEGs instead of regenerating them.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if not args.probe.exists():
        print(f"missing probe image: {args.probe}", file=sys.stderr)
        return 1
    args.candidate_dir.mkdir(parents=True, exist_ok=True)
    if args.skip_encode:
        candidates = []
        failures = []
        for candidate in build_candidates():
            candidate_path = args.candidate_dir / f"{candidate.name}.jpg"
            if candidate_path.exists():
                summary = jpeg_summary(candidate_path)
                summary["name"] = candidate.name
                summary["encoder"] = candidate.encoder
                summary["note"] = candidate.note
                candidates.append(summary)
            else:
                failures.append({"name": candidate.name, "reason": "missing candidate jpeg"})
        candidates.sort(key=lambda item: str(item["name"]))
        failures.sort(key=lambda item: str(item["name"]))
    else:
        candidates, failures = encode_candidates(args.probe, args.candidate_dir)

    target_results = None
    if args.target.exists():
        target_results = compare_against_target(args.target, candidates, args.candidate_dir)

    report = {
        "probe": str(args.probe.relative_to(ROOT)),
        "target": str(args.target.relative_to(ROOT)),
        "target_exists": args.target.exists(),
        "candidates": candidates,
        "failures": failures,
        "equivalent_pairs": exact_equivalence_pairs(candidates),
        "target_results": target_results,
    }
    args.report.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print_summary(candidates, failures, target_results)
    print(args.report)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
