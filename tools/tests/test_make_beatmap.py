"""Tests for tools/make_beatmap.py.

Every track here is synthetic, so the true beat times are known exactly and the
detected grid can be checked against them. Run from the repo root:

    tools\\.venv\\Scripts\\python.exe -m pytest tools

Nothing here writes into the repo or runs a real Demucs separation.
"""

from __future__ import annotations

import json
import math
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

import librosa
import numpy as np
import pytest
import soundfile as sf

import make_beatmap

SR = 44100
TOLERANCE_S = 0.020  # the game's timing budget: a beat further off than this is wrong
BEATMAP_KEYS = {"bpm", "offset", "beats", "downbeats", "source"}
PCM16_FULL_SCALE = 32767 / 32768


# --------------------------------------------------------------------------- helpers


def write_click_wav(
    path: Path,
    bpm: float,
    *,
    duration: float = 30.0,
    first_click: float = 1.0,
    tail: float = 1.0,
    click_gain: float = 0.3,
    accent_at: int | None = None,
    accent_gain: float = 0.8,
    offbeat_gain: float = 0.0,
    backing: float = 0.0,
    seed: int = 0,
) -> tuple[np.ndarray, np.ndarray]:
    """Write a click track on near-silence. Returns (click times, accented click times).

    A click is a 30 ms noise burst with an instant attack and a fast decay, so its
    time is unambiguous: the first sample of the burst.

    first_click  -- time of the first click; before it there is only the noise floor.
    tail         -- the last click is at least this long before the end of the file.
    accent_at    -- which click in every group of four is accented (0..3), or None.
    offbeat_gain -- if > 0, add a quieter click halfway between the main clicks
                    (an eighth-note pulse, which invites double-time detection).
    backing      -- if > 0, level of a steady bed of held tones and hiss under the
                    clicks, standing in for the sustained part of a real mix.
    """
    rng = np.random.default_rng(seed)
    n_samples = int(duration * SR)
    audio = 1e-3 * rng.standard_normal(n_samples)  # noise floor around -60 dBFS
    if backing > 0:
        seconds = np.arange(n_samples) / SR
        for hz in (110.0, 220.0, 330.0, 440.0, 660.0, 880.0, 1760.0):
            audio += 0.3 * backing * np.sin(2 * np.pi * hz * seconds + rng.uniform(0, 2 * np.pi))
        audio += 0.3 * backing * rng.standard_normal(n_samples)

    burst_len = int(0.030 * SR)
    decay = np.exp(-np.arange(burst_len) / (0.006 * SR))

    def add_burst(start: int, gain: float) -> None:
        # Uniform noise keeps every sample within +/- gain, so nothing clips in the file.
        audio[start : start + burst_len] += gain * decay * rng.uniform(-1.0, 1.0, burst_len)

    period = 60.0 / bpm
    starts = np.round(np.arange(first_click, duration - tail, period) * SR).astype(int)
    accented = np.zeros(len(starts), dtype=bool)
    if accent_at is not None:
        accented[accent_at::4] = True

    for start, is_accent in zip(starts, accented):
        add_burst(int(start), accent_gain if is_accent else click_gain)
        if offbeat_gain > 0:
            add_burst(int(start + round(period / 2 * SR)), offbeat_gain)

    assert np.abs(audio).max() < 1.0, "fixture would clip"
    sf.write(str(path), audio.astype(np.float32), SR, subtype="PCM_16")
    return starts / SR, starts[accented] / SR


def nearest(times, targets) -> tuple[np.ndarray, np.ndarray]:
    """For each time: (index of the nearest target, distance to it in seconds)."""
    gaps = np.abs(np.asarray(times, dtype=float)[:, None] - np.asarray(targets, dtype=float))
    index = gaps.argmin(axis=1)
    return index, gaps[np.arange(len(index)), index]


def run_tool(wav: Path, out: Path, *extra: str) -> dict:
    """Run the CLI entry point and return the beatmap it wrote."""
    assert make_beatmap.main([str(wav), "--out", str(out), *extra]) == 0
    return json.loads(out.read_text(encoding="utf-8"))


@dataclass
class Track:
    wav: Path
    clicks: np.ndarray
    accents: np.ndarray
    beatmap: dict


@pytest.fixture(scope="module")
def track(tmp_path_factory) -> Track:
    """30 s at 72 BPM. First click at 1.0 s; the accent is the THIRD click of each four."""
    folder = tmp_path_factory.mktemp("clicks")
    wav = folder / "clicks_72bpm.wav"
    clicks, accents = write_click_wav(wav, 72.0, accent_at=2)
    assert clicks[0] > 0 and accents[0] > clicks[0]
    return Track(wav, clicks, accents, run_tool(wav, folder / "nested" / "beatmap.json"))


