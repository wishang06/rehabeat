# Beatmap tooling

`make_beatmap.py` analyses a song once, offline, and writes the files the web app
loads at runtime:

- `public/beatmap.json`: tempo and beat times (always)
- `public/stems/drums.mp3` and `public/stems/melody.mp3`: only with `--stems`

The app has no backend, so none of this runs in the browser.

## Setup

Python 3.12 or newer (current librosa requires it). From the repo root:

```bash
python -m venv tools/.venv
source tools/.venv/Scripts/activate     # Windows, Git Bash
# tools\.venv\Scripts\Activate.ps1      # Windows, PowerShell
# source tools/.venv/bin/activate       # macOS / Linux
python -m pip install -r tools/requirements.txt
```

`tools/.venv/` is already in `.gitignore`. On Windows, if `python` turns out to be
the MSYS2 build, create the venv with `py -3 -m venv tools/.venv` instead (see
Troubleshooting).

## Usage

```bash
python tools/make_beatmap.py path/to/song.mp3
```

```text
beatmap: 99.38 bpm, 41 beats, first 0.929 s, last 24.915 s -> C:\...\RehaBeat\public\beatmap.json
```

| Option | Default | Meaning |
| --- | --- | --- |
| `--out PATH` | `<repo>/public/beatmap.json` | beatmap file to write |
| `--stems` | off | also split the song into drums and melody with Demucs |
| `--stems-dir DIR` | `<repo>/public/stems` | folder for the two stems |

- The defaults are anchored to the repo root (the parent of `tools/`), so the
  script works from any directory. Paths you pass yourself are relative to the
  current directory as usual. Missing parent folders are created.
- Input can be anything libsndfile reads: mp3, wav, flac, ogg. Not m4a or aac.
- Exit code 0 on success, 1 for a missing or undecodable input or a failed
  `--stems` step, 2 for bad arguments.
- A track with no detectable beats still gets a file, with `"beats": []`, and a
  warning on stderr.

## Stems (optional)

```bash
python -m pip install -r tools/requirements-stems.txt   # Demucs and PyTorch, large
python tools/make_beatmap.py path/to/song.mp3 --stems
```

The beatmap is written first. Then the script runs

```text
python -m demucs -n htdemucs --two-stems drums --mp3 -o <temp dir> path/to/song.mp3
```

and copies the two results out of `<temp dir>/htdemucs/<song name>/`:

| Demucs output | Copied to | Content |
| --- | --- | --- |
| `drums.mp3` | `public/stems/drums.mp3` | drums only |
| `no_drums.mp3` | `public/stems/melody.mp3` | everything except the drums |

The temp folder is removed afterwards. The first run downloads the `htdemucs`
model, so it needs a network connection. Separation uses the GPU when PyTorch
finds one and is slow on a CPU. If Demucs is missing or fails, the script exits
with code 1 and says so; the beatmap from the first step is kept.

Make the beatmap and the stems from the same audio file (one `--stems` run does
both), otherwise the beats will not line up with what the app plays.

## Output format

```json
{
  "bpm": 99.38,
  "offset": 0.929,
  "beats": [0.929, 1.509, 2.113, 2.717, 3.32]
}
```

| Key | Meaning |
| --- | --- |
| `bpm` | librosa's tempo estimate for the whole track, 2 decimals |
| `offset` | time of the first detected beat in seconds, `0` if there are none |
| `beats` | every detected beat in seconds from the start of the track, ascending, 3 decimals |

This is the `Beatmap` interface in `src/types.ts`.

Accuracy, measured on a synthetic 100 BPM click track:

- The tracker works on a 23 ms frame grid (22050 Hz, hop 512). Reported beats
  were 8 to 31 ms after the real clicks, and the tempo came out as 99.38.
- librosa drops weak beats at both ends of a track. The first click at 0.3 s was
  not reported, so `offset` was 0.929 s: it is the first detected beat, not
  necessarily the first audible one.
- A silent file gives `"bpm": 0.0` and no beats.

## How the app uses the files

Vite serves `public/` at the site root, so the app fetches `/beatmap.json`,
`/stems/drums.mp3` and `/stems/melody.mp3`.

- No `beatmap.json`: the app falls back to a generated 72 BPM click track.
- `beats` empty: the app lays out an even grid at `bpm`, starting at `offset`.
- Stems present: the drums always play, and the melody fades in while the
  player holds the pose well.

## Troubleshooting

- **pip downloads `numpy-*.tar.gz` and fails with `subprocess-exited-with-error`
  (Windows).** `python` is the MSYS2/MinGW build, which cannot use the prebuilt
  wheels on PyPI. Check with `python -c "import sys; print(sys.version)"`: it
  mentions GCC. Use a python.org or Microsoft Store Python for the venv:
  `py -3 -m venv tools/.venv`.
- **`error: librosa could not be imported`.** The venv is not active, or the
  requirements were installed into a different Python. The message names the
  interpreter that ran the script.
- **`could not decode ... Format not recognised`.** The file is m4a, aac or
  another format libsndfile cannot read. Convert it first:
  `ffmpeg -i song.m4a song.wav`.
- **mp3 fails to decode although the file is fine.** mp3 is decoded by the
  libsndfile bundled in the `soundfile` wheel (0.12.1 or newer), without ffmpeg.
  Where `soundfile` uses a system libsndfile older than 1.1 instead (some Linux
  setups), mp3 is not supported: librosa 1.x then fails, and librosa 0.10 / 0.11
  fall back to audioread, which usually needs ffmpeg on PATH. Converting the
  song to wav (`ffmpeg -i song.mp3 song.wav`) works everywhere.
- **The tempo is double or half of what you expect.** Beat trackers do this on
  some songs. There is no flag for it: either thin out `beats` in the JSON by
  hand, or pass `start_bpm=<expected tempo>` to `librosa.beat.beat_track` in
  `detect_beats`.
- **`--stems needs Demucs`.** Install `tools/requirements-stems.txt` into the
  same venv that runs the script. Keep ffmpeg on PATH too: Demucs uses it for
  input formats it cannot decode on its own.
