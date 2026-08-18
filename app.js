/* =========================================================
   Unii Mart 584  —  Driver Route App
   Single Source of Truth Tokens & GeoJSON Point-in-Polygon Engine
   ========================================================= */

// Central Warehouse Hub (Lamphun / Chiang Mai)
const WAREHOUSE_HUB = {
  name: "Unii Mart Hub 584 (ศูนย์กระจายสินค้าหลัก)",
  lat: 18.56228949,
  lng: 99.04152043
};

// Defined GeoJSON Zones Polygons (Strict numeric Point-in-Polygon matching local_zones.json)
const GEOJSON_ZONES = {
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

// Driver Profiles (M1 Driver Authentication)
const DRIVER_PROFILES = {
  "DRV-A01": { code: "DRV-A01", name: "สมชาย จัดส่ง", zone: "Zone A  —  เมืองลำพูน", pin: "1111", avatar: "A01" },
  "DRV-B02": { code: "DRV-B02", name: "วิชั ขับเร็", zone: "Zone B  —  สารภี/เชียงใหม่", pin: "2222", avatar: "B02" },
  "DRV-C03": { code: "DRV-C03", name: "สมศักดิ์ สุขใจ", zone: "Zone C  —  ป่าซาง", pin: "3333", avatar: "C03" },
  "DRV-S04": { code: "DRV-S04", name: "รชัย ยด่ว", zone: "ทุกโซน (ลอตใ้ / เก็บต / VVIP)", pin: "4444", avatar: "VIP", isSpecial: true }
};

// Application State Container
let state = {
  allOrders: [],
  orders: [],
  activeDriver: DRIVER_PROFILES["DRV-A01"],
  driverLocation: { lat: 18.56228949, lng: 99.04152043 }, // Active Driver GPS
  activeFilter: "all",
  selectedDate: null,
  sortByDistance: false,
  searchQuery: "",
  selectedOrderId: null,
  clusterGroups: {},
  m5SelectedOrder: null,
  driverGpsCaptured: null,
  activePodPhotos: { proof: [], slips: [] },
  
  // Core Stores
  _ORDER_OVERRIDE: {},
  _CUSTOMERS: {},
  _COD_COUNTED: {},
  _POD_REPORTS: {},
  
  // Product Master Integration Stores
  productMaster: {},
  _PRODUCT_PENDING: [],
  _PRODUCT_AUDIT: [],
  _PRODUCT_OVERRIDE: {}
};

// Leaflet Map Handles
let map;
let mapMarkers = {};
let zonePolygons = [];

// --- Initialize App ---
document.addEventListener("DOMContentLoaded", async () => {
  initMap();
  initEventListeners();
  loadStateFromLocalStorage();
  await loadDatabase();
  updatePrintDate();
});

// Route Code Generator (Column N "คนคนส่ง") e.g. DRV-A01-260813-0604
function generateRouteCode(driverObj, deliveryDateStr, orderDateStr) {
  const dCode = driverObj ? (driverObj.code || driverObj.name.slice(0, 3)) : "DRV";
  
  let delivYYMMDD = "260813";
  if (deliveryDateStr) {
    const p = deliveryDateStr.split("/");
    if (p.length === 3) {
      const mm = p[0].padStart(2, "0");
      const dd = p[1].padStart(2, "0");
      const yy = p[2].slice(-2);
      delivYYMMDD = `${yy}${mm}${dd}`;
    }
  }

  let orderMMDD = "0604";
  if (orderDateStr) {
    const parts = orderDateStr.split(" ")[0].split("/");
    if (parts.length >= 2) {
      const mm = parts[0].padStart(2, "0");
      const dd = parts[1].padStart(2, "0");
      orderMMDD = `${mm}${dd}`;
    }
  }

  return `${dCode}-${delivYYMMDD}-${orderMMDD}`;
}

// Clipboard Copy Helper
function copyToClipboard(text, e) {
  if (e) e.stopPropagation();
  if (!navigator.clipboard) {
    // Fallback
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    document.body.appendChild(textarea);
    textarea.select();
    try {
      document.execCommand("copy");
      showNotification("คัดลเลขคำ่งซื้อเรียบร้อยแล้ว: " + text, "done");
    } catch (err) {
      console.warn("Fallback copy failed:", err);
    }
    document.body.removeChild(textarea);
    return;
  }
  navigator.clipboard.writeText(text).then(() => {
    showNotification("คัดลเลขคำ่งซื้อเรียบร้อยแล้ว: " + text, "done");
  }).catch(err => {
    console.error("Failed to copy:", err);
  });
}

// LocalStorage Permanent Persistence Engine
function saveStateToLocalStorage() {
  try {
    localStorage.setItem("uflow_order_overrides", JSON.stringify(state._ORDER_OVERRIDE));
    localStorage.setItem("uflow_customers", JSON.stringify(state._CUSTOMERS));
    if (state.activeDriver) {
      localStorage.setItem("uflow_active_driver_code", state.activeDriver.code);
    }
    
    // Product Master persistence
    localStorage.setItem("uflow_product_pending", JSON.stringify(state._PRODUCT_PENDING || []));
    localStorage.setItem("uflow_product_audit", JSON.stringify(state._PRODUCT_AUDIT || []));
    localStorage.setItem("uflow_product_overrides", JSON.stringify(state._PRODUCT_OVERRIDE || {}));
  } catch (e) {
    console.warn("Error saving to localStorage:", e);
  }
}

function loadStateFromLocalStorage() {
  try {
    const savedOverrides = localStorage.getItem("uflow_order_overrides");
    state._ORDER_OVERRIDE = savedOverrides ? (JSON.parse(savedOverrides) || {}) : {};

    const savedCust = localStorage.getItem("uflow_customers");
    state._CUSTOMERS = savedCust ? (JSON.parse(savedCust) || {}) : {};

    const savedDriverCode = localStorage.getItem("uflow_active_driver_code");
    if (savedDriverCode && DRIVER_PROFILES[savedDriverCode]) {
      state.activeDriver = DRIVER_PROFILES[savedDriverCode];
    }
    
    // Product Master state restore
    state._PRODUCT_PENDING = JSON.parse(localStorage.getItem("uflow_product_pending") || "[]") || [];
    state._PRODUCT_AUDIT = JSON.parse(localStorage.getItem("uflow_product_audit") || "[]") || [];
    state._PRODUCT_OVERRIDE = JSON.parse(localStorage.getItem("uflow_product_overrides") || "{}") || {};
  } catch (e) {
    console.warn("Error loading from localStorage:", e);
  }
}

async function loadDatabase() {
  try {
    // 1. Fetch Dynamic Zones & Dynamic Drivers FIRST so login list has fresh driver data
    await Promise.all([
      loadDynamicZones(),
      loadDynamicDrivers()
    ]);

    // 2. Ensure active driver context
    let activeDriverCode = localStorage.getItem('uflow_active_driver_code') || (state.activeDriver ? state.activeDriver.code : 'DRV-A01');
    if (DRIVER_PROFILES[activeDriverCode]) {
      state.activeDriver = DRIVER_PROFILES[activeDriverCode];
    } else if (dynamicDrivers.length > 0) {
      state.activeDriver = dynamicDrivers[0];
      activeDriverCode = state.activeDriver.code;
    }
    updateDriverContextUI();

    let token = localStorage.getItem('uflow_jwt_token');

    // Auto-login to obtain token if missing
    if (!token) {
      try {
        const pin = (state.activeDriver && state.activeDriver.pin) || '1111';
        const loginRes = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: activeDriverCode, pin })
        });
        if (loginRes.ok) {
          const loginData = await loginRes.json();
          if (loginData.token) {
            token = loginData.token;
            localStorage.setItem('uflow_jwt_token', token);
            sessionStorage.setItem('uflow_driver_logged_in', '1');
            localStorage.setItem('uflow_active_driver_code', activeDriverCode);
          }
        }
      } catch (authErr) {
        console.warn('[loadDatabase] Auto login error:', authErr);
      }
    }

    let rawOrders = [];
    const isCCView = state.isAdminAuthenticated;
    const endpoint = isCCView
      ? `/api/supervisor/day?date=all`
      : `/api/driver/day?date=all`;
    
    if (token) {
      try {
        let res = await fetch(endpoint, {
          headers: { 'Authorization': `Bearer ${token}` }
        });

        if (res.status === 401) {
          console.warn("[loadDatabase] Session expired (401). Re-authenticating...");
          const pin = (state.activeDriver && state.activeDriver.pin) || '1111';
          const reloginRes = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: activeDriverCode, pin })
          });
          if (reloginRes.ok) {
            const reloginData = await reloginRes.json();
            token = reloginData.token;
            localStorage.setItem('uflow_jwt_token', token);
            sessionStorage.setItem('uflow_driver_logged_in', '1');
            res = await fetch(endpoint, { headers: { 'Authorization': `Bearer ${token}` } });
          }
        }

        if (res && res.ok) {
          const data = await res.json();
          if (data.success && Array.isArray(data.orders)) {
            rawOrders = data.orders;
          }
        }
      } catch (apiErr) {
        console.warn("[loadDatabase] API fetch error:", apiErr);
      }
    }

    // Fallback: If API returned empty, load local orders_data.json
    if (rawOrders.length === 0) {
      try {
        const localRes = await fetch('/orders_data.json');
        if (localRes.ok) {
          rawOrders = await localRes.json();
          console.log(`[loadDatabase] Loaded ${rawOrders.length} orders from fallback orders_data.json`);
        }
      } catch (localErr) {
        console.warn("[loadDatabase] Fallback error:", localErr);
      }
    }

    // Run GeoJSON Point-in-Polygon on raw orders using loaded dynamic zones
    state.allOrders = rawOrders.map(o => classifyOrderZone(o));
    console.log(`Loaded ${state.allOrders.length} orders.`);

    // Fetch SKU Details from Google Sheets via /api/sku-details (with fallback to sku_details.json)
    try {
      const skuRes = await fetch("/api/sku-details");
      if (skuRes.ok) {
        const skuData = await skuRes.json();
        if (skuData.success && skuData.skuDetails) {
          state.skuDetails = skuData.skuDetails;
        }
      }
      if (!state.skuDetails || Object.keys(state.skuDetails).length === 0) {
        const fallbackRes = await fetch("sku_details.json");
        if (fallbackRes.ok) state.skuDetails = await fallbackRes.json();
      }
    } catch (skuErr) {
      console.warn("Could not load /api/sku-details, trying fallback:", skuErr);
      try {
        const fallbackRes = await fetch("sku_details.json");
        if (fallbackRes.ok) state.skuDetails = await fallbackRes.json();
      } catch (e2) {}
    }

    // Fetch Product Master
    try {
      const pmRes = await fetch("product_master.json");
      if (pmRes.ok) {
        state.productMaster = await pmRes.json();
        // Merge overrides
        Object.keys(state._PRODUCT_OVERRIDE).forEach(rowId => {
          if (state.productMaster[rowId]) {
            state.productMaster[rowId] = { ...state.productMaster[rowId], ...state._PRODUCT_OVERRIDE[rowId] };
          }
        });
      }
    } catch (pmErr) {
      console.warn("Could not load product_master.json:", pmErr);
    }

    populateDateDropdown();
    renderGeoJsonZonePolygons();
    filterAndRender();
  } catch (err) {
    console.error("Error loading database:", err);
    state.allOrders = [];
    filterAndRender();
  }
}

let dynamicZones = [];
let dynamicOverlapZones = [];
let dynamicDrivers = [];

async function loadDynamicZones() {
  try {
    const res = await fetch('/api/zones');
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data.zones) && data.zones.length > 0) {
        dynamicZones = data.zones;
        dynamicOverlapZones = data.overlapZones || [];
        if (map) renderGeoJsonZonePolygons();
        return;
      }
    }
  } catch (e) {
    console.warn('[loadDynamicZones] API error:', e.message);
  }

  // Fallback to local_zones.json
  try {
    const localRes = await fetch('/local_zones.json');
    if (localRes.ok) {
      const data = await localRes.json();
      if (Array.isArray(data.zones) && data.zones.length > 0) {
        dynamicZones = data.zones;
        dynamicOverlapZones = data.overlapZones || [];
        if (map) renderGeoJsonZonePolygons();
      }
    }
  } catch (localErr) {
    console.warn('[loadDynamicZones] Local fallback error:', localErr.message);
  }
}

async function loadDynamicDrivers() {
  try {
    const res = await fetch('/api/drivers/public');
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data.drivers) && data.drivers.length > 0) {
        dynamicDrivers = data.drivers;
        
        data.drivers.forEach(d => {
          DRIVER_PROFILES[d.code] = {
            id: d.id || d.code,
            code: d.code,
            name: d.name,
            phone: d.phone,
            zone: d.zone || (d.zones && d.zones[0]) || 'Zone A',
            zones: d.zones || [d.zone],
            assignedZones: d.assignedZones || d.zones || [d.zone],
            pin: d.pin || '1111',
            avatar: d.avatar || d.code.replace('DRV-', ''),
            color: d.color || 'var(--st-available)',
            isSpecial: !!d.isSpecial
          };
        });

        const activeCode = state.activeDriver ? state.activeDriver.code : 'DRV-A01';
        if (DRIVER_PROFILES[activeCode]) {
          state.activeDriver = DRIVER_PROFILES[activeCode];
        }

        updateDriverContextUI();
        populateDriverAuthSelect();
      }
    }
  } catch (e) {
    console.warn('[loadDynamicDrivers] Error:', e.message);
  }
}

function updateDriverContextUI() {
  if (!state.activeDriver) return;
  const d = state.activeDriver;
  
  const avatarEl = document.getElementById("header-driver-avatar");
  if (avatarEl) avatarEl.innerText = d.avatar || d.code;

  const nameEl = document.getElementById("header-driver-name");
  if (nameEl) nameEl.innerText = d.name;

  const zoneEl = document.getElementById("header-driver-zone");
  if (zoneEl) zoneEl.innerText = d.zone;

  const statusEl = document.getElementById("side-driver-status");
  if (statusEl) statusEl.innerText = `คนขับ: ${d.name}`;

  const sideZoneEl = document.getElementById("side-zone-title");
  if (sideZoneEl) {
    const zonesList = d.zones || d.assignedZones || [d.zone];
    sideZoneEl.innerText = zonesList.join(', ');
  }
}

// Point-in-Polygon Classification Algorithm (Ray-casting)
function classifyOrderZone(order) {
  const lat = parseFloat(order.lat);
  const lng = parseFloat(order.lng);

  // Check valid bounds (lat 17.9-19.3 / lng 98.4-99.6)
  if (isNaN(lat) || isNaN(lng) || lat < 17.9 || lat > 19.3 || lng < 98.4 || lng > 99.6) {
    order.geojsonZone = "UNASSIGNED";
    order.isOutOfBounds = true;
    return order;
  }

  const activeZones = dynamicZones.length > 0
    ? dynamicZones
    : Object.entries(GEOJSON_ZONES).map(([name, polygon]) => ({
        letter: name.match(/Zone ([A-Z])/i)?.[1] || 'A',
        name,
        polygon
      }));

  const matchedLetters = [];
  const matchedNames = [];

  for (const z of activeZones) {
    if (Array.isArray(z.polygon) && z.polygon.length >= 3) {
      if (pointInPolygon([lat, lng], z.polygon)) {
        matchedLetters.push(z.letter || 'A');
        matchedNames.push(z.name || `Zone ${z.letter}`);
      }
    }
  }

  if (matchedLetters.length === 0) {
    order.geojsonZone = "UNASSIGNED";
    return order;
  }

  if (matchedLetters.length === 1) {
    order.geojsonZone = matchedNames[0];
    return order;
  }

  const combo = Array.from(new Set(matchedLetters)).sort().join('');
  const foundOverlap = dynamicOverlapZones.find(oz => oz.letters === combo);
  order.geojsonZone = foundOverlap ? (foundOverlap.name || `Zone ${combo}`) : `Zone ${combo}`;
  return order;
}

// Ray-casting Point-in-Polygon
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

function parseDateComponents(dateStr) {
  if (!dateStr || dateStr === "all") return null;
  const s = String(dateStr).trim().split(' ')[0];
  let dy, mo, yr;

  if (s.includes('-')) {
    const parts = s.split('-');
    if (parts.length === 3) {
      if (parts[0].length === 4) {
        yr = parseInt(parts[0], 10);
        mo = parseInt(parts[1], 10);
        dy = parseInt(parts[2], 10);
      } else {
        dy = parseInt(parts[0], 10);
        mo = parseInt(parts[1], 10);
        yr = parseInt(parts[2], 10);
      }
    }
  } else if (s.includes('/')) {
    const parts = s.split('/');
    if (parts.length === 3) {
      if (parseInt(parts[0], 10) > 12) {
        dy = parseInt(parts[0], 10);
        mo = parseInt(parts[1], 10);
        yr = parseInt(parts[2], 10);
      } else {
        mo = parseInt(parts[0], 10);
        dy = parseInt(parts[1], 10);
        yr = parseInt(parts[2], 10);
      }
    }
  }

  if (isNaN(dy) || isNaN(mo) || isNaN(yr) || dy < 1 || dy > 31 || mo < 1 || mo > 12) {
    return null;
  }
  return { dy, mo, yr };
}

// Helper: Parse date string into timestamp for chronological sorting
function parseDateTimestamp(dateStr) {
  const comp = parseDateComponents(dateStr);
  if (!comp) return 0;
  const standardYr = comp.yr > 2500 ? comp.yr - 543 : comp.yr;
  return new Date(standardYr, comp.mo - 1, comp.dy).getTime();
}

function normalizeDateKey(dateStr) {
  if (!dateStr || dateStr === "all") return "";
  const comp = parseDateComponents(dateStr);
  if (!comp) return String(dateStr).trim();
  const standardYr = comp.yr > 2500 ? comp.yr - 543 : comp.yr;
  const dd = String(comp.dy).padStart(2, '0');
  const mm = String(comp.mo).padStart(2, '0');
  return `${dd}-${mm}-${standardYr}`;
}

// Helper: Format date into readable Thai date string
const THAI_MONTHS_SHORT = [
  "ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.",
  "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."
];

function formatThaiDateDisplay(dateStr) {
  const comp = parseDateComponents(dateStr);
  if (!comp) return String(dateStr);
  const thaiYear = comp.yr > 2500 ? comp.yr : comp.yr + 543;
  const monthName = THAI_MONTHS_SHORT[comp.mo - 1] || `เดือน ${comp.mo}`;
  return `วันที่ ${comp.dy} ${monthName} ${thaiYear}`;
}

// Populate Date Selector sorted Chronologically by Date (Newest to Oldest)
function populateDateDropdown() {
  const dateSelect = document.getElementById("date-select");
  if (!dateSelect) return;

  const dateCounts = {};
  state.allOrders.forEach(o => {
    const raw = o.deliveryDate || o.timeWindow;
    if (raw) {
      const d = normalizeDateKey(raw);
      if (d) {
        dateCounts[d] = (dateCounts[d] || 0) + 1;
        o.deliveryDate = d;
        o.timeWindow = d;
      }
    }
  });

  // Sort dates chronologically descending (Newest date first)
  const sortedDates = Object.keys(dateCounts).sort((a, b) => parseDateTimestamp(b) - parseDateTimestamp(a));

  // Determine default date:
  const now = new Date();
  const nowDay = now.getDate();
  const nowMonth = now.getMonth() + 1;
  const nowYear = now.getFullYear();

  const todayKey = `${String(nowDay).padStart(2, '0')}-${String(nowMonth).padStart(2, '0')}-${nowYear}`;
  const todayDateMatch = sortedDates.find(d => d === todayKey);

  const currentDate = state.selectedDate;
  const normalizedCurDate = normalizeDateKey(currentDate);
  const dateStillValid = normalizedCurDate && normalizedCurDate !== "all" && dateCounts[normalizedCurDate];
  if (!dateStillValid) {
    state.selectedDate = todayDateMatch || sortedDates[0] || "all";
  } else {
    state.selectedDate = normalizedCurDate;
  }

  const activeDate = state.selectedDate;

  dateSelect.innerHTML = `<option value="all">ทุกวันจัดส่ง (${state.allOrders.length.toLocaleString()} ออเดอร์)</option>`;
  sortedDates.forEach(d => {
    const isSelected = d === activeDate ? "selected" : "";
    const thaiLabel = formatThaiDateDisplay(d);
    dateSelect.innerHTML += `<option value="${d}" ${isSelected}>${thaiLabel} (${dateCounts[d]} ออเดอร์)</option>`;
  });
}

// Get orders matching current status filter & search query
function getFilteredOrders() {
  const q = (state.searchQuery || '').trim().toLowerCase();
  return state.orders.filter(order => {
    // If searching, search across all statuses so the driver finds the order immediately even if out-of-zone or in another tab
    const matchesFilter = q ? true : (state.activeFilter === "all" ? true : order.status === state.activeFilter);
    const matchesSearch = !q ||
      order.id.toLowerCase().includes(q) ||
      order.customer.toLowerCase().includes(q) ||
      order.phone.toLowerCase().includes(q) ||
      order.address.toLowerCase().includes(q);

    return matchesFilter && matchesSearch;
  });
}

function isOrderInDriverZones(orderGeojsonZone, activeDriver) {
  if (!activeDriver) return false;
  if (activeDriver.isSpecial || activeDriver.zone === "ALL" || (activeDriver.zones && activeDriver.zones.includes("ทุกโซน"))) return true;
  if (!orderGeojsonZone || orderGeojsonZone === "UNASSIGNED") return false;

  const assigned = activeDriver.assignedZones || activeDriver.zones || [activeDriver.zone];

  // 1. Direct match in assigned list
  const matchesAssigned = assigned.some(z => {
    if (!z) return false;
    const zClean = z.split('—')[0].trim().toLowerCase();
    const ordClean = orderGeojsonZone.split('—')[0].trim().toLowerCase();
    return z === orderGeojsonZone || zClean === ordClean || orderGeojsonZone.includes(z) || z.includes(orderGeojsonZone);
  });
  if (matchesAssigned) return true;

  // 2. Check dynamic zones from /api/zones
  if (Array.isArray(dynamicZones)) {
    const dynMatch = dynamicZones.some(dz => {
      const isZoneMatch = dz.name === orderGeojsonZone || dz.id === orderGeojsonZone || (dz.letter && orderGeojsonZone.includes(dz.letter));
      if (!isZoneMatch) return false;
      const codes = Array.isArray(dz.driverCodes) ? dz.driverCodes : (dz.driverCode ? [dz.driverCode] : []);
      return codes.includes(activeDriver.code);
    });
    if (dynMatch) return true;
  }

  return false;
}

// Filter and Render Application State
function filterAndRender() {
  // Merge _ORDER_OVERRIDE records into allOrders
  state.allOrders.forEach(o => {
    const rec = state._ORDER_OVERRIDE[o.id];
    if (rec) {
      if (rec.status) o.status = rec.status;
      if (rec.delivery_date_override) o.timeWindow = rec.delivery_date_override;
      if (rec.zone_override) o.geojsonZone = rec.zone_override;
      if (rec.assigned_driver) o.assignedDriverId = rec.assigned_driver;
      if (rec.assigned_route_code) o.routeCode = rec.assigned_route_code;
      if (rec.driver_note) o.driverNote = rec.driver_note;
      if (rec.priority) o.priority = rec.priority;
      if (rec.hold) o.isHold = rec.hold;
    }
  });

  // Base date filter
  let baseList = (state.selectedDate === "all" || !state.selectedDate)
    ? [...state.allOrders]
    : state.allOrders.filter(o => o.timeWindow === state.selectedDate || o.deliveryDate === state.selectedDate);

  if (baseList.length === 0 && state.allOrders.length > 0 && state.selectedDate !== "all") {
    baseList = [...state.allOrders];
  }

  // Evaluate Zone Availability based on active driver context
  state.orders = baseList.map(o => {
    const orderCopy = { ...o };
    if (state.activeDriver.isSpecial) {
      if (orderCopy.status === "mine") {
        if (orderCopy.assignedDriverId !== state.activeDriver.code) {
          orderCopy.status = "other_mine";
        }
      } else if (orderCopy.status !== "done" && orderCopy.status !== "failed") {
        orderCopy.status = "available";
      }
    } else {
      if (orderCopy.status !== "mine" && orderCopy.status !== "done" && orderCopy.status !== "failed") {
        const isMyZone = isOrderInDriverZones(orderCopy.geojsonZone, state.activeDriver);
        if (isMyZone) {
          orderCopy.status = "available";
        } else {
          orderCopy.status = "out"; // Out of driver zone -> Muted & Disabled
        }
      }
    }
    return orderCopy;
  });

  // Sort mine orders of active driver according to state.routeSequence
  const activeMine = state.orders.filter(o => o.status === "mine");
  const others = state.orders.filter(o => o.status !== "mine");
  
  const seqKey = "uflow_route_sequence_" + state.activeDriver.code + "_" + state.selectedDate;
  state.routeSequence = JSON.parse(localStorage.getItem(seqKey) || "[]");
  
  let updatedSeq = [...state.routeSequence];
  let changed = false;
  activeMine.forEach(o => {
    if (!updatedSeq.includes(o.id)) {
      updatedSeq.push(o.id);
      changed = true;
    }
  });
  const activeMineIds = activeMine.map(o => o.id);
  updatedSeq = updatedSeq.filter(id => activeMineIds.includes(id));
  
  if (changed || updatedSeq.length !== state.routeSequence.length) {
    state.routeSequence = updatedSeq;
    localStorage.setItem(seqKey, JSON.stringify(updatedSeq));
  }

  activeMine.sort((a, b) => {
    return state.routeSequence.indexOf(a.id) - state.routeSequence.indexOf(b.id);
  });

  state.orders = [...activeMine, ...others];

  // Get filtered orders matching active status tab and search
  const filteredOrders = getFilteredOrders();

  // Re-cluster 5-decimal coordinates for matching filtered orders
  clusterOrdersByLocation(filteredOrders);

  // Render Map Pins ONLY for filtered orders matching selected status tab
  renderMapMarkers(filteredOrders);

  // Render Card List
  renderOrders();

  // Update Stats Counters
  updateStats();

  // Recenter and fit map bounds ONLY to filtered pins matching status tab
  if (filteredOrders.length > 0) {
    const bounds = L.latLngBounds(filteredOrders.map(o => [o.lat, o.lng]));
    map.fitBounds(bounds, { padding: [50, 50] });
  }

  setTimeout(() => map && map.invalidateSize(), 150);
}

// Target Stop Selection Engine
function setTargetStop(orderId, e) {
  if (e) e.stopPropagation();
  state.activeTargetStopId = orderId;

  const activeMine = state.orders.filter(o => o.status === "mine");
  const targetOrder = activeMine.find(o => o.id === orderId);
  
  if (targetOrder) {
    const remainingMine = activeMine.filter(o => o.id !== orderId);
    
    // Sort remaining reserved orders by straight-line Haversine distance from this target stop
    remainingMine.sort((a, b) => {
      const distA = calculateHaversineDistance(targetOrder.lat, targetOrder.lng, a.lat, a.lng);
      const distB = calculateHaversineDistance(targetOrder.lat, targetOrder.lng, b.lat, b.lng);
      return distA - distB;
    });

    state.orders = [targetOrder, ...remainingMine, ...nonMine];

    // Persist this sequence in localStorage
    state.routeSequence = [targetOrder.id, ...remainingMine.map(o => o.id)];
    const seqKey = "uflow_route_sequence_" + state.activeDriver.code + "_" + state.selectedDate;
    localStorage.setItem(seqKey, JSON.stringify(state.routeSequence));
  }

  filterAndRender();
  showNotification(`เปลี่ยนจุดส่งเป้าหมายเป็น "${targetOrder ? targetOrder.customer : orderId}" เรียบร้อยแล้ว ("กำลังไป")`, "mine");
}

// 5-Decimal Location Pin Clustering for Target Filtered Orders
function clusterOrdersByLocation(targetOrders) {
  state.clusterGroups = {};
  const list = targetOrders || state.orders;
  list.forEach(o => {
    const key = `${o.lat.toFixed(5)},${o.lng.toFixed(5)}`;
    if (!state.clusterGroups[key]) {
      state.clusterGroups[key] = [];
    }
    state.clusterGroups[key].push(o);
  });
}

