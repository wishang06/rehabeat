"""Turn a song into the beat grid the game plays against.

Run from the repo root:

    tools\\.venv\\Scripts\\python.exe tools\\make_beatmap.py SONG
        [--bpm-hint N] [--click] [--stems] [--out PATH]

Writes public/beatmap.json:

    {"bpm": number, "offset": seconds, "beats": [seconds], "downbeats": [seconds], "source": "file name"}

--bpm-hint N  rough tempo; fixes a grid that came out at half or double speed
--click       also writes tools/out/check.wav: the song with a click on every beat
              (downbeats higher and louder), to check the grid by ear
--stems       also runs Demucs and writes public/stems/drums.mp3 and melody.mp3
--out PATH    write the beatmap somewhere other than public/beatmap.json
"""

from __future__ import annotations

import argparse
import json
import math
import shutil
import subprocess
import sys
import time
from dataclasses import dataclass
from pathlib import Path

import librosa
import numpy as np
import soundfile as sf
from scipy.ndimage import gaussian_filter1d

# Default outputs are anchored to the repo, not to wherever the script is run from.
TOOLS_DIR = Path(__file__).resolve().parent
REPO_ROOT = TOOLS_DIR.parent
DEFAULT_BEATMAP_PATH = REPO_ROOT / "public" / "beatmap.json"
DEFAULT_CLICK_PATH = TOOLS_DIR / "out" / "check.wav"
SEPARATED_DIR = TOOLS_DIR / "out" / "separated"  # raw Demucs output
STEMS_DIR = REPO_ROOT / "public" / "stems"

# Analysis grid: 5.8 ms per frame, 23 ms analysis window.
SAMPLE_RATE = 44100
HOP_LENGTH = 256
N_FFT = 1024
N_MELS = 64  # librosa's default of 128 bands leaves empty filters with a window this short
ONSET_LAG = 1  # the onset envelope compares each frame with the one ONSET_LAG before it

# Timing accuracy. librosa.onset.onset_strength measures how much each mel band rose
# between frame i - ONSET_LAG and frame i, then shifts the result later by half a window
# (center=True), assuming an onset registers the moment it enters the leading edge of the
# analysis window. Two consequences, both handled here:
#
# 1. Under that assumption the onset fell somewhere between the leading edges of the two
#    frames being compared. librosa stamps it with the later frame; the unbiased stamp is
#    the middle of the interval. So frames_to_seconds() subtracts ONSET_LAG / 2 frames
#    (2.9 ms here). This follows from hop and lag alone.
# 2. An onset does not really register the instant it touches the window edge, because
#    the Hann taper weights the edge at zero. The envelope therefore peaks late by some
#    part of the half window, depending on how far the onset stands out from what is
#    already sounding. That part cannot be derived from the analysis settings, but it can
#    never exceed N_FFT / 2. So the window is kept short (half window = 11.6 ms) instead
#    of subtracting a guessed constant. On synthetic click tracks the grid lands 3 ms late
#    on near-silence and 7 ms late over loud noise; with librosa's default 93 ms window
#    the same measurement gives 16 to 33 ms.

DEFAULT_START_BPM = 120.0  # librosa's default tempo prior
TEMPO_WINDOW_S = 8.0  # librosa's default autocorrelation window for tempo
TEMPO_STRIDE = 16  # estimate tempo from every 16th window (93 ms apart); see estimate_tempo
BEATS_PER_BAR = 4

BEAT_CLICK_HZ = 1000.0
DOWNBEAT_CLICK_HZ = 2000.0  # an octave above the ordinary click
BEAT_CLICK_GAIN = 0.5  # relative to the song's peak
DOWNBEAT_CLICK_GAIN = 1.0
CLICK_SECONDS = 0.05
PEAK_LIMIT = 0.95  # the check file is scaled down, if needed, to peak here

DEMUCS_MODEL = "htdemucs"
STEM_BITRATE = "192k"


class BeatmapError(Exception):
    """A problem to show the user as a one-line message."""


@dataclass
class Analysis:
    tempo: float  # BPM the beats were tracked at (after any octave fold); 0.0 if silent
    detected_tempo: float  # BPM as first estimated, before folding towards a hint
    beat_times: np.ndarray  # seconds, not rounded
    downbeat_phase: int  # which of the first four beats is the first downbeat (0..3)


@dataclass
class Stems:
    drums: Path
    melody: Path
    seconds: float  # wall-clock time of the Demucs subprocess


# --------------------------------------------------------------------------- analysis


