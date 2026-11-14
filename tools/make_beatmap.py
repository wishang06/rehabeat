#!/usr/bin/env python3
"""Build the beatmap (and optionally the drum / melody stems) for Rehabeat.

    python tools/make_beatmap.py path/to/song.mp3
    python tools/make_beatmap.py path/to/song.mp3 --stems

Writes {"bpm": number, "offset": number, "beats": number[]} where every time is
in seconds from the start of the track. See tools/README.md for the details.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import math
import shutil
import subprocess
import sys
import tempfile
from collections.abc import Iterable, Sequence
from pathlib import Path
from typing import Any, TypedDict

# Default outputs go to the repo's public/ folder, whatever the current directory is.
REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_OUT = REPO_ROOT / "public" / "beatmap.json"
DEFAULT_STEMS_DIR = REPO_ROOT / "public" / "stems"

DEMUCS_MODEL = "htdemucs"
# Demucs file name -> file name the app loads. "melody" is everything but the drums.
STEM_FILES = {"drums.mp3": "drums.mp3", "no_drums.mp3": "melody.mp3"}

LIBROSA_INSTALL_HINT = "python -m pip install -r tools/requirements.txt"
DEMUCS_INSTALL_HINT = (
    "Install (or reinstall) Demucs with:\n"
    "    python -m pip install -r tools/requirements-stems.txt\n"
    "It is a large download because it includes PyTorch. Keep ffmpeg on PATH too:\n"
    "Demucs uses it for input formats it cannot decode on its own."
)


class Beatmap(TypedDict):
    """Mirror of the Beatmap interface in src/types.ts."""

    bpm: float
    offset: float
    beats: list[float]


class ToolError(Exception):
    """A problem the user can act on. Reported without a traceback."""


# --- pure helpers (no audio libraries needed) --------------------------------


def tempo_to_float(tempo: Any) -> float:
    """Return a tempo estimate as a plain float.

    Recent librosa versions return the tempo as a numpy array with one value per
    channel, older ones return a scalar. Arrays are reduced to their first value.
    """
    if hasattr(tempo, "tolist"):  # numpy array or numpy scalar
        tempo = tempo.tolist()
    while isinstance(tempo, (list, tuple)):
        if not tempo:
            return 0.0
        tempo = tempo[0]
    return float(tempo)


def build_beatmap(tempo: float, beat_times: Iterable[float]) -> Beatmap:
    """Turn a tempo in BPM and beat times in seconds into the beatmap.json dict."""
    times = (float(t) for t in beat_times)
    beats = sorted({round(t, 3) for t in times if math.isfinite(t) and t >= 0})
    bpm = round(float(tempo), 2) if math.isfinite(tempo) and tempo > 0 else 0.0
    return {"bpm": bpm, "offset": beats[0] if beats else 0.0, "beats": beats}


def summarize(beatmap: Beatmap, out_path: Path) -> str:
    """One-line description of a beatmap for the console."""
    beats = beatmap["beats"]
    if beats:
        span = f"first {beats[0]:.3f} s, last {beats[-1]:.3f} s"
    else:
        span = "none detected"
    bpm = beatmap["bpm"]
    return f"beatmap: {bpm:.2f} bpm, {len(beats)} beats, {span} -> {out_path}"


def demucs_track_name(audio_path: Path) -> str:
    """Folder name Demucs gives a track: the file name without its last extension."""
    return audio_path.name.rsplit(".", 1)[0]


def demucs_command(audio_path: Path, work_dir: Path) -> list[str]:
    """Demucs call that splits a track into drums.mp3 and no_drums.mp3 under work_dir."""
    options = ["-n", DEMUCS_MODEL, "--two-stems", "drums", "--mp3", "-o", str(work_dir)]
    return [sys.executable, "-m", "demucs", *options, str(audio_path)]


# --- audio analysis and file output ------------------------------------------


def detect_beats(audio_path: Path) -> tuple[float, list[float]]:
    """Return (tempo in BPM, beat times in seconds) for an audio file."""
    try:
        import librosa  # imported here so the helpers above work without it
    except ImportError as error:
        raise ToolError(
            f"librosa could not be imported by {sys.executable} ({error}).\n"
            f"Install the requirements with:\n    {LIBROSA_INSTALL_HINT}"
        ) from error

    try:
        samples, sample_rate = librosa.load(audio_path)  # mono, resampled to 22050 Hz
    except Exception as error:  # decoders raise many unrelated exception types
        raise ToolError(
            f"could not decode {audio_path} ({type(error).__name__}: {error}).\n"
            "Check that it is an audio file. Formats libsndfile cannot read (m4a, aac, "
            "...) have to be converted first, e.g. ffmpeg -i song.m4a song.wav"
        ) from error

    tempo, beat_frames = librosa.beat.beat_track(y=samples, sr=sample_rate)
    beat_times = librosa.frames_to_time(beat_frames, sr=sample_rate)
    return tempo_to_float(tempo), [float(t) for t in beat_times]


def write_beatmap(beatmap: Beatmap, out_path: Path) -> None:
    """Write the beatmap as JSON, creating parent folders as needed."""
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with open(out_path, "w", encoding="utf-8", newline="\n") as handle:
        handle.write(json.dumps(beatmap, indent=2, allow_nan=False) + "\n")


def separate_stems(audio_path: Path, stems_dir: Path) -> list[Path]:
    """Split the track with Demucs and copy drums.mp3 / melody.mp3 into stems_dir."""
    if importlib.util.find_spec("demucs") is None:
        raise ToolError(
            f"--stems needs Demucs, which is not installed for {sys.executable}.\n"
            f"{DEMUCS_INSTALL_HINT}"
        )

    with tempfile.TemporaryDirectory(prefix="rehabeat-demucs-") as work:
        work_dir = Path(work)
        print("running Demucs, this can take a few minutes on a CPU...", flush=True)
        result = subprocess.run(demucs_command(audio_path, work_dir), check=False)
        if result.returncode != 0:
            raise ToolError(
                f"Demucs failed with exit code {result.returncode}, see its output "
                f"above.\n{DEMUCS_INSTALL_HINT}"
            )

        track_dir = work_dir / DEMUCS_MODEL / demucs_track_name(audio_path)
        missing = [name for name in STEM_FILES if not (track_dir / name).is_file()]
        if missing:
            produced = sorted(
                str(path.relative_to(work_dir))
                for path in work_dir.rglob("*")
                if path.is_file()
            )
            raise ToolError(
                f"Demucs finished but did not produce {', '.join(missing)} in "
                f"{Path(DEMUCS_MODEL) / track_dir.name}.\n"
                f"It produced: {', '.join(produced) if produced else 'nothing'}.\n"
                f"{DEMUCS_INSTALL_HINT}"
            )

        stems_dir.mkdir(parents=True, exist_ok=True)
        written = []
        for demucs_name, app_name in STEM_FILES.items():
            target = stems_dir / app_name
            shutil.copyfile(track_dir / demucs_name, target)
            written.append(target)
        return written


# --- command line -------------------------------------------------------------


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Detect the beats of a song and write the Rehabeat beatmap JSON.",
    )
    parser.add_argument("audio", type=Path, help="input song (mp3, wav, flac, ogg)")
    parser.add_argument(
        "--out",
        type=Path,
        default=DEFAULT_OUT,
        help="beatmap JSON to write (default: %(default)s)",
    )
    parser.add_argument(
        "--stems",
        action="store_true",
        help="also split the song into drums.mp3 and melody.mp3 with Demucs",
    )
    parser.add_argument(
        "--stems-dir",
        type=Path,
        default=DEFAULT_STEMS_DIR,
        help="folder for the stems (default: %(default)s)",
    )
    return parser.parse_args(argv)


def report_error(message: str) -> int:
    """Print an error to stderr and return the exit code for it."""
    print(f"error: {message}", file=sys.stderr)
    return 1


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    audio_path = args.audio.resolve()
    out_path = args.out.resolve()

    if not audio_path.is_file():
        return report_error(f"input file not found: {audio_path}")

    try:
        tempo, beat_times = detect_beats(audio_path)
    except ToolError as error:
        return report_error(str(error))

    beatmap = build_beatmap(tempo, beat_times)
    write_beatmap(beatmap, out_path)
    print(summarize(beatmap, out_path), flush=True)
    if not beatmap["beats"]:
        warning = 'warning: no beats were detected, so "beats" is empty. '
        if beatmap["bpm"] > 0:
            warning += 'The app then lays out an even grid from "bpm" and "offset".'
        else:
            warning += "No tempo was found either (bpm is 0): check the input file."
        print(warning, file=sys.stderr)

    if args.stems:
        try:
            stem_paths = separate_stems(audio_path, args.stems_dir.resolve())
        except ToolError as error:
            return report_error(
                f"{error}\nThe beatmap was still written to {out_path}; "
                "only the stems are missing."
            )
        for stem_path in stem_paths:
            print(f"stem: {stem_path}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
