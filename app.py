import re
from urllib.parse import urljoin

import requests
from bs4 import BeautifulSoup
from flask import Flask, Response, jsonify, render_template, request, stream_with_context

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
MOVIE_ID_RE = re.compile(r"^[A-Za-z0-9]+$")
YEAR_RE = re.compile(r"\b((?:19|20)\d{2})\b")
CDN_HOSTS = ("cdn2.einthusan.io", "cdn1.einthusan.io", "cdn3.einthusan.io")
FORWARD_STREAM_HEADERS = {
    "content-type",
    "content-length",
    "content-range",
    "accept-ranges",
}
_cdn_url_cache = {}
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


def cdn_mp4_url(host, movie_id):
    return f"https://{host}/etv/content/D{movie_id}.mp4"


def iter_cdn_urls(movie_id):
    cached = _cdn_url_cache.get(movie_id)
    if cached:
        yield cached
    for host in CDN_HOSTS:
        url = cdn_mp4_url(host, movie_id)
        if url != cached:
            yield url


def open_cdn_stream(movie_id, range_header):
    headers_base = {
        "User-Agent": REQUEST_HEADERS["User-Agent"],
        "Referer": f"{EINTHUSAN_ORIGIN}/",
        "Accept": "*/*",
    }
    last_response = None
    for url in iter_cdn_urls(movie_id):
        headers = dict(headers_base)
        if range_header:
            headers["Range"] = range_header
        try:
            response = requests.get(
                url,
                headers=headers,
                stream=True,
                timeout=(10, 60),
            )
        except requests.RequestException:
            continue
        if response.status_code in (200, 206, 416):
            if response.status_code in (200, 206):
                _cdn_url_cache[movie_id] = url
            return response
        last_response = response
        response.close()
    if last_response is not None:
        return last_response
    raise requests.RequestException("Failed to reach the video CDN.")


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


@app.route("/api/stream/<movie_id>")
def stream_movie(movie_id):
    if not MOVIE_ID_RE.fullmatch(movie_id):
        return jsonify({"error": "Invalid movie id."}), 400

    try:
        upstream = open_cdn_stream(movie_id, request.headers.get("Range"))
    except requests.RequestException:
        return jsonify({"error": "Failed to reach the video CDN."}), 502

    if upstream.status_code not in (200, 206, 416):
        upstream.close()
        return jsonify({"error": "Video file was not found on the CDN."}), 404

    response_headers = {}
    for key, value in upstream.headers.items():
        if key.lower() in FORWARD_STREAM_HEADERS:
            response_headers[key] = value
    lower_keys = {key.lower() for key in response_headers}
    if "accept-ranges" not in lower_keys:
        response_headers["Accept-Ranges"] = "bytes"
    if "content-type" not in lower_keys:
        response_headers["Content-Type"] = "video/mp4"

    def generate():
        try:
            for chunk in upstream.iter_content(chunk_size=256 * 1024):
                if chunk:
                    yield chunk
        finally:
            upstream.close()

    return Response(
        stream_with_context(generate()),
        status=upstream.status_code,
        headers=response_headers,
    )


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5000, debug=True, threaded=True)
