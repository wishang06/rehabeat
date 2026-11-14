"""Tests for tools/song_pipeline.py, the machine interface the `npm run songs` CLI calls.

Run from the repo root:

    tools\\.venv\\Scripts\\python.exe -m pytest tools

Demucs never runs here: the stems test fakes it with two synthetic WAVs (ffmpeg is real).
"""

from __future__ import annotations

import json
import math
import platform
import shutil
import subprocess
import sys
from pathlib import Path

import numpy as np
import pytest
import soundfile as sf

import song_pipeline
from test_make_beatmap import BEATMAP_KEYS, write_click_wav

SENTINEL = song_pipeline.RESULT_SENTINEL
SCRIPT = Path(song_pipeline.__file__).resolve()


def parse_result(stdout: str) -> dict:
    """The one result line: present once, last, and valid JSON after the sentinel."""
    lines = [line for line in stdout.splitlines() if line.strip()]
    assert lines, "nothing on stdout"
    assert sum(line.startswith(SENTINEL) for line in lines) == 1
    assert lines[-1].startswith(f"{SENTINEL} {{")
    return json.loads(lines[-1][len(SENTINEL) + 1 :])


def run_main(capsys, *argv: str) -> tuple[int, dict, str, str]:
    code = song_pipeline.main([str(arg) for arg in argv])
    captured = capsys.readouterr()
    return code, parse_result(captured.out), captured.out, captured.err


def run_script(*argv: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        [sys.executable, str(SCRIPT), *[str(arg) for arg in argv]],
        capture_output=True,
        text=True,
        timeout=120,
    )


@pytest.fixture(scope="module")
def click72(tmp_path_factory):
    """20 s of clicks at 72 BPM, the first at 1.0 s. The file name has a space in it."""
    folder = tmp_path_factory.mktemp("pipeline")
    wav = folder / "click 72.wav"
    clicks, _ = write_click_wav(wav, 72.0, duration=20.0, accent_at=0)
    return wav, clicks


# --------------------------------------------------------------------------- analyze


def test_analyze_writes_the_beatmap_and_reports_on_one_line(click72, tmp_path, capsys):
    wav, clicks = click72
    out_dir = tmp_path / "staging" / "click-72"  # does not exist yet
    check = tmp_path / "checks" / "check.wav"

    code, result, stdout, stderr = run_main(
        capsys, "analyze", wav, "--out-dir", out_dir, "--click", check
    )

    assert code == 0 and result["ok"] is True and result["command"] == "analyze"
    # Only the result line on stdout; the human summary is on stderr.
    assert stdout.strip().count("\n") == 0
    assert "BPM:" in stderr and "Click check:" in stderr

    assert abs(result["bpm"] - 72.0) <= 1.0
    assert result["jitterMs"] < 2.0
    assert result["meanGapMs"] == pytest.approx(60_000 / 72, abs=10)
    assert result["beatCount"] == len(clicks)
    assert result["firstBeat"] == pytest.approx(clicks[0], abs=0.02)
    assert result["lastBeat"] == pytest.approx(clicks[-1], abs=0.02)
    assert result["durationSec"] == pytest.approx(20.0, abs=0.01)
    assert result["bpmHint"] is None
    assert result["source"] == "click 72.wav"

    beatmap = json.loads(Path(result["beatmapPath"]).read_text(encoding="utf-8"))
    assert Path(result["beatmapPath"]) == (out_dir / "beatmap.json").resolve()
    assert set(beatmap) == BEATMAP_KEYS
    assert beatmap["bpm"] == result["bpm"]
    assert len(beatmap["beats"]) == result["beatCount"]

    assert Path(result["clickPath"]) == check.resolve()
    assert sf.info(str(check)).duration == pytest.approx(sf.info(str(wav)).duration, abs=1e-3)


def test_analyze_without_click_writes_no_check_file(click72, tmp_path, capsys):
    wav, _ = click72
    code, result, _, _ = run_main(capsys, "analyze", wav, "--out-dir", tmp_path)

    assert code == 0
    assert result["clickPath"] is None
    assert sorted(path.name for path in tmp_path.iterdir()) == ["beatmap.json"]


def test_bpm_hint_moves_the_grid_to_the_hinted_octave(click72, tmp_path, capsys):
    wav, _ = click72
    code, result, _, _ = run_main(capsys, "analyze", wav, "--out-dir", tmp_path, "--bpm-hint", "144")

    assert code == 0
    assert result["bpmHint"] == 144.0
    assert abs(result["bpm"] - 144.0) <= 2.0
    assert abs(result["tempo"] - 144.0) <= 2.0  # folded to the hint's octave
    assert abs(result["detectedTempo"] - 72.0) <= 2.0 or abs(result["detectedTempo"] - 144.0) <= 2.0


