# DeSinema

A local web app for searching and playing Indian movies.

Search and playback information is retrieved from Einthusan. Movie posters are matched against TMDB, with the source image used as a fallback when no confident TMDB match is available.

## Run locally

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python app.py
```

Copy `.env.example` to `.env` and add a TMDB Read Access Token (preferred) or API key:

```
TMDB_API_READ_ACCESS_TOKEN=
TMDB_API_KEY=
```

The app still works without these values; posters stay on Einthusan.

Open http://127.0.0.1:5000

On Windows, after creating `.venv` and installing the requirements once, you can start the app with:

```cmd
start-desinema.bat
```

This activates the local virtual environment, starts Flask, and opens the app in your browser.

## Disclaimer

DeSinema is an independent personal project and is not affiliated with, endorsed by, or associated with Einthusan or TMDB.

The application does not host movie files. Playback uses media hosted by third-party services. Users are responsible for ensuring their use complies with the applicable services' terms and laws.
