const form = document.getElementById("search-form");
const queryInput = document.getElementById("query");
const languageSelect = document.getElementById("language");
const searchButton = form.querySelector("button[type='submit']");
const statusEl = document.getElementById("status");
const resultsEl = document.getElementById("results");
const playerPanel = document.getElementById("player-panel");
const nowPlaying = document.getElementById("now-playing");
const player = document.getElementById("player");
const homePanel = document.getElementById("home-panel");
const latestPanel = document.getElementById("latest-panel");
const searchPanel = document.getElementById("search-panel");
const homeResultsEl = document.getElementById("home-results");
const latestResultsEl = document.getElementById("latest-results");
const latestPrevButton = document.getElementById("latest-prev");
const latestNextButton = document.getElementById("latest-next");
const latestPageLabel = document.getElementById("latest-page-label");
const tabButtons = document.querySelectorAll(".tab");
const stageEl = document.querySelector(".stage");

let currentMovie = null;
let usingProxy = false;
let lastResults = [];
let currentTab = "home";
let homeLang = null;
let latestLang = null;
let latestPage = 1;
let latestHasNext = false;

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

function highlightSelected(movieId) {
  for (const button of document.querySelectorAll(".result")) {
    button.classList.toggle("selected", Boolean(movieId) && button.dataset.id === movieId);
  }
}

function startPlayback(src) {
  player.src = src;
  const playPromise = player.play();
  if (playPromise) {
    playPromise.catch(() => {});
  }
}

function parkPlayer() {
  const slot = playerPanel.closest(".player-slot");
  if (playerPanel.parentElement !== stageEl) {
    stageEl.prepend(playerPanel);
  }
  if (slot) {
    slot.remove();
  }
}

function lastCardInRow(cards, origin) {
  const top = origin.offsetTop;
  let last = origin;
  for (const card of cards) {
    if (Math.abs(card.offsetTop - top) <= 4) {
      last = card;
    }
  }
  return last;
}

function placePlayerInVisibleList() {
  if (!playerPanel.classList.contains("is-active")) {
    return;
  }
  const panel = document.querySelector(".browse-panel:not([hidden])");
  const list = panel && panel.querySelector(".card-grid");
  if (!list) {
    return;
  }
  const cards = [...list.children].filter(
    (el) => el.matches("li") && !el.classList.contains("player-slot")
  );
  if (cards.length === 0) {
    parkPlayer();
    return;
  }
  const selectedBtn = list.querySelector(".result.selected");
  const origin = selectedBtn ? selectedBtn.closest("li") : cards[0];
  const last = lastCardInRow(cards, origin);
  let slot = list.querySelector(":scope > .player-slot");
  if (!slot) {
    slot = document.createElement("li");
    slot.className = "player-slot";
  }
  slot.append(playerPanel);
  last.after(slot);
}

function playMovie(movie) {
  currentMovie = movie;
  usingProxy = false;
  document.body.classList.add("is-playing");
  playerPanel.classList.add("is-active");
  nowPlaying.textContent = movieLabel(movie);
  highlightSelected(movie.id);
  startPlayback(cdnUrl(movie.id));
  requestAnimationFrame(() => {
    placePlayerInVisibleList();
    playerPanel.scrollIntoView({ behavior: "smooth", block: "nearest" });
  });
}

function createResultButton(movie) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "result";
  button.dataset.id = movie.id;

  const poster = movie.poster ? document.createElement("img") : document.createElement("span");
  poster.className = "poster";
  if (movie.poster) {
    poster.src = movie.poster;
    poster.alt = "";
  }
  button.append(poster);

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

function renderList(container, movies) {
  parkPlayer();
  const pager = container.querySelector(".pager-slot");
  container.replaceChildren();
  for (const movie of movies) {
    const item = document.createElement("li");
    item.append(createResultButton(movie));
    container.append(item);
  }
  if (pager) {
    container.append(pager);
  }
  if (currentMovie) {
    highlightSelected(currentMovie.id);
  }
  requestAnimationFrame(placePlayerInVisibleList);
}

