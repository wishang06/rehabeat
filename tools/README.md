# Rehabeat music tools

`make_beatmap.py` turns an audio file into `public/beatmap.json`, the beat grid the game plays against.
It can also write a click-track check file and split the song into drum and melody stems.

## Setup (Windows 11, PowerShell)

Run everything from the repo root.

1. **Python 3.11.** Check with `py -3.11 --version`. If it is missing: `winget install Python.Python.3.11`.
2. **ffmpeg** must be on `PATH` (Demucs uses it to read audio). Check with `ffmpeg -version`.
   If it is missing: `winget install Gyan.FFmpeg`, then open a new terminal.
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