def load_audio(path: Path) -> tuple[np.ndarray, int]:
    """Decode an audio file to mono float samples at SAMPLE_RATE."""
    try:
        samples, sr = librosa.load(str(path), sr=SAMPLE_RATE, mono=True)
    except Exception as error:  # decoders raise many unrelated types; report them all alike
        reason = " ".join(str(error).split()) or type(error).__name__
        raise BeatmapError(f"could not decode {path}: {reason}") from error
    if samples.size == 0:
        raise BeatmapError(f"{path} contains no audio")
    return samples, int(sr)


def onset_envelope(samples: np.ndarray, sr: int) -> np.ndarray:
    """Onset strength per frame.

    The median across mel bands is what librosa's own beat tracker uses. A drum hit
    raises most bands at once and survives it; hiss and sustained notes, which flicker in
    a few bands at a time, do not. (With the default mean, a noisy backing made the tempo
    estimate fall back to its 120 BPM prior in testing.)
    """
    return librosa.onset.onset_strength(
        y=samples,
        sr=sr,
        hop_length=HOP_LENGTH,
        n_fft=N_FFT,
        n_mels=N_MELS,
        lag=ONSET_LAG,
        aggregate=np.median,
    )


def estimate_tempo(envelope: np.ndarray, sr: int, start_bpm: float = DEFAULT_START_BPM) -> float:
    """Global tempo in BPM: the estimate librosa.beat.beat_track makes, at far lower cost.

    beat_track autocorrelates an 8 s window around every single frame. On this 5.8 ms grid
    that is 2.8 GB and 8 s of work for a four-minute song. Neighbouring windows overlap by
    more than 99%, so this builds the same tempogram from every TEMPO_STRIDE-th window
    (0.2 GB, under a second) and hands it to librosa.feature.tempo, the estimator beat_track
    itself calls. The result is identical on every track tried; a test holds it to that.
    """
    if not np.any(envelope):
        return 0.0  # silence: same answer as beat_track
    window = int(librosa.time_to_frames(TEMPO_WINDOW_S, sr=sr, hop_length=HOP_LENGTH))
    padded = np.pad(envelope, window // 2, mode="linear_ramp", end_values=0.0)
    windows = librosa.util.frame(padded, frame_length=window, hop_length=TEMPO_STRIDE)
    taper = librosa.filters.get_window("hann", window, fftbins=True)[:, np.newaxis]
    tempogram = librosa.util.normalize(
        librosa.autocorrelate(windows * taper, axis=0), norm=np.inf, axis=0
    )
    tempo = librosa.feature.tempo(tg=tempogram, sr=sr, hop_length=HOP_LENGTH, start_bpm=start_bpm)
    return float(np.atleast_1d(tempo)[0])  # librosa returns an array, not a float


def fold_tempo(tempo: float, hint: float) -> float:
    """Double or halve tempo until it is in the hint's octave: [hint/sqrt(2), hint*sqrt(2)).

    Only ever moves by factors of two, so the song's own tempo is kept: a hint of 70 on a
    72.4 BPM song detected at 144.8 gives 72.4, not 70.
    """
    if tempo <= 0:
        return tempo
    low, high = hint / math.sqrt(2), hint * math.sqrt(2)
    while tempo < low:
        tempo *= 2
    while tempo >= high:
        tempo /= 2
    return tempo


def frames_per_beat(tempo: float, sr: int) -> float:
    return 60.0 / tempo * sr / HOP_LENGTH


def track_beats(envelope: np.ndarray, sr: int, tempo: float) -> np.ndarray:
    """Beat positions as frame indices, tracked at the given tempo.

    Untrimmed: the tracker carries the grid on through silence before and after the
    music. drop_silent_edges() removes those beats.

    The envelope is tracked with two beats of silence put in front of it. librosa's
    tracker scores a beat against the beat before it, and a first beat that sits between
    half a beat and one beat into the file has only too-close places for that earlier
    beat. It then loses to an empty spot and the grid starts a beat late (seen with a
    first click 0.45 s into a 72 BPM track). The padding gives the first beat a
    well-placed predecessor.
    """
    if tempo <= 0:
        return np.array([], dtype=int)
    pad = int(round(2 * frames_per_beat(tempo, sr)))
    _, frames = librosa.beat.beat_track(
        onset_envelope=np.pad(envelope, (pad, 0)),
        sr=sr,
        hop_length=HOP_LENGTH,
        bpm=tempo,
        trim=False,
        units="frames",
    )
    frames = np.asarray(frames, dtype=int) - pad
    return frames[frames >= 0]


def drop_silent_edges(frames: np.ndarray, score: np.ndarray) -> np.ndarray:
    """Drop leading and trailing beats that have no onset under them.

    A beat counts as real if its score is above half the RMS score of all beats. That is
    the rule librosa's own trim=True states, but librosa smooths the scores first with a
    window that sums to 2, which doubles the bar to about the average beat. It then cuts
    real beats of ordinary strength: the first click of a plain click track, five of 34
    clicks over a backing, most of a fade-out. Beats in silence score under a fifth of
    the RMS, so half is enough to remove them.
    """
    strength = score[frames]
    real = np.flatnonzero(strength > 0.5 * np.sqrt(np.mean(strength**2)))
    if len(real) == 0:
        return frames[:0]
    return frames[real[0] : real[-1] + 1]


def beat_score(envelope: np.ndarray, sr: int, tempo: float) -> np.ndarray:
    """The onset envelope blurred over 1/32 of a beat, as the beat tracker scores it.

    librosa places beats on the peaks of this curve, so it is the right curve to read
    a beat's exact position and its strength from.
    """
    sigma = frames_per_beat(tempo, sr) / 32
    return gaussian_filter1d(envelope.astype(float), sigma=sigma, mode="constant")


def refine_beats(score: np.ndarray, frames: np.ndarray) -> np.ndarray:
    """Beat positions in fractional frames.

    The tracker can only answer in whole frames (5.8 ms). Where a beat sits on a peak of
    the score, a parabola through the peak and its two neighbours locates the top to a
    fraction of a frame. It never moves a beat by more than half a frame. Without it the
    median beat gap is a whole number of frames, which makes a 72.00 BPM song read 71.78.
    """
    positions = frames.astype(float)
    inner = (frames > 0) & (frames < len(score) - 1)
    at = frames[inner]
    left, mid, right = score[at - 1], score[at], score[at + 1]
    curvature = left - 2 * mid + right
    on_peak = (mid >= left) & (mid >= right) & (curvature < 0)
    shift = np.zeros(len(at))
    shift[on_peak] = 0.5 * (left - right)[on_peak] / curvature[on_peak]
    positions[inner] += shift
    return positions


def frames_to_seconds(frames: np.ndarray, sr: int) -> np.ndarray:
    """Frame positions to seconds, stamped mid-way through the onset lag (see Timing accuracy)."""
    return np.maximum(0.0, (np.asarray(frames, dtype=float) - ONSET_LAG / 2) * HOP_LENGTH / sr)


def pick_downbeat_phase(strengths: np.ndarray) -> int:
    """Which of the first four beats is a downbeat: the one whose every-4th beats are strongest.

    Sums onset strength per phase over whole bars only, so that each phase adds up the
    same number of beats and a leftover beat at the end cannot tip the choice.
    """
    bars = len(strengths) // BEATS_PER_BAR
    if bars == 0:
        return 0
    whole_bars = np.asarray(strengths[: bars * BEATS_PER_BAR], dtype=float)
    return int(whole_bars.reshape(bars, BEATS_PER_BAR).sum(axis=0).argmax())


def analyze(samples: np.ndarray, sr: int, bpm_hint: float | None = None) -> Analysis:
    """Find the tempo, the beats and the downbeat phase of a mono signal."""
    envelope = onset_envelope(samples, sr)
    # The hint first steers the estimate (as its prior). If the estimate still lands an
    # octave away, fold it back before tracking.
    detected = estimate_tempo(envelope, sr, start_bpm=bpm_hint or DEFAULT_START_BPM)
    tempo = fold_tempo(detected, bpm_hint) if bpm_hint else detected

    frames = track_beats(envelope, sr, tempo)
    if len(frames) == 0:
        return Analysis(tempo, detected, np.array([], dtype=float), 0)
    score = beat_score(envelope, sr, tempo)
    frames = drop_silent_edges(frames, score)
    beat_times = frames_to_seconds(refine_beats(score, frames), sr)
    return Analysis(tempo, detected, beat_times, pick_downbeat_phase(score[frames]))


def beat_interval_ms(beat_times: np.ndarray) -> tuple[float, float] | None:
    """(mean, standard deviation) of the gaps between beats in ms, or None under two beats."""
    if len(beat_times) < 2:
        return None
    gaps = np.diff(beat_times) * 1000.0
    return float(gaps.mean()), float(gaps.std())


def build_beatmap(analysis: Analysis, source: str) -> dict:
    """The JSON the game reads. Exactly five keys."""
    beats = [round(float(t), 4) for t in analysis.beat_times]
    if len(beats) >= 2:
        bpm = 60.0 / float(np.median(np.diff(analysis.beat_times)))
    else:
        bpm = analysis.tempo
    return {
        "bpm": round(float(bpm), 2),
        "offset": beats[0] if beats else 0.0,
        "beats": beats,
        "downbeats": beats[analysis.downbeat_phase :: BEATS_PER_BAR],
        "source": source,
    }


# --------------------------------------------------------------------------- outputs


def write_beatmap(beatmap: dict, out_path: Path) -> Path:
    out_path = Path(out_path).resolve()
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(beatmap, indent=2) + "\n", encoding="utf-8")
    return out_path


