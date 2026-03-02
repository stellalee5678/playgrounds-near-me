/**
 * Get user's current position via Browser Geolocation API.
 * @returns {Promise<{lat: number, lon: number}>}
 */
export function getCurrentLocation() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(
        new Error(
          "Geolocation is not supported by your browser. Please enter an address instead."
        )
      );
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          lat: position.coords.latitude,
          lon: position.coords.longitude,
        });
      },
      (error) => {
        switch (error.code) {
          case error.PERMISSION_DENIED:
            reject(
              new Error(
                "Location access denied. Please allow location access or enter an address."
              )
            );
            break;
          case error.POSITION_UNAVAILABLE:
            reject(
              new Error(
                "Location information unavailable. Please enter an address instead."
              )
            );
            break;
          case error.TIMEOUT:
            reject(
              new Error(
                "Location request timed out. Please try again or enter an address."
              )
            );
            break;
          default:
            reject(new Error("An unknown error occurred getting your location."));
        }
      },
      {
        enableHighAccuracy: false,
        timeout: 10000,
        maximumAge: 300000,
      }
    );
  });
}

/**
 * Geocode an address string using Nominatim.
 * @param {string} query
 * @returns {Promise<{lat: number, lon: number, displayName: string}>}
 */
export async function geocodeAddress(query) {
  if (!query || query.trim().length < 3) {
    throw new Error("Please enter a valid address (at least 3 characters).");
  }

  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", query.trim());
  url.searchParams.set("format", "json");
  url.searchParams.set("limit", "1");
  url.searchParams.set("addressdetails", "0");

  const response = await fetch(url.toString(), {
    headers: {
      "User-Agent": "PlaygroundsNearMe/1.0 (personal-project)",
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    if (response.status === 429) {
      throw new Error("Too many requests. Please wait a moment and try again.");
    }
    throw new Error(`Geocoding failed (HTTP ${response.status}).`);
  }

  const results = await response.json();

  if (!results || results.length === 0) {
    throw new Error(
      "Address not found. Please try a more specific address."
    );
  }

  const lat = parseFloat(results[0].lat);
  const lon = parseFloat(results[0].lon);

  if (!isFinite(lat) || !isFinite(lon) ||
      lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    throw new Error("Invalid coordinates returned by geocoding service.");
  }

  return { lat, lon, displayName: results[0].display_name };
}

/**
 * Reverse-geocode coordinates to a human-readable name using Nominatim.
 * Returns a string like "Playground on Oak Street" or null if unavailable.
 *
 * Caller is responsible for rate-limiting (≤1 request per second).
 *
 * @param {number} lat
 * @param {number} lon
 * @returns {Promise<string|null>}
 */
export async function reverseGeocode(lat, lon) {
  const url = new URL("https://nominatim.openstreetmap.org/reverse");
  url.searchParams.set("lat", lat);
  url.searchParams.set("lon", lon);
  url.searchParams.set("format", "json");
  url.searchParams.set("zoom", "16"); // street level

  try {
    const response = await fetch(url.toString(), {
      headers: {
        "User-Agent": "PlaygroundsNearMe/1.0 (personal-project)",
        Accept: "application/json",
      },
    });

    if (!response.ok) return null;

    const data = await response.json();
    const addr = data.address;
    if (!addr) return null;

    // Prefer road name → suburb/neighbourhood → city
    const road =
      addr.road ||
      addr.pedestrian ||
      addr.path ||
      addr.footway ||
      addr.cycleway;
    const area =
      addr.suburb ||
      addr.neighbourhood ||
      addr.quarter ||
      addr.village ||
      addr.town ||
      addr.city;

    if (road) return `Playground on ${road}`;
    if (area) return `Playground in ${area}`;
  } catch (_) {
    // Network error or parse failure — fail silently
  }

  return null;
}