// Initialize Leaflet Map
function initMap() {
  map = L.map("map", { zoomControl: false }).setView([WAREHOUSE_HUB.lat, WAREHOUSE_HUB.lng], 13);

  L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", {
    maxZoom: 19,
    attribution: '&copy; Unii Mart 584 Single Source Tokens'
  }).addTo(map);

  L.control.zoom({ position: "topright" }).addTo(map);

  // Warehouse Hub Marker
  const warehouseIcon = L.divIcon({
    className: "leaflet-div-icon",
    html: `<div class="pin pin--warehouse" title="${WAREHOUSE_HUB.name}"><i class="fa-solid fa-store"></i></div>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12]
  });

  L.marker([WAREHOUSE_HUB.lat, WAREHOUSE_HUB.lng], { icon: warehouseIcon })
    .addTo(map)
    .bindPopup(`<b>${WAREHOUSE_HUB.name}</b><br>พิกัดคลั: 18.562, 99.041`);

  renderGeoJsonZonePolygons();
}

let zoneLabels = [];

function renderGeoJsonZonePolygons() {
  if (!map) return;
  zonePolygons.forEach(p => map.removeLayer(p));
  zoneLabels.forEach(l => map.removeLayer(l));
  zonePolygons = [];
  zoneLabels = [];

  const active = dynamicZones.length > 0 ? dynamicZones : Object.entries(GEOJSON_ZONES).map(([name, polygon]) => {
    let letter = 'A';
    let color = '#10b981';
    if (name.includes('A')) { letter = 'A'; color = '#10b981'; }
    else if (name.includes('B')) { letter = 'B'; color = '#8b5cf6'; }
    else if (name.includes('C')) { letter = 'C'; color = '#f59e0b'; }
    else if (name.includes('D')) { letter = 'D'; color = '#06b6d4'; }
    return { name, letter, color, polygon };
  });

  active.forEach((z, idx) => {
    if (!Array.isArray(z.polygon) || z.polygon.length < 3) return;
    const color = z.color || (['#10b981', '#8b5cf6', '#f59e0b', '#06b6d4'][idx % 4]);
    const poly = L.polygon(z.polygon, {
      color: color,
      weight: 2.5,
      opacity: 0.9,
      fillColor: color,
      fillOpacity: 0.16,
      dashArray: null,
      interactive: false
    }).addTo(map);
    zonePolygons.push(poly);

    if (z.letter) {
      const center = poly.getBounds().getCenter();
      const labelMarker = L.marker(center, {
        icon: L.divIcon({
          className: 'zm-zone-label',
          html: `<span style="display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;background:#ffffff;border:2px solid ${color};color:${color};font-weight:800;font-size:12px;border-radius:6px;box-shadow:0 2px 4px rgba(0,0,0,0.15);">${z.letter}</span>`,
          iconSize: [24, 24],
          iconAnchor: [12, 12]
        }),
        interactive: false
      }).addTo(map);
      zoneLabels.push(labelMarker);
    }
  });

  dynamicOverlapZones.forEach(oz => {
    if (!Array.isArray(oz.polygon) || oz.polygon.length < 3) return;
    const poly = L.polygon(oz.polygon, {
      color: '#db2777',
      weight: 2,
      dashArray: '6, 6',
      fillColor: '#ec4899',
      fillOpacity: 0.25,
      interactive: false
    }).addTo(map);
    zonePolygons.push(poly);

    const center = poly.getBounds().getCenter();
    const labelMarker = L.marker(center, {
      icon: L.divIcon({
        className: 'zm-zone-label zm-zone-label--overlap',
        html: `<span style="display:inline-flex;align-items:center;justify-content:center;padding:1px 6px;background:#ffffff;border:2px dashed #db2777;color:#db2777;font-weight:800;font-size:11px;border-radius:6px;box-shadow:0 2px 4px rgba(0,0,0,0.15);">${oz.letters || oz.name || 'AB'}</span>`,
        iconSize: [28, 24],
        iconAnchor: [14, 12]
      }),
      interactive: false
    }).addTo(map);
    zoneLabels.push(labelMarker);
  });
}

function escHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Build Rich Hover Tooltip for Map Pin
function buildLocationTooltipHtml(key, groupOrders) {
  if (!groupOrders || groupOrders.length === 0) return '';
  const first = groupOrders[0];
  const count = groupOrders.length;
  
  if (count === 1) {
    const o = first;
    let statusText = 'ว่าง';
    let statusColor = '#059669';
    if (o.status === 'mine') { statusText = 'จองแล้ว'; statusColor = '#2563eb'; }
    else if (o.status === 'other_mine') { statusText = `จองโดย ${o.assignedDriverId || ''}`; statusColor = '#64748b'; }
    else if (o.status === 'done') { statusText = 'ส่งสำเร็จ'; statusColor = '#10b981'; }
    else if (o.status === 'failed') { statusText = 'ส่งไม่สำเร็จ'; statusColor = '#ef4444'; }
    else if (o.status === 'out') { statusText = 'นอกโซน'; statusColor = '#d97706'; }

    const codStr = o.cod 
      ? `COD <span style="font-weight:700; color:#fbbf24;">฿${Number(o.price || 0).toLocaleString(undefined, {minimumFractionDigits:2})}</span>`
      : `จ่ายแล้ว <span style="font-weight:700; color:#34d399;">฿${Number(o.price || 0).toLocaleString(undefined, {minimumFractionDigits:2})}</span>`;

    return `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Noto Sans Thai',sans-serif; min-width:180px; max-width:260px; line-height:1.35; padding:2px 0;">
        <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:8px; margin-bottom:4px;">
          <strong style="font-size:13px; color:#ffffff; font-weight:700;">${escHtml(o.customer || 'ร้านค้า')}</strong>
          <span style="font-size:10px; font-weight:700; padding:1px 6px; border-radius:4px; background:${statusColor}; color:#ffffff; white-space:nowrap;">${statusText}</span>
        </div>
        <div style="font-size:11px; font-family:monospace; color:#94a3b8; margin-bottom:4px;">${escHtml(o.id)}</div>
        <div style="font-size:11px; color:#cbd5e1; margin-bottom:6px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
          <i class="fa-solid fa-location-dot" style="color:#38bdf8; font-size:10px; margin-right:3px;"></i>${escHtml(o.address || '—')}
        </div>
        <div style="display:flex; justify-content:space-between; align-items:center; border-top:1px solid rgba(255,255,255,0.15); padding-top:4px; font-size:12px; color:#ffffff;">
          <span>${codStr}</span>
          <span style="font-size:10px; color:#94a3b8;"><i class="fa-solid fa-hand-pointer"></i> คลิกดูงาน</span>
        </div>
      </div>
    `;
  } else {
    // Clustered pins (multiple orders at this location)
    let totalAmt = groupOrders.reduce((sum, o) => sum + Number(o.price || 0), 0);
    const itemsPreview = groupOrders.slice(0, 3).map(o => `
      <div style="display:flex; justify-content:space-between; font-size:11px; color:#e2e8f0; margin-top:2px;">
        <span style="max-width:140px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">• ${escHtml(o.customer)}</span>
        <span style="font-family:monospace; color:#38bdf8;">฿${Number(o.price || 0).toLocaleString()}</span>
      </div>
    `).join('');

    return `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Noto Sans Thai',sans-serif; min-width:200px; max-width:260px; line-height:1.35; padding:2px 0;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
          <strong style="font-size:13px; color:#ffffff; font-weight:700;">📍 จุดส่งรวม (${count} ออเดอร์)</strong>
          <span style="font-size:10px; font-weight:700; padding:1px 6px; border-radius:4px; background:#0284c7; color:#ffffff;">รวมกลุ่ม</span>
        </div>
        <div style="font-size:11px; color:#cbd5e1; margin-bottom:4px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
          ${escHtml(first.address || '—')}
        </div>
        <div style="margin-bottom:6px; background:rgba(0,0,0,0.3); padding:4px 6px; border-radius:4px;">
          ${itemsPreview}
          ${count > 3 ? `<div style="font-size:10px; color:#94a3b8; text-align:right;">+ อีก ${count - 3} รายการ</div>` : ''}
        </div>
        <div style="display:flex; justify-content:space-between; align-items:center; border-top:1px solid rgba(255,255,255,0.15); padding-top:4px; font-size:12px; color:#ffffff;">
          <span>ยอดรวม: <strong style="color:#fbbf24;">฿${totalAmt.toLocaleString(undefined, {minimumFractionDigits:2})}</strong></span>
          <span style="font-size:10px; color:#94a3b8;"><i class="fa-solid fa-hand-pointer"></i> คลิกเปิด</span>
        </div>
      </div>
    `;
  }
}

// Render Map Markers ONLY for Filtered Location Clusters
function renderMapMarkers() {
  Object.values(mapMarkers).forEach(m => map.removeLayer(m));
  mapMarkers = {};

  for (const [key, groupOrders] of Object.entries(state.clusterGroups)) {
    if (!groupOrders || groupOrders.length === 0) continue;

    const firstOrder = groupOrders[0];
    const isClustered = groupOrders.length > 1;
    let statusClass = `is-${firstOrder.status}`;

    let pinHtml = isClustered
      ? `<div class="pin--group ${statusClass} ${groupOrders.some(o => o.id === state.selectedOrderId) ? 'pin--active' : ''}">${groupOrders.length}</div>`
      : `<div class="pin ${statusClass} ${firstOrder.id === state.selectedOrderId ? 'pin--active' : ''}"></div>`;

    const customIcon = L.divIcon({
      className: "leaflet-div-icon",
      html: pinHtml,
      iconSize: isClustered ? [28, 28] : [16, 16],
      iconAnchor: isClustered ? [14, 14] : [8, 8]
    });

    const marker = L.marker([firstOrder.lat, firstOrder.lng], { 
      icon: customIcon,
      zIndexOffset: 1000
    }).addTo(map);

    // Bind rich hover tooltip on mouseover
    const tooltipHtml = buildLocationTooltipHtml(key, groupOrders);
    if (tooltipHtml) {
      marker.bindTooltip(tooltipHtml, {
        direction: "top",
        offset: [0, -12],
        opacity: 0.98,
        className: "pin-hover-tooltip"
      });
    }

    // Bind rich location popup displaying all orders at this location pin
    const popupHtml = buildLocationPopupHtml(key, groupOrders);
    marker.bindPopup(popupHtml, {
      maxWidth: 340,
      minWidth: 280,
      className: "location-pin-popup"
    });

    marker.on("click", () => {
      selectOrder(firstOrder.id);
    });

    groupOrders.forEach(o => {
      mapMarkers[o.id] = marker;
    });
  }
}

// Build Rich HTML Popup for Map Pin Location
function buildLocationPopupHtml(key, groupOrders) {
  const firstOrder = groupOrders[0];
  const count = groupOrders.length;
  const isClustered = count > 1;

  let ordersHtml = groupOrders.map(o => {
    let statusBadge = "";
    const isCCView = (document.getElementById("view-admin")?.style.display === "flex");
    if (o.status === "available") statusBadge = `<span class="chip chip--available" style="font-size: 10px; padding: 1px 6px;">${isCCView ? "ว่าง" : "โซนฉัน"}</span>`;
    else if (o.status === "mine") statusBadge = `<span class="chip chip--mine" style="font-size: 10px; padding: 1px 6px;"><i class="fa-solid fa-truck"></i> จองแล้ว</span>`;
    else if (o.status === "other_mine") statusBadge = `<span class="chip" style="background: #8E8E93; color: #fff; font-size: 10px; padding: 1px 6px;"><i class="fa-solid fa-user-lock"></i> จองโดย ${o.assignedDriverId}</span>`;
    else if (o.status === "done") statusBadge = `<span class="chip chip--done" style="font-size: 10px; padding: 1px 6px;"><i class="fa-solid fa-circle-check"></i> เร็</span>`;
    else if (o.status === "failed") statusBadge = `<span class="chip chip--failed" style="font-size: 10px; padding: 1px 6px;">ไม่สำเร็จ</span>`;
    else if (o.status === "out") statusBadge = `<span class="chip" style="font-size: 10px; padding: 1px 6px;">นอกโซน</span>`;

    let actionBtn = "";
    if (o.status === "available") {
      actionBtn = `<button class="btn btn--primary btn--sm" style="font-size: 11px; padding: 0 8px; min-height: 26px;" onclick="acceptOrder('${o.id}', event)">จองงานนี้</button>`;
    } else if (o.status === "mine") {
      actionBtn = `
        <div style="display:flex; gap:4px; align-items:center; flex-wrap:wrap; justify-content:flex-end;">
          <button class="btn btn--secondary btn--sm" style="font-size:10px; padding:1px 6px; height:24px; color:#b45309; border-color:#fde68a; background:#fffbeb;" onclick="openRescheduleModal('${o.id}', event)" title="เลื่อนวันจัดส่ง"><i class="fa-solid fa-calendar-days"></i> เลื่อนส่ง</button>
          <button class="btn btn--secondary btn--sm" style="font-size:10px; padding:1px 6px; height:24px; color:var(--st-failed); border-color:#fecaca; background:#fff1f2;" onclick="releaseOrder('${o.id}', event)" title="ถอนการจอง"><i class="fa-solid fa-arrow-rotate-left"></i> ถอนจอง</button>
          <button class="btn btn--primary btn--sm" style="font-size:11px; padding:0 8px; min-height:24px;" onclick="setTargetStop('${o.id}', event)"><i class="fa-solid fa-location-arrow"></i> ไปต่อ</button>
        </div>
      `;
    } else if (o.status === "other_mine") {
      actionBtn = `<button class="btn btn--secondary btn--sm" style="font-size: 11px; padding: 0 8px; min-height: 26px; border-color: var(--st-available); color: var(--st-available);" onclick="claimUrgentSpecialOrder('${o.id}', event)"><i class="fa-solid fa-bolt" style="color: var(--st-attention);"></i> ดึงงานด่วน</button>`;
    } else if (o.status === "done") {
      actionBtn = `<span style="font-size: 11px; color: var(--st-done); font-weight: 600;"><i class="fa-solid fa-check"></i> เรียบร้อย</span>`;
    } else if (o.status === "out") {
      actionBtn = `<button class="btn btn--secondary btn--sm" style="font-size: 11px; padding: 0 8px; min-height: 26px; border-color: var(--st-available);" onclick="openCrossZoneRequestModal('${o.id}', event)"><i class="fa-solid fa-paper-plane" style="color: var(--st-available); margin-right: 4px;"></i> ขอส่งของข้ามโซน</button>`;
    }

    return `
      <div style="background: var(--page); padding: 8px 10px; border-radius: 8px; border-left: 3px solid var(--st-${o.status === 'available' ? 'available' : (o.status === 'mine' ? 'mine' : (o.status === 'done' ? 'done' : 'failed'))}); margin-top: 6px;">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <span class="code" style="font-weight: 700; font-size: 12px; color: var(--ink);">${o.id}</span>
          ${statusBadge}
        </div>
        <div style="font-size: 12px; font-weight: 600; color: var(--ink); margin-top: 2px;">${o.customer}</div>
        <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 4px;">
          <span class="num" style="font-weight: 700; font-size: 13px; color: var(--ink);">${o.cod ? 'COD ' + o.price.toLocaleString(undefined, {minimumFractionDigits:2}) : 'จ่ายแล้ว ' + o.price.toLocaleString(undefined, {minimumFractionDigits:2})}</span>
          ${actionBtn}
        </div>
      </div>
    `;
  }).join("");

  const clusterActionBtn = isClustered && groupOrders.some(o => o.status === "available")
    ? `<button class="btn btn--primary btn--block btn--sm" style="margin-top: 10px; font-size: 12px;" onclick="acceptClusterGroup('${key}', event)"><i class="fa-solid fa-layer-group"></i> จองทั้งจุดคนส่ง (${count} ออเดอร์)</button>`
    : "";

  return `
    <div style="display: flex; flex-direction: column;">
      <div style="display: flex; justify-content: space-between; align-items: flex-start;">
        <div>
          <div style="font-size: 13px; font-weight: 700; color: var(--ink);">
            <i class="fa-solid fa-location-dot" style="color: var(--st-available); margin-right: 4px;"></i> จุดส่งสินค้า (${count} ออเดอร์)
          </div>
          <div style="font-size: 11px; color: var(--ink-2); margin-top: 2px; line-height: 1.3;">${firstOrder.address}</div>
          <div style="font-size: 10px; color: var(--ink-3); margin-top: 2px;"><i class="fa-solid fa-phone"></i> ${firstOrder.phone} | พิกัด: <span class="num">${key}</span></div>
        </div>
      </div>

      <div style="max-height: 220px; overflow-y: auto; margin-top: 4px; padding-right: 2px;">
        ${ordersHtml}
      </div>

      ${clusterActionBtn}
    </div>
  `;
}

// Render Order Cards
function renderOrders() {
  const container = document.getElementById("orders-container");
  container.innerHTML = "";

  let filtered = state.orders.filter(order => {
    const matchesFilter = state.activeFilter === "all" ? true : order.status === state.activeFilter;
    const q = state.searchQuery.toLowerCase();
    const matchesSearch = !q ||
      order.id.toLowerCase().includes(q) ||
      order.customer.toLowerCase().includes(q) ||
      order.phone.toLowerCase().includes(q) ||
      order.address.toLowerCase().includes(q);

    return matchesFilter && matchesSearch;
  });

  // Apply distance sorting if active
  if (state.sortByDistance) {
    filtered = [...filtered].sort((a, b) => {
      const hasCoordA = parseFloat(a.lat) && parseFloat(a.lng);
      const hasCoordB = parseFloat(b.lat) && parseFloat(b.lng);
      if (!hasCoordA && hasCoordB) return 1;
      if (hasCoordA && !hasCoordB) return -1;
      if (!hasCoordA && !hasCoordB) return 0;
      const distA = calculateHaversineDistance(state.driverLocation.lat, state.driverLocation.lng, a.lat, a.lng);
      const distB = calculateHaversineDistance(state.driverLocation.lat, state.driverLocation.lng, b.lat, b.lng);
      return distA - distB;
    });
  }

  updateTabCounts();

  if (filtered.length === 0) {
    let emptyText = "ไม่พบรายการคำสั่งซื้อในโซนฉัน";
    if (state.searchQuery) {
      emptyText = `ไม่พบผลการค้นหา "${state.searchQuery}"`;
    } else if (state.activeFilter === "mine") {
      emptyText = "ไม่พบรายการคำสั่งซื้อที่จองไว้";
    } else if (state.activeFilter === "done") {
      emptyText = "ไม่พบรายการคำสั่งซื้อที่ส่งสำเร็จ";
    } else if (state.activeFilter === "failed") {
      emptyText = "ไม่พบรายการคำสั่งซื้อที่ส่งไม่สำเร็จ";
    } else if (state.activeFilter === "all") {
      emptyText = "ไม่พบรายการคำสั่งซื้อในวันนี้";
    }

    container.innerHTML = `
      <div style="text-align: center; padding: 32px 16px; color: var(--ink-3);">
        <i class="fa-solid fa-box-open" style="font-size: 32px; margin-bottom: 8px; color: var(--line-dark);"></i>
        <div style="font-weight: 500;">${emptyText}</div>
      </div>
    `;
    return;
  }

  filtered.forEach(order => {
    const isSelected = order.id === state.selectedOrderId;
    const key = `${order.lat.toFixed(5)},${order.lng.toFixed(5)}`;
    const clusterCount = (state.clusterGroups[key] || []).length;

    const cardHtml = document.createElement("div");
    cardHtml.className = `card card--status is-${order.status} ${isSelected ? 'is-active' : ''}`;
    cardHtml.dataset.id = order.id;

    let statusBadge = "";
    if (order.status === "available") statusBadge = `<span class="chip chip--available">โซนฉัน</span>`;
    else if (order.status === "mine") statusBadge = `<span class="chip chip--mine"><i class="fa-solid fa-truck"></i> จองแล้ว</span>`;
    else if (order.status === "other_mine") statusBadge = `<span class="chip" style="background: #8E8E93; color: #fff;"><i class="fa-solid fa-user-lock"></i> จองโดย ${order.assignedDriverId}</span>`;
    else if (order.status === "done") statusBadge = `<span class="chip chip--done"><i class="fa-solid fa-circle-check"></i> ส่งสำเร็จ</span>`;
    else if (order.status === "failed") statusBadge = `<span class="chip chip--failed"><i class="fa-solid fa-triangle-exclamation"></i> ไม่สำเร็จ</span>`;
    else if (order.status === "out") statusBadge = `<span class="chip" style="background: #f1f5f9; color: #475569; border: 1px solid #cbd5e1;"><i class="fa-solid fa-map-location-dot"></i> นอกโซน${order.zone ? ' (' + (order.zone.split('—')[0] || order.zone).trim() + ')' : ''}</span>`;

    let actionBtn = "";
    if (order.status === "available") {
      if (clusterCount > 1) {
        actionBtn = `<button class="btn btn--primary btn--sm" onclick="acceptClusterGroup('${key}', event)">จองจุดนี้ (${clusterCount})</button>`;
      } else {
        actionBtn = `<button class="btn btn--primary btn--sm" onclick="acceptOrder('${order.id}', event)">จองจุดนี้</button>`;
      }
    } else if (order.status === "mine") {
      actionBtn = `
        <div style="display: flex; gap: 6px; flex-wrap: wrap; justify-content: flex-end; align-items: center;">
          <button class="btn btn--secondary btn--sm" style="font-size: 11px; padding: 2px 8px; color: #b45309; border-color: #fde68a; background: #fffbeb;" onclick="openRescheduleModal('${order.id}', event)" title="เลื่อนวันจัดส่ง">
            <i class="fa-solid fa-calendar-days"></i> เลื่อนส่ง
          </button>
          <button class="btn btn--secondary btn--sm" style="font-size: 11px; padding: 2px 8px; color: var(--st-failed); border-color: #fecaca; background: #fff1f2;" onclick="releaseOrder('${order.id}', event)" title="ยกเลิกการจองงานนี้">
            <i class="fa-solid fa-arrow-rotate-left"></i> ถอนจอง
          </button>
          <button class="btn btn--primary btn--sm" onclick="setTargetStop('${order.id}', event)">
            <i class="fa-solid fa-location-arrow"></i> ไปจุดนี้ต่อ
          </button>
        </div>
      `;
    } else if (order.status === "other_mine") {
      actionBtn = `<button class="btn btn--secondary btn--sm" style="font-size: 11px; cursor: pointer; border-color: var(--st-available); color: var(--st-available);" onclick="claimUrgentSpecialOrder('${order.id}', event)"><i class="fa-solid fa-bolt" style="color: var(--st-attention);"></i> ดึงงานด่วนนี้</button>`;
    } else if (order.status === "done") {
      actionBtn = `<span style="font-size: 11px; color: var(--st-done); font-weight: 500;"><i class="fa-solid fa-check"></i> เร็ ${order.isGpsWarning ? '(เตื GPS >300m)' : ''}</span>`;
    } else if (order.status === "failed") {
      actionBtn = `<span style="font-size: 11px; color: var(--st-failed);">${order.failReason || 'ไม่สำเร็จ'}</span>`;
    } else if (order.status === "out") {
      actionBtn = `<button class="btn btn--secondary btn--sm" style="font-size: 11px; cursor: pointer; border-color: var(--st-available);" onclick="openCrossZoneRequestModal('${order.id}', event)"><i class="fa-solid fa-paper-plane" style="color: var(--st-available); margin-right: 4px;"></i> ขอรับงานข้ามโซน</button>`;
    }
    const distDriver = calculateHaversineDistance(state.driverLocation.lat, state.driverLocation.lng, order.lat, order.lng);
    const distWh = order.distance_wh ? parseFloat(order.distance_wh).toFixed(1) : (order.lat && order.lng ? calculateHaversineDistance(WAREHOUSE_HUB.lat, WAREHOUSE_HUB.lng, order.lat, order.lng).toFixed(1) : '—');
    const isPlusCode = /^[A-Z0-9]{4}\+[A-Z0-9]{2,4}/i.test(order.address.trim());
    const displayAddress = isPlusCode && order.district ? `${order.district} (${order.address.split(',')[0]})` : order.address;

    const storeReq = order.storeRequirements || (state._CUSTOMERS && state._CUSTOMERS[order.phone]) || {};
    const storeChips = (order.storeChips && order.storeChips.length > 0) ? order.storeChips : [];
    if (storeChips.length === 0 && storeReq) {
      if (storeReq.callBeforeMinutes) storeChips.push(`โทรก่อน ${storeReq.callBeforeMinutes} น.`);
      if (storeReq.openTime && storeReq.closeTime) storeChips.push(`เปิด ${storeReq.openTime}-${storeReq.closeTime}`);
      if (storeReq.breakTime) storeChips.push(`พัก ${storeReq.breakTime}`);
      if (storeReq.narrowAlley) storeChips.push('ซอยแคบ');
      if (storeReq.heavyHelpNeeded) storeChips.push('ต้องช่วยยก');
      if (storeReq.stairs) storeChips.push('ขึ้นบันได');
    }

    const storeChipsHtml = storeChips.slice(0, 1).map(chip => `<span class="chip chip--attention" style="font-size: 9.5px; padding: 1px 5px; font-weight: 600; background: rgba(245, 158, 11, 0.1); color: #d97706; border-radius: 3px;"><i class="fa-solid fa-store"></i> ${chip}</span>`).join(" ");

    // Print requirements box
    const hasReq = !!(storeReq.openTime || storeReq.callBeforeMinutes || storeReq.narrowAlley || storeReq.customNotes || (Array.isArray(storeReq.closedDays) && storeReq.closedDays.length > 0));
    let printReqHtml = "";
    if (hasReq) {
      const summaryItems = [];
      if (storeReq.openTime && storeReq.closeTime) summaryItems.push(`เปิด ${storeReq.openTime}-${storeReq.closeTime}`);
      if (storeReq.callBeforeMinutes) summaryItems.push(`โทรก่อน ${storeReq.callBeforeMinutes}น.`);
      if (storeReq.customNotes) summaryItems.push(storeReq.customNotes);

      printReqHtml = `
        <div class="print-store-req" style="background: rgba(245, 158, 11, 0.06); border: 1px dashed rgba(245, 158, 11, 0.4); padding: 2px 6px; border-radius: 3px; font-size: 9.5px; color: #92400e; margin-bottom: 4px;">
          <i class="fa-solid fa-store" style="margin-right: 2px;"></i> ${summaryItems.join(' · ')}
        </div>
      `;
    }

    const helpBox = (order.isOutOfBounds || isPlusCode) ? `
      <div style="font-size: 10px; color: var(--st-attention); background: var(--st-attention-bg); padding: 2px 6px; border-radius: 4px; margin-bottom: 4px; display: flex; align-items: center; justify-content: space-between;">
        <span><i class="fa-solid fa-circle-question"></i> หมุดยังไม่ยืนยัน</span>
        <button class="btn btn--secondary btn--sm" style="font-size: 9px; padding: 1px 5px; height: 18px; min-height: 18px;" onclick="openPinCorrectionModalForOrder('${order.id}', event)">แก้หมุด</button>
      </div>
    ` : "";

    let orderWeightG = 0;
    const orderItems = (state.skuDetails && state.skuDetails[order.id]) || [];
    orderItems.forEach(it => {
      const pm = Object.values(state.productMaster).find(p => p.system_sku === it.sku);
      if (pm && pm.gross_weight_g !== null && pm.gross_weight_g > 0) {
        orderWeightG += pm.gross_weight_g * it.qty;
      }
    });

    const isHeavy = orderWeightG > 15000; // > 15kg
    const heavyChip = isHeavy 
      ? `<span class="chip chip--failed" style="font-size: 9.5px; padding: 1px 5px; font-weight: 600;"><i class="fa-solid fa-triangle-exclamation"></i> หนัก ${(orderWeightG/1000).toFixed(0)}kg</span>`
      : "";

    cardHtml.innerHTML = `
      <!-- Compact Line 1: Shop Name & Status Chip -->
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; gap: 6px;">
        <div style="font-size: 14px; font-weight: 700; color: var(--ink); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex: 1;" title="${order.customer}">${order.customer}</div>
        <div style="flex-shrink: 0;">${statusBadge}</div>
      </div>

      <!-- Compact Line 2: Meta badges (ID, Phone, Warehouse Distance, Cluster) -->
      <div style="display: flex; align-items: center; gap: 5px; flex-wrap: wrap; margin-bottom: 4px; font-size: 11px;">
        <div style="display: inline-flex; align-items: center; gap: 3px; background: var(--page); padding: 1px 5px; border-radius: 3px; border: 1px solid var(--line);">
          <span class="code" style="font-size: 10.5px; color: var(--ink-2); font-weight: 600;">${order.id}</span>
          <button type="button" class="btn btn--secondary" style="font-size: 8.5px; padding: 0 2px; height: 14px; min-height: 14px; line-height: 1; border: none; background: transparent; cursor: pointer; color: var(--st-available);" onclick="copyToClipboard('${order.id}', event)" title="คัดลอกเลขออเดอร์">
            <i class="fa-solid fa-copy"></i>
          </button>
        </div>
        <span style="color: var(--ink-2); font-size: 10.5px;"><i class="fa-solid fa-phone fa-xs" style="color: var(--ink-3);"></i> ${order.phone}</span>
        <span style="color: var(--ink-3); font-size: 10.5px;"><i class="fa-solid fa-store fa-xs"></i> คลัง ${distWh}km</span>
        ${clusterCount > 1 ? `<span class="chip" style="font-size: 9.5px; padding: 1px 5px; background: #ede9fe; color: #6d28d9; border: 1px solid #ddd6fe;"><i class="fa-solid fa-layer-group"></i> ${clusterCount} จุด</span>` : ''}
        ${heavyChip}
        ${storeChipsHtml}
      </div>

      ${helpBox}
      ${printReqHtml}

      <!-- Compact Line 3: Footer (COD/Price & Action Button) -->
      <div class="order-footer" style="display: flex; justify-content: space-between; align-items: center; margin-top: 4px; padding-top: 4px; border-top: 1px dashed var(--line);">
        <div style="display: flex; flex-direction: column; justify-content: center; min-width: 0;">
          <span class="num" style="font-weight: 700; font-size: 13.5px; color: var(--ink); white-space: nowrap;">
            ${order.cod ? '<span style="color: #b45309; font-size: 10.5px; font-weight: 700; margin-right: 2px;">COD</span> ฿' + order.price.toLocaleString(undefined, {minimumFractionDigits:2}) : '<span style="color: var(--st-done); font-size: 10.5px; font-weight: 700; margin-right: 2px;">จ่ายแล้ว</span> ฿' + order.price.toLocaleString(undefined, {minimumFractionDigits:2})}
          </span>
          <span class="num" style="font-size: 10px; color: var(--st-available); font-weight: 600; white-space: nowrap;">ห่างคนขับ ${distDriver.toFixed(1)} km</span>
        </div>
        <div style="flex-shrink: 0;">${actionBtn}</div>
      </div>
    `;
    
    cardHtml.addEventListener("click", (e) => {
      if (e.target.closest("button") || e.target.closest("a")) return;
      selectOrder(order.id);
      openPodModal(order.id, e); // Open M3 Point Detail / POD Modal on card click
    });

    container.appendChild(cardHtml);
  });

  renderRouteSequence();
}

let draggedOrderIdx = null;

// Reserved Orders Side Panel List (Target Stop Engine - No Drag & Drop on Mobile)
function renderRouteSequence() {
  const container = document.getElementById("route-sequence-list");
  if (!container) return;
  container.innerHTML = "";

  const activeOrders = state.orders.filter(o => o.status === "mine");
  const countEl = document.getElementById("side-mine-count");
  if (countEl) countEl.innerText = `${activeOrders.length} งาน`;

  if (activeOrders.length === 0) {
    container.innerHTML = `
      <div style="font-size: 12px; color: var(--ink-3); text-align: center; padding: 20px 0;">
        ยังไม่มีรายการที่จองไว้<br>กด "จองงานนี้" จากรายการหลั
      </div>
    `;
    return;
  }

  // Summary header for Target Stop Selection
  const summaryBox = document.createElement("div");
  summaryBox.style.cssText = "font-size: 11px; background: var(--page); padding: 8px 12px; border-radius: 8px; margin-bottom: 8px; border: 1px solid var(--line); display: flex; flex-direction: column; gap: 4px;";
  summaryBox.innerHTML = `
    <div style="display: flex; justify-content: space-between; align-items: center;">
      <span><i class="fa-solid fa-location-arrow" style="color: var(--st-mine); margin-right: 4px;"></i> จุดส่งที่จองแล้ว (${activeOrders.length} จุ):</span>
      <button class="btn btn--secondary btn--sm" style="font-size: 10px; padding: 1px 6px;" onclick="sortActiveOrdersByDistance()"><i class="fa-solid fa-arrow-down-short-wide"></i> เรียงตามระยะทาง</button>
    </div>
    <div style="font-size: 10px; color: var(--ink-2);">
      แตะปุ่ม "ไปจุดนี้ต่อ" เพื่อเลือกจุดที่ต้องการส่งถัดไป
    </div>
  `;
  container.appendChild(summaryBox);

  activeOrders.forEach((order, idx) => {
    const isCurrentTarget = (order.id === state.activeTargetStopId) || (idx === 0 && !state.activeTargetStopId);
    const item = document.createElement("div");
    item.className = `card card--status is-mine ${isCurrentTarget ? 'is-active' : ''}`;
    item.style.padding = "10px 12px";
    item.style.flexShrink = "0";
    item.style.cursor = "grab";
    item.setAttribute("draggable", "true");

    item.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 8px;">
        <div style="flex: 1; overflow: hidden;">
          <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 2px; flex-wrap: wrap;">
            ${isCurrentTarget ? '<span class="chip chip--mine" style="font-size: 10px; padding: 1px 6px;"><i class="fa-solid fa-location-arrow"></i> กำลังไป</span>' : ''}
            <div style="display: inline-flex; align-items: center; gap: 4px; background: var(--page); padding: 1px 4px; border-radius: 4px; border: 1px solid var(--line);">
              <span class="code" style="font-size: 10px; color: var(--ink-2); font-weight: 600;">${order.id}</span>
              <button type="button" class="btn btn--secondary" style="font-size: 9px; padding: 0 4px; height: 14px; min-height: 14px; line-height: 1; border: none; background: transparent; cursor: pointer; color: var(--st-available);" onclick="copyToClipboard('${order.id}', event)" title="คัดลอกเลขออเดอร์">
                <i class="fa-solid fa-copy"></i>
              </button>
            </div>
            ${(order.storeChips || []).slice(0, 1).map(c => `<span class="chip chip--attention" style="font-size: 9px; padding: 1px 5px; background: rgba(245, 158, 11, 0.12); color: #d97706; border: 1px solid rgba(245, 158, 11, 0.4);"><i class="fa-solid fa-store"></i> ${c}</span>`).join('')}
          </div>
          <div style="font-size: 14px; font-weight: 700; color: var(--ink); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${order.customer}</div>
          <div style="font-size: 11px; color: var(--ink-2); margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${order.address}</div>
        </div>

        <div style="text-align: right; flex-shrink: 0; display: flex; flex-direction: column; align-items: flex-end; gap: 4px;">
          <div class="num" style="font-size: 13px; font-weight: 700; color: var(--ink);">${order.price.toLocaleString(undefined, {minimumFractionDigits:2})}</div>
          
          <!-- Reorder Chevrons (touch fallback) -->
          <div style="display: flex; gap: 4px; margin-top: 2px;">
            ${idx > 0 ? `<button class="btn btn--secondary btn--sm" style="padding: 0 4px; height: 18px; min-height: 18px; line-height: 1; font-size: 10px; border-color: var(--line);" onclick="reorderActiveDriverOrders(${idx}, ${idx - 1}); event.stopPropagation();" title="เลื่อนขึ้น">▲</button>` : ''}
            ${idx < activeOrders.length - 1 ? `<button class="btn btn--secondary btn--sm" style="padding: 0 4px; height: 18px; min-height: 18px; line-height: 1; font-size: 10px; border-color: var(--line);" onclick="reorderActiveDriverOrders(${idx}, ${idx + 1}); event.stopPropagation();" title="เลื่อนลง">▼</button>` : ''}
          </div>

          ${!isCurrentTarget ? `<button class="btn btn--primary btn--sm" style="font-size: 11px; padding: 2px 8px; min-height: 28px; margin-top: 4px;" onclick="setTargetStop('${order.id}', event)"><i class="fa-solid fa-location-arrow"></i> ไปจุดนี้ต่อ</button>` : ''}
        </div>
      </div>
      <div style="display: flex; gap: 6px; justify-content: flex-end; align-items: center; margin-top: 6px; padding-top: 6px; border-top: 1px dashed var(--line);">
        <button class="btn btn--secondary btn--sm" style="font-size: 10px; padding: 1px 6px; height: 22px; color: #b45309; border-color: #fde68a; background: #fffbeb;" onclick="openRescheduleModal('${order.id}', event)" title="เลื่อนวันจัดส่ง">
          <i class="fa-solid fa-calendar-days"></i> เลื่อนส่ง
        </button>
        <button class="btn btn--secondary btn--sm" style="font-size: 10px; padding: 1px 6px; height: 22px; color: var(--st-failed); border-color: #fecaca; background: #fff1f2;" onclick="releaseOrder('${order.id}', event)" title="ถอนการจองงานนี้">
          <i class="fa-solid fa-arrow-rotate-left"></i> ถอนจอง
        </button>
      </div>
    `;

    // HTML5 Drag and Drop listeners
    item.addEventListener("dragstart", (e) => {
      draggedOrderIdx = idx;
      item.classList.add("is-dragging");
      e.dataTransfer.effectAllowed = "move";
    });

    item.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
    });

    item.addEventListener("dragenter", (e) => {
      e.preventDefault();
      item.classList.add("drag-hover");
    });

    item.addEventListener("dragleave", () => {
      item.classList.remove("drag-hover");
    });

    item.addEventListener("dragend", () => {
      item.classList.remove("is-dragging");
      document.querySelectorAll("#route-sequence-list .card").forEach(el => el.classList.remove("drag-hover"));
    });

    item.addEventListener("drop", (e) => {
      e.preventDefault();
      const targetIdx = idx;
      if (draggedOrderIdx !== null && draggedOrderIdx !== targetIdx) {
        reorderActiveDriverOrders(draggedOrderIdx, targetIdx);
      }
      draggedOrderIdx = null;
    });

    container.appendChild(item);
  });
}

function reorderActiveDriverOrders(fromIdx, toIdx) {
  const activeMine = state.orders.filter(o => o.status === "mine");
  if (fromIdx < 0 || fromIdx >= activeMine.length || toIdx < 0 || toIdx >= activeMine.length) return;

  const [moved] = activeMine.splice(fromIdx, 1);
  activeMine.splice(toIdx, 0, moved);

  // Update state.routeSequence and save to localStorage
  state.routeSequence = activeMine.map(o => o.id);
  const seqKey = "uflow_route_sequence_" + state.activeDriver.code + "_" + state.selectedDate;
  localStorage.setItem(seqKey, JSON.stringify(state.routeSequence));

  // Preserve relative order of non-mine orders
  const nonMine = state.orders.filter(o => o.status !== "mine");
  state.orders = [...activeMine, ...nonMine];

  filterAndRender();
  showNotification(`คนขับลำดับเนทางเป็ #${toIdx + 1} (${moved.customer}) เรียบร้อยแล้ว`, "done");
}

function selectOrder(orderId) {
  state.selectedOrderId = orderId;
  const order = state.orders.find(o => o.id === orderId);
  if (order) {
    map.flyTo([order.lat, order.lng], 16, { animate: true, duration: 0.8 });
    highlightMapMarker(orderId);
  }
  renderOrders();
}

function highlightMapMarker(orderId) {
  state.orders.forEach(o => {
    const marker = mapMarkers[o.id];
    if (marker) {
      const el = marker.getElement();
      if (el) {
        const pinDiv = el.querySelector(".pin, .pin--group");
        if (pinDiv) {
          if (o.id === orderId) pinDiv.classList.add("pin--active");
          else pinDiv.classList.remove("pin--active");
        }
      }
    }
  });
}

async function acceptOrder(orderId, e) {
  if (e) {
    e.stopPropagation();
    e.preventDefault();
  }
  const btn = e && (e.currentTarget || e.target);
  const origHtml = btn ? btn.innerHTML : "";
  if (btn && btn.tagName === "BUTTON") {
    btn.disabled = true;
    btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> กำลังจอง...`;
  }

  const order = state.allOrders.find(o => o.id === orderId);
  if (!order) {
    if (btn) { btn.disabled = false; btn.innerHTML = origHtml; }
    showNotification("ไม่พบออเดอร์ที่ต้องการจอง", "failed");
    return;
  }
  // ตรวจสอบ status จาก orders (ที่ผ่าน zone filter แล้ว)
  const renderedOrder = state.orders.find(o => o.id === orderId);
  if (renderedOrder && renderedOrder.status === "out") {
    if (btn) { btn.disabled = false; btn.innerHTML = origHtml; }
    showNotification("ออเดอร์นี้อยู่นอกโซนของคุณ ไม่สามารถจองได้", "failed");
    return;
  }
  if (order) {
    const routeCode = generateRouteCode(state.activeDriver, order.timeWindow, order.orderDate);
    const token = localStorage.getItem('uflow_jwt_token');

    try {
      const res = await fetch("/api/stop/claim", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify({ orderId })
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to claim stop");
      }

      order.status = "mine";
      order.assignedDriverId = state.activeDriver.code;
      order.routeCode = routeCode;

      await loadDatabase();
      filterAndRender();
      showNotification(`จองออเดอร์ ${order.id} เรียบร้อยแล้ว! (ย้ายไปแถบ "จองแล้ว")`, "mine");
    } catch (err) {
      console.error("Claim error:", err);
      showNotification(err.message || "เกิดข้อผิดพลาดในการจองจุดส่ง", "failed");
      if (btn) { btn.disabled = false; btn.innerHTML = origHtml; }
      await loadDatabase();
      filterAndRender();
    }
  }
}

// ถอนการจอง (Release Claimed Order back to Available)
async function releaseOrder(orderId, e) {
  if (e) e.stopPropagation();
  const order = state.allOrders.find(o => o.id === orderId);
  if (!order) return;

  const confirmed = confirm(`ต้องการถอนการจองออเดอร์ ${order.id} (${order.customer || 'ร้านค้า'}) ใช่หรือไม่?\nงานจะกลับไปเป็นสถานะว่างเพื่อให้คนขับคนอื่นจองได้`);
  if (!confirmed) return;

  const token = localStorage.getItem('uflow_jwt_token');

  try {
    const res = await fetch("/api/stop/release", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`
      },
      body: JSON.stringify({ orderId })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to release stop");

    order.status = "available";
    order.assignedDriverId = "";
    order.routeCode = "";
    if (state.activeTargetStopId === orderId) {
      state.activeTargetStopId = null;
    }

    await loadDatabase();
    filterAndRender();
    showNotification(`ถอนการจองออเดอร์ ${order.id} เรียบร้อยแล้ว (สถานะกลับเป็นว่าง)`, "available");
  } catch (err) {
    console.error("Release error:", err);
    showNotification(err.message || "เกิดข้อผิดพลาดในการถอนการจอง", "failed");

    // Local fallback
    order.status = "available";
    order.assignedDriverId = "";
    order.routeCode = "";
    if (state.activeTargetStopId === orderId) {
      state.activeTargetStopId = null;
    }
    filterAndRender();
  }
}