def write_click_track(samples: np.ndarray, sr: int, beats, downbeats, out_path: Path) -> Path:
    """Write the song with a click starting on every beat; downbeats are higher and louder."""
    samples = np.asarray(samples, dtype=np.float32)
    downbeat_set = {round(float(t), 4) for t in downbeats}
    ordinary = [float(t) for t in beats if round(float(t), 4) not in downbeat_set]

    def clicks(times, hz: float) -> np.ndarray:
        if len(times) == 0:
            return np.zeros(len(samples), dtype=np.float32)
        return librosa.clicks(
            times=np.asarray(times, dtype=float),
            sr=sr,
            length=len(samples),
            click_freq=hz,
            click_duration=CLICK_SECONDS,
        )

    # Clicks are set against the song's own peak so they cut through a loud master
    # without burying a quiet one.
    level = float(np.abs(samples).max()) or 1.0
    mix = samples + level * (
        BEAT_CLICK_GAIN * clicks(ordinary, BEAT_CLICK_HZ)
        + DOWNBEAT_CLICK_GAIN * clicks(sorted(downbeat_set), DOWNBEAT_CLICK_HZ)
    )
    peak = float(np.abs(mix).max())
    if peak > PEAK_LIMIT:
        mix = mix * (PEAK_LIMIT / peak)  # scale the whole mix rather than clip it

    out_path = Path(out_path).resolve()
    out_path.parent.mkdir(parents=True, exist_ok=True)
    sf.write(str(out_path), mix, sr, subtype="PCM_16")
    return out_path


