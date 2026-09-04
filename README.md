# Personal Einthusan Player

Local web app: search an Indian movie by title and language, then play it in the browser.

Posters prefer The Movie Database (TMDB) when a confident title, year, and language match is found. The scraped Einthusan image is kept as the fallback if TMDB has no match or the image fails to load.

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
