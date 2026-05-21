#!/usr/bin/env python3
"""Compare two ODG report JSON files and summarize quality changes."""

from __future__ import annotations

import argparse
import json
import math
from dataclasses import dataclass
from pathlib import Path
from typing import Any


EPSILON = 1e-9


@dataclass
class TrackDelta:
    name: str
    before_odg: float | None
    after_odg: float | None
    odg_delta: float | None
    before_di: float | None
    after_di: float | None
    di_delta: float | None
    before_kbps: float | None
    after_kbps: float | None
    kbps_delta: float | None
    before_snr: float | None
    after_snr: float | None
    snr_delta: float | None


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Compare two PEAQ/ODG report JSON files.",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    parser.add_argument("before", type=Path, help="Earlier report JSON path.")
    parser.add_argument("after", type=Path, help="Later report JSON path.")
    parser.add_argument("--top", type=int, default=5, help="How many top improvements/regressions to print.")
    return parser.parse_args()


def load_report(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def get_nested(mapping: dict[str, Any], *keys: str) -> float | None:
    current: Any = mapping
    for key in keys:
        if not isinstance(current, dict) or key not in current:
            return None
        current = current[key]
    if current is None:
        return None
    return float(current)


def safe_delta(after: float | None, before: float | None) -> float | None:
    if after is None or before is None:
        return None
    return after - before


def fmt(value: float | None, digits: int = 3, sign: bool = False) -> str:
    if value is None:
        return "n/a"
    if math.isinf(value):
        return "+inf" if value > 0 else "-inf"
    spec = f"{'+' if sign else ''}.{digits}f"
    return format(value, spec)


def fmt_pct(value: float | None, digits: int = 2, sign: bool = False) -> str:
    if value is None:
        return "n/a"
    return f"{fmt(value * 100.0, digits=digits, sign=sign)}%"


def index_tracks(report: dict[str, Any]) -> dict[str, dict[str, Any]]:
    indexed: dict[str, dict[str, Any]] = {}
    for track in report.get("files", []):
        name = track.get("name")
        status = track.get("status")
        if isinstance(name, str) and status == "ok":
            indexed[name] = track
    return indexed


def build_deltas(before_report: dict[str, Any], after_report: dict[str, Any]) -> list[TrackDelta]:
    before_tracks = index_tracks(before_report)
    after_tracks = index_tracks(after_report)
    shared_names = sorted(set(before_tracks) & set(after_tracks))
    deltas: list[TrackDelta] = []

    for name in shared_names:
        before = before_tracks[name]
        after = after_tracks[name]
        deltas.append(
            TrackDelta(
                name=name,
                before_odg=get_nested(before, "peaq", "odg"),
                after_odg=get_nested(after, "peaq", "odg"),
                odg_delta=safe_delta(get_nested(after, "peaq", "odg"), get_nested(before, "peaq", "odg")),
                before_di=get_nested(before, "peaq", "di"),
                after_di=get_nested(after, "peaq", "di"),
                di_delta=safe_delta(get_nested(after, "peaq", "di"), get_nested(before, "peaq", "di")),
                before_kbps=get_nested(before, "effective_bitrate_kbps"),
                after_kbps=get_nested(after, "effective_bitrate_kbps"),
                kbps_delta=safe_delta(get_nested(after, "effective_bitrate_kbps"), get_nested(before, "effective_bitrate_kbps")),
                before_snr=get_nested(before, "pcm_stats", "snr_db_pcm16"),
                after_snr=get_nested(after, "pcm_stats", "snr_db_pcm16"),
                snr_delta=safe_delta(get_nested(after, "pcm_stats", "snr_db_pcm16"), get_nested(before, "pcm_stats", "snr_db_pcm16")),
            )
        )
    return deltas


def print_summary(before_report: dict[str, Any], after_report: dict[str, Any], deltas: list[TrackDelta], top_n: int) -> None:
    before_summary = before_report.get("summary", {})
    after_summary = after_report.get("summary", {})

    print("ODG report comparison")
    print(f"before: {before_report.get('meta', {}).get('report_dir', 'n/a')}")
    print(f"after:  {after_report.get('meta', {}).get('report_dir', 'n/a')}")
    print()

    print("Aggregate")
    print(f"- matched tracks: {len(deltas)}")
    print(f"- avg ODG: {fmt(get_nested(before_summary, 'avg_odg'))} -> {fmt(get_nested(after_summary, 'avg_odg'))} ({fmt(safe_delta(get_nested(after_summary, 'avg_odg'), get_nested(before_summary, 'avg_odg')), sign=True)})")
    print(f"- median ODG: {fmt(get_nested(before_summary, 'median_odg'))} -> {fmt(get_nested(after_summary, 'median_odg'))} ({fmt(safe_delta(get_nested(after_summary, 'median_odg'), get_nested(before_summary, 'median_odg')), sign=True)})")
    print(f"- avg DI: {fmt(get_nested(before_summary, 'avg_di'))} -> {fmt(get_nested(after_summary, 'avg_di'))} ({fmt(safe_delta(get_nested(after_summary, 'avg_di'), get_nested(before_summary, 'avg_di')), sign=True)})")
    print(f"- avg effective bitrate: {fmt(get_nested(before_summary, 'avg_effective_bitrate_kbps'))} kbps -> {fmt(get_nested(after_summary, 'avg_effective_bitrate_kbps'))} kbps ({fmt(safe_delta(get_nested(after_summary, 'avg_effective_bitrate_kbps'), get_nested(before_summary, 'avg_effective_bitrate_kbps')), sign=True)} kbps)")
    print(f"- overall effective bitrate: {fmt(get_nested(before_summary, 'overall_effective_bitrate_kbps'))} kbps -> {fmt(get_nested(after_summary, 'overall_effective_bitrate_kbps'))} kbps ({fmt(safe_delta(get_nested(after_summary, 'overall_effective_bitrate_kbps'), get_nested(before_summary, 'overall_effective_bitrate_kbps')), sign=True)} kbps)")
    print(f"- avg PCM SNR: {fmt(get_nested(before_summary, 'avg_pcm_snr_db'))} dB -> {fmt(get_nested(after_summary, 'avg_pcm_snr_db'))} dB ({fmt(safe_delta(get_nested(after_summary, 'avg_pcm_snr_db'), get_nested(before_summary, 'avg_pcm_snr_db')), sign=True)} dB)")
    print(f"- JPEG/source ratio: {fmt_pct(get_nested(before_summary, 'encoded_to_source_ratio'))} -> {fmt_pct(get_nested(after_summary, 'encoded_to_source_ratio'))} ({fmt_pct(safe_delta(get_nested(after_summary, 'encoded_to_source_ratio'), get_nested(before_summary, 'encoded_to_source_ratio')), sign=True)})")
    print()

    improved = [item for item in deltas if item.odg_delta is not None and item.odg_delta > EPSILON]
    regressed = [item for item in deltas if item.odg_delta is not None and item.odg_delta < -EPSILON]
    unchanged = [item for item in deltas if item.odg_delta is not None and abs(item.odg_delta) <= EPSILON]

    print("Track counts")
    print(f"- improved ODG: {len(improved)}")
    print(f"- regressed ODG: {len(regressed)}")
    print(f"- unchanged ODG: {len(unchanged)}")
    print()

    improved_sorted = sorted(improved, key=lambda item: item.odg_delta or 0.0, reverse=True)
    regressed_sorted = sorted(regressed, key=lambda item: item.odg_delta or 0.0)

    print(f"Top {min(top_n, len(improved_sorted))} improvements")
    for item in improved_sorted[:top_n]:
        print(
            f"- {item.name}: ODG {fmt(item.before_odg)} -> {fmt(item.after_odg)} ({fmt(item.odg_delta, sign=True)}), "
            f"bitrate {fmt(item.before_kbps)} -> {fmt(item.after_kbps)} kbps ({fmt(item.kbps_delta, sign=True)}), "
            f"SNR {fmt(item.before_snr)} -> {fmt(item.after_snr)} dB ({fmt(item.snr_delta, sign=True)})"
        )
    if not improved_sorted:
        print("- none")
    print()

    print(f"Top {min(top_n, len(regressed_sorted))} regressions")
    for item in regressed_sorted[:top_n]:
        print(
            f"- {item.name}: ODG {fmt(item.before_odg)} -> {fmt(item.after_odg)} ({fmt(item.odg_delta, sign=True)}), "
            f"bitrate {fmt(item.before_kbps)} -> {fmt(item.after_kbps)} kbps ({fmt(item.kbps_delta, sign=True)}), "
            f"SNR {fmt(item.before_snr)} -> {fmt(item.after_snr)} dB ({fmt(item.snr_delta, sign=True)})"
        )
    if not regressed_sorted:
        print("- none")
    print()

    after_tracks = list(index_tracks(after_report).values())
    best_after = max(after_tracks, key=lambda track: get_nested(track, "peaq", "odg") or float("-inf"))
    worst_after = min(after_tracks, key=lambda track: get_nested(track, "peaq", "odg") or float("inf"))
    lowest_bitrate_after = min(after_tracks, key=lambda track: get_nested(track, "effective_bitrate_kbps") or float("inf"))
    highest_bitrate_after = max(after_tracks, key=lambda track: get_nested(track, "effective_bitrate_kbps") or float("-inf"))

    print("After report highlights")
    print(f"- best ODG track: {best_after['name']} ({fmt(get_nested(best_after, 'peaq', 'odg'))}, {fmt(get_nested(best_after, 'effective_bitrate_kbps'))} kbps)")
    print(f"- worst ODG track: {worst_after['name']} ({fmt(get_nested(worst_after, 'peaq', 'odg'))}, {fmt(get_nested(worst_after, 'effective_bitrate_kbps'))} kbps)")
    print(f"- lowest bitrate track: {lowest_bitrate_after['name']} ({fmt(get_nested(lowest_bitrate_after, 'effective_bitrate_kbps'))} kbps, ODG {fmt(get_nested(lowest_bitrate_after, 'peaq', 'odg'))})")
    print(f"- highest bitrate track: {highest_bitrate_after['name']} ({fmt(get_nested(highest_bitrate_after, 'effective_bitrate_kbps'))} kbps, ODG {fmt(get_nested(highest_bitrate_after, 'peaq', 'odg'))})")


def main() -> int:
    args = parse_args()
    before_report = load_report(args.before)
    after_report = load_report(args.after)
    deltas = build_deltas(before_report, after_report)
    if not deltas:
        raise SystemExit("No shared successful tracks were found between the two reports.")
    print_summary(before_report, after_report, deltas, args.top)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
