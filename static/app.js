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
const topPanel = document.getElementById("top-panel");
const searchPanel = document.getElementById("search-panel");
const homeResultsEl = document.getElementById("home-results");
const latestResultsEl = document.getElementById("latest-results");
const topResultsEl = document.getElementById("top-results");
const topPeriodsEl = document.getElementById("top-periods");
const latestPrevButton = document.getElementById("latest-prev");
const latestNextButton = document.getElementById("latest-next");
const latestPageLabel = document.getElementById("latest-page-label");
const topPrevButton = document.getElementById("top-prev");
const topNextButton = document.getElementById("top-next");
const topPageLabel = document.getElementById("top-page-label");
const topMetricButtons = document.querySelectorAll(".top-metric");
const tabButtons = document.querySelectorAll(".tab");
const stageEl = document.querySelector(".stage");

let currentMovie = null;
let usingProxy = false;
let lastResults = [];
let lastSearchQuery = "";
let currentTab = "home";
let homeLang = null;
let latestLang = null;
let latestPage = 1;
let latestHasNext = false;
let topLang = null;
let topPage = 1;
let topHasNext = false;
let topPtype = "view";
let topTp = "alltime";

const RELATIVE_PERIODS = [
  ["alltime", "All Time"],
  ["td", "Today"],
  ["yd", "Yesterday"],
  ["tw", "This Week"],
  ["tm", "This Month"],
  ["ty", "This Year"],
  ["lw", "Last Week"],
  ["lm", "Last Month"],
  ["ly", "Last Year"],
  ["l10d", "Last 10 Days"],
  ["l30d", "Last 30 Days"],
  ["l2m", "Last 2 Months"],
  ["l3m", "Last 3 Months"],
  ["l4m", "Last 4 Months"],
  ["l6m", "Last 6 Months"],
  ["l12m", "Last 12 Months"],
  ["l2y", "Last 2 Years"],
];

const MONTH_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

function calendarPeriods(count = 24) {
  const periods = [];
  const now = new Date();
  let year = now.getFullYear();
  let month = now.getMonth();
  for (let i = 0; i < count; i += 1) {
    const code = `${MONTH_SHORT[month]}-${year}`;
    periods.push([code, code.replace("-", " ")]);
    month -= 1;
    if (month < 0) {
      month = 11;
      year -= 1;
    }
  }
  return periods.reverse();
}

function cdnUrl(movieId) {
  return `https://cdn2.einthusan.io/etv/content/D${movieId}.mp4`;
}

function proxyUrl(movieId) {
  return `/api/stream/${encodeURIComponent(movieId)}`;
}

const RATING_LABELS = [
  ["action", "Action"],
  ["comedy", "Comedy"],
  ["romance", "Romance"],
  ["storyline", "Storyline"],
  ["performance", "Performance"],
];

function movieLabel(movie) {
  return movie.year ? `${movie.title} (${movie.year})` : movie.title;
}

function formatScore(value) {
  return Number(value).toFixed(1);
}

function ratingFillPercent(value) {
  const score = Math.min(5, Math.max(0, Number(value) || 0));
  return `${(score / 5) * 100}%`;
}

