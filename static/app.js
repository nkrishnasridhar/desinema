const form = document.getElementById("search-form");
const queryInput = document.getElementById("query");
const languageSelect = document.getElementById("language");
const searchButton = form.querySelector("button[type='submit']");
const statusEl = document.getElementById("status");
const resultsEl = document.getElementById("results");
const playerPanel = document.getElementById("player-panel");
const nowPlaying = document.getElementById("now-playing");
const player = document.getElementById("player");

function cdnUrl(movieId) {
  return `https://cdn2.einthusan.io/etv/content/D${movieId}.mp4`;
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
  player.pause();
  player.removeAttribute("src");
  player.load();
  playerPanel.hidden = true;
  nowPlaying.textContent = "Now playing";
}

function highlightSelected(movieId) {
  for (const button of resultsEl.querySelectorAll(".result")) {
    button.classList.toggle("selected", button.dataset.id === movieId);
  }
}

function playMovie(movie) {
  playerPanel.hidden = false;
  nowPlaying.textContent = movieLabel(movie);
  player.src = cdnUrl(movie.id);
  highlightSelected(movie.id);
  const playPromise = player.play();
  if (playPromise) {
    playPromise.catch(() => {});
  }
}

function renderResults(results) {
  resultsEl.replaceChildren();
  for (const movie of results) {
    const item = document.createElement("li");
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
    button.addEventListener("click", () => {
      setStatus(`${results.length} result${results.length === 1 ? "" : "s"}`);
      playMovie(movie);
    });
    item.append(button);
    resultsEl.append(item);
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const query = queryInput.value.trim();
  const lang = languageSelect.value;
  if (!query) {
    return;
  }

  searchButton.disabled = true;
  resultsEl.replaceChildren();
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

    setStatus(`${results.length} result${results.length === 1 ? "" : "s"}`);
    renderResults(results);
    playMovie(results[0]);
  } catch {
    setStatus("Could not reach the search server.", true);
  } finally {
    searchButton.disabled = false;
  }
});

player.addEventListener("error", () => {
  if (!player.src) {
    return;
  }
  setStatus("Video failed to load.", true);
});