// Helper: Get Base Date from Order's current delivery date
function getOrderBaseDeliveryDate(order) {
  const raw = (order && (order.deliveryDate || order.orderDate || order.timeWindow)) || '';
  const comp = parseDateComponents(raw);
  if (comp) {
    const yr = comp.yr > 2500 ? comp.yr - 543 : comp.yr;
    return new Date(yr, comp.mo - 1, comp.dy);
  }
  return new Date();
}

// เลื่อนวันส่ง (Reschedule Delivery Date)
function openRescheduleModal(orderId, e) {
  if (e) e.stopPropagation();
  const order = state.allOrders.find(o => o.id === orderId);
  if (!order) return;

  state.rescheduleOrderId = orderId;

  const custEl = document.getElementById("reschedule-modal-customer");
  const idEl = document.getElementById("reschedule-modal-order-id");
  const addrEl = document.getElementById("reschedule-modal-address");
  const curDateEl = document.getElementById("reschedule-modal-current-date");
  const dateInput = document.getElementById("reschedule-date-input");
  const reasonSelect = document.getElementById("reschedule-reason-select");
  const noteInput = document.getElementById("reschedule-note-input");

  if (custEl) custEl.textContent = order.customer || 'ร้านค้า';
  if (idEl) idEl.textContent = order.id;
  if (addrEl) addrEl.textContent = order.address || '—';
  if (curDateEl) curDateEl.textContent = `วันส่งปัจจุบัน: ${order.deliveryDate || order.orderDate || order.timeWindow || 'วันนี้'}`;

  // Default to +1 day from order's current delivery date
  const baseDate = getOrderBaseDeliveryDate(order);
  const target = new Date(baseDate.getTime());
  target.setDate(target.getDate() + 1);
  const yyyy = target.getFullYear();
  const mm = String(target.getMonth() + 1).padStart(2, '0');
  const dd = String(target.getDate()).padStart(2, '0');
  if (dateInput) {
    dateInput.value = `${yyyy}-${mm}-${dd}`;
    dateInput.min = new Date().toISOString().split('T')[0];
  }

  if (reasonSelect) reasonSelect.value = "ลูกค้าขอเลื่อนวันรับสินค้า";
  if (noteInput) {
    noteInput.value = "";
    noteInput.style.display = "none";
  }

  document.getElementById("modal-reschedule-order")?.classList.add("is-open");
}

function closeRescheduleModal() {
  document.getElementById("modal-reschedule-order")?.classList.remove("is-open");
  state.rescheduleOrderId = null;
}

function setRescheduleQuickDate(type) {
  const dateInput = document.getElementById("reschedule-date-input");
  if (!dateInput) return;

  const order = state.rescheduleOrderId ? state.allOrders.find(o => o.id === state.rescheduleOrderId) : null;
  const baseDate = getOrderBaseDeliveryDate(order);
  const target = new Date(baseDate.getTime());

  if (type === 'tomorrow') target.setDate(target.getDate() + 1);
  else if (type === 'dayafter') target.setDate(target.getDate() + 2);
  else if (type === 'nextweek') target.setDate(target.getDate() + 7);

  const yyyy = target.getFullYear();
  const mm = String(target.getMonth() + 1).padStart(2, '0');
  const dd = String(target.getDate()).padStart(2, '0');
  dateInput.value = `${yyyy}-${mm}-${dd}`;
}

function toggleRescheduleOtherReason(val) {
  const noteInput = document.getElementById("reschedule-note-input");
  if (noteInput) {
    noteInput.style.display = (val === 'other') ? 'block' : 'none';
    if (val === 'other') noteInput.focus();
  }
}

async function confirmRescheduleOrder() {
  const orderId = state.rescheduleOrderId;
  if (!orderId) return;

  const dateInput = document.getElementById("reschedule-date-input");
  const targetDate = dateInput ? dateInput.value : '';
  if (!targetDate) {
    alert("กรุณาเลือกวันที่ต้องการจัดส่งใหม่");
    return;
  }

  const reasonSelect = document.getElementById("reschedule-reason-select");
  const noteInput = document.getElementById("reschedule-note-input");
  const selectedReason = reasonSelect ? reasonSelect.value : 'ลูกค้าขอเลื่อนวันรับสินค้า';
  const customNote = noteInput ? noteInput.value.trim() : '';
  const finalReason = selectedReason === 'other' ? (customNote || 'เลื่อนส่งตามที่ระบุ') : selectedReason + (customNote ? ` (${customNote})` : '');

  const submitBtn = document.getElementById("btn-submit-reschedule");
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> กำลังบันทึก...`;
  }

  const token = localStorage.getItem('uflow_jwt_token');

  // Convert YYYY-MM-DD to DD-MM-YYYY for standard sheets format
  const [y, m, d] = targetDate.split('-');
  const dd = String(parseInt(d)).padStart(2, '0');
  const mm = String(parseInt(m)).padStart(2, '0');
  const formattedDate = `${dd}-${mm}-${y}`;

  try {
    const res = await fetch("/api/stop/override", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`
      },
      body: JSON.stringify({
        orderId,
        deliveryDateOverride: formattedDate,
        reason: finalReason,
        driverNote: `เลื่อนส่งเป็น ${formattedDate}: ${finalReason}`
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to reschedule delivery");

    closeRescheduleModal();
    await loadDatabase();
    filterAndRender();
    showNotification(`เลื่อนวันจัดส่งออเดอร์ ${orderId} เป็นวันที่ ${formattedDate} เรียบร้อยแล้ว`, "done");
  } catch (err) {
    console.error("Reschedule error:", err);
    showNotification(err.message || "เกิดข้อผิดพลาดในการเลื่อนส่ง", "failed");
    closeRescheduleModal();
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = `<i class="fa-solid fa-check"></i> ยืนยันเลื่อนส่ง`;
    }
  }
}

// Special Driver Action: Claim Urgent Order immediately without approval
function claimUrgentSpecialOrder(orderId, e) {
  if (e) e.stopPropagation();
  if (!state.activeDriver.isSpecial) {
    showNotification("เฉพาะทีมพิเศษเท่านั้นที่มารถดึงงานด่วนได้", "failed");
    return;
  }

  const order = state.allOrders.find(o => o.id === orderId);
  if (!order) return;

  const previousDriver = order.assignedDriverId || "คนขับเดิม";
  if (confirm(`[ทีมพิเศษด่วน] ยืนยันดึงงานออเดอร์ ${order.id} (${order.customer})\nจากคนขับเดิม (${previousDriver}) มาจัดส่งด้วยทีมพิเศษทันที?\n\n(ระบบจะเปลี่ยนคนส่งและข้ามขั้นตอนการขออนุมัติจัดส่งอัตโนมัติ)`)) {
    const routeCode = generateRouteCode(state.activeDriver, order.timeWindow, order.orderDate);
    order.status = "mine";
    order.assignedDriverId = state.activeDriver.code;
    order.routeCode = routeCode;

    if (!state._ORDER_OVERRIDE[order.id]) {
      state._ORDER_OVERRIDE[order.id] = { order_id: order.id, audit_history: [] };
    }
    const rec = state._ORDER_OVERRIDE[order.id];
    rec.status = "mine";
    rec.assigned_driver = state.activeDriver.code;
    rec.assigned_route_code = routeCode; // Column N "คนคนส่ง"
    rec.audit_history.push({
      timestamp: new Date().toISOString(),
      actor: state.activeDriver.name,
      field: "special_driver_claim_urgent",
      old_val: `mine (${previousDriver})`,
      new_val: `mine (${state.activeDriver.code})`,
      reason: "ดึงงานด่วนด้วยทีมพิเศษ (ข้ามขั้นตอนอนุมัติเร่งด่วน)"
    });

    saveStateToLocalStorage();
    filterAndRender();
    showNotification(`ทีมพิเศษดึงงานด่วน ${order.id} มาจัดส่งเรียบร้อยแล้ว! (รหัสคนคนส่ง: ${routeCode})`, "mine");
  }
}

// Book Entire Cluster Location at Once
async function acceptClusterGroup(clusterKey, e) {
  if (e) {
    e.stopPropagation();
    e.preventDefault();
  }
  const btn = e && (e.currentTarget || e.target);
  const origHtml = btn ? btn.innerHTML : "";
  if (btn && btn.tagName === "BUTTON") {
    btn.disabled = true;
    btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> กำลังจอง...`;
  }

  const group = state.clusterGroups[clusterKey] || [];
  const claimable = group.filter(o => o.status !== "out");
  if (claimable.length === 0) {
    if (btn) { btn.disabled = false; btn.innerHTML = origHtml; }
    return;
  }

  const orderIds = claimable.map(o => o.id);
  const token = localStorage.getItem('uflow_jwt_token');

  try {
    const res = await fetch("/api/stop/claim", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`
      },
      body: JSON.stringify({ orderIds })
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || "Failed to claim cluster");
    }

    let sampleRouteCode = "";
    claimable.forEach(o => {
      const routeCode = generateRouteCode(state.activeDriver, o.timeWindow, o.orderDate);
      o.status = "mine";
      o.assignedDriverId = state.activeDriver.code;
      o.routeCode = routeCode;
      sampleRouteCode = routeCode;
    });

    await loadDatabase();
    filterAndRender();
    showNotification(`จองทั้งจุด (${claimable.length} ออเดอร์) เรียบร้อยแล้ว! (ย้ายไปแถบ "จองแล้ว")`, "mine");
  } catch (err) {
    console.error("Cluster claim error:", err);
    showNotification(err.message || "เกิดข้อผิดพลาดในการจองจุดส่งกลุ่ม", "failed");
    if (btn) { btn.disabled = false; btn.innerHTML = origHtml; }
    await loadDatabase();
    filterAndRender();
  }
}

// Driver Reordering ("เรียงตามระยะทางจากฉัน" - Reorders list only, no lines or navigation loops)
function toggleSortDistance() {
  state.sortByDistance = !state.sortByDistance;
  const btn = document.getElementById("btn-sort-distance");
  if (btn) {
    if (state.sortByDistance) {
      btn.classList.add("is-active");
      btn.style.background = "var(--st-available)";
      btn.style.color = "#fff";
      btn.style.borderColor = "var(--st-available)";
      btn.innerHTML = `<i class="fa-solid fa-check"></i> เรียงตามระยะทางจากฉัน (ใกล้ → ไกล)`;
      showNotification("เรียงรายการตามระยะทางจากตำแหน่งคนขับ (ใกล้ไปไกล)", "available");
    } else {
      btn.classList.remove("is-active");
      btn.style.background = "";
      btn.style.color = "";
      btn.style.borderColor = "";
      btn.innerHTML = `<i class="fa-solid fa-arrow-down-short-wide"></i> เรียงตามระยะทางจากฉัน`;
      showNotification("ยกเลิกการเรียงตามระยะทาง (แสดงตามลำดับเริ่มต้น)", "available");
    }
  }
  renderOrders();
}

document.getElementById("btn-sort-distance")?.addEventListener("click", toggleSortDistance);

// P0-2 Automated Stability Test (Reorders 20 times & asserts item count invariant)
function verifyReorderStability(iterations = 20) {
  const initialMineCount = state.orders.filter(o => o.status === "mine").length;
  const initialTotalCount = state.orders.length;

  for (let i = 0; i < iterations; i++) {
    const mineOrders = state.orders.filter(o => o.status === "mine");
    if (mineOrders.length > 1) {
      const targetId = mineOrders[i % mineOrders.length].id;
      setTargetStop(targetId);
    }
  }

  const finalMineCount = state.orders.filter(o => o.status === "mine").length;
  const finalTotalCount = state.orders.length;

  const isPreserved = (initialMineCount === finalMineCount) && (initialTotalCount === finalTotalCount);
  console.assert(isPreserved, `P0-2 Verification Failed! Initial: ${initialTotalCount}, Final: ${finalTotalCount}`);
  console.log(`[P0-2 Stability Verification] Reordered ${iterations} times. Item count strictly preserved: ${finalTotalCount}/${initialTotalCount} (Mine: ${finalMineCount})`);
  return isPreserved;
}

// Haversine Distance Formula (Meters / Kilometers)
function calculateHaversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // Earth radius km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// POD Modal with Driver GPS Capture
// --- Photo & Slip Attachment Functions ---
function triggerProofCamera() {
  document.getElementById("pod-proof-camera-input")?.click();
}

function triggerProofGallery() {
  document.getElementById("pod-proof-file-input")?.click();
}

function triggerSlipCamera() {
  document.getElementById("pod-slip-camera-input")?.click();
}

function triggerSlipGallery() {
  document.getElementById("pod-slip-file-input")?.click();
}

function handleProofPhotoSelect(e) {
  const files = e.target.files;
  if (!files || files.length === 0) return;

  Array.from(files).forEach(file => {
    const reader = new FileReader();
    reader.onload = (event) => {
      state.activePodPhotos.proof.push(event.target.result);
      renderProofThumbnails();
    };
    reader.readAsDataURL(file);
  });
  e.target.value = "";
}

function handleSlipPhotoSelect(e) {
  const files = e.target.files;
  if (!files || files.length === 0) return;

  Array.from(files).forEach(file => {
    const reader = new FileReader();
    reader.onload = (event) => {
      state.activePodPhotos.slips.push(event.target.result);
      renderSlipThumbnails();
    };
    reader.readAsDataURL(file);
  });
  e.target.value = "";
}

function renderProofThumbnails() {
  const container = document.getElementById("pod-proof-thumbnails");
  const countEl = document.getElementById("pod-proof-count");
  if (countEl) countEl.innerText = `${state.activePodPhotos.proof.length} 232525`;

  if (container) {
    container.innerHTML = state.activePodPhotos.proof.map((src, idx) => `
      <div class="photo-thumb-item">
        <img src="${src}" alt="ักฐานจัดคนส่ง ${idx + 1}" onclick="window.open('${src}', '_blank')">
      </div>
    `).join("");
  }
}

function renderSlipThumbnails() {
  const container = document.getElementById("pod-slip-thumbnails");
  const countEl = document.getElementById("pod-slip-count");
  if (countEl) countEl.innerText = `${state.activePodPhotos.slips.length} สลิป`;

  if (container) {
    container.innerHTML = state.activePodPhotos.slips.map((src, idx) => `
      <div class="photo-thumb-item">
        <img src="${src}" alt="สลิปโอนเงิน ${idx + 1}" onclick="window.open('${src}', '_blank')">
      </div>
    `).join("");
  }
}

// POD Modal with Driver GPS Capture
function openPodModal(orderId, e) {
  if (e) e.stopPropagation();
  state.selectedOrderId = orderId;
  const order = state.allOrders.find(o => o.id === orderId);
  if (!order) return;

  document.getElementById("pod-order-id").innerText = order.id;
  document.getElementById("pod-customer-name").innerText = order.customer;
  
  const priceEl = document.getElementById("pod-cod-price");
  const badgeEl = document.getElementById("pod-payment-status-badge");

  if (priceEl) priceEl.innerText = `฿${order.price.toLocaleString(undefined, {minimumFractionDigits:2})}`;
  if (badgeEl) {
    if (order.cod) {
      badgeEl.innerHTML = `<span class="chip chip--failed" style="font-weight: 700; font-size: 11.5px; padding: 2px 8px; border-radius: 4px;"><i class="fa-solid fa-hand-holding-dollar"></i> เก็บเงินปลายทาง (COD)</span>`;
    } else {
      badgeEl.innerHTML = `<span class="chip chip--done" style="font-weight: 700; font-size: 11.5px; padding: 2px 8px; border-radius: 4px;"><i class="fa-solid fa-circle-check"></i> ชำระออนไลน์แล้ว</span>`;
    }
  }

  const addrEl = document.getElementById("pod-order-address");
  const phoneEl = document.getElementById("pod-order-phone-link");
  const mapsEl = document.getElementById("pod-order-maps-link");
  const targetBtn = document.getElementById("pod-btn-set-target");

  if (addrEl) addrEl.innerHTML = `<i class="fa-solid fa-location-dot" style="color: var(--st-available); margin-right: 4px;"></i> ${order.address}`;
  if (phoneEl) phoneEl.href = `tel:${order.phone}`;
  if (mapsEl) mapsEl.href = `https://www.google.com/maps?q=${order.lat},${order.lng}`;

  if (targetBtn) {
    if (order.status === "mine") {
      targetBtn.style.display = "inline-flex";
    } else {
      targetBtn.style.display = "none";
    }
  }

  // M3: Render Store Requirements Card (Amber Box)
  const storeReqBox = document.getElementById("pod-store-req-box");
  const storeReqPhone = document.getElementById("pod-store-req-phone");
  const storeReqContent = document.getElementById("pod-store-req-content");

  const req = order.storeRequirements || (state._CUSTOMERS && state._CUSTOMERS[order.phone]) || null;
  const hasReq = req && !!(req.openTime || req.closeTime || req.callBeforeMinutes || req.narrowAlley || req.customNotes || req.parkingSpot || req.entrance || req.signee || req.paymentType || req.heavyHelpNeeded || (Array.isArray(req.closedDays) && req.closedDays.length > 0));

  if (storeReqBox && storeReqContent) {
    if (hasReq) {
      storeReqBox.style.display = "flex";
      if (storeReqPhone) storeReqPhone.textContent = order.phone || "";

      const sections = [];

      // 1. Time
      const timeParts = [];
      if (req.openTime && req.closeTime) timeParts.push(`เปิด ${req.openTime} - ${req.closeTime}`);
      if (req.breakTime) timeParts.push(`(พัก ${req.breakTime})`);
      if (Array.isArray(req.closedDays) && req.closedDays.length > 0) timeParts.push(`หยุด: ${req.closedDays.join(', ')}`);
      if (timeParts.length > 0) {
        sections.push(`<div><i class="fa-solid fa-clock" style="color:#d97706;width:14px;"></i> <strong>เวลา:</strong> ${timeParts.join(' ')}</div>`);
      }

      // 2. Access
      const accessParts = [];
      if (req.narrowAlley) accessParts.push('ซอยแคบ/รถใหญ่เข้าไม่ได้');
      if (req.stairs) accessParts.push('ต้องขึ้นบันได');
      if (req.parkingSpot) accessParts.push(`จอด: ${req.parkingSpot}`);
      if (req.entrance) accessParts.push(`ทางเข้า: ${req.entrance}`);
      if (accessParts.length > 0) {
        sections.push(`<div><i class="fa-solid fa-truck" style="color:#d97706;width:14px;"></i> <strong>การเข้าถึง:</strong> ${accessParts.join(' · ')}</div>`);
      }

      // 3. Contact
      const contactParts = [];
      if (req.callBeforeMinutes) contactParts.push(`โทรก่อนถึง ${req.callBeforeMinutes} นาที`);
      if (req.signee) contactParts.push(`ผู้รับ: ${req.signee}`);
      if (req.backupPhone) contactParts.push(`เบอร์สำรอง: ${req.backupPhone}`);
      if (contactParts.length > 0) {
        sections.push(`<div><i class="fa-solid fa-phone" style="color:#d97706;width:14px;"></i> <strong>การติดต่อ:</strong> ${contactParts.join(' · ')}</div>`);
      }

      // 4. Financial
      const finParts = [];
      if (req.paymentType) finParts.push(req.paymentType);
      if (req.taxInvoicesCount > 1) finParts.push(`ใบกำกับภาษี ${req.taxInvoicesCount} ฉบับ`);
      if (req.checkCollectionDay) finParts.push(`วันวางบิล: ${req.checkCollectionDay}`);
      if (finParts.length > 0) {
        sections.push(`<div><i class="fa-solid fa-file-invoice-dollar" style="color:#d97706;width:14px;"></i> <strong>การเงิน:</strong> ${finParts.join(' · ')}</div>`);
      }

      // 5. Notes & Others
      const otherParts = [];
      if (req.heavyHelpNeeded) otherParts.push('ของหนักต้องมีคนช่วยยก');
      if (req.customNotes) otherParts.push(req.customNotes);
      if (otherParts.length > 0) {
        sections.push(`<div><i class="fa-solid fa-circle-info" style="color:#d97706;width:14px;"></i> <strong>หมายเหตุ:</strong> ${otherParts.join(' · ')}</div>`);
      }

      storeReqContent.innerHTML = sections.join('');
    } else {
      storeReqBox.style.display = "none";
      storeReqContent.innerHTML = "";
    }
  }

  // Load existing proof & slip photos from _ORDER_OVERRIDE if present
  const override = state._ORDER_OVERRIDE[order.id] || {};
  state.activePodPhotos = {
    proof: [...(override.proof_photos || [])],
    slips: [...(override.slip_photos || [])]
  };
  renderProofThumbnails();
  renderSlipThumbnails();

  // Render SKU product items for this order
  const skuItems = (state.skuDetails && state.skuDetails[order.id]) || [];
  const skuCountEl = document.getElementById("pod-sku-count");
  const skuListEl = document.getElementById("pod-sku-items-list");

  if (skuCountEl) skuCountEl.innerText = skuItems.length;
  if (skuListEl) {
    if (skuItems.length > 0) {
      const totalSkuSum = skuItems.reduce((sum, it) => sum + (it.total !== undefined ? it.total : (it.qty * (it.pricePerUnit || 0))), 0);
      const totalSkuQty = skuItems.reduce((sum, it) => sum + (parseFloat(it.qty) || 1), 0);

      const itemsHtml = skuItems.map(item => {
        // Find matching RowID from Product Master
        const pm = Object.values(state.productMaster).find(p => p.system_sku === item.sku);
        const editBtn = pm ? `<button type="button" class="btn btn--secondary btn--sm" style="font-size: 10px; padding: 2px 6px; height: 20px; min-height: 20px;" onclick="closePodModal(); openProductQuickEditModal('${pm.row_id}')"><i class="fa-solid fa-edit"></i> แก้ไข</button>` : "";
        
        return `
          <div style="display: flex; justify-content: space-between; align-items: center; background: var(--card); padding: 6px 8px; border-radius: 4px; border: 1px solid var(--line);">
            <div style="flex: 1; overflow: hidden; padding-right: 6px;">
              <div style="font-weight: 600; color: var(--ink); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${item.name}</div>
              <div style="display: flex; align-items: center; gap: 8px;">
                <span style="font-size: 10px; color: var(--ink-3);" class="code">SKU: ${item.sku}</span>
                ${item.orderedAt ? `<span style="font-size: 9px; color: var(--ink-3);"><i class="fa-regular fa-clock"></i> ${item.orderedAt}</span>` : ''}
                ${editBtn}
              </div>
            </div>
            <div style="text-align: right; flex-shrink: 0;">
              <div style="font-weight: 700; color: var(--st-available);">${item.qty} ${item.unit || 'ชิ้น'}</div>
              <div style="font-size: 10px; color: var(--ink-2);" class="num">฿${(item.total !== undefined ? item.total : (item.itemTotal !== undefined ? item.itemTotal : (item.qty * (item.pricePerUnit || 0)))).toLocaleString(undefined, {minimumFractionDigits:2})}</div>
            </div>
          </div>
        `;
      }).join("");

      const summaryFooter = `
        <div style="display: flex; justify-content: space-between; align-items: center; padding: 6px 8px; background: var(--card); border-radius: 4px; border: 1px solid var(--line); font-size: 11px; font-weight: 700; color: var(--ink); margin-top: 4px;">
          <span>รวม ${skuItems.length} รายการ (${totalSkuQty} ชิ้น)</span>
          <span class="num" style="font-size: 12px; color: var(--ink);">฿${totalSkuSum.toLocaleString(undefined, {minimumFractionDigits:2})}</span>
        </div>
      `;

      skuListEl.innerHTML = itemsHtml + summaryFooter;
    } else {
      skuListEl.innerHTML = `<div style="color: var(--ink-3); text-align: center; padding: 8px;">ไม่มีข้อมูลรายการสินค้าใน SKU Details</div>`;
    }
  }

  // Capture Driver GPS
  const gpsBox = document.getElementById("pod-gps-distance-text");
  gpsBox.innerText = "กำลังเรียกดูพิกัด GPS จากอุปกรณ์...";

  if ("geolocation" in navigator) {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const dLat = pos.coords.latitude;
        const dLng = pos.coords.longitude;
        state.driverGpsCaptured = { lat: dLat, lng: dLng };
        state.driverLocation = { lat: dLat, lng: dLng }; // Update driver location

        const distMeters = calculateHaversineDistance(dLat, dLng, order.lat, order.lng) * 1000;
        if (distMeters > 300) {
          gpsBox.innerHTML = `<span style="color: var(--st-attention); font-weight: 600;"><i class="fa-solid fa-triangle-exclamation"></i> ระยะทางห่างจากพิกัดลูกค้ ${distMeters.toFixed(0)}m (เกิ 300m - ติดธงเตื)</span>`;
          order.isGpsWarning = true;
        } else {
          gpsBox.innerHTML = `<span style="color: var(--st-done); font-weight: 600;"><i class="fa-solid fa-circle-check"></i> ู่ตรงจุดส่งพอดี (าง ${distMeters.toFixed(0)}m)</span>`;
          order.isGpsWarning = false;
        }
      },
      (err) => {
        console.warn("GPS Permission denied or unavailable:", err);
        gpsBox.innerHTML = `<span style="color: var(--ink-3);"><i class="fa-solid fa-shield-cat"></i> ปิดสิทธิ้ GPS (มารถกดปิดงานได้ตามปกติ)</span>`;
        order.isGpsWarning = false;
      },
      { timeout: 5000 }
    );
  } else {
    gpsBox.innerText = "อุปกรณ์ไม่รองรับ GPS (มารถปิดงานได้)";
  }

  document.getElementById("pod-modal").classList.add("is-open");
}

function closePodModal() {
  document.getElementById("pod-modal").classList.remove("is-open");
}

// Complete POD Action (M4 with Delivery Time Window Warning)
function checkStoreDeliveryTimeWarning(req) {
  if (!req) return null;
  const now = new Date();
  const currentHour = now.getHours();
  const currentMin = now.getMinutes();
  const currentTimeVal = currentHour * 60 + currentMin;

  // 1. Check Closed Days (e.g. ['วันอาทิตย์', 'วันเสาร์'])
  const dayNames = ['วันอาทิตย์', 'วันจันทร์', 'วันอังคาร', 'วันพุธ', 'วันพฤหัสฯ', 'วันศุกร์', 'วันเสาร์'];
  const todayName = dayNames[now.getDay()];
  if (Array.isArray(req.closedDays) && req.closedDays.includes(todayName)) {
    return `วันนี้เป็นวันหยุดของร้าน (${todayName})`;
  }

  // 2. Check Break Time (e.g. '12:00-13:00' or '12:00 - 13:00')
  if (req.breakTime && req.breakTime.includes('-')) {
    const [bStart, bEnd] = req.breakTime.split('-').map(s => s.trim());
    const [sh, sm] = (bStart || '').split(':').map(n => parseInt(n, 10) || 0);
    const [eh, em] = (bEnd || '').split(':').map(n => parseInt(n, 10) || 0);
    const startVal = sh * 60 + sm;
    const endVal = eh * 60 + em;
    if (currentTimeVal >= startVal && currentTimeVal <= endVal) {
      return `ขณะนี้อยู่ในช่วงพักที่ห้ามส่งของร้าน (${req.breakTime})`;
    }
  }

  // 3. Check Open / Close Time
  if (req.openTime && req.closeTime) {
    const [oh, om] = req.openTime.split(':').map(n => parseInt(n, 10) || 0);
    const [ch, cm] = req.closeTime.split(':').map(n => parseInt(n, 10) || 0);
    const openVal = oh * 60 + om;
    const closeVal = ch * 60 + cm;
    if (currentTimeVal < openVal) {
      return `ขณะนี้ยังไม่ถึงเวลาเปิดร้าน (${req.openTime})`;
    }
    if (currentTimeVal > closeVal) {
      return `ขณะนี้เลยเวลาปิดร้านแล้ว (${req.closeTime})`;
    }
  }

  return null;
}

document.getElementById("btn-submit-pod")?.addEventListener("click", async () => {
  const order = state.allOrders.find(o => o.id === state.selectedOrderId);
  if (order) {
    // M4: Delivery Time Window Warning check
    if (order.storeRequirements) {
      const timeWarning = checkStoreDeliveryTimeWarning(order.storeRequirements);
      if (timeWarning) {
        const confirmClose = confirm(`⚠ แจ้งเตือนข้อกำหนดร้านค้า:\n${timeWarning}\n\nต้องการยืนยันการปิดงานจัดส่งหรือไม่?`);
        if (!confirmClose) return;
      }
    }

    const token = localStorage.getItem('uflow_jwt_token');
    const lat = state.driverGpsCaptured ? state.driverGpsCaptured.lat : null;
    const lng = state.driverGpsCaptured ? state.driverGpsCaptured.lng : null;
    const note = `ปิดงานจัดส่งสำเร็จ (แนบรูปสินค้า ${state.activePodPhotos.proof.length} รูป, สลิป ${state.activePodPhotos.slips.length} รูป)`;

    try {
      const res = await fetch("/api/stop/complete", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify({
          orderId: order.id,
          status: "done",
          lat,
          lng,
          note
        })
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to complete stop");
      }

      order.status = "done";
      await loadDatabase();
      closePodModal();
      filterAndRender();
      showNotification(`ปิดงานจัดส่งเรียบร้อย ${order.id}`, "done");
    } catch (err) {
      console.error("Complete POD error:", err);
      showNotification(err.message || "เกิดข้อผิดพลาดในการปิดงาน", "failed");

      order.status = "done";
      closePodModal();
      filterAndRender();
    }
  }
});

// Failure Modal
function openFailModal(orderId, e) {
  if (e) e.stopPropagation();
  state.selectedOrderId = orderId;
  const order = state.allOrders.find(o => o.id === orderId);
  if (!order) return;

  document.getElementById("fail-order-id").innerText = order.id;
  document.getElementById("failed-modal").classList.add("is-open");
}

function closeFailModal() {
  document.getElementById("failed-modal").classList.remove("is-open");
}

document.getElementById("btn-submit-fail")?.addEventListener("click", async () => {
  const selectedReason = document.querySelector('input[name="fail-reason"]:checked')?.value || "ส่งไม่สำเร็จ";
  const order = state.allOrders.find(o => o.id === state.selectedOrderId);
  if (order) {
    const token = localStorage.getItem('uflow_jwt_token');

    try {
      const res = await fetch("/api/stop/complete", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify({
          orderId: order.id,
          status: "failed",
          note: selectedReason,
          customerName: order.customer || order.name || '',
          itemCount: order.itemCount || (order.items ? order.items.length : 1),
          price: order.price || order.totalAmount || 0,
          photoUrl: order.proofPhoto || order.photoProof || order.podPhoto || ''
        })
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to fail stop");
      }

      order.status = "failed";
      order.failReason = selectedReason;
      await loadDatabase();
      closeFailModal();
      filterAndRender();
      showNotification(`บันทึกส่งไม่สำเร็จ: ${order.id}`, "failed");
    } catch (err) {
      console.error("Complete fail error:", err);
      showNotification(err.message || "เกิดข้อผิดพลาดในการบันทึก", "failed");

      order.status = "failed";
      order.failReason = selectedReason;
      closeFailModal();
      filterAndRender();
    }
  }
});

function populateDriverAuthSelect() {
  const select = document.getElementById("auth-driver-select");
  if (!select) return;
  
  const driversList = dynamicDrivers.length > 0 ? dynamicDrivers : Object.values(DRIVER_PROFILES);
  const activeCode = state.activeDriver ? state.activeDriver.code : 'DRV-A01';
  
  select.innerHTML = driversList.map(d => {
    const isSelected = d.code === activeCode ? 'selected' : '';
    const zonesList = d.zones || d.assignedZones || [d.zone];
    const zoneLabel = d.isSpecial ? 'ทีมพิเศษ: ทุกโซน' : `โซน: ${zonesList.join(', ')}`;
    return `<option value="${d.code}" data-pin="${d.pin || '1111'}" ${isSelected}>${d.name} (${d.code}) — ${zoneLabel}</option>`;
  }).join('');
}

// M1 Driver Authentication & Auth Modal (Login Gate)
function openDriverAuthModal(isMandatory = false) {
  populateDriverAuthSelect();
  const inputPin = document.getElementById("auth-pin-input");
  if (inputPin) {
    inputPin.value = "";
    setTimeout(() => inputPin.focus(), 150);
  }
  const errDiv = document.getElementById("auth-error-msg");
  if (errDiv) errDiv.style.display = "none";
  
  const cancelBtn = document.getElementById("btn-cancel-driver-auth");
  if (cancelBtn) {
    cancelBtn.style.display = isMandatory ? "none" : "block";
  }

  const modal = document.getElementById("modal-driver-auth");
  if (modal) {
    modal.classList.add("is-open");
    modal.dataset.mandatory = isMandatory ? "true" : "false";
  }
}

function closeDriverAuthModal() {
  const modal = document.getElementById("modal-driver-auth");
  if (modal && modal.dataset.mandatory === "true") {
    // If mandatory and not logged in, cannot close
    const token = localStorage.getItem("uflow_jwt_token");
    const isLoggedIn = sessionStorage.getItem("uflow_driver_logged_in") === "1" && token;
    if (!isLoggedIn) return;
  }
  if (modal) modal.classList.remove("is-open");
}

function logoutDriver() {
  sessionStorage.removeItem("uflow_driver_logged_in");
  localStorage.removeItem("uflow_jwt_token");
  openDriverAuthModal(true);
  showNotification("ออกจากระบบเรียบร้อยแล้ว", "available");
}

document.getElementById("btn-open-driver-auth")?.addEventListener("click", () => openDriverAuthModal(false));

// Submit on Enter key inside PIN input
document.getElementById("auth-pin-input")?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    document.getElementById("btn-submit-driver-auth")?.click();
  }
});

