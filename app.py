import os
import re
from concurrent.futures import ThreadPoolExecutor, as_completed
from difflib import SequenceMatcher
from pathlib import Path
from urllib.parse import quote, urljoin

import requests
from bs4 import BeautifulSoup
from dotenv import load_dotenv
from flask import Flask, Response, jsonify, render_template, request, stream_with_context

load_dotenv(Path(__file__).resolve().parent / ".env")

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
UNSAFE_FILENAME_RE = re.compile(r'[\\/:*?"<>|\r\n]+')
DOUBLE_VOWEL_RE = re.compile(r"([aeiou])\1", re.IGNORECASE)
CDN_HOSTS = ("cdn2.einthusan.io", "cdn1.einthusan.io", "cdn3.einthusan.io")
FORWARD_STREAM_HEADERS = {
    "content-type",
    "content-length",
    "content-range",
    "accept-ranges",
}
_cdn_url_cache = {}
_tmdb_poster_cache = {}
TMDB_SEARCH_URL = "https://api.themoviedb.org/3/search/movie"
TMDB_DISCOVER_URL = "https://api.themoviedb.org/3/discover/movie"
TMDB_MOVIE_IMAGES_URL = "https://api.themoviedb.org/3/movie/{movie_id}/images"
TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p/w500"
TMDB_TIMEOUT = 4
TMDB_WORKERS = 6
TMDB_YEAR_MATCH_MIN_SCORE = 70.0
TMDB_NO_YEAR_MIN_SCORE = 95.0
TMDB_ORIGINAL_LANGUAGE = {
    "tamil": "ta",
    "hindi": "hi",
    "telugu": "te",
    "malayalam": "ml",
    "kannada": "kn",
    "bengali": "bn",
    "marathi": "mr",
    "punjabi": "pa",
}
TMDB_POSTER_LANGUAGES = tuple(TMDB_ORIGINAL_LANGUAGE.values())
TMDB_READ_TOKEN = (os.environ.get("TMDB_API_READ_ACCESS_TOKEN") or "").strip()
TMDB_API_KEY = (os.environ.get("TMDB_API_KEY") or "").strip()
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


RATING_KEYS = ("action", "comedy", "romance", "storyline", "performance")
PTYPES = ("view", "comment", "rating")
NAMED_TP = (
    "alltime",
    "td",
    "yd",
    "tw",
    "tm",
    "ty",
    "lw",
    "lm",
    "ly",
)
LAST_N_TP_RE = re.compile(r"^l([1-9]\d*)([dmy])$")
MONTH_TP_RE = re.compile(
    r"^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)-\d{4}$"
)


def absolute_url(src):
    if not src:
        return None
    if src.startswith("//"):
        return "https:" + src
    return urljoin(EINTHUSAN_ORIGIN + "/", src)


def parse_average_ratings(item):
    ratings = {}
    for row in item.select("ul.average-rating li"):
        label_el = row.select_one("label")
        if label_el is None:
            continue
        key = label_el.get_text(strip=True).lower()
        if key not in RATING_KEYS:
            continue
        value_el = row.select_one("p")
        if value_el is None:
            continue
        raw = (value_el.get("data-value") or value_el.get_text(strip=True) or "").strip()
        try:
            ratings[key] = round(float(raw), 1)
        except ValueError:
            continue
    return ratings or None


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

    movie = {
        "id": match.group(1),
        "title": title,
        "year": year,
        "poster": poster,
    }
    ratings = parse_average_ratings(item)
    if ratings:
        movie["ratings"] = ratings
    return movie


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


def collapse_double_vowels(value):
    return DOUBLE_VOWEL_RE.sub(r"\1", value or "")


def translit_key(value):
    return collapse_double_vowels(normalize_title(value))


def colon_prefix(title):
    if ":" not in (title or ""):
        return None
    left, right = title.split(":", 1)
    left = left.strip()
    compact = normalize_title(left)
    if len(compact) < 2:
        return None
    right_tokens = re.findall(r"[A-Za-z0-9]+", right)
    initials = "".join(token[0] for token in right_tokens).lower() if right_tokens else ""
    if initials and compact == initials:
        return left
    letters = re.sub(r"[^A-Za-z]", "", left)
    if letters and letters.isupper() and " " not in left and 2 <= len(compact) <= 8:
        return left
    return None


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


