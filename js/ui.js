import { formatDistance, formatFeatureName } from "./utils.js";

const FEATURE_EMOJI = {
  Slides: "\uD83D\uDEDD",
  Swings: "\uD83C\uDFA0",
  Climbing: "\uD83E\uDDD7",
  Sandbox: "\u23F3",
  Roundabout: "\uD83D\uDD35",
  Seesaw: "\u2696\uFE0F",
  "Spring Riders": "\uD83D\uDC0E",
  Balance: "\uD83E\uDD38",
  Zipline: "\uD83E\uDE62",
  Trampoline: "\uD83E\uDD3E",
  "Water Play": "\uD83D\uDCA7",
  Playhouse: "\uD83C\uDFE0",
  "Multi-Play Structure": "\uD83C\uDFD7\uFE0F",
};

export function showLoading() {
  document.getElementById("status-section").classList.remove("hidden");
  document.getElementById("loading-indicator").classList.remove("hidden");
  document.getElementById("error-message").classList.add("hidden");
  document.getElementById("result-count").classList.add("hidden");
}

export function hideLoading() {
  document.getElementById("loading-indicator").classList.add("hidden");
}

export function showError(message) {
  const el = document.getElementById("error-message");
  el.textContent = message;
  el.classList.remove("hidden");
  document.getElementById("status-section").classList.remove("hidden");
}

export function showResultCount(count) {
  const el = document.getElementById("result-count");
  el.textContent =
    count === 0
      ? "No playgrounds found"
      : `Found ${count} playground${count !== 1 ? "s" : ""}`;
  el.classList.remove("hidden");
}

/**
 * Scroll to and highlight the playground card matching the given id.
 * Called when the user clicks a map marker or the "View details" popup button.
 */
export function scrollToCard(id) {
  // Clear any previously highlighted card
  document.querySelectorAll(".playground-card.card-highlighted").forEach((el) => {
    el.classList.remove("card-highlighted");
  });

  const card = document.querySelector(`.playground-card[data-id="${CSS.escape(id)}"]`);
  if (!card) return;

  card.classList.add("card-highlighted");
  card.scrollIntoView({ behavior: "smooth", block: "center" });
}

export function clearResults() {
  document.getElementById("playground-list").innerHTML = "";
  document.getElementById("results-section").classList.add("hidden");
  document.getElementById("error-message").classList.add("hidden");
  document.getElementById("result-count").classList.add("hidden");
}

/**
 * Update the name shown on a single playground card in-place.
 * Called by the lazy reverse-geocoding enrichment process.
 * @param {string} id - playground id (e.g. "way-12345")
 * @param {string} name
 */
export function updatePlaygroundName(id, name) {
  const card = document.querySelector(
    `.playground-card[data-id="${CSS.escape(id)}"]`
  );
  if (!card) return;
  const nameEl = card.querySelector(".card-name");
  if (nameEl) nameEl.textContent = name;
}

/**
 * Render the list of playground cards.
 * @param {Array} playgrounds
 * @param {function} onShowOnMap - callback(playgroundId)
 */
export function renderPlaygroundList(playgrounds, onShowOnMap) {
  const container = document.getElementById("playground-list");
  container.innerHTML = "";

  for (const pg of playgrounds) {
    const card = document.createElement("article");
    card.className = "playground-card";
    card.dataset.id = pg.id;

    const name = escapeHtml(pg.name || "Unnamed Playground");
    const distHtml =
      pg.distance !== null
        ? `<span class="card-distance">${formatDistance(pg.distance)}</span>`
        : "";

    // --- Equipment features ---
    const featuresHtml =
      pg.features.length > 0
        ? pg.features
            .map((f) => {
              const emoji = FEATURE_EMOJI[f] || "\uD83C\uDFAA";
              return `<span class="feature-pill">${emoji} ${escapeHtml(f)}</span>`;
            })
            .join("")
        : '<span class="no-data">Equipment details not available</span>';

    // --- Age / meta badges ---
    let metaHtml = "";

    if (pg.ageGroup) {
      const inferredClass = pg.ageGroup.inferred ? " inferred" : "";
      const inferredTitle = pg.ageGroup.inferred
        ? ' title="Estimated from equipment types"'
        : "";
      metaHtml += `<span class="age-badge${inferredClass}"${inferredTitle}>${escapeHtml(
        pg.ageGroup.label
      )}${pg.ageGroup.inferred ? " \u2248" : ""}</span>`;
    }

    if (pg.operator) {
      metaHtml += `<span class="operator-badge">${escapeHtml(pg.operator)}</span>`;
    }
    if (pg.surface) {
      metaHtml += `<span class="surface-badge">${escapeHtml(
        formatFeatureName(pg.surface)
      )}</span>`;
    }
    if (pg.fenced === "yes") {
      metaHtml += '<span class="fenced-badge">Fenced</span>';
    }
    if (pg.wheelchair === "yes") {
      metaHtml += '<span class="accessible-badge">Wheelchair Accessible</span>';
    }
    if (pg.openingHours) {
      metaHtml += `<span class="hours-badge">\uD83D\uDD54 ${escapeHtml(pg.openingHours)}</span>`;
    }

    // --- Nearby facilities ---
    const facilitiesHtml = pg.nearbyFacilities?.length > 0
      ? pg.nearbyFacilities
          .map(f => `<span class="facility-pill">${f.emoji} ${escapeHtml(f.label)}<span class="facility-dist">${f.distance}m</span></span>`)
          .join("")
      : "";

    // --- Description snippet ---
    const descHtml = pg.description
      ? `<p class="card-description">${escapeHtml(pg.description)}</p>`
      : "";

    // --- Street address line ---
    const addrHtml = pg.streetAddress
      ? `<p class="card-address">\uD83D\uDCCD ${escapeHtml(pg.streetAddress)}</p>`
      : "";

    card.innerHTML = `
      <div class="card-header">
        <h3 class="card-name">${name}</h3>
        ${distHtml}
      </div>
      <div class="card-features">${featuresHtml}</div>
      ${metaHtml ? `<div class="card-meta">${metaHtml}</div>` : ""}
      ${facilitiesHtml ? `<div class="card-facilities"><span class="facilities-label">Nearby</span>${facilitiesHtml}</div>` : ""}
      ${descHtml}
      ${addrHtml}
      <div class="card-footer">
        <button class="show-on-map-btn" data-id="${pg.id}" type="button">
          <svg class="map-btn-icon" width="10" height="13" viewBox="0 0 10 13" fill="currentColor" aria-hidden="true">
            <path d="M5 0C2.24 0 0 2.24 0 5c0 3.75 5 8 5 8s5-4.25 5-8c0-2.76-2.24-5-5-5zm0 6.75A1.75 1.75 0 1 1 5 3.25a1.75 1.75 0 0 1 0 3.5z"/>
          </svg>
          Show on map
        </button>
        <a href="https://www.openstreetmap.org/${validateOsmType(pg.type)}/${encodeURIComponent(pg.osmId)}"
           target="_blank" rel="noopener noreferrer" class="osm-link">OpenStreetMap</a>
      </div>
    `;

    container.appendChild(card);
  }

  // Wire up "Show on map" buttons
  container.querySelectorAll(".show-on-map-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (onShowOnMap) onShowOnMap(btn.dataset.id);
    });
  });
}

const VALID_OSM_TYPES = new Set(["node", "way", "relation"]);

function validateOsmType(type) {
  return VALID_OSM_TYPES.has(type) ? type : "node";
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}