@pytest.fixture(scope="module")
def backed(tmp_path_factory) -> Track:
    """The 72 BPM track again, with the clicks sitting on a steady bed of tones and hiss."""
    folder = tmp_path_factory.mktemp("backed")
    wav = folder / "backed_72bpm.wav"
    clicks, accents = write_click_wav(
        wav, 72.0, click_gain=0.25, accent_at=2, accent_gain=0.6, backing=0.1, seed=2
    )
    return Track(wav, clicks, accents, run_tool(wav, folder / "beatmap.json"))


@pytest.fixture(scope="module")
def eighths(tmp_path_factory) -> Track:
    """72.4 BPM with quieter clicks on the off-beats: looks like 144.8 BPM to a tracker."""
    folder = tmp_path_factory.mktemp("eighths")
    wav = folder / "eighths_72_4bpm.wav"
    clicks, accents = write_click_wav(wav, 72.4, click_gain=0.8, offbeat_gain=0.3, seed=1)
    return Track(wav, clicks, accents, run_tool(wav, folder / "plain.json"))


# --------------------------------------------------------------------------- beat grid


def test_beatmap_has_exactly_the_agreed_shape(track):
    beatmap = track.beatmap
    assert set(beatmap) == BEATMAP_KEYS
    assert beatmap["source"] == "clicks_72bpm.wav"
    assert isinstance(beatmap["bpm"], float)
    assert beatmap["bpm"] == round(beatmap["bpm"], 2)

    beats, downbeats = beatmap["beats"], beatmap["downbeats"]
    assert beatmap["offset"] == beats[0]
    assert all(isinstance(t, float) and t == round(t, 4) for t in beats + downbeats)
    assert beats == sorted(set(beats))
    assert downbeats == sorted(set(downbeats))


def test_bpm_is_72(track):
    assert abs(track.beatmap["bpm"] - 72.0) <= 1.0


def test_every_beat_is_on_a_click_and_every_click_has_a_beat(track):
    beats = track.beatmap["beats"]
    click_index, distance = nearest(beats, track.clicks)

    assert distance.max() <= TOLERANCE_S
    # One beat per click: no click is hit twice, and none of the 34 is missed.
    assert len(set(click_index)) == len(beats)
    assert len(beats) == len(track.clicks)


def test_downbeats_are_the_accented_clicks(track):
    beats, downbeats = track.beatmap["beats"], track.beatmap["downbeats"]
    accent_index, distance = nearest(downbeats, track.accents)

    assert distance.max() <= TOLERANCE_S
    assert len(set(accent_index)) == len(downbeats)
    assert len(track.accents) - len(downbeats) <= 1
    # Downbeats are every 4th beat, starting from one of the first four.
    first = beats.index(downbeats[0])
    assert first < 4
    assert downbeats == beats[first::4]


def test_beats_stay_on_the_clicks_over_a_steady_backing(backed):
    # Harder than near-silence. A sustained backing delays the peak of the onset envelope,
    # and the delay grows with the analysis window: with a 93 ms window (the length librosa
    # defaults to) this same grid comes out 25 to 30 ms late.
    beats, downbeats = backed.beatmap["beats"], backed.beatmap["downbeats"]
    click_index, distance = nearest(beats, backed.clicks)

    assert distance.max() <= TOLERANCE_S
    assert len(set(click_index)) == len(beats)
    assert len(beats) == len(backed.clicks)
    assert abs(backed.beatmap["bpm"] - 72.0) <= 1.0

    _, accent_distance = nearest(downbeats, backed.accents)
    assert accent_distance.max() <= TOLERANCE_S
    assert len(downbeats) >= len(backed.accents) - 1


@pytest.mark.parametrize("lead_in", [0.2, 0.45, 3.0])
def test_grid_starts_on_the_first_click_and_stops_on_the_last(tmp_path, lead_in):
    # Silence of any length before the music, and four seconds of it after, get no beats.
    # 0.45 s is the awkward one: just over half a beat, where librosa's tracker on its own
    # skips the first click.
    wav = tmp_path / "lead_in.wav"
    clicks, _ = write_click_wav(wav, 72.0, duration=20.0, first_click=lead_in, tail=4.0)

    beatmap = run_tool(wav, tmp_path / "beatmap.json")

    _, distance = nearest(beatmap["beats"], clicks)
    assert distance.max() <= TOLERANCE_S
    assert len(beatmap["beats"]) == len(clicks)
    assert abs(beatmap["offset"] - clicks[0]) <= TOLERANCE_S


def test_only_weak_beats_at_the_ends_are_dropped():
    score = np.array([0.05, 1.0, 0.1, 1.2, 0.9, 0.04, 0.06])
    frames = np.arange(len(score))
    # The weak beat in the middle stays: a rest in the music is still on the grid.
    assert list(make_beatmap.drop_silent_edges(frames, score)) == [1, 2, 3, 4]
    assert len(make_beatmap.drop_silent_edges(frames, np.zeros(len(score)))) == 0


