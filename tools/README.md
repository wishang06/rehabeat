# Rehabeat music tools

The game's songs live in `public/songs/<id>/`, one folder per song, listed in
`public/songs/index.json`. `npm run songs` adds, lists, previews, moves and removes them. It drives
`make_beatmap.py`, which finds the beat grid and splits the song into drum and melody stems.

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
   of PyTorch, which is all Demucs needs here. `requirements.txt` already includes Demucs;
   `requirements-stems.txt` just includes `requirements.txt`, for older install instructions.

The commands below call `tools\.venv\Scripts\python.exe` directly, so you never need to activate the
environment. If you prefer to activate it, run `tools\.venv\Scripts\Activate.ps1`; if PowerShell blocks
the script, run `Set-ExecutionPolicy -Scope Process RemoteSigned` first.

The first `--stems` run downloads the Demucs model (80 MB) into `%USERPROFILE%\.cache\torch`.

`npm run songs` finds this venv by itself. To use another Python, set `REHABEAT_PYTHON` or pass
`--python <path>`. It checks Python, librosa, Demucs and ffmpeg when it starts and prints the one-line
fix for anything missing.

## Add a song

Run it in a terminal (PowerShell or Git Bash):

```powershell
npm run songs
```

Pick **Add a song**. It asks one thing at a time; every answer has a default:

1. **File or URL.** Drag the file into the terminal, or paste its path or a direct link to the audio.
   Quotes and Git Bash paths (`/c/Users/...`) are cleaned up. A link is downloaded to `tools/out/downloads/`.
2. **Title and artist.** Filled in from the file's tags; edit if needed. The song's id (its folder name)
   comes from the title.
3. **Licence and source page.** Only CC0 1.0, CC BY 3.0, CC BY 4.0 and public domain are accepted:
   they let us share the audio and split it into stems. NonCommercial, NoDerivatives and ShareAlike are
   refused. The source page is where the licence is stated.
4. **Analysis.** Beat detection runs first (a few seconds) and shows the BPM, the beat count and the
   beat jitter. Outside 55 to 100 BPM it offers half or double speed. It then suggests a catalogue and a
   difficulty from the BPM:

   | Catalogue | BPM | Difficulty |
   | --- | --- | --- |
   | Calm Stretch | 55 to 70 | gentle |
   | Steady Flow | 70 to 85 | steady |
   | Active Rehab | 85 to 100 | active |

   A jitter of 10 ms or more means the grid is unsteady; it asks before going on.
5. **Stems.** Demucs splits the song, with a spinner, the elapsed time and an estimate. This is the slow
   step: 1 to 3 times the song's length on a laptop CPU. The stems are levelled so drums plus melody
   peak at -12 dBFS, which is what the game's fixed stem gain expects.
6. **Check.** It offers to play `check.wav`: the song with a click on every beat. Answer **Keep**,
   **Retry with BPM hint** (re-runs the analysis only) or **Discard**.
7. **Done.** It writes `public/songs/<id>/` (`meta.json`, `beatmap.json`, `drums.mp3`, `melody.mp3`),
   adds the song to `index.json`, regenerates the song list at the end of `public/CREDITS.md`, and
   prints the `git add` command to commit it.

The other menu items: **List songs** (catalogue, title, artist, BPM, jitter, licence), **Preview a
song** (10 s of the melody stem through ffplay), **Remove a song** and **Move to another catalogue**.

### Without the menu

