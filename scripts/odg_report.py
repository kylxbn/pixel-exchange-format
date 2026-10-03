#!/usr/bin/env python3
"""Generate timestamped PEAQ HTML reports for PXF audio round-trips."""

from __future__ import annotations

import argparse
import datetime as dt
import html
import json
import math
import shutil
import statistics
import subprocess
import sys
import tempfile
import wave
from array import array
from pathlib import Path
from typing import Any


DEFAULT_INPUT_DIR = Path("/mnt/dev/personal/projects/active/codec-bench-framework/input")
DEFAULT_REPORT_ROOT = Path("doc/artifacts/peaq-reports")
FACEBOOK_JPEG_RECIPE = "magick <png> ppm:- | cjpeg -quality 92 -sample 2x2,1x1,1x1 -dct int -optimize > <jpg>"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Round-trip WAVs through the current PXF CLI and score them with GstPEAQ.",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    parser.add_argument("--input-dir", type=Path, default=DEFAULT_INPUT_DIR, help="Directory containing WAV files.")
    parser.add_argument("--pattern", default="*.wav", help="Glob pattern used inside the input directory.")
    parser.add_argument("--limit", type=int, default=None, help="Only process the first N matching files.")
    parser.add_argument(
        "--report-root",
        type=Path,
        default=DEFAULT_REPORT_ROOT,
        help="Directory where timestamped report folders will be created.",
    )
    parser.add_argument(
        "--cli-entry",
        type=Path,
        default=Path("cli/dist/index.cjs"),
        help="CLI entrypoint used for encode/decode round-trips.",
    )
    parser.add_argument(
        "--decode-cli-entry",
        type=Path,
        default=None,
        help="CLI entrypoint used for decoding when it differs from --cli-entry (cross-version runs).",
    )
    parser.add_argument("--node-bin", default="node", help="Node.js executable.")
    parser.add_argument("--peaq-bin", default="peaq", help="GstPEAQ CLI executable.")
    parser.add_argument("--magick-bin", default="magick", help="ImageMagick executable used for PNG -> PPM.")
    parser.add_argument("--cjpeg-bin", default="cjpeg", help="libjpeg-turbo cjpeg executable used for Facebook-like JPEGs.")
    parser.add_argument(
        "--mode",
        choices=("advanced", "basic"),
        default="advanced",
        help="PEAQ mode. Use advanced for high-quality scoring.",
    )
    parser.add_argument(
        "--keep-work",
        action="store_true",
        help="Keep per-file round-trip artifacts inside the report folder.",
    )
    return parser.parse_args()


