const form = document.getElementById("search-form");
const statusEl = document.getElementById("status");

form.addEventListener("submit", (event) => {
  event.preventDefault();
  statusEl.hidden = false;
  statusEl.textContent = "Search is not wired up yet.";
});