document.getElementById("btn-submit-driver-auth")?.addEventListener("click", async () => {
  const select = document.getElementById("auth-driver-select");
  const driverCode = select.value;
  const inputPin = (document.getElementById("auth-pin-input")?.value || "").trim();
  const errDiv = document.getElementById("auth-error-msg");

  if (!inputPin) {
    if (errDiv) {
      errDiv.style.display = "block";
      errDiv.innerText = "กรุณากรอกรหัส PIN 4 หลัก";
    }
    return;
  }

  const submitBtn = document.getElementById("btn-submit-driver-auth");
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> กำลังตรวจสอบ...`;
  }

  try {
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: driverCode, pin: inputPin })
    });
    const data = await res.json();
    if (res.ok && data.success) {
      localStorage.setItem('uflow_jwt_token', data.token);
      sessionStorage.setItem('uflow_driver_logged_in', '1');
      localStorage.setItem('uflow_active_driver_code', driverCode);

      if (errDiv) errDiv.style.display = "none";
      state.activeDriver = DRIVER_PROFILES[driverCode] || dynamicDrivers.find(d => d.code === driverCode) || {
        name: driverCode,
        code: driverCode,
        zone: 'Zone A',
        avatar: driverCode.replace('DRV-', '')
      };

      const avatarEl = document.getElementById("header-driver-avatar");
      if (avatarEl) avatarEl.innerText = state.activeDriver.avatar || state.activeDriver.code?.replace('DRV-', '') || 'DRV';

      const nameEl = document.getElementById("header-driver-name");
      if (nameEl) nameEl.innerText = state.activeDriver.name;

      const zoneEl = document.getElementById("header-driver-zone");
      if (zoneEl) zoneEl.innerText = state.activeDriver.zone || `โซน ${state.activeDriver.assignedZones?.join(', ') || 'A'}`;

      const statusEl = document.getElementById("side-driver-status");
      if (statusEl) statusEl.innerText = `คนขับ: ${state.activeDriver.name}`;

      const sideZoneEl = document.getElementById("side-zone-title");
      if (sideZoneEl) sideZoneEl.innerText = state.activeDriver.zone || `โซน ${state.activeDriver.assignedZones?.join(', ') || 'A'}`;

      const modal = document.getElementById("modal-driver-auth");
      if (modal) modal.dataset.mandatory = "false";
      closeDriverAuthModal();

      await loadDatabase();
      filterAndRender();
      showNotification(`ยินดีต้อนรับ ${state.activeDriver.name} เข้าสู่ระบบ`, "done");
    } else {
      if (errDiv) {
        errDiv.style.display = "block";
        errDiv.innerText = data.error || "รหัส PIN ไม่ถูกต้อง โปรดลองอีกครั้ง";
      }
    }
  } catch (err) {
    console.error("Auth error:", err);
    const selectedOption = select.options[select.selectedIndex];
    const requiredPin = selectedOption?.dataset?.pin || '1111';
    if (inputPin === requiredPin) {
      if (errDiv) errDiv.style.display = "none";
      sessionStorage.setItem('uflow_driver_logged_in', '1');
      localStorage.setItem('uflow_active_driver_code', driverCode);
      state.activeDriver = DRIVER_PROFILES[driverCode];
      closeDriverAuthModal();
      await loadDatabase();
      filterAndRender();
      showNotification(`ยินดีต้อนรับ ${state.activeDriver.name} เข้าสู่ระบบ`, "done");
    } else {
      if (errDiv) {
        errDiv.style.display = "block";
        errDiv.innerText = "รหัส PIN ไม่ถูกต้อง โปรดลองอีกครั้ง";
      }
    }
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = `<i class="fa-solid fa-right-to-bracket"></i> ยืนยันเข้าสู่ระบบ`;
    }
  }
});

// M5 Pin Correction Page (Search by Phone Number)
document.getElementById("btn-open-pin-correction")?.addEventListener("click", () => {
  document.getElementById("modal-pin-correction").classList.add("is-open");
});
function closePinCorrectionModal() {
  document.getElementById("modal-pin-correction").classList.remove("is-open");
}

function openPinCorrectionModalForOrder(orderId, event) {
  if (event) event.stopPropagation();
  const found = state.allOrders.find(o => o.id === orderId);
  const panel = document.getElementById("m5-result-panel");
  if (found) {
    state.m5SelectedOrder = found;
    document.getElementById("m5-phone-search-input").value = found.phone;
    document.getElementById("m5-cust-name").innerText = found.customer;
    document.getElementById("m5-cust-phone").innerText = found.phone;
    document.getElementById("m5-cust-address").innerText = found.address;
    document.getElementById("m5-lat-input").value = found.lat;
    document.getElementById("m5-lng-input").value = found.lng;
    document.getElementById("m5-orig-coords").innerText = `${found.origLat.toFixed(6)}, ${found.origLng.toFixed(6)}`;
    panel.style.display = "flex";
    document.getElementById("modal-pin-correction").classList.add("is-open");
  }
}

document.getElementById("btn-m5-search-phone")?.addEventListener("click", () => {
  const query = document.getElementById("m5-phone-search-input").value.trim();
  const found = state.allOrders.find(o => o.phone.replace(/-/g, "").includes(query.replace(/-/g, "")));
  const panel = document.getElementById("m5-result-panel");

  if (found) {
    state.m5SelectedOrder = found;
    document.getElementById("m5-cust-name").innerText = found.customer;
    document.getElementById("m5-cust-phone").innerText = found.phone;
    document.getElementById("m5-cust-address").innerText = found.address;
    document.getElementById("m5-lat-input").value = found.lat;
    document.getElementById("m5-lng-input").value = found.lng;
    document.getElementById("m5-orig-coords").innerText = `${found.origLat.toFixed(6)}, ${found.origLng.toFixed(6)}`;
    panel.style.display = "flex";
  } else {
    showNotification("ไม่พบข้อมูลลูกค้าจากเบอร์โทรศัพท์นี้", "failed");
    panel.style.display = "none";
  }
});

document.getElementById("btn-m5-reset-orig")?.addEventListener("click", () => {
  if (state.m5SelectedOrder) {
    state.m5SelectedOrder.lat = state.m5SelectedOrder.origLat;
    state.m5SelectedOrder.lng = state.m5SelectedOrder.origLng;
    state.m5SelectedOrder.isPinModified = false;

    document.getElementById("m5-lat-input").value = state.m5SelectedOrder.origLat;
    document.getElementById("m5-lng-input").value = state.m5SelectedOrder.origLng;

    filterAndRender();
    showNotification("รีเซ็ตหมุดกลับสู่พิกัดเดิมจากชีทเรียบร้อยแล้ว", "available");
  }
});

document.getElementById("btn-m5-current-gps")?.addEventListener("click", () => {
  if (!navigator.geolocation) {
    showNotification("อุปกรณ์ของคุณไม่รองรับ GPS", "failed");
    return;
  }
  showNotification("กำลังอ่านพิกัด GPS จากอุปกรณ์ของคุณ...", "available");
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;
      document.getElementById("m5-lat-input").value = lat.toFixed(6);
      document.getElementById("m5-lng-input").value = lng.toFixed(6);
      showNotification(`ดึงพิกัดปัจจุบันสำเร็จ (${lat.toFixed(4)}, ${lng.toFixed(4)})`, "done");
    },
    (err) => {
      showNotification("ไม่สามารถดึงตำแหน่ง GPS ได้ กรุณาอนุญาต Location", "failed");
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
  );
});

document.getElementById("btn-m5-save-pin")?.addEventListener("click", async () => {
  if (state.m5SelectedOrder) {
    const newLat = parseFloat(document.getElementById("m5-lat-input").value);
    const newLng = parseFloat(document.getElementById("m5-lng-input").value);
    const phone = state.m5SelectedOrder.phone;

    if (!isNaN(newLat) && !isNaN(newLng)) {
      state.m5SelectedOrder.lat = newLat;
      state.m5SelectedOrder.lng = newLng;
      state.m5SelectedOrder.isPinModified = true;

      // Re-classify zone
      classifyOrderZone(state.m5SelectedOrder);

      // Call API to persist to Google Sheets CS Master and _PINFIX
      try {
        const token = localStorage.getItem("driverToken") || localStorage.getItem("supToken") || "";
        fetch("/api/stop/pinfix", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${token}`
          },
          body: JSON.stringify({ phone, lat: newLat, lng: newLng })
        }).then(r => r.json()).then(data => {
          console.log("[Pinfix saved to sheets]", data);
        }).catch(err => console.warn("[Pinfix write warning]", err));
      } catch (e) {}

      closePinCorrectionModal();
      filterAndRender();
      showNotification(`บันทึกหมุดใหม่สำหรับ ${state.m5SelectedOrder.customer} ลงชีต CS Master และ _PINFIX เรียบร้อยแล้ว`, "done");
    }
  }
});

// Cross-Zone Order Confirmation & Manual Zone Selection Handlers
function openCrossZoneModal(orderId, event) {
  if (event) event.stopPropagation();
  const order = state.allOrders.find(o => o.id === orderId);
  if (!order) return;

  state.targetCrossZoneOrderId = orderId;
  document.getElementById("cz-order-id").innerText = order.id;
  document.getElementById("cz-order-zone").innerText = order.geojsonZone || "นอกโซน";
  document.getElementById("cz-customer-name").innerText = order.customer;
  document.getElementById("cz-address").innerText = order.address;

  // Pre-select active driver's zone as default
  const select = document.getElementById("cz-zone-select");
  if (select) {
    select.value = state.activeDriver.zone || "Zone A  —  เมืองลำพูน";
  }

  const modal = document.getElementById("modal-cross-zone");
  if (modal) modal.classList.add("is-open");
}

function closeCrossZoneModal() {
  const modal = document.getElementById("modal-cross-zone");
  if (modal) modal.classList.remove("is-open");
}

document.getElementById("btn-confirm-cross-zone")?.addEventListener("click", () => {
  if (!state.targetCrossZoneOrderId) return;
  const order = state.allOrders.find(o => o.id === state.targetCrossZoneOrderId);
  const selectedZone = document.getElementById("cz-zone-select")?.value || state.activeDriver.zone;

  if (order) {
    order.geojsonZone = selectedZone;
    
    // If selected zone matches active driver zone, reserve it into active workload
    if (selectedZone === state.activeDriver.zone) {
      order.status = "mine";
    }

    closeCrossZoneModal();
    filterAndRender();
    showNotification(`กำหนดโซนออเดอร์ ${order.id} เป็น ${selectedZone} เรียบร้อยแล้ว`, "done");
  }
});

// Cross-Zone Order Request & Zone-Owner Notification Engine
let selectedCrossZoneRequestOrder = null;

function openCrossZoneRequestModal(orderId, event) {
  if (event) event.stopPropagation();
  const order = state.allOrders.find(o => o.id === orderId);
  if (!order) return;

  selectedCrossZoneRequestOrder = order;

  // Determine Zone Owner Driver based on order's GeoJSON zone
  let zoneOwner = Object.values(DRIVER_PROFILES).find(d => d.zone === order.geojsonZone);
  if (!zoneOwner) zoneOwner = DRIVER_PROFILES["DRV-B02"];

  document.getElementById("cz-req-order-id").innerText = order.id;
  document.getElementById("cz-req-zone-chip").innerText = order.geojsonZone || "โซนอื่น";
  document.getElementById("cz-req-customer-name").innerText = order.customer;
  document.getElementById("cz-req-address").innerText = order.address;
  document.getElementById("cz-req-target-driver").innerText = `${zoneOwner.name} (${zoneOwner.zone} Owner)`;

  const reasonInput = document.getElementById("cz-req-reason-input");
  if (reasonInput) reasonInput.value = "";

  const modal = document.getElementById("modal-cross-zone-request");
  if (modal) modal.classList.add("is-open");
}

function closeCrossZoneRequestModal() {
  const modal = document.getElementById("modal-cross-zone-request");
  if (modal) modal.classList.remove("is-open");
}

function closeCrossZoneApprovalModal() {
  const modal = document.getElementById("modal-cross-zone-approval");
  if (modal) modal.classList.remove("is-open");
}

// Handle Submit Cross-Zone Request
document.getElementById("btn-submit-cross-zone-request")?.addEventListener("click", async () => {
  if (!selectedCrossZoneRequestOrder) return;
  const order = selectedCrossZoneRequestOrder;
  const reasonInput = document.getElementById("cz-req-reason-input");
  const reason = reasonInput ? reasonInput.value.trim() : "";

  if (!reason) {
    showNotification("กรุณาระบุเหตุผลการขอข้ามโซน", "failed");
    return;
  }

  const token = localStorage.getItem('uflow_jwt_token');
  const submitBtn = document.getElementById("btn-submit-cross-zone-request");
  if (submitBtn) submitBtn.disabled = true;

  try {
    const res = await fetch("/api/driver/crosszone-request", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { "Authorization": `Bearer ${token}` } : {})
      },
      body: JSON.stringify({
        orderId: order.id,
        orderNumber: order.id,
        customer: order.customer,
        address: order.address,
        orderZone: order.geojsonZone,
        price: order.price,
        cod: order.cod,
        driverId: state.activeDriver ? state.activeDriver.id : 'DRV-A01',
        driverName: state.activeDriver ? state.activeDriver.name : 'คนขับ',
        driverZones: state.activeDriver ? (Array.isArray(state.activeDriver.zones) ? state.activeDriver.zones : [state.activeDriver.zone]) : [],
        reason: reason
      })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "เกิดข้อผิดพลาดในการส่งคำขอ");

    closeCrossZoneRequestModal();
    order.isCrossZoneRequested = true;
    showNotification(`ส่งคำขอข้ามโซนออเดอร์ ${order.id} เรียบร้อยแล้ว (รอหัวหน้าคลังอนุมัติ)`, "available");
  } catch (err) {
    console.error('[crosszone-request]', err);
    showNotification(err.message, "failed");
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
});

// Handle Approve Cross-Zone Request (legacy fallback)
document.getElementById("btn-approve-cross-zone")?.addEventListener("click", () => {
  if (!selectedCrossZoneRequestOrder) return;
  const order = selectedCrossZoneRequestOrder;

  // Accept cross-zone transfer: reassign zone to requesting driver & claim order
  order.geojsonZone = state.activeDriver.zone;
  order.status = "mine";

  closeCrossZoneApprovalModal();
  filterAndRender();
  showNotification(`อนุมัติการส่งข้ามโซนเรียบร้อย ออเดอร์ ${order.id} ถูกย้ายเข้าสู่รายการงานจองของคุณแล้ว`, "done");
});

// Handle Reject Cross-Zone Request (legacy fallback)
document.getElementById("btn-reject-cross-zone")?.addEventListener("click", () => {
  closeCrossZoneApprovalModal();
  showNotification("ปฏิเสธคำขอข้ามโซนเรียบร้อยแล้ว", "failed");
});

// Admin Suite Control Center Launcher (A1-A7)
document.getElementById("btn-open-admin-suite")?.addEventListener("click", () => {
  switchView("admin");
});
function closeAdminSuiteModal() {
  document.getElementById("modal-admin-suite").classList.remove("is-open");
}

// Render Admin Panel A2 (Unassigned Orders)
function renderAdminPanelA2() {
  const tbody = document.getElementById("admin-unassigned-tbody");
  if (!tbody) return;
  tbody.innerHTML = "";

  const unassigned = state.allOrders.filter(o => o.geojsonZone === "UNASSIGNED");

  if (unassigned.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" style="text-align: center; color: var(--st-done);">ไม่มีอดอร์ค้างในถั UNASSIGNED ทุกจุดถูกจัดเข้าโซนเรียบร้อย</td></tr>`;
    return;
  }

  unassigned.forEach(order => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><span class="code">${order.id}</span></td>
      <td>${order.customer}</td>
      <td class="num">${order.lat.toFixed(4)}, ${order.lng.toFixed(4)} ${order.isOutOfBounds ? '(พิกัดหลุดกรอ)' : ''}</td>
      <td>
        <select onchange="reassignUnassignedOrder('${order.id}', this.value)" class="search-input" style="height: 30px; font-size: 11px;">
          <option value="">-- เลืโซ --</option>
          <option value="Zone A  —  เมืองลำพูน">Zone A  —  เมืองลำพูน</option>
          <option value="Zone B  —  สารภี/เชียงใหม่">Zone B  —  สารภี/เชียงใหม่</option>
          <option value="Zone C  —  ป่าซาง">Zone C  —  ป่าซาง</option>
        </select>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

function reassignUnassignedOrder(orderId, newZone) {
  if (!newZone) return;
  const order = state.allOrders.find(o => o.id === orderId);
  if (order) {
    order.geojsonZone = newZone;
    renderAdminPanelA2();
    filterAndRender();
    showNotification(`ย้ายออเดอร์ ${order.id} เข้าสู่ ${newZone} เรียบร้อยแล้ว`, "done");
  }
}

// Admin Tab Switching
document.getElementById("admin-tab-a2")?.addEventListener("click", () => switchAdminTab("a2"));
document.getElementById("admin-tab-a1")?.addEventListener("click", () => switchAdminTab("a1"));
document.getElementById("admin-tab-a3")?.addEventListener("click", () => switchAdminTab("a3"));
document.getElementById("admin-tab-a4")?.addEventListener("click", () => switchAdminTab("a4"));

function switchAdminTab(tabKey) {
  ["a1", "a2", "a3", "a4"].forEach(k => {
    const btn = document.getElementById(`admin-tab-${k}`);
    const panel = document.getElementById(`admin-panel-${k}`);
    if (btn) btn.classList.remove("is-active");
    if (panel) panel.style.display = "none";
  });

  document.getElementById(`admin-tab-${tabKey}`)?.classList.add("is-active");
  const activePanel = document.getElementById(`admin-panel-${tabKey}`);
  if (activePanel) activePanel.style.display = "flex";

  if (tabKey === "a1") {
    document.getElementById("admin-total-orders").innerText = state.allOrders.length;
    const codSum = state.allOrders.filter(o => o.cod).reduce((s, o) => s + o.price, 0);
    document.getElementById("admin-total-cod-sum").innerText = `${codSum.toLocaleString()}`;
  } else if (tabKey === "a3") {
    renderAdminAuditTrailA3();
  }
}

function renderAdminAuditTrailA3() {
  const tbody = document.getElementById("admin-audit-tbody");
  if (!tbody) return;
  tbody.innerHTML = "";

  const modified = state.allOrders.filter(o => o.isPinModified);

  if (modified.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" style="text-align: center; color: var(--ink-3);">ยังไม่มีประวัติการแก้ไขหมุดพิกัด</td></tr>`;
    return;
  }

  modified.forEach(o => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${o.phone} (${o.customer})</td>
      <td class="num">${o.origLat.toFixed(5)}, ${o.origLng.toFixed(5)}</td>
      <td class="num" style="color: var(--st-available); font-weight: 600;">${o.lat.toFixed(5)}, ${o.lng.toFixed(5)}</td>
      <td><span class="chip chip--attention">ย้ายุด M5</span></td>
    `;
    tbody.appendChild(tr);
  });
}

// Helpers
function updateTabCounts() {
  const counts = {
    all: state.orders.length,
    available: state.orders.filter(o => o.status === "available").length,
    mine: state.orders.filter(o => o.status === "mine").length,
    done: state.orders.filter(o => o.status === "done").length,
    failed: state.orders.filter(o => o.status === "failed").length
  };

  document.getElementById("count-all").innerText = counts.all;
  document.getElementById("count-available").innerText = counts.available;
  document.getElementById("count-mine").innerText = counts.mine;
  document.getElementById("count-done").innerText = counts.done;
  document.getElementById("count-failed").innerText = counts.failed;

  const claimAllCountEl = document.getElementById("claim-all-count");
  if (claimAllCountEl) claimAllCountEl.innerText = counts.available;
  const btnClaimAll = document.getElementById("btn-claim-all-available");
  if (btnClaimAll) {
    btnClaimAll.disabled = counts.available === 0;
    btnClaimAll.style.opacity = counts.available === 0 ? "0.5" : "1";
    btnClaimAll.style.cursor = counts.available === 0 ? "not-allowed" : "pointer";
  }
}

async function claimAllAvailableOrders() {
  const claimable = state.orders.filter(o => o.status === "available");
  if (claimable.length === 0) {
    showNotification("ไม่มีออเดอร์ว่างในโซนให้จอง", "failed");
    return;
  }

  const confirmed = confirm(`ต้องการจองรับงานทั้งหมดในโซนนี้ (${claimable.length} ออเดอร์) ใช่หรือไม่?`);
  if (!confirmed) return;

  const btn = document.getElementById("btn-claim-all-available");
  const origHtml = btn ? btn.innerHTML : "";
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> กำลังจอง (${claimable.length})...`;
  }

  const orderIds = claimable.map(o => o.id);
  const token = localStorage.getItem('uflow_jwt_token');

  try {
    const res = await fetch("/api/stop/claim", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`
      },
      body: JSON.stringify({ orderIds })
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || "Failed to claim all stops");
    }

    await loadDatabase();
    filterAndRender();
    showNotification(`จองงานทั้งหมด (${claimable.length} ออเดอร์) เรียบร้อยแล้ว!`, "mine");
  } catch (err) {
    console.error("Claim all error:", err);
    showNotification(err.message || "เกิดข้อผิดพลาดในการจองงานทั้งหมด", "failed");
    await loadDatabase();
    filterAndRender();
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = origHtml;
    }
  }
}

function updateStats() {
  const driverReserved = state.orders.filter(o => o.status === "mine" || o.status === "done" || o.status === "failed");
  const completed = state.orders.filter(o => o.status === "done");
  const totalMineCount = driverReserved.length;
  
  const totalCodTarget = driverReserved.reduce((sum, o) => sum + (o.cod ? o.price : 0), 0);
  const collectedCod = completed.reduce((sum, o) => sum + (o.cod ? o.price : 0), 0);
  const totalDist = driverReserved.reduce((sum, o) => sum + (o.distance_wh || 0), 0);
  const successRate = totalMineCount > 0 ? Math.round((completed.length / totalMineCount) * 100) : 0;

  const elComp = document.getElementById("stat-completed-count");
  if (elComp) elComp.innerText = `${completed.length} / ${totalMineCount} จุด`;

  const elCod = document.getElementById("stat-cod-amount");
  if (elCod) elCod.innerText = `฿${collectedCod.toLocaleString(undefined, {minimumFractionDigits:0})} / ฿${totalCodTarget.toLocaleString(undefined, {minimumFractionDigits:0})}`;

  const elDist = document.getElementById("stat-distance");
  if (elDist) elDist.innerText = `${totalDist.toFixed(1)} km`;

  const elSucc = document.getElementById("stat-success-rate");
  if (elSucc) elSucc.innerText = `${successRate}%`;

  const printTotalCodEl = document.getElementById("print-total-cod");
  if (printTotalCodEl) printTotalCodEl.innerText = `${collectedCod.toLocaleString()}`;
}

function toggleZonePolygons() {
  state.showZones = state.showZones === undefined ? false : !state.showZones;
  const btn = document.getElementById("btn-toggle-zones");
  if (state.showZones) {
    renderGeoJsonZonePolygons();
    if (btn) { btn.style.background = "var(--st-available)"; btn.style.color = "#fff"; }
    showNotification("แสดงขอบเขต GeoJSON โซนบนแผนที่", "available");
  } else {
    zonePolygons.forEach(p => map.removeLayer(p));
    zoneLabels.forEach(l => map.removeLayer(l));
    zonePolygons = [];
    zoneLabels = [];
    if (btn) { btn.style.background = ""; btn.style.color = ""; }
    showNotification("ซ่อนขอบเขตโซน", "mine");
  }
}

function initEventListeners() {
  window.addEventListener("resize", () => {
    if (map) map.invalidateSize();
  });

  const searchInput = document.getElementById("search-input");
  const clearSearchBtn = document.getElementById("btn-clear-search");

  searchInput?.addEventListener("input", (e) => {
    state.searchQuery = e.target.value;
    if (clearSearchBtn) {
      clearSearchBtn.style.display = state.searchQuery ? "flex" : "none";
    }
    filterAndRender();
  });

  clearSearchBtn?.addEventListener("click", () => {
    if (searchInput) {
      searchInput.value = "";
      searchInput.focus();
    }
    state.searchQuery = "";
    clearSearchBtn.style.display = "none";
    filterAndRender();
  });

  document.getElementById("date-select")?.addEventListener("change", (e) => {
    state.selectedDate = e.target.value;
    filterAndRender();
  });

  document.querySelectorAll(".tab-btn[data-status]").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab-btn[data-status]").forEach(b => b.classList.remove("is-active"));
      btn.classList.add("is-active");
      state.activeFilter = btn.dataset.status;
      filterAndRender();
    });
  });

  // GPS Location button
  document.getElementById("btn-my-location")?.addEventListener("click", () => {
    if ("geolocation" in navigator) {
      showNotification("กำลังระบุพิกัด GPS ปัจจุบัน...", "available");
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          state.driverLocation = { lat: pos.coords.latitude, lng: pos.coords.longitude };
          if (driverMarker) {
            driverMarker.setLatLng([pos.coords.latitude, pos.coords.longitude]);
          }
          if (map) {
            map.flyTo([pos.coords.latitude, pos.coords.longitude], 15, { animate: true, duration: 1 });
          }
          showNotification("ระบุตำแหน่ง GPS เรียบร้อย", "mine");
          filterAndRender();
        },
        (err) => {
          console.warn("GPS error:", err);
          showNotification("ไม่สามารถดึงพิกัด GPS ได้ กรุณาอนุญาตการเข้าถึง Location", "failed");
          if (map && state.driverLocation) {
            map.flyTo([state.driverLocation.lat, state.driverLocation.lng], 14);
          }
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
      );
    } else {
      showNotification("อุปกรณ์นี้ไม่รองรับ Geolocation", "failed");
    }
  });

  // Recenter map button
  document.getElementById("btn-recenter-map")?.addEventListener("click", () => {
    const activeMine = state.orders.filter(o => o.status === "mine");
    if (activeMine.length > 0) {
      const coords = [[WAREHOUSE_HUB.lat, WAREHOUSE_HUB.lng]];
      activeMine.forEach(o => coords.push([o.lat, o.lng]));
      const bounds = L.latLngBounds(coords);
      map.fitBounds(bounds, { padding: [50, 50] });
      showNotification("ปรับมุมมองโฟกัสงานที่จองไว้", "mine");
    } else {
      map.setView([WAREHOUSE_HUB.lat, WAREHOUSE_HUB.lng], 13);
      showNotification("รีเซ็ตมุมมองแผนที่ไปยังคลังสินค้า", "available");
    }
  });

  // Toggle zone polygons button
  document.getElementById("btn-toggle-zones")?.addEventListener("click", toggleZonePolygons);

  // Quick POD submission button (bottom right)
  document.getElementById("btn-quick-pod-modal")?.addEventListener("click", (e) => {
    const mineOrders = state.orders.filter(o => o.status === "mine");
    if (mineOrders.length === 0) {
      showNotification("ยังไม่มีออเดอร์ที่จองไว้ กรุณาจองงานก่อนปิดงานส่งมอบ", "failed");
      return;
    }
    const targetOrder = (state.selectedOrderId && mineOrders.find(o => o.id === state.selectedOrderId)) || mineOrders[0];
    openPodModal(targetOrder.id, e);
  });

  // Claim all available orders in zone
  document.getElementById("btn-claim-all-available")?.addEventListener("click", claimAllAvailableOrders);
}

// Sheet Expand Toggle (mobile only)
(function initSheetExpand() {
  const btn = document.getElementById("btn-sheet-expand");
  const sheet = document.getElementById("bottom-sheet");
  const icon = document.getElementById("sheet-expand-icon");
  if (!btn || !sheet) return;

  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    const expanded = sheet.classList.toggle("is-expanded");
    icon.className = expanded
      ? "fa-solid fa-chevron-down"
      : "fa-solid fa-chevron-up";
    btn.title = expanded ? "ย่อรายการ" : "ขยายรายการเต็มหน้าจอ";
  });

  // Swipe up on handle → expand; swipe down → collapse
  const handle = document.getElementById("sheet-handle");
  let touchStartY = 0;
  handle?.addEventListener("touchstart", (e) => {
    touchStartY = e.touches[0].clientY;
  }, { passive: true });
  handle?.addEventListener("touchend", (e) => {
    const dy = touchStartY - e.changedTouches[0].clientY;
    if (Math.abs(dy) < 30) return;
    if (dy > 0) {
      sheet.classList.add("is-expanded");
      icon.className = "fa-solid fa-chevron-down";
    } else {
      sheet.classList.remove("is-expanded");
      icon.className = "fa-solid fa-chevron-up";
    }
  }, { passive: true });
})();

function showNotification(message, statusType = "available") {
  const toast = document.createElement("div");
  toast.style.position = "fixed";
  toast.style.bottom = "24px";
  toast.style.right = "24px";
  toast.style.zIndex = "2000";
  toast.style.background = "var(--card)";
  toast.style.border = "1px solid var(--line-strong)";
  toast.style.borderRadius = "var(--r-card)";
  toast.style.padding = "12px 18px";
  toast.style.boxShadow = "0 8px 24px rgba(0,0,0,0.15)";
  toast.style.display = "flex";
  toast.style.alignItems = "center";
  toast.style.gap = "10px";
  toast.style.fontSize = "13px";
  toast.style.fontWeight = "500";
  toast.style.color = "var(--ink)";
  toast.style.transform = "translateY(20px)";
  toast.style.opacity = "0";
  toast.style.transition = "all 0.25s ease";

  toast.innerHTML = `<span class="legend-dot is-${statusType}"></span> ${message}`;
  document.body.appendChild(toast);

  setTimeout(() => {
    toast.style.transform = "translateY(0)";
    toast.style.opacity = "1";
  }, 10);

  setTimeout(() => {
    toast.style.transform = "translateY(20px)";
    toast.style.opacity = "0";
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

function updatePrintDate() {
  const d = new Date();
  const dateStr = `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear() + 543}`;
  const el = document.getElementById("print-date");
  if (el) el.innerText = dateStr;
}

// =========================================================
// U-Flow Admin Control Center (A1–A7) Engine
// =========================================================

let adminMap = null;

// View Switcher: Driver View <-> Admin Control Center
function switchView(viewName) {
  const driverView = document.getElementById("view-driver");
  const adminView = document.getElementById("view-admin");

  if (viewName === "admin") {
    if (driverView) driverView.style.display = "none";
    if (adminView) adminView.style.display = "flex";
    
    switchAdminPage("a1");
    renderAdminA1();
    renderAdminA2();
    setTimeout(() => adminMap && adminMap.invalidateSize(), 200);
  } else {
    if (adminView) adminView.style.display = "none";
    if (driverView) driverView.style.display = "flex";
    setTimeout(() => map && map.invalidateSize(), 200);
  }
}

// Navigation between Admin Screens A1-A7
function switchAdminPage(pageKey) {
  ["a1", "a2", "a3", "a4", "a5", "a6", "a7"].forEach(k => {
    const pageEl = document.getElementById(`admin-page-${k}`);
    if (pageEl) pageEl.style.display = "none";
  });

  document.querySelectorAll(".admin-nav-item").forEach(btn => btn.classList.remove("is-active"));

  const activeBtn = document.querySelector(`.admin-nav-item[data-admin-page="${pageKey}"]`);
  if (activeBtn) activeBtn.classList.add("is-active");

  const targetPage = document.getElementById(`admin-page-${pageKey}`);
  if (targetPage) targetPage.style.display = "flex";

  const titleMap = {
    "a1": "ศูนย์ควบคุมวันนี้ (A1)",
    "a2": "รายการต้องเคลียร์ก่อนออกรถ (A2)",
    "a3": "กระดานเกลี่ยงาน (A3)",
    "a4": "ทะเบียนร้านค้า (A4)",
    "a5": "ติดตามและช่วยเหลือ (A5)",
    "a6": "จัดการโซน GeoJSON (A6)",
    "a7": "จัดการคนขับ (A7)"
  };

  const titleEl = document.getElementById("admin-page-title");
  if (titleEl) titleEl.innerText = titleMap[pageKey] || "ศูนย์ควบคุมแมิ";

  if (pageKey === "a1") renderAdminA1();
  if (pageKey === "a2") renderAdminA2();
  if (pageKey === "a4") renderCustomerRosterTable();
}

// Toggle Collapsible Sections in A2
function toggleSection(secId) {
  const el = document.getElementById(secId);
  if (el) {
    el.style.display = el.style.display === "none" ? "block" : "none";
  }
}

// Render Admin A1 Dashboard
function renderAdminA1() {
  const unassignedOrders = state.orders.filter(o => o.geojsonZone === "UNASSIGNED");
  const suspiciousOrders = state.orders.filter(o => o.isOutOfBounds);
  const unreservedOrders = state.orders.filter(o => o.status === "available");

  const totalIssues = unassignedOrders.length + suspiciousOrders.length + unreservedOrders.length;
  const bannerEl = document.getElementById("admin-alert-banner");
  const textEl = document.getElementById("admin-banner-text");
  const actionBtn = document.getElementById("btn-banner-action");

  if (bannerEl && textEl) {
    if (totalIssues > 0) {
      bannerEl.className = "admin-alert-banner is-warning";
      textEl.innerHTML = `<i class="fa-solid fa-triangle-exclamation" style="font-size: 16px;"></i> ต้เคลียร์ก่รถคนส่ง: <b>${unassignedOrders.length}</b> จุดไม่มีโซ · <b>${suspiciousOrders.length}</b> จุดพิกัดน่าสงสัย · <b>${unreservedOrders.length}</b> จุดยังไม่มีคนจอง`;
      if (actionBtn) { actionBtn.style.display = "inline-block"; actionBtn.innerText = "ดูรายการ A2"; }
    } else {
      bannerEl.className = "admin-alert-banner is-cleared";
      textEl.innerHTML = `<i class="fa-solid fa-circle-check" style="font-size: 16px;"></i> พร้อมอรถ  —  ทุกจุดมีปลายทางเรียบร้แล้ว`;
      if (actionBtn) { actionBtn.style.display = "none"; }
    }
  }

  // Stat Cards
  const totalCodSum = state.orders.reduce((sum, o) => sum + (o.cod ? o.price : 0), 0);
  const reservedCount = state.orders.filter(o => o.status === "mine").length;
  const doneCount = state.orders.filter(o => o.status === "done").length;

  document.getElementById("a1-stat-total").innerText = state.orders.length.toLocaleString();
  document.getElementById("a1-stat-reserved").innerText = reservedCount.toLocaleString();
  document.getElementById("a1-stat-done").innerText = doneCount.toLocaleString();
  document.getElementById("a1-stat-cod").innerText = `${totalCodSum.toLocaleString(undefined, {minimumFractionDigits:0})}`;

  // Driver Workload Progress Table
  renderDriverWorkloadTableA1();

  // Admin Mini Map
  initAdminA1Map();

  // Render AC-1 Order Control Board Table
  renderAdminA1Table();
}

// Render Driver Workload Progress Table in A1 (Sorted by heaviest workload descending)
function renderDriverWorkloadTableA1() {
  const tbody = document.getElementById("a1-driver-workload-tbody");
  if (!tbody) return;
  tbody.innerHTML = "";

  const driverStats = Object.values(DRIVER_PROFILES).map(driver => {
    const reserved = state.orders.filter(o => o.geojsonZone === driver.zone && o.status === "mine").length;
    const done = state.orders.filter(o => o.geojsonZone === driver.zone && o.status === "done").length;
    const totalCod = state.orders.filter(o => o.geojsonZone === driver.zone && o.cod).reduce((s, o) => s + o.price, 0);
    const totalLoad = reserved + done;
    const zoneTotal = state.orders.filter(o => o.geojsonZone === driver.zone).length;
    const pct = zoneTotal > 0 ? Math.round((done / zoneTotal) * 100) : 0;

    return { driver, reserved, done, totalCod, totalLoad, zoneTotal, pct };
  });

  // Sort by heaviest workload descending
  driverStats.sort((a, b) => b.totalLoad - a.totalLoad);

  driverStats.forEach(item => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>
        <div style="display: flex; align-items: center; gap: 8px;">
          <div class="driver-avatar" style="width: 28px; height: 28px; font-size: 11px;">${item.driver.avatar}</div>
          <span style="font-weight: 600;">${item.driver.name}</span>
        </div>
      </td>
      <td><span class="chip chip--available" style="font-size: 10px;">${item.driver.zone}</span></td>
      <td><b class="num" style="color: var(--st-mine);">${item.reserved} งา</b></td>
      <td><b class="num" style="color: var(--st-done);">${item.done} งา</b></td>
      <td><b class="num">${item.totalCod.toLocaleString()}</b></td>
      <td>
        <div style="display: flex; align-items: center; gap: 8px;">
          <div style="flex: 1; height: 8px; background: var(--line); border-radius: 4px; overflow: hidden;">
            <div style="width: ${item.pct}%; height: 100%; background: var(--st-available); border-radius: 4px;"></div>
          </div>
          <span style="font-size: 11px; font-weight: 600;">${item.pct}%</span>
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

// Initialize Admin A1 Leaflet Map
function initAdminA1Map() {
  const mapDiv = document.getElementById("admin-a1-map");
  if (!mapDiv) return;

  if (!adminMap) {
    adminMap = L.map("admin-a1-map", { zoomControl: false }).setView([WAREHOUSE_HUB.lat, WAREHOUSE_HUB.lng], 12);
    L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", {
      maxZoom: 19,
      attribution: '&copy; U-Flow Admin'
    }).addTo(adminMap);
  }

  // Draw Solid Zone Polygons on Admin Map
  for (const [zoneName, polygonCoords] of Object.entries(GEOJSON_ZONES)) {
    L.polygon(polygonCoords, {
      color: "var(--st-available)",
      weight: 2,
      fillOpacity: 0.06,
      dashArray: null
    }).addTo(adminMap);
  }
}

// Render Admin A2 Action Required Panel
function renderAdminA2() {
  const unassigned = state.orders.filter(o => o.geojsonZone === "UNASSIGNED");
  const suspicious = state.orders.filter(o => o.isOutOfBounds);
  const unreserved = state.orders.filter(o => o.status === "available");

  // Badge count
  const badgeEl = document.getElementById("admin-a2-badge");
  if (badgeEl) badgeEl.innerText = unassigned.length + suspicious.length + unreserved.length;

  // Section 1: UNASSIGNED
  document.getElementById("cnt-no-zone").innerText = `${unassigned.length} รายการ`;
  const tbody1 = document.getElementById("tbody-no-zone");
  if (tbody1) {
    tbody1.innerHTML = "";
    if (unassigned.length === 0) {
      tbody1.innerHTML = `<tr><td colspan="4" style="text-align: center; color: var(--st-done); padding: 12px; font-weight: 600;"><i class="fa-solid fa-circle-check"></i> เคลียร์เรียบร้อย ไม่มีอดอร์ค้างในถั UNASSIGNED</td></tr>`;
    } else {
      unassigned.forEach(order => {
        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td>
            <div style="font-weight: 700; color: var(--ink);">${order.customer}</div>
            <div class="code" style="font-size: 11px;">${order.id}</div>
          </td>
          <td><span class="num">${order.lat.toFixed(5)}, ${order.lng.toFixed(5)}</span></td>
          <td><span class="num">${order.price.toLocaleString()}</span></td>
          <td>
            <select onchange="reassignOrderZoneAdmin('${order.id}', this.value)" class="search-input" style="height: 32px; font-size: 12px;">
              <option value="">-- เลืโซนเพื่อระบุ --</option>
              <option value="Zone A  —  เมืองลำพูน">Zone A  —  เมืองลำพูน</option>
              <option value="Zone B  —  สารภี/เชียงใหม่">Zone B  —  สารภี/เชียงใหม่</option>
              <option value="Zone C  —  ป่าซาง">Zone C  —  ป่าซาง</option>
            </select>
          </td>
        `;
        tbody1.appendChild(tr);
      });
    }
  }

  // Section 2: Suspicious Coords
  document.getElementById("cnt-suspicious").innerText = `${suspicious.length} รายการ`;
  const tbody2 = document.getElementById("tbody-suspicious");
  if (tbody2) {
    tbody2.innerHTML = "";
    if (suspicious.length === 0) {
      tbody2.innerHTML = `<tr><td colspan="4" style="text-align: center; color: var(--st-done); padding: 12px; font-weight: 600;"><i class="fa-solid fa-circle-check"></i> เคลียร์เรียบร้อย พิกัดถูกต้ตามขเขตบริการทั้งคนส่ง</td></tr>`;
    } else {
      suspicious.forEach(order => {
        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td>
            <div style="font-weight: 700; color: var(--ink);">${order.customer}</div>
            <div class="code" style="font-size: 11px;">${order.id}</div>
          </td>
          <td>
            <span class="num" style="color: var(--st-failed); font-weight: 700;">${order.lat.toFixed(4)}, ${order.lng.toFixed(4)}</span>
            <div style="font-size: 11px; color: var(--st-failed);">ู่นอกพื้นที่ให้บริกา (${order.distance_wh} กม. จากคลั)</div>
          </td>
          <td><span class="num">${order.price.toLocaleString()}</span></td>
          <td>
            <button class="btn btn--secondary btn--sm" onclick="openPinCorrectionModalForOrder('${order.id}')"><i class="fa-solid fa-map-pin"></i> แก้หมุ M5</button>
          </td>
        `;
        tbody2.appendChild(tr);
      });
    }
  }

  // Section 3: No Coords
  document.getElementById("cnt-no-coords").innerText = `0 รายการ`;
  const tbody3 = document.getElementById("tbody-no-coords");
  if (tbody3) {
    tbody3.innerHTML = `<tr><td colspan="4" style="text-align: center; color: var(--st-done); padding: 12px; font-weight: 600;"><i class="fa-solid fa-circle-check"></i> เคลียร์เรียบร้อย ออเดอร์ทุกตัวมีพิกัด Lat, Lng ครบถ้วน</td></tr>`;
  }

  // Section 4: Unreserved Orders
  document.getElementById("cnt-unreserved").innerText = `${unreserved.length} รายการ`;
  const tbody4 = document.getElementById("tbody-unreserved");
  if (tbody4) {
    tbody4.innerHTML = "";
    if (unreserved.length === 0) {
      tbody4.innerHTML = `<tr><td colspan="4" style="text-align: center; color: var(--st-done); padding: 12px; font-weight: 600;"><i class="fa-solid fa-circle-check"></i> เคลียร์เรียบร้อย ทุกออเดอร์ในโซนมีคนขับจองงานแล้ว</td></tr>`;
    } else {
      unreserved.slice(0, 15).forEach(order => {
        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td>
            <div style="font-weight: 700; color: var(--ink);">${order.customer}</div>
            <div class="code" style="font-size: 11px;">${order.id}</div>
          </td>
          <td><span class="chip chip--available" style="font-size: 10px;">${order.geojsonZone}</span></td>
          <td><span class="num">${order.price.toLocaleString()}</span></td>
          <td>
            <select onchange="assignOrderDriverAdmin('${order.id}', this.value)" class="search-input" style="height: 32px; font-size: 12px;">
              <option value="">-- มอบหมายคนขับ --</option>
              <option value="DRV-A01">สมชาย จัดส่ง (Zone A)</option>
              <option value="DRV-B02">วิชั ขับเร็ (Zone B)</option>
              <option value="DRV-C03">สมศักดิ์ สุขใจ (Zone C)</option>
            </select>
          </td>
        `;
        tbody4.appendChild(tr);
      });
    }
  }
}

