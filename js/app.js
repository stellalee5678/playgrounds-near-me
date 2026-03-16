import { getCurrentLocation, geocodeAddress, reverseGeocode } from "./location.js";
import { fetchPlaygrounds } from "./overpass.js";
import { initMap, updateMap, highlightPlayground } from "./map.js";
import {
  renderPlaygroundList,
  showLoading,
  hideLoading,
  showError,
  showResultCount,
  clearResults,
  updatePlaygroundName,
  scrollToCard,
} from "./ui.js";
import { haversineDistance, formatDistance } from "./utils.js";
import {
  filterState,
  hasActiveFilters,
  countActiveFilters,
  clearFilters,
  applyFilters,
  getEquipmentOptions,
  getFacilityOptions,
} from "./filters.js";

const state = {
  userLat: null,
  userLon: null,
  radius: 1000,
  playgrounds: [],
  mapInstance: null,
  isLoading: false,
};

// Incremented each time a new search starts so stale enrichment jobs abort.
let enrichmentId = 0;

document.addEventListener("DOMContentLoaded", () => {
  document
    .getElementById("geolocate-btn")
    .addEventListener("click", handleGeolocate);

  document
    .getElementById("address-form")
    .addEventListener("submit", handleAddressSearch);

  document.querySelectorAll(".radius-btn").forEach((btn) => {
    btn.addEventListener("click", handleRadiusChange);
  });

  document
    .getElementById("sort-select")
    .addEventListener("change", handleSortChange);

  // Filter toggle
  document.getElementById("filter-toggle").addEventListener("click", () => {
    const panel = document.getElementById("filter-panel");
    const btn = document.getElementById("filter-toggle");
    const isOpen = !panel.hidden;
    panel.hidden = isOpen;
    btn.setAttribute("aria-expanded", String(!isOpen));
  });

  // Clear filters
  document.getElementById("filter-clear-btn").addEventListener("click", () => {
    clearFilters();
    document.querySelectorAll(".filter-chip.active").forEach((c) => c.classList.remove("active"));
    updateFilterBadge();
    applyFiltersAndRender();
  });
});

async function handleGeolocate() {
  if (state.isLoading) return;
  setButtonsDisabled(true);

  try {
    const { lat, lon } = await getCurrentLocation();
    await performSearch(lat, lon, state.radius);
  } catch (err) {
    showError(err.message);
  } finally {
    setButtonsDisabled(false);
  }
}

async function handleAddressSearch(e) {
  e.preventDefault();
  if (state.isLoading) return;

  const input = document.getElementById("address-input");
  const query = input.value.trim();
  if (!query) return;

  setButtonsDisabled(true);

  try {
    const { lat, lon } = await geocodeAddress(query);
    await performSearch(lat, lon, state.radius);
  } catch (err) {
    showError(err.message);
  } finally {
    setButtonsDisabled(false);
  }
}

const ALLOWED_RADII = new Set([1000, 5000, 10000]);

function handleRadiusChange(e) {
  document
    .querySelectorAll(".radius-btn")
    .forEach((b) => b.classList.remove("active"));
  e.target.classList.add("active");

  const newRadius = parseInt(e.target.dataset.radius, 10);
  if (!ALLOWED_RADII.has(newRadius)) return;
  state.radius = newRadius;

  if (state.userLat !== null && state.userLon !== null) {
    performSearch(state.userLat, state.userLon, newRadius);
  }
}

function handleSortChange(e) {
  const sortBy = e.target.value;

  if (sortBy === "name") {
    state.playgrounds.sort((a, b) => {
      const nameA = (a.name || "Unnamed Playground").toLowerCase();
      const nameB = (b.name || "Unnamed Playground").toLowerCase();
      return nameA.localeCompare(nameB);
    });
  } else {
    state.playgrounds.sort((a, b) => a.distance - b.distance);
  }

  applyFiltersAndRender();
}

