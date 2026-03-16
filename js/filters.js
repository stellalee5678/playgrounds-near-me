export const filterState = {
  equipment: new Set(),
  age: new Set(),
  facilities: new Set(),
  accessibility: new Set(),
};

export function hasActiveFilters() {
  return (
    filterState.equipment.size > 0 ||
    filterState.age.size > 0 ||
    filterState.facilities.size > 0 ||
    filterState.accessibility.size > 0
  );
}

export function countActiveFilters() {
  return (
    filterState.equipment.size +
    filterState.age.size +
    filterState.facilities.size +
    filterState.accessibility.size
  );
}

export function clearFilters() {
  filterState.equipment.clear();
  filterState.age.clear();
  filterState.facilities.clear();
  filterState.accessibility.clear();
}

/**
 * Apply active filters to a playground list.
 * Within a group: OR (match any selected value).
 * Between groups: AND (must pass all active groups).
 */
export function applyFilters(playgrounds) {
  if (!hasActiveFilters()) return playgrounds;

  return playgrounds.filter((pg) => {
    if (filterState.equipment.size > 0) {
      const ok = [...filterState.equipment].some((eq) => pg.features.includes(eq));
      if (!ok) return false;
    }

    if (filterState.age.size > 0) {
      if (!matchesAgeFilter(pg)) return false;
    }

    if (filterState.facilities.size > 0) {
      const ok = [...filterState.facilities].some((fac) =>
        pg.nearbyFacilities?.some((f) => f.label === fac)
      );
      if (!ok) return false;
    }

    if (filterState.accessibility.has("wheelchair") && pg.wheelchair !== "yes") return false;
    if (filterState.accessibility.has("fenced") && pg.fenced !== "yes") return false;

    return true;
  });
}

function matchesAgeFilter(pg) {
  if (!pg.ageGroup) return false;
  const label = pg.ageGroup.label.toLowerCase();

  for (const f of filterState.age) {
    if (f === "toddlers" && (label.includes("toddler") || label.includes("1\u20134"))) return true;
    if (f === "young"    && (label.includes("young")   || label.includes("1\u20136") || label.includes("2\u20137"))) return true;
    if (f === "school"   && (label.includes("children") || label.includes("older") || label.includes("4\u201310") || label.includes("6\u201312"))) return true;
    if (f === "all"      && label.includes("all ages")) return true;
  }
  return false;
}

/** Unique equipment types present in the current results, sorted. */
export function getEquipmentOptions(playgrounds) {
  const all = new Set();
  for (const pg of playgrounds) for (const f of pg.features) all.add(f);
  return [...all].sort();
}

/** Unique facility labels present in the current results, sorted. */
export function getFacilityOptions(playgrounds) {
  const all = new Set();
  for (const pg of playgrounds) for (const f of pg.nearbyFacilities ?? []) all.add(f.label);
  return [...all].sort();
}