// Reassign Zone for UNASSIGNED order by Admin
function reassignOrderZoneAdmin(orderId, newZone) {
  if (!newZone) return;
  const order = state.allOrders.find(o => o.id === orderId);
  if (order) {
    order.geojsonZone = newZone;
    filterAndRender();
    renderAdminA1();
    renderAdminA2();
    renderAdminA1Table();
    showNotification(`มอบหมายโซนออเดอร์ ${order.id} เข้าสู่ ${newZone} เรียบร้อยแล้ว`, "done");
  }
}

// Assign Driver to Unreserved Order by Admin
function assignOrderDriverAdmin(orderId, driverId) {
  if (!driverId) return;
  const order = state.allOrders.find(o => o.id === orderId);
  const driver = DRIVER_PROFILES[driverId];
  if (order && driver) {
    order.geojsonZone = driver.zone;
    order.status = "mine";
    filterAndRender();
    renderAdminA1();
    renderAdminA2();
    renderAdminA1Table();
    showNotification(`มอบหมายอดอร์ ${order.id} ให้ ${driver.name} เรียบร้อยแล้ว`, "done");
  }
}

// =========================================================
// AC-0 & AC-1 Admin Control Center Engine
// =========================================================
state.isAdminAuthenticated = false;
state._ORDER_OVERRIDE = {
  "UM-260604-9580059456": {
    order_id: "UM-260604-9580059456",
    delivery_date_override: "8/14/2026",
    orig_delivery_date: "8/13/2026",
    audit_history: [
      { timestamp: "2026-08-12T10:00:00Z", actor: "Admin (ชา)", field: "delivery_date", old_val: "8/13/2026", new_val: "8/14/2026", reason: "ลูกค้าขอเลื่อนวันส่งเนื่องจากติดงานบุ" }
    ]
  },
  "UM-260728-6158837451": {
    order_id: "UM-260728-6158837451",
    zone_override: "Zone B  —  สารภี/เชียงใหม่",
    audit_history: [
      { timestamp: "2026-08-12T11:15:00Z", actor: "Admin (วิชั)", field: "zone", old_val: "UNASSIGNED", new_val: "Zone B  —  สารภี/เชียงใหม่", reason: "ระบุโซนส่งด่วนพิเศษ" }
    ]
  }
};

state.adminSelectedOrderIds = new Set();
state.adminActiveFlagFilter = "all";
state.adminSortColumn = null;
state.adminSortDirection = "asc";
state.activeBulkAction = null;

// AC-0 Admin Auth Functions
function openAdminAuthModal() {
  document.getElementById("modal-admin-auth").classList.add("is-open");
  const input = document.getElementById("admin-pin-input");
  if (input) { input.value = ""; input.focus(); }
  document.getElementById("admin-auth-error-msg").style.display = "none";
}

function closeAdminAuthModal() {
  document.getElementById("modal-admin-auth").classList.remove("is-open");
}

function submitAdminAuth() {
  const pin = document.getElementById("admin-pin-input")?.value?.trim();
  if (pin === "9999") {
    state.isAdminAuthenticated = true;
    closeAdminAuthModal();
    switchView("admin");
    showNotification("เข้าสู่ศูนย์ควบคุมผู้ดูแลระบบเรียบร้อยแล้ว", "done");
  } else {
    document.getElementById("admin-auth-error-msg").style.display = "block";
  }
}

// AC-1 Filter & Render Engine for Main Control Board
function renderAdminA1Table() {
  const tbody = document.getElementById("ac1-orders-tbody");
  const mobileContainer = document.getElementById("ac1-orders-mobile");
  if (!tbody) return;

  const searchQuery = (document.getElementById("ac1-search-input")?.value || "").trim().toLowerCase();
  const dateFilter = document.getElementById("ac1-date-select")?.value || "all";
  const zoneFilter = document.getElementById("ac1-zone-select")?.value || "all";
  const driverFilter = document.getElementById("ac1-driver-select")?.value || "all";
  const statusFilter = document.getElementById("ac1-status-select")?.value || "all";

  let filtered = state.allOrders.filter(order => {
    // 1. Merge Override values for filtering
    const override = state._ORDER_OVERRIDE[order.id] || {};
    const effectiveDate = override.delivery_date_override || order.timeWindow;
    const effectiveZone = override.zone_override || order.geojsonZone;

    // Search query match (Order ID suffix, Customer name, Phone)
    const matchesSearch = !searchQuery ||
      order.id.toLowerCase().includes(searchQuery) ||
      order.customer.toLowerCase().includes(searchQuery) ||
      order.phone.includes(searchQuery);

    // Date filter match
    let matchesDate = true;
    if (dateFilter === "8/13/2026") {
      matchesDate = effectiveDate === "8/12/2026" || effectiveDate === "8/13/2026";
    } else if (dateFilter !== "all") {
      matchesDate = effectiveDate === dateFilter;
    }

    // Zone filter match
    const matchesZone = zoneFilter === "all" || effectiveZone === zoneFilter;

    // Driver filter match
    let matchesDriver = true;
    if (driverFilter === "unassigned") matchesDriver = order.status === "available" || order.status === "out";
    else if (driverFilter !== "all") matchesDriver = order.assignedDriverId === driverFilter || (driverFilter === "DRV-A01" && order.geojsonZone === "Zone A  —  เมืองลำพูน");

    // Status filter match
    const matchesStatus = statusFilter === "all" || order.status === statusFilter || (statusFilter === "hold" && override.hold);

    // Problem Flag filter match
    let matchesFlag = true;
    const isNoZone = effectiveZone === "UNASSIGNED";
    const isSuspicious = order.lat < 17.9 || order.lng > 99.6;
    const isNoCoords = !order.lat || !order.lng;
    const isOverdue = order.status !== "done" && new Date(effectiveDate) < new Date("8/12/2026");

    if (state.adminActiveFlagFilter === "no_zone") matchesFlag = isNoZone;
    else if (state.adminActiveFlagFilter === "suspicious") matchesFlag = isSuspicious;
    else if (state.adminActiveFlagFilter === "no_coords") matchesFlag = isNoCoords;
    else if (state.adminActiveFlagFilter === "overdue") matchesFlag = isOverdue;

    return matchesSearch && matchesDate && matchesZone && matchesDriver && matchesStatus && matchesFlag;
  });

  // Sort Table if column selected
  if (state.adminSortColumn) {
    filtered.sort((a, b) => {
      let valA = a[state.adminSortColumn] || "";
      let valB = b[state.adminSortColumn] || "";
      if (typeof valA === "string") valA = valA.toLowerCase();
      if (typeof valB === "string") valB = valB.toLowerCase();
      if (valA < valB) return state.adminSortDirection === "asc" ? -1 : 1;
      if (valA > valB) return state.adminSortDirection === "asc" ? 1 : -1;
      return 0;
    });
  }

  // Update Result Count
  const countEl = document.getElementById("ac1-result-count");
  if (countEl) countEl.innerText = `แสดง ${filtered.length} รายการ`;

  tbody.innerHTML = "";
  if (mobileContainer) mobileContainer.innerHTML = "";

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9" style="text-align: center; padding: 30px; color: var(--ink-3); font-size: 13px;"><i class="fa-solid fa-box-open" style="font-size: 24px; margin-bottom: 6px;"></i><br>ไม่พบอดอร์ที่ตรงกับเงื่อนไขตัวกร</td></tr>`;
    if (mobileContainer) mobileContainer.innerHTML = `<div style="text-align: center; padding: 20px; color: var(--ink-3); font-size: 13px;">ไม่พบอดอร์ที่ตรงกับเงื่อนไ</div>`;
    return;
  }

  filtered.forEach(order => {
    const override = state._ORDER_OVERRIDE[order.id] || {};
    const effectiveDate = override.delivery_date_override || order.timeWindow;
    const effectiveZone = override.zone_override || order.geojsonZone;
    const isChecked = state.adminSelectedOrderIds.has(order.id);

    // Problem Flag Check
    const hasProblem = effectiveZone === "UNASSIGNED" || order.lat < 17.9 || order.lng > 99.6 || !order.lat;
    let flagIcon = "";
    if (effectiveZone === "UNASSIGNED") flagIcon = `<i class="fa-solid fa-flag" style="color: var(--st-failed);" title="ไม่มีโซน (UNASSIGNED)"></i>`;
    else if (order.lat < 17.9 || order.lng > 99.6) flagIcon = `<i class="fa-solid fa-flag" style="color: var(--st-attention);" title="พิกัดน่าคนส่ง"></i>`;
    else if (!order.lat) flagIcon = `<i class="fa-solid fa-flag" style="color: var(--ink-3);" title="ไม่มีพิกัด"></i>`;

    // Date formatting (Strikethrough if overridden)
    const dateHtml = override.delivery_date_override
      ? `<s style="color: var(--ink-3); font-size: 11px;">${override.orig_delivery_date || order.timeWindow}</s> <b style="color: var(--st-mine); font-size: 12px;">${override.delivery_date_override}</b>`
      : `<span style="font-size: 12px;">${order.timeWindow}</span>`;

    // Zone chip (Pencil icon if overridden)
    const zoneChip = `<span class="chip ${effectiveZone === 'UNASSIGNED' ? 'chip--failed' : 'chip--available'}" style="font-size: 11px;">${effectiveZone} ${override.zone_override ? '<i class="fa-solid fa-pencil" style="margin-left: 2px;"></i>' : ''}</span>`;

    // Driver Avatar & Column N Route Code
    let driverText = " — ";
    const rCode = order.routeCode || override.assigned_route_code;
    if (order.status === "mine" || rCode) {
      const displayCode = rCode || generateRouteCode(state.activeDriver, order.timeWindow, order.orderDate);
      driverText = `
        <div style="display: flex; flex-direction: column; gap: 2px;">
          <div style="display: flex; align-items: center; gap: 4px;">
            <div class="driver-avatar" style="width: 18px; height: 18px; font-size: 9px;">A01</div>
            <span style="font-size: 11px; font-weight: 600;">ชา</span>
          </div>
          <div class="code" style="font-size: 10px; color: var(--st-mine); font-weight: 700;" title="รหัสจัดส่ง Column N คนคนส่ง">${displayCode}</div>
        </div>
      `;
    }

    // Status Chip
    let statusChip = `<span class="chip chip--available">${order.status}</span>`;
    if (order.status === "mine") statusChip = `<span class="chip chip--mine">จองแล้ว</span>`;
    else if (order.status === "done") statusChip = `<span class="chip chip--done">ส่งสำเร็จ</span>`;
    else if (order.status === "failed") statusChip = `<span class="chip chip--failed">ไม่สำเร็จ</span>`;

    // Order ID Suffix (6 digits)
    const orderIdSuffix = order.id.length > 10 ? `...${order.id.slice(-6)}` : order.id;

    // Desktop Row
    const tr = document.createElement("tr");
    if (hasProblem) tr.className = "table-row-problem";
    tr.style.cursor = "pointer";

    tr.innerHTML = `
      <td style="text-align: center;" onclick="event.stopPropagation();">
        <input type="checkbox" class="ac1-row-checkbox" value="${order.id}" ${isChecked ? 'checked' : ''} onchange="toggleAdminOrderCheckbox('${order.id}', this.checked)">
      </td>
      <td style="text-align: center;">${flagIcon}</td>
      <td onclick="openAdminOrderDetailPanel('${order.id}')">
        <div style="font-weight: 700; font-size: 13px; color: var(--ink);">${order.customer}</div>
        <div class="code" style="font-size: 11px; color: var(--ink-2);">${order.id} (<span class="num">${orderIdSuffix}</span>)</div>
      </td>
      <td onclick="openAdminOrderDetailPanel('${order.id}')">${dateHtml}</td>
      <td onclick="openAdminOrderDetailPanel('${order.id}')">${zoneChip}</td>
      <td onclick="openAdminOrderDetailPanel('${order.id}')">${driverText}</td>
      <td onclick="openAdminOrderDetailPanel('${order.id}')">${statusChip}</td>
      <td style="text-align: right;" onclick="openAdminOrderDetailPanel('${order.id}')"><span class="num" style="font-weight: 700; font-size: 13px;">${order.price.toLocaleString(undefined, {minimumFractionDigits: 2})}</span></td>
      <td style="text-align: center;" onclick="event.stopPropagation();">
        <button class="btn btn--secondary btn--sm" style="padding: 0 6px;" onclick="openAdminOrderDetailPanel('${order.id}')"><i class="fa-solid fa-ellipsis"></i></button>
      </td>
    `;
    tbody.appendChild(tr);

    // Mobile Card (for <= 768px view)
    if (mobileContainer) {
      const mobileCard = document.createElement("div");
      mobileCard.className = `card card--status is-${order.status} ${hasProblem ? 'table-row-problem' : ''}`;
      mobileCard.style.padding = "10px 12px";
      mobileCard.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 4px;">
          <div style="display: flex; align-items: center; gap: 8px;">
            <input type="checkbox" value="${order.id}" ${isChecked ? 'checked' : ''} onchange="toggleAdminOrderCheckbox('${order.id}', this.checked)">
            <div>
              <div style="font-weight: 700; font-size: 13px; color: var(--ink);">${order.customer}</div>
              <div class="code" style="font-size: 11px; color: var(--ink-2);">${order.id}</div>
            </div>
          </div>
          ${statusChip}
        </div>
        <div style="font-size: 11px; color: var(--ink-2); display: flex; justify-content: space-between; margin-top: 6px;">
          <span>วันส่ง: ${dateHtml}</span>
          <span>${zoneChip}</span>
          <b class="num" style="color: var(--ink);">${order.price.toLocaleString()}</b>
        </div>
      `;
      mobileContainer.appendChild(mobileCard);
    }
  });
}

// Problem Flag Filter Toggle
function filterAdminFlag(flag) {
  state.adminActiveFlagFilter = flag;
  document.querySelectorAll(".problem-chip-btn").forEach(btn => {
    btn.classList.toggle("is-active", btn.dataset.flag === flag);
  });
  renderAdminA1Table();
}

// Reset Admin Filters
function resetAdminFilters() {
  document.getElementById("ac1-search-input").value = "";
  document.getElementById("ac1-date-select").value = "all";
  document.getElementById("ac1-zone-select").value = "all";
  document.getElementById("ac1-driver-select").value = "all";
  document.getElementById("ac1-status-select").value = "all";
  filterAdminFlag("all");
}

// Sort Admin Table Columns
function sortAdminTable(col) {
  if (state.adminSortColumn === col) {
    state.adminSortDirection = state.adminSortDirection === "asc" ? "desc" : "asc";
  } else {
    state.adminSortColumn = col;
    state.adminSortDirection = "asc";
  }
  renderAdminA1Table();
}

// Checkbox Selection Logic & Sticky Bulk Bar
function toggleAllAdminCheckboxes(masterEl) {
  const isChecked = masterEl.checked;
  const visibleCheckboxes = document.querySelectorAll(".ac1-row-checkbox");
  visibleCheckboxes.forEach(cb => {
    cb.checked = isChecked;
    if (isChecked) state.adminSelectedOrderIds.add(cb.value);
    else state.adminSelectedOrderIds.delete(cb.value);
  });
  updateAdminBulkBar();
}

function toggleAdminOrderCheckbox(orderId, isChecked) {
  if (isChecked) state.adminSelectedOrderIds.add(orderId);
  else state.adminSelectedOrderIds.delete(orderId);
  updateAdminBulkBar();
}

function updateAdminBulkBar() {
  const bulkBar = document.getElementById("ac1-bulk-bar");
  const countText = document.getElementById("ac1-bulk-count-text");
  const count = state.adminSelectedOrderIds.size;

  if (count > 0) {
    bulkBar.style.display = "flex";
    countText.innerText = `เลืคนส่งู่ ${count} รายการ`;
  } else {
    bulkBar.style.display = "none";
  }
}

// Bulk Action Modal Handler (AC-1)
function openBulkActionModal(actionType) {
  state.activeBulkAction = actionType;
  const count = state.adminSelectedOrderIds.size;
  if (count === 0) return;

  const modal = document.getElementById("modal-admin-bulk-confirm");
  const titleEl = document.getElementById("bulk-modal-title");
  const subtitleEl = document.getElementById("bulk-modal-subtitle");
  const previewListEl = document.getElementById("bulk-preview-list");
  const fieldsEl = document.getElementById("bulk-action-fields");
  const reasonInput = document.getElementById("bulk-reason-input");
  document.getElementById("bulk-error-msg").style.display = "none";
  reasonInput.value = "";

  subtitleEl.innerText = `รายการที่เลืทั้งคนส่ง ${count} รายการ:`;

  // Preview first 3 items
  const selectedArray = Array.from(state.adminSelectedOrderIds);
  const previewItems = selectedArray.slice(0, 3).map(id => {
    const o = state.allOrders.find(item => item.id === id);
    return `<div> —  <b>${o ? o.customer : id}</b> (${id})</div>`;
  }).join("");
  const moreText = count > 3 ? `<div style="color: var(--ink-3); font-style: italic;">...และอีก ${count - 3} รายการ</div>` : "";
  previewListEl.innerHTML = previewItems + moreText;

  // Dynamic Input Fields by Action Type
  if (actionType === "reschedule") {
    titleEl.innerText = "📅 เลื่อนวันจัดส่ง (Batch Reschedule)";
    fieldsEl.innerHTML = `
      <label style="font-size: 12px; font-weight: 600; color: var(--ink-2);">เลืวันจัดส่งใ้:</label>
      <input type="date" id="bulk-field-date" class="admin-filter-input" style="width: 100%; height: 38px;" value="2026-08-14">
    `;
  } else if (actionType === "driver") {
    titleEl.innerText = "🚚 มอบหมายคนขับ (Batch Driver Assignment)";
    fieldsEl.innerHTML = `
      <label style="font-size: 12px; font-weight: 600; color: var(--ink-2);">เลืคนขับผู้รับผิดชอ:</label>
      <select id="bulk-field-driver" class="admin-filter-select" style="width: 100%; height: 38px;">
        <option value="DRV-A01">สมชาย จัดส่ง (Zone A)</option>
        <option value="DRV-B02">วิชั ขับเร็ (Zone B)</option>
        <option value="DRV-C03">สมศักดิ์ สุขใจ (Zone C)</option>
      </select>
    `;
  } else if (actionType === "zone") {
    titleEl.innerText = "🗺 กำดโซนจัดส่ง (Batch Zone Override)";
    fieldsEl.innerHTML = `
      <label style="font-size: 12px; font-weight: 600; color: var(--ink-2);">เลืโซนการจัดส่งใหม่:</label>
      <select id="bulk-field-zone" class="admin-filter-select" style="width: 100%; height: 38px;">
        <option value="Zone A  —  เมืองลำพูน">Zone A  —  เมืองลำพูน</option>
        <option value="Zone B  —  สารภี/เชียงใหม่">Zone B  —  สารภี/เชียงใหม่</option>
        <option value="Zone C  —  ป่าซาง">Zone C  —  ป่าซาง</option>
      </select>
    `;
  } else if (actionType === "hold") {
    titleEl.innerText = "⏸️ พักการจัดส่งไว้ก่อน (Batch Hold)";
    fieldsEl.innerHTML = `
      <div style="background: var(--st-attention-bg); padding: 10px; border-radius: 6px; font-size: 12px; color: var(--st-attention);">
        <i class="fa-solid fa-triangle-exclamation"></i> ออเดอร์ทั้งหมดจะถูกเปลี่ยนสถานะเป็น Hold และไม่ปรากฏในหน้าคนขับจนกว่าจะปลดล็อก
      </div>
    `;
  }

  modal.classList.add("is-open");
}

function closeBulkActionModal() {
  document.getElementById("modal-admin-bulk-confirm").classList.remove("is-open");
}

function executeBulkAction() {
  const reason = document.getElementById("bulk-reason-input")?.value?.trim();
  const errorMsg = document.getElementById("bulk-error-msg");

  if (!reason) {
    errorMsg.style.display = "block";
    return;
  }

  const selectedIds = Array.from(state.adminSelectedOrderIds);
  const actionType = state.activeBulkAction;

  selectedIds.forEach(orderId => {
    if (!state._ORDER_OVERRIDE[orderId]) {
      state._ORDER_OVERRIDE[orderId] = { order_id: orderId, audit_history: [] };
    }
    const record = state._ORDER_OVERRIDE[orderId];

    if (actionType === "reschedule") {
      const newDateVal = document.getElementById("bulk-field-date")?.value;
      const formattedDate = newDateVal ? new Date(newDateVal).toLocaleDateString("en-US") : "8/14/2026";
      record.orig_delivery_date = record.orig_delivery_date || state.allOrders.find(o => o.id === orderId)?.timeWindow;
      record.delivery_date_override = formattedDate;
      record.audit_history.push({ timestamp: new Date().toISOString(), actor: "Admin", field: "delivery_date", old_val: record.orig_delivery_date, new_val: formattedDate, reason });
    } else if (actionType === "driver") {
      const driverId = document.getElementById("bulk-field-driver")?.value;
      const order = state.allOrders.find(o => o.id === orderId);
      if (order) {
        order.assignedDriverId = driverId;
        order.status = "mine";
        record.audit_history.push({ timestamp: new Date().toISOString(), actor: "Admin", field: "assigned_driver", old_val: "unassigned", new_val: driverId, reason });
      }
    } else if (actionType === "zone") {
      const newZone = document.getElementById("bulk-field-zone")?.value;
      record.zone_override = newZone;
      record.audit_history.push({ timestamp: new Date().toISOString(), actor: "Admin", field: "zone_override", old_val: "auto", new_val: newZone, reason });
    } else if (actionType === "hold") {
      record.hold = true;
      record.audit_history.push({ timestamp: new Date().toISOString(), actor: "Admin", field: "hold", old_val: "false", new_val: "true", reason });
    }
  });

  closeBulkActionModal();
  state.adminSelectedOrderIds.clear();
  updateAdminBulkBar();
  filterAndRender();
  renderAdminA1Table();
  showNotification(`ดำเนินการกลุ่ ${selectedIds.length} รายการ เรียบร้อยแล้ว`, "done");
}

// =========================================================
// AC-2 Slide-over Panel Engine & AC-3 Customers Directory
// =========================================================
let activeAc2OrderId = null;
let ac2MiniMap = null;

state._CUSTOMERS = {
  "081-487-8092": {
    phone: "081-487-8092",
    customer_name: "ร้านเจ๊เอี่ย ร้านข้าว",
    address: "เมืองลำพูน, ลำพูน (H6RT+8V ตำบล ในเมื เภอเมืองลำพูน ลำพู 51000 ประเทศไท)",
    zone: "Zone A  —  เมืองลำพูน",
    opentime: "08:00 - 17:00",
    lunch_break: "12:00 - 13:00",
    offday: "วันอาทิตย์",
    narrow_alley: true,
    stairs: false,
    parking: "จอดหน้าร้านริมถนน",
    entry_note: "เข้าซอย 2 ฝั่งวัดร้องส้า",
    call_mins: 15,
    recipient: "คุณเจ๊เอี่ย",
    alt_phone: "081-999-8877",
    chips: ["โทรก่อน 15 นาที.", "ปิด 12:00-13:00", "ซอยแคบ"],
    history_count: 8,
    last_delivery: "8/12/2026",
    is_complete: true
  },
  "091-308-6526": {
    phone: "091-308-6526",
    customer_name: "ลลิตภัทร เกตุกิ่ง",
    address: "เมืองลำพูน, ลำพูน (G2QG+2FG)",
    zone: "Zone A  —  เมืองลำพูน",
    opentime: "09:00 - 18:00",
    lunch_break: "",
    offday: "",
    narrow_alley: false,
    stairs: true,
    parking: "จอดลานคลังตึก",
    entry_note: "",
    call_mins: 10,
    recipient: "คุณลลิตภัทร",
    chips: ["โทรก่อน 10 นาที.", "ขึ้นบันได"],
    history_count: 14,
    last_delivery: "8/13/2026",
    is_complete: true
  }
};

// AC-2 Slide-over Panel Functions
function openAdminOrderDetailPanel(orderId) {
  activeAc2OrderId = orderId;
  const order = state.allOrders.find(o => o.id === orderId);
  if (!order) return;

  const override = state._ORDER_OVERRIDE[orderId] || {};

  // Section 1 Header
  document.getElementById("ac2-header-title").innerText = order.customer;
  document.getElementById("ac2-header-order-id").innerText = order.id;
  document.getElementById("ac2-header-status-chip").className = `chip chip--${order.status === 'mine' ? 'mine' : 'available'}`;
  document.getElementById("ac2-header-status-chip").innerText = order.status;

  // Section 2 Locked Unii Source Info
  document.getElementById("ac2-unii-price").innerText = `${order.price.toLocaleString(undefined, {minimumFractionDigits:2})}`;
  document.getElementById("ac2-unii-payment").innerText = order.cod ? "COD (เก็บเงินปลายทาง)" : "จ่ายเงินแล้ว";
  document.getElementById("ac2-unii-customer").innerText = order.customer;
  document.getElementById("ac2-unii-phone").innerText = order.phone;
  document.getElementById("ac2-unii-address").innerText = order.address;

  // Render SKU product items
  const ac2SkuItems = (state.skuDetails && state.skuDetails[order.id]) || [];
  const ac2SkuCountEl = document.getElementById("ac2-sku-count");
  const ac2SkuListEl = document.getElementById("ac2-sku-items-list");

  if (ac2SkuCountEl) ac2SkuCountEl.innerText = ac2SkuItems.length;
  if (ac2SkuListEl) {
    if (ac2SkuItems.length > 0) {
      ac2SkuListEl.innerHTML = ac2SkuItems.map(item => `
        <div style="display: flex; justify-content: space-between; align-items: center; background: var(--card); padding: 4px 8px; border-radius: 4px; border: 1px solid var(--line);">
          <div style="flex: 1; overflow: hidden; padding-right: 6px;">
            <div style="font-weight: 600; color: var(--ink); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${item.name}</div>
            <div style="font-size: 10px; color: var(--ink-3);" class="code">SKU: ${item.sku}</div>
          </div>
          <div style="text-align: right; flex-shrink: 0;">
            <div style="font-weight: 700; color: var(--st-available);">${item.qty} ${item.unit}</div>
            <div style="font-size: 10px; color: var(--ink-2);" class="num">${item.itemTotal.toLocaleString(undefined, {minimumFractionDigits:2})}</div>
          </div>
        </div>
      `).join("");
    } else {
      ac2SkuListEl.innerHTML = `<div style="color: var(--ink-3); text-align: center; padding: 6px;">ไม่มีข้อมูลรายการสินค้าใ SKU Details</div>`;
    }
  }

  // Section 3 Editable Delivery Overrides
  const dateInput = document.getElementById("ac2-input-date");
  if (dateInput) dateInput.value = override.delivery_date_override ? "2026-08-14" : "";
  document.getElementById("ac2-orig-date-hint").innerText = `วันส่งเดิมจาก Unii: ${order.timeWindow}`;

  // Render Attached Photos & Slips in Admin AC-2 Panel
  const photosBox = document.getElementById("ac2-photos-preview-box");
  if (photosBox) {
    const proofList = override.proof_photos || [];
    const slipList = override.slip_photos || [];
    if (proofList.length === 0 && slipList.length === 0) {
      photosBox.innerHTML = `<span style="font-size: 11px; color: var(--ink-3);">ยังไม่มีรูปแนบในออเดอร์นี้</span>`;
    } else {
      let html = "";
      proofList.forEach((src, idx) => {
        html += `
          <div style="position: relative; width: 60px; height: 60px; border-radius: 6px; overflow: hidden; border: 1px solid var(--line); cursor: pointer;" title="รูปจัดส่งสินค้ #${idx+1}" onclick="window.open('${src}', '_blank')">
            <img src="${src}" style="width: 100%; height: 100%; object-fit: cover;">
            <span style="position: absolute; bottom: 0; left: 0; right: 0; background: rgba(0,0,0,0.6); color: #fff; font-size: 8px; text-align: center;">สินค้า</span>
          </div>
        `;
      });
      slipList.forEach((src, idx) => {
        html += `
          <div style="position: relative; width: 60px; height: 60px; border-radius: 6px; overflow: hidden; border: 1px solid var(--st-available-line); cursor: pointer;" title="สลิปโอนเงิน #${idx+1}" onclick="window.open('${src}', '_blank')">
            <img src="${src}" style="width: 100%; height: 100%; object-fit: cover;">
            <span style="position: absolute; bottom: 0; left: 0; right: 0; background: var(--st-available); color: #fff; font-size: 8px; text-align: center;">สลิป</span>
          </div>
        `;
      });
      photosBox.innerHTML = html;
    }
  }
  document.getElementById("ac2-input-zone").value = override.zone_override || "auto";
  document.getElementById("ac2-input-driver").value = order.assignedDriverId || (order.status === 'mine' ? 'DRV-A01' : '');
  document.getElementById("ac2-input-priority").value = override.priority || "normal";
  document.getElementById("ac2-input-hold").checked = Boolean(override.hold);
  document.getElementById("ac2-input-note").value = override.driver_note || "";
  document.getElementById("ac2-reason-input").value = "";
  document.getElementById("ac2-error-msg").style.display = "none";

  // Section 4 Coords & Mini Map
  document.getElementById("ac2-coords-val").innerText = `${order.lat.toFixed(5)}, ${order.lng.toFixed(5)}`;
  document.getElementById("ac2-coords-source").innerText = order.isPinModified ? "(แก้ไขโดย M5)" : "(จาก Unii)";
  const alertEl = document.getElementById("ac2-coords-alert");
  if (alertEl) alertEl.style.display = (order.lat < 17.9 || order.lng > 99.6) ? "block" : "none";

  // Section 5 Clustered Stop Breakdown
  const key = `${order.lat.toFixed(5)},${order.lng.toFixed(5)}`;
  const clusterOrders = state.clusterGroups[key] || [order];
  const clusterListEl = document.getElementById("ac2-cluster-orders-list");
  if (clusterListEl) {
    clusterListEl.innerHTML = clusterOrders.map(item => `
      <div style="display: flex; justify-content: space-between; align-items: center; background: var(--card); padding: 4px 8px; border-radius: 4px; border: 1px solid var(--line);">
        <span> —  <b>${item.customer}</b> (${item.id})</span>
        <span class="num" style="font-weight: 700;">${item.price.toLocaleString()}</span>
      </div>
    `).join("");
  }

  // Section 6 Audit History Timeline
  const historyList = override.audit_history || [
    { timestamp: "2026-08-12T08:00:00Z", actor: "Unii Sync API", field: "import", old_val: "-", new_val: "Imported", reason: "นำเข้าคำสั่งซื้อตั้งต้นเรียบร้อย" }
  ];
  const timelineEl = document.getElementById("ac2-audit-timeline");
  if (timelineEl) {
    timelineEl.innerHTML = historyList.map(h => `
      <div style="background: var(--page); border-left: 3px solid var(--st-available); padding: 6px 10px; border-radius: 4px;">
        <div style="display: flex; justify-content: space-between; font-weight: 600; font-size: 11px;">
          <span>${h.actor}  —  <i style="color: var(--st-mine);">${h.field}</i></span>
          <span style="color: var(--ink-3);">${new Date(h.timestamp).toLocaleTimeString()}</span>
        </div>
        <div style="font-size: 10px; color: var(--ink-2); margin-top: 2px;">เุผ: "${h.reason}"</div>
      </div>
    `).join("");
  }

  // Open Slide-over
  const slideover = document.getElementById("admin-ac2-slideover");
  if (slideover) slideover.classList.add("is-open");

  // Init Mini Map inside AC-2
  setTimeout(() => {
    initAc2MiniMap(order.lat, order.lng);
  }, 300);
}

function closeAdminOrderDetailPanel() {
  const slideover = document.getElementById("admin-ac2-slideover");
  if (slideover) slideover.classList.remove("is-open");
  activeAc2OrderId = null;
}

function copyAc2OrderId() {
  if (activeAc2OrderId) {
    navigator.clipboard.writeText(activeAc2OrderId);
    showNotification(`คัดลอกเลขออเดอร์ ${activeAc2OrderId} เรียบร้อยแล้ว`, "done");
  }
}

function initAc2MiniMap(lat, lng) {
  const container = document.getElementById("ac2-mini-map");
  if (!container) return;
  container.innerHTML = "";

  if (ac2MiniMap) {
    ac2MiniMap.remove();
    ac2MiniMap = null;
  }

  ac2MiniMap = L.map("ac2-mini-map", { zoomControl: false }).setView([lat, lng], 15);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19 }).addTo(ac2MiniMap);
  L.marker([lat, lng]).addTo(ac2MiniMap);
}

async function saveAc2OrderOverride() {
  const reason = document.getElementById("ac2-reason-input")?.value?.trim();
  const errorMsg = document.getElementById("ac2-error-msg");

  if (!reason) {
    if (errorMsg) errorMsg.style.display = "block";
    return;
  }

  const orderId = activeAc2OrderId;
  if (!orderId) return;

  const dateVal = document.getElementById("ac2-input-date")?.value;
  const deliveryDateOverride = dateVal ? new Date(dateVal).toLocaleDateString("en-US") : "";
  const zoneVal = document.getElementById("ac2-input-zone")?.value;
  const zoneOverride = (zoneVal && zoneVal !== "auto") ? zoneVal : "";
  const driverNote = document.getElementById("ac2-input-note")?.value || "";
  const priority = document.getElementById("ac2-input-priority")?.value || "normal";
  const hold = Boolean(document.getElementById("ac2-input-hold")?.checked);
  const driverId = document.getElementById("ac2-input-driver")?.value || "";

  const token = localStorage.getItem('uflow_jwt_token');

  try {
    const res = await fetch("/api/stop/override", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`
      },
      body: JSON.stringify({
        orderId,
        deliveryDateOverride,
        zoneOverride,
        driverNote,
        priority,
        hold,
        driverId,
        reason
      })
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || "Failed to save overrides");
    }

    await loadDatabase();
    closeAdminOrderDetailPanel();
    filterAndRender();
    renderAdminA1Table();
    showNotification(`บันทึกข้อมูลจัดส่งเรียบร้อย`, "done");
  } catch (err) {
    console.error("Save override error:", err);
    showNotification(err.message || "เกิดข้อผิดพลาดในการบันทึก", "failed");

    if (!state._ORDER_OVERRIDE[orderId]) {
      state._ORDER_OVERRIDE[orderId] = { order_id: orderId, audit_history: [] };
    }
    const record = state._ORDER_OVERRIDE[orderId];
    if (dateVal) record.delivery_date_override = deliveryDateOverride;
    if (zoneOverride) record.zone_override = zoneOverride;
    record.driver_note = driverNote;
    record.priority = priority;
    record.hold = hold;

    record.audit_history.push({
      timestamp: new Date().toISOString(),
      actor: "Admin",
      field: "order_override_save",
      old_val: "original",
      new_val: "updated",
      reason: reason
    });

    saveStateToLocalStorage();
    closeAdminOrderDetailPanel();
    filterAndRender();
    renderAdminA1Table();
  }
}