async function performSearch(lat, lon, radius) {
  if (state.isLoading) return;
  state.isLoading = true;
  state.userLat = lat;
  state.userLon = lon;
  state.radius = radius;

  // Cancel any in-progress reverse-geocoding from a previous search
  const thisEnrichmentId = ++enrichmentId;

  showLoading();
  clearResults();
  document.getElementById("welcome-section").classList.add("hidden");

  // Reset filters and hide filter section while loading
  clearFilters();
  document.getElementById("filter-section").classList.add("hidden");
  document.getElementById("filter-panel").hidden = true;
  document.getElementById("filter-toggle").setAttribute("aria-expanded", "false");

  // Show map section, initialize if needed
  document.getElementById("map-section").classList.remove("hidden");
  if (!state.mapInstance) {
    state.mapInstance = initMap("map");
  }

  try {
    const rawData = await fetchPlaygrounds(lat, lon, radius);

    state.playgrounds = rawData.map((pg) => ({
      ...pg,
      distance: haversineDistance(lat, lon, pg.lat, pg.lon),
    }));

    // Sort by distance by default
    state.playgrounds.sort((a, b) => a.distance - b.distance);

    // Reset sort dropdown
    document.getElementById("sort-select").value = "distance";

    hideLoading();
    showResultCount(state.playgrounds.length);

    if (state.playgrounds.length === 0) {
      showNoResults(radius);
    } else {
      document.getElementById("filter-section").classList.remove("hidden");
      buildFilterUI(state.playgrounds);

      // Render cards and map (filters are cleared above so all results shown)
      applyFiltersAndRender();

      // Kick off background name enrichment for unnamed playgrounds.
      // No await — runs concurrently so the page stays usable.
      enrichUnnamedPlaygrounds(state.playgrounds, thisEnrichmentId);
    }
  } catch (err) {
    hideLoading();
    showError(`Search failed: ${err.message}`);
  } finally {
    state.isLoading = false;
  }
}

/**
 * For each playground that lacks a name, query Nominatim reverse geocoding
 * (≤1 request/sec) and update the card name progressively as results arrive.
 *
 * The enrichmentId guards against stale callbacks when the user performs a
 * new search before this loop finishes.
 */
async function enrichUnnamedPlaygrounds(playgrounds, myEnrichmentId) {
  const unnamed = playgrounds.filter((pg) => !pg.name);
  if (unnamed.length === 0) return;

  for (let i = 0; i < unnamed.length; i++) {
    // Abort if a newer search has started
    if (enrichmentId !== myEnrichmentId) return;

    // Rate-limit: 1.1 s gap between requests (Nominatim allows 1/sec)
    if (i > 0) {
      await sleep(1100);
      if (enrichmentId !== myEnrichmentId) return;
    }

    try {
      const derivedName = await reverseGeocode(unnamed[i].lat, unnamed[i].lon);
      if (derivedName && enrichmentId === myEnrichmentId) {
        // Update the in-memory state so sort-by-name works correctly
        unnamed[i].name = derivedName;
        // Update the DOM card without a full re-render
        updatePlaygroundName(unnamed[i].id, derivedName);
      }
    } catch (_) {
      // Silently ignore individual failures
    }
  }
}

const EQUIPMENT_EMOJI = {
  Slides: "🛝", Swings: "🎠", Climbing: "🧗", Sandbox: "⏳",
  Roundabout: "🔵", Seesaw: "⚖️", "Spring Riders": "🐴", Balance: "🤸",
  Zipline: "🪂", Trampoline: "🤾", "Water Play": "💧", Playhouse: "🏠",
  "Multi-Play Structure": "🏗️",
};

const FACILITY_EMOJI = {
  "Toilets": "🚻", "BBQ": "🍖", "Drinking Water": "💧",
  "Shelter": "⛺", "Fountain": "⛲", "Sports Pitch": "⚽",
  "Sports Field": "🏃", "Water Feature": "🌊",
};

function buildFilterUI(playgrounds) {
  // Equipment chips (dynamic — only types present in results)
  const equipContainer = document.getElementById("filter-chips-equipment");
  equipContainer.innerHTML = "";
  for (const eq of getEquipmentOptions(playgrounds)) {
    equipContainer.appendChild(makeChip(EQUIPMENT_EMOJI[eq] || "🎪", eq, "equipment", eq));
  }

  // Age group chips (static)
  const ageContainer = document.getElementById("filter-chips-age");
  ageContainer.innerHTML = "";
  for (const { value, label, emoji } of [
    { value: "toddlers", label: "Toddlers (1–4 yrs)",     emoji: "👶" },
    { value: "young",    label: "Young children (1–7 yrs)", emoji: "🧒" },
    { value: "school",   label: "School age (4–12 yrs)",  emoji: "🏫" },
    { value: "all",      label: "All ages",               emoji: "👨‍👩‍👧" },
  ]) {
    ageContainer.appendChild(makeChip(emoji, label, "age", value));
  }

  // Facility chips (dynamic)
  const facOptions = getFacilityOptions(playgrounds);
  const facContainer = document.getElementById("filter-chips-facilities");
  facContainer.innerHTML = "";
  for (const fac of facOptions) {
    facContainer.appendChild(makeChip(FACILITY_EMOJI[fac] || "📍", fac, "facilities", fac));
  }
  document.getElementById("filter-group-facilities").classList.toggle("hidden", facOptions.length === 0);

  // Accessibility chips (static)
  const accessContainer = document.getElementById("filter-chips-accessibility");
  accessContainer.innerHTML = "";
  accessContainer.appendChild(makeChip("♿", "Wheelchair accessible", "accessibility", "wheelchair"));
  accessContainer.appendChild(makeChip("🔒", "Fenced",              "accessibility", "fenced"));

  updateFilterBadge();
}