def test_downbeat_phase_counts_whole_bars_only():
    # Nine beats: phase 0 has three of them, the others two each. The accent is on phase 2
    # and must win even though phase 0 has an extra beat to add up.
    strengths = np.array([1.0, 1.0, 1.4, 1.0] * 2 + [1.0])
    assert make_beatmap.pick_downbeat_phase(strengths) == 2
    assert make_beatmap.pick_downbeat_phase(np.array([1.0, 3.0])) == 0  # under one bar


# --------------------------------------------------------------------------- tempo


def test_tempo_estimate_matches_librosa_beat_track(track):
    # The tool estimates tempo on a thinned-out tempogram to save memory. It has to
    # agree with the estimate librosa.beat.beat_track makes on the same envelope.
    audio, sr = make_beatmap.load_audio(track.wav)
    envelope = make_beatmap.onset_envelope(audio, sr)
    reference, _ = librosa.beat.beat_track(
        onset_envelope=envelope, sr=sr, hop_length=make_beatmap.HOP_LENGTH
    )
    reference = float(np.atleast_1d(reference)[0])
    assert make_beatmap.estimate_tempo(envelope, sr) == pytest.approx(reference, rel=1e-6)


@pytest.mark.parametrize(
    ("tempo", "hint", "expected"),
    [
        (144.8, 70.0, 72.4),  # double time
        (36.2, 70.0, 72.4),  # half time
        (289.6, 70.0, 72.4),  # two octaves out
        (72.4, 70.0, 72.4),  # already right: not pulled to the hint
        (98.0, 70.0, 98.0),  # just inside the octave (70 * sqrt(2) = 98.99)
        (100.0, 70.0, 50.0),  # just outside it
    ],
)
def test_fold_tempo_moves_by_octaves_only(tempo, hint, expected):
    folded = make_beatmap.fold_tempo(tempo, hint)
    assert folded == pytest.approx(expected)
    assert hint / math.sqrt(2) <= folded < hint * math.sqrt(2)


def test_bpm_hint_fixes_double_time_without_forcing_the_hint(eighths, tmp_path):
    # Premise: without a hint this track is read in double time.
    assert eighths.beatmap["bpm"] > 72.4 * math.sqrt(2), "fixture no longer fools the tracker"

    hinted = run_tool(eighths.wav, tmp_path / "hinted.json", "--bpm-hint", "70")

    # In the hint's octave, at the song's real tempo -- not at 70.
    assert abs(hinted["bpm"] - 72.4) <= 0.5
    _, distance = nearest(hinted["beats"], eighths.clicks)
    assert distance.max() <= TOLERANCE_S
    assert len(eighths.clicks) - len(hinted["beats"]) <= 2


@pytest.mark.parametrize("hint", [36, 144])
def test_bpm_hint_chooses_the_octave(track, tmp_path, hint):
    hinted = run_tool(track.wav, tmp_path / "hinted.json", "--bpm-hint", str(hint))

    assert hint / math.sqrt(2) <= hinted["bpm"] < hint * math.sqrt(2)
    assert abs(hinted["bpm"] - hint) <= hint / 72  # i.e. 72 +/- 1, scaled to the octave

    beat_index, beat_distance = nearest(hinted["beats"], track.clicks)
    if hint < 72:  # half time: every beat is a click, about every other click is used
        assert beat_distance.max() <= TOLERANCE_S
        assert abs(len(hinted["beats"]) - len(track.clicks) / 2) <= 2
    else:  # double time: every click has a beat, with one extra beat between clicks
        _, click_distance = nearest(track.clicks, hinted["beats"])
        assert click_distance.max() <= TOLERANCE_S
        assert abs(len(hinted["beats"]) - 2 * len(track.clicks)) <= 3


# --------------------------------------------------------------------------- click check file


def test_click_flag_writes_a_check_wav_as_long_as_the_song(track, tmp_path, monkeypatch):
    check = tmp_path / "out" / "check.wav"  # folder does not exist yet
    monkeypatch.setattr(make_beatmap, "DEFAULT_CLICK_PATH", check)

    run_tool(track.wav, tmp_path / "beatmap.json", "--click")

    assert sf.info(str(check)).duration == pytest.approx(sf.info(str(track.wav)).duration, abs=1e-3)
    samples, _ = sf.read(str(check))
    assert np.abs(samples).max() < PCM16_FULL_SCALE, "check.wav is clipped"