async function releaseAc2Driver() {
  if (!activeAc2OrderId) return;
  const driverSelect = document.getElementById("ac2-input-driver");
  if (driverSelect) driverSelect.value = "";

  const reason = prompt("ระบุเหตุผลในการปลดการจองคนขับ (บังคับกรอก):");
  if (reason) {
    const reasonInput = document.getElementById("ac2-reason-input");
    if (reasonInput) reasonInput.value = reason;
    await saveAc2OrderOverride();
  }
}

function splitAc2Stop() {
  if (activeAc2OrderId) {
    showNotification(`แยกอดอร์ ${activeAc2OrderId} กจากจุดรวมเรียบร้อยแล้ว`, "done");
    closeAdminOrderDetailPanel();
  }
}

function cancelAc2Delivery() {
  if (activeAc2OrderId) {
    const reason = prompt("ระบุเุผลในการยกเลิกจัดส่งออเดอร์นี้ (บังคับกร):");
    if (reason) {
      const order = state.allOrders.find(o => o.id === activeAc2OrderId);
      if (order) order.status = "failed";
      showNotification(`ยกเลิกจัดส่งอดอร์ ${activeAc2OrderId} เรียบร้อยแล้ว`, "failed");
      closeAdminOrderDetailPanel();
      filterAndRender();
      renderAdminA1Table();
    }
  }
}

function openAc2PinEditor() {
  if (activeAc2OrderId) {
    openPinCorrectionModalForOrder(activeAc2OrderId);
  }
}

// AC-3 Customer Directory Engine
function renderCustomerRosterTable() {
  const tbody = document.getElementById("ac3-customers-tbody");
  if (!tbody) return;
  tbody.innerHTML = "";

  const query = (document.getElementById("ac3-search-input")?.value || "").trim().toLowerCase();
  const zoneFilter = document.getElementById("ac3-zone-select")?.value || "all";
  const statusFilter = document.getElementById("ac3-status-select")?.value || "all";

  const customersList = Object.values(state._CUSTOMERS).filter(c => {
    const matchesSearch = !query || c.customer_name.toLowerCase().includes(query) || c.phone.includes(query);
    const matchesZone = zoneFilter === "all" || c.zone === zoneFilter;
    const matchesStatus = statusFilter === "all" || (statusFilter === "complete" && c.is_complete) || (statusFilter === "incomplete" && !c.is_complete);
    return matchesSearch && matchesZone && matchesStatus;
  });

  if (customersList.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: var(--ink-3); padding: 20px;">ไม่พบข้อมูลร้านค้าตามเงื่อนไ</td></tr>`;
    return;
  }

  customersList.forEach(c => {
    const chipsHtml = (c.chips || []).map(chip => `<span class="chip chip--attention" style="font-size: 10px; padding: 1px 6px;">${chip}</span>`).join(" ");
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><b style="color: var(--ink); font-size: 13px;">${c.customer_name}</b></td>
      <td><span class="num" style="font-weight: 600;">${c.phone}</span></td>
      <td><span class="chip chip--available" style="font-size: 10px;">${c.zone || 'Zone A'}</span></td>
      <td>${chipsHtml || '<span style="color: var(--ink-3); font-size: 11px;"> — </span>'}</td>
      <td style="text-align: center;"><span class="num">${c.history_count || 0}</span></td>
      <td><span class="num" style="font-size: 11px;">${c.last_delivery || '-'}</span></td>
      <td>${c.is_complete ? '<span class="chip chip--done">ครบถ้ว</span>' : '<span class="chip chip--failed">ยังไม่กร</span>'}</td>
      <td style="text-align: center;">
        <button class="btn btn--secondary btn--sm" style="padding: 0 8px; font-size: 11px;" onclick="openCustomerEditModal('${c.phone}')"><i class="fa-solid fa-pen-to-square"></i> แก้ไ</button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

function openCustomerEditModal(phone) {
  const cust = phone ? state._CUSTOMERS[phone] : null;
  const modal = document.getElementById("modal-customer-detail");
  if (!modal) return;

  document.getElementById("ac3-input-name").value = cust ? cust.customer_name : "";
  document.getElementById("ac3-input-phone").value = cust ? cust.phone : "";
  document.getElementById("ac3-input-opentime").value = cust ? cust.opentime : "08:00 - 17:00";
  document.getElementById("ac3-input-lunch").value = cust ? cust.lunch_break : "12:00 - 13:00";
  document.getElementById("ac3-input-offday").value = cust ? cust.offday : "วันอาทิตย์";
  document.getElementById("ac3-input-narrow").checked = cust ? Boolean(cust.narrow_alley) : false;
  document.getElementById("ac3-input-stairs").checked = cust ? Boolean(cust.stairs) : false;
  document.getElementById("ac3-input-parking").value = cust ? cust.parking : "";
  document.getElementById("ac3-input-entrynote").value = cust ? cust.entry_note : "";
  document.getElementById("ac3-input-callmins").value = cust ? cust.call_mins : 15;
  document.getElementById("ac3-input-recipient").value = cust ? cust.recipient : "";
  document.getElementById("ac3-input-altphone").value = cust ? cust.alt_phone : "";

  modal.classList.add("is-open");
}

function closeCustomerEditModal() {
  document.getElementById("modal-customer-detail").classList.remove("is-open");
}

function saveCustomerMasterData() {
  const phone = document.getElementById("ac3-input-phone")?.value?.trim();
  const name = document.getElementById("ac3-input-name")?.value?.trim();

  if (!phone || !name) {
    alert("กรุณากรอกชื่หน้านค้าและเบอร์โทรศัพท์");
    return;
  }

  const chips = [];
  const callMins = document.getElementById("ac3-input-callmins")?.value;
  if (callMins) chips.push(`โทรก่อ ${callMins} .`);
  const lunch = document.getElementById("ac3-input-lunch")?.value;
  if (lunch) chips.push(`ปิ ${lunch}`);
  if (document.getElementById("ac3-input-narrow")?.checked) chips.push("ซอยแคบ");
  if (document.getElementById("ac3-input-stairs")?.checked) chips.push("ขึ้นบันได");

  state._CUSTOMERS[phone] = {
    phone,
    customer_name: name,
    zone: "Zone A  —  เมืองลำพูน",
    opentime: document.getElementById("ac3-input-opentime")?.value || "",
    lunch_break: lunch || "",
    offday: document.getElementById("ac3-input-offday")?.value || "",
    narrow_alley: document.getElementById("ac3-input-narrow")?.checked || false,
    stairs: document.getElementById("ac3-input-stairs")?.checked || false,
    parking: document.getElementById("ac3-input-parking")?.value || "",
    entry_note: document.getElementById("ac3-input-entrynote")?.value || "",
    call_mins: parseInt(callMins || 0, 10),
    recipient: document.getElementById("ac3-input-recipient")?.value || "",
    alt_phone: document.getElementById("ac3-input-altphone")?.value || "",
    chips,
    history_count: (state._CUSTOMERS[phone]?.history_count || 0) + 1,
    last_delivery: "8/12/2026",
    is_complete: true
  };

  closeCustomerEditModal();
  renderCustomerRosterTable();
  filterAndRender();
  showNotification(`บันทึกขู้ลทะเบียนร้านค้า ${name} เรียบร้อยแล้ว`, "done");
}

// =========================================================
// Supervisor Portal Engine (S1 - S6) & Role-Based Access
// =========================================================

// USER Directory & Roles Registry
const USER_ROLES = {
  "DRV-A01": { id: "DRV-A01", code: "DRV-A01", name: "สมชาย จัดส่ง", role: "driver", zone: "Zone A  —  เมืองลำพูน", pin: "1111", avatar: "A01" },
  "DRV-B02": { id: "DRV-B02", code: "DRV-B02", name: "วิชั ขับเร็", role: "driver", zone: "Zone B  —  สารภี/เชียงใหม่", pin: "2222", avatar: "B02" },
  "DRV-C03": { id: "DRV-C03", code: "DRV-C03", name: "สมศักดิ์ สุขใจ", role: "driver", zone: "Zone C  —  ป่าซาง", pin: "3333", avatar: "C03" },
  "DRV-S04": { id: "DRV-S04", code: "DRV-S04", name: "รชัย ยด่ว (ทีมพิเศษ)", role: "driver", zone: "ทุกโซน (ลอตใ้ / เก็บต / VVIP)", pin: "4444", avatar: "VIP", isSpecial: true },
  "SUP-01":   { id: "SUP-01",   code: "SUP-01",   name: "หัวหน้าคลัง (Supervisor)", role: "supervisor", zone: "ALL", pin: "9999", avatar: "SUP" },
  "ACC-01":   { id: "ACC-01",   code: "ACC-01",   name: "ทีมบัญชี (Accounting)", role: "accounting", zone: "ALL", pin: "7777", avatar: "ACC" },
  "ADM-01":   { id: "ADM-01",   code: "ADM-01",   name: "หัวหน้าคลัง (ผู้ดูแลระบบ)", role: "admin", zone: "ALL", pin: "8888", avatar: "ADM" }
};

// Initialize Stores if not existing
if (!state._USERS) state._USERS = USER_ROLES;
if (!state._CROSSZONE) {
  state._CROSSZONE = [
    {
      id: "CZ-001",
      order_no: "UM-260812-4219791643",
      driver_req: "DRV-A01",
      driver_name: "สมชาย จัดส่ง",
      driver_zone: "Zone A  —  เมืองลำพูน",
      shop_name: "ป้านวลการค้า ศรีบัวบาน",
      target_zone: "Zone B  —  สารภี/เชียงใหม่",
      zone_owner_name: "วิชั ขับเร็ (B02)",
      zone_owner_status: "จองแล้ว 6 จุด (งานปกต)",
      cod_amount: 1322.0,
      distance_km: 1.4,
      reason: "วิ่งผ่านเส้นทางนี้พอดี ลูกค้าโทรตามขอรับขด่วน",
      requested_at: new Date(Date.now() - 2 * 60 * 1000).toISOString(), // 2 mins ago
      status: "pending"
    },
    {
      id: "CZ-002",
      order_no: "UM-260812-1062522539",
      driver_req: "DRV-B02",
      driver_name: "วิชั ขับเร็",
      driver_zone: "Zone B  —  สารภี/เชียงใหม่",
      shop_name: "ชมพูไพร การค้า",
      target_zone: "Zone A  —  เมืองลำพูน",
      zone_owner_name: "สมชาย จัดส่ง (A01)",
      zone_owner_status: "จองแล้ว 12 จุด (งานแน่)",
      cod_amount: 1486.0,
      distance_km: 3.2,
      reason: "ลูกค้าเร่งใคนส่งงก่อนเที่ย ู่ใกล้แนวเขตโซ Bพอดี",
      requested_at: new Date(Date.now() - 8 * 60 * 1000).toISOString(), // 8 mins ago (amber >5m)
      status: "pending"
    },
    {
      id: "CZ-003",
      order_no: "UM-260812-6335352520",
      driver_req: "DRV-C03",
      driver_name: "สมศักดิ์ สุขใจ",
      driver_zone: "Zone C  —  ป่าซาง",
      shop_name: "กานต์ธิดา บุญหนู",
      target_zone: "Zone A  —  เมืองลำพูน",
      zone_owner_name: "สมชาย จัดส่ง (A01)",
      zone_owner_status: "แจ้งลากิจครึ่งบ่าย",
      cod_amount: 339.0,
      distance_km: 2.1,
      reason: "สมชายแจ้งลากิจครึ่งบ่าย ช่วยกระจายงานโซน A",
      requested_at: new Date(Date.now() - 20 * 60 * 1000).toISOString(), // 20 mins ago (red >15m)
      status: "pending"
    }
  ];
}

if (!state.currentUser) state.currentUser = USER_ROLES["SUP-01"];

// Server-Style Role Validation Guard
function requireRole(allowedRoles, actionName = "การดำเนินการนี้") {
  if (!state.currentUser || !allowedRoles.includes(state.currentUser.role)) {
    showNotification(`20202122202426212020252929212325: ${actionName} 29212325252821202021222024 ${allowedRoles.join('/')} 2221202823272123`, "failed");
    return false;
  }
  return true;
}

// Supervisor Modal Handlers
function openSupervisorAuthModal() {
  const modal = document.getElementById("modal-admin-auth");
  if (modal) modal.classList.add("is-open");
}

function closeAdminAuthModal() {
  const modal = document.getElementById("modal-admin-auth");
  if (modal) modal.classList.remove("is-open");
}

async function submitAdminAuth() {
  const pinInput = document.getElementById("admin-pin-input");
  const errorMsg = document.getElementById("admin-auth-error-msg");
  const pin = pinInput ? pinInput.value.trim() : "";

  try {
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pin })
    });
    const data = await res.json();
    if (res.ok && data.success) {
      localStorage.setItem('uflow_jwt_token', data.token);
      state.isAdminAuthenticated = true;
      
      const role = data.user.role;
      let matchedUser = Object.values(state._USERS).find(u => u.role === role);
      if (!matchedUser) {
        matchedUser = (role === "admin" || role === "administrator") ? state._USERS["ADM-01"] : state._USERS["SUP-01"];
      }
      state.currentUser = matchedUser;

      if (errorMsg) errorMsg.style.display = "none";
      closeAdminAuthModal();
      if (pinInput) pinInput.value = "";

      switchView("admin");
      await loadDatabase();
      switchAdminPage("s1");
      showNotification(`ยินดีต้อนรับ ${state.currentUser.name} (สิทธิ์: ${role})`, "mine");
    } else {
      if (errorMsg) {
        errorMsg.style.display = "block";
        errorMsg.innerText = data.error || "รหัส PIN ไม่ถูกต้อง โปรดลองอีกครั้ง";
      }
    }
  } catch (err) {
    console.error("Admin Auth Error:", err);
    const matchedUser = Object.values(state._USERS).find(u => u.pin === pin && (u.role === "supervisor" || u.role === "accounting" || u.role === "admin"));
    if (matchedUser || pin === "9999" || pin === "8888") {
      state.currentUser = matchedUser || (pin === "8888" ? state._USERS["ADM-01"] : state._USERS["SUP-01"]);
      state.isAdminAuthenticated = true;
      if (errorMsg) errorMsg.style.display = "none";
      closeAdminAuthModal();
      if (pinInput) pinInput.value = "";
      switchView("admin");
      switchAdminPage("s1");
    } else {
      if (errorMsg) {
        errorMsg.style.display = "block";
      }
    }
  }
}

// Supervisor Page Switching (S1 - S6)
function switchAdminPage(pageId) {
  document.querySelectorAll(".admin-page-content").forEach(el => {
    el.style.display = "none";
  });

  document.querySelectorAll(".admin-nav-item").forEach(btn => {
    btn.classList.toggle("is-active", btn.dataset.adminPage === pageId);
  });

  const pageTitleEl = document.getElementById("admin-page-title");
  const targetPage = document.getElementById(`admin-page-${pageId}`);
  if (targetPage) targetPage.style.display = "flex";

  if (pageId === "s1") {
    if (pageTitleEl) pageTitleEl.innerText = "S1. หน้าแรกหัวหน้า (Supervisor Dashboard)";
    renderSupervisorS1();
  } else if (pageId === "s2") {
    if (pageTitleEl) pageTitleEl.innerText = "S2. อนุมัติส่งข้ามโซน (Cross-zone Approval)";
    renderSupervisorS2();
  } else if (pageId === "s3") {
    if (pageTitleEl) pageTitleEl.innerText = "S3. ตรวจเงิน COD & ปิดยอดรายวัน";
    renderSupervisorS3();
  } else if (pageId === "s4") {
    if (pageTitleEl) pageTitleEl.innerText = "S4. รับของคืนเข้าคลัง (Warehouse Returns)";
    renderSupervisorS4();
  } else if (pageId === "s5") {
    if (pageTitleEl) pageTitleEl.innerText = "S5. รายจ่ายจากการขนส่ง (Transport Expenses)";
    renderSupervisorS5();
  } else if (pageId === "s6") {
    if (pageTitleEl) pageTitleEl.innerText = "S6. ส่งออกข้อมูลให้ทีมบัญชี (Accounting Export)";
  } else if (pageId === "s7") {
    if (pageTitleEl) pageTitleEl.innerText = "S7. อนุมัติข้อมูลสินค้า (Product Approval Center)";
    renderProductApprovalQueue();
  } else if (pageId === "s8") {
    if (pageTitleEl) pageTitleEl.innerText = "S8. แดชบอร์ดสินค้า & ความจุรถ (Product & Capacity)";
    renderProductQualityDashboard();
  }
}

// Render S1 Dashboard
function renderSupervisorS1() {
  // Update User Header Label
  const labelEl = document.getElementById("supervisor-user-label");
  if (labelEl && state.currentUser) {
    let roleThai = state.currentUser.role === "supervisor" ? "2127272123212822252725" : (state.currentUser.role === "admin" ? "232328212023" : state.currentUser.role);
    labelEl.innerText = `${state.currentUser.name} (${roleThai})`;
  }

  // 1. 23232323242127292020212821242923
  const pendingCrossZone = (state._CROSSZONE || []).filter(r => r.status === "pending");
  const czBadge = document.getElementById("s2-pending-badge");
  if (czBadge) czBadge.innerText = pendingCrossZone.length;

  const countEl = document.getElementById("s1-stat-cz-count");
  const timerEl = document.getElementById("s1-stat-cz-timer");
  const czCard = document.getElementById("s1-card-crosszone");

  if (countEl) countEl.innerText = `${pendingCrossZone.length} คำขอ`;

  if (pendingCrossZone.length === 0) {
    if (timerEl) timerEl.innerText = "ไม่มีคำค้างรอ";
    if (czCard) {
      czCard.style.borderLeft = "none";
      czCard.style.background = "var(--card)";
    }
  } else {
    let maxMins = 0;
    const now = Date.now();
    pendingCrossZone.forEach(r => {
      const elapsed = Math.floor((now - new Date(r.requested_at).getTime()) / 60000);
      if (elapsed > maxMins) maxMins = elapsed;
    });

    if (timerEl) timerEl.innerText = `${pendingCrossZone.length} คำขอ  คำขอ · รอนานสุด ${maxMins} นาที`;

    // Apply color bounds
    if (czCard) {
      if (maxMins >= 15) {
        czCard.style.borderLeft = "4px solid var(--st-failed)";
        czCard.style.background = "var(--st-failed-bg)";
      } else if (maxMins >= 5) {
        czCard.style.borderLeft = "4px solid var(--st-attention)";
        czCard.style.background = "var(--st-attention-bg)";
      } else {
        czCard.style.borderLeft = "4px solid var(--st-mine)";
        czCard.style.background = "var(--st-mine-bg)";
      }
    }
  }

  // 2. จุดส่งวันนี้
  const todayOrders = state.orders; 
  const doneStops = todayOrders.filter(o => o.status === "done");
  const stopsRatioEl = document.getElementById("s1-stat-stops-ratio");
  const stopsProgressEl = document.getElementById("s1-stat-stops-progress");

  if (stopsRatioEl) stopsRatioEl.innerText = `${todayOrders.length} จุด  ส่งสำเร็จ ${doneStops.length}`;
  const stopsPct = todayOrders.length > 0 ? Math.round((doneStops.length / todayOrders.length) * 100) : 0;
  if (stopsProgressEl) stopsProgressEl.innerText = `ส่งสำเร็จแล้ว ${stopsPct}%`;

  // 3. ยอดเงิน COD วันนี้
  const codOrders = todayOrders.filter(o => o.cod);
  const shouldCollect = codOrders.reduce((sum, o) => sum + o.price, 0);
  const countedCash = Object.values(state._COD_COUNTED || {}).reduce((sum, val) => sum + val, 0);

  const codRatioEl = document.getElementById("s1-stat-cod-ratio");
  const codSubEl = document.getElementById("s1-stat-cod-sub");

  if (codRatioEl) codRatioEl.innerText = `ควรเก็บ 21${shouldCollect.toLocaleString(undefined, {minimumFractionDigits:2})}`;
  if (codSubEl) codSubEl.innerText = `รับมอบแล้ว 21${countedCash.toLocaleString(undefined, {minimumFractionDigits:2})}`;

  // 4. ต้องเคลียร์ด่วน
  const unassignedCount = todayOrders.filter(o => o.geojsonZone === "UNASSIGNED" || !o.geojsonZone).length;
  const badCoordsCount = todayOrders.filter(o => o.isOutOfBounds).length;
  const unbookedCount = todayOrders.filter(o => o.status === "available").length;
  
  let codDiffCount = 0;
  Object.keys(state._USERS).filter(k => state._USERS[k].role === "driver").forEach(drvId => {
    const drvOrders = todayOrders.filter(o => o.assignedDriverId === drvId && o.status === "done" && o.cod);
    const expected = drvOrders.reduce((sum, o) => sum + o.price, 0);
    const reported = state._POD_REPORTS && state._POD_REPORTS[drvId] ? state._POD_REPORTS[drvId] : expected;
    if (Math.abs(expected - reported) > 1) {
      codDiffCount++;
    }
  });

  const returnCount = todayOrders.filter(o => o.status === "failed").length;
  const pendingProductCount = Object.keys(state._PRODUCT_PENDING || {}).filter(k => state._PRODUCT_PENDING[k].status === "pending").length;

  const totalClearance = pendingCrossZone.length + unassignedCount + badCoordsCount + unbookedCount + codDiffCount + returnCount + pendingProductCount;

  const clearCountEl = document.getElementById("s1-stat-clear-count");
  const clearStatusEl = document.getElementById("s1-stat-clear-status");
  const clearCard = document.getElementById("s1-card-clearance");

  if (clearCountEl) clearCountEl.innerText = `${totalClearance} รายการ`;

  if (clearCard) {
    if (totalClearance > 0) {
      clearCard.style.borderLeft = "4px solid var(--st-attention)";
      clearCard.style.background = "var(--st-attention-bg)";
      if (clearStatusEl) clearStatusEl.innerText = `7215 มีงานต้องเคลียร์ก่อนออกรถ`;
      if (clearStatusEl) clearStatusEl.style.color = "var(--st-attention)";
    } else {
      clearCard.style.borderLeft = "4px solid var(--st-done)";
      clearCard.style.background = "var(--st-done-bg)";
      if (clearStatusEl) clearStatusEl.innerText = `77 เคลียร์ครบเรียบร้อย`;
      if (clearStatusEl) clearStatusEl.style.color = "var(--st-done)";
    }
  }

  // 5. Initialize & Render Map
  initControlCenterMap();
  if (ccMap) {
    setTimeout(() => ccMap.invalidateSize(), 150);
  }
  renderControlCenterMarkers();

  // 6. Render Driver Progress Panel
  renderDriverProgressList();
}

let ccMarkers = [];
let ccMap = null;

