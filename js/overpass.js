import { formatFeatureName, haversineDistance } from "./utils.js";

const OVERPASS_ENDPOINT = "https://overpass-api.de/api/interpreter";

// Max distance (in metres) from a playground centre to still claim an
// equipment node belongs to that playground.  150 m covers even large parks.
const EQUIPMENT_PROXIMITY_M = 150;

// Max distance to associate a nearby amenity/facility with a playground.
const FACILITY_PROXIMITY_M = 200;

const FACILITY_TYPES = {
  "amenity:toilets":        { label: "Toilets",        emoji: "🚻" },
  "amenity:bbq":            { label: "BBQ",             emoji: "🍖" },
  "leisure:bbq":            { label: "BBQ",             emoji: "🍖" },
  "amenity:drinking_water": { label: "Drinking Water",  emoji: "💧" },
  "amenity:shelter":        { label: "Shelter",         emoji: "⛺" },
  "amenity:fountain":       { label: "Fountain",        emoji: "⛲" },
  "leisure:pitch":          { label: "Sports Pitch",    emoji: "⚽" },
  "leisure:sports_field":   { label: "Sports Field",    emoji: "🏃" },
  "natural:water":          { label: "Water Feature",   emoji: "🌊" },
};

const EQUIPMENT_CATEGORIES = {
  Slides: ["slide", "slide_pole", "tube_slide", "spiral_slide"],
  Swings: [
    "swing",
    "baby_swing",
    "basketswing",
    "tire_swing",
    "rope_swing",
    "nest_swing",
  ],
  Climbing: [
    "climbingframe",
    "climbing_frame",
    "climbingwall",
    "climbing_slope",
    "climbing_pole",
    "monkey_bars",
    "climbing",
    "net_climber",
    "climbing_net",
    "spider_net",
    "pole",
  ],
  Sandbox: ["sandpit", "sand_wheel", "sand_seesaw", "excavator", "sand"],
  Roundabout: [
    "roundabout",
    "basketrotator",
    "aerialrotator",
    "spinner",
    "spinning_disc",
    "rotator",
  ],
  Seesaw: ["seesaw", "rotating_seesaw"],
  "Spring Riders": ["springy", "spring_rider"],
  Balance: [
    "balancebeam",
    "rope_traverse",
    "stepping_stone",
    "stepping_post",
    "agility_trail",
    "balance",
  ],
  Zipline: ["zipwire", "zipline"],
  Trampoline: ["trampoline", "cushion"],
  "Water Play": [
    "splash_pad",
    "pump",
    "water_channel",
    "water_stream",
    "water",
    "water_play",
  ],
  Playhouse: ["playhouse", "tunnel_tube", "tunnel"],
  "Multi-Play Structure": ["structure", "multiplay"],
};

/**
 * Fetch playgrounds from Overpass API within a radius of the given coordinates.
 * @param {number} lat
 * @param {number} lon
 * @param {number} radiusMeters
 * @returns {Promise<Array>} parsed playground objects
 */
export async function fetchPlaygrounds(lat, lon, radiusMeters) {
  const query = buildOverpassQuery(lat, lon, radiusMeters);

  const response = await fetch(OVERPASS_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `data=${encodeURIComponent(query)}`,
  });

  if (!response.ok) {
    if (response.status === 429) {
      throw new Error(
        "Overpass API rate limit reached. Please wait a minute and try again."
      );
    }
    if (response.status === 504) {
      throw new Error("Query timed out. Try a smaller search radius.");
    }
    throw new Error(
      `Failed to fetch playground data (HTTP ${response.status}).`
    );
  }

  const data = await response.json();
  return parsePlaygrounds(data.elements);
}

