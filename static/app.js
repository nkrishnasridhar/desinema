const form = document.getElementById("search-form");
const queryInput = document.getElementById("query");
const languageSelect = document.getElementById("language");
const searchButton = form.querySelector("button[type='submit']");
const statusEl = document.getElementById("status");
const resultsEl = document.getElementById("results");
const moreResultsEl = document.getElementById("more-results");
const moreMatchesButton = document.getElementById("more-matches");
const playerPanel = document.getElementById("player-panel");
const nowPlaying = document.getElementById("now-playing");
const player = document.getElementById("player");

let currentMovie = null;
let usingProxy = false;
let lastResults = [];

function cdnUrl(movieId) {
  return `https://cdn2.einthusan.io/etv/content/D${movieId}.mp4`;
}

function proxyUrl(movieId) {
  return `/api/stream/${encodeURIComponent(movieId)}`;
}

function movieLabel(movie) {
  return movie.year ? `${movie.title} (${movie.year})` : movie.title;
}

function setStatus(message, isError = false) {
  if (!message) {
    statusEl.hidden = true;
    statusEl.textContent = "";
    statusEl.classList.remove("error");
    return;
  }
  statusEl.hidden = false;
  statusEl.textContent = message;
  statusEl.classList.toggle("error", isError);
}

function resetPlayer() {
  currentMovie = null;
  usingProxy = false;
  player.pause();
  player.removeAttribute("src");
  player.load();
  playerPanel.hidden = true;
  nowPlaying.textContent = "Now playing";
}

function resetResults() {
  lastResults = [];
  resultsEl.replaceChildren();
  moreResultsEl.replaceChildren();
  moreResultsEl.hidden = true;
  moreMatchesButton.hidden = true;
  moreMatchesButton.setAttribute("aria-expanded", "false");
}

function highlightSelected(movieId) {
  for (const button of document.querySelectorAll(".result")) {
    button.classList.toggle("selected", button.dataset.id === movieId);
  }
}

function startPlayback(src) {
  player.src = src;
  const playPromise = player.play();
  if (playPromise) {
    playPromise.catch(() => {});
  }
}

function playMovie(movie) {
  currentMovie = movie;
  usingProxy = false;
  playerPanel.hidden = false;
  nowPlaying.textContent = movieLabel(movie);
  highlightSelected(movie.id);
  startPlayback(cdnUrl(movie.id));
}

function createResultButton(movie) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "result";
  button.dataset.id = movie.id;

  if (movie.poster) {
    const img = document.createElement("img");
    img.className = "poster";
    img.src = movie.poster;
    img.alt = "";
    button.append(img);
  }

  const meta = document.createElement("span");
  meta.className = "result-meta";
  const title = document.createElement("strong");
  title.textContent = movie.title;
  meta.append(title);
  if (movie.year) {
    const year = document.createElement("span");
    year.textContent = movie.year;
    meta.append(year);
  }
  button.append(meta);
  button.addEventListener("click", () => playMovie(movie));
  return button;
}

function renderResults(results) {
  resetResults();
  lastResults = results;
  if (results.length === 0) {
    return;
  }

  const bestItem = document.createElement("li");
  bestItem.append(createResultButton(results[0]));
  resultsEl.append(bestItem);

  if (results.length > 1) {
    moreMatchesButton.hidden = false;
    for (const movie of results.slice(1)) {
      const item = document.createElement("li");
      item.append(createResultButton(movie));
      moreResultsEl.append(item);
    }
  }
}

moreMatchesButton.addEventListener("click", () => {
  const expanding = moreResultsEl.hidden;
  moreResultsEl.hidden = !expanding;
  moreMatchesButton.setAttribute("aria-expanded", expanding ? "true" : "false");
  moreMatchesButton.textContent = expanding
    ? "Hide other matches"
    : "Wrong title? See other matches";
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const query = queryInput.value.trim();
  const lang = languageSelect.value;
  if (!query) {
    return;
  }

  searchButton.disabled = true;
  resetResults();
  resetPlayer();
  setStatus("Searching…");

  try {
    const params = new URLSearchParams({ q: query, lang });
    const response = await fetch(`/api/search?${params}`);
    let data = {};
    try {
      data = await response.json();
    } catch {
      data = {};
    }

    if (!response.ok) {
      setStatus(data.error || "Search failed.", true);
      return;
    }

    const results = data.results || [];
    if (results.length === 0) {
      setStatus("No movies found.", true);
      return;
    }

    const best = results[0];
    setStatus("");
    renderResults(results);
    playMovie(best);
  } catch {
    setStatus("Could not reach the search server.", true);
  } finally {
    searchButton.disabled = false;
  }
});

player.addEventListener("error", () => {
  if (!currentMovie || !player.src) {
    return;
  }
  if (!usingProxy) {
    usingProxy = true;
    startPlayback(proxyUrl(currentMovie.id));
    return;
  }
  setStatus("Video failed to load.", true);
});