def tmdb_configured():
    return bool(TMDB_READ_TOKEN or TMDB_API_KEY)


def tmdb_poster_url(poster_path):
    if not poster_path:
        return None
    if not str(poster_path).startswith("/"):
        poster_path = "/" + str(poster_path)
    return TMDB_IMAGE_BASE + poster_path


def tmdb_auth():
    headers = {}
    params = {}
    if TMDB_READ_TOKEN:
        headers["Authorization"] = f"Bearer {TMDB_READ_TOKEN}"
    elif TMDB_API_KEY:
        params["api_key"] = TMDB_API_KEY
    return headers, params


def tmdb_get(url, extra_params=None):
    headers, params = tmdb_auth()
    if extra_params:
        params = {**params, **extra_params}
    response = requests.get(url, params=params, headers=headers, timeout=TMDB_TIMEOUT)
    response.raise_for_status()
    return response.json()


def tmdb_release_year(hit):
    date = (hit.get("release_date") or "").strip()
    if len(date) >= 4 and date[:4].isdigit():
        return int(date[:4])
    return None


def tmdb_title_score(query_title, hit):
    titles = (hit.get("title") or "", hit.get("original_title") or "")
    score = max(title_match_score(query_title, title) for title in titles)
    query_key = translit_key(query_title)
    query_norm = normalize_title(query_title)
    if not query_key or not query_norm:
        return score

    for title in titles:
        if translit_key(title) != query_key:
            continue
        ratio = SequenceMatcher(None, query_norm, normalize_title(title)).ratio()
        if ratio >= 0.88:
            score = max(score, 90.0)
            break

    prefix = colon_prefix(query_title)
    prefix_norm = normalize_title(prefix) if prefix else ""
    if prefix_norm:
        for title in titles:
            if prefix_norm == normalize_title(title):
                score = max(score, 96.0)
                break
    return score


def tmdb_search_queries(title):
    queries = []
    seen = set()

    def add(query):
        query = " ".join((query or "").split())
        key = query.lower()
        if query and key not in seen:
            seen.add(key)
            queries.append(query)

    add(title)
    add(colon_prefix(title))
    tokens = re.findall(r"[A-Za-z0-9]+", title or "")
    if tokens:
        add(" ".join(tokens[:-1] + [collapse_double_vowels(tokens[-1])]))
        add(" ".join(collapse_double_vowels(token) for token in tokens))
    return queries


def search_tmdb_movies(title):
    seen_ids = set()
    hits = []
    for query in tmdb_search_queries(title):
        payload = tmdb_get(
            TMDB_SEARCH_URL,
            {
                "query": query,
                "include_adult": "false",
                "language": "en-US",
                "region": "IN",
            },
        )
        batch = payload.get("results") or []
        if not batch:
            continue
        for hit in batch:
            movie_id = hit.get("id")
            if movie_id in seen_ids:
                continue
            seen_ids.add(movie_id)
            hits.append(hit)
        if hits:
            break
    return hits


def discover_tmdb_movies(lang, year=None, any_language=False):
    params = {
        "include_adult": "false",
        "include_video": "false",
        "language": "en-US",
        "page": 1,
        "region": "IN",
        "sort_by": "popularity.desc",
        "with_origin_country": "IN",
    }
    language_code = TMDB_ORIGINAL_LANGUAGE.get(lang)
    if language_code and not any_language:
        params["with_original_language"] = language_code
    if year:
        try:
            params["primary_release_year"] = int(year)
        except (TypeError, ValueError):
            pass
    payload = tmdb_get(TMDB_DISCOVER_URL, params)
    return payload.get("results") or []


def fetch_tmdb_movie_posters(movie_id):
    payload = tmdb_get(
        TMDB_MOVIE_IMAGES_URL.format(movie_id=movie_id),
        {"include_image_language": ",".join(("null",) + TMDB_POSTER_LANGUAGES)},
    )
    return payload.get("posters") or []


