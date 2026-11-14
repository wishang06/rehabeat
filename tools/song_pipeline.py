"""Machine interface to make_beatmap.py, for the `npm run songs` CLI (tools/songs/).

    python tools/song_pipeline.py preflight
    python tools/song_pipeline.py analyze AUDIO --out-dir DIR [--bpm-hint N] [--click PATH]
    python tools/song_pipeline.py stems AUDIO --out-dir DIR [--separated-dir DIR]

preflight  versions of Python and the packages the pipeline needs (null when one cannot be
           imported) and whether ffmpeg, ffprobe and ffplay are on PATH
analyze    writes DIR/beatmap.json (make_beatmap's five keys) and, with --click, the song
           with a click on every beat, to check the grid by ear
stems      runs Demucs and writes DIR/drums.mp3 and DIR/melody.mp3, levelled together so
           that drums + melody peak at TARGET_SUM_PEAK_DBFS

Output protocol: progress and anything meant for people goes to stderr (Demucs's own
progress bar included). The result is ONE line on stdout, RESULT_SENTINEL followed by a
JSON object, and it is the last thing printed. Demucs runs as a subprocess that shares
this process's stdout, so a caller should look for the sentinel line rather than read all
of stdout as JSON. On failure the exit code is 1, stderr ends with a one-line
"error: ..." message, and the result line is {"ok": false, "error": "..."}.
"""

from __future__ import annotations

import argparse
import contextlib
import importlib.metadata
import importlib.util
import json
import math
import platform
import shutil
import sys
import time
import traceback
from pathlib import Path

TOOLS_DIR = Path(__file__).resolve().parent
RESULT_SENTINEL = "REHABEAT_RESULT"

PACKAGES = ("librosa", "soundfile", "demucs", "torch", "torchaudio")
COMMANDS = ("ffmpeg", "ffprobe", "ffplay")

# The game plays every song's stems through one fixed gain (STEM_GAIN = 2.5 in
# src/audio/beatEngine.ts), tuned on Past Sadness, whose drums + melody peak at about
# -12 dBFS. Each new song's stems are scaled to the same sum peak so none clips in the game.
TARGET_SUM_PEAK_DBFS = -12.0
# MP3 encoding moves sharp peaks a little (0.4 dB seen on synthetic clicks). If the
# encoded stems miss the target by more than this, they are encoded once more.
MP3_PEAK_TOLERANCE_DB = 0.25


class PipelineError(Exception):
    """Raised for bad input before make_beatmap (and librosa) is imported."""


def say(message: str) -> None:
    """A line for people: always stderr, never in the way of the result line."""
    print(message.encode("ascii", "backslashreplace").decode("ascii"), file=sys.stderr, flush=True)


def emit(result: dict) -> None:
    sys.stderr.flush()
    print(f"{RESULT_SENTINEL} {json.dumps(result, ensure_ascii=True)}", flush=True)


def load_make_beatmap():
    """make_beatmap imports librosa, which takes seconds; preflight must work without it."""
    import make_beatmap

    return make_beatmap


def error_types() -> tuple[type[BaseException], ...]:
    """The exceptions that are a message for the user rather than a bug."""
    module = sys.modules.get("make_beatmap")
    return (PipelineError, module.BeatmapError) if module else (PipelineError,)


# --------------------------------------------------------------------------- preflight


def package_version(name: str) -> str | None:
    """Installed version of a package, or None if it cannot be imported."""
    try:
        if importlib.util.find_spec(name) is None:
            return None
    except (ImportError, ValueError):
        return None
    try:
        return importlib.metadata.version(name)
    except importlib.metadata.PackageNotFoundError:
        return "unknown"


def preflight() -> dict:
    return {
        "ok": True,
        "command": "preflight",
        "python": platform.python_version(),
        "executable": sys.executable,
        "packages": {name: package_version(name) for name in PACKAGES},
        "commands": {name: shutil.which(name) is not None for name in COMMANDS},
    }


# --------------------------------------------------------------------------- analyze


def require_file(path: Path) -> Path:
    if not path.is_file():
        raise PipelineError(f"input file not found: {path}")
    return path


