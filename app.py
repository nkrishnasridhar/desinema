import re
from urllib.parse import urljoin

import requests
from bs4 import BeautifulSoup
from flask import Flask, jsonify, render_template, request

app = Flask(__name__)

LANGUAGES = [
    "hindi",
    "tamil",
    "telugu",
    "malayalam",
    "kannada",
    "bengali",
    "punjabi",
    "marathi",
]

EINTHUSAN_ORIGIN = "https://einthusan.tv"
SEARCH_URL = f"{EINTHUSAN_ORIGIN}/movie/results/"
WATCH_ID_RE = re.compile(r"/movie/watch/([A-Za-z0-9]+)/")
YEAR_RE = re.compile(r"\b((?:19|20)\d{2})\b")
REQUEST_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/131.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": f"{EINTHUSAN_ORIGIN}/",
}


def absolute_url(src):
    if not src:
        return None
    if src.startswith("//"):
        return "https:" + src
    return urljoin(EINTHUSAN_ORIGIN + "/", src)


def parse_search_html(html):
    soup = BeautifulSoup(html, "html.parser")
    section = soup.select_one("#UIMovieSummary")
    if section is None:
        raise ValueError("Search results HTML did not contain movie listings.")

    results = []
    seen = set()
    for item in section.select("li"):
        link = item.select_one('a[href*="/movie/watch/"]')
        if not link or not link.get("href"):
            continue
        match = WATCH_ID_RE.search(link["href"])
        if not match:
            continue
        movie_id = match.group(1)
        if movie_id in seen:
            continue
        seen.add(movie_id)

        title_el = item.select_one("a.title h3") or item.select_one("h3")
        title = title_el.get_text(strip=True) if title_el else movie_id

        year = None
        info = item.select_one(".info p")
        if info:
            year_match = YEAR_RE.search(info.get_text(" ", strip=True))
            if year_match:
                year = year_match.group(1)

        poster_el = item.select_one(".block1 img") or item.select_one("img")
        poster = absolute_url(poster_el.get("src") if poster_el else None)

        results.append(
            {
                "id": movie_id,
                "title": title,
                "year": year,
                "poster": poster,
            }
        )
    return results


def fetch_search_results(query, lang):
    response = requests.get(
        SEARCH_URL,
        params={"lang": lang, "query": query},
        headers=REQUEST_HEADERS,
        timeout=20,
    )
    response.raise_for_status()
    html = response.text
    if not html.strip():
        raise ValueError("Einthusan returned an empty search page.")
    return parse_search_html(html)


@app.route("/")
def index():
    return render_template("index.html", languages=LANGUAGES)


@app.route("/api/search")
def search():
    query = (request.args.get("q") or "").strip()
    lang = (request.args.get("lang") or "").strip().lower()

    if not query:
        return jsonify({"results": [], "error": "Missing search query."}), 400
    if lang not in LANGUAGES:
        return jsonify({"results": [], "error": "Unsupported language."}), 400

    try:
        results = fetch_search_results(query, lang)
    except requests.RequestException:
        return jsonify({"results": [], "error": "Failed to reach Einthusan search."}), 502
    except ValueError as exc:
        return jsonify({"results": [], "error": str(exc)}), 502

    return jsonify({"results": results})


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5000, debug=True)
