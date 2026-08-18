/**
 * api/lib/zones.js
 * =================
 * Zone classification and Point-in-Polygon calculation
 * Supports dynamic zones from local_zones.json + Overlap Zones (e.g., AB, ABC)
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ZONES_DB_PATH = path.join(__dirname, '../../local_zones.json');

const DEFAULT_GEOJSON_ZONES = {
  "Zone A — เมืองลำพูน": [
    [18.4503, 98.96004],
    [18.57173, 98.94493],
    [18.58573, 98.90888],
    [18.62054, 98.86837],
    [18.66023, 98.88382],
    [18.72397, 98.94218],
    [18.72528, 99.0802],
    [18.73568, 99.12071],
    [18.72723, 99.16054],
    [18.6869, 99.18285],
    [18.66121, 99.16878],
    [18.65161, 99.16346],
    [18.64185, 99.16346],
    [18.61583, 99.17496],
    [18.58215, 99.12827],
    [18.48482, 99.11591]
  ],
  "Zone B — หางดง/เชียงใหม่": [
    [18.68658, 98.98819],
    [18.6856, 98.92467],
    [18.61176, 98.89996],
    [18.62054, 98.87318],
    [18.66056, 98.86837],
    [18.85, 98.9],
    [18.95273, 98.99059],
    [18.91603, 99.07265],
    [18.87185, 99.15607],
    [18.79289, 99.18526],
    [18.76299, 99.23641],
    [18.74966, 99.2625],
    [18.74023, 99.25907],
    [18.71324, 99.19933],
    [18.66023, 99.17976],
    [18.65991, 99.07951]
  ],
  "Zone C — ป่าซาง": [
    [18.39362, 98.96965],
    [18.40079, 98.87901],
    [18.33106, 98.80211],
    [18.35, 98.75],
    [18.48, 98.75],
    [18.52714, 98.84193],
    [18.55904, 98.94562],
    [18.55644, 98.9978],
    [18.51477, 99.0287],
    [18.41447, 99.0699]
  ],
  "Zone D - ทาปลาดุก": [
    [18.4503, 98.9621],
    [18.48742, 99.1317],
    [18.61436, 99.25529],
    [18.60005, 99.29787],
    [18.43662, 99.17015],
    [18.39688, 98.96965],
    [18.40926, 98.93944],
    [18.4249, 98.93875],
    [18.43597, 98.96416]
  ]
};

function getActiveZones() {
  try {
    if (fs.existsSync(ZONES_DB_PATH)) {
      const data = JSON.parse(fs.readFileSync(ZONES_DB_PATH, 'utf8'));
      if (Array.isArray(data.zones) && data.zones.length > 0) {
        return data;
      }
    }
  } catch (e) {
    console.warn('[zones.js] Warning reading local_zones.json:', e.message);
  }

  // Fallback to default
  const fallbackZones = Object.entries(DEFAULT_GEOJSON_ZONES).map(([name, polygon]) => {
    const letter = name.match(/Zone ([A-Z])/i)?.[1] || 'A';
    return {
      id: `zone_${letter.toLowerCase()}`,
      letter,
      name,
      polygon
    };
  });

  return { zones: fallbackZones, overlapZones: [] };
}

function pointInPolygon(point, vs) {
  const x = point[0], y = point[1];
  let inside = false;
  for (let i = 0, j = vs.length - 1; i < vs.length; j = i++) {
    const xi = vs[i][0], yi = vs[i][1];
    const xj = vs[j][0], yj = vs[j][1];
    const intersect = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

function classifyOrderZone(lat, lng) {
  const latitude = parseFloat(lat);
  const longitude = parseFloat(lng);

  if (isNaN(latitude) || isNaN(longitude)) {
    return "UNASSIGNED";
  }

  // Check valid bounds (lat 17.9-19.3 / lng 98.4-99.6)
  if (latitude < 17.9 || latitude > 19.3 || longitude < 98.4 || longitude > 99.6) {
    return "UNASSIGNED";
  }

  const { zones, overlapZones } = getActiveZones();

  // Find all matched base zones
  const matchedLetters = [];
  const matchedZones = [];

  for (const zone of zones) {
    if (Array.isArray(zone.polygon) && zone.polygon.length >= 3) {
      if (pointInPolygon([latitude, longitude], zone.polygon)) {
        matchedLetters.push(zone.letter || 'A');
        matchedZones.push(zone);
      }
    }
  }

  if (matchedLetters.length === 0) {
    return "UNASSIGNED";
  }

  // Single zone match
  if (matchedLetters.length === 1) {
    return matchedZones[0].name || `Zone ${matchedLetters[0]}`;
  }

  // Multiple zones match -> Overlap zone (e.g. AB, ABC) sorted alphabetically
  const combo = Array.from(new Set(matchedLetters)).sort().join('');
  const foundOverlap = (overlapZones || []).find(oz => oz.letters === combo);
  if (foundOverlap && foundOverlap.name) {
    return foundOverlap.name;
  }

  return `Zone ${combo}`;
}

module.exports = {
  GEOJSON_ZONES: DEFAULT_GEOJSON_ZONES,
  getActiveZones,
  pointInPolygon,
  classifyOrderZone
};