def analyze(audio: Path, out_dir: Path, bpm_hint: float | None, click: Path | None) -> dict:
    require_file(audio)
    mb = load_make_beatmap()
    samples, sr = mb.load_audio(audio)
    duration = len(samples) / sr
    analysis = mb.analyze(samples, sr, bpm_hint)
    beatmap = mb.build_beatmap(analysis, audio.name)
    beatmap_path = mb.write_beatmap(beatmap, out_dir / "beatmap.json")
    with contextlib.redirect_stdout(sys.stderr):  # make_beatmap's summary prints to stdout
        mb.print_summary(audio, duration, analysis, beatmap)

    click_path = None
    if click is not None:
        click_path = mb.write_click_track(samples, sr, beatmap["beats"], beatmap["downbeats"], click)
        say(f"Click check:     {click_path}")

    beats = beatmap["beats"]
    interval = mb.beat_interval_ms(analysis.beat_times)
    return {
        "ok": True,
        "command": "analyze",
        "source": audio.name,
        "bpm": beatmap["bpm"],
        "bpmHint": bpm_hint,
        "detectedTempo": round(analysis.detected_tempo, 2),
        "tempo": round(analysis.tempo, 2),
        "beatCount": len(beats),
        "downbeatCount": len(beatmap["downbeats"]),
        "firstBeat": beats[0] if beats else None,
        "lastBeat": beats[-1] if beats else None,
        "meanGapMs": round(interval[0], 3) if interval else None,
        "jitterMs": round(interval[1], 3) if interval else None,
        "durationSec": round(duration, 3),
        "beatmapPath": str(beatmap_path),
        "clickPath": str(click_path) if click_path else None,
    }


# --------------------------------------------------------------------------- stems


def to_dbfs(amplitude: float) -> float:
    return 20.0 * math.log10(amplitude) if amplitude > 0 else -math.inf


def sum_peak(drums, melody) -> float:
    """Largest absolute value of drums + melody, sample by sample, over every channel.

    This is what the game plays when both stems are up: their sum, not the louder of the
    two. Arrays are (frames,) or (frames, channels); a length mismatch is cut to the shorter.
    """
    import numpy as np

    drums, melody = np.asarray(drums), np.asarray(melody)
    n = min(len(drums), len(melody))
    if n == 0:
        return 0.0
    return float(np.max(np.abs(drums[:n] + melody[:n])))


def levelling_gain_db(peak: float, target_dbfs: float = TARGET_SUM_PEAK_DBFS) -> float:
    """The gain, in dB, that moves a sum peak of `peak` (linear, 1.0 = full scale) to target."""
    if not (math.isfinite(peak) and peak > 0):
        raise PipelineError("the stems are silent, so there is nothing to level")
    return target_dbfs - to_dbfs(peak)


def corrected_gain_db(
    gain_db: float,
    measured_dbfs: float,
    target_dbfs: float = TARGET_SUM_PEAK_DBFS,
    tolerance_db: float = MP3_PEAK_TOLERANCE_DB,
) -> float | None:
    """The gain to encode with again if the encoded sum peak missed the target, else None."""
    error = measured_dbfs - target_dbfs
    if not math.isfinite(error) or abs(error) <= tolerance_db:
        return None
    return gain_db - error


def apply_gain_db(samples, gain_db: float):
    """What the encoder's volume filter does to the samples: scale by 10^(gain/20)."""
    import numpy as np

    return np.asarray(samples) * (10.0 ** (gain_db / 20.0))


def read_audio(path: Path):
    import soundfile as sf

    samples, _ = sf.read(str(path), dtype="float32", always_2d=True)
    return samples