def is_two_by_three(width, height):
    try:
        width = int(width)
        height = int(height)
    except (TypeError, ValueError):
        return False
    if width <= 0 or height <= 0:
        return False
    return abs((width / height) - (2 / 3)) <= 0.02


def is_usable_poster(poster, require_language):
    path = poster.get("file_path")
    if not path or not is_two_by_three(poster.get("width"), poster.get("height")):
        return False
    iso_code = poster.get("iso_639_1")
    if require_language:
        return iso_code in TMDB_POSTER_LANGUAGES
    return not iso_code


def first_two_by_three_poster_path(posters):
    for poster in posters:
        if is_usable_poster(poster, require_language=True):
            return poster.get("file_path")
    for poster in posters:
        if is_usable_poster(poster, require_language=False):
            return poster.get("file_path")
    return None


def best_poster_url(movie_id, fallback_path):
    if movie_id:
        try:
            path = first_two_by_three_poster_path(fetch_tmdb_movie_posters(movie_id))
            if path:
                return tmdb_poster_url(path)
        except (requests.RequestException, ValueError, TypeError, KeyError):
            pass
    return tmdb_poster_url(fallback_path)


def language_matches(hits, lang):
    code = TMDB_ORIGINAL_LANGUAGE.get(lang)
    if not code:
        return []
    return [hit for hit in hits if (hit.get("original_language") or "") == code]


def indian_language_hits(hits):
    return [
        hit
        for hit in hits
        if (hit.get("original_language") or "") in TMDB_POSTER_LANGUAGES
    ]


def filter_by_year(hits, year):
    try:
        year_int = int(year)
    except (TypeError, ValueError):
        return hits

    exact = []
    near = []
    for hit in hits:
        release_year = tmdb_release_year(hit)
        if release_year is None:
            continue
        if release_year == year_int:
            exact.append(hit)
        elif abs(release_year - year_int) == 1:
            near.append(hit)

    if exact:
        return exact
    if len(near) == 1:
        return near
    return []


def best_scored_hit(query_title, hits, min_score):
    best = None
    best_score = None
    for hit in hits:
        score = tmdb_title_score(query_title, hit)
        if score < min_score:
            continue
        popularity = hit.get("popularity") or 0
        if (
            best is None
            or score > best_score
            or (score == best_score and popularity > (best.get("popularity") or 0))
        ):
            best = hit
            best_score = score
    return best


def select_tmdb_hit(title, hits, lang, year, min_score):
    candidates = language_matches(hits, lang)
    if year:
        candidates = filter_by_year(candidates, year)
    return best_scored_hit(title, candidates, min_score)


def choose_tmdb_hit(title, hits, lang, year):
    chosen = select_tmdb_hit(title, hits, lang, year, TMDB_YEAR_MATCH_MIN_SCORE)
    if chosen is None:
        chosen = select_tmdb_hit(title, hits, lang, None, TMDB_NO_YEAR_MIN_SCORE)
    if chosen is None and year:
        chosen = best_scored_hit(
            title,
            filter_by_year(indian_language_hits(hits), year),
            TMDB_NO_YEAR_MIN_SCORE,
        )
    return chosen


def pick_tmdb_poster(title, year, lang):
    if not title:
        return None

    chosen = choose_tmdb_hit(title, search_tmdb_movies(title), lang, year)
    if chosen is None:
        chosen = choose_tmdb_hit(title, discover_tmdb_movies(lang, year), lang, year)
    if chosen is None and year:
        chosen = choose_tmdb_hit(
            title, discover_tmdb_movies(lang, year, any_language=True), lang, year
        )

    if chosen is None:
        return None
    return best_poster_url(chosen.get("id"), chosen.get("poster_path"))


def tmdb_cache_key(title, year, lang):
    return (normalize_title(title), str(year or ""), lang)


def lookup_tmdb_poster(title, year, lang):
    key = tmdb_cache_key(title, year, lang)
    if key in _tmdb_poster_cache:
        return _tmdb_poster_cache[key]

    url = None
    try:
        url = pick_tmdb_poster(title, year, lang)
    except (requests.RequestException, ValueError, TypeError, KeyError):
        url = None

    _tmdb_poster_cache[key] = url
    return url


