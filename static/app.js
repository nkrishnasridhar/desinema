const form = document.getElementById("search-form");
const queryInput = document.getElementById("query");
const languageSelect = document.getElementById("language");
const searchButton = form.querySelector("button[type='submit']");
const statusEl = document.getElementById("status");
const resultsEl = document.getElementById("results");
const playerPanel = document.getElementById("player-panel");
const nowPlaying = document.getElementById("now-playing");

const VjsButton = videojs.getComponent("Button");

class DownloadButton extends VjsButton {
  constructor(player, options) {
    super(player, options);
    this.addClass("vjs-download-control");
    this.controlText("Download");
  }

  handleClick() {
    if (!currentMovie || !currentMovie.id) {
      return;
    }
    const filename = downloadFilename(currentMovie);
    const params = new URLSearchParams({ download: "1", filename });
    const link = document.createElement("a");
    link.href = `${proxyUrl(currentMovie.id)}?${params}`;
    link.download = filename;
    link.rel = "noopener";
    document.body.append(link);
    link.click();
    link.remove();
  }
}

videojs.registerComponent("DownloadButton", DownloadButton);

const desktopPointerMq = window.matchMedia("(hover: hover) and (pointer: fine)");

function desktopPlayerPointer() {
  return desktopPointerMq.matches;
}

const player = videojs("player", {
  controls: true,
  autoplay: false,
  preload: "metadata",
  fluid: true,
  inactivityTimeout: 3000,
  playbackRates: [0.75, 1, 1.25, 1.5, 2],
  userActions: {
    click(event) {
      if (event.target.closest(".vjs-control-bar, .vjs-menu, .vjs-modal-dialog")) {
        return;
      }
      if (!desktopPlayerPointer()) {
        if (!this.paused()) {
          this.userActive(!this.userActive());
          return;
        }
      }
      if (this.paused()) {
        this.play();
      } else {
        this.pause();
      }
    },
  },
  controlBar: {
    skipButtons: {
      backward: 10,
      forward: 30,
    },
    children: [
      "playToggle",
      "skipBackward",
      "skipForward",
      "volumePanel",
      "currentTimeDisplay",
      "timeDivider",
      "durationDisplay",
      "progressControl",
      "playbackRateMenuButton",
      "DownloadButton",
      "pictureInPictureToggle",
      "fullscreenToggle",
    ],
    volumePanel: { inline: false },
  },
});

const homePanel = document.getElementById("home-panel");
const latestPanel = document.getElementById("latest-panel");
const topPanel = document.getElementById("top-panel");
const searchPanel = document.getElementById("search-panel");
const homeResultsEl = document.getElementById("home-results");
const latestResultsEl = document.getElementById("latest-results");
const topResultsEl = document.getElementById("top-results");
const topCustomLastForm = document.getElementById("top-custom-last");
const topCustomCalendarForm = document.getElementById("top-custom-calendar");
const topLastNInput = document.getElementById("top-last-n");
const topLastUnitSelect = document.getElementById("top-last-unit");
const topMonthSelect = document.getElementById("top-month");
const topYearInput = document.getElementById("top-year");
const latestPrevButton = document.getElementById("latest-prev");
const latestNextButton = document.getElementById("latest-next");
const latestPageLabel = document.getElementById("latest-page-label");
const topPrevButton = document.getElementById("top-prev");
const topNextButton = document.getElementById("top-next");
const topPageLabel = document.getElementById("top-page-label");
const topPresetButtons = document.querySelectorAll(".top-preset");
const tabButtons = document.querySelectorAll(".tab");
const stageEl = document.querySelector(".stage");
const playbillEl = document.getElementById("playbill");
const playbillPanel = document.getElementById("playbill-panel");
const playbillPoster = document.getElementById("playbill-poster");
const playbillTitle = document.getElementById("playbill-title");
const playbillYear = document.getElementById("playbill-year");
const playbillRatings = document.getElementById("playbill-ratings");
const playbillOverview = document.getElementById("playbill-overview");
const playbillPlay = document.getElementById("playbill-play");
const playbillCreditsEl = document.getElementById("playbill-credits");
const playbillCreditSlides = [...playbillCreditsEl.querySelectorAll("[data-credit-slide]")];