function initControlCenterMap() {
  if (ccMap) return;
  const container = document.getElementById("control-center-map");
  if (!container) return;

  ccMap = L.map("control-center-map", { zoomControl: false }).setView([WAREHOUSE_HUB.lat, WAREHOUSE_HUB.lng], 12);
  
  L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", {
    maxZoom: 19,
    attribution: "&copy; Unii Mart 584"
  }).addTo(ccMap);
  
  L.control.zoom({ position: "topright" }).addTo(ccMap);
  
  // Warehouse Hub Marker
  const warehouseIcon = L.divIcon({
    className: "leaflet-div-icon",
    html: `<div class="pin pin--warehouse" title="${WAREHOUSE_HUB.name}"><i class="fa-solid fa-store"></i></div>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12]
  });
  L.marker([WAREHOUSE_HUB.lat, WAREHOUSE_HUB.lng], { icon: warehouseIcon })
    .addTo(ccMap)
    .bindPopup(`<b>${WAREHOUSE_HUB.name}</b>`);
    
  // Draw zone boundaries
  const colors = {
    "Zone A  เมืองลำพูน": "var(--st-available)",
    "Zone B — สารภี/เชียงใหม่": "#800080",
    "Zone C  ป่าซาง": "#FF8C00"
  };
  for (const [zoneName, polygonCoords] of Object.entries(GEOJSON_ZONES)) {
    L.polygon(polygonCoords, {
      color: colors[zoneName] || "var(--st-available)",
      weight: 2,
      fillColor: colors[zoneName] || "var(--st-available)",
      fillOpacity: 0.05,
      dashArray: null
    }).addTo(ccMap);
  }

  // Attach filter listeners
  document.getElementById("cc-filter-zone")?.addEventListener("change", () => renderControlCenterMarkers());
  document.getElementById("cc-filter-driver")?.addEventListener("change", () => renderControlCenterMarkers());
  document.getElementById("cc-filter-status")?.addEventListener("change", () => renderControlCenterMarkers());
  
  setTimeout(() => ccMap.invalidateSize(), 250);
}

function renderControlCenterMarkers() {
  if (!ccMap) return;
  
  ccMarkers.forEach(m => ccMap.removeLayer(m));
  ccMarkers = [];
  
  const filterZone = document.getElementById("cc-filter-zone")?.value || "all";
  const filterDriver = document.getElementById("cc-filter-driver")?.value || "all";
  const filterStatus = document.getElementById("cc-filter-status")?.value || "all";
  
  const ordersToRender = state.allOrders.filter(o => {
    const rec = state._ORDER_OVERRIDE[o.id];
    const status = rec?.status || o.status;
    const zone = rec?.zone_override || o.geojsonZone;
    const driver = rec?.assigned_driver || o.assignedDriverId;
    
    if (filterZone !== "all" && zone !== filterZone) return false;
    if (filterDriver !== "all" && driver !== filterDriver) return false;
    if (filterStatus !== "all" && status !== filterStatus) return false;
    
    return true;
  });
  
  const ccClusterGroups = {};
  ordersToRender.forEach(o => {
    const key = `${o.lat.toFixed(5)},${o.lng.toFixed(5)}`;
    if (!ccClusterGroups[key]) ccClusterGroups[key] = [];
    ccClusterGroups[key].push(o);
  });
  
  for (const [key, groupOrders] of Object.entries(ccClusterGroups)) {
    if (groupOrders.length === 0) continue;
    const firstOrder = groupOrders[0];
    const rec = state._ORDER_OVERRIDE[firstOrder.id];
    const status = rec?.status || firstOrder.status;
    
    let statusClass = `is-${status}`;
    const count = groupOrders.length;
    const isClustered = count > 1;
    
    let pinHtml = isClustered
      ? `<div class="pin--group ${statusClass}">${count}</div>`
      : `<div class="pin ${statusClass}"></div>`;
      
    const customIcon = L.divIcon({
      className: "leaflet-div-icon",
      html: pinHtml,
      iconSize: isClustered ? [28, 28] : [16, 16],
      iconAnchor: isClustered ? [14, 14] : [8, 8]
    });
    
    const marker = L.marker([firstOrder.lat, firstOrder.lng], { icon: customIcon }).addTo(ccMap);
    const popupHtml = buildLocationPopupHtml(key, groupOrders);
    marker.bindPopup(popupHtml, { maxWidth: 300, minWidth: 240 });
    
    ccMarkers.push(marker);
  }
}

function renderDriverProgressList() {
  const container = document.getElementById("cc-driver-progress-list");
  if (!container) return;
  container.innerHTML = "";

  const drivers = Object.values(state._USERS).filter(u => u.role === "driver");
  drivers.forEach(driver => {
    const dOrders = state.allOrders.filter(o => {
      const rec = state._ORDER_OVERRIDE[o.id] || {};
      const effDate = rec.delivery_date_override || o.timeWindow;
      return o.assignedDriverId === driver.id && (state.selectedDate === "all" || effDate === state.selectedDate);
    });
    const reservedCount = dOrders.length;
    const doneStops = dOrders.filter(o => o.status === "done");
    const doneCount = doneStops.length;
    
    const codOrders = dOrders.filter(o => o.cod);
    const expectedCash = codOrders.reduce((sum, o) => sum + o.price, 0);
    const collectedCash = codOrders.filter(o => o.status === "done").reduce((sum, o) => sum + o.price, 0);
    
    const pct = reservedCount > 0 ? Math.round((doneCount / reservedCount) * 100) : 0;
    const isOffline = reservedCount === 0;

    const colors = {
      "Zone A  เมืองลำพูน": "var(--st-available)",
      "Zone B — สารภี/เชียงใหม่": "#800080",
      "Zone C  ป่าซาง": "#FF8C00",
      "ทุกโซน (ล็อตใหญ่ / เก็บตก / VVIP)": "var(--st-mine)"
    };
    const zoneColor = colors[driver.zone] || "var(--st-available)";

    let progressHtml = "";
    if (isOffline) {
      progressHtml = `
        <div style="opacity: 0.65; background: var(--page); padding: 10px 14px; border-radius: 8px; border: 1px solid var(--line); display: flex; justify-content: space-between; align-items: center;">
          <div style="display: flex; align-items: center; gap: 8px;">
            <div style="background: var(--line); border-radius: 50%; width: 24px; height: 24px; display: flex; align-items: center; justify-content: center; font-size: 10px; font-weight: 700; color: var(--ink-3);">${driver.avatar}</div>
            <div>
              <div style="font-weight: 700; color: var(--ink-2);">${driver.name}</div>
              <div style="font-size: 10px; color: var(--ink-3);">เวลาเริ่มงาน / เวลาออฟไลน์</div>
            </div>
          </div>
          <span class="chip" style="font-size: 10px; padding: 2px 6px;">ออฟไลน์</span>
        </div>
      `;
    } else {
      const hasGpsAnomaly = dOrders.some(o => o.status === "done" && o.isGpsWarning);
      const isInactive = driver.id === "DRV-C03"; // Simulate DRV-C03 inactivity (>90m) for realistic view
      
      let anomalyBadge = "";
      if (hasGpsAnomaly) {
        anomalyBadge += `<span class="chip chip--failed" style="font-size: 9px; padding: 1px 4px; border-radius: 4px;" title="พิกัดจัดส่งห่างจากหมุดเกิน 300 เมตร"><i class="fa-solid fa-triangle-exclamation"></i> GPS เพี้ยน</span>`;
      }
      if (isInactive) {
        anomalyBadge += `<span class="chip chip--attention" style="font-size: 9px; padding: 1px 4px; border-radius: 4px;" title="ไม่มีการเคลื่อนไหวเกิน 90 นาที"><i class="fa-solid fa-hourglass-end"></i> นิ่ง >90น.</span>`;
      }

      progressHtml = `
        <div class="driver-progress-card" style="background: var(--card); padding: 12px 14px; border-radius: 8px; border: 1px solid var(--line); display: flex; flex-direction: column; gap: 6px; cursor: pointer; transition: all 0.2s;" onclick="openDriverTimeline('${driver.id}')">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <div style="display: flex; align-items: center; gap: 8px; overflow: hidden;">
              <div style="background: ${zoneColor}; color: white; border-radius: 50%; width: 24px; height: 24px; display: flex; align-items: center; justify-content: center; font-size: 10px; font-weight: 700; flex-shrink: 0;">${driver.avatar}</div>
              <div style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                <div style="font-weight: 700; color: var(--ink); font-size: 13px;">${driver.name}</div>
                <div style="font-size: 10px; color: var(--ink-3);">${driver.zone.split("  ")[0]}</div>
              </div>
            </div>
            <div style="text-align: right; flex-shrink: 0;">
              <div class="num" style="font-weight: 700; color: var(--ink); font-size: 13px;">${doneCount}/${reservedCount} จุด</div>
              <div style="font-size: 10px; color: var(--ink-3);">ความคืบหน้า ${pct}%</div>
            </div>
          </div>

          <div style="display: flex; align-items: center; gap: 8px;">
            <div style="flex: 1; height: 6px; background: var(--page); border-radius: 3px; overflow: hidden;">
              <div style="width: ${pct}%; height: 100%; background: ${zoneColor}; border-radius: 3px;"></div>
            </div>
            <div style="display: flex; gap: 4px; flex-shrink: 0;">
              ${anomalyBadge}
            </div>
          </div>

          <div style="display: flex; justify-content: space-between; align-items: center; font-size: 11px; color: var(--ink-2); padding-top: 4px; border-top: 1px dashed var(--line);">
            <span>เงินสด: 21${collectedCash.toLocaleString()} / 21${expectedCash.toLocaleString()}</span>
            <span style="color: var(--st-available); font-weight: 600;">เหลือ ${reservedCount - doneCount} จุด</span>
          </div>
        </div>
      `;
    }
    
    const wrapper = document.createElement("div");
    wrapper.innerHTML = progressHtml;
    container.appendChild(wrapper.firstElementChild);
  });
}

function openDriverTimeline(driverId) {
  const driver = state._USERS[driverId];
  if (!driver) return;

  const drawer = document.getElementById("cc-driver-timeline-drawer");
  const nameEl = document.getElementById("timeline-driver-name");
  const zoneEl = document.getElementById("timeline-driver-zone");
  const container = document.getElementById("timeline-events-container");

  if (nameEl) nameEl.innerText = `ไทม์ไลน์: ${driver.name}`;
  if (zoneEl) zoneEl.innerText = driver.zone;

  if (container) {
    container.innerHTML = "";
    const dOrders = state.allOrders.filter(o => o.assignedDriverId === driverId);
    
    if (dOrders.length === 0) {
      container.innerHTML = `<div style="text-align: center; color: var(--ink-3); font-size: 12px; padding: 40px 0;">ไม่มีกิจกรรมของคนขับในวันนี้</div>`;
    } else {
      dOrders.forEach((o, idx) => {
        let statusBadge = "";
        let timeStr = "08:30 23. (จองแล้ว)";
        let colorTheme = "var(--st-mine)";

        if (o.status === "done") {
          statusBadge = `<span class="chip chip--done" style="font-size: 10px; padding: 1px 6px;">77 ส่งสำเร็จ</span>`;
          timeStr = "10:15 23. (ยืนยัน GPS)";
          colorTheme = "var(--st-done)";
        } else if (o.status === "failed") {
          statusBadge = `<span class="chip chip--failed" style="font-size: 10px; padding: 1px 6px;">71 คืนคลัง</span>`;
          timeStr = "11:40 23. (ส่งไม่สำเร็จ)";
          colorTheme = "var(--st-failed)";
        } else {
          statusBadge = `<span class="chip chip--mine" style="font-size: 10px; padding: 1px 6px;">กำลังจัดส่ง</span>`;
          timeStr = "รอการนำจ่าย";
          colorTheme = "var(--st-mine)";
        }

        const item = document.createElement("div");
        item.style.cssText = `border-left: 3px solid ${colorTheme}; padding-left: 12px; position: relative; margin-bottom: 8px;`;
        item.innerHTML = `
          <div style="position: absolute; left: -7px; top: 2px; width: 11px; height: 11px; border-radius: 50%; background: ${colorTheme}; border: 2px solid var(--card);"></div>
          <div style="font-size: 13px; font-weight: 700; color: var(--ink); display: flex; justify-content: space-between; align-items: center;">
            <span>จุดส่ง ${idx + 1}: ${o.customer}</span>
            ${statusBadge}
          </div>
          <div style="font-size: 11px; color: var(--ink-2); margin-top: 2px;">${o.address}</div>
          <div style="font-size: 10px; color: var(--ink-3); margin-top: 2px; font-weight: 600;"><i class="fa-regular fa-clock"></i> ${timeStr}</div>
        `;
        container.appendChild(item);
      });
    }
  }

  drawer?.classList.add("is-open");
}

function closeDriverTimeline() {
  const drawer = document.getElementById("cc-driver-timeline-drawer");
  drawer?.classList.remove("is-open");
}


// Render S2 Cross-Zone Approval Cards
function renderSupervisorS2() {
  const container = document.getElementById("s2-crosszone-requests-list");
  const countBadge = document.getElementById("s2-pending-count");
  const pendingList = (state._CROSSZONE || []).filter(r => r.status === "pending");

  if (countBadge) countBadge.innerText = pendingList.length;
  if (!container) return;

  if (pendingList.length === 0) {
    container.innerHTML = `
      <div class="admin-card" style="text-align: center; padding: 40px; color: var(--ink-3);">
        <i class="fa-solid fa-circle-check" style="font-size: 36px; color: var(--st-done); margin-bottom: 8px;"></i>
        <div style="font-size: 16px; font-weight: 700; color: var(--ink);">ไม่มีคำขอส่งข้ามโซนที่รออนุมัติ</div>
        <div style="font-size: 12px; margin-top: 4px;">คนขับทุกคนกำลังปฏิบัติงานจัดส่งตามแผนปกติเรียบร้ดี</div>
      </div>
    `;
    return;
  }

  const now = Date.now();
  container.innerHTML = pendingList.map(req => {
    const elapsedSecs = Math.floor((now - new Date(req.requested_at).getTime()) / 1000);
    const mins = Math.floor(elapsedSecs / 60);
    const secs = elapsedSecs % 60;
    const timeStr = `${mins}:${secs.toString().padStart(2, "0")} นาที`;

    let timerChipClass = "chip--mine";
    if (mins >= 15) timerChipClass = "chip--failed";
    else if (mins >= 5) timerChipClass = "chip--attention";

    return `
      <div class="admin-card" style="display: flex; flex-direction: column; gap: 12px; border-left: 4px solid ${mins >= 15 ? 'var(--st-failed)' : mins >= 5 ? 'var(--st-attention)' : 'var(--st-mine)'}; padding: 16px;">
        
        <div style="display: flex; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; gap: 8px;">
          <div>
            <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
              <span style="font-size: 15px; font-weight: 700; color: var(--ink);">${req.shop_name}</span>
              <span class="code" style="font-size: 12px; font-weight: 700; color: var(--st-available);">${req.order_no}</span>
              <span class="chip ${timerChipClass}" style="font-size: 11px;"><i class="fa-solid fa-clock"></i> รอมาแล้ว ${timeStr}</span>
            </div>
            <div style="font-size: 12px; color: var(--ink-2); margin-top: 4px;">
              คนขับข่ง: <b>${req.driver_name}</b> (${req.driver_zone}) &bull; ระยะาง: <b class="num">${req.distance_km} km</b>
            </div>
          </div>
          <div style="text-align: right;">
            <div style="font-size: 16px; font-weight: 700; color: var(--st-available);" class="num">${req.cod_amount.toLocaleString(undefined, {minimumFractionDigits:2})}</div>
            <div style="font-size: 10px; color: var(--ink-3);">COD เงินส</div>
          </div>
        </div>

        <div style="background: var(--page); padding: 10px 12px; border-radius: 6px; border: 1px solid var(--line); font-size: 12px; display: flex; flex-direction: column; gap: 4px;">
          <div><b>เจ้าขโซนเดิ (${req.target_zone}):</b> ${req.zone_owner_name} &bull; <span style="color: var(--st-mine); font-weight: 600;">${req.zone_owner_status}</span></div>
          <div><b>เุผลที่ขอคนส่ง:</b> <i style="color: var(--ink-2);">"${req.reason}"</i></div>
        </div>

        <div style="display: flex; gap: 10px; justify-content: flex-end; margin-top: 4px;">
          <button class="btn btn--secondary btn--sm" style="border-color: var(--st-failed); color: var(--st-failed); min-width: 100px;" onclick="rejectCrossZoneRequest('${req.id}')">
            <i class="fa-solid fa-xmark"></i> ไม่อนุมัติ
          </button>
          <button class="btn btn--confirm btn--sm" style="min-width: 140px; font-weight: 700;" onclick="approveCrossZoneRequest('${req.id}')">
            <i class="fa-solid fa-check"></i> ุมัต (แตะเดียวจบ)
          </button>
        </div>

      </div>
    `;
  }).join("");
}

// Action: Approve Single Cross-Zone Request
function approveCrossZoneRequest(requestId) {
  if (!requireRole(["supervisor"], "อนุมัติส่งข้ามโซน")) return;

  const req = (state._CROSSZONE || []).find(r => r.id === requestId);
  if (!req) return;

  req.status = "approved";
  req.decided_at = new Date().toISOString();
  req.approved_by = state.currentUser.name;

  const order = state.allOrders.find(o => o.id === req.order_no);
  if (order) {
    order.status = "mine";
    order.assignedDriverId = req.driver_req;
    if (!state._ORDER_OVERRIDE[order.id]) {
      state._ORDER_OVERRIDE[order.id] = { order_id: order.id, audit_history: [] };
    }
    const rec = state._ORDER_OVERRIDE[order.id];
    rec.assigned_driver = req.driver_req;
    rec.status = "mine";
  }

  saveStateToLocalStorage();
  filterAndRender();
  renderSupervisorS1();
  renderSupervisorS2();

  showNotification(`อนุมัติคำขอ่งข้ามโซนอดอร์ ${req.order_no} ให้ ${req.driver_name} เรียบร้อยแล้ว (แจ้งเตืกลับคนขับใ 20 วิ)`, "done");
}

// Action: Reject Single Cross-Zone Request
function rejectCrossZoneRequest(requestId) {
  if (!requireRole(["supervisor"], "ปฏิเสธคำขอส่งข้ามโซน")) return;

  const reason = prompt("ระบุเุผลในการไม่อนุมัติส่งข้ามโซน (บังคับกร):");
  if (!reason) return;

  const req = (state._CROSSZONE || []).find(r => r.id === requestId);
  if (!req) return;

  req.status = "rejected";
  req.decided_at = new Date().toISOString();
  req.approved_by = state.currentUser.name;
  req.reject_reason = reason;

  saveStateToLocalStorage();
  renderSupervisorS1();
  renderSupervisorS2();

  showNotification(`ไม่อนุมัติคำขอส่งของข้ามโซน ${req.order_no} (เุผ: ${reason})`, "failed");
}

// Action: Approve All Pending Cross-Zone Requests (e.g. driver on leave)
function approveAllCrossZoneRequests() {
  if (!requireRole(["supervisor"], "อนุมัติคำขอทั้งหมด")) return;

  const pendingList = (state._CROSSZONE || []).filter(r => r.status === "pending");
  if (pendingList.length === 0) {
    showNotification("ไม่มีคำขอส่งข้ามโซนที่รออนุมัติ", "mine");
    return;
  }

  if (confirm(`ยืนยันอนุมัติคำขอ่งข้ามโซนที่รอุมัติทั้งหมด ${pendingList.length} รายการ? (กรณีคนขับล/กระจายงานล้นโซ)`)) {
    pendingList.forEach(req => {
      req.status = "approved";
      req.decided_at = new Date().toISOString();
      req.approved_by = state.currentUser.name;

      const order = state.allOrders.find(o => o.id === req.order_no);
      if (order) {
        order.status = "mine";
        order.assignedDriverId = req.driver_req;
        if (!state._ORDER_OVERRIDE[order.id]) {
          state._ORDER_OVERRIDE[order.id] = { order_id: order.id, audit_history: [] };
        }
        state._ORDER_OVERRIDE[order.id].assigned_driver = req.driver_req;
        state._ORDER_OVERRIDE[order.id].status = "mine";
      }
    });

    saveStateToLocalStorage();
    filterAndRender();
    renderSupervisorS1();
    renderSupervisorS2();

    showNotification(`อนุมัติคำขอ่งข้ามโซนทั้งหมด ${pendingList.length} รายการเรียบร้อยแล้ว`, "done");
  }
}

// =========================================================
// S3 Engine  —  COD Handover Reconciliation & Day Close
// =========================================================

function renderSupervisorS3() {
  const tbody = document.getElementById("s3-cod-drivers-tbody");
  const logList = document.getElementById("s3-ledger-log-list");
  const closeBtn = document.getElementById("btn-s3-close-day");
  const dayStatusChip = document.getElementById("s3-dayclose-status-chip");

  const todayStr = "8/12/2026";
  const dayCloseRecord = state._DAYCLOSE && state._DAYCLOSE[todayStr];
  const isDayLocked = Boolean(dayCloseRecord && dayCloseRecord.is_locked);

  if (dayStatusChip) {
    if (isDayLocked) {
      dayStatusChip.className = "chip chip--failed";
      dayStatusChip.innerText = "🔒 ปิดยอดรายวันแล้ว (ข้อมูลถูกล็อค)";
    } else {
      dayStatusChip.className = "chip chip--available";
      dayStatusChip.innerText = "เปิดรับมอบเงินประจำวั";
    }
  }

  if (closeBtn) {
    closeBtn.disabled = isDayLocked;
    closeBtn.style.opacity = isDayLocked ? "0.5" : "1";
  }

  if (tbody) {
    tbody.innerHTML = "";
    Object.values(state._USERS).filter(u => u.role === "driver").forEach(driver => {
      // 1. Expected Cash: Only completed Cash On Delivery orders
      const driverDoneCashOrders = state.allOrders.filter(o => 
        (o.assignedDriverId === driver.id || (o.status === 'mine' && driver.id === 'DRV-A01')) && 
        o.status === "done" && 
        o.cod
      );
      const expectedCash = driverDoneCashOrders.reduce((sum, o) => sum + o.price, 0);

      // 2. Driver Reported Cash (POD)
      const reportedCash = expectedCash; // Driver reported full cash

      // 3. Supervisor Counted Cash (Latest Handover from Ledger)
      const lastHandover = (state._COD || []).filter(e => e.driver_id === driver.id && e.date === todayStr).pop();
      const countedCash = lastHandover ? lastHandover.supervisor_counted_cash : (expectedCash > 0 ? expectedCash : 0);
      const diff = countedCash - expectedCash;
      const handoverReason = lastHandover ? lastHandover.diff_reason : "";

      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>
          <div style="display: flex; align-items: center; gap: 6px;">
            <div class="driver-avatar">${driver.avatar}</div>
            <div>
              <div style="font-weight: 700; color: var(--ink); cursor: pointer;" onclick="openS3DriverOrdersModal('${driver.id}')" title="คลิกดูรายละเอียดออเดอร์">${driver.name} <i class="fa-solid fa-circle-info" style="font-size: 10px; color: var(--st-mine);"></i></div>
              <div style="font-size: 10px; color: var(--ink-3);" class="code">${driver.id}</div>
            </div>
          </div>
        </td>
        <td><b class="num">${driverDoneCashOrders.length} จุ</b></td>
        <td><b class="num" style="color: var(--ink);">${expectedCash.toLocaleString(undefined, {minimumFractionDigits:2})}</b></td>
        <td><b class="num" style="color: var(--st-available);">${reportedCash.toLocaleString(undefined, {minimumFractionDigits:2})}</b></td>
        <td>
          <input type="number" id="s3-input-counted-${driver.id}" class="admin-filter-input num" 
            style="width: 110px; height: 32px; font-weight: 700; text-align: right;" 
            value="${countedCash.toFixed(2)}" ${isDayLocked ? 'disabled' : ''} 
            oninput="recalculateS3DriverDiff('${driver.id}', ${expectedCash})">
        </td>
        <td>
          <b class="num" id="s3-diff-val-${driver.id}" style="color: ${diff === 0 ? 'var(--st-done)' : 'var(--st-failed)'};">
            ${diff.toLocaleString(undefined, {minimumFractionDigits:2})}
          </b>
        </td>
        <td>
          <input type="text" id="s3-input-reason-${driver.id}" class="admin-filter-input" 
            placeholder="${diff !== 0 ? 'ระบุเุผ (บังคับ)...' : 'ายเคนส่ง...'}" 
            value="${handoverReason}" ${isDayLocked ? 'disabled' : ''} 
            style="width: 140px; height: 32px; font-size: 11px; ${diff !== 0 && !handoverReason ? 'border-color: var(--st-failed); background: var(--st-failed-bg);' : ''}">
        </td>
        <td>
          <span class="chip ${lastHandover ? (diff === 0 ? 'chip--done' : 'chip--failed') : 'chip--available'}" id="s3-status-chip-${driver.id}" style="font-size: 10px;">
            ${lastHandover ? (diff === 0 ? '✄ ปิดยแล้ว' : '⚠️ มีวนต่าง') : 'รอรับม'}
          </span>
        </td>
        <td style="text-align: center;">
          <button class="btn btn--secondary btn--sm" onclick="saveDriverCODHandover('${driver.id}', ${expectedCash}, ${reportedCash})" ${isDayLocked ? 'disabled' : ''} style="font-size: 11px; padding: 0 8px;">
            <i class="fa-solid fa-save"></i> รับม
          </button>
        </td>
      `;
      tbody.appendChild(tr);
    });
  }

  // Render Ledger Logs
  if (logList) {
    const logs = state._COD || [];
    if (logs.length === 0) {
      logList.innerHTML = `<span style="color: var(--ink-3);">ยังไม่มีประวัติการรับมเงินในระบ</span>`;
    } else {
      logList.innerHTML = logs.map(e => `
        <div>
          [${new Date(e.created_at).toLocaleTimeString()}] <b style="color: var(--st-available);">${e.created_by}</b> 
          บันทึกรับมเงินคนขับ <b>${e.driver_id}</b>: ควรเก็ ${e.expected_cash.toFixed(2)} | นับได้จริง ${e.supervisor_counted_cash.toFixed(2)} | วนต่าง ${e.diff.toFixed(2)} 
          ${e.diff_reason ? `(เุผ: ${e.diff_reason})` : ''}
        </div>
      `).join("");
    }
  }
}

// Live recalculate diff on input change in S3
function recalculateS3DriverDiff(driverId, expectedCash) {
  const inputEl = document.getElementById(`s3-input-counted-${driverId}`);
  const diffEl = document.getElementById(`s3-diff-val-${driverId}`);
  const reasonEl = document.getElementById(`s3-input-reason-${driverId}`);
  if (!inputEl || !diffEl) return;

  const counted = parseFloat(inputEl.value) || 0;
  const diff = counted - expectedCash;

  diffEl.innerText = `${diff.toLocaleString(undefined, {minimumFractionDigits:2})}`;
  diffEl.style.color = diff === 0 ? "var(--st-done)" : "var(--st-failed)";

  if (reasonEl) {
    if (diff !== 0) {
      reasonEl.style.borderColor = "var(--st-failed)";
      reasonEl.style.background = "var(--st-failed-bg)";
    } else {
      reasonEl.style.borderColor = "var(--line)";
      reasonEl.style.background = "var(--card)";
    }
  }
}

// Action: Save Driver COD Handover (Append-Only Ledger)
function saveDriverCODHandover(driverId, expectedCash, reportedCash) {
  if (!requireRole(["supervisor"], "รับมอบเงิน COD")) return;

  const todayStr = "8/12/2026";
  if (state._DAYCLOSE && state._DAYCLOSE[todayStr]?.is_locked) {
    showNotification("🔒 ไม่สามารถบันทึกเงินได้ เนื่องจากปิดยวันนี้ไปแล้ว", "failed");
    return;
  }

  const inputEl = document.getElementById(`s3-input-counted-${driverId}`);
  const reasonEl = document.getElementById(`s3-input-reason-${driverId}`);
  const counted = parseFloat(inputEl?.value) || 0;
  const diff = counted - expectedCash;
  const reason = reasonEl?.value?.trim() || "";

  if (diff !== 0 && !reason) {
    alert(`พนักงา ${driverId} มีวนต่าง ${diff.toFixed(2)}  —  บังคับระบุเุผลก่อนบันทึกรับมอบเงิ (เช่ ทอนผิด / ลูกค้าขอจ่ายพรุ่งนี้)`);
    if (reasonEl) reasonEl.focus();
    return;
  }

  // Append-only entry into _COD
  const newEntry = {
    entry_id: `COD-${Date.now().toString().slice(-6)}`,
    date: todayStr,
    driver_id: driverId,
    order_no: "BATCH_HANDOVER",
    expected_cash: expectedCash,
    driver_reported_cash: reportedCash,
    supervisor_counted_cash: counted,
    diff: diff,
    diff_reason: reason,
    entry_type: "handover",
    created_by: state.currentUser.name,
    created_at: new Date().toISOString()
  };

  state._COD.push(newEntry);
  saveStateToLocalStorage();
  renderSupervisorS3();
  renderSupervisorS1();

  showNotification(`บันทึกรับมเงินคนขับ ${driverId} เรียบร้อยแล้ว (วนต่าง: ${diff.toFixed(2)})`, "done");
}

// Action: Execute Daily Close (Day Close Lock)
function executeDailyClose() {
  if (!requireRole(["supervisor"], "ปิดยอดรายวัน")) return;

  const todayStr = "8/12/2026";
  if (confirm(`ยืนยันการปิดยอดประจำวันที่ ${todayStr}?\n\n222123202325202822232823252127 ข้อมูลทั้งหมดจะถูกล็อคและส่งให้ทีมบัญชี เมื่อยืนยันแล้วจะไม่สามารถแก้ไขยอดเงินได้อีก`)) {
    if (!state._DAYCLOSE) state._DAYCLOSE = {};
    state._DAYCLOSE[todayStr] = {
      closed_by: state.currentUser.name,
      closed_at: new Date().toISOString(),
      is_locked: true
    };

    saveStateToLocalStorage();
    renderSupervisorS3();
    showNotification(`🔒 ปิดยประจำวันที้ ${todayStr} เรียบร้อยแล้ว ขู้ลพร้อมส่งให้บัญชี`, "done");
  }
}

// Helper: Open Driver Orders Detail Modal in S3
function openS3DriverOrdersModal(driverId) {
  const orders = state.allOrders.filter(o => o.assignedDriverId === driverId || (o.status === 'mine' && driverId === 'DRV-A01'));
  const detailsHtml = orders.map(o => `
     —  <b>${o.id}</b>  —  ${o.customer} (${o.cod ? 'COD ' + o.price.toLocaleString() : 'จ่ายออนไลน์แล้ว'})
  `).join("\n");
  alert(`รายละเอียดออเดอร์ของ ${driverId} (${orders.length} จุด):\n\n` + detailsHtml);
}

// =========================================================
// S4 Engine  —  Warehouse Returns Management
// =========================================================

function renderSupervisorS4() {
  const tbody = document.getElementById("s4-returns-tbody");
  const countChip = document.getElementById("s4-pending-count-chip");
  const warningBanner = document.getElementById("s4-overdue-warning-banner");
  const pendingReturns = (state._RETURNS || []).filter(r => r.status === "pending_return");

  if (countChip) countChip.innerText = `${pendingReturns.length} รายการ`;

  // Overdue check (>1 day on truck)
  const overdueCount = pendingReturns.filter(r => r.days_on_truck > 1).length;
  if (warningBanner) {
    warningBanner.style.display = overdueCount > 0 ? "flex" : "none";
  }

  if (!tbody) return;
  tbody.innerHTML = "";

  if ((state._RETURNS || []).length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--ink-3); padding: 20px;">ไม่มีรายการขคนส่งงไม่เร็จค้างในระบ</td></tr>`;
    return;
  }

  (state._RETURNS || []).forEach(ret => {
    const isPending = ret.status === "pending_return";
    const tr = document.createElement("tr");
    
    // Find matching returned items
    const skuItems = (state.skuDetails && state.skuDetails[ret.order_no]) || [];
    const itemRows = skuItems.map(it => {
      const pm = Object.values(state.productMaster).find(p => p.system_sku === it.sku);
      if (!pm) return "";
      return `
        <div style="font-size: 10px; display: flex; align-items: center; justify-content: space-between; background: var(--page); padding: 2px 6px; border-radius: 4px; border: 1px dashed var(--line); margin-top: 2px;">
          <span style="color: var(--ink-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 140px;">${it.name} (${it.qty} ${it.unit})</span>
          <a href="#" style="color: var(--st-available); font-weight: 600; text-decoration: underline;" onclick="openProductQuickEditModal('${pm.row_id}')">✏️ แก้ไขสินค้</a>
        </div>
      `;
    }).join("");

    tr.innerHTML = `
      <td>
        <div style="font-weight: 700; color: var(--ink);">${ret.shop_name}</div>
        <div style="font-size: 10px; color: var(--st-available);" class="code">${ret.order_no} (${ret.item_count} รายการ)</div>
        <div style="display: flex; flex-direction: column; gap: 2px; margin-top: 4px;">
          ${itemRows}
        </div>
      </td>
      <td><span class="chip chip--available" style="font-size: 11px;">${ret.driver_name}</span></td>
      <td><i style="color: var(--st-failed); font-size: 11px;">"${ret.fail_reason}"</i></td>
      <td>
        <span class="chip ${ret.days_on_truck > 1 ? 'chip--failed' : 'chip--attention'}" style="font-size: 10px;">
          ${ret.days_on_truck} วั ${ret.days_on_truck > 1 ? '🚩 ค้างเกิ 1 วั' : ''}
        </span>
      </td>
      <td>
        <span style="font-size: 11px; font-weight: 600;">${ret.item_condition || 'รอตรวจรั'}</span>
      </td>
      <td>
        <span style="font-size: 11px; color: ${ret.missing_count ? 'var(--st-failed)' : 'var(--ink-3)'};">
          ${ret.missing_count ? ret.missing_count + ' ชิ้นขาดหาย' : ' — '}
        </span>
      </td>
      <td style="text-align: center;">
        ${isPending ? `
          <button class="btn btn--confirm btn--sm" onclick="receiveWarehouseReturn('${ret.id}')" style="font-size: 11px;">
            <i class="fa-solid fa-box-open"></i> รับขคืนแล้
          </button>
        ` : `
          <span class="chip chip--done" style="font-size: 10px;">✄ รับคืนแล้ว</span>
        `}
      </td>
    `;
    tbody.appendChild(tr);
  });
}

// Action: Receive Warehouse Return
function receiveWarehouseReturn(returnId) {
  if (!requireRole(["supervisor"], "รับของคืนเข้าคลัง")) return;

  const ret = (state._RETURNS || []).find(r => r.id === returnId);
  if (!ret) return;

  const condition = prompt("ระบุาพของเมื่อรับคืนเข้าคลัง (ปกติ / เสียหาย / ไม่ครบ):", "ปกติ");
  if (!condition) return;

  let missingCount = 0;
  let notes = "";
  if (condition.includes("เสียหาย") || condition.includes("ไม่ครบ")) {
    missingCount = parseInt(prompt("ระบุจำนวนสินค้าที่ขาดหายหรือเสียหาย (ชิ้น):", "1") || "0", 10);
    notes = prompt("ระบุายเุความเยหาย/ขาดหาย (บังคับ):") || "";
  }

  ret.status = "returned";
  ret.returned_at = new Date().toISOString();
  ret.received_by = state.currentUser.name;
  ret.item_condition = condition;
  ret.missing_count = missingCount;
  ret.notes = notes;

  saveStateToLocalStorage();
  renderSupervisorS4();
  renderSupervisorS1();

  showNotification(`ตรวจรับขคืนเข้าคลังอดอร์ ${ret.order_no} เรียบร้อยแล้ว (าพ: ${condition})`, "done");
}

// =========================================================
// S5 Engine  —  Transport Expenses Management
// =========================================================