function updateLatestPager() {
  latestPageLabel.textContent = `Page ${latestPage}`;
  latestPrevButton.disabled = latestPage <= 1;
  latestNextButton.disabled = !latestHasNext;
}

async function readJson(response) {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

async function loadHome() {
  const lang = languageSelect.value;
  if (homeLang === lang && homeResultsEl.children.length > 0) {
    return;
  }

  setStatus("Loading featured movies…");
  try {
    const params = new URLSearchParams({ lang });
    const response = await fetch(`/api/featured?${params}`);
    const data = await readJson(response);
    if (!response.ok) {
      setStatus(data.error || "Failed to load featured movies.", true);
      return;
    }
    const results = data.results || [];
    if (results.length === 0) {
      homeResultsEl.replaceChildren();
      homeLang = lang;
      setStatus("No featured movies found.", true);
      return;
    }
    renderList(homeResultsEl, results);
    homeLang = lang;
    setStatus("");
  } catch {
    setStatus("Could not reach the server.", true);
  }
}

async function loadLatest(page) {
  const lang = languageSelect.value;
  setStatus("Loading latest movies…");
  latestPrevButton.disabled = true;
  latestNextButton.disabled = true;

  try {
    const params = new URLSearchParams({ lang, page: String(page) });
    const response = await fetch(`/api/latest?${params}`);
    const data = await readJson(response);
    if (!response.ok) {
      setStatus(data.error || "Failed to load latest movies.", true);
      updateLatestPager();
      return;
    }
    const results = data.results || [];
    latestPage = data.page || page;
    latestHasNext = Boolean(data.has_next);
    latestLang = lang;
    renderList(latestResultsEl, results);
    updateLatestPager();
    if (results.length === 0) {
      setStatus("No latest movies found.", true);
      return;
    }
    setStatus("");
  } catch {
    setStatus("Could not reach the server.", true);
    updateLatestPager();
  }
}

function setTab(tab) {
  currentTab = tab;
  for (const button of tabButtons) {
    button.setAttribute("aria-selected", button.dataset.tab === tab ? "true" : "false");
  }
  homePanel.hidden = tab !== "home";
  latestPanel.hidden = tab !== "latest";
  searchPanel.hidden = tab !== "search";

  if (tab === "home") {
    loadHome();
  } else if (tab === "latest") {
    if (latestLang !== languageSelect.value) {
      loadLatest(1);
    } else if (latestResultsEl.children.length === 0) {
      loadLatest(latestPage);
    }
  }
  requestAnimationFrame(placePlayerInVisibleList);
}

for (const button of tabButtons) {
  button.addEventListener("click", () => {
    setTab(button.dataset.tab);
  });
}

languageSelect.addEventListener("change", () => {
  if (currentTab === "home") {
    homeLang = null;
    loadHome();
  } else if (currentTab === "latest") {
    loadLatest(1);
  }
});

latestPrevButton.addEventListener("click", () => {
  if (latestPage > 1) {
    loadLatest(latestPage - 1);
  }
});

latestNextButton.addEventListener("click", () => {
  if (latestHasNext) {
    loadLatest(latestPage + 1);
  }
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const query = queryInput.value.trim();
  const lang = languageSelect.value;
  if (!query) {
    return;
  }

  searchButton.disabled = true;
  setTab("search");
  lastResults = [];
  resultsEl.replaceChildren();
  setStatus("Searching…");

  try {
    const params = new URLSearchParams({ q: query, lang });
    const response = await fetch(`/api/search?${params}`);
    const data = await readJson(response);

    if (!response.ok) {
      setStatus(data.error || "Search failed.", true);
      return;
    }

    const results = data.results || [];
    lastResults = results;
    if (results.length === 0) {
      setStatus("No movies found.", true);
      return;
    }

    setStatus("");
    renderList(resultsEl, results);
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

window.addEventListener("resize", () => {
  requestAnimationFrame(placePlayerInVisibleList);
});

updateLatestPager();
loadHome();