let currentMovie = null;
let playbillMovie = null;
let playbillOpener = null;
let playbillCredits = [];
let playbillCreditIndex = 0;
let playbillCreditActive = 0;
let playbillCreditTimer = 0;
let playbillCreditFadeTimer = 0;
let playbillCreditFetch = 0;
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
let topTp = "alltime";

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
const LAST_N_TP_RE = /^l([1-9]\d*)([dmy])$/;
const MONTH_TP_RE = /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)-(\d{4})$/;
const NAMED_PRESETS = new Set([
  "alltime",
  "td",
  "yd",
  "tw",
  "tm",
  "ty",
  "lw",
  "lm",
  "ly",
]);

function initTopPeriodDefaults() {
  const now = new Date();
  topMonthSelect.value = MONTH_SHORT[now.getMonth()];
  topYearInput.value = String(now.getFullYear());
  topYearInput.max = String(now.getFullYear() + 1);
  topLastNInput.value = "30";
  topLastUnitSelect.value = "d";
}

function tpFromLastN(n, unit) {
  return `l${n}${unit}`;
}

function tpFromCalendar(month, year) {
  return `${month}-${year}`;
}

function cdnUrl(movieId) {
  return `https://cdn2.einthusan.io/etv/content/D${movieId}.mp4`;
}

function proxyUrl(movieId) {
  return `/api/stream/${encodeURIComponent(movieId)}`;
}