def apply_tmdb_poster(movie, lang):
    einthusan = movie.get("poster")
    tmdb_url = lookup_tmdb_poster(movie.get("title"), movie.get("year"), lang)
    if tmdb_url:
        movie["poster"] = tmdb_url
        movie["poster_fallback"] = einthusan
    else:
        movie["poster_fallback"] = None
    return movie


def enrich_movie_posters(movies, lang):
    if not movies or not tmdb_configured():
        return movies

    with ThreadPoolExecutor(max_workers=TMDB_WORKERS) as executor:
        futures = [executor.submit(apply_tmdb_poster, movie, lang) for movie in movies]
        for future in as_completed(futures):
            try:
                future.result()
            except Exception:
                continue
    return movies


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


def fetch_popularity_results(lang, ptype, tp, page):
    html = fetch_html(
        RESULTS_URL,
        {
            "lang": lang,
            "find": "Popularity",
            "ptype": ptype,
            "tp": tp,
            "page": page,
        },
        "Einthusan returned an empty popularity page.",
    )
    try:
        return parse_movie_list_html(
            html, "Popularity results HTML did not contain movie listings."
        )
    except ValueError:
        # Unsupported/empty tp values (e.g. arbitrary l7d) often omit the list section.
        return [], False


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


def parse_ptype():
    ptype = (request.args.get("ptype") or "view").strip().lower()
    if ptype not in PTYPES:
        return None
    return ptype


def parse_tp():
    tp = (request.args.get("tp") or "alltime").strip()
    if tp in NAMED_TP or LAST_N_TP_RE.fullmatch(tp) or MONTH_TP_RE.fullmatch(tp):
        return tp
    return None


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

    enrich_movie_posters(results, lang)
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

    enrich_movie_posters(results, lang)
    return jsonify(
        {
            "results": results,
            "page": page,
            "has_next": has_next,
            "has_prev": page > 1,
        }
    )


@app.route("/api/top")
def top():
    lang = parse_language()
    ptype = parse_ptype()
    tp = parse_tp()
    page_raw = (request.args.get("page") or "1").strip()
    try:
        page = int(page_raw)
    except ValueError:
        return jsonify({"results": [], "error": "Invalid page."}), 400

    if lang is None:
        return jsonify({"results": [], "error": "Unsupported language."}), 400
    if ptype is None:
        return jsonify({"results": [], "error": "Invalid popularity type."}), 400
    if tp is None:
        return jsonify({"results": [], "error": "Invalid time period."}), 400
    if page < 1:
        return jsonify({"results": [], "error": "Invalid page."}), 400

    try:
        results, has_next = fetch_popularity_results(lang, ptype, tp, page)
    except requests.RequestException:
        return jsonify({"results": [], "error": "Failed to reach Einthusan popularity."}), 502
    except ValueError as exc:
        return jsonify({"results": [], "error": str(exc)}), 502

    enrich_movie_posters(results, lang)
    return jsonify(
        {
            "results": results,
            "page": page,
            "has_next": has_next,
            "has_prev": page > 1,
            "ptype": ptype,
            "tp": tp,
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

    enrich_movie_posters(results, lang)
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
    if request.args.get("download") == "1":
        raw_name = UNSAFE_FILENAME_RE.sub("", (request.args.get("filename") or "").strip()).strip(" .")
        if not raw_name:
            raw_name = f"D{movie_id}"
        if not raw_name.lower().endswith(".mp4"):
            raw_name = f"{raw_name}.mp4"
        ascii_name = raw_name.encode("ascii", "ignore").decode("ascii").strip(" .") or f"D{movie_id}.mp4"
        if not ascii_name.lower().endswith(".mp4"):
            ascii_name = f"{ascii_name}.mp4"
        response_headers["Content-Disposition"] = (
            f'attachment; filename="{ascii_name}"; filename*=UTF-8\'\'{quote(raw_name)}'
        )

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