def test_click_track_marks_each_beat_and_accents_downbeats(tmp_path):
    sr = make_beatmap.SAMPLE_RATE
    song = np.zeros(4 * sr, dtype=np.float32)
    beats = [0.5, 1.0, 1.5, 2.0, 2.5, 3.0]
    downbeats = [1.0, 3.0]
    check = tmp_path / "check.wav"

    make_beatmap.write_click_track(song, sr, beats, downbeats, check)

    samples, file_sr = sf.read(str(check))
    assert file_sr == sr and len(samples) == len(song)

    def click(at: float) -> np.ndarray:
        start = int(round(at * sr))
        return samples[start : start + int(0.03 * sr)]

    def pitch(at: float) -> float:
        spectrum = np.abs(np.fft.rfft(click(at)))
        return float(np.fft.rfftfreq(len(click(at)), 1 / sr)[spectrum.argmax()])

    for beat in beats:
        start = int(round(beat * sr))
        assert np.abs(samples[start - int(0.01 * sr) : start]).max() < 1e-3  # quiet before
        assert np.abs(click(beat)).max() > 0.1  # click starts on the beat
    for downbeat in downbeats:
        assert np.abs(click(downbeat)).max() > 1.5 * np.abs(click(0.5)).max()  # louder
        assert pitch(downbeat) > 1.3 * pitch(0.5)  # higher
    assert np.abs(samples).max() < PCM16_FULL_SCALE


# --------------------------------------------------------------------------- stems (Demucs faked)


def fake_demucs(returncode: int = 0, write: tuple[str, ...] = ("drums.mp3", "no_drums.mp3")):
    """A stand-in for subprocess.run that behaves like the Demucs CLI."""
    calls: list[list[str]] = []

    def run(command, **kwargs):
        calls.append(list(command))
        track_name = Path(command[-1]).name.rsplit(".", 1)[0]
        folder = Path(command[command.index("-o") + 1]) / "htdemucs" / track_name
        folder.mkdir(parents=True, exist_ok=True)
        for name in write:
            (folder / name).write_bytes(name.encode())
        return subprocess.CompletedProcess(command, returncode)

    return run, calls


def test_stems_flag_copies_drums_and_melody(track, tmp_path, monkeypatch, capsys):
    run, calls = fake_demucs()
    monkeypatch.setattr(make_beatmap.subprocess, "run", run)
    monkeypatch.setattr(make_beatmap, "SEPARATED_DIR", tmp_path / "separated")
    monkeypatch.setattr(make_beatmap, "STEMS_DIR", tmp_path / "stems")

    run_tool(track.wav, tmp_path / "beatmap.json", "--stems")

    assert (tmp_path / "stems" / "drums.mp3").read_bytes() == b"drums.mp3"
    assert (tmp_path / "stems" / "melody.mp3").read_bytes() == b"no_drums.mp3"
    (command,) = calls
    assert command[:3] == [sys.executable, "-m", "demucs"]
    assert "--two-stems=drums" in command and "--mp3" in command
    assert command[-1] == str(track.wav)
    assert "Demucs" in capsys.readouterr().out  # the elapsed time is reported


@pytest.mark.parametrize(
    ("returncode", "write", "message"),
    [
        (1, ("drums.mp3", "no_drums.mp3"), "exit code 1"),
        (0, ("drums.mp3",), "no_drums.mp3"),
    ],
)
def test_stems_failure_is_a_clear_error(tmp_path, monkeypatch, returncode, write, message):
    run, _ = fake_demucs(returncode, write)
    monkeypatch.setattr(make_beatmap.subprocess, "run", run)
    song = tmp_path / "my song.mp3"
    song.write_bytes(b"")

    with pytest.raises(make_beatmap.BeatmapError, match=message):
        make_beatmap.separate_stems(song, tmp_path / "separated", tmp_path / "stems")
    assert not (tmp_path / "stems" / "melody.mp3").exists()


# --------------------------------------------------------------------------- CLI edges


def test_missing_input_is_a_one_line_error(tmp_path, capsys):
    out = tmp_path / "beatmap.json"

    assert make_beatmap.main([str(tmp_path / "no_such_song.mp3"), "--out", str(out)]) != 0

    error = capsys.readouterr().err.strip()
    assert "no_such_song.mp3" in error
    assert len(error.splitlines()) == 1
    assert not out.exists()


def test_default_outputs_are_anchored_to_the_repo_root_not_the_cwd():
    repo_root = Path(__file__).resolve().parents[2]
    assert make_beatmap.DEFAULT_BEATMAP_PATH == repo_root / "public" / "beatmap.json"
    assert make_beatmap.DEFAULT_CLICK_PATH == repo_root / "tools" / "out" / "check.wav"
    assert make_beatmap.SEPARATED_DIR == repo_root / "tools" / "out" / "separated"
    assert make_beatmap.STEMS_DIR == repo_root / "public" / "stems"