function buildOverpassQuery(lat, lon, radius) {
  // Phase 1: Fetch all leisure=playground features in the radius.
  // Phase 2: Fetch ALL playground=* equipment nodes in the same radius.
  //
  // WHY this approach:
  //   In OSM, playground equipment (slides, swings, etc.) is typically mapped
  //   as STANDALONE nodes positioned inside the playground polygon. They are
  //   NOT formal members of the playground way, so `node(w.playgrounds)` only
  //   returned the polygon's boundary vertices — never the equipment.
  //   We now fetch all equipment nodes area-wide and match them to their
  //   nearest playground by straight-line distance on the client side.
  return `
[out:json][timeout:45];
(
  node["leisure"="playground"](around:${radius},${lat},${lon});
  way["leisure"="playground"](around:${radius},${lat},${lon});
  relation["leisure"="playground"](around:${radius},${lat},${lon});
)->.playgrounds;
.playgrounds out body center;
(
  node["playground"](around:${radius},${lat},${lon});
  way["playground"][!"leisure"](around:${radius},${lat},${lon});
)->.allequipment;
.allequipment out body center;
(
  node["amenity"="toilets"](around:${radius},${lat},${lon});
  node["amenity"="bbq"](around:${radius},${lat},${lon});
  node["leisure"="bbq"](around:${radius},${lat},${lon});
  node["amenity"="drinking_water"](around:${radius},${lat},${lon});
  node["amenity"="shelter"](around:${radius},${lat},${lon});
  node["amenity"="fountain"](around:${radius},${lat},${lon});
  node["leisure"="pitch"](around:${radius},${lat},${lon});
  way["leisure"="pitch"](around:${radius},${lat},${lon});
  node["leisure"="sports_field"](around:${radius},${lat},${lon});
  way["leisure"="sports_field"](around:${radius},${lat},${lon});
  node["natural"="water"](around:${radius},${lat},${lon});
  way["natural"="water"](around:${radius},${lat},${lon});
)->.allfacilities;
.allfacilities out body center;
  `.trim();
}

function getFacilityType(tags) {
  if (!tags) return null;
  const { amenity, leisure, natural } = tags;
  if (amenity && FACILITY_TYPES[`amenity:${amenity}`]) return FACILITY_TYPES[`amenity:${amenity}`];
  if (leisure && FACILITY_TYPES[`leisure:${leisure}`]) return FACILITY_TYPES[`leisure:${leisure}`];
  if (natural && FACILITY_TYPES[`natural:${natural}`]) return FACILITY_TYPES[`natural:${natural}`];
  return null;
}

function parsePlaygrounds(elements) {
  const playgrounds = [];
  const equipmentNodes = [];
  const facilityNodes = [];
  const seenFacilityIds = new Set();

  for (const el of elements) {
    if (el.tags && el.tags.leisure === "playground") {
      // This is a playground area / node
      playgrounds.push(el);
    } else if (
      el.tags &&
      el.tags.playground &&
      el.tags.playground !== "yes" &&
      !el.tags.leisure
    ) {
      // This is an equipment piece (node or way) — normalise coordinates.
      // Nodes carry lat/lon directly; ways carry a center object (out center).
      const eqLat = el.lat ?? el.center?.lat;
      const eqLon = el.lon ?? el.center?.lon;
      if (eqLat !== undefined && eqLon !== undefined) {
        equipmentNodes.push({ tags: el.tags, lat: eqLat, lon: eqLon });
      }
    } else {
      // Check if it's a known facility/amenity
      const facType = getFacilityType(el.tags);
      if (facType) {
        const uid = `${el.type}-${el.id}`;
        if (!seenFacilityIds.has(uid)) {
          seenFacilityIds.add(uid);
          const lat = el.type === "node" ? el.lat : el.center?.lat ?? null;
          const lon = el.type === "node" ? el.lon : el.center?.lon ?? null;
          if (lat !== null && lon !== null) {
            facilityNodes.push({ uid, lat, lon, label: facType.label, emoji: facType.emoji });
          }
        }
      }
    }
  }

  return playgrounds
    .map((pg) => {
      const pgLat = pg.type === "node" ? pg.lat : pg.center?.lat ?? null;
      const pgLon = pg.type === "node" ? pg.lon : pg.center?.lon ?? null;

      if (pgLat === null || pgLon === null) return null;

      const rawFeatures = new Set();

      // 1. Check playground's own tags for inline equipment info
      if (pg.tags.playground && pg.tags.playground !== "yes") {
        splitTagValue(pg.tags.playground).forEach((v) => rawFeatures.add(v));
      }

      // 2. Spatial proximity matching: assign equipment nodes that are within
      //    EQUIPMENT_PROXIMITY_M metres of this playground's centre.
      for (const eq of equipmentNodes) {
        const dist = haversineDistance(pgLat, pgLon, eq.lat, eq.lon);
        if (dist <= EQUIPMENT_PROXIMITY_M) {
          // OSM values can be semicolon-separated: "slide;climbing_frame"
          splitTagValue(eq.tags.playground).forEach((v) => rawFeatures.add(v));
        }
      }

      const features = categorizeFeatures([...rawFeatures]);
      const ageGroup = resolveAgeGroup(pg.tags, features);

      // Associate nearby facilities within FACILITY_PROXIMITY_M metres
      const nearbyFacilities = [];
      const seenFac = new Set();
      for (const fac of facilityNodes) {
        const dist = haversineDistance(pgLat, pgLon, fac.lat, fac.lon);
        if (dist <= FACILITY_PROXIMITY_M && !seenFac.has(fac.uid)) {
          seenFac.add(fac.uid);
          nearbyFacilities.push({ ...fac, distance: Math.round(dist) });
        }
      }
      nearbyFacilities.sort((a, b) => a.distance - b.distance);

      // Build name with fallback chain
      const name =
        pg.tags.name ||
        pg.tags["name:en"] ||
        null;

      // Secondary info available from OSM tags
      const description = pg.tags.description
        ? pg.tags.description.slice(0, 140) +
          (pg.tags.description.length > 140 ? "…" : "")
        : null;

      const operator = pg.tags.operator || null;

      // Street address if tagged
      const streetAddress = buildAddress(pg.tags);

      return {
        id: `${pg.type}-${pg.id}`,
        osmId: pg.id,
        type: pg.type,
        lat: pgLat,
        lon: pgLon,
        name,
        description,
        operator,
        streetAddress,
        features,
        ageGroup,
        surface: pg.tags.surface || null,
        wheelchair: pg.tags.wheelchair || null,
        fenced: pg.tags.fenced || null,
        access: pg.tags.access || null,
        openingHours: pg.tags.opening_hours || null,
        nearbyFacilities,
        distance: null,
      };
    })
    .filter((pg) => pg !== null);
}

