/* global L */

let markerLayer = null;
let radiusCircle = null;
let userMarker = null;

export function initMap(elementId) {
  const map = L.map(elementId, {
    zoomControl: true,
    scrollWheelZoom: true,
  }).setView([0, 0], 2);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 19,
  }).addTo(map);

  markerLayer = L.layerGroup().addTo(map);

  return map;
}

export function updateMap(map, center, playgrounds, radiusMeters, formatDistanceFn, onMarkerClick) {
  markerLayer.clearLayers();
  if (radiusCircle) radiusCircle.remove();
  if (userMarker) userMarker.remove();

  // User location marker
  userMarker = L.marker([center.lat, center.lon], {
    icon: createUserIcon(),
    zIndexOffset: 1000,
  }).addTo(map);
  userMarker.bindPopup("<strong>Your location</strong>");

  // Radius circle
  radiusCircle = L.circle([center.lat, center.lon], {
    radius: radiusMeters,
    color: "#2d7d46",
    fillColor: "#2d7d46",
    fillOpacity: 0.05,
    weight: 2,
    dashArray: "5, 10",
  }).addTo(map);

  // Playground markers
  for (const pg of playgrounds) {
    const marker = L.marker([pg.lat, pg.lon], {
      icon: createPlaygroundIcon(),
    });

    marker.bindPopup(createPopupContent(pg, formatDistanceFn));
    marker._playgroundId = pg.id;

    if (onMarkerClick) {
      // Scroll to + highlight the card when the balloon is clicked
      marker.on("click", () => onMarkerClick(pg.id));

      // Wire the "View details" button inside the popup once the popup is open
      marker.on("popupopen", () => {
        const btn = marker.getPopup().getElement()?.querySelector(".popup-details-btn");
        if (btn) btn.addEventListener("click", () => onMarkerClick(pg.id));
      });
    }

    markerLayer.addLayer(marker);
  }

  // Fit bounds to radius circle
  map.fitBounds(radiusCircle.getBounds(), { padding: [20, 20] });
}

export function highlightPlayground(map, playgroundId) {
  markerLayer.eachLayer((marker) => {
    if (marker._playgroundId === playgroundId) {
      map.setView(marker.getLatLng(), 17, { animate: true });
      marker.openPopup();
    }
  });
}

function createUserIcon() {
  return L.divIcon({
    className: "user-location-icon",
    html: '<div class="user-dot"></div><div class="user-pulse"></div>',
    iconSize: [30, 30],
    iconAnchor: [15, 15],
  });
}

function createPlaygroundIcon() {
  return L.divIcon({
    className: "playground-icon",
    html: '<div class="playground-marker"><span class="playground-marker-inner">P</span></div>',
    iconSize: [28, 28],
    iconAnchor: [14, 28],
    popupAnchor: [0, -28],
  });
}

function createPopupContent(pg, formatDistanceFn) {
  const name = pg.name || "Unnamed Playground";
  const distText =
    pg.distance !== null && formatDistanceFn
      ? formatDistanceFn(pg.distance)
      : "";
  const features =
    pg.features.length > 0
      ? pg.features
          .map((f) => `<span class="popup-feature">${escapeHtml(f)}</span>`)
          .join(" ")
      : "<em>Equipment info not available</em>";
  const age = pg.ageGroup
    ? `<div class="popup-age">${escapeHtml(pg.ageGroup.label)}</div>`
    : "";

  return `
    <div class="popup-content">
      <strong>${escapeHtml(name)}</strong>
      ${distText ? `<div class="popup-distance">${distText} away</div>` : ""}
      <div class="popup-features">${features}</div>
      ${age}
      <div class="popup-actions">
        <button class="popup-details-btn" type="button">View details ↓</button>
        <a href="https://www.openstreetmap.org/${validateOsmType(pg.type)}/${encodeURIComponent(pg.osmId)}"
           target="_blank" rel="noopener noreferrer">OpenStreetMap ↗</a>
      </div>
    </div>
  `;
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