def run_command(command: list[str], cwd: Path) -> str:
    result = subprocess.run(
        command,
        cwd=cwd,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    if result.returncode != 0:
        message = result.stderr.strip() or result.stdout.strip() or f"{command[0]} failed"
        raise RuntimeError(message)
    return result.stdout


def command_exists(command: str) -> bool:
    return shutil.which(command) is not None


def transcode_png_to_facebook_jpeg(png_path: Path, jpeg_path: Path, magick_bin: str, cjpeg_bin: str) -> None:
    with jpeg_path.open("wb") as output_file:
        magick = subprocess.Popen(
            [magick_bin, str(png_path), "ppm:-"],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=False,
        )
        cjpeg = subprocess.Popen(
            [
                cjpeg_bin,
                "-quality",
                "92",
                "-sample",
                "2x2,1x1,1x1",
                "-dct",
                "int",
                "-optimize",
            ],
            stdin=magick.stdout,
            stdout=output_file,
            stderr=subprocess.PIPE,
            text=False,
        )
        assert magick.stdout is not None
        magick.stdout.close()
        _, magick_stderr = magick.communicate()
        _, cjpeg_stderr = cjpeg.communicate()

    if magick.returncode != 0:
        raise RuntimeError((magick_stderr or b"magick failed").decode("utf-8", errors="replace").strip())
    if cjpeg.returncode != 0:
        raise RuntimeError((cjpeg_stderr or b"cjpeg failed").decode("utf-8", errors="replace").strip())


def collect_inputs(input_dir: Path, pattern: str, limit: int | None) -> list[Path]:
    files = sorted(path for path in input_dir.glob(pattern) if path.is_file())
    if limit is not None:
        files = files[:limit]
    return files


def read_wav_metadata(path: Path) -> dict[str, Any]:
    with wave.open(str(path), "rb") as wav_file:
        channels = wav_file.getnchannels()
        sample_width = wav_file.getsampwidth()
        sample_rate = wav_file.getframerate()
        frame_count = wav_file.getnframes()
        comp_type = wav_file.getcomptype()
    return {
        "channels": channels,
        "sample_width_bytes": sample_width,
        "bits_per_sample": sample_width * 8,
        "sample_rate_hz": sample_rate,
        "frame_count": frame_count,
        "duration_seconds": frame_count / sample_rate if sample_rate else 0.0,
        "compression_type": comp_type,
    }


def compute_pcm_stats(reference_path: Path, decoded_path: Path) -> tuple[dict[str, Any], list[str]]:
    notes: list[str] = []
    ref_meta = read_wav_metadata(reference_path)
    dec_meta = read_wav_metadata(decoded_path)

    comparable = (
        ref_meta["compression_type"] == "NONE"
        and dec_meta["compression_type"] == "NONE"
        and ref_meta["channels"] == dec_meta["channels"]
        and ref_meta["sample_rate_hz"] == dec_meta["sample_rate_hz"]
        and ref_meta["frame_count"] == dec_meta["frame_count"]
        and ref_meta["sample_width_bytes"] == 2
        and dec_meta["sample_width_bytes"] == 2
    )
    if not comparable:
        notes.append("PCM delta stats skipped because WAV parameters do not match as 16-bit PCM.")
        return {}, notes

    with wave.open(str(reference_path), "rb") as ref_file:
        ref_bytes = ref_file.readframes(ref_file.getnframes())
    with wave.open(str(decoded_path), "rb") as dec_file:
        dec_bytes = dec_file.readframes(dec_file.getnframes())

    ref_samples = array("h")
    ref_samples.frombytes(ref_bytes)
    dec_samples = array("h")
    dec_samples.frombytes(dec_bytes)

    if sys.byteorder != "little":
        ref_samples.byteswap()
        dec_samples.byteswap()

    signal_energy = 0.0
    noise_energy = 0.0
    abs_error_sum = 0.0
    max_abs_error = 0
    sample_count = len(ref_samples)

    for ref_sample, dec_sample in zip(ref_samples, dec_samples):
        diff = int(ref_sample) - int(dec_sample)
        signal_energy += float(ref_sample) * float(ref_sample)
        noise_energy += float(diff) * float(diff)
        abs_error = abs(diff)
        abs_error_sum += abs_error
        if abs_error > max_abs_error:
            max_abs_error = abs_error

    rmse = math.sqrt(noise_energy / sample_count) if sample_count else 0.0
    mae = abs_error_sum / sample_count if sample_count else 0.0
    if noise_energy == 0.0:
        snr_db = math.inf
    elif signal_energy == 0.0:
        snr_db = float("-inf")
    else:
        snr_db = 10.0 * math.log10(signal_energy / noise_energy)

    return {
        "sample_count": sample_count,
        "rmse_pcm16": rmse,
        "mae_pcm16": mae,
        "max_abs_error_pcm16": max_abs_error,
        "snr_db_pcm16": snr_db,
    }, notes


def parse_peaq_output(output: str) -> dict[str, float]:
    odg = None
    di = None
    for line in output.splitlines():
        stripped = line.strip()
        if stripped.startswith("Objective Difference Grade:"):
            odg = float(stripped.split(":", 1)[1].strip())
        elif stripped.startswith("Distortion Index:"):
            di = float(stripped.split(":", 1)[1].strip())
    if odg is None or di is None:
        raise RuntimeError("Could not parse ODG/DI from peaq output.")
    return {"odg": odg, "di": di}


def safe_name(path: Path) -> str:
    stem = path.stem
    cleaned = "".join(ch if ch.isalnum() else "_" for ch in stem).strip("_")
    cleaned = cleaned[:80] or "file"
    return cleaned


def human_size(num_bytes: float) -> str:
    units = ["B", "KiB", "MiB", "GiB"]
    value = float(num_bytes)
    for unit in units:
        if value < 1024.0 or unit == units[-1]:
            return f"{value:.2f} {unit}"
        value /= 1024.0
    return f"{value:.2f} GiB"


def format_float(value: float | None, digits: int = 3) -> str:
    if value is None:
        return ""
    if math.isinf(value):
        return "inf" if value > 0 else "-inf"
    return f"{value:.{digits}f}"


def build_summary(rows: list[dict[str, Any]]) -> dict[str, Any]:
    successful = [row for row in rows if row["status"] == "ok"]
    odgs = [row["peaq"]["odg"] for row in successful]
    dis = [row["peaq"]["di"] for row in successful]
    bitrates_kbps = [row["effective_bitrate_kbps"] for row in successful if row.get("effective_bitrate_kbps") is not None]
    snrs = [
        row["pcm_stats"]["snr_db_pcm16"]
        for row in successful
        if "snr_db_pcm16" in row["pcm_stats"] and math.isfinite(row["pcm_stats"]["snr_db_pcm16"])
    ]
    total_source_bytes = sum(row["source_size_bytes"] for row in successful)
    total_encoded_bytes = sum(row["transport_total_bytes"] for row in successful)
    total_duration_seconds = sum(row["source_wav"]["duration_seconds"] for row in successful)

    return {
        "file_count": len(rows),
        "success_count": len(successful),
        "failure_count": len(rows) - len(successful),
        "avg_odg": statistics.fmean(odgs) if odgs else None,
        "median_odg": statistics.median(odgs) if odgs else None,
        "min_odg": min(odgs) if odgs else None,
        "max_odg": max(odgs) if odgs else None,
        "avg_di": statistics.fmean(dis) if dis else None,
        "avg_effective_bitrate_kbps": statistics.fmean(bitrates_kbps) if bitrates_kbps else None,
        "avg_pcm_snr_db": statistics.fmean(snrs) if snrs else None,
        "total_duration_seconds": total_duration_seconds,
        "total_source_bytes": total_source_bytes,
        "total_encoded_bytes": total_encoded_bytes,
        "encoded_to_source_ratio": (total_encoded_bytes / total_source_bytes) if total_source_bytes else None,
        "overall_effective_bitrate_kbps": ((total_encoded_bytes * 8.0) / total_duration_seconds / 1000.0) if total_duration_seconds else None,
    }


def render_html(rows: list[dict[str, Any]], summary: dict[str, Any], meta: dict[str, Any]) -> str:
    generated = html.escape(meta["generated_at"])
    mode = html.escape(meta["mode"])
    input_dir = html.escape(meta["input_dir"])
    report_dir = html.escape(meta["report_dir"])
    transport_recipe = html.escape(meta["transport_recipe"])

    summary_cards = [
        ("Files", str(summary["file_count"])),
        ("Succeeded", str(summary["success_count"])),
        ("Failed", str(summary["failure_count"])),
        ("Avg ODG", format_float(summary["avg_odg"])),
        ("Median ODG", format_float(summary["median_odg"])),
        ("Avg DI", format_float(summary["avg_di"])),
        ("Avg kbps", format_float(summary["avg_effective_bitrate_kbps"])),
        ("Overall kbps", format_float(summary["overall_effective_bitrate_kbps"])),
        ("Avg PCM SNR", format_float(summary["avg_pcm_snr_db"])),
        ("JPEG / Source", format_float(summary["encoded_to_source_ratio"])),
    ]

    table_rows: list[str] = []
    for row in rows:
        status = html.escape(row["status"])
        notes = "<br>".join(html.escape(note) for note in row["notes"]) if row["notes"] else ""
        peaq = row.get("peaq", {})
        pcm_stats = row.get("pcm_stats", {})
        metadata = row.get("source_wav", {})
        table_rows.append(
            "<tr>"
            f"<td>{html.escape(row['name'])}</td>"
            f"<td>{status}</td>"
            f"<td>{metadata.get('channels', '')}</td>"
            f"<td>{metadata.get('sample_rate_hz', '')}</td>"
            f"<td>{metadata.get('bits_per_sample', '')}</td>"
            f"<td>{format_float(metadata.get('duration_seconds'), 2)}</td>"
            f"<td>{human_size(row['source_size_bytes'])}</td>"
          f"<td>{row.get('transport_count', '')}</td>"
            f"<td>{human_size(row.get('transport_total_bytes', 0))}</td>"
            f"<td>{format_float(row.get('effective_bitrate_kbps'))}</td>"
            f"<td>{format_float(peaq.get('odg'))}</td>"
            f"<td>{format_float(peaq.get('di'))}</td>"
            f"<td>{format_float(pcm_stats.get('snr_db_pcm16'))}</td>"
            f"<td>{format_float(pcm_stats.get('rmse_pcm16'))}</td>"
            f"<td>{pcm_stats.get('max_abs_error_pcm16', '')}</td>"
            f"<td>{notes}</td>"
            "</tr>"
        )

    summary_html = "".join(
        f"<div class='card'><div class='label'>{html.escape(label)}</div><div class='value'>{html.escape(value)}</div></div>"
        for label, value in summary_cards
    )
    table_html = "".join(table_rows)

    return f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>PXF PEAQ Report</title>
  <style>
    :root {{
      color-scheme: light;
      --bg: #f5f1e8;
      --panel: #fffdf8;
      --ink: #1f2933;
      --muted: #5f6c7b;
      --accent: #8a4f2d;
      --accent-soft: #e8d7c8;
      --line: #ddd2c5;
      --ok: #1d6b49;
      --fail: #9d2f2f;
    }}
    body {{
      margin: 0;
      font-family: "Iosevka Etoile", "IBM Plex Sans", sans-serif;
      background: radial-gradient(circle at top, #fff7ec 0%, var(--bg) 55%, #efe6d8 100%);
      color: var(--ink);
    }}
    main {{
      max-width: 1400px;
      margin: 0 auto;
      padding: 32px 24px 48px;
    }}
    h1 {{
      margin: 0 0 8px;
      font-size: 2.2rem;
      letter-spacing: -0.04em;
    }}
    p {{
      margin: 6px 0;
      color: var(--muted);
    }}
    .meta {{
      margin-top: 20px;
      padding: 18px 20px;
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 18px;
      box-shadow: 0 12px 40px rgba(74, 45, 24, 0.08);
    }}
    .cards {{
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      gap: 12px;
      margin: 24px 0;
    }}
    .card {{
      background: linear-gradient(180deg, var(--panel), #f8f3eb);
      border: 1px solid var(--line);
      border-radius: 16px;
      padding: 16px;
    }}
    .label {{
      color: var(--muted);
      font-size: 0.88rem;
      text-transform: uppercase;
      letter-spacing: 0.08em;
    }}
    .value {{
      margin-top: 8px;
      font-size: 1.5rem;
      font-weight: 700;
    }}
    table {{
      width: 100%;
      border-collapse: collapse;
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 18px;
      overflow: hidden;
      box-shadow: 0 12px 40px rgba(74, 45, 24, 0.08);
    }}
    th, td {{
      padding: 12px 10px;
      border-bottom: 1px solid var(--line);
      vertical-align: top;
      text-align: left;
      font-size: 0.94rem;
    }}
    th {{
      background: var(--accent-soft);
      position: sticky;
      top: 0;
    }}
    tr:last-child td {{
      border-bottom: 0;
    }}
    .footer {{
      margin-top: 18px;
      font-size: 0.9rem;
      color: var(--muted);
    }}
  </style>
</head>
<body>
  <main>
    <h1>PXF ODG Report</h1>
    <p>Generated with GstPEAQ in <strong>{mode}</strong> mode.</p>
    <div class="meta">
      <p><strong>Generated:</strong> {generated}</p>
      <p><strong>Input directory:</strong> {input_dir}</p>
      <p><strong>Report directory:</strong> {report_dir}</p>
      <p><strong>Transport path:</strong> {transport_recipe}</p>
    </div>
    <section class="cards">{summary_html}</section>
    <table>
      <thead>
        <tr>
          <th>File</th>
          <th>Status</th>
          <th>Ch</th>
          <th>Hz</th>
          <th>Bits</th>
          <th>Sec</th>
          <th>Source</th>
          <th>JPEG</th>
          <th>JPEG Total</th>
          <th>Eff. kbps</th>
          <th>ODG</th>
          <th>DI</th>
          <th>PCM SNR</th>
          <th>RMSE</th>
          <th>Max Err</th>
          <th>Notes</th>
        </tr>
      </thead>
      <tbody>
        {table_html}
      </tbody>
    </table>
    <div class="footer">
      CLI round-trip path: encode WAV to PXF PNG(s), convert each PNG through the documented Facebook-like JPEG path, decode back to WAV, then compare with GstPEAQ.
    </div>
  </main>
</body>
</html>
"""


def process_file(
    source_path: Path,
    repo_root: Path,
    cli_entry: Path,
    decode_cli_entry: Path,
    args: argparse.Namespace,
    work_root: Path,
    index: int,
) -> dict[str, Any]:
    row: dict[str, Any] = {
        "name": source_path.name,
        "source_path": str(source_path),
        "source_size_bytes": source_path.stat().st_size,
        "source_wav": read_wav_metadata(source_path),
        "status": "ok",
        "notes": [],
    }
    work_dir = work_root / f"{index:03d}_{safe_name(source_path)}"
    work_dir.mkdir(parents=True, exist_ok=True)

    try:
        encoded_base = work_dir / "encoded.png"
        decoded_path = work_dir / "decoded.wav"

        run_command([args.node_bin, str(cli_entry), "encode", str(source_path), "-o", str(encoded_base)], cwd=repo_root)
        encoded_files = sorted(work_dir.glob("encoded*.png"))
        if not encoded_files:
            raise RuntimeError("Encoding produced no PNG files.")

        row["png_count"] = len(encoded_files)
        row["png_total_bytes"] = sum(path.stat().st_size for path in encoded_files)
        if args.keep_work:
            row["png_files"] = [str(path) for path in encoded_files]

        transport_files: list[Path] = []
        for encoded_file in encoded_files:
            transport_file = encoded_file.with_suffix(".jpg")
            transcode_png_to_facebook_jpeg(encoded_file, transport_file, args.magick_bin, args.cjpeg_bin)
            transport_files.append(transport_file)

        row["transport_count"] = len(transport_files)
        row["transport_total_bytes"] = sum(path.stat().st_size for path in transport_files)
        duration_seconds = row["source_wav"]["duration_seconds"]
        row["effective_bitrate_kbps"] = (
            (row["transport_total_bytes"] * 8.0) / duration_seconds / 1000.0 if duration_seconds else None
        )
        if args.keep_work:
            row["transport_files"] = [str(path) for path in transport_files]

        decode_command = [args.node_bin, str(decode_cli_entry), "decode", *[str(path) for path in transport_files], "-o", str(decoded_path)]
        run_command(decode_command, cwd=repo_root)
        if not decoded_path.exists():
            raise RuntimeError("Decoding did not produce a WAV file.")

        row["decoded_size_bytes"] = decoded_path.stat().st_size
        row["decoded_wav"] = read_wav_metadata(decoded_path)
        if args.keep_work:
            row["decoded_path"] = str(decoded_path)

        peaq_command = [args.peaq_bin]
        if args.mode == "advanced":
            peaq_command.append("--advanced")
        peaq_command.extend([str(source_path), str(decoded_path)])
        peaq_output = run_command(peaq_command, cwd=repo_root)
        row["peaq"] = parse_peaq_output(peaq_output)

        pcm_stats, notes = compute_pcm_stats(source_path, decoded_path)
        row["pcm_stats"] = pcm_stats
        row["notes"].extend(notes)
    except Exception as exc:  # noqa: BLE001
        row["status"] = "failed"
        row["error"] = str(exc)
        row["notes"].append(str(exc))
        row.setdefault("png_count", 0)
        row.setdefault("png_total_bytes", 0)
        row.setdefault("transport_count", 0)
        row.setdefault("transport_total_bytes", 0)
        row.setdefault("effective_bitrate_kbps", None)
        row.setdefault("peaq", {})
        row.setdefault("pcm_stats", {})
    finally:
        if not args.keep_work:
            shutil.rmtree(work_dir, ignore_errors=True)

    return row


def main() -> int:
    args = parse_args()
    repo_root = Path(__file__).resolve().parent.parent
    cli_entry = (repo_root / args.cli_entry).resolve()
    decode_cli_entry = (repo_root / args.decode_cli_entry).resolve() if args.decode_cli_entry else cli_entry
    input_dir = args.input_dir.resolve()

    if not command_exists(args.node_bin):
        print(f"Missing Node.js executable: {args.node_bin}", file=sys.stderr)
        return 1
    if not command_exists(args.peaq_bin):
        print(f"Missing GstPEAQ executable: {args.peaq_bin}", file=sys.stderr)
        return 1
    if not command_exists(args.magick_bin):
        print(f"Missing ImageMagick executable: {args.magick_bin}", file=sys.stderr)
        return 1
    if not command_exists(args.cjpeg_bin):
        print(f"Missing cjpeg executable: {args.cjpeg_bin}", file=sys.stderr)
        return 1
    if not decode_cli_entry.exists():
        print(f"Decode CLI entrypoint not found: {decode_cli_entry}", file=sys.stderr)
        return 1
    if not cli_entry.exists():
        print(f"CLI entrypoint not found: {cli_entry}", file=sys.stderr)
        return 1
    if not input_dir.is_dir():
        print(f"Input directory not found: {input_dir}", file=sys.stderr)
        return 1

    inputs = collect_inputs(input_dir, args.pattern, args.limit)
    if not inputs:
        print(f"No files matched {args.pattern} in {input_dir}", file=sys.stderr)
        return 1

    timestamp = dt.datetime.now().strftime("%Y%m%d-%H%M%S")
    report_dir = (repo_root / args.report_root / timestamp).resolve()
    report_dir.mkdir(parents=True, exist_ok=True)
    work_root = report_dir / "work"
    if args.keep_work:
        work_root.mkdir(parents=True, exist_ok=True)
    else:
        work_root = Path(tempfile.mkdtemp(prefix="pxf-peaq-"))

    rows: list[dict[str, Any]] = []
    try:
        for index, source_path in enumerate(inputs, start=1):
            print(f"[{index}/{len(inputs)}] {source_path.name}", flush=True)
            rows.append(process_file(source_path, repo_root, cli_entry, decode_cli_entry, args, work_root, index))
    finally:
        if not args.keep_work:
            shutil.rmtree(work_root, ignore_errors=True)

    summary = build_summary(rows)
    meta = {
        "generated_at": dt.datetime.now().astimezone().isoformat(timespec="seconds"),
        "mode": args.mode,
        "input_dir": str(input_dir),
        "report_dir": str(report_dir),
        "cli_entry": str(cli_entry),
        "decode_cli_entry": str(decode_cli_entry),
        "keep_work": args.keep_work,
        "transport_recipe": FACEBOOK_JPEG_RECIPE,
    }
    payload = {"meta": meta, "summary": summary, "files": rows}

    json_path = report_dir / "report.json"
    html_path = report_dir / "report.html"
    json_path.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
    html_path.write_text(render_html(rows, summary, meta), encoding="utf-8")

    print(f"\nWrote {html_path}")
    print(f"Wrote {json_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