def encode_mp3(wav_path: Path, mp3_path: Path) -> None:
    """Encode a WAV to MP3 with ffmpeg, in time with the WAV.

    Every MP3 encoder adds a start-up delay. ffmpeg records it in the file's header, so
    players trim it and the MP3 starts where the WAV does. Demucs's own --mp3 writer
    leaves that header out: its stems play 1105 samples (25 ms) behind the song the beat
    grid was measured on, which is more than the game's timing budget.
    """
    command = [
        "ffmpeg", "-y", "-v", "error",
        "-i", str(wav_path),
        "-codec:a", "libmp3lame", "-b:a", STEM_BITRATE,
        str(mp3_path),
    ]  # fmt: skip
    result = subprocess.run(command)
    if result.returncode != 0 or not Path(mp3_path).is_file():
        raise BeatmapError(
            f"ffmpeg could not encode {Path(wav_path).name} (exit code {result.returncode})"
        )


def separate_stems(
    audio_path: Path, separated_dir: Path | None = None, stems_dir: Path | None = None
) -> Stems:
    """Split the song with Demucs and write drums.mp3 / melody.mp3 into stems_dir.

    Slow: on a laptop CPU it takes most of the song's own length.
    """
    audio_path = Path(audio_path)
    separated_dir = Path(separated_dir or SEPARATED_DIR)
    stems_dir = Path(stems_dir or STEMS_DIR)

    if shutil.which("ffmpeg") is None:  # checked first: Demucs needs it too, minutes later
        raise BeatmapError("ffmpeg is not on PATH; --stems needs it (see tools/README.md)")

    # Demucs writes <out>/<model>/<file name up to its last dot>/{drums,no_drums}.wav
    track_dir = separated_dir / DEMUCS_MODEL / audio_path.name.rsplit(".", 1)[0]
    produced = {"drums.mp3": track_dir / "drums.wav", "melody.mp3": track_dir / "no_drums.wav"}
    for stale in produced.values():
        stale.unlink(missing_ok=True)  # an earlier run's files must not pass for this one's

    command = [
        sys.executable, "-m", "demucs",
        "-n", DEMUCS_MODEL,
        "--two-stems=drums",
        "-o", str(separated_dir),
        str(audio_path),
    ]  # fmt: skip
    started = time.perf_counter()
    result = subprocess.run(command)
    seconds = time.perf_counter() - started

    if result.returncode != 0:
        raise BeatmapError(
            f"Demucs failed with exit code {result.returncode} (its own output is above)"
        )
    missing = [path.name for path in produced.values() if not path.is_file()]
    if missing:
        raise BeatmapError(f"Demucs finished but did not write {', '.join(missing)} in {track_dir}")

    stems_dir.mkdir(parents=True, exist_ok=True)
    for name, wav in produced.items():
        encode_mp3(wav, stems_dir / name)
    return Stems(stems_dir / "drums.mp3", stems_dir / "melody.mp3", seconds)


