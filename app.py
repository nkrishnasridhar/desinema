import re
from difflib import SequenceMatcher
from urllib.parse import urljoin

import requests
from bs4 import BeautifulSoup
from flask import Flask, Response, jsonify, render_template, request, stream_with_context

app = Flask(__name__)

LANGUAGES = [
    "tamil",
    "hindi",
    "telugu",
    "malayalam",
    "kannada",
    "bengali",
    "marathi",
    "punjabi",
]

EINTHUSAN_ORIGIN = "https://einthusan.tv"
RESULTS_URL = f"{EINTHUSAN_ORIGIN}/movie/results/"
BROWSE_URL = f"{EINTHUSAN_ORIGIN}/movie/browse/"
FEATURED_LIMIT = 7
WATCH_ID_RE = re.compile(r"/movie/watch/([A-Za-z0-9]+)/")
MOVIE_ID_RE = re.compile(r"^[A-Za-z0-9]+$")
YEAR_RE = re.compile(r"\b((?:19|20)\d{2})\b")
CDN_HOSTS = ("cdn2.einthusan.io",)
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


def movie_from_item(item):
    link = item.select_one('a[href*="/movie/watch/"]')
    if not link or not link.get("href"):
        return None
    match = WATCH_ID_RE.search(link["href"])
    if not match:
        return None

    title_el = (
        item.select_one("a.title h3")
        or item.select_one("a.title h2")
        or item.select_one("h3")
        or item.select_one("h2")
    )
    title = title_el.get_text(strip=True) if title_el else match.group(1)

    year = None
    info = item.select_one(".info p")
    if info:
        year_match = YEAR_RE.search(info.get_text(" ", strip=True))
        if year_match:
            year = year_match.group(1)

    poster_el = item.select_one(".block1 img") or item.select_one("img")
    poster = absolute_url(poster_el.get("src") if poster_el else None)

    return {
        "id": match.group(1),
        "title": title,
        "year": year,
        "poster": poster,
    }


def parse_has_next_page(soup):
    pagination = soup.select_one(".pagination")
    if pagination is None:
        return False
    controls = pagination.select("[data-disabled][href]")
    if not controls:
        return False
    disabled = (controls[-1].get("data-disabled") or "").strip().lower()
    return disabled != "true"


def parse_movie_list_html(html, missing_message):
    soup = BeautifulSoup(html, "html.parser")
    section = soup.select_one("#UIMovieSummary")
    if section is None:
        raise ValueError(missing_message)

    results = []
    seen = set()
    for item in section.select("li"):
        movie = movie_from_item(item)
        if not movie or movie["id"] in seen:
            continue
        seen.add(movie["id"])
        results.append(movie)
    return results, parse_has_next_page(soup)


def parse_featured_html(html):
    soup = BeautifulSoup(html, "html.parser")
    section = soup.select_one("#UIFeaturedFilms")
    if section is None:
        raise ValueError("Browse page did not contain featured movies.")

    results = []
    seen = set()
    for radio in section.select('input[name="newrelease_tab"]'):
        view = radio.find_next("div", class_="tabview")
        if view is None:
            continue
        movie = movie_from_item(view)
        if not movie or movie["id"] in seen:
            continue
        seen.add(movie["id"])
        results.append(movie)
        if len(results) >= FEATURED_LIMIT:
            break

    if not results:
        raise ValueError("Browse page did not contain featured movies.")
    return results


def normalize_title(value):
    return re.sub(r"[^a-z0-9]+", "", (value or "").lower())


def title_match_score(query, title):
    """Higher is better. Prefers exact titles over near-misses like Don vs Dono."""
    q = (query or "").strip().lower()
    t = (title or "").strip().lower()
    qn = normalize_title(q)
    tn = normalize_title(t)
    if not qn or not tn:
        return 0.0

    if qn == tn:
        return 100.0

    tokens = re.findall(r"[a-z0-9]+", t)
    if qn in tokens:
        return 95.0 - abs(len(tn) - len(qn)) * 0.01

    if tn.startswith(qn):
        return 80.0 - (len(tn) - len(qn))

    if qn.startswith(tn) and len(tn) >= 3:
        return 70.0 - (len(qn) - len(tn))

    ratio = SequenceMatcher(None, qn, tn).ratio()
    return ratio * 60.0


def rank_results(results, query):
    return sorted(
        results,
        key=lambda movie: (
            title_match_score(query, movie.get("title", "")),
            -(int(movie["year"]) if movie.get("year") and str(movie["year"]).isdigit() else 0),
        ),
        reverse=True,
    )


def fetch_html(url, params, empty_message):
    response = requests.get(
        url,
        params=params,
        headers=REQUEST_HEADERS,
        timeout=20,
    )
    response.raise_for_status()
    html = response.text
    if not html.strip():
        raise ValueError(empty_message)
    return html


def fetch_search_results(query, lang):
    html = fetch_html(
        RESULTS_URL,
        {"lang": lang, "query": query},
        "Einthusan returned an empty search page.",
    )
    results, _has_next = parse_movie_list_html(
        html, "Search results HTML did not contain movie listings."
    )
    return rank_results(results, query)


def fetch_latest_results(lang, page):
    html = fetch_html(
        RESULTS_URL,
        {"lang": lang, "find": "Recent", "page": page},
        "Einthusan returned an empty latest page.",
    )
    return parse_movie_list_html(
        html, "Latest results HTML did not contain movie listings."
    )


def fetch_featured_results(lang):
    html = fetch_html(
        BROWSE_URL,
        {"lang": lang},
        "Einthusan returned an empty browse page.",
    )
    return parse_featured_html(html)


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


def parse_language():
    lang = (request.args.get("lang") or "").strip().lower()
    if lang not in LANGUAGES:
        return None
    return lang


@app.route("/")
def index():
    return render_template("index.html", languages=LANGUAGES)


@app.route("/api/featured")
def featured():
    lang = parse_language()
    if lang is None:
        return jsonify({"results": [], "error": "Unsupported language."}), 400

    try:
        results = fetch_featured_results(lang)
    except requests.RequestException:
        return jsonify({"results": [], "error": "Failed to reach Einthusan browse."}), 502
    except ValueError as exc:
        return jsonify({"results": [], "error": str(exc)}), 502

    return jsonify({"results": results})


@app.route("/api/latest")
def latest():
    lang = parse_language()
    page_raw = (request.args.get("page") or "1").strip()
    try:
        page = int(page_raw)
    except ValueError:
        return jsonify({"results": [], "error": "Invalid page."}), 400

    if lang is None:
        return jsonify({"results": [], "error": "Unsupported language."}), 400
    if page < 1:
        return jsonify({"results": [], "error": "Invalid page."}), 400

    try:
        results, has_next = fetch_latest_results(lang, page)
    except requests.RequestException:
        return jsonify({"results": [], "error": "Failed to reach Einthusan latest."}), 502
    except ValueError as exc:
        return jsonify({"results": [], "error": str(exc)}), 502

    return jsonify(
        {
            "results": results,
            "page": page,
            "has_next": has_next,
            "has_prev": page > 1,
        }
    )


@app.route("/api/search")
def search():
    query = (request.args.get("q") or "").strip()
    lang = parse_language()

    if not query:
        return jsonify({"results": [], "error": "Missing search query."}), 400
    if lang is None:
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