function makeChip(emoji, label, group, value) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "filter-chip";
  btn.dataset.group = group;
  btn.dataset.value = value;

  const emojiSpan = document.createElement("span");
  emojiSpan.className = "fc-emoji";
  emojiSpan.textContent = emoji;

  const labelSpan = document.createElement("span");
  labelSpan.textContent = label;

  btn.appendChild(emojiSpan);
  btn.append(" ");
  btn.appendChild(labelSpan);

  if (filterState[group]?.has(value)) btn.classList.add("active");

  btn.addEventListener("click", () => {
    const set = filterState[group];
    if (!set) return;
    if (set.has(value)) {
      set.delete(value);
      btn.classList.remove("active");
    } else {
      set.add(value);
      btn.classList.add("active");
    }
    updateFilterBadge();
    applyFiltersAndRender();
  });

  return btn;
}

function updateFilterBadge() {
  const count = countActiveFilters();
  const badge = document.getElementById("filter-active-badge");
  const clearBtn = document.getElementById("filter-clear-btn");
  if (count > 0) {
    badge.textContent = count;
    badge.classList.remove("hidden");
    clearBtn.classList.remove("hidden");
  } else {
    badge.classList.add("hidden");
    clearBtn.classList.add("hidden");
  }
}

function applyFiltersAndRender() {
  const filtered = applyFilters(state.playgrounds);
  const total = state.playgrounds.length;

  // Update result count
  const countEl = document.getElementById("result-count");
  countEl.classList.remove("hidden");
  if (hasActiveFilters()) {
    countEl.textContent = `Showing ${filtered.length} of ${total} playground${total !== 1 ? "s" : ""}`;
  } else {
    countEl.textContent = `Found ${total} playground${total !== 1 ? "s" : ""}`;
  }

  // Update showing label in filter bar
  const showingEl = document.getElementById("filter-showing");
  if (hasActiveFilters()) {
    showingEl.textContent = `${filtered.length} of ${total} shown`;
    showingEl.classList.remove("hidden");
  } else {
    showingEl.classList.add("hidden");
  }

  // Render cards
  const listSection = document.getElementById("results-section");
  const list = document.getElementById("playground-list");

  if (filtered.length === 0) {
    listSection.classList.remove("hidden");
    list.innerHTML = `
      <div class="no-filter-results">
        <span class="nfr-icon">🔍</span>
        <p>No playgrounds match your current filters.</p>
        <button type="button" id="clear-filters-inline">Clear filters</button>
      </div>`;
    document.getElementById("clear-filters-inline").addEventListener("click", () => {
      clearFilters();
      document.querySelectorAll(".filter-chip.active").forEach((c) => c.classList.remove("active"));
      updateFilterBadge();
      applyFiltersAndRender();
    });
  } else {
    listSection.classList.remove("hidden");
    renderPlaygroundList(filtered, (id) => highlightPlayground(state.mapInstance, id));
  }

  // Update map to reflect filtered results
  if (state.mapInstance && state.userLat !== null) {
    updateMap(
      state.mapInstance,
      { lat: state.userLat, lon: state.userLon },
      filtered,
      state.radius,
      formatDistance,
      (id) => scrollToCard(id)
    );
  }
}

function showNoResults(radius) {
  const errorEl = document.getElementById("error-message");

  if (radius < 10000) {
    const nextRadius = radius < 5000 ? 5000 : 10000;
    const nextLabel = radius < 5000 ? "5 km" : "10 km";

    errorEl.innerHTML = `No playgrounds found within this radius.
      <button id="expand-radius-btn" type="button" style="
        margin-left: 0.5rem; padding: 0.3rem 0.75rem; font-size: 0.85rem;
        background: #d32f2f; color: white; border: none; border-radius: 4px;
        cursor: pointer;">Try ${nextLabel}</button>`;
    errorEl.classList.remove("hidden");
    document.getElementById("status-section").classList.remove("hidden");

    document
      .getElementById("expand-radius-btn")
      .addEventListener("click", () => {
        document
          .querySelectorAll(".radius-btn")
          .forEach((b) => b.classList.remove("active"));
        document
          .querySelector(`.radius-btn[data-radius="${nextRadius}"]`)
          .classList.add("active");

        state.radius = nextRadius;
        performSearch(state.userLat, state.userLon, nextRadius);
      });
  } else {
    showError("No playgrounds found within 10 km. Try a different location.");
  }
}

function setButtonsDisabled(disabled) {
  document.getElementById("geolocate-btn").disabled = disabled;
  document.getElementById("search-btn").disabled = disabled;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
