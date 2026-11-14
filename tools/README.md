# Rehabeat music tools

`make_beatmap.py` turns an audio file into `public/beatmap.json`, the beat grid the game plays against.
It can also write a click-track check file and split the song into drum and melody stems.

## Setup (Windows 11, PowerShell)

Run everything from the repo root.

1. **Python 3.11.** Check with `py -3.11 --version`. If it is missing: `winget install Python.Python.3.11`.
2. **ffmpeg** must be on `PATH` (it reads the song for Demucs and encodes the stems). Check with
   `ffmpeg -version`. If it is missing: `winget install Gyan.FFmpeg`, then open a new terminal.
3. **Create the virtual environment and install:**

   ```powershell
   py -3.11 -m venv tools\.venv
   tools\.venv\Scripts\python.exe -m pip install --upgrade pip
   tools\.venv\Scripts\python.exe -m pip install -r tools\requirements.txt
   ```

   The install is about 1 GB (PyTorch) and takes around 5 minutes. On Windows this is the CPU build
   of PyTorch, which is all Demucs needs here.

The commands below call `tools\.venv\Scripts\python.exe` directly, so you never need to activate the
environment. If you prefer to activate it, run `tools\.venv\Scripts\Activate.ps1`; if PowerShell blocks
the script, run `Set-ExecutionPolicy -Scope Process RemoteSigned` first.

The first `--stems` run downloads the Demucs model (80 MB) into `%USERPROFILE%\.cache\torch`.

## Make a beatmap

This is the command that produced the files in `public/`:

```powershell
tools\.venv\Scripts\python.exe tools\make_beatmap.py tools\tracks\kevin-macleod-past-sadness.mp3 --bpm-hint 72 --click --stems
```

| Flag | What it does |
| --- | --- |
| `--bpm-hint N` | Rough tempo. Use it when the grid comes out at double or half speed. It only moves the result by factors of two, so the song's real tempo is kept. |
| `--click` | Also writes `tools/out/check.wav`: the song with a click on every beat, higher and louder on downbeats. |
| `--stems` | Also runs Demucs and writes `public/stems/drums.mp3` and `public/stems/melody.mp3` (everything except the drums). |
| `--out PATH` | Write the beatmap somewhere other than `public/beatmap.json`. |

The script prints the BPM, the number of beats, and the mean and standard deviation of the gap
between beats. The standard deviation is the beat jitter: a few ms means a steady grid.

`--stems` is slow because Demucs runs on the CPU here. For this 3.5-minute song it took between
2.5 and 10 minutes across runs on this laptop. The script prints the time Demucs took.

### `public/beatmap.json`

```json
{ "bpm": 72.0, "offset": 0.0303, "beats": [0.0303, 0.8659, 1.6987], "downbeats": [2.5303, 5.8628], "source": "kevin-macleod-past-sadness.mp3" }
```

(Shortened: the real file lists all 256 beats and 64 downbeats.)

- `bpm`: 60 divided by the median gap between beats.
- `offset`: time of the first beat in seconds (the same number as `beats[0]`).
- `beats`: every beat, in seconds from the start of the audio.
- `downbeats`: every 4th beat, starting from whichever of the first four has the most onset energy.
- `source`: file name of the song.

Times are measured on the source song. The stems start at the same instant as the source, so the
grid applies to them unchanged.

## Check the grid by ear

Play `tools/out/check.wav` after a `--click` run.

- **Clicks twice as fast or half as fast as you tap your foot:** rerun with `--bpm-hint` set to the
  tempo you tap. The two tracks below that need it are listed with their hints.
- **The high click is not on beat 1 of the bar:** the downbeat is a guess from loudness, and a snare
  on beats 2 and 4 can win it. There is no flag for this; change which beats are listed in
  `downbeats` in the JSON by hand (keep every 4th beat).

## Tracks

Three tracks are in `tools/tracks/`. Sources, artists and licences are in
[`public/CREDITS.md`](../public/CREDITS.md).

| File | Licence | Command |
| --- | --- | --- |
| `kevin-macleod-past-sadness.mp3` (used in the game) | CC BY 4.0 | `--bpm-hint 72` |
| `loyalty-freak-music-dirty-shoes-blues.mp3` | CC0 | no hint needed |
| `tad-the-past-8-bit-lofi-hip-hop.mp3` | CC0 | `--bpm-hint 70` |

Audio and stems are committed only for CC0 and CC BY tracks, which all three are. A track under any
other licence must stay out of git: put it in `tools/tracks/private/` (ignored) and add its download
link to this section.

"Past Sadness" is mastered quietly: it peaks at -12 dBFS. Its stems keep that level, so the game
can turn them up about 3x (+10 dB) without clipping.

## Tests

```powershell
tools\.venv\Scripts\python.exe -m pytest tools
```

The tests build 72 BPM click tracks, run the script on them, and check that the BPM is within 1 and
every beat is within 20 ms of a real click. They take about 10 seconds and never run Demucs.