# --------------------------------------------------------------------------- preflight


def test_preflight_reports_versions_and_tools():
    completed = run_script("preflight")

    assert completed.returncode == 0, completed.stderr
    result = parse_result(completed.stdout)
    assert result["ok"] is True and result["command"] == "preflight"
    assert result["python"] == platform.python_version()
    assert Path(result["executable"]).resolve() == Path(sys.executable).resolve()

    import librosa

    assert set(result["packages"]) == set(song_pipeline.PACKAGES)
    assert result["packages"]["librosa"] == librosa.__version__
    assert result["packages"]["soundfile"] == sf.__version__
    assert result["commands"] == {
        name: shutil.which(name) is not None for name in ("ffmpeg", "ffprobe", "ffplay")
    }


def test_a_package_that_cannot_be_imported_is_null():
    assert song_pipeline.package_version("no_such_package_rehabeat") is None
    assert song_pipeline.package_version("pytest") == pytest.__version__


# --------------------------------------------------------------------------- errors


def test_missing_input_exits_1_with_one_line_and_a_failed_result(tmp_path):
    missing = tmp_path / "no such song.mp3"

    completed = run_script("analyze", missing, "--out-dir", tmp_path / "out")

    assert completed.returncode == 1
    error_lines = completed.stderr.strip().splitlines()
    assert len(error_lines) == 1
    assert error_lines[0].startswith("error: ") and "no such song.mp3" in error_lines[0]
    result = parse_result(completed.stdout)
    assert result["ok"] is False and "no such song.mp3" in result["error"]
    assert not (tmp_path / "out").exists()


def test_undecodable_audio_is_a_clear_error(tmp_path, capsys):
    bogus = tmp_path / "not audio.mp3"
    bogus.write_text("<html>this is a web page</html>", encoding="utf-8")

    code, result, _, stderr = run_main(capsys, "analyze", bogus, "--out-dir", tmp_path)

    assert code == 1
    assert result["ok"] is False and "could not decode" in result["error"]
    assert stderr.strip().splitlines()[-1].startswith("error: could not decode")


# --------------------------------------------------------------------------- levelling


def test_sum_peak_is_the_peak_of_the_sum_not_the_sum_of_the_peaks():
    drums = np.array([0.5, 0.0, -0.2, 0.1])
    melody = np.array([0.3, 0.6, -0.5, -0.1])
    # Sum: 0.8, 0.6, -0.7, 0.0. The peaks alone would add up to 1.1.
    assert song_pipeline.sum_peak(drums, melody) == pytest.approx(0.8)


def test_sum_peak_covers_every_channel_and_cuts_to_the_shorter_stem():
    drums = np.array([[0.1, 0.2], [0.1, -0.7], [0.0, 0.0]])
    melody = np.array([[0.1, 0.1], [0.0, -0.2]])
    assert song_pipeline.sum_peak(drums, melody) == pytest.approx(0.9)


@pytest.mark.parametrize("peak", [0.8, 1.6, 0.05, 10 ** (-12 / 20)])
def test_levelling_moves_the_sum_peak_to_minus_12_dbfs(peak):
    rng = np.random.default_rng(3)
    drums = rng.uniform(-1, 1, (1000, 2))
    melody = rng.uniform(-1, 1, (1000, 2))
    scale = peak / song_pipeline.sum_peak(drums, melody)
    drums, melody = drums * scale, melody * scale  # the sum now peaks at `peak`

    gain_db = song_pipeline.levelling_gain_db(song_pipeline.sum_peak(drums, melody))

    assert gain_db == pytest.approx(-12.0 - 20 * math.log10(peak))
    levelled = song_pipeline.sum_peak(
        song_pipeline.apply_gain_db(drums, gain_db), song_pipeline.apply_gain_db(melody, gain_db)
    )
    assert song_pipeline.to_dbfs(levelled) == pytest.approx(-12.0, abs=1e-9)
    # One factor for both stems: their balance is kept.
    ratio = np.abs(song_pipeline.apply_gain_db(drums, gain_db)).max() / np.abs(drums).max()
    assert ratio == pytest.approx(10 ** (gain_db / 20))