function createRatingsBlock(ratings, className = "movie-ratings") {
  if (!ratings) {
    return null;
  }
  const list = document.createElement("span");
  list.className = className;
  for (const [key, label] of RATING_LABELS) {
    if (ratings[key] == null) {
      continue;
    }
    const row = document.createElement("span");
    row.className = "rating-row";
    const name = document.createElement("span");
    name.className = "rating-label";
    name.textContent = label;
    const bar = document.createElement("span");
    bar.className = "rating-bar";
    bar.setAttribute("aria-hidden", "true");
    const fill = document.createElement("span");
    fill.className = "rating-bar-fill";
    fill.style.width = ratingFillPercent(ratings[key]);
    bar.append(fill);
    const score = document.createElement("span");
    score.className = "rating-score";
    score.textContent = formatScore(ratings[key]);
    row.append(name, bar, score);
    list.append(row);
  }
  return list.childElementCount ? list : null;
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

function isPlayerFullscreen() {
  if (player.webkitDisplayingFullscreen || player.webkitPresentationMode === "fullscreen") {
    return true;
  }
  const full =
    document.fullscreenElement ||
    document.webkitFullscreenElement ||
    document.mozFullScreenElement ||
    document.msFullscreenElement;
  return Boolean(full && (full === player || player.contains(full) || full.contains(player)));
}

function parkPlayer() {
  if (isPlayerFullscreen()) {
    return;
  }
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

function movieCards(list) {
  return [...list.children].filter(
    (el) =>
      el.matches("li") &&
      !el.classList.contains("player-slot") &&
      !el.classList.contains("pager-slot")
  );
}

function placePlayerInVisibleList() {
  if (!playerPanel.classList.contains("is-active") || isPlayerFullscreen()) {
    return;
  }
  const panel = document.querySelector(".browse-panel:not([hidden])");
  const list = panel && panel.querySelector(".card-grid");
  if (!list) {
    return;
  }
  const cards = movieCards(list);
  let slot = list.querySelector(":scope > .player-slot");
  if (!slot) {
    slot = document.createElement("li");
    slot.className = "player-slot";
  }
  if (playerPanel.parentElement !== slot) {
    slot.append(playerPanel);
  }
  if (cards.length === 0) {
    parkPlayer();
    return;
  }
  const selectedBtn = list.querySelector(".result.selected");
  const origin = selectedBtn ? selectedBtn.closest("li") : cards[0];
  const rowItems = [...cards];
  const pager = list.querySelector(":scope > .pager-slot");
  if (pager && Math.abs(pager.offsetTop - origin.offsetTop) <= 4) {
    rowItems.push(pager);
  }
  const anchor = lastCardInRow(rowItems, origin);
  if (slot.previousElementSibling !== anchor) {
    anchor.after(slot);
  }
}

function playMovie(movie) {
  currentMovie = movie;
  usingProxy = false;
  document.body.classList.add("is-playing");
  playerPanel.classList.remove("animation-done");
  playerPanel.classList.add("is-active");
  nowPlaying.replaceChildren();
  const titleLine = document.createElement("span");
  titleLine.className = "now-playing-title";
  titleLine.textContent = movieLabel(movie);
  nowPlaying.append(titleLine);
  const ratingsBlock = createRatingsBlock(movie.ratings, "movie-ratings now-playing-ratings");
  if (ratingsBlock) {
    nowPlaying.append(ratingsBlock);
  }
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
    if (movie.poster_fallback && movie.poster_fallback !== movie.poster) {
      poster.addEventListener(
        "error",
        () => {
          if (poster.dataset.fallbackApplied) {
            return;
          }
          poster.dataset.fallbackApplied = "1";
          poster.src = movie.poster_fallback;
        },
        { once: true }
      );
    }
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
  const ratingsBlock = createRatingsBlock(movie.ratings);
  if (ratingsBlock) {
    meta.append(ratingsBlock);
  }
  button.append(meta);
  button.addEventListener("click", () => playMovie(movie));
  return button;
}

function clearMovieCards(container) {
  for (const item of [...container.children]) {
    if (item.classList.contains("pager-slot") || item.classList.contains("player-slot")) {
      continue;
    }
    item.remove();
  }
}

function setListLoading(container, message) {
  clearMovieCards(container);
  container.classList.add("is-loading");
  setStatus(message);
}

function finishListLoading(container) {
  container.classList.remove("is-loading");
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
  finishListLoading(container);
  if (currentMovie) {
    highlightSelected(currentMovie.id);
  }
  placePlayerInVisibleList();
}

function updateLatestPager() {
  latestPageLabel.textContent = `Page ${latestPage}`;
  latestPrevButton.disabled = latestPage <= 1;
  latestNextButton.disabled = !latestHasNext;
}

function updateTopPager() {
  topPageLabel.textContent = `Page ${topPage}`;
  topPrevButton.disabled = topPage <= 1;
  topNextButton.disabled = !topHasNext;
}

function syncTopMetricButtons() {
  for (const button of topMetricButtons) {
    const active = button.dataset.ptype === topPtype;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", active ? "true" : "false");
  }
}

function syncTopPeriodButtons() {
  for (const button of topPeriodsEl.querySelectorAll(".top-period")) {
    const active = button.dataset.tp === topTp;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", active ? "true" : "false");
  }
}

function buildTopPeriods() {
  topPeriodsEl.replaceChildren();
  const periods = [...RELATIVE_PERIODS, ...calendarPeriods(24)];
  for (const [code, label] of periods) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "top-period";
    button.dataset.tp = code;
    button.textContent = label;
    button.setAttribute("aria-pressed", "false");
    button.addEventListener("click", () => {
      if (topTp === code) {
        return;
      }
      topTp = code;
      syncTopPeriodButtons();
      loadTop(1);
    });
    topPeriodsEl.append(button);
  }
  syncTopPeriodButtons();
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
  if (homeLang === lang && homeResultsEl.querySelector(".result")) {
    return;
  }

  setListLoading(homeResultsEl, "Loading featured movies…");
  try {
    const params = new URLSearchParams({ lang });
    const response = await fetch(`/api/featured?${params}`);
    const data = await readJson(response);
    if (!response.ok) {
      finishListLoading(homeResultsEl);
      setStatus(data.error || "Failed to load featured movies.", true);
      return;
    }
    const results = data.results || [];
    if (results.length === 0) {
      homeLang = lang;
      finishListLoading(homeResultsEl);
      setStatus("No featured movies found.", true);
      return;
    }
    renderList(homeResultsEl, results);
    homeLang = lang;
    setStatus("");
  } catch {
    finishListLoading(homeResultsEl);
    setStatus("Could not reach the server.", true);
  }
}

async function loadLatest(page) {
  const lang = languageSelect.value;
  setListLoading(latestResultsEl, "Loading latest movies…");
  latestPrevButton.disabled = true;
  latestNextButton.disabled = true;

  try {
    const params = new URLSearchParams({ lang, page: String(page) });
    const response = await fetch(`/api/latest?${params}`);
    const data = await readJson(response);
    if (!response.ok) {
      finishListLoading(latestResultsEl);
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
    finishListLoading(latestResultsEl);
    setStatus("Could not reach the server.", true);
    updateLatestPager();
  }
}

async function loadTop(page) {
  const lang = languageSelect.value;
  setListLoading(topResultsEl, "Loading top movies…");
  topPrevButton.disabled = true;
  topNextButton.disabled = true;

  try {
    const params = new URLSearchParams({
      lang,
      ptype: topPtype,
      tp: topTp,
      page: String(page),
    });
    const response = await fetch(`/api/top?${params}`);
    const data = await readJson(response);
    if (!response.ok) {
      finishListLoading(topResultsEl);
      setStatus(data.error || "Failed to load top movies.", true);
      updateTopPager();
      return;
    }
    const results = data.results || [];
    topPage = data.page || page;
    topHasNext = Boolean(data.has_next);
    topLang = lang;
    if (data.ptype) {
      topPtype = data.ptype;
      syncTopMetricButtons();
    }
    if (data.tp) {
      topTp = data.tp;
      syncTopPeriodButtons();
    }
    renderList(topResultsEl, results);
    updateTopPager();
    if (results.length === 0) {
      setStatus("No top movies found.", true);
      return;
    }
    setStatus("");
  } catch {
    finishListLoading(topResultsEl);
    setStatus("Could not reach the server.", true);
    updateTopPager();
  }
}

function setTab(tab) {
  currentTab = tab;
  for (const button of tabButtons) {
    button.setAttribute("aria-selected", button.dataset.tab === tab ? "true" : "false");
  }
  homePanel.hidden = tab !== "home";
  latestPanel.hidden = tab !== "latest";
  topPanel.hidden = tab !== "top";
  searchPanel.hidden = tab !== "search";

  if (tab === "home") {
    loadHome();
  } else if (tab === "latest") {
    if (latestLang !== languageSelect.value) {
      loadLatest(1);
    } else if (latestResultsEl.children.length === 0) {
      loadLatest(latestPage);
    }
  } else if (tab === "top") {
    if (topLang !== languageSelect.value) {
      loadTop(1);
    } else if (!topResultsEl.querySelector(".result")) {
      loadTop(topPage);
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
  homeLang = null;
  latestLang = null;
  topLang = null;
  if (currentTab === "home") {
    loadHome();
  } else if (currentTab === "latest") {
    loadLatest(1);
  } else if (currentTab === "top") {
    loadTop(1);
  } else if (currentTab === "search" && lastSearchQuery) {
    runSearch(lastSearchQuery);
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

topPrevButton.addEventListener("click", () => {
  if (topPage > 1) {
    loadTop(topPage - 1);
  }
});

topNextButton.addEventListener("click", () => {
  if (topHasNext) {
    loadTop(topPage + 1);
  }
});

for (const button of topMetricButtons) {
  button.addEventListener("click", () => {
    const next = button.dataset.ptype;
    if (!next || topPtype === next) {
      return;
    }
    topPtype = next;
    syncTopMetricButtons();
    loadTop(1);
  });
}

buildTopPeriods();

async function runSearch(query) {
  const lang = languageSelect.value;
  if (!query) {
    return;
  }

  searchButton.disabled = true;
  lastSearchQuery = query;
  lastResults = [];
  setListLoading(resultsEl, "Searching…");
  setTab("search");

  try {
    const params = new URLSearchParams({ q: query, lang });
    const response = await fetch(`/api/search?${params}`);
    const data = await readJson(response);

    if (!response.ok) {
      finishListLoading(resultsEl);
      setStatus(data.error || "Search failed.", true);
      return;
    }

    const results = data.results || [];
    lastResults = results;
    if (results.length === 0) {
      finishListLoading(resultsEl);
      setStatus("No movies found.", true);
      return;
    }

    renderList(resultsEl, results);
    setStatus("");
  } catch {
    finishListLoading(resultsEl);
    setStatus("Could not reach the search server.", true);
  } finally {
    searchButton.disabled = false;
  }
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  runSearch(queryInput.value.trim());
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

playerPanel.addEventListener("animationend", (event) => {
  if (event.target !== playerPanel || event.animationName !== "screen-rise") {
    return;
  }
  playerPanel.classList.add("animation-done");
});

updateLatestPager();
loadHome();