/** Split a potentially semicolon-separated OSM tag value into an array. */
function splitTagValue(value) {
  return value
    .split(";")
    .map((v) => v.trim())
    .filter((v) => v.length > 0 && v !== "yes");
}

function categorizeFeatures(rawFeatures) {
  const categories = [];
  const matched = new Set();

  for (const [categoryName, tagValues] of Object.entries(EQUIPMENT_CATEGORIES)) {
    for (const feature of rawFeatures) {
      if (tagValues.includes(feature) && !matched.has(categoryName)) {
        categories.push(categoryName);
        matched.add(categoryName);
      }
    }
  }

  // Any tag value not in a known category → format and include as-is
  for (const feature of rawFeatures) {
    const known = Object.values(EQUIPMENT_CATEGORIES).some((vals) =>
      vals.includes(feature)
    );
    if (!known) {
      categories.push(formatFeatureName(feature));
    }
  }

  return categories;
}

/**
 * Determine age group from explicit OSM tags first, then infer from equipment.
 * Inferred labels are flagged so the UI can distinguish them.
 */
function resolveAgeGroup(tags, features) {
  // Explicit OSM tags win
  const minAge = tags.min_age ? parseInt(tags.min_age, 10) : null;
  const maxAge = tags.max_age ? parseInt(tags.max_age, 10) : null;

  if (minAge !== null && maxAge !== null) {
    return {
      label: `Ages ${minAge}\u2013${maxAge}`,
      inferred: false,
    };
  }
  if (minAge !== null) {
    return { label: `Ages ${minAge}+`, inferred: false };
  }
  if (maxAge !== null) {
    return { label: `Up to age ${maxAge}`, inferred: false };
  }

  // Infer from equipment categories
  if (features.length === 0) return null;

  const hasToddler = features.some((f) =>
    ["Sandbox", "Spring Riders"].includes(f)
  );
  const hasYoung = features.some((f) =>
    ["Slides", "Swings", "Playhouse"].includes(f)
  );
  const hasSchoolAge = features.some((f) =>
    ["Climbing", "Seesaw", "Roundabout", "Balance", "Multi-Play Structure"].includes(f)
  );
  const hasOlder = features.some((f) => ["Zipline", "Trampoline"].includes(f));

  if (hasOlder && (hasToddler || hasYoung || hasSchoolAge)) {
    return { label: "All ages (2\u201312+ yrs)", inferred: true };
  }
  if (hasOlder) {
    return { label: "Older children (6\u201312+ yrs)", inferred: true };
  }
  if (hasSchoolAge && hasToddler) {
    return { label: "All ages (2\u201310 yrs)", inferred: true };
  }
  if (hasSchoolAge) {
    return { label: "Children (4\u201310 yrs)", inferred: true };
  }
  if (hasYoung && hasToddler) {
    return { label: "Young children (1\u20136 yrs)", inferred: true };
  }
  if (hasYoung) {
    return { label: "Young children (2\u20137 yrs)", inferred: true };
  }
  if (hasToddler) {
    return { label: "Toddlers (1\u20134 yrs)", inferred: true };
  }

  return null;
}

function buildAddress(tags) {
  const num = tags["addr:housenumber"] || "";
  const street = tags["addr:street"] || "";
  if (street) {
    return num ? `${num} ${street}` : street;
  }
  return null;
}