def test_a_quiet_song_is_raised_and_a_loud_one_lowered():
    assert song_pipeline.levelling_gain_db(10 ** (-18 / 20)) == pytest.approx(6.0)
    assert song_pipeline.levelling_gain_db(1.0) == pytest.approx(-12.0)


def test_an_encoded_peak_that_misses_the_target_is_corrected_once():
    # MP3 encoding nudged the sum peak from -12.0 up to -11.6: encode again 0.4 dB lower.
    assert song_pipeline.corrected_gain_db(-7.5, -11.6) == pytest.approx(-7.9)
    assert song_pipeline.corrected_gain_db(-7.5, -12.5) == pytest.approx(-7.0)
    # Within 0.25 dB is close enough.
    assert song_pipeline.corrected_gain_db(-7.5, -12.2) is None
    assert song_pipeline.corrected_gain_db(-7.5, -11.8) is None
    assert song_pipeline.corrected_gain_db(-7.5, -math.inf) is None


def test_silent_stems_cannot_be_levelled():
    with pytest.raises(song_pipeline.PipelineError, match="silent"):
        song_pipeline.levelling_gain_db(song_pipeline.sum_peak(np.zeros(10), np.zeros(10)))


# --------------------------------------------------------------------------- stems


@pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="needs ffmpeg on PATH")
def test_stems_are_levelled_together_and_reported(click72, tmp_path, monkeypatch, capsys):
    import make_beatmap

    wav, _ = click72
    sr = 44100
    seconds = np.arange(5 * sr) / sr
    # Loud stems: 80 Hz kicks up to 0.9 and a 220 Hz tone at 0.5, so the sum would clip.
    # Low tones only: an MP3 keeps their peaks, where it would smear a sharp click.
    kick = np.zeros(len(seconds))
    hit = np.arange(int(0.2 * sr)) / sr
    for start in range(0, len(seconds) - len(hit), sr // 2):
        kick[start : start + len(hit)] += 0.9 * np.exp(-hit / 0.05) * np.sin(2 * np.pi * 80 * hit)
    drums = np.stack([kick] * 2, axis=1).astype(np.float32)
    melody = np.stack([0.5 * np.sin(2 * np.pi * 220 * seconds)] * 2, axis=1).astype(np.float32)
    expected_before = song_pipeline.sum_peak(drums, melody)

    real_run = subprocess.run

    def fake_demucs(command, **kwargs):
        command = list(command)
        if "demucs" not in command:
            return real_run(command, **kwargs)  # ffmpeg is real
        track = Path(command[command.index("-o") + 1]) / "htdemucs" / Path(command[-1]).stem
        track.mkdir(parents=True, exist_ok=True)
        sf.write(str(track / "drums.wav"), drums, sr, subtype="PCM_16")
        sf.write(str(track / "no_drums.wav"), melody, sr, subtype="PCM_16")
        return subprocess.CompletedProcess(command, 0)

    monkeypatch.setattr(make_beatmap.subprocess, "run", fake_demucs)
    out_dir = tmp_path / "staging"

    code, result, stdout, stderr = run_main(
        capsys, "stems", wav, "--out-dir", out_dir, "--separated-dir", tmp_path / "separated"
    )

    assert code == 0, stderr
    assert stdout.strip().count("\n") == 0
    assert result["command"] == "stems" and result["targetDbfs"] == -12.0
    assert Path(result["drums"]) == out_dir / "drums.mp3"
    assert Path(result["melody"]) == out_dir / "melody.mp3"
    assert result["demucsSeconds"] >= 0
    assert result["sumPeakBeforeDbfs"] == pytest.approx(song_pipeline.to_dbfs(expected_before), abs=0.01)
    first_gain = -12.0 - result["sumPeakBeforeDbfs"]  # from the WAVs
    if "encoding again" in stderr:  # the MP3 missed by more than the tolerance: corrected once
        assert abs(result["gainDb"] - first_gain) > song_pipeline.MP3_PEAK_TOLERANCE_DB
    else:
        assert result["gainDb"] == pytest.approx(first_gain, abs=0.01)
    assert result["sumPeakDbfs"] == pytest.approx(-12.0, abs=song_pipeline.MP3_PEAK_TOLERANCE_DB)
    # The reported peak is measured on the MP3s that were written.
    decoded = song_pipeline.sum_peak(
        song_pipeline.read_audio(out_dir / "drums.mp3"), song_pipeline.read_audio(out_dir / "melody.mp3")
    )
    assert song_pipeline.to_dbfs(decoded) == pytest.approx(result["sumPeakDbfs"], abs=0.01)
    assert "Levelled stems" in stderr