def stems(audio: Path, out_dir: Path, separated_dir: Path | None) -> dict:
    require_file(audio)
    mb = load_make_beatmap()
    separated_dir = Path(separated_dir or mb.SEPARATED_DIR)
    out_dir = Path(out_dir)

    say("Running Demucs (slow: most of the song's own length on a laptop CPU)...")
    result = mb.separate_stems(audio, separated_dir, out_dir)
    say(f"Demucs time:     {result.seconds:.1f} s")

    # separate_stems leaves Demucs's WAVs where Demucs wrote them (see its comment on the
    # folder layout). Level from those, so the gain is measured before any MP3 encoding.
    track_dir = separated_dir / mb.DEMUCS_MODEL / audio.name.rsplit(".", 1)[0]
    drums_wav, melody_wav = track_dir / "drums.wav", track_dir / "no_drums.wav"
    before = sum_peak(read_audio(drums_wav), read_audio(melody_wav))
    gain_db = levelling_gain_db(before)

    # The same gain for both stems keeps their balance. separate_stems has already
    # encoded them unscaled; encode again with the gain (a few seconds next to Demucs).
    def encode_levelled(gain: float) -> float:
        mb.encode_mp3(drums_wav, result.drums, gain_db=gain)
        mb.encode_mp3(melody_wav, result.melody, gain_db=gain)
        return sum_peak(read_audio(result.drums), read_audio(result.melody))  # what was written

    after = encode_levelled(gain_db)
    retry = corrected_gain_db(gain_db, to_dbfs(after))
    if retry is not None:
        say(f"Encoded peak {to_dbfs(after):.2f} dBFS missed the target; encoding again at {retry:+.2f} dB")
        gain_db = retry
        after = encode_levelled(gain_db)
    say(
        f"Levelled stems:  {gain_db:+.2f} dB; drums + melody now peak at "
        f"{to_dbfs(after):.2f} dBFS (target {TARGET_SUM_PEAK_DBFS:.1f})"
    )
    return {
        "ok": True,
        "command": "stems",
        "drums": str(result.drums),
        "melody": str(result.melody),
        "demucsSeconds": round(result.seconds, 2),
        "gainDb": round(gain_db, 3),
        "sumPeakBeforeDbfs": round(to_dbfs(before), 3),
        "sumPeakDbfs": round(to_dbfs(after), 3),
        "targetDbfs": TARGET_SUM_PEAK_DBFS,
    }


# --------------------------------------------------------------------------- command line


def positive_number(text: str) -> float:
    try:
        value = float(text)
    except ValueError:
        value = float("nan")
    if not (math.isfinite(value) and value > 0):
        raise argparse.ArgumentTypeError(f"{text!r} is not a positive number")
    return value


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="song_pipeline.py",
        description="Beat analysis and stem separation for the npm run songs CLI.",
    )
    commands = parser.add_subparsers(dest="command", required=True)

    commands.add_parser("preflight", help="report Python, package and ffmpeg versions")

    analyze_parser = commands.add_parser("analyze", help="write DIR/beatmap.json")
    analyze_parser.add_argument("audio", type=Path)
    analyze_parser.add_argument("--out-dir", type=Path, required=True, metavar="DIR")
    analyze_parser.add_argument("--bpm-hint", type=positive_number, metavar="N")
    analyze_parser.add_argument("--click", type=Path, metavar="PATH", help="also write a click check WAV")

    stems_parser = commands.add_parser("stems", help="write DIR/drums.mp3 and DIR/melody.mp3")
    stems_parser.add_argument("audio", type=Path)
    stems_parser.add_argument("--out-dir", type=Path, required=True, metavar="DIR")
    stems_parser.add_argument(
        "--separated-dir",
        type=Path,
        metavar="DIR",
        help="where Demucs writes its WAVs (default: tools/out/separated)",
    )
    return parser


def run(args: argparse.Namespace) -> dict:
    if args.command == "preflight":
        return preflight()
    if args.command == "analyze":
        return analyze(args.audio, args.out_dir, args.bpm_hint, args.click)
    return stems(args.audio, args.out_dir, args.separated_dir)


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        result = run(args)
    except Exception as error:  # every failure ends with the one-line message and result line
        if not isinstance(error, error_types()):
            traceback.print_exc()  # a bug: keep the details above the one-line message
        message = " ".join(str(error).split()) or type(error).__name__
        if not isinstance(error, error_types()):
            message = f"{type(error).__name__}: {message}"
        say(f"error: {message}")
        emit({"ok": False, "command": args.command, "error": message})
        return 1
    emit(result)
    return 0


if __name__ == "__main__":
    sys.exit(main())
