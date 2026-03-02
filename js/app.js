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

  renderPlaygroundList(state.playgrounds, (id) =>
    highlightPlayground(state.mapInstance, id)
  );
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
      document.getElementById("results-section").classList.remove("hidden");
      renderPlaygroundList(state.playgrounds, (id) =>
        highlightPlayground(state.mapInstance, id)
      );
      updateMap(
        state.mapInstance,
        { lat, lon },
        state.playgrounds,
        radius,
        formatDistance,
        (id) => scrollToCard(id)
      );

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