# --------------------------------------------------------------------------- command line


def say(message: str, file=None) -> None:
    """print() that cannot fail on a cp1252 console, whatever characters a file name has.

    Flushes, so these lines stay in order with what Demucs prints.
    """
    print(message.encode("ascii", "backslashreplace").decode("ascii"), file=file, flush=True)


def positive_bpm(text: str) -> float:
    try:
        value = float(text)
    except ValueError:
        value = float("nan")
    if not (math.isfinite(value) and value > 0):
        raise argparse.ArgumentTypeError(f"{text!r} is not a tempo; give a positive number")
    return value


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="make_beatmap.py",
        description="Analyse a song and write the beat grid the game plays against.",
    )
    parser.add_argument("audio", help="the song (wav, mp3, flac, ogg, ...)")
    parser.add_argument(
        "--bpm-hint",
        type=positive_bpm,
        metavar="N",
        help="rough tempo; use it when the grid comes out at half or double speed",
    )
    parser.add_argument(
        "--click",
        action="store_true",
        help="also write tools/out/check.wav: the song with a click on every beat",
    )
    parser.add_argument(
        "--stems",
        action="store_true",
        help="also run Demucs and write public/stems/drums.mp3 and melody.mp3 (slow)",
    )
    parser.add_argument(
        "--out", metavar="PATH", help="where to write the beatmap (default: public/beatmap.json)"
    )
    return parser


def print_summary(audio_path: Path, seconds: float, analysis: Analysis, beatmap: dict) -> None:
    beats, downbeats = beatmap["beats"], beatmap["downbeats"]
    say(f"Source:          {audio_path.name} ({seconds:.1f} s)")
    if analysis.tempo != analysis.detected_tempo:
        say(f"Tempo estimate:  {analysis.detected_tempo:.2f} BPM, folded to {analysis.tempo:.2f}")
    say(f"BPM:             {beatmap['bpm']:.2f}")
    if beats:
        say(f"Beats:           {len(beats)} (first at {beats[0]:.3f} s, last at {beats[-1]:.3f} s)")
    else:
        say("Beats:           0 (nothing to track; is the file silent?)")
    interval = beat_interval_ms(analysis.beat_times)
    if interval:
        mean_ms, std_ms = interval
        say(f"Beat interval:   mean {mean_ms:.2f} ms, std {std_ms:.2f} ms (std = beat jitter)")
    else:
        say("Beat interval:   n/a (fewer than two beats)")
    say(f"Downbeat phase:  {analysis.downbeat_phase} of 0..3 ({len(downbeats)} downbeats)")


def run(args: argparse.Namespace) -> None:
    audio_path = Path(args.audio)
    if not audio_path.is_file():
        raise BeatmapError(f"input file not found: {audio_path}")

    samples, sr = load_audio(audio_path)
    analysis = analyze(samples, sr, args.bpm_hint)
    beatmap = build_beatmap(analysis, audio_path.name)
    out_path = write_beatmap(beatmap, Path(args.out) if args.out else DEFAULT_BEATMAP_PATH)

    print_summary(audio_path, len(samples) / sr, analysis, beatmap)
    say(f"Beatmap:         {out_path}")

    if args.click:
        check = write_click_track(
            samples, sr, beatmap["beats"], beatmap["downbeats"], DEFAULT_CLICK_PATH
        )
        say(f"Click check:     {check}")

    if args.stems:
        say("Running Demucs (slow: most of the song's own length on a laptop CPU)...")
        stems = separate_stems(audio_path, SEPARATED_DIR, STEMS_DIR)
        say(f"Demucs time:     {stems.seconds:.1f} s for {len(samples) / sr:.1f} s of audio")
        say(f"Stems:           {stems.drums}")
        say(f"                 {stems.melody}")


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        run(args)
    except BeatmapError as error:
        say(f"error: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