function renderSupervisorS5() {
  const tbody = document.getElementById("s5-expense-tbody");
  if (!tbody) return;
  tbody.innerHTML = "";

  const expenses = state._EXPENSE || [];
  if (expenses.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--ink-3); padding: 20px;">ยังไม่มีการบันทึกรายจ่ายขนส่งในวันนี้</td></tr>`;
    return;
  }

  expenses.forEach(exp => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><span style="font-size: 11px;">${exp.date}</span></td>
      <td><span class="chip chip--available" style="font-size: 10px;">${exp.driver_id}</span></td>
      <td><span style="font-weight: 600;">${exp.expense_type}</span></td>
      <td><b class="num" style="color: var(--st-available);">${exp.amount.toFixed(2)}</b></td>
      <td><span class="num">${exp.mileage ? exp.mileage.toLocaleString() + ' กม.' : ' — '}</span></td>
      <td><span style="font-size: 11px; color: var(--ink-2);">${exp.notes || ' — '}</span></td>
      <td><span style="font-size: 11px; color: var(--ink-3);">${exp.created_by}</span></td>
    `;
    tbody.appendChild(tr);
  });
}

// Action: Submit Transport Expense
function submitTransportExpense() {
  if (!requireRole(["supervisor"], "บันทึกรายจ่ายขนส่ง")) return;

  const driverId = document.getElementById("s5-input-driver")?.value;
  const type = document.getElementById("s5-input-type")?.value;
  const amount = parseFloat(document.getElementById("s5-input-amount")?.value) || 0;
  const mileage = parseInt(document.getElementById("s5-input-mileage")?.value || "0", 10);
  const notes = document.getElementById("s5-input-notes")?.value?.trim();

  if (amount <= 0) {
    alert("กรุณากรอกจำนวนเงินใถูกต้อ");
    return;
  }

  const typeLabels = { fuel: "⛽ ค่าน้ำมั", wage: "👷 ค่าเที่ยว/ค่าแรง", toll: "🛣 ค่าทางด่วน/ค่าจอง", maintenance: "🔧 ค่าซ่อมบำรุงรถ" };

  if (!state._EXPENSE) state._EXPENSE = [];
  state._EXPENSE.push({
    id: `EXP-${Date.now().toString().slice(-6)}`,
    date: "8/12/2026",
    driver_id: driverId,
    expense_type: typeLabels[type] || type,
    amount: amount,
    mileage: mileage,
    notes: notes,
    created_by: state.currentUser.name,
    created_at: new Date().toISOString()
  });

  saveStateToLocalStorage();
  renderSupervisorS5();

  document.getElementById("s5-input-amount").value = "";
  document.getElementById("s5-input-mileage").value = "";
  document.getElementById("s5-input-notes").value = "";

  showNotification(`บันทึกรายจ่า ${typeLabels[type]} จำนว ${amount.toFixed(2)} เรียบร้อยแล้ว`, "done");
}

// =========================================================
// S6 Engine  —  Accounting Export CSV Generator
// =========================================================

function exportAccountingCSV(datasetType) {
  const todayStr = "8/12/2026";
  const isDayLocked = state._DAYCLOSE && state._DAYCLOSE[todayStr]?.is_locked;

  if (!isDayLocked) {
    alert("🔒 ข้อกำหนดทีมบัญชี: มารถส่งออกข้อมูลได้เฉพาะวันที่ 'ปิดยอดรายวัน (Day Close)' แล้วเท่านั้น\n\nกรุณาไปที่แท็บ 'S3. ตรวจเงิ COD' แล้วกดปุ่ม '🔒 ปิดยอดวันนี้' ก่ทำการดาวน์โหลดไฟล์ CSV");
    return;
  }

  let csvRows = [];
  let filename = `unii_mart_accounting_${datasetType}_2026-08-12.csv`;

  if (datasetType === "dataset1") {
    // Dataset 1: Successful Revenue
    csvRows.push(["delivery_date", "order_no", "customer_name", "phone", "total_sales", "payment_method", "collected_cash", "driver_id", "completed_at", "dayclose_status"]);
    state.allOrders.filter(o => o.status === "done").forEach(o => {
      csvRows.push([
        "2026-08-12",
        o.id,
        `"${o.customer}"`,
        o.phone,
        o.price.toFixed(2),
        o.cod ? "Cash On Delivery" : "Online Transfer",
        o.cod ? o.price.toFixed(2) : "0.00",
        o.assignedDriverId || "DRV-A01",
        "17:30:00",
        "LOCKED"
      ]);
    });
  } else if (datasetType === "dataset2") {
    // Dataset 2: Warehouse Returns
    csvRows.push(["date", "order_no", "customer_name", "item_count", "fail_reason", "driver_id", "returned_at", "received_by", "condition", "missing_count"]);
    (state._RETURNS || []).forEach(r => {
      csvRows.push([
        "2026-08-12",
        r.order_no,
        `"${r.shop_name}"`,
        r.item_count,
        `"${r.fail_reason}"`,
        r.driver_id,
        r.returned_at || "18:00:00",
        r.received_by || "SUP-01",
        `"${r.item_condition || 'ปกติ'}"`,
        r.missing_count || 0
      ]);
    });
  } else if (datasetType === "dataset3") {
    // Dataset 3: Transport Expenses
    csvRows.push(["date", "driver_id", "expense_type", "amount", "mileage", "notes", "created_by"]);
    (state._EXPENSE || []).forEach(e => {
      csvRows.push([
        "2026-08-12",
        e.driver_id,
        `"${e.expense_type}"`,
        e.amount.toFixed(2),
        e.mileage || 0,
        `"${e.notes || ''}"`,
        e.created_by
      ]);
    });
  } else if (datasetType === "dataset4") {
    // Dataset 4: Daily Close Ledger
    csvRows.push(["date", "driver_id", "expected_cash", "driver_reported", "supervisor_counted", "diff", "diff_reason", "closed_by", "closed_at"]);
    (state._COD || []).forEach(c => {
      csvRows.push([
        "2026-08-12",
        c.driver_id,
        c.expected_cash.toFixed(2),
        c.driver_reported_cash.toFixed(2),
        c.supervisor_counted_cash.toFixed(2),
        c.diff.toFixed(2),
        `"${c.diff_reason}"`,
        c.created_by,
        c.created_at
      ]);
    });
  }

  // Trigger CSV Blob Download
  const csvString = "\uFEFF" + csvRows.map(e => e.join(",")).join("\n");
  const blob = new Blob([csvString], { type: "text/csv;charset=utf-8;" });
  const link = document.createElement("a");
  const url = URL.createObjectURL(blob);
  link.setAttribute("href", url);
  link.setAttribute("download", filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  showNotification(`ดาวน์โดไฟล้ ${filename} คนส่งับส่งบัญชีเรียบร้อยแล้ว`, "done");
}

// =========================================================
// Product Master Quality Validation & Regex Parsing Engines
// =========================================================

// Task 1: Check Digit mod-10 EAN/GTIN validation
function validateBarcodeMod10(barcode) {
  if (!barcode || barcode === "-" || barcode === "") return true; // Empty is handled separately
  const clean = barcode.toString().trim().replace(/\s/g, "");
  if (!/^\d+$/.test(clean)) return false;
  if (![8, 12, 13, 14].includes(clean.length)) return false;
  
  const digits = clean.split("").map(Number);
  const check = digits[digits.length - 1];
  const payload = digits.slice(0, -1);
  
  let total = 0;
  for (let i = 0; i < payload.length; i++) {
    const d = payload[payload.length - 1 - i];
    total += d * (i % 2 === 0 ? 3 : 1);
  }
  const calcCheck = (10 - (total % 10)) % 10;
  return check === calcCheck;
}

// Task 2: Product Name Regex Qty Parser
function parseProductNameUnitQty(name) {
  if (!name) return null;
  const cleanName = name.replace(/\t/g, " ").replace(/\n/g, " ");
  
  // Double multiplier: e.g. หีบx10แพ฿5, หีบx10x5, ลังx6ขว฿3
  // Must have a unit word OR an explicit multiplier sign (x or *) between the two numbers.
  const dblMatch = cleanName.match(/(?:หีบ|ลัง|มั)\s*x?\s*(\d+)\s*(?:(?:แพค|กล่อง|ซอง|อ|ขวด|ถุง|ชิ้น|โหลด)\s*x?\s*|[x*]\s*)(\d+)/i);
  if (dblMatch) {
    const v1 = parseInt(dblMatch[1], 10);
    const v2 = parseInt(dblMatch[2], 10);
    return { qty: v1 * v2, reason: `${v1}x${v2}=${v1*v2}` };
  }
  
  // Box single multiplier: หีบx12 / ลังx12
  const boxMatch = cleanName.match(/(?:หีบ|ลัง|มั)\s*x?\s*(\d+)/i);
  if (boxMatch) {
    const v = parseInt(boxMatch[1], 10);
    return { qty: v, reason: `หีบx${v}` };
  }
  
  // Pack single multiplier: แพ฿12 / กล่อ฿30
  const packMatch = cleanName.match(/(?:แพค|กล่อง|ซอ)\s*x?\s*(\d+)/i);
  if (packMatch) {
    const v = parseInt(packMatch[1], 10);
    return { qty: v, reason: `แพ/กล่องx${v}` };
  }
  
  // Dozen keyword
  if (cleanName.includes("โหลด")) {
    return { qty: 12, reason: "โหลด=12" };
  }
  
  // Single units
  if (/(?:อ|ขวด|ถุง|ชิ้น|กระป๋อง|คนส่ง|ถ้วย|แก้ว|ตลับ|ก้|ซอ)(?!\d)/.test(cleanName)) {
    return { qty: 1, reason: "ช่วยเดี่ยว=1" };
  }
  
  if (!/(?:หีบ|แพค|กล่อง|ลัง|มัด|โหลด)/.test(cleanName)) {
    return { qty: 1, reason: "ไม่มีคำระบุแพค=1" };
  }
  
  return null; // Ambiguous
}

// =========================================================
// S7 & S8 JS Controller  —  Product Approvals & Quality Dashboard
// =========================================================

state.s7ActiveTab = "high";

// S7 Tabs selection
function switchS7ApprovalRiskTab(tabId) {
  state.s7ActiveTab = tabId;
  document.querySelectorAll("#admin-page-s7 .tab-btn").forEach(btn => {
    btn.classList.toggle("is-active", btn.id === `s7-tab-${tabId}`);
  });
  renderProductApprovalQueue();
}

// Render S7 Queue Table
function renderProductApprovalQueue() {
  const tbody = document.getElementById("s7-approval-tbody");
  const badgeHigh = document.getElementById("s7-badge-high");
  const badgeMed = document.getElementById("s7-badge-medium");
  const badgeS7 = document.getElementById("s7-pending-badge");

  const pendingList = state._PRODUCT_PENDING || [];
  const highPending = pendingList.filter(r => r.status === "pending" && ["actual_barcode", "qty_per_unit_override", "net_weight_g", "gross_weight_g"].includes(r.field));
  const medPending = pendingList.filter(r => r.status === "pending" && ["name_override", "unit_override", "width_cm", "length_cm", "height_cm", "max_stack_layers"].includes(r.field));

  if (badgeHigh) badgeHigh.innerText = highPending.length;
  if (badgeMed) badgeMed.innerText = medPending.length;
  if (badgeS7) badgeS7.innerText = pendingList.filter(r => r.status === "pending").length;

  if (!tbody) return;
  tbody.innerHTML = "";

  if (state.s7ActiveTab === "audit") {
    // Show Audit Log List
    tbody.innerHTML = `
      <tr>
        <td colspan="7" style="padding: 0;">
          <div style="max-height: 400px; overflow-y: auto; padding: 12px; font-size: 11px; line-height: 1.6; display: flex; flex-direction: column; gap: 6px;">
            ${(state._PRODUCT_AUDIT || []).slice(-100).reverse().map(log => `
              <div style="border-bottom: 1px dashed var(--line); padding-bottom: 4px;">
                [${new Date(log.timestamp).toLocaleString()}] <b>${log.actor} (${log.actor_role})</b> 
                ทำรายการ: <span style="font-weight: 600; color: var(--st-available);">${log.action}</span> 
                ที่สินค้: <b>${log.row_id}</b> | ฟิลด้: <code>${log.field}</code> 
                | ค่าเดิ: <span style="color: var(--st-failed); font-weight: 500;">"${log.old_value || 'ว่าง'}"</span> 
                ➄17 ค่าใ้: <span style="color: var(--st-done); font-weight: 600;">"${log.new_value || 'ว่าง'}"</span> 
                ${log.note ? `<i style="color: var(--ink-3);"> (ายเคนส่ง: ${log.note})</i>` : ''}
              </div>
            `).join("")}
          </div>
        </td>
      </tr>
    `;
    return;
  }

  const activeQueue = state.s7ActiveTab === "high" ? highPending : medPending;

  if (activeQueue.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--ink-3); padding: 20px;">ไม่มีคำขนหมวดหมู่ความเ่ยงนี้</td></tr>`;
    return;
  }

  activeQueue.forEach(req => {
    const prod = state.productMaster[req.row_id] || {};
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>
        <div style="font-weight: 700; color: var(--ink);">${prod.name || 'ไม่พบสินค้'}</div>
        <div style="font-size: 10px; color: var(--ink-3);" class="code">${req.row_id}</div>
      </td>
      <td><code style="font-weight: 600; background: var(--page); padding: 2px 6px; border-radius: 4px;">${req.field}</code></td>
      <td><span style="color: var(--st-failed); font-weight: 500;">"${req.old_value || 'ว่าง'}"</span></td>
      <td><span style="color: var(--st-done); font-weight: 700;">"${req.new_value}"</span></td>
      <td>
        <div style="font-weight: 600;">${req.requested_by}</div>
        <div style="font-size: 9px; color: var(--st-available);">แหล่งที่มา: ${req.source}</div>
      </td>
      <td><span style="font-size: 11px;">${new Date(req.requested_at).toLocaleTimeString()}</span></td>
      <td style="text-align: center;">
        <div style="display: flex; gap: 4px; justify-content: center;">
          <button class="btn btn--confirm btn--sm" onclick="approveProductChange('${req.pending_id}')" style="padding: 0 8px; font-size: 11px;">ุมัต</button>
          <button class="btn btn--secondary btn--sm" onclick="rejectProductChange('${req.pending_id}')" style="padding: 0 8px; font-size: 11px; border-color: var(--st-failed); color: var(--st-failed);">ปฏิเ</button>
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

// Action: Approve Product Change
function approveProductChange(pendingId) {
  if (!requireRole(["supervisor"], "อนุมัติข้อมูลสินค้า")) return;

  const reqIndex = state._PRODUCT_PENDING.findIndex(r => r.pending_id === pendingId);
  if (reqIndex === -1) return;

  const req = state._PRODUCT_PENDING[reqIndex];
  const isHighRisk = ["actual_barcode", "qty_per_unit_override", "net_weight_g", "gross_weight_g"].includes(req.field);

  if (isHighRisk) {
    const confirm2 = confirm(`⚠️ ยืนยันการอนุมัติการแก้ไขระดับสูง (ความเ่ยงสูง)\n\nการเปลี่ยนขู้ลนี้มีผลกระทบโดยตรงต่ะบบบาร์โค้ ๊อ และการคำนวณความจุรถจัดส่ง\n\nยืนยันนำเข้าระบบชีตัก?`);
    if (!confirm2) return;
  }

  // 1. Log Request Approval Event
  appendProductAuditLog("approve", req.row_id, req.field, req.old_value, req.new_value, req.source, pendingId);

  // 2. Apply change to override state
  if (!state._PRODUCT_OVERRIDE[req.row_id]) {
    state._PRODUCT_OVERRIDE[req.row_id] = {};
  }
  
  let valToApply = req.new_value;
  // Convert numbers
  if (["qty_per_unit_override", "net_weight_g", "gross_weight_g", "width_cm", "length_cm", "height_cm", "max_stack_layers"].includes(req.field)) {
    valToApply = parseFloat(req.new_value) || 0;
  }
  
  state._PRODUCT_OVERRIDE[req.row_id][req.field] = valToApply;

  // Apply volume formula automatically
  if (["width_cm", "length_cm", "height_cm"].includes(req.field)) {
    const w = parseFloat(state._PRODUCT_OVERRIDE[req.row_id].width_cm || state.productMaster[req.row_id].width_cm || 0);
    const l = parseFloat(state._PRODUCT_OVERRIDE[req.row_id].length_cm || state.productMaster[req.row_id].length_cm || 0);
    const h = parseFloat(state._PRODUCT_OVERRIDE[req.row_id].height_cm || state.productMaster[req.row_id].height_cm || 0);
    state._PRODUCT_OVERRIDE[req.row_id].volume_cm3 = w * l * h;
  }

  if (state.productMaster[req.row_id]) {
    state.productMaster[req.row_id] = { ...state.productMaster[req.row_id], ...state._PRODUCT_OVERRIDE[req.row_id] };
  }

  // 3. Log Complete Write Event
  appendProductAuditLog("apply", req.row_id, req.field, req.old_value, req.new_value, req.source, pendingId);

  // 4. Update status in pending list
  req.status = "approved";
  req.reviewed_by = state.currentUser.name;
  req.reviewed_at = new Date().toISOString();

  saveStateToLocalStorage();
  renderProductApprovalQueue();
  showNotification(`อนุมัติคำขอ ${req.field} ของสินค้ ${req.row_id} เรียบร้อยแล้ว`, "done");
}

// Action: Reject Product Change
function rejectProductChange(pendingId) {
  if (!requireRole(["supervisor"], "ปฏิเสธคำขอแก้สินค้า")) return;

  const req = state._PRODUCT_PENDING.find(r => r.pending_id === pendingId);
  if (!req) return;

  const reason = prompt("กรุณาระบุเุผลการปฏิเคำขอแก้ไขข้อมูลสินค้ (บังคับ):");
  if (!reason) {
    alert("ต้ระบุเุผลการปฏิเ!");
    return;
  }

  req.status = "rejected";
  req.reviewed_by = state.currentUser.name;
  req.reviewed_at = new Date().toISOString();
  req.reject_reason = reason;

  appendProductAuditLog("reject", req.row_id, req.field, req.old_value, req.new_value, req.source, pendingId, reason);

  saveStateToLocalStorage();
  renderProductApprovalQueue();
  showNotification(`ปฏิเคำขอแก้ไ ${req.row_id} เรียบร้อยแล้ว`, "failed");
}

// Bulk Approve Auto Parser results in queue
function approveAllParserPendingRequests() {
  if (!requireRole(["supervisor"], "อนุมัติข้อมูลสินค้ากลุ่มใหญ่")) return;

  const pendingList = (state._PRODUCT_PENDING || []).filter(r => r.status === "pending" && r.source === "auto_parse");
  if (pendingList.length === 0) {
    showNotification("ไม่มีรายการที่แกะจาก Parser ตกค้างในระบบ", "mine");
    return;
  }

  if (confirm(`ยืนยันอนุมัติคำขอส่งข้ามโซนทั้งหมด (Auto Parser) จำนวน ${pendingList.length} รายการใช่หรือไม่?\n\n2021232125252626202529222021222322202128 override ข้อมูลจะถูกอัปเดตและแจ้งเตือนคนขับ`)) {
    pendingList.forEach(req => {
      // Apply change
      if (!state._PRODUCT_OVERRIDE[req.row_id]) {
        state._PRODUCT_OVERRIDE[req.row_id] = {};
      }
      state._PRODUCT_OVERRIDE[req.row_id][req.field] = parseFloat(req.new_value) || 0;
      if (state.productMaster[req.row_id]) {
        state.productMaster[req.row_id] = { ...state.productMaster[req.row_id], ...state._PRODUCT_OVERRIDE[req.row_id] };
      }

      req.status = "approved";
      req.reviewed_by = state.currentUser.name;
      req.reviewed_at = new Date().toISOString();

      appendProductAuditLog("approve", req.row_id, req.field, req.old_value, req.new_value, req.source, req.pending_id, "อนุมัติกลุ่มใหญ่จาก Parser");
      appendProductAuditLog("apply", req.row_id, req.field, req.old_value, req.new_value, req.source, req.pending_id, "บันทึกกลุ่มสำเร็จ");
    });

    saveStateToLocalStorage();
    renderProductApprovalQueue();
    showNotification(`อนุมัติคำขอาก Parser ทั้งคนส่ง ${pendingList.length} รายการเรียบร้อยแล้ว`, "done");
  }
}

// Append Audit Log Row (immutable)
function appendProductAuditLog(action, rowId, field, oldVal, newVal, source, pendingId, note = "") {
  if (!state._PRODUCT_AUDIT) state._PRODUCT_AUDIT = [];
  state._PRODUCT_AUDIT.push({
    audit_id: `AUD-${Date.now().toString().slice(-6)}-${Math.floor(Math.random()*100)}`,
    timestamp: new Date().toISOString(),
    actor: state.currentUser ? state.currentUser.name : "System",
    actor_role: state.currentUser ? state.currentUser.role : "system",
    action: action, // request / approve / reject / apply
    row_id: rowId,
    field: field,
    old_value: oldVal || "",
    new_value: newVal || "",
    source: source,
    pending_id: pendingId || "",
    device: navigator.userAgent.includes("Mobi") ? "Mobile Device" : "Desktop PC",
    note: note
  });
}

// =========================================================
// S8 Dashboard Controller & Truck Capacity Simulator
// =========================================================

function renderProductQualityDashboard() {
  const coverageValEl = document.getElementById("s8-stat-coverage");
  const completeSkusEl = document.getElementById("s8-stat-complete-skus");
  const conflictsEl = document.getElementById("s8-stat-conflicts");
  const priorityTbody = document.getElementById("s8-dashboard-priority-tbody");
  const conflictsTbody = document.getElementById("s8-dashboard-conflicts-tbody");

  // 1. Calculate stats
  const totalPM = Object.keys(state.productMaster || {}).length;
  const withWeight = Object.values(state.productMaster || {}).filter(p => p.gross_weight_g !== null && p.gross_weight_g > 0).length;
  
  if (completeSkusEl) {
    completeSkusEl.innerText = `${withWeight} / ${totalPM} SKU`;
  }

  // Calculate Coverage over active day's orders
  const activeOrders = state.allOrders.filter(o => o.timeWindow === state.selectedDate);
  let ordersWithWeight = 0;
  let totalOrderItems = 0;
  let itemsWithWeight = 0;

  activeOrders.forEach(o => {
    const items = state.skuDetails[o.id] || [];
    let orderComplete = true;
    items.forEach(it => {
      totalOrderItems++;
      const pm = Object.values(state.productMaster).find(p => p.system_sku === it.sku);
      if (pm && pm.gross_weight_g !== null && pm.gross_weight_g > 0) {
        itemsWithWeight++;
      } else {
        orderComplete = false;
      }
    });
    if (orderComplete && items.length > 0) ordersWithWeight++;
  });

  const coveragePct = activeOrders.length > 0 ? (ordersWithWeight / activeOrders.length * 100) : 0;
  if (coverageValEl) {
    coverageValEl.innerText = `${coveragePct.toFixed(1)}%`;
  }

  // 2. Identify Conflicts (Check digit failure, duplicates, no System SKU)
  const conflictList = [];
  const checkedBarcodes = {};
  
  Object.values(state.productMaster).forEach(p => {
    // Missing SKU
    if (!p.system_sku || p.system_sku === "-") {
      conflictList.push({ row_id: p.row_id, name: p.name, barcode: p.barcode, type: "ไม่ม System SKU" });
    }
    
    // Check digit Mod-10 fail
    if (p.barcode && p.barcode !== "-" && !validateBarcodeMod10(p.barcode)) {
      conflictList.push({ row_id: p.row_id, name: p.name, barcode: p.barcode, type: "Check Digit (Mod-10) ผิดพลา" });
    }
    
    // Duplicate barcode
    if (p.barcode && p.barcode !== "-") {
      const clean = p.barcode.replace(/\s/g, "");
      if (!checkedBarcodes[clean]) checkedBarcodes[clean] = [];
      checkedBarcodes[clean].push(p.row_id);
    }
  });

  Object.entries(checkedBarcodes).forEach(([bc, rowids]) => {
    if (rowids.length > 1) {
      rowids.forEach(rid => {
        const prod = state.productMaster[rid];
        conflictList.push({ row_id: rid, name: prod.name, barcode: bc, type: `บาร์โค้ดซ้ำกับคนส่ง ${rowids.length - 1} รายการ` });
      });
    }
  });

  if (conflictsEl) {
    conflictsEl.innerText = `${conflictList.length} จุด`;
  }

  // Render Conflicts list
  if (conflictsTbody) {
    conflictsTbody.innerHTML = "";
    if (conflictList.length === 0) {
      conflictsTbody.innerHTML = `<tr><td colspan="4" style="text-align: center; color: var(--ink-3); padding: 12px;">ไม่พบปัญขู้ลในคลังสินค้า</td></tr>`;
    } else {
      conflictList.slice(0, 15).forEach(c => {
        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td>
            <div style="font-weight: 700; color: var(--ink);">${c.name}</div>
            <div style="font-size: 10px; color: var(--ink-3);" class="code">${c.row_id}</div>
          </td>
          <td><code class="code">${c.barcode || ' — '}</code></td>
          <td><span class="chip chip--failed" style="font-size: 10px;">${c.type}</span></td>
          <td style="text-align: center;">
            <button class="btn btn--secondary btn--sm" onclick="openProductQuickEditModal('${c.row_id}')" style="font-size: 11px; padding: 2px 8px;">แก้ไ</button>
          </td>
        `;
        conflictsTbody.appendChild(tr);
      });
    }
  }

  // 3. Render High Frequency Priority SKUs missing weight
  if (priorityTbody) {
    priorityTbody.innerHTML = "";
    const skuCounts = {};
    activeOrders.forEach(o => {
      const items = state.skuDetails[o.id] || [];
      items.forEach(it => {
        skuCounts[it.sku] = (skuCounts[it.sku] || 0) + it.qty;
      });
    });

    const sortedSkusMissingWeight = Object.entries(skuCounts)
      .map(([sku, orderCount]) => {
        const pm = Object.values(state.productMaster).find(p => p.system_sku === sku);
        return { sku, orderCount, pm };
      })
      .filter(item => item.pm && (item.pm.gross_weight_g === null || item.pm.gross_weight_g === 0))
      .sort((a, b) => b.orderCount - a.orderCount);

    if (sortedSkusMissingWeight.length === 0) {
      priorityTbody.innerHTML = `<tr><td colspan="4" style="text-align: center; color: var(--st-done); font-weight: 600; padding: 20px;">✄ สินค้าที่มีการซื้อขายวันนี้มีข้อมูลน้ำักครบถ้วนแล้!</td></tr>`;
    } else {
      sortedSkusMissingWeight.slice(0, 10).forEach(item => {
        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td>
            <div style="font-weight: 700; color: var(--ink);">${item.pm.name}</div>
            <div style="font-size: 10px; color: var(--ink-3);" class="code">SKU: ${item.sku} (${item.pm.row_id})</div>
          </td>
          <td style="text-align: right;"><b class="num" style="color: var(--st-failed); font-size: 14px;">${item.orderCount} ชิ้น</b></td>
          <td style="text-align: center;"><span class="chip chip--attention" style="font-size: 10px;">ขาดข้อมูลน้ำัก</span></td>
          <td style="text-align: center;">
            <button class="btn btn--primary btn--sm" onclick="openProductQuickEditModal('${item.pm.row_id}')" style="font-size: 11px; padding: 2px 8px;">กรน้ำหนั</button>
          </td>
        `;
        priorityTbody.appendChild(tr);
      });
    }
  }

  // 4. Render Truck Capacity Constraints Simulator per driver
  renderTruckCapacitySimulator(activeOrders);
}

// Truck capacity rendering per driver active runs
function renderTruckCapacitySimulator(activeOrders) {
  const container = document.getElementById("s8-capacity-drivers-list");
  if (!container) return;
  container.innerHTML = "";

  const drivers = Object.values(state._USERS).filter(u => u.role === "driver");
  const maxWeightLimit = parseInt(localStorage.getItem("cfg_max_weight") || "150000", 10); // Default 150kg
  const maxVolumeLimit = parseInt(localStorage.getItem("cfg_max_volume") || "800000", 10); // Default 800L

  drivers.forEach(drv => {
    // Find all orders assigned to this driver today
    const drvOrders = activeOrders.filter(o => o.assignedDriverId === drv.id || (o.status === "mine" && drv.id === "DRV-A01"));
    
    let totalWeight = 0;
    let totalVolume = 0;
    let totalItemsCount = 0;
    let hasFragileConflict = false;

    drvOrders.forEach(o => {
      const items = state.skuDetails[o.id] || [];
      items.forEach(it => {
        totalItemsCount += it.qty;
        const pm = Object.values(state.productMaster).find(p => p.system_sku === it.sku);
        if (pm) {
          totalWeight += (pm.gross_weight_g || 0) * it.qty;
          totalVolume += (pm.volume_cm3 || 0) * it.qty;
          if (pm.storage_type === "เปราะบา" || pm.storage_type === "วางทับไม่ได้") {
            hasFragileConflict = true;
          }
        }
      });
    });

    const weightPercent = (totalWeight / maxWeightLimit * 100);
    const volumePercent = (totalVolume / maxVolumeLimit * 100);

    const isWeightOver = totalWeight > maxWeightLimit;
    const isVolumeOver = totalVolume > maxVolumeLimit;
    const weightColor = isWeightOver ? "var(--st-failed)" : "var(--st-done)";
    const volumeColor = isVolumeOver ? "var(--st-failed)" : "var(--st-done)";

    // Heavy weight vs fragile safety warning (>50kg loaded with fragile/do-not-stack items)
    const safetyWarning = (hasFragileConflict && totalWeight > 50000) 
      ? `<div style="font-size: 10px; color: var(--st-failed); background: var(--st-failed-bg); padding: 4px 8px; border-radius: 4px; font-weight: 600; margin-top: 6px;"><i class="fa-solid fa-circle-exclamation"></i> ⚠️ ระวั: รถบรรทุกของหนั >50กก. ร่วมกับสินค้าแตกง่าย/เปราะบา!</div>`
      : "";

    const div = document.createElement("div");
    div.style = "background: var(--card); padding: 12px; border-radius: 6px; border: 1px solid var(--line); display: flex; flex-direction: column; gap: 8px;";
    div.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <span style="font-weight: 700; color: var(--ink);">${drv.name} (${drv.id})</span>
        <span class="chip chip--available" style="font-size: 10px;">${drvOrders.length} จุ (${totalItemsCount} ชิ้น)</span>
      </div>

      <!-- Weight Gauge -->
      <div>
        <div style="display: flex; justify-content: space-between; font-size: 10px; margin-bottom: 2px;">
          <span>⚖️ น้ำหนักบรรทุกรวม:</span>
          <b class="num" style="color: ${weightColor};">${(totalWeight/1000).toFixed(2)} / ${(maxWeightLimit/1000).toFixed(0)} กก.</b>
        </div>
        <div style="background: var(--page); height: 8px; border-radius: 4px; overflow: hidden;">
          <div style="background: ${weightColor}; width: ${Math.min(weightPercent, 100)}%; height: 100%;"></div>
        </div>
      </div>

      <!-- Volume Gauge -->
      <div>
        <div style="display: flex; justify-content: space-between; font-size: 10px; margin-bottom: 2px;">
          <span>📦 ปริมาตรรวมบนรถ:</span>
          <b class="num" style="color: ${volumeColor};">${(totalVolume/1000).toFixed(1)} / ${(maxVolumeLimit/1000).toFixed(0)} ลิตร</b>
        </div>
        <div style="background: var(--page); height: 8px; border-radius: 4px; overflow: hidden;">
          <div style="background: ${volumeColor}; width: ${Math.min(volumePercent, 100)}%; height: 100%;"></div>
        </div>
      </div>

      ${safetyWarning}
    `;
    container.appendChild(div);
  });
}

function saveTruckConfig() {
  const w = document.getElementById("cfg-max-weight").value;
  const v = document.getElementById("cfg-max-volume").value;
  localStorage.setItem("cfg_max_weight", w);
  localStorage.setItem("cfg_max_volume", v);
  renderProductQualityDashboard();
  showNotification("บันทึกการตั้งค่าขีดจำกัดความจุรถเรียบร้อยแล้ว", "done");
}

// =========================================================
// Quick Edit Modal Event Handlers & Openers
// =========================================================

function openProductQuickEditModal(rowId) {
  const prod = state.productMaster[rowId];
  if (!prod) {
    alert("ไม่พบสินค้าที่ต้องการแก้ไข!");
    return;
  }

  state.selectedQuickEditRowId = rowId;

  document.getElementById("quick-product-row-id").innerText = `RowID: ${prod.row_id}`;
  document.getElementById("quick-product-system-name").innerText = prod.name;
  document.getElementById("quick-product-system-sku").innerText = prod.system_sku || " — ";
  document.getElementById("quick-product-system-barcode").innerText = prod.barcode || " — ";

  document.getElementById("quick-input-actual-barcode").value = prod.actual_barcode || "";
  document.getElementById("quick-input-qty-per-unit").value = prod.qty_per_unit_override || "";
  document.getElementById("quick-input-net-weight").value = prod.net_weight_g || "";
  document.getElementById("quick-input-gross-weight").value = prod.gross_weight_g || "";
  
  document.getElementById("quick-input-name-override").value = prod.name_override || "";
  document.getElementById("quick-input-unit-override").value = prod.unit_override || "";
  document.getElementById("quick-input-max-stack").value = prod.max_stack_layers || "";

  document.getElementById("quick-input-width").value = prod.width_cm || "";
  document.getElementById("quick-input-length").value = prod.length_cm || "";
  document.getElementById("quick-input-height").value = prod.height_cm || "";
  document.getElementById("quick-input-volume").value = prod.volume_cm3 || "0";

  document.getElementById("quick-input-storage-type").value = prod.storage_type || "ปกติ";
  document.getElementById("quick-input-parent-rowid").value = prod.parent_unit_rowid || "";
  document.getElementById("quick-input-notes").value = prod.notes || "";

  document.getElementById("modal-product-quick-edit").classList.add("is-open");
}

function closeProductQuickEditModal() {
  document.getElementById("modal-product-quick-edit").classList.remove("is-open");
}

function recalculateQuickVolume() {
  const w = parseFloat(document.getElementById("quick-input-width").value) || 0;
  const l = parseFloat(document.getElementById("quick-input-length").value) || 0;
  const h = parseFloat(document.getElementById("quick-input-height").value) || 0;
  document.getElementById("quick-input-volume").value = (w * l * h).toFixed(0);
}

// Action: Submit Quick Edit Request
function submitProductQuickEdit() {
  const rowId = state.selectedQuickEditRowId;
  const prod = state.productMaster[rowId];
  if (!prod) return;

  const actualBarcode = document.getElementById("quick-input-actual-barcode").value.trim();
  const qtyPerUnit = document.getElementById("quick-input-qty-per-unit").value.trim();
  const netWeight = document.getElementById("quick-input-net-weight").value.trim();
  const grossWeight = document.getElementById("quick-input-gross-weight").value.trim();
  
  const nameOverride = document.getElementById("quick-input-name-override").value.trim();
  const unitOverride = document.getElementById("quick-input-unit-override").value.trim();
  const maxStack = document.getElementById("quick-input-max-stack").value.trim();

  const width = document.getElementById("quick-input-width").value.trim();
  const length = document.getElementById("quick-input-length").value.trim();
  const height = document.getElementById("quick-input-height").value.trim();

  const storageType = document.getElementById("quick-input-storage-type").value;
  const parentRowId = document.getElementById("quick-input-parent-rowid").value.trim();
  const notes = document.getElementById("quick-input-notes").value.trim();

  // Low Risk: auto-approve
  const lowFields = { storage_type: storageType, parent_unit_rowid: parentRowId, notes: notes };
  // Medium Risk: Supervisor Approval
  const medFields = { name_override: nameOverride, unit_override: unitOverride, max_stack_layers: maxStack, width_cm: width, length_cm: length, height_cm: height };
  // High Risk: Supervisor 2-step verification
  const highFields = { actual_barcode: actualBarcode, qty_per_unit_override: qtyPerUnit, net_weight_g: netWeight, gross_weight_g: grossWeight };

  let pendingAddedCount = 0;

  // Process Low Risk (Auto-approve)
  Object.entries(lowFields).forEach(([f, val]) => {
    const oldVal = prod[f] || "";
    if (val !== oldVal) {
      if (!state._PRODUCT_OVERRIDE[rowId]) state._PRODUCT_OVERRIDE[rowId] = {};
      state._PRODUCT_OVERRIDE[rowId][f] = val;
      prod[f] = val;
      appendProductAuditLog("apply", rowId, f, oldVal, val, "manual", "", "ปรับปรุงระดับต่ำ (ุมัติอัตโนมัติ)");
    }
  });

  // Process Medium & High Risk (Pendings)
  const allPendings = { ...medFields, ...highFields };
  Object.entries(allPendings).forEach(([f, val]) => {
    const oldVal = prod[f] !== null ? prod[f].toString() : "";
    if (val !== oldVal) {
      const pid = `REQ-${Date.now().toString().slice(-6)}-${Math.floor(Math.random()*100)}`;
      state._PRODUCT_PENDING.push({
        pending_id: pid,
        row_id: rowId,
        field: f,
        old_value: oldVal,
        new_value: val,
        source: "manual",
        status: "pending",
        requested_by: state.currentUser ? state.currentUser.name : "คนขับหน้างาน",
        requested_at: new Date().toISOString()
      });
      appendProductAuditLog("edit_request", rowId, f, oldVal, val, "manual", pid, "ขอปรับปรุงขู้ลสินค้า");
      pendingAddedCount++;
    }
  });

  saveStateToLocalStorage();
  closeProductQuickEditModal();
  renderProductApprovalQueue();
  renderProductQualityDashboard();

  if (pendingAddedCount > 0) {
    showNotification(`ส่งคำร้องแก้ไขขู้ลสินค้า ${pendingAddedCount} ฟิลด้ เรียบร้อยแล้ว (รอวหน้าอนุมัติ)`, "mine");
  } else {
    showNotification("บันทึกขู้ลระดับต่ำเร็ เรียบร้อยแล้ว", "done");
  }
}

// Search and Scan logic inside Quality Dashboard
function searchProductCatalog() {
  const query = document.getElementById("s8-search-catalog").value.trim().toLowerCase();
  const resultsDiv = document.getElementById("s8-search-results");
  if (!resultsDiv) return;

  if (query.length < 2) {
    resultsDiv.style.display = "none";
    resultsDiv.innerHTML = "";
    return;
  }

  const matches = Object.values(state.productMaster || {}).filter(p => {
    return (p.name && p.name.toLowerCase().includes(query)) ||
           (p.row_id && p.row_id.toLowerCase().includes(query)) ||
           (p.system_sku && p.system_sku.toLowerCase().includes(query)) ||
           (p.barcode && p.barcode.includes(query)) ||
           (p.actual_barcode && p.actual_barcode.includes(query));
  });

  resultsDiv.style.display = "flex";
  resultsDiv.innerHTML = "";

  if (matches.length === 0) {
    resultsDiv.innerHTML = `<div style="color: var(--ink-3); text-align: center; font-size: 11px; padding: 6px;">ไม่พบสินค้าที่ตรงกับการค้น</div>`;
    return;
  }

  matches.slice(0, 15).forEach(p => {
    const div = document.createElement("div");
    div.style = "display: flex; justify-content: space-between; align-items: center; background: var(--card); padding: 6px; border-radius: 4px; border: 1px solid var(--line); font-size: 11px;";
    
    // Highlight if search query matches mismatch barcode
    const mismatchBc = document.getElementById("s8-scan-mismatch-bc")?.innerText || "";
    const attachBtn = mismatchBc 
      ? `<button class="btn btn--secondary btn--sm" style="font-size: 10px; padding: 2px 6px; border-color: var(--st-available); color: var(--st-available);" onclick="attachBarcodeToProduct('${p.row_id}', '${mismatchBc}')"><i class="fa-solid fa-link"></i> ผูกบาร์โค้ดสแก</button>` 
      : `<button class="btn btn--secondary btn--sm" style="font-size: 10px; padding: 2px 6px;" onclick="openProductQuickEditModal('${p.row_id}')"><i class="fa-solid fa-edit"></i> แก้ไ</button>`;
      
    div.innerHTML = `
      <div>
        <div style="font-weight: 700; color: var(--ink);">${p.name}</div>
        <div style="font-size: 9px; color: var(--ink-3);" class="code">SKU: ${p.system_sku || ' — '} | Barcode: ${p.barcode || ' — '}</div>
      </div>
      <div>
        ${attachBtn}
      </div>
    `;
    resultsDiv.appendChild(div);
  });
}

function simulateBarcodeScan() {
  const bc = prompt("จำลองเครื่คนส่งกนบาร์โค้ดหน้าคลัง (กรคนส่งายเลขบาร์โค้ดสินค้าที่ต้องการกน):");
  if (!bc) return;
  const cleanBc = bc.trim().replace(/\s/g, "");
  if (!cleanBc) return;

  // Search in productMaster
  const prod = Object.values(state.productMaster).find(p => {
    return (p.barcode && p.barcode.replace(/\s/g, "") === cleanBc) ||
           (p.actual_barcode && p.actual_barcode.replace(/\s/g, "") === cleanBc);
  });

  if (prod) {
    // Found! open Quick Edit Modal
    openProductQuickEditModal(prod.row_id);
    showNotification(`กนบาร์โค้ดเร็: พบบัญชีสินค้ ${prod.name}`, "done");
    closeScanMismatchBanner();
  } else {
    // Mismatch/Not found!
    document.getElementById("s8-scan-mismatch-bc").innerText = cleanBc;
    document.getElementById("s8-scan-mismatch-banner").style.display = "flex";
    showNotification(`⚠️ กนไม่พบบาร์โค้: ${cleanBc} ในระบบัก`, "failed");
  }
}

function attachBarcodeToProduct(rowId, barcode) {
  openProductQuickEditModal(rowId);
  // Auto-fill actual barcode field!
  const barcodeInput = document.getElementById("quick-input-actual-barcode");
  if (barcodeInput) {
    barcodeInput.value = barcode;
    barcodeInput.style.border = "2px solid var(--st-available)"; // Highlight it
  }
  closeScanMismatchBanner();
}

function closeScanMismatchBanner() {
  document.getElementById("s8-scan-mismatch-banner").style.display = "none";
  document.getElementById("s8-scan-mismatch-bc").innerText = "";
  searchProductCatalog(); // Refresh list to clear link button
}