Every step also works from flags, for scripts and agents. With `--yes` nothing is asked and the
audible check is skipped (the check file's path is printed instead):

```powershell
npm run songs -- add "https://incompetech.com/music/royalty-free/mp3-royaltyfree/Wallpaper.mp3" `
  --title "Wallpaper" --artist "Kevin MacLeod" --licence "CC BY 4.0" `
  --source-url "https://incompetech.com/music/royalty-free/index.html?isrc=USUAN1100843" --yes
npm run songs -- list
npm run songs -- preview wallpaper
npm run songs -- move wallpaper steady-flow
npm run songs -- remove wallpaper --yes
npm run songs -- help
```

Other add options: `--id`, `--catalogue`, `--difficulty`, `--bpm-hint N`, `--max-jitter MS` (with
`--yes`, refuse a grid this unsteady; default 10) and `--keep-source` (also copy the source audio to
`tools/tracks/`). In PowerShell, `npm run songs -- --help` shows npm's own help; use `help`.

`meta.json` holds `id`, `title`, `artist`, `licence` (`CC0-1.0`, `CC-BY-3.0`, `CC-BY-4.0` or `PD`),
`sourceUrl`, `creditLine`, `bpm`, `durationSec`, `catalogue` and `difficulty`. The credit line is what
the game shows while the song plays, for example:

```
"Past Sadness" by Kevin MacLeod (incompetech.com), CC BY 4.0. Separated into drum and melody stems by the Rehabeat team.
```

### Tests

```powershell
tools\.venv\Scripts\python.exe -m pytest tools   # beat tracking and the pipeline commands
npm test                                         # includes the CLI's unit tests
npm run test:songs                               # adds a generated 72 BPM click track end to end, Demucs included (1 to 2 min)
```

## Make a beatmap by hand

`npm run songs` is the normal way in. `make_beatmap.py` is the script underneath, for checking a
track before adding it. It writes to `tools/out/` and does not touch the game's songs.

This is the command that originally produced the Past Sadness files, now in `public/songs/past-sadness/`:

```powershell
tools\.venv\Scripts\python.exe tools\make_beatmap.py tools\tracks\kevin-macleod-past-sadness.mp3 --bpm-hint 72 --click --stems
```

| Flag | What it does |
| --- | --- |
| `--bpm-hint N` | Rough tempo. Use it when the grid comes out at double or half speed. It only moves the result by factors of two, so the song's real tempo is kept. |
| `--click` | Also writes `tools/out/check.wav`: the song with a click on every beat, higher and louder on downbeats. |
| `--stems` | Also runs Demucs and writes `tools/out/stems/drums.mp3` and `tools/out/stems/melody.mp3` (everything except the drums). |
| `--out PATH` | Write the beatmap somewhere other than `tools/out/beatmap.json`. |

The script prints the BPM, the number of beats, and the mean and standard deviation of the gap
between beats. The standard deviation is the beat jitter: a few ms means a steady grid.

`--stems` is slow because Demucs runs on the CPU here. For this 3.5-minute song it took between
2.5 and 10 minutes across runs on this laptop. The script prints the time Demucs took.

### `beatmap.json`

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

### How the game uses the files

Vite serves `public/` at the site root, so for a song with id `<id>` the game fetches
`/songs/<id>/beatmap.json`, `/songs/<id>/drums.mp3` and `/songs/<id>/melody.mp3`.

- It reads `bpm`, `offset` and `beats`. The song menu also uses `downbeats` to start previews on a bar.
- The drums always play and the melody fades in while the player holds the pose well.
- The stems loop at the end of the last full beat, not at the end of the file, so the grid stays even.

## Check the grid by ear

Play `tools/out/check.wav` after a `--click` run.

- **Clicks twice as fast or half as fast as you tap your foot:** rerun with `--bpm-hint` set to the
  tempo you tap. The two tracks below that need it are listed with their hints.
- **The high click is not on beat 1 of the bar:** the downbeat is a guess from loudness, and a snare
  on beats 2 and 4 can win it. There is no flag for this; change which beats are listed in
  `downbeats` in the JSON by hand (keep every 4th beat).

## Tracks

The songs in the game are listed by `npm run songs -- list` and in the generated section of
[`public/CREDITS.md`](../public/CREDITS.md). The source audio of a song added from a link is not kept
in git (use `--keep-source` to keep it); its `sourceUrl` says where to get it again.

Three source tracks are in `tools/tracks/`. Sources, artists and licences are in `public/CREDITS.md`.

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