function downloadFilename(movie) {
  const base = String(movie.title || "")
    .replace(/[\\/:*?"<>|]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const name = base || `D${movie.id}`;
  return name.toLowerCase().endsWith(".mp4") ? name : `${name}.mp4`;
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
    const value = Number(ratings[key]);
    if (value >= 4) {
      score.classList.add("is-strong");
      fill.classList.add("is-strong");
    }
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
  player.src({ src, type: "video/mp4" });
  const playPromise = player.play();
  if (playPromise) {
    playPromise.catch(() => {});
  }
}

function isPlayerFullscreen() {
  if (typeof player.isFullscreen === "function" && player.isFullscreen()) {
    return true;
  }
  const el = typeof player.el === "function" ? player.el() : null;
  const tech = typeof player.tech === "function" ? player.tech(true) : null;
  const techEl = tech && typeof tech.el === "function" ? tech.el() : null;
  if (techEl && (techEl.webkitDisplayingFullscreen || techEl.webkitPresentationMode === "fullscreen")) {
    return true;
  }
  const full =
    document.fullscreenElement ||
    document.webkitFullscreenElement ||
    document.mozFullScreenElement ||
    document.msFullscreenElement;
  return Boolean(
    full && el && (full === el || el.contains(full) || (full.contains && full.contains(el)))
  );
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

function movieOverview(movie) {
  return String(movie && movie.overview ? movie.overview : "").trim();
}

function bindPosterFallback(poster, movie) {
  if (!movie.poster_fallback || movie.poster_fallback === movie.poster) {
    return;
  }
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

function playbillFocusables() {
  return [...playbillPanel.querySelectorAll("button")].filter((el) => !el.disabled);
}

const CREDIT_DWELL_MS = 3000;
const CREDIT_FADE_MS = 450;

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function creditInitial(name) {
  const letter = String(name || "").trim().charAt(0);
  return letter ? letter.toUpperCase() : "?";
}

function stopCreditTicker() {
  window.clearTimeout(playbillCreditTimer);
  window.clearTimeout(playbillCreditFadeTimer);
  playbillCreditTimer = 0;
  playbillCreditFadeTimer = 0;
}

function hideCreditTicker() {
  stopCreditTicker();
  playbillCredits = [];
  playbillCreditIndex = 0;
  playbillCreditActive = 0;
  playbillCreditsEl.hidden = true;
  for (const slide of playbillCreditSlides) {
    slide.classList.remove("is-active", "is-exit");
    slide.replaceChildren();
  }
}

function prefetchCreditPhoto(credit) {
  if (!credit || !credit.photo) {
    return;
  }
  const img = new Image();
  img.src = credit.photo;
}

function renderCreditSlide(slide, credit) {
  slide.replaceChildren();
  const photo = document.createElement("span");
  photo.className = "playbill-credit-photo";
  if (credit.photo) {
    const img = document.createElement("img");
    img.src = credit.photo;
    img.alt = "";
    img.addEventListener(
      "error",
      () => {
        img.remove();
        photo.textContent = creditInitial(credit.name);
        photo.classList.add("is-placeholder");
      },
      { once: true }
    );
    photo.append(img);
  } else {
    photo.textContent = creditInitial(credit.name);
    photo.classList.add("is-placeholder");
  }
  const meta = document.createElement("span");
  meta.className = "playbill-credit-meta";
  const role = document.createElement("span");
  role.className = "playbill-credit-role";
  role.textContent = credit.role;
  const name = document.createElement("span");
  name.className = "playbill-credit-name";
  name.textContent = credit.name;
  meta.append(role, name);
  slide.append(photo, meta);
}

function showCreditAt(index, animate) {
  const credit = playbillCredits[index];
  if (!credit) {
    return;
  }
  const incoming = playbillCreditSlides[1 - playbillCreditActive];
  const outgoing = playbillCreditSlides[playbillCreditActive];
  renderCreditSlide(incoming, credit);
  if (!animate || prefersReducedMotion() || playbillCredits.length < 2) {
    outgoing.classList.remove("is-active", "is-exit");
    incoming.classList.add("is-active");
    incoming.classList.remove("is-exit");
    playbillCreditActive = 1 - playbillCreditActive;
    return;
  }
  incoming.classList.remove("is-exit");
  incoming.classList.add("is-active");
  outgoing.classList.add("is-exit");
  outgoing.classList.remove("is-active");
  playbillCreditActive = 1 - playbillCreditActive;
  playbillCreditFadeTimer = window.setTimeout(() => {
    outgoing.classList.remove("is-exit");
  }, CREDIT_FADE_MS);
}

function scheduleNextCredit() {
  window.clearTimeout(playbillCreditTimer);
  playbillCreditTimer = 0;
  if (
    playbillCredits.length < 2 ||
    prefersReducedMotion() ||
    document.hidden ||
    !playbillMovie
  ) {
    return;
  }
  playbillCreditTimer = window.setTimeout(() => {
    playbillCreditIndex = (playbillCreditIndex + 1) % playbillCredits.length;
    prefetchCreditPhoto(playbillCredits[(playbillCreditIndex + 1) % playbillCredits.length]);
    showCreditAt(playbillCreditIndex, true);
    scheduleNextCredit();
  }, CREDIT_DWELL_MS);
}

function orderedCredits(credits) {
  const list = Array.isArray(credits) ? credits.filter((item) => item && item.name) : [];
  const rank = { Director: 0, Cast: 1, Music: 2 };
  return list
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      const delta = (rank[a.item.role] ?? 9) - (rank[b.item.role] ?? 9);
      return delta || a.index - b.index;
    })
    .map((entry) => entry.item);
}

function startCreditTicker(credits) {
  stopCreditTicker();
  playbillCredits = orderedCredits(credits);
  playbillCreditIndex = 0;
  playbillCreditActive = 0;
  if (playbillCredits.length === 0) {
    playbillCreditsEl.hidden = true;
    return;
  }
  playbillCreditsEl.hidden = false;
  renderCreditSlide(playbillCreditSlides[0], playbillCredits[0]);
  playbillCreditSlides[0].classList.add("is-active");
  playbillCreditSlides[0].classList.remove("is-exit");
  playbillCreditSlides[1].classList.remove("is-active", "is-exit");
  playbillCreditSlides[1].replaceChildren();
  prefetchCreditPhoto(playbillCredits[1]);
  scheduleNextCredit();
}

async function loadPlaybillCredits(movie) {
  const token = ++playbillCreditFetch;
  hideCreditTicker();
  if (Array.isArray(movie.credits) && movie.credits.length) {
    if (token === playbillCreditFetch && playbillMovie === movie) {
      startCreditTicker(movie.credits);
    }
    return;
  }
  const tmdbId = movie.tmdb_id;
  if (!tmdbId) {
    return;
  }
  try {
    const response = await fetch(`/api/tmdb/credits/${encodeURIComponent(tmdbId)}`);
    const data = await readJson(response);
    const credits = data.credits || [];
    movie.credits = credits;
    if (token === playbillCreditFetch && playbillMovie === movie) {
      startCreditTicker(credits);
    }
  } catch {
    if (token === playbillCreditFetch) {
      hideCreditTicker();
    }
  }
}

function fillPlaybill(movie) {
  playbillTitle.textContent = movieLabel(movie);
  if (movie.year) {
    playbillYear.hidden = false;
    playbillYear.textContent = movie.year;
  } else {
    playbillYear.hidden = true;
    playbillYear.textContent = "";
  }
  playbillRatings.replaceChildren();
  const ratingsBlock = createRatingsBlock(movie.ratings, "movie-ratings playbill-ratings");
  if (ratingsBlock) {
    playbillRatings.append(ratingsBlock);
  }
  playbillOverview.textContent = movieOverview(movie);
  if (movie.poster) {
    playbillPoster.hidden = false;
    playbillPoster.src = movie.poster;
    playbillPoster.alt = "";
    bindPosterFallback(playbillPoster, movie);
  } else {
    playbillPoster.hidden = true;
    playbillPoster.removeAttribute("src");
  }
  loadPlaybillCredits(movie);
}

function closePlaybill() {
  hideCreditTicker();
  playbillCreditFetch += 1;
  if (playbillEl.hidden || !playbillEl.classList.contains("is-open")) {
    playbillEl.hidden = true;
    playbillEl.classList.remove("is-open");
    document.body.classList.remove("playbill-open");
    return;
  }
  playbillEl.classList.remove("is-open");
  document.body.classList.remove("playbill-open");
  const opener = playbillOpener;
  playbillMovie = null;
  playbillOpener = null;
  let finished = false;
  const finish = () => {
    if (finished) {
      return;
    }
    finished = true;
    playbillPanel.removeEventListener("transitionend", onEnd);
    playbillEl.hidden = true;
    if (opener && typeof opener.focus === "function") {
      opener.focus();
    }
  };
  const onEnd = (event) => {
    if (event.target !== playbillPanel) {
      return;
    }
    finish();
  };
  playbillPanel.addEventListener("transitionend", onEnd);
  window.setTimeout(finish, 400);
}

function openPlaybill(movie, opener) {
  const overview = movieOverview(movie);
  if (!overview) {
    return;
  }
  playbillMovie = movie;
  playbillOpener = opener || null;
  fillPlaybill(movie);
  playbillEl.hidden = false;
  document.body.classList.add("playbill-open");
  requestAnimationFrame(() => {
    playbillEl.classList.add("is-open");
    playbillPanel.focus();
  });
}

function createResultButton(movie) {
  const card = document.createElement("div");
  card.className = "result";
  card.dataset.id = movie.id;

  const play = document.createElement("button");
  play.type = "button";
  play.className = "result-play";
  play.setAttribute("aria-label", `Play ${movieLabel(movie)}`);

  const media = document.createElement("span");
  media.className = "result-media";
  const poster = movie.poster ? document.createElement("img") : document.createElement("span");
  poster.className = "poster";
  if (movie.poster) {
    poster.src = movie.poster;
    poster.alt = "";
    bindPosterFallback(poster, movie);
  }
  media.append(poster);
  play.append(media);

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
  play.append(meta);
  play.addEventListener("click", () => playMovie(movie));
  card.append(play);

  if (movieOverview(movie)) {
    const info = document.createElement("button");
    info.type = "button";
    info.className = "result-info";
    info.setAttribute("aria-label", `Movie info: ${movieLabel(movie)}`);
    info.textContent = "i";
    info.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      openPlaybill(movie, info);
    });
    card.append(info);
  }
  return card;
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

function syncTopPeriodUi() {
  const lastMatch = LAST_N_TP_RE.exec(topTp);
  const monthMatch = MONTH_TP_RE.exec(topTp);
  const isNamed = NAMED_PRESETS.has(topTp);

  for (const button of topPresetButtons) {
    const active = isNamed && button.dataset.tp === topTp;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", active ? "true" : "false");
  }

  topCustomLastForm.classList.toggle("is-active", Boolean(lastMatch));
  topCustomCalendarForm.classList.toggle("is-active", Boolean(monthMatch));

  if (lastMatch) {
    topLastNInput.value = lastMatch[1];
    topLastUnitSelect.value = lastMatch[2];
  }
  if (monthMatch) {
    topMonthSelect.value = monthMatch[1];
    topYearInput.value = monthMatch[2];
  }
}

function applyTopTp(nextTp) {
  if (!nextTp || topTp === nextTp) {
    syncTopPeriodUi();
    return;
  }
  topTp = nextTp;
  syncTopPeriodUi();
  loadTop(1);
}

function applyLastCustom() {
  const n = Number.parseInt(topLastNInput.value, 10);
  const unit = topLastUnitSelect.value;
  if (!Number.isInteger(n) || n < 1 || !["d", "m", "y"].includes(unit)) {
    setStatus("Enter a valid Last period (number ≥ 1).", true);
    return;
  }
  applyTopTp(tpFromLastN(n, unit));
}

function applyCalendarCustom() {
  const month = topMonthSelect.value;
  const year = Number.parseInt(topYearInput.value, 10);
  const maxYear = new Date().getFullYear() + 1;
  if (!MONTH_SHORT.includes(month) || !Number.isInteger(year) || year < 1990 || year > maxYear) {
    setStatus(`Enter a year between 1990 and ${maxYear}.`, true);
    return;
  }
  applyTopTp(tpFromCalendar(month, year));
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
    if (data.tp) {
      topTp = data.tp;
      syncTopPeriodUi();
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
  closePlaybill();
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
  closePlaybill();
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

for (const button of topPresetButtons) {
  button.addEventListener("click", () => {
    applyTopTp(button.dataset.tp);
  });
}

topCustomLastForm.addEventListener("submit", (event) => {
  event.preventDefault();
  applyLastCustom();
});

topCustomCalendarForm.addEventListener("submit", (event) => {
  event.preventDefault();
  applyCalendarCustom();
});

initTopPeriodDefaults();
syncTopPeriodUi();

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

playbillEl.addEventListener("click", (event) => {
  if (event.target.closest("[data-playbill-dismiss]")) {
    closePlaybill();
  }
});

playbillPlay.addEventListener("click", () => {
  const movie = playbillMovie;
  closePlaybill();
  if (movie) {
    playMovie(movie);
  }
});

document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    window.clearTimeout(playbillCreditTimer);
    playbillCreditTimer = 0;
    return;
  }
  if (playbillMovie && playbillCredits.length > 1 && playbillEl.classList.contains("is-open")) {
    scheduleNextCredit();
  }
});

document.addEventListener("keydown", (event) => {
  if (playbillEl.hidden || !playbillEl.classList.contains("is-open")) {
    return;
  }
  if (event.key === "Escape") {
    event.preventDefault();
    closePlaybill();
    return;
  }
  if (event.key !== "Tab") {
    return;
  }
  const nodes = playbillFocusables();
  if (nodes.length === 0) {
    event.preventDefault();
    playbillPanel.focus();
    return;
  }
  const first = nodes[0];
  const last = nodes[nodes.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
});

player.on("error", () => {
  if (!currentMovie || !player.currentSrc()) {
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
