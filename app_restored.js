/* =========================================================
   Unii Mart 584  17 Driver Route App
   Single Source of Truth Tokens & GeoJSON Point-in-Polygon Engine
   ========================================================= */

// Central Warehouse Hub (Lamphun / Chiang Mai)
const WAREHOUSE_HUB = {
  name: "Unii Mart Hub 584 (ศูนย์กระจายสินค้าหลัค17)",
  lat: 18.56228949,
  lng: 99.04152043
};

// Defined GeoJSON Zones Polygons (Strict numeric Point-in-Polygon)
const GEOJSON_ZONES = {
  "Zone A  17 ๢มืค17ลำพูค17": [
    [18.48, 98.95],
    [18.66, 98.95],
    [18.66, 99.12],
    [18.48, 99.12]
  ],
  "Zone B  17 ค17รภค17/๢ชียงใหม่": [
    [18.66, 98.90],
    [18.85, 98.90],
    [18.85, 99.12],
    [18.66, 99.12]
  ],
  "Zone C  17 ป่าซาง": [
    [18.35, 98.75],
    [18.48, 98.75],
    [18.48, 98.95],
    [18.35, 98.95]
  ]
};

// Driver Profiles (M1 Driver Authentication)
const DRIVER_PROFILES = {
  "DRV-A01": { code: "DRV-A01", name: "ค17ชาค17 จัดส่ง", zone: "Zone A  17 ๢มืค17ลำพูค17", pin: "1111", avatar: "A01" },
  "DRV-B02": { code: "DRV-B02", name: "วิชัค17 ขับเร็ค17", zone: "Zone B  17 ค17รภค17/๢ชียงใหม่", pin: "2222", avatar: "B02" },
  "DRV-C03": { code: "DRV-C03", name: "ค17ศักดิ์ ค17ขใค17", zone: "Zone C  17 ป่าซาง", pin: "3333", avatar: "C03" },
  "DRV-S04": { code: "DRV-S04", name: "ค17รชัย ค17ยด่วค17", zone: "ทุกโซน (ลอตใค17ไ17 / ๢ก็บตค17 / VVIP)", pin: "4444", avatar: "VIP", isSpecial: true }
};

// Application State Container
let state = {
  allOrders: [],
  orders: [],
  activeDriver: DRIVER_PROFILES["DRV-A01"],
  driverLocation: { lat: 18.56228949, lng: 99.04152043 }, // Active Driver GPS
  activeFilter: "all",
  selectedDate: "8/12/2026",
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
let routePolyline = null;
let routeMarkers = [];

// --- Initialize App ---
document.addEventListener("DOMContentLoaded", async () => {
  initMap();
  initEventListeners();
  loadStateFromLocalStorage();
  await loadDatabase();
  updatePrintDate();
});

// Route Code Generator (Column N "คนค17ค17") e.g. DRV-A01-260813-0604
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
      showNotification("คัดลค17๢ลขคำค17่งซื้อ๢รียบร้ค17แล้ว: " + text, "done");
    } catch (err) {
      console.warn("Fallback copy failed:", err);
    }
    document.body.removeChild(textarea);
    return;
  }
  navigator.clipboard.writeText(text).then(() => {
    showNotification("คัดลค17๢ลขคำค17่งซื้อ๢รียบร้ค17แล้ว: " + text, "done");
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
    const res = await fetch("orders_data.json");
    if (!res.ok) throw new Error("Failed to load orders_data.json");
    const rawOrders = await res.json();

    // Run GeoJSON Point-in-Polygon on raw orders
    state.allOrders = rawOrders.map(o => classifyOrderZone(o));
    console.log(`Loaded ${state.allOrders.length} orders from database.`);

    // Fetch SKU Details
    try {
      const skuRes = await fetch("sku_details.json");
      if (skuRes.ok) {
        state.skuDetails = await skuRes.json();
        console.log(`Loaded SKU details for ${Object.keys(state.skuDetails).length} orders.`);
      }
    } catch (skuErr) {
      console.warn("Could not load sku_details.json:", skuErr);
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
        console.log(`Loaded Product Master with ${Object.keys(state.productMaster).length} SKUs.`);
      }
    } catch (pmErr) {
      console.warn("Could not load product_master.json:", pmErr);
    }

    populateDateDropdown();
    filterAndRender();
  } catch (err) {
    console.error("Error loading database:", err);
    state.allOrders = [];
    filterAndRender();
  }
}

// Point-in-Polygon Classification Algorithm (Ray-casting)
function classifyOrderZone(order) {
  const lat = order.lat;
  const lng = order.lng;

  // Check valid bounds (lat 17.9-19.3 / lng 98.4-99.6)
  if (lat < 17.9 || lat > 19.3 || lng < 98.4 || lng > 99.6) {
    order.geojsonZone = "UNASSIGNED";
    order.isOutOfBounds = true;
    return order;
  }

  let matchedZone = "UNASSIGNED";
  for (const [zoneName, polygon] of Object.entries(GEOJSON_ZONES)) {
    if (pointInPolygon([lat, lng], polygon)) {
      matchedZone = zoneName;
      break;
    }
  }

  order.geojsonZone = matchedZone;
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

// Helper: Parse M/D/YYYY string into timestamp for chronological sorting
function parseDateTimestamp(dateStr) {
  if (!dateStr || dateStr === "all") return 0;
  const parts = dateStr.split("/");
  if (parts.length === 3) {
    const month = parseInt(parts[0], 10) - 1;
    const day = parseInt(parts[1], 10);
    const year = parseInt(parts[2], 10);
    return new Date(year, month, day).getTime();
  }
  return 0;
}

// Helper: Format M/D/YYYY into readable Thai date string
const THAI_MONTHS_SHORT = [
  "ค17.ค17.", "ค17.ค17.", "มี.ค17.", "๢ค17.ค17.", "ค17.ค17.", "มิ.ค17.",
  "ค17.ค17.", "ค17.ค17.", "ค17.ค17.", "ค17.ค17.", "ค17.ค17.", "ค17.ค17."
];

function formatThaiDateDisplay(dateStr) {
  const parts = dateStr.split("/");
  if (parts.length === 3) {
    const month = parseInt(parts[0], 10) - 1;
    const day = parseInt(parts[1], 10);
    const year = parseInt(parts[2], 10);
    const thaiYear = year > 2500 ? year : year + 543;
    const monthName = THAI_MONTHS_SHORT[month] || `${month + 1}`;
    return `วันที่ ${day} ${monthName} ${thaiYear}`;
  }
  return dateStr;
}

// Populate Date Selector sorted Chronologically by Date (Newest to Oldest)
function populateDateDropdown() {
  const dateSelect = document.getElementById("date-select");
  if (!dateSelect) return;

  const dateCounts = {};
  state.allOrders.forEach(o => {
    if (o.timeWindow) {
      dateCounts[o.timeWindow] = (dateCounts[o.timeWindow] || 0) + 1;
    }
  });

  // Sort dates chronologically descending (Newest date first)
  const sortedDates = Object.keys(dateCounts).sort((a, b) => parseDateTimestamp(b) - parseDateTimestamp(a));

  // Default to newest date available with orders (e.g. 8/13/2026 or newest)
  const defaultDate = sortedDates.includes("8/13/2026") ? "8/13/2026" : (sortedDates[0] || "all");
  state.selectedDate = defaultDate;

  dateSelect.innerHTML = `<option value="all">ทุกวันจัดส่ง (${state.allOrders.length.toLocaleString()} ค17๢ดอร์)</option>`;
  sortedDates.forEach(d => {
    const isSelected = d === defaultDate ? "selected" : "";
    const thaiLabel = formatThaiDateDisplay(d);
    dateSelect.innerHTML += `<option value="${d}" ${isSelected}>${thaiLabel} (${dateCounts[d]} ค17๢ดอร์)</option>`;
  });
}

// Get orders matching current status filter & search query
function getFilteredOrders() {
  return state.orders.filter(order => {
    const matchesFilter = state.activeFilter === "all" ? true : order.status === state.activeFilter;
    const q = state.searchQuery.toLowerCase();
    const matchesSearch = !q ||
      order.id.toLowerCase().includes(q) ||
      order.customer.toLowerCase().includes(q) ||
      order.phone.toLowerCase().includes(q) ||
      order.address.toLowerCase().includes(q);

    return matchesFilter && matchesSearch;
  });
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
  let baseList = state.selectedDate === "all" ? [...state.allOrders] : state.allOrders.filter(o => o.timeWindow === state.selectedDate);

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
        if (state.activeDriver.zone === "ALL" || orderCopy.geojsonZone === state.activeDriver.zone) {
          orderCopy.status = "available";
        } else {
          orderCopy.status = "out"; // Out of driver zone -> Muted & Disabled
        }
      }
    }
    return orderCopy;
  }).filter(o => state.activeDriver.isSpecial || o.geojsonZone !== "UNASSIGNED");

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

// Target Stop Selection Engine (P0-1 Target Stop without forced sequences or polylines)
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
  showNotification(`๢ปลี่ยนจุดส่ง๢ป้าหมายเป็ค17 "${targetOrder ? targetOrder.customer : orderId}" ๢รียบร้ค17แล้ว ("กำลังไค17")`, "mine");
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
    .bindPopup(`<b>${WAREHOUSE_HUB.name}</b><br>พิกัดคลัค17: 18.562, 99.041`);

  renderGeoJsonZonePolygons();
}

function renderGeoJsonZonePolygons() {
  zonePolygons.forEach(p => map.removeLayer(p));
  zonePolygons = [];

  const colors = {
    "Zone A  17 ๢มืค17ลำพูค17": "var(--st-available)",
    "Zone B  17 ค17รภค17/๢ชียงใหม่": "#800080",
    "Zone C  17 ป่าซาง": "#FF8C00"
  };

  for (const [zoneName, polygonCoords] of Object.entries(GEOJSON_ZONES)) {
    const poly = L.polygon(polygonCoords, {
      color: colors[zoneName] || "var(--st-available)",
      weight: 2,
      fillColor: colors[zoneName] || "var(--st-available)",
      fillOpacity: 0.08,
      dashArray: null
    }).addTo(map);

    zonePolygons.push(poly);
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

    const marker = L.marker([firstOrder.lat, firstOrder.lng], { icon: customIcon }).addTo(map);

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

  // Clear existing polyline
  if (routePolyline) {
    map.removeLayer(routePolyline);
    routePolyline = null;
  }
  
  // Clear existing route index markers
  if (routeMarkers) {
    routeMarkers.forEach(m => map.removeLayer(m));
    routeMarkers = [];
  }

  // Draw active route sequence starting from Warehouse
  const activeMine = state.orders.filter(o => o.status === "mine");
  if (activeMine.length > 0 && map) {
    const coordinates = [[WAREHOUSE_HUB.lat, WAREHOUSE_HUB.lng]];
    
    activeMine.forEach((o, idx) => {
      coordinates.push([o.lat, o.lng]);

      // Overlay stop number circular badge on map
      const numIcon = L.divIcon({
        className: "leaflet-div-icon",
        html: `<div style="background: var(--st-mine); color: white; border-radius: 50%; width: 22px; height: 22px; display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 800; border: 2px solid white; box-shadow: 0 2px 4px rgba(0,0,0,0.35);">${idx + 1}</div>`,
        iconSize: [22, 22],
        iconAnchor: [11, 24]
      });
      const numMarker = L.marker([o.lat, o.lng], { icon: numIcon, zIndexOffset: 2000 }).addTo(map);
      routeMarkers.push(numMarker);
    });

    routePolyline = L.polyline(coordinates, {
      color: "var(--st-mine)",
      weight: 3.5,
      dashArray: "6, 6",
      opacity: 0.85
    }).addTo(map);
  }
}

// Build Rich HTML Popup for Map Pin Location
function buildLocationPopupHtml(key, groupOrders) {
  const firstOrder = groupOrders[0];
  const count = groupOrders.length;
  const isClustered = count > 1;

  let ordersHtml = groupOrders.map(o => {
    let statusBadge = "";
    if (o.status === "available") statusBadge = `<span class="chip chip--available" style="font-size: 10px; padding: 1px 6px;">โซนฉัน</span>`;
    else if (o.status === "mine") statusBadge = `<span class="chip chip--mine" style="font-size: 10px; padding: 1px 6px;"><i class="fa-solid fa-truck"></i> จองแล้ค17</span>`;
    else if (o.status === "other_mine") statusBadge = `<span class="chip" style="background: #8E8E93; color: #fff; font-size: 10px; padding: 1px 6px;"><i class="fa-solid fa-user-lock"></i> จองโดย ${o.assignedDriverId}</span>`;
    else if (o.status === "done") statusBadge = `<span class="chip chip--done" style="font-size: 10px; padding: 1px 6px;"><i class="fa-solid fa-circle-check"></i> ค17๢ร็ค17</span>`;
    else if (o.status === "failed") statusBadge = `<span class="chip chip--failed" style="font-size: 10px; padding: 1px 6px;">ไม่สำเร็ค17</span>`;
    else if (o.status === "out") statusBadge = `<span class="chip" style="font-size: 10px; padding: 1px 6px;">นอกโซน</span>`;

    let actionBtn = "";
    if (o.status === "available") {
      actionBtn = `<button class="btn btn--primary btn--sm" style="font-size: 11px; padding: 0 8px; min-height: 26px;" onclick="acceptOrder('${o.id}', event)">จองงานนีไ17</button>`;
    } else if (o.status === "mine") {
      actionBtn = `<button class="btn btn--primary btn--sm" style="font-size: 11px; padding: 0 8px; min-height: 26px;" onclick="setTargetStop('${o.id}', event)"><i class="fa-solid fa-location-arrow" style="margin-right: 4px;"></i> ไปจุดนี้ต่ค17</button>`;
    } else if (o.status === "other_mine") {
      actionBtn = `<button class="btn btn--secondary btn--sm" style="font-size: 11px; padding: 0 8px; min-height: 26px; border-color: var(--st-available); color: var(--st-available);" onclick="claimUrgentSpecialOrder('${o.id}', event)"><i class="fa-solid fa-bolt" style="color: var(--st-attention);"></i> ⚄17 ดึงงานด่วน</button>`;
    } else if (o.status === "done") {
      actionBtn = `<span style="font-size: 11px; color: var(--st-done); font-weight: 600;"><i class="fa-solid fa-check"></i> ๢รียบร้ค17</span>`;
    } else if (o.status === "out") {
      actionBtn = `<button class="btn btn--secondary btn--sm" style="font-size: 11px; padding: 0 8px; min-height: 26px; border-color: var(--st-available);" onclick="openCrossZoneRequestModal('${o.id}', event)"><i class="fa-solid fa-paper-plane" style="color: var(--st-available); margin-right: 4px;"></i> ขอค17งข้ามโซน</button>`;
    }

    return `
      <div style="background: var(--page); padding: 8px 10px; border-radius: 8px; border-left: 3px solid var(--st-${o.status === 'available' ? 'available' : (o.status === 'mine' ? 'mine' : (o.status === 'done' ? 'done' : 'failed'))}); margin-top: 6px;">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <span class="code" style="font-weight: 700; font-size: 12px; color: var(--ink);">${o.id}</span>
          ${statusBadge}
        </div>
        <div style="font-size: 12px; font-weight: 600; color: var(--ink); margin-top: 2px;">${o.customer}</div>
        <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 4px;">
          <span class="num" style="font-weight: 700; font-size: 13px; color: var(--ink);">${o.cod ? 'COD ค17' + o.price.toLocaleString(undefined, {minimumFractionDigits:2}) : 'จ่ายแล้ว ค17' + o.price.toLocaleString(undefined, {minimumFractionDigits:2})}</span>
          ${actionBtn}
        </div>
      </div>
    `;
  }).join("");

  const clusterActionBtn = isClustered && groupOrders.some(o => o.status === "available")
    ? `<button class="btn btn--primary btn--block btn--sm" style="margin-top: 10px; font-size: 12px;" onclick="acceptClusterGroup('${key}', event)"><i class="fa-solid fa-layer-group"></i> จองทั้งจุดค17ค17 (${count} ค17๢ดอร์)</button>`
    : "";

  return `
    <div style="display: flex; flex-direction: column;">
      <div style="display: flex; justify-content: space-between; align-items: flex-start;">
        <div>
          <div style="font-size: 13px; font-weight: 700; color: var(--ink);">
            <i class="fa-solid fa-location-dot" style="color: var(--st-available); margin-right: 4px;"></i> จุดส่งค17นค้า (${count} ค17๢ดอร์)
          </div>
          <div style="font-size: 11px; color: var(--ink-2); margin-top: 2px; line-height: 1.3;">${firstOrder.address}</div>
          <div style="font-size: 10px; color: var(--ink-3); margin-top: 2px;"><i class="fa-solid fa-phone"></i> ${firstOrder.phone} | พิกัค17: <span class="num">${key}</span></div>
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

  const filtered = state.orders.filter(order => {
    const matchesFilter = state.activeFilter === "all" ? true : order.status === state.activeFilter;
    const q = state.searchQuery.toLowerCase();
    const matchesSearch = !q ||
      order.id.toLowerCase().includes(q) ||
      order.customer.toLowerCase().includes(q) ||
      order.phone.toLowerCase().includes(q) ||
      order.address.toLowerCase().includes(q);

    return matchesFilter && matchesSearch;
  });

  updateTabCounts();

  if (filtered.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 32px 16px; color: var(--ink-3);">
        <i class="fa-solid fa-box-open" style="font-size: 32px; margin-bottom: 8px;"></i>
        <div>ไม่พบรายการคำสั่งซื้ค17นหมวดหมู่นี้</div>
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
    else if (order.status === "mine") statusBadge = `<span class="chip chip--mine"><i class="fa-solid fa-truck"></i> จองแล้ค17</span>`;
    else if (order.status === "other_mine") statusBadge = `<span class="chip" style="background: #8E8E93; color: #fff;"><i class="fa-solid fa-user-lock"></i> จองโดย ${order.assignedDriverId}</span>`;
    else if (order.status === "done") statusBadge = `<span class="chip chip--done"><i class="fa-solid fa-circle-check"></i> ค17งสำเร็ค17</span>`;
    else if (order.status === "failed") statusBadge = `<span class="chip chip--failed"><i class="fa-solid fa-triangle-exclamation"></i> ไม่สำเร็ค17</span>`;
    else if (order.status === "out") statusBadge = `<span class="chip">นอกโซน</span>`;

    let actionBtn = "";
    if (order.status === "available") {
      if (clusterCount > 1) {
        actionBtn = `<button class="btn btn--primary btn--sm" onclick="acceptClusterGroup('${key}', event)">จองจุดนีไ17 (${clusterCount})</button>`;
      } else {
        actionBtn = `<button class="btn btn--primary btn--sm" onclick="acceptOrder('${order.id}', event)">จองจุดนีไ17</button>`;
      }
    } else if (order.status === "mine") {
      actionBtn = `<button class="btn btn--primary btn--sm" onclick="setTargetStop('${order.id}', event)"><i class="fa-solid fa-location-arrow"></i> ไปจุดนี้ต่ค17</button>`;
    } else if (order.status === "other_mine") {
      actionBtn = `<button class="btn btn--secondary btn--sm" style="font-size: 11px; cursor: pointer; border-color: var(--st-available); color: var(--st-available);" onclick="claimUrgentSpecialOrder('${order.id}', event)"><i class="fa-solid fa-bolt" style="color: var(--st-attention);"></i> ⚄17 ดึงงานด่วนนีไ17</button>`;
    } else if (order.status === "done") {
      actionBtn = `<span style="font-size: 11px; color: var(--st-done); font-weight: 500;"><i class="fa-solid fa-check"></i> ค17๢ร็ค17 ${order.isGpsWarning ? '(๢ตืค17 GPS >300m)' : ''}</span>`;
    } else if (order.status === "failed") {
      actionBtn = `<span style="font-size: 11px; color: var(--st-failed);">${order.failReason || 'ไม่สำเร็ค17'}</span>`;
    } else if (order.status === "out") {
      actionBtn = `<button class="btn btn--secondary btn--sm" style="font-size: 11px; cursor: pointer; border-color: var(--st-available);" onclick="openCrossZoneRequestModal('${order.id}', event)"><i class="fa-solid fa-paper-plane" style="color: var(--st-available); margin-right: 4px;"></i> 202320202520212821242923</button>`;
    }
    const distDriver = calculateHaversineDistance(state.driverLocation.lat, state.driverLocation.lng, order.lat, order.lng);
    const isPlusCode = /^[A-Z0-9]{4}\+[A-Z0-9]{2,4}/i.test(order.address.trim());
    const displayAddress = isPlusCode && order.district ? `${order.district} (${order.address.split(',')[0]})` : order.address;

    const customerRecord = state._CUSTOMERS[order.phone] || {};
    const custChipsHtml = (customerRecord.chips || []).map(chip => `<span class="chip chip--attention" style="font-size: 10px; padding: 1px 6px;"><i class="fa-solid fa-triangle-exclamation"></i> ${chip}</span>`).join(" ");

    const helpBox = (order.isOutOfBounds || isPlusCode) ? `
      <div style="font-size: 11px; color: var(--st-attention); background: var(--st-attention-bg); padding: 5px 8px; border-radius: 6px; margin-bottom: 6px; display: flex; align-items: center; justify-content: space-between;">
        <span style="font-weight: 600;"><i class="fa-solid fa-circle-question"></i> 282029272823212823232121222725262120222323222723</span>
        <button class="btn btn--secondary btn--sm" style="font-size: 9px; padding: 2px 6px;" onclick="openPinCorrectionModalForOrder('${order.id}', event)">2527292121242825212120</button>
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
      ? `<span class="chip chip--failed" style="font-size: 10px; padding: 1px 6px; font-weight: 600; display: inline-flex; align-items: center; gap: 4px; border-radius: 99px;"><i class="fa-solid fa-triangle-exclamation"></i> ของหนักพิเศษ: ${(orderWeightG/1000).toFixed(1)} กก. (มีคนช่วยยก)</span>`
      : "";

    cardHtml.innerHTML = `
      <!-- P1-2 Shop Name is Line 1 Largest Text -->
      <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 2px;">
        <div style="font-size: 16px; font-weight: 700; color: var(--ink); line-height: 1.3;" title="${order.customer}">${order.customer}</div>
        ${statusBadge}
      </div>

      <!-- Line 2 Subtext Order ID & Chips -->
      <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-bottom: 6px;">
        <div style="display: inline-flex; align-items: center; gap: 4px; background: var(--page); padding: 2px 6px; border-radius: 4px; border: 1px solid var(--line);">
          <span class="code" style="font-size: 11px; color: var(--ink-2); font-weight: 600;">${order.id}</span>
          <button type="button" class="btn btn--secondary" style="font-size: 9px; padding: 0 4px; height: 16px; min-height: 16px; line-height: 1; border: none; background: transparent; cursor: pointer; color: var(--st-available);" onclick="copyToClipboard('${order.id}', event)" title="22272825232922252022292027202529232123">
            <i class="fa-solid fa-copy"></i>
          </button>
        </div>
        ${order.routeCode ? `<span class="chip chip--mine" style="font-size: 10px; padding: 1px 6px;" title="23212720262728202025 Column N 2223202724"><i class="fa-solid fa-id-card"></i> ${order.routeCode}</span>` : ''}
        ${custChipsHtml}
        ${heavyChip}
        ${clusterCount > 1 ? `<span class="chip" style="font-size: 10px; padding: 1px 6px;"><i class="fa-solid fa-layer-group"></i> ${clusterCount} 23232228232324212120232120</span>` : ''}
      </div>

      ${helpBox}

      <div class="order-address" style="margin-bottom: 6px; font-size: 12px; color: var(--ink-2); line-height: 1.4;">
        <i class="fa-solid fa-location-dot" style="color: var(--st-available); margin-right: 4px;"></i> ${displayAddress}
      </div>

      <div style="font-size: 11px; color: var(--ink-2); background: var(--page); padding: 6px 10px; border-radius: 6px; margin-bottom: 6px; display: flex; justify-content: space-between; align-items: center;">
        <span><i class="fa-solid fa-phone" style="color: var(--ink-3);"></i> ${order.phone}</span>
        <span><i class="fa-solid fa-store" style="color: var(--ink-3);"></i> 26282922252725: ${order.distance_wh} km</span>
      </div>

      <div class="order-footer">
        <div style="display: flex; flex-direction: column;">
          <span class="num" style="font-weight: 700; font-size: 15px; color: var(--ink);">${order.cod ? 'COD 21' + order.price.toLocaleString(undefined, {minimumFractionDigits:2}) : '2620282223252127 21' + order.price.toLocaleString(undefined, {minimumFractionDigits:2})}</span>
          <span class="num" style="font-size: 11px; color: var(--st-available); font-weight: 600;">212028252223202724 ${distDriver.toFixed(1)} km</span>
        </div>
        ${actionBtn}
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
  if (countEl) countEl.innerText = `${activeOrders.length} 252823`;

  if (activeOrders.length === 0) {
    container.innerHTML = `
      <div style="font-size: 12px; color: var(--ink-3); text-align: center; padding: 20px 0;">
        ยังไม่มีรายการที่จค17ไวไ17<br>กด "จองงานนีไ17" จากรายการหลัค17
      </div>
    `;
    return;
  }

  // Summary header for Target Stop Selection
  const summaryBox = document.createElement("div");
  summaryBox.style.cssText = "font-size: 11px; background: var(--page); padding: 8px 12px; border-radius: 8px; margin-bottom: 8px; border: 1px solid var(--line); display: flex; flex-direction: column; gap: 4px;";
  summaryBox.innerHTML = `
    <div style="display: flex; justify-content: space-between; align-items: center;">
      <span><i class="fa-solid fa-location-arrow" style="color: var(--st-mine); margin-right: 4px;"></i> จุดส่งที่จค17แล้ว (${activeOrders.length} จุค17):</span>
      <button class="btn btn--secondary btn--sm" style="font-size: 10px; padding: 1px 6px;" onclick="sortActiveOrdersByDistance()"><i class="fa-solid fa-arrow-down-short-wide"></i> ๢รียงตามระยะทาง</button>
    </div>
    <div style="font-size: 10px; color: var(--ink-2);">
      แตะปุ่ค17 "ไปจุดนี้ต่ค17" ๢พื่อ๢ลืค17จุดที่ต้ค17การส่งถัดไค17
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
          <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 2px;">
            ${isCurrentTarget ? '<span class="chip chip--mine" style="font-size: 10px; padding: 1px 6px;"><i class="fa-solid fa-location-arrow"></i> กำลังไค17</span>' : ''}
            <div style="display: inline-flex; align-items: center; gap: 4px; background: var(--page); padding: 1px 4px; border-radius: 4px; border: 1px solid var(--line);">
              <span class="code" style="font-size: 10px; color: var(--ink-2); font-weight: 600;">${order.id}</span>
              <button type="button" class="btn btn--secondary" style="font-size: 9px; padding: 0 4px; height: 14px; min-height: 14px; line-height: 1; border: none; background: transparent; cursor: pointer; color: var(--st-available);" onclick="copyToClipboard('${order.id}', event)" title="คัดลค17๢ลขคำค17่งซื้อ">
                <i class="fa-solid fa-copy"></i>
              </button>
            </div>
          </div>
          <div style="font-size: 14px; font-weight: 700; color: var(--ink); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${order.customer}</div>
          <div style="font-size: 11px; color: var(--ink-2); margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${order.address}</div>
        </div>

        <div style="text-align: right; flex-shrink: 0; display: flex; flex-direction: column; align-items: flex-end; gap: 4px;">
          <div class="num" style="font-size: 13px; font-weight: 700; color: var(--ink);">ค17${order.price.toLocaleString(undefined, {minimumFractionDigits:2})}</div>
          
          <!-- Reorder Chevrons (touch fallback) -->
          <div style="display: flex; gap: 4px; margin-top: 2px;">
            ${idx > 0 ? `<button class="btn btn--secondary btn--sm" style="padding: 0 4px; height: 18px; min-height: 18px; line-height: 1; font-size: 10px; border-color: var(--line);" onclick="reorderActiveDriverOrders(${idx}, ${idx - 1}); event.stopPropagation();" title="๢ลื่อนขึ้ค17">▄17</button>` : ''}
            ${idx < activeOrders.length - 1 ? `<button class="btn btn--secondary btn--sm" style="padding: 0 4px; height: 18px; min-height: 18px; line-height: 1; font-size: 10px; border-color: var(--line);" onclick="reorderActiveDriverOrders(${idx}, ${idx + 1}); event.stopPropagation();" title="๢ลื่อนลค17">▄17</button>` : ''}
          </div>

          ${!isCurrentTarget ? `<button class="btn btn--primary btn--sm" style="font-size: 11px; padding: 2px 8px; min-height: 28px; margin-top: 4px;" onclick="setTargetStop('${order.id}', event)"><i class="fa-solid fa-location-arrow"></i> ไปจุดนี้ต่ค17</button>` : ''}
        </div>
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
  showNotification(`ค17ับลำดับเค17นทาง๢ป็ค17 #${toIdx + 1} (${moved.customer}) ๢รียบร้ค17แล้ว`, "done");
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

function acceptOrder(orderId, e) {
  if (e) e.stopPropagation();
  const order = state.allOrders.find(o => o.id === orderId);
  if (order && order.status !== "out") {
    const routeCode = generateRouteCode(state.activeDriver, order.timeWindow, order.orderDate);
    order.status = "mine";
    order.assignedDriverId = state.activeDriver.code;
    order.routeCode = routeCode;

    if (!state._ORDER_OVERRIDE[orderId]) {
      state._ORDER_OVERRIDE[orderId] = { order_id: orderId, audit_history: [] };
    }
    const rec = state._ORDER_OVERRIDE[orderId];
    rec.status = "mine";
    rec.assigned_driver = state.activeDriver.code;
    rec.assigned_route_code = routeCode; // Column N "คนค17ค17"
    rec.audit_history.push({
      timestamp: new Date().toISOString(),
      actor: state.activeDriver.name,
      field: "claim_order",
      old_val: "available",
      new_val: `mine (${routeCode})`,
      reason: "พนักงานขับรถกดจองงานทางหน้าแค17"
    });

    saveStateToLocalStorage();
    filterAndRender();
    showNotification(`จองอค17ดอร์ ${order.id} ๢รียบร้ค17แล้ว! (รหัสคนค17ค17 Column N: ${routeCode})`, "mine");
  }
}

// Special Driver Action: Claim Urgent Order immediately without approval
function claimUrgentSpecialOrder(orderId, e) {
  if (e) e.stopPropagation();
  if (!state.activeDriver.isSpecial) {
    showNotification("๢ฉพาะทีมพิเศษ๢ท่านั้นที่ค17มารถดึงงานด่วนไดไ17", "failed");
    return;
  }

  const order = state.allOrders.find(o => o.id === orderId);
  if (!order) return;

  const previousDriver = order.assignedDriverId || "คนขับเดิค17";
  if (confirm(`⚄17 [ทีมพิเศษด่วน] ยืนยันดึงงานค17๢ดอร์ ${order.id} (${order.customer})\nจากคนขับ๢ดิค17 (${previousDriver}) มาจัดส่งด้วยทีมพิเศษทันทค17?\n\n(ระบบจะ๢ปลี่ยนคนค17งและข้ามขั้นตอนการขอค17ุมัติใค17ค17ตโนมัตค17)`)) {
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
    rec.assigned_route_code = routeCode; // Column N "คนค17ค17"
    rec.audit_history.push({
      timestamp: new Date().toISOString(),
      actor: state.activeDriver.name,
      field: "special_driver_claim_urgent",
      old_val: `mine (${previousDriver})`,
      new_val: `mine (${state.activeDriver.code})`,
      reason: "ดึงงานด่วนด้วยทีมพิเศษ (ข้ามขั้นตอนอนุมัติ๢ร่งด่วค17)"
    });

    saveStateToLocalStorage();
    filterAndRender();
    showNotification(`⚄17 ทีมพิเศษดึงงานด่วน ${order.id} มาจัดส่ง๢รียบร้ค17แล้ว! (รหัสคนค17ค17: ${routeCode})`, "mine");
  }
}

// Book Entire Cluster Location at Once
function acceptClusterGroup(clusterKey, e) {
  if (e) e.stopPropagation();
  const group = state.clusterGroups[clusterKey] || [];
  let count = 0;
  let sampleRouteCode = "";

  group.forEach(o => {
    if (o.status !== "out") {
      const routeCode = generateRouteCode(state.activeDriver, o.timeWindow, o.orderDate);
      o.status = "mine";
      o.assignedDriverId = state.activeDriver.code;
      o.routeCode = routeCode;
      sampleRouteCode = routeCode;

      if (!state._ORDER_OVERRIDE[o.id]) {
        state._ORDER_OVERRIDE[o.id] = { order_id: o.id, audit_history: [] };
      }
      const rec = state._ORDER_OVERRIDE[o.id];
      rec.status = "mine";
      rec.assigned_driver = state.activeDriver.code;
      rec.assigned_route_code = routeCode; // Column N "คนค17ค17"
      rec.audit_history.push({
        timestamp: new Date().toISOString(),
        actor: state.activeDriver.name,
        field: "claim_order",
        old_val: "available",
        new_val: `mine (${routeCode})`,
        reason: "พนักงานขับรถกดจองทั้งจุดค17ค17"
      });

      count++;
    }
  });

  saveStateToLocalStorage();
  filterAndRender();
  showNotification(`จองทั้งจุดค17ค17 (${count} ค17๢ดอร์) ๢รียบร้ค17แล้ว! (รหัสคนค17ค17 Column N: ${sampleRouteCode})`, "mine");
}

// Driver Reordering ("๢รียงตามระยะทางจากฉัน" - Reorders list only, no lines or navigation loops)
document.getElementById("btn-sort-distance")?.addEventListener("click", () => {
  state.orders.sort((a, b) => {
    const distA = calculateHaversineDistance(state.driverLocation.lat, state.driverLocation.lng, a.lat, a.lng);
    const distB = calculateHaversineDistance(state.driverLocation.lat, state.driverLocation.lng, b.lat, b.lng);
    return distA - distB;
  });

  renderOrders();
  showNotification("๢รียงรายการตามระยะทางจากตำแค17่งคนขับเรียบร้ค17แล้ว (ไม่วาด๢ค17นทาง)", "available");
});

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
        <img src="${src}" alt="ค17ักฐานจัดค17ค17 ${idx + 1}" onclick="window.open('${src}', '_blank')">
      </div>
    `).join("");
  }
}

function renderSlipThumbnails() {
  const container = document.getElementById("pod-slip-thumbnails");
  const countEl = document.getElementById("pod-slip-count");
  if (countEl) countEl.innerText = `${state.activePodPhotos.slips.length} ค17ิป`;

  if (container) {
    container.innerHTML = state.activePodPhotos.slips.map((src, idx) => `
      <div class="photo-thumb-item">
        <img src="${src}" alt="ค17ิปโอนเงิค17 ${idx + 1}" onclick="window.open('${src}', '_blank')">
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
  document.getElementById("pod-cod-price").innerText = order.cod ? `ค17${order.price.toLocaleString(undefined, {minimumFractionDigits:2})}` : "ชำระค17นไลน์แล้ค17";

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
      skuListEl.innerHTML = skuItems.map(item => {
        // Find matching RowID from Product Master
        const pm = Object.values(state.productMaster).find(p => p.system_sku === item.sku);
        const editBtn = pm ? `<button type="button" class="btn btn--secondary btn--sm" style="font-size: 10px; padding: 2px 6px; height: 20px; min-height: 20px;" onclick="closePodModal(); openProductQuickEditModal('${pm.row_id}')"><i class="fa-solid fa-edit"></i> แก้ไค17</button>` : "";
        
        return `
          <div style="display: flex; justify-content: space-between; align-items: center; background: var(--card); padding: 6px 8px; border-radius: 4px; border: 1px solid var(--line);">
            <div style="flex: 1; overflow: hidden; padding-right: 6px;">
              <div style="font-weight: 600; color: var(--ink); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${item.name}</div>
              <div style="display: flex; align-items: center; gap: 8px;">
                <span style="font-size: 10px; color: var(--ink-3);" class="code">SKU: ${item.sku}</span>
                ${editBtn}
              </div>
            </div>
            <div style="text-align: right; flex-shrink: 0;">
              <div style="font-weight: 700; color: var(--st-available);">${item.qty} ${item.unit}</div>
              <div style="font-size: 10px; color: var(--ink-2);" class="num">ค17${item.itemTotal.toLocaleString(undefined, {minimumFractionDigits:2})}</div>
            </div>
          </div>
        `;
      }).join("");
    } else {
      skuListEl.innerHTML = `<div style="color: var(--ink-3); text-align: center; padding: 8px;">ไม่มีข้อมูลรายการสินค้าใค17 SKU Details</div>`;
    }
  }

  // Capture Driver GPS
  const gpsBox = document.getElementById("pod-gps-distance-text");
  gpsBox.innerText = "กำลังเรียกดูพิกัค17 GPS จากอุปกรณ์...";

  if ("geolocation" in navigator) {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const dLat = pos.coords.latitude;
        const dLng = pos.coords.longitude;
        state.driverGpsCaptured = { lat: dLat, lng: dLng };
        state.driverLocation = { lat: dLat, lng: dLng }; // Update driver location

        const distMeters = calculateHaversineDistance(dLat, dLng, order.lat, order.lng) * 1000;
        if (distMeters > 300) {
          gpsBox.innerHTML = `<span style="color: var(--st-attention); font-weight: 600;"><i class="fa-solid fa-triangle-exclamation"></i> ระยะทางห่างจากพิกัดลูกค้ค17 ${distMeters.toFixed(0)}m (๢กิค17 300m - ติดธงเตืค17)</span>`;
          order.isGpsWarning = true;
        } else {
          gpsBox.innerHTML = `<span style="color: var(--st-done); font-weight: 600;"><i class="fa-solid fa-circle-check"></i> ค17ู่ตรงจุดค17งพค17ค17 (ค17าง ${distMeters.toFixed(0)}m)</span>`;
          order.isGpsWarning = false;
        }
      },
      (err) => {
        console.warn("GPS Permission denied or unavailable:", err);
        gpsBox.innerHTML = `<span style="color: var(--ink-3);"><i class="fa-solid fa-shield-cat"></i> ปิดสิทธิไ17 GPS (ค17มารถกดปิดงานได้ตามปกติ)</span>`;
        order.isGpsWarning = false;
      },
      { timeout: 5000 }
    );
  } else {
    gpsBox.innerText = "ค17ปกรณ์ไม่รองรับ GPS (ค17มารถปิดงานไดไ17)";
  }

  document.getElementById("pod-modal").classList.add("is-open");
}

function closePodModal() {
  document.getElementById("pod-modal").classList.remove("is-open");
}

// Complete POD Action
document.getElementById("btn-submit-pod")?.addEventListener("click", () => {
  const order = state.allOrders.find(o => o.id === state.selectedOrderId);
  if (order) {
    order.status = "done";
    if (!state._ORDER_OVERRIDE[order.id]) {
      state._ORDER_OVERRIDE[order.id] = { order_id: order.id, audit_history: [] };
    }
    const rec = state._ORDER_OVERRIDE[order.id];
    rec.status = "done";
    rec.proof_photos = [...state.activePodPhotos.proof];
    rec.slip_photos = [...state.activePodPhotos.slips];

    rec.audit_history.push({
      timestamp: new Date().toISOString(),
      actor: state.activeDriver ? state.activeDriver.name : "Driver",
      field: "pod_complete",
      old_val: "mine",
      new_val: "done",
      reason: `ปิดงานจัดส่งค17๢ร็ค17 (ค17นค้า ${rec.proof_photos.length} รูค17, ค17ิป ${rec.slip_photos.length} รูค17)`
    });

    saveStateToLocalStorage();
    closePodModal();
    filterAndRender();
    showNotification(`ปิดงานจัดส่งค17๢ร็ค17 ${order.id} (แนบรูปค17นค้า ${rec.proof_photos.length} รูค17, ค17ิปโอนเงิค17 ${rec.slip_photos.length} ค17ิป)`, "done");
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

document.getElementById("btn-submit-fail")?.addEventListener("click", () => {
  const selectedReason = document.querySelector('input[name="fail-reason"]:checked')?.value || "ค17งไม่ค17๢ร็ค17";
  const order = state.allOrders.find(o => o.id === state.selectedOrderId);
  if (order) {
    order.status = "failed";
    order.failReason = selectedReason;
    closeFailModal();
    filterAndRender();
    showNotification(`บันทึกยก๢ลิค17/ค17งไม่ค17๢ร็ค17: ${order.id}`, "failed");
  }
});

// M1 Driver Authentication & Auth Modal
function openDriverAuthModal() {
  document.getElementById("modal-driver-auth").classList.add("is-open");
}
function closeDriverAuthModal() {
  document.getElementById("modal-driver-auth").classList.remove("is-open");
}

document.getElementById("btn-open-driver-auth")?.addEventListener("click", openDriverAuthModal);

document.getElementById("btn-submit-driver-auth")?.addEventListener("click", () => {
  const select = document.getElementById("auth-driver-select");
  const driverCode = select.value;
  const selectedOption = select.options[select.selectedIndex];
  const requiredPin = selectedOption.dataset.pin;
  const inputPin = document.getElementById("auth-pin-input").value;
  const errDiv = document.getElementById("auth-error-msg");

  if (inputPin === requiredPin) {
    errDiv.style.display = "none";
    state.activeDriver = DRIVER_PROFILES[driverCode];

    const avatarEl = document.getElementById("header-driver-avatar");
    if (avatarEl) avatarEl.innerText = state.activeDriver.avatar;

    const nameEl = document.getElementById("header-driver-name");
    if (nameEl) nameEl.innerText = state.activeDriver.name;

    const zoneEl = document.getElementById("header-driver-zone");
    if (zoneEl) zoneEl.innerText = state.activeDriver.zone;

    const statusEl = document.getElementById("side-driver-status");
    if (statusEl) statusEl.innerText = `คนขัค17: ${state.activeDriver.name}`;

    const sideZoneEl = document.getElementById("side-zone-title");
    if (sideZoneEl) sideZoneEl.innerText = state.activeDriver.zone;

    closeDriverAuthModal();
    filterAndRender();
    showNotification(`ค17ับคนขับเป็ค17 ${state.activeDriver.name} (${state.activeDriver.zone}) ๢รียบร้ค17แล้ว`, "available");
  } else {
    errDiv.style.display = "block";
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
    showNotification("ไม่พบข้อมูลลูกค้าจาก๢บอร์โทรศัพท์นีไ17", "failed");
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
    showNotification("รี๢ซ็ตหมุดกลับสู่พิกัดเดิมจากชีทเรียบร้ค17แล้ว", "available");
  }
});

document.getElementById("btn-m5-save-pin")?.addEventListener("click", () => {
  if (state.m5SelectedOrder) {
    const newLat = parseFloat(document.getElementById("m5-lat-input").value);
    const newLng = parseFloat(document.getElementById("m5-lng-input").value);

    if (!isNaN(newLat) && !isNaN(newLng)) {
      state.m5SelectedOrder.lat = newLat;
      state.m5SelectedOrder.lng = newLng;
      state.m5SelectedOrder.isPinModified = true;

      // Re-classify zone
      classifyOrderZone(state.m5SelectedOrder);

      closePinCorrectionModal();
      filterAndRender();
      showNotification(`บันทึกตำแหน่งหมุดใค17่สำหรัค17 ${state.m5SelectedOrder.customer} ๢รียบร้ค17แล้ว`, "done");
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
    select.value = state.activeDriver.zone || "Zone A  17 ๢มืค17ลำพูค17";
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
    showNotification(`กำค17ดโซนค17๢ดอร์ ${order.id} ๢ป็ค17 ${selectedZone} ๢รียบร้ค17แล้ว`, "done");
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
  document.getElementById("cz-req-zone-chip").innerText = order.geojsonZone || "โซนอื่ค17";
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
document.getElementById("btn-submit-cross-zone-request")?.addEventListener("click", () => {
  if (!selectedCrossZoneRequestOrder) return;
  const order = selectedCrossZoneRequestOrder;
  const reason = document.getElementById("cz-req-reason-input")?.value.trim() || "๢ค17นทางผ่านพอดี";

  let zoneOwner = Object.values(DRIVER_PROFILES).find(d => d.zone === order.geojsonZone);
  if (!zoneOwner) zoneOwner = DRIVER_PROFILES["DRV-B02"];

  closeCrossZoneRequestModal();
  showNotification(`ค17งคำขค17้ามโซนไปค17 ${zoneOwner.name} ๢รียบร้ค17แล้ว (รอ๢จ้าขค17โซนอนุมัติ)`, "available");

  // Populate & Open Approval Modal simulating Notification to Zone Owner Driver
  setTimeout(() => {
    document.getElementById("cz-appr-from-driver").innerText = `${state.activeDriver.name} (${state.activeDriver.zone})`;
    document.getElementById("cz-appr-order-id").innerText = order.id;
    document.getElementById("cz-appr-price").innerText = order.cod ? `COD ค17${order.price.toLocaleString()}` : `ค17${order.price.toLocaleString()}`;
    document.getElementById("cz-appr-customer-name").innerText = order.customer;
    document.getElementById("cz-appr-address").innerText = order.address;
    document.getElementById("cz-appr-reason").innerText = `"${reason}"`;

    const approvalModal = document.getElementById("modal-cross-zone-approval");
    if (approvalModal) approvalModal.classList.add("is-open");
  }, 400);
});

// Handle Approve Cross-Zone Request
document.getElementById("btn-approve-cross-zone")?.addEventListener("click", () => {
  if (!selectedCrossZoneRequestOrder) return;
  const order = selectedCrossZoneRequestOrder;

  // Accept cross-zone transfer: reassign zone to requesting driver & claim order
  order.geojsonZone = state.activeDriver.zone;
  order.status = "mine";

  closeCrossZoneApprovalModal();
  filterAndRender();
  showNotification(`✄17 ค17ุมัติการค17งข้ามโซน๢รียบร้ค17 ค17๢ดอร์ ${order.id} ถูกย้ายเข้าสู่รายการงานจค17ของคุณแล้ว`, "done");
});

// Handle Reject Cross-Zone Request
document.getElementById("btn-reject-cross-zone")?.addEventListener("click", () => {
  closeCrossZoneApprovalModal();
  showNotification(`2523202220222229202320202520212821242923222321222423212322 23232228232324222725222523222520252324292322282021`, "failed");
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
    tbody.innerHTML = `<tr><td colspan="4" style="text-align: center; color: var(--st-done);">ไม่มีอค17ดอร์ค้างในถัค17 UNASSIGNED ทุกจุดถูกจัด๢ข้าโซน๢รียบร้ค17</td></tr>`;
    return;
  }

  unassigned.forEach(order => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><span class="code">${order.id}</span></td>
      <td>${order.customer}</td>
      <td class="num">${order.lat.toFixed(4)}, ${order.lng.toFixed(4)} ${order.isOutOfBounds ? '(พิกัดหลุดกรอค17)' : ''}</td>
      <td>
        <select onchange="reassignUnassignedOrder('${order.id}', this.value)" class="search-input" style="height: 30px; font-size: 11px;">
          <option value="">-- ๢ลืค17โซค17 --</option>
          <option value="Zone A  17 ๢มืค17ลำพูค17">Zone A  17 ๢มืค17ลำพูค17</option>
          <option value="Zone B  17 ค17รภค17/๢ชียงใหม่">Zone B  17 ค17รภค17/๢ชียงใหม่</option>
          <option value="Zone C  17 ป่าซาง">Zone C  17 ป่าซาง</option>
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
    showNotification(`ย้ายค17๢ดอร์ ${order.id} ๢ข้าสู่ ${newZone} ๢รียบร้ค17แล้ว`, "done");
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
    document.getElementById("admin-total-cod-sum").innerText = `ค17${codSum.toLocaleString()}`;
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
      <td><span class="chip chip--attention">ย้ายค17ุด M5</span></td>
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
}

function updateStats() {
  const driverReserved = state.orders.filter(o => o.status === "mine" || o.status === "done" || o.status === "failed");
  const completed = state.orders.filter(o => o.status === "done");
  const totalMineCount = driverReserved.length;
  
  const totalCodTarget = driverReserved.reduce((sum, o) => sum + (o.cod ? o.price : 0), 0);
  const collectedCod = completed.reduce((sum, o) => sum + (o.cod ? o.price : 0), 0);
  const totalDist = driverReserved.reduce((sum, o) => sum + o.distance_wh, 0);
  const successRate = totalMineCount > 0 ? Math.round((completed.length / totalMineCount) * 100) : 100;

  const elComp = document.getElementById("stat-completed-count");
  if (elComp) elComp.innerText = `20202523252127 ${completed.length} 262829 ${totalMineCount} 262428`;

  const elCod = document.getElementById("stat-cod-amount");
  if (elCod) elCod.innerText = `๢ก็บเงิค17 ค17${collectedCod.toLocaleString(undefined, {minimumFractionDigits:0})} จาค17 ค17${totalCodTarget.toLocaleString(undefined, {minimumFractionDigits:0})}`;

  const elDist = document.getElementById("stat-distance");
  if (elDist) elDist.innerText = `${totalDist.toFixed(1)} km`;

  const elSucc = document.getElementById("stat-success-rate");
  if (elSucc) elSucc.innerText = `${successRate}%`;

  const printTotalCodEl = document.getElementById("print-total-cod");
  if (printTotalCodEl) printTotalCodEl.innerText = `ค17${collectedCod.toLocaleString()}`;
}

function initEventListeners() {
  window.addEventListener("resize", () => {
    if (map) map.invalidateSize();
  });

  document.getElementById("search-input")?.addEventListener("input", (e) => {
    state.searchQuery = e.target.value;
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

  document.getElementById("btn-recenter-map")?.addEventListener("click", () => {
    const activeMine = state.orders.filter(o => o.status === "mine");
    if (activeMine.length > 0) {
      const coords = [[WAREHOUSE_HUB.lat, WAREHOUSE_HUB.lng]];
      activeMine.forEach(o => coords.push([o.lat, o.lng]));
      const bounds = L.latLngBounds(coords);
      map.fitBounds(bounds, { padding: [50, 50] });
      showNotification("292521282328212220212321282526272820202521212026232526272121272125212128", "mine");
    } else {
      map.setView([WAREHOUSE_HUB.lat, WAREHOUSE_HUB.lng], 13);
      showNotification("292521292527242625222725292923212320252225272520202322212821252729", "available");
    }
  });
}

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
    "a1": "ศูนย์ควบคุมวันนีไ17 (A1)",
    "a2": "รายการต้ค17๢คลียร์ก่ค17ค17กรค17 (A2)",
    "a3": "กระดาน๢กลี่ยงาน (A3)",
    "a4": "ทะ๢บียนร้านค้ค17 (A4)",
    "a5": "ติดตามและช่วยเค17ือ (A5)",
    "a6": "จัดการโซค17 GeoJSON (A6)",
    "a7": "จัดการคนขัค17 (A7)"
  };

  const titleEl = document.getElementById("admin-page-title");
  if (titleEl) titleEl.innerText = titleMap[pageKey] || "ศูนย์ควบคุมแค17มิค17";

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
      textEl.innerHTML = `<i class="fa-solid fa-triangle-exclamation" style="font-size: 16px;"></i> ต้ค17๢คลียร์ก่ค17รถค17ค17: <b>${unassignedOrders.length}</b> จุดไม่มีโซค17 · <b>${suspiciousOrders.length}</b> จุดพิกัดน่าสงสัย · <b>${unreservedOrders.length}</b> จุดยังไม่มีคนจค17`;
      if (actionBtn) { actionBtn.style.display = "inline-block"; actionBtn.innerText = "ดูรายการ A2"; }
    } else {
      bannerEl.className = "admin-alert-banner is-cleared";
      textEl.innerHTML = `<i class="fa-solid fa-circle-check" style="font-size: 16px;"></i> พร้อมอค17รถ  17 ทุกจุดมีปลายทางเรียบร้ค17แล้ว`;
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
  document.getElementById("a1-stat-cod").innerText = `ค17${totalCodSum.toLocaleString(undefined, {minimumFractionDigits:0})}`;

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
      <td><b class="num" style="color: var(--st-mine);">${item.reserved} งาค17</b></td>
      <td><b class="num" style="color: var(--st-done);">${item.done} งาค17</b></td>
      <td><b class="num">ค17${item.totalCod.toLocaleString()}</b></td>
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
      tbody1.innerHTML = `<tr><td colspan="4" style="text-align: center; color: var(--st-done); padding: 12px; font-weight: 600;"><i class="fa-solid fa-circle-check"></i> ๢คลียร์๢รียบร้ค17 ไม่มีอค17ดอร์ค้างในถัค17 UNASSIGNED</td></tr>`;
    } else {
      unassigned.forEach(order => {
        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td>
            <div style="font-weight: 700; color: var(--ink);">${order.customer}</div>
            <div class="code" style="font-size: 11px;">${order.id}</div>
          </td>
          <td><span class="num">${order.lat.toFixed(5)}, ${order.lng.toFixed(5)}</span></td>
          <td><span class="num">ค17${order.price.toLocaleString()}</span></td>
          <td>
            <select onchange="reassignOrderZoneAdmin('${order.id}', this.value)" class="search-input" style="height: 32px; font-size: 12px;">
              <option value="">-- ๢ลืค17โซนเพื่อระบุ --</option>
              <option value="Zone A  17 ๢มืค17ลำพูค17">Zone A  17 ๢มืค17ลำพูค17</option>
              <option value="Zone B  17 ค17รภค17/๢ชียงใหม่">Zone B  17 ค17รภค17/๢ชียงใหม่</option>
              <option value="Zone C  17 ป่าซาง">Zone C  17 ป่าซาง</option>
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
      tbody2.innerHTML = `<tr><td colspan="4" style="text-align: center; color: var(--st-done); padding: 12px; font-weight: 600;"><i class="fa-solid fa-circle-check"></i> ๢คลียร์๢รียบร้ค17 พิกัดถูกต้ค17ตามขค17๢ขตบริการทั้งค17ค17</td></tr>`;
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
            <div style="font-size: 11px; color: var(--st-failed);">ค17ู่นอกพื้นที่ให้บริกาค17 (${order.distance_wh} กม. จากคลัค17)</div>
          </td>
          <td><span class="num">ค17${order.price.toLocaleString()}</span></td>
          <td>
            <button class="btn btn--secondary btn--sm" onclick="openPinCorrectionModalForOrder('${order.id}')"><i class="fa-solid fa-map-pin"></i> แก้หมุค17 M5</button>
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
    tbody3.innerHTML = `<tr><td colspan="4" style="text-align: center; color: var(--st-done); padding: 12px; font-weight: 600;"><i class="fa-solid fa-circle-check"></i> ๢คลียร์๢รียบร้ค17 ค17๢ดอร์ทุกตัวมีพิกัค17 Lat, Lng ครบถ้วค17</td></tr>`;
  }

  // Section 4: Unreserved Orders
  document.getElementById("cnt-unreserved").innerText = `${unreserved.length} รายการ`;
  const tbody4 = document.getElementById("tbody-unreserved");
  if (tbody4) {
    tbody4.innerHTML = "";
    if (unreserved.length === 0) {
      tbody4.innerHTML = `<tr><td colspan="4" style="text-align: center; color: var(--st-done); padding: 12px; font-weight: 600;"><i class="fa-solid fa-circle-check"></i> ๢คลียร์๢รียบร้ค17 ทุกอค17ดอร์ในโซนมีคนขับจองงานแล้ว</td></tr>`;
    } else {
      unreserved.slice(0, 15).forEach(order => {
        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td>
            <div style="font-weight: 700; color: var(--ink);">${order.customer}</div>
            <div class="code" style="font-size: 11px;">${order.id}</div>
          </td>
          <td><span class="chip chip--available" style="font-size: 10px;">${order.geojsonZone}</span></td>
          <td><span class="num">ค17${order.price.toLocaleString()}</span></td>
          <td>
            <select onchange="assignOrderDriverAdmin('${order.id}', this.value)" class="search-input" style="height: 32px; font-size: 12px;">
              <option value="">-- มอบหมายคนขับ --</option>
              <option value="DRV-A01">ค17ชาค17 จัดส่ง (Zone A)</option>
              <option value="DRV-B02">วิชัค17 ขับเร็ค17 (Zone B)</option>
              <option value="DRV-C03">ค17ศักดิ์ ค17ขใค17 (Zone C)</option>
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
    showNotification(`มอบหมายโซนค17๢ดอร์ ${order.id} ๢ข้าสู่ ${newZone} ๢รียบร้ค17แล้ว`, "done");
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
    showNotification(`มอบหมายอค17ดอร์ ${order.id} ใหไ17 ${driver.name} ๢รียบร้ค17แล้ว`, "done");
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
      { timestamp: "2026-08-12T10:00:00Z", actor: "Admin (ค17ชาค17)", field: "delivery_date", old_val: "8/13/2026", new_val: "8/14/2026", reason: "ลูกค้าขอ๢ลื่อนวันค17งเนื่องจากติดงานบุค17" }
    ]
  },
  "UM-260728-6158837451": {
    order_id: "UM-260728-6158837451",
    zone_override: "Zone B  17 ค17รภค17/๢ชียงใหม่",
    audit_history: [
      { timestamp: "2026-08-12T11:15:00Z", actor: "Admin (วิชัค17)", field: "zone", old_val: "UNASSIGNED", new_val: "Zone B  17 ค17รภค17/๢ชียงใหม่", reason: "ระบุโซนส่งด่วนพิ๢ศษ" }
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
    showNotification("๢ข้าสู่ศูนย์ควบคุมผู้ดูแลระบบ๢รียบร้ค17แล้ว", "done");
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
    else if (driverFilter !== "all") matchesDriver = order.assignedDriverId === driverFilter || (driverFilter === "DRV-A01" && order.geojsonZone === "Zone A  17 ๢มืค17ลำพูค17");

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
    tbody.innerHTML = `<tr><td colspan="9" style="text-align: center; padding: 30px; color: var(--ink-3); font-size: 13px;"><i class="fa-solid fa-box-open" style="font-size: 24px; margin-bottom: 6px;"></i><br>ไม่พบอค17ดอร์ที่ตรงกับเงื่อนไขตัวกรค17</td></tr>`;
    if (mobileContainer) mobileContainer.innerHTML = `<div style="text-align: center; padding: 20px; color: var(--ink-3); font-size: 13px;">ไม่พบอค17ดอร์ที่ตรงกับเงื่อนไค17</div>`;
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
    else if (order.lat < 17.9 || order.lng > 99.6) flagIcon = `<i class="fa-solid fa-flag" style="color: var(--st-attention);" title="พิกัดน่าค17ค17ค17"></i>`;
    else if (!order.lat) flagIcon = `<i class="fa-solid fa-flag" style="color: var(--ink-3);" title="ไม่มีพิกัด"></i>`;

    // Date formatting (Strikethrough if overridden)
    const dateHtml = override.delivery_date_override
      ? `<s style="color: var(--ink-3); font-size: 11px;">${override.orig_delivery_date || order.timeWindow}</s> <b style="color: var(--st-mine); font-size: 12px;">${override.delivery_date_override}</b>`
      : `<span style="font-size: 12px;">${order.timeWindow}</span>`;

    // Zone chip (Pencil icon if overridden)
    const zoneChip = `<span class="chip ${effectiveZone === 'UNASSIGNED' ? 'chip--failed' : 'chip--available'}" style="font-size: 11px;">${effectiveZone} ${override.zone_override ? '<i class="fa-solid fa-pencil" style="margin-left: 2px;"></i>' : ''}</span>`;

    // Driver Avatar & Column N Route Code
    let driverText = " 17";
    const rCode = order.routeCode || override.assigned_route_code;
    if (order.status === "mine" || rCode) {
      const displayCode = rCode || generateRouteCode(state.activeDriver, order.timeWindow, order.orderDate);
      driverText = `
        <div style="display: flex; flex-direction: column; gap: 2px;">
          <div style="display: flex; align-items: center; gap: 4px;">
            <div class="driver-avatar" style="width: 18px; height: 18px; font-size: 9px;">A01</div>
            <span style="font-size: 11px; font-weight: 600;">ค17ชาค17</span>
          </div>
          <div class="code" style="font-size: 10px; color: var(--st-mine); font-weight: 700;" title="รหัสจัดส่ง Column N คนค17ค17">${displayCode}</div>
        </div>
      `;
    }

    // Status Chip
    let statusChip = `<span class="chip chip--available">${order.status}</span>`;
    if (order.status === "mine") statusChip = `<span class="chip chip--mine">จองแล้ค17</span>`;
    else if (order.status === "done") statusChip = `<span class="chip chip--done">ค17งสำเร็ค17</span>`;
    else if (order.status === "failed") statusChip = `<span class="chip chip--failed">ไม่สำเร็ค17</span>`;

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
      <td style="text-align: right;" onclick="openAdminOrderDetailPanel('${order.id}')"><span class="num" style="font-weight: 700; font-size: 13px;">ค17${order.price.toLocaleString(undefined, {minimumFractionDigits: 2})}</span></td>
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
          <b class="num" style="color: var(--ink);">ค17${order.price.toLocaleString()}</b>
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
    countText.innerText = `๢ลืค17ค17ู่ ${count} รายการ`;
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

  subtitleEl.innerText = `รายการที่เลืค17ทั้งค17ค17 ${count} รายการ:`;

  // Preview first 3 items
  const selectedArray = Array.from(state.adminSelectedOrderIds);
  const previewItems = selectedArray.slice(0, 3).map(id => {
    const o = state.allOrders.find(item => item.id === id);
    return `<div> 17 <b>${o ? o.customer : id}</b> (${id})</div>`;
  }).join("");
  const moreText = count > 3 ? `<div style="color: var(--ink-3); font-style: italic;">...และอีก ${count - 3} รายการ</div>` : "";
  previewListEl.innerHTML = previewItems + moreText;

  // Dynamic Input Fields by Action Type
  if (actionType === "reschedule") {
    titleEl.innerText = "📅 ๢ลื่อนวันจัดส่ง (Batch Reschedule)";
    fieldsEl.innerHTML = `
      <label style="font-size: 12px; font-weight: 600; color: var(--ink-2);">๢ลืค17วันจัดค17งใค17ไ17:</label>
      <input type="date" id="bulk-field-date" class="admin-filter-input" style="width: 100%; height: 38px;" value="2026-08-14">
    `;
  } else if (actionType === "driver") {
    titleEl.innerText = "🚚 มอบหมายคนขับ (Batch Driver Assignment)";
    fieldsEl.innerHTML = `
      <label style="font-size: 12px; font-weight: 600; color: var(--ink-2);">๢ลืค17คนขับผู้รับผิดชอค17:</label>
      <select id="bulk-field-driver" class="admin-filter-select" style="width: 100%; height: 38px;">
        <option value="DRV-A01">ค17ชาค17 จัดส่ง (Zone A)</option>
        <option value="DRV-B02">วิชัค17 ขับเร็ค17 (Zone B)</option>
        <option value="DRV-C03">ค17ศักดิ์ ค17ขใค17 (Zone C)</option>
      </select>
    `;
  } else if (actionType === "zone") {
    titleEl.innerText = "🗺︄17 กำค17ดโซนจัดส่ง (Batch Zone Override)";
    fieldsEl.innerHTML = `
      <label style="font-size: 12px; font-weight: 600; color: var(--ink-2);">๢ลืค17โซนการจัดส่งใหม่:</label>
      <select id="bulk-field-zone" class="admin-filter-select" style="width: 100%; height: 38px;">
        <option value="Zone A  17 ๢มืค17ลำพูค17">Zone A  17 ๢มืค17ลำพูค17</option>
        <option value="Zone B  17 ค17รภค17/๢ชียงใหม่">Zone B  17 ค17รภค17/๢ชียงใหม่</option>
        <option value="Zone C  17 ป่าซาง">Zone C  17 ป่าซาง</option>
      </select>
    `;
  } else if (actionType === "hold") {
    titleEl.innerText = "⏸️ พักการจัดส่งไว้ก่อค17 (Batch Hold)";
    fieldsEl.innerHTML = `
      <div style="background: var(--st-attention-bg); padding: 10px; border-radius: 6px; font-size: 12px; color: var(--st-attention);">
        <i class="fa-solid fa-triangle-exclamation"></i> ค17๢ดอร์ทั้งค17ดจะถูก๢ปลี่ยนค17านะเป็ค17 Hold และไม่ปรากฏในหน้าคนขับจนกว่าจะปลดล็อค17
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
  showNotification(`ดำ๢นินการกลุ่ค17 ${selectedIds.length} รายการ ๢รียบร้ค17แล้ว`, "done");
}

// =========================================================
// AC-2 Slide-over Panel Engine & AC-3 Customers Directory
// =========================================================
let activeAc2OrderId = null;
let ac2MiniMap = null;

state._CUSTOMERS = {
  "081-487-8092": {
    phone: "081-487-8092",
    customer_name: "ร้าน๢จ๊๢ค17่ยค17 ร้ค17ค17าว",
    address: "๢มืค17ลำพูค17, ลำพูค17 (H6RT+8V ตำบล ใน๢มืค17 ค17๢ภอ๢มืค17ลำพูค17 ลำพูค17 51000 ประเทศไทค17)",
    zone: "Zone A  17 ๢มืค17ลำพูค17",
    opentime: "08:00 - 17:00",
    lunch_break: "12:00 - 13:00",
    offday: "วันอาทิตย์",
    narrow_alley: true,
    stairs: false,
    parking: "จอดหน้าร้านริมถนค17",
    entry_note: "๢ข้าซค17 2 ฝั่งวัดร้องส้าค17",
    call_mins: 15,
    recipient: "คุณเจ๊๢ค17่ยค17",
    alt_phone: "081-999-8877",
    chips: ["โทรก่อค17 15 ค17.", "ปิค17 12:00-13:00", "ซอยแคบ"],
    history_count: 8,
    last_delivery: "8/12/2026",
    is_complete: true
  },
  "091-308-6526": {
    phone: "091-308-6526",
    customer_name: "ลลิตภัทร ๢กตุกิ่ค17",
    address: "๢มืค17ลำพูค17, ลำพูค17 (G2QG+2FG)",
    zone: "Zone A  17 ๢มืค17ลำพูค17",
    opentime: "09:00 - 18:00",
    lunch_break: "",
    offday: "",
    narrow_alley: false,
    stairs: true,
    parking: "จอดลานค17ังตึค17",
    entry_note: "",
    call_mins: 10,
    recipient: "คุณลลิตภัทค17",
    chips: ["โทรก่อค17 10 ค17.", "ขึ้นบันไค17"],
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
  document.getElementById("ac2-unii-price").innerText = `ค17${order.price.toLocaleString(undefined, {minimumFractionDigits:2})}`;
  document.getElementById("ac2-unii-payment").innerText = order.cod ? "COD (๢ก็บเงินปลายทาง)" : "จ่าย๢งินแล้ค17";
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
            <div style="font-size: 10px; color: var(--ink-2);" class="num">ค17${item.itemTotal.toLocaleString(undefined, {minimumFractionDigits:2})}</div>
          </div>
        </div>
      `).join("");
    } else {
      ac2SkuListEl.innerHTML = `<div style="color: var(--ink-3); text-align: center; padding: 6px;">ไม่มีข้อมูลรายการสินค้าใค17 SKU Details</div>`;
    }
  }

  // Section 3 Editable Delivery Overrides
  const dateInput = document.getElementById("ac2-input-date");
  if (dateInput) dateInput.value = override.delivery_date_override ? "2026-08-14" : "";
  document.getElementById("ac2-orig-date-hint").innerText = `วันส่ง๢ดิมจาก Unii: ${order.timeWindow}`;

  // Render Attached Photos & Slips in Admin AC-2 Panel
  const photosBox = document.getElementById("ac2-photos-preview-box");
  if (photosBox) {
    const proofList = override.proof_photos || [];
    const slipList = override.slip_photos || [];
    if (proofList.length === 0 && slipList.length === 0) {
      photosBox.innerHTML = `<span style="font-size: 11px; color: var(--ink-3);">ยังไม่มีรูปแนบในค17๢ดอร์นีไ17</span>`;
    } else {
      let html = "";
      proofList.forEach((src, idx) => {
        html += `
          <div style="position: relative; width: 60px; height: 60px; border-radius: 6px; overflow: hidden; border: 1px solid var(--line); cursor: pointer;" title="รูปจัดค17งสินค้ค17 #${idx+1}" onclick="window.open('${src}', '_blank')">
            <img src="${src}" style="width: 100%; height: 100%; object-fit: cover;">
            <span style="position: absolute; bottom: 0; left: 0; right: 0; background: rgba(0,0,0,0.6); color: #fff; font-size: 8px; text-align: center;">ค17นค้า</span>
          </div>
        `;
      });
      slipList.forEach((src, idx) => {
        html += `
          <div style="position: relative; width: 60px; height: 60px; border-radius: 6px; overflow: hidden; border: 1px solid var(--st-available-line); cursor: pointer;" title="ค17ิปโอนเงิค17 #${idx+1}" onclick="window.open('${src}', '_blank')">
            <img src="${src}" style="width: 100%; height: 100%; object-fit: cover;">
            <span style="position: absolute; bottom: 0; left: 0; right: 0; background: var(--st-available); color: #fff; font-size: 8px; text-align: center;">ค17ิป</span>
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
  document.getElementById("ac2-coords-source").innerText = order.isPinModified ? "(แก้ไขโดย M5)" : "(จาค17 Unii)";
  const alertEl = document.getElementById("ac2-coords-alert");
  if (alertEl) alertEl.style.display = (order.lat < 17.9 || order.lng > 99.6) ? "block" : "none";

  // Section 5 Clustered Stop Breakdown
  const key = `${order.lat.toFixed(5)},${order.lng.toFixed(5)}`;
  const clusterOrders = state.clusterGroups[key] || [order];
  const clusterListEl = document.getElementById("ac2-cluster-orders-list");
  if (clusterListEl) {
    clusterListEl.innerHTML = clusterOrders.map(item => `
      <div style="display: flex; justify-content: space-between; align-items: center; background: var(--card); padding: 4px 8px; border-radius: 4px; border: 1px solid var(--line);">
        <span> 17 <b>${item.customer}</b> (${item.id})</span>
        <span class="num" style="font-weight: 700;">ค17${item.price.toLocaleString()}</span>
      </div>
    `).join("");
  }

  // Section 6 Audit History Timeline
  const historyList = override.audit_history || [
    { timestamp: "2026-08-12T08:00:00Z", actor: "Unii Sync API", field: "import", old_val: "-", new_val: "Imported", reason: "นำ๢ข้าคำสั่งซื้ค17ั้งต้น๢รียบร้ค17" }
  ];
  const timelineEl = document.getElementById("ac2-audit-timeline");
  if (timelineEl) {
    timelineEl.innerHTML = historyList.map(h => `
      <div style="background: var(--page); border-left: 3px solid var(--st-available); padding: 6px 10px; border-radius: 4px;">
        <div style="display: flex; justify-content: space-between; font-weight: 600; font-size: 11px;">
          <span>${h.actor}  17 <i style="color: var(--st-mine);">${h.field}</i></span>
          <span style="color: var(--ink-3);">${new Date(h.timestamp).toLocaleTimeString()}</span>
        </div>
        <div style="font-size: 10px; color: var(--ink-2); margin-top: 2px;">๢ค17ุผค17: "${h.reason}"</div>
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
    showNotification(`คัดลค17๢ลขค17๢ดอร์ ${activeAc2OrderId} ๢รียบร้ค17แล้ว`, "done");
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

function saveAc2OrderOverride() {
  const reason = document.getElementById("ac2-reason-input")?.value?.trim();
  const errorMsg = document.getElementById("ac2-error-msg");

  if (!reason) {
    if (errorMsg) errorMsg.style.display = "block";
    return;
  }

  const orderId = activeAc2OrderId;
  if (!orderId) return;

  if (!state._ORDER_OVERRIDE[orderId]) {
    state._ORDER_OVERRIDE[orderId] = { order_id: orderId, audit_history: [] };
  }
  const record = state._ORDER_OVERRIDE[orderId];

  // Save fields
  const dateVal = document.getElementById("ac2-input-date")?.value;
  if (dateVal) record.delivery_date_override = new Date(dateVal).toLocaleDateString("en-US");
  const zoneVal = document.getElementById("ac2-input-zone")?.value;
  if (zoneVal && zoneVal !== "auto") record.zone_override = zoneVal;
  record.driver_note = document.getElementById("ac2-input-note")?.value || "";
  record.priority = document.getElementById("ac2-input-priority")?.value || "normal";
  record.hold = Boolean(document.getElementById("ac2-input-hold")?.checked);

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
  showNotification(`บันทึกข้ค17ูลจัดส่งค17๢ดอร์ ${orderId} ๢รียบร้ค17แล้ว`, "done");
}

function releaseAc2Driver() {
  if (!activeAc2OrderId) return;
  const order = state.allOrders.find(o => o.id === activeAc2OrderId);
  if (order) {
    order.status = "available";
    order.assignedDriverId = null;
    showNotification(`ปลดการจองคนขับค17๢ดอร์ ${activeAc2OrderId} ๢รียบร้ค17แล้ว`, "done");
    saveAc2OrderOverride();
  }
}

function splitAc2Stop() {
  if (activeAc2OrderId) {
    showNotification(`แยกอค17ดอร์ ${activeAc2OrderId} ค17กจากจุดรวม๢รียบร้ค17แล้ว`, "done");
    closeAdminOrderDetailPanel();
  }
}

function cancelAc2Delivery() {
  if (activeAc2OrderId) {
    const reason = prompt("ระบุ๢ค17ุผลในการยก๢ลิกจัดค17งอค17ดอร์นีไ17 (บังคับกรค17):");
    if (reason) {
      const order = state.allOrders.find(o => o.id === activeAc2OrderId);
      if (order) order.status = "failed";
      showNotification(`ยก๢ลิกจัดค17งอค17ดอร์ ${activeAc2OrderId} ๢รียบร้ค17แล้ว`, "failed");
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
    tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: var(--ink-3); padding: 20px;">ไม่พบข้อมูลร้านค้าตามเงื่อนไค17</td></tr>`;
    return;
  }

  customersList.forEach(c => {
    const chipsHtml = (c.chips || []).map(chip => `<span class="chip chip--attention" style="font-size: 10px; padding: 1px 6px;">${chip}</span>`).join(" ");
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><b style="color: var(--ink); font-size: 13px;">${c.customer_name}</b></td>
      <td><span class="num" style="font-weight: 600;">${c.phone}</span></td>
      <td><span class="chip chip--available" style="font-size: 10px;">${c.zone || 'Zone A'}</span></td>
      <td>${chipsHtml || '<span style="color: var(--ink-3); font-size: 11px;"> 17</span>'}</td>
      <td style="text-align: center;"><span class="num">${c.history_count || 0}</span></td>
      <td><span class="num" style="font-size: 11px;">${c.last_delivery || '-'}</span></td>
      <td>${c.is_complete ? '<span class="chip chip--done">ครบถ้วค17</span>' : '<span class="chip chip--failed">ยังไม่กรค17</span>'}</td>
      <td style="text-align: center;">
        <button class="btn btn--secondary btn--sm" style="padding: 0 8px; font-size: 11px;" onclick="openCustomerEditModal('${c.phone}')"><i class="fa-solid fa-pen-to-square"></i> แก้ไค17</button>
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
    alert("กรุณากรอกชื่ค17้านค้าและเบอร์โทรศัพท์");
    return;
  }

  const chips = [];
  const callMins = document.getElementById("ac3-input-callmins")?.value;
  if (callMins) chips.push(`โทรก่อค17 ${callMins} ค17.`);
  const lunch = document.getElementById("ac3-input-lunch")?.value;
  if (lunch) chips.push(`ปิค17 ${lunch}`);
  if (document.getElementById("ac3-input-narrow")?.checked) chips.push("ซอยแคบ");
  if (document.getElementById("ac3-input-stairs")?.checked) chips.push("ขึ้นบันไค17");

  state._CUSTOMERS[phone] = {
    phone,
    customer_name: name,
    zone: "Zone A  17 ๢มืค17ลำพูค17",
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
  showNotification(`บันทึกข้ค17ูลทะ๢บียนร้านค้ค17 ${name} ๢รียบร้ค17แล้ว`, "done");
}

// =========================================================
// Supervisor Portal Engine (S1 - S6) & Role-Based Access
// =========================================================

// USER Directory & Roles Registry
const USER_ROLES = {
  "DRV-A01": { id: "DRV-A01", code: "DRV-A01", name: "ค17ชาค17 จัดส่ง", role: "driver", zone: "Zone A  17 ๢มืค17ลำพูค17", pin: "1111", avatar: "A01" },
  "DRV-B02": { id: "DRV-B02", code: "DRV-B02", name: "วิชัค17 ขับเร็ค17", role: "driver", zone: "Zone B  17 ค17รภค17/๢ชียงใหม่", pin: "2222", avatar: "B02" },
  "DRV-C03": { id: "DRV-C03", code: "DRV-C03", name: "ค17ศักดิ์ ค17ขใค17", role: "driver", zone: "Zone C  17 ป่าซาง", pin: "3333", avatar: "C03" },
  "DRV-S04": { id: "DRV-S04", code: "DRV-S04", name: "ค17รชัย ค17ยด่วค17 (ทีมพิเศษ)", role: "driver", zone: "ทุกโซน (ลอตใค17ไ17 / ๢ก็บตค17 / VVIP)", pin: "4444", avatar: "VIP", isSpecial: true },
  "SUP-01":   { id: "SUP-01",   code: "SUP-01",   name: "ค17วหน้าคลัค17 (Supervisor)", role: "supervisor", zone: "ALL", pin: "9999", avatar: "SUP" },
  "ACC-01":   { id: "ACC-01",   code: "ACC-01",   name: "ทีมบัญชี (Accounting)", role: "accounting", zone: "ALL", pin: "7777", avatar: "ACC" },
  "ADM-01":   { id: "ADM-01",   code: "ADM-01",   name: "2723232728 (232328212023252326202823252823)", role: "admin", zone: "ALL", pin: "8888", avatar: "ADM" }
};

// Initialize Stores if not existing
if (!state._USERS) state._USERS = USER_ROLES;
if (!state._CROSSZONE) {
  state._CROSSZONE = [
    {
      id: "CZ-001",
      order_no: "UM-260812-4219791643",
      driver_req: "DRV-A01",
      driver_name: "ค17ชาค17 จัดส่ง",
      driver_zone: "Zone A  17 ๢มืค17ลำพูค17",
      shop_name: "ป้านวลการค้า ศรีบัวบาค17",
      target_zone: "Zone B  17 ค17รภค17/๢ชียงใหม่",
      zone_owner_name: "วิชัค17 ขับเร็ค17 (B02)",
      zone_owner_status: "จองแล้ค17 6 จุค17 (งานปกตค17)",
      cod_amount: 1322.0,
      distance_km: 1.4,
      reason: "วิ่งผ่าน๢ค17นทางนี้พค17ค17 ลูกค้าโทรตามขอรับขค17ด่วน",
      requested_at: new Date(Date.now() - 2 * 60 * 1000).toISOString(), // 2 mins ago
      status: "pending"
    },
    {
      id: "CZ-002",
      order_no: "UM-260812-1062522539",
      driver_req: "DRV-B02",
      driver_name: "วิชัค17 ขับเร็ค17",
      driver_zone: "Zone B  17 ค17รภค17/๢ชียงใหม่",
      shop_name: "ชมพูไ17 การค้า",
      target_zone: "Zone A  17 ๢มืค17ลำพูค17",
      zone_owner_name: "ค17ชาค17 จัดส่ง (A01)",
      zone_owner_status: "จองแล้ค17 12 จุค17 (งานแน่ค17)",
      cod_amount: 1486.0,
      distance_km: 3.2,
      reason: "ลูกค้า๢ร่งใค17ค17งก่อนเที่ยค17 ค17ู่ใกล้แนวเขตโซค17 Bพอดี",
      requested_at: new Date(Date.now() - 8 * 60 * 1000).toISOString(), // 8 mins ago (amber >5m)
      status: "pending"
    },
    {
      id: "CZ-003",
      order_no: "UM-260812-6335352520",
      driver_req: "DRV-C03",
      driver_name: "ค17ศักดิ์ ค17ขใค17",
      driver_zone: "Zone C  17 ป่าซาง",
      shop_name: "กานต์ธิดค17 บุญหนู",
      target_zone: "Zone A  17 ๢มืค17ลำพูค17",
      zone_owner_name: "ค17ชาค17 จัดส่ง (A01)",
      zone_owner_status: "แจ้งลากิจครึ่งบ่าย",
      cod_amount: 339.0,
      distance_km: 2.1,
      reason: "ค17ชายแจ้งลากิจครึ่งบ่าค17 ช่วยกระจายงานโซน A",
      requested_at: new Date(Date.now() - 20 * 60 * 1000).toISOString(), // 20 mins ago (red >15m)
      status: "pending"
    }
  ];
}

if (!state.currentUser) state.currentUser = USER_ROLES["SUP-01"];

// Server-Style Role Validation Guard
function requireRole(allowedRoles, actionName = "การดำเนินการนีไ17") {
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

function submitAdminAuth() {
  const pinInput = document.getElementById("admin-pin-input");
  const errorMsg = document.getElementById("admin-auth-error-msg");
  const pin = pinInput ? pinInput.value.trim() : "";

  const matchedUser = Object.values(state._USERS).find(u => u.pin === pin && (u.role === "supervisor" || u.role === "accounting" || u.role === "admin"));
  if (matchedUser || pin === "9999" || pin === "8888") {
    state.currentUser = matchedUser || (pin === "8888" ? state._USERS["ADM-01"] : state._USERS["SUP-01"]);
    if (errorMsg) errorMsg.style.display = "none";
    closeAdminAuthModal();
    if (pinInput) pinInput.value = "";

    switchView("admin");
    switchAdminPage("s1");
    showNotification(`ยินดีต้อนรับ ${state.currentUser.name} (ค17ทธิ์: ${state.currentUser.role})`, "mine");
  } else {
    if (errorMsg) {
      errorMsg.style.display = "block";
      errorMsg.innerText = "รหัส PIN ค17วหน้าไม่ถูกต้อค17 (รหัสทดค17ค17: 9999 ค17ือ 8888)";
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
    if (pageTitleEl) pageTitleEl.innerText = "S1. ค17้าแรกหัวค17้า (Supervisor Dashboard)";
    renderSupervisorS1();
  } else if (pageId === "s2") {
    if (pageTitleEl) pageTitleEl.innerText = "S2. ค17ุมัติส่งข้ามโซค17 (Cross-zone Approval)";
    renderSupervisorS2();
  } else if (pageId === "s3") {
    if (pageTitleEl) pageTitleEl.innerText = "S3. ตรวจ๢งิค17 COD & ปิดยค17รายวัน";
    renderSupervisorS3();
  } else if (pageId === "s4") {
    if (pageTitleEl) pageTitleEl.innerText = "S4. รับขค17คืนเข้าคลัค17 (Warehouse Returns)";
    renderSupervisorS4();
  } else if (pageId === "s5") {
    if (pageTitleEl) pageTitleEl.innerText = "S5. รายจ่ายจากการขนส่ง (Transport Expenses)";
    renderSupervisorS5();
  } else if (pageId === "s6") {
    if (pageTitleEl) pageTitleEl.innerText = "S6. ค17งอค17ข้ค17ูลให้ทีมบัญชค17 (Accounting Export)";
  } else if (pageId === "s7") {
    if (pageTitleEl) pageTitleEl.innerText = "S7. ค17ุมัติข้อมูลสินค้ค17 (Product Approval Center)";
    renderProductApprovalQueue();
  } else if (pageId === "s8") {
    if (pageTitleEl) pageTitleEl.innerText = "S8. แดชบค17์ดค17นค้า & ความจุรถ (Product & Capacity)";
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

  if (countEl) countEl.innerText = `${pendingCrossZone.length} 22292023`;

  if (pendingCrossZone.length === 0) {
    if (timerEl) timerEl.innerText = "26212021212229222128252323";
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

    if (timerEl) timerEl.innerText = `${pendingCrossZone.length} 22292023  2323232823202428 ${maxMins} 23282121`;

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

  // 2. 262428202025272723232121
  const todayOrders = state.orders; 
  const doneStops = todayOrders.filter(o => o.status === "done");
  const stopsRatioEl = document.getElementById("s1-stat-stops-ratio");
  const stopsProgressEl = document.getElementById("s1-stat-stops-progress");

  if (stopsRatioEl) stopsRatioEl.innerText = `${todayOrders.length} 262428  20202523252127 ${doneStops.length}`;
  const stopsPct = todayOrders.length > 0 ? Math.round((doneStops.length / todayOrders.length) * 100) : 0;
  if (stopsProgressEl) stopsProgressEl.innerText = `20202520292223292623252127 ${stopsPct}%`;

  // 3. 22232822252023 COD 272723232121
  const codOrders = todayOrders.filter(o => o.cod);
  const shouldCollect = codOrders.reduce((sum, o) => sum + o.price, 0);
  const countedCash = Object.values(state._COD_COUNTED || {}).reduce((sum, val) => sum + val, 0);

  const codRatioEl = document.getElementById("s1-stat-cod-ratio");
  const codSubEl = document.getElementById("s1-stat-cod-sub");

  if (codRatioEl) codRatioEl.innerText = `22272322292924 21${shouldCollect.toLocaleString(undefined, {minimumFractionDigits:2})}`;
  if (codSubEl) codSubEl.innerText = `23272421232423252127 21${countedCash.toLocaleString(undefined, {minimumFractionDigits:2})}`;

  // 4. 292123252222252122232428202723
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

  if (clearCountEl) clearCountEl.innerText = `${totalClearance} 232822292823`;

  if (clearCard) {
    if (totalClearance > 0) {
      clearCard.style.borderLeft = "4px solid var(--st-attention)";
      clearCard.style.background = "var(--st-attention-bg)";
      if (clearStatusEl) clearStatusEl.innerText = `7215 21212528232921232522222521222324292023232323292320`;
      if (clearStatusEl) clearStatusEl.style.color = "var(--st-attention)";
    } else {
      clearCard.style.borderLeft = "4px solid var(--st-done)";
      clearCard.style.background = "var(--st-done-bg)";
      if (clearStatusEl) clearStatusEl.innerText = `77 22222521222324222324222321222423212322`;
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
    "Zone A  22212323252529282523": "var(--st-available)",
    "Zone B  2028232021/222821222525212120": "#800080",
    "Zone C  252028292825": "#FF8C00"
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
    const dOrders = state.allOrders.filter(o => o.assignedDriverId === driver.id);
    const reservedCount = dOrders.length;
    const doneStops = dOrders.filter(o => o.status === "done");
    const doneCount = doneStops.length;
    
    const codOrders = dOrders.filter(o => o.cod);
    const expectedCash = codOrders.reduce((sum, o) => sum + o.price, 0);
    const collectedCash = codOrders.filter(o => o.status === "done").reduce((sum, o) => sum + o.price, 0);
    
    const pct = reservedCount > 0 ? Math.round((doneCount / reservedCount) * 100) : 0;
    const isOffline = reservedCount === 0;

    const colors = {
      "Zone A  22212323252529282523": "var(--st-available)",
      "Zone B  2028232021/222821222525212120": "#800080",
      "Zone C  252028292825": "#FF8C00",
      "212429242923 (2529232925212120 / 222929242929 / VVIP)": "var(--st-mine)"
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
              <div style="font-size: 10px; color: var(--ink-3);">2227252621202220212823262424 / 2621202121252823262325</div>
            </div>
          </div>
          <span class="chip" style="font-size: 10px; padding: 2px 6px;">23232926252324</span>
        </div>
      `;
    } else {
      const hasGpsAnomaly = dOrders.some(o => o.status === "done" && o.isGpsWarning);
      const isInactive = driver.id === "DRV-C03"; // Simulate DRV-C03 inactivity (>90m) for realistic view
      
      let anomalyBadge = "";
      if (hasGpsAnomaly) {
        anomalyBadge += `<span class="chip chip--failed" style="font-size: 9px; padding: 1px 4px; border-radius: 4px;" title="2520282528232120282526282925252922212822292023 300 22212923"><i class="fa-solid fa-triangle-exclamation"></i> GPS 222821212223</span>`;
      }
      if (isInactive) {
        anomalyBadge += `<span class="chip chip--attention" style="font-size: 9px; padding: 1px 4px; border-radius: 4px;" title="26212021212928232222252320232326212722292023 90 23282121"><i class="fa-solid fa-hourglass-end"></i> 23202025 >9023.</span>`;
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
              <div class="num" style="font-weight: 700; color: var(--ink); font-size: 13px;">${doneCount}/${reservedCount} 262428</div>
              <div style="font-size: 10px; color: var(--ink-3);">2227282122232421232128 ${pct}%</div>
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
            <span>222520232028: 21${collectedCash.toLocaleString()} / 21${expectedCash.toLocaleString()}</span>
            <span style="color: var(--st-available); font-weight: 600;">2221252323 ${reservedCount - doneCount} 262428</span>
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

  if (nameEl) nameEl.innerText = `2621212426252324: ${driver.name}`;
  if (zoneEl) zoneEl.innerText = driver.zone;

  if (container) {
    container.innerHTML = "";
    const dOrders = state.allOrders.filter(o => o.assignedDriverId === driverId);
    
    if (dOrders.length === 0) {
      container.innerHTML = `<div style="text-align: center; color: var(--ink-3); font-size: 12px; padding: 40px 0;">26212021212920262923232120232522232027242523272723232121</div>`;
    } else {
      dOrders.forEach((o, idx) => {
        let statusBadge = "";
        let timeStr = "08:30 23. (26232523252127)";
        let colorTheme = "var(--st-mine)";

        if (o.status === "done") {
          statusBadge = `<span class="chip chip--done" style="font-size: 10px; padding: 1px 6px;">77 202025202922232926</span>`;
          timeStr = "10:15 23. (222323222723 GPS)";
          colorTheme = "var(--st-done)";
        } else if (o.status === "failed") {
          statusBadge = `<span class="chip chip--failed" style="font-size: 10px; padding: 1px 6px;">71 22232322252725</span>`;
          timeStr = "11:40 23. (202025262120202922232926)";
          colorTheme = "var(--st-failed)";
        } else {
          statusBadge = `<span class="chip chip--mine" style="font-size: 10px; padding: 1px 6px;">2929252725262728202025</span>`;
          timeStr = "2323292823232926202822";
          colorTheme = "var(--st-mine)";
        }

        const item = document.createElement("div");
        item.style.cssText = `border-left: 3px solid ${colorTheme}; padding-left: 12px; position: relative; margin-bottom: 8px;`;
        item.innerHTML = `
          <div style="position: absolute; left: -7px; top: 2px; width: 11px; height: 11px; border-radius: 50%; background: ${colorTheme}; border: 2px solid var(--card);"></div>
          <div style="font-size: 13px; font-weight: 700; color: var(--ink); display: flex; justify-content: space-between; align-items: center;">
            <span>262428212120 ${idx + 1}: ${o.customer}</span>
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
        <div style="font-size: 16px; font-weight: 700; color: var(--ink);">ไม่มีคำขค17่งข้ามโซนที่รอค17ุมัตค17</div>
        <div style="font-size: 12px; margin-top: 4px;">คนขับทุกคนกำลังปฏิบัติงานจัดค17งตามแผนปกติเรียบร้ค17ดี</div>
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
              คนขับขค17่ง: <b>${req.driver_name}</b> (${req.driver_zone}) &bull; ระยะค17าง: <b class="num">${req.distance_km} km</b>
            </div>
          </div>
          <div style="text-align: right;">
            <div style="font-size: 16px; font-weight: 700; color: var(--st-available);" class="num">ค17${req.cod_amount.toLocaleString(undefined, {minimumFractionDigits:2})}</div>
            <div style="font-size: 10px; color: var(--ink-3);">COD ๢งินสค17</div>
          </div>
        </div>

        <div style="background: var(--page); padding: 10px 12px; border-radius: 6px; border: 1px solid var(--line); font-size: 12px; display: flex; flex-direction: column; gap: 4px;">
          <div><b>๢จ้าขค17โซนเดิค17 (${req.target_zone}):</b> ${req.zone_owner_name} &bull; <span style="color: var(--st-mine); font-weight: 600;">${req.zone_owner_status}</span></div>
          <div><b>๢ค17ุผลที่ขอค17ค17:</b> <i style="color: var(--ink-2);">"${req.reason}"</i></div>
        </div>

        <div style="display: flex; gap: 10px; justify-content: flex-end; margin-top: 4px;">
          <button class="btn btn--secondary btn--sm" style="border-color: var(--st-failed); color: var(--st-failed); min-width: 100px;" onclick="rejectCrossZoneRequest('${req.id}')">
            <i class="fa-solid fa-xmark"></i> ไม่อนุมัติ
          </button>
          <button class="btn btn--confirm btn--sm" style="min-width: 140px; font-weight: 700;" onclick="approveCrossZoneRequest('${req.id}')">
            <i class="fa-solid fa-check"></i> ค17ุมัตค17 (แตะเดียวจบ)
          </button>
        </div>

      </div>
    `;
  }).join("");
}

// Action: Approve Single Cross-Zone Request
function approveCrossZoneRequest(requestId) {
  if (!requireRole(["supervisor"], "ค17ุมัติส่งข้ามโซค17")) return;

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

  showNotification(`ค17ุมัติคำขค17่งข้ามโซนอค17ดอร์ ${req.order_no} ใหไ17 ${req.driver_name} ๢รียบร้ค17แล้ว (แจ้ง๢ตืค17กลับค17คนขับใค17 20 วิ)`, "done");
}

// Action: Reject Single Cross-Zone Request
function rejectCrossZoneRequest(requestId) {
  if (!requireRole(["supervisor"], "ปฏิเค17คำขอค17งข้ามโซน")) return;

  const reason = prompt("ระบุ๢ค17ุผลในการไม่อนุมัติค17งข้ามโซน (บังคับกรค17):");
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

  showNotification(`ไม่อนุมัติคำขอค17งข้ามโซน ${req.order_no} (๢ค17ุผค17: ${reason})`, "failed");
}

// Action: Approve All Pending Cross-Zone Requests (e.g. driver on leave)
function approveAllCrossZoneRequests() {
  if (!requireRole(["supervisor"], "ค17ุมัติคำขค17ั้งหมด")) return;

  const pendingList = (state._CROSSZONE || []).filter(r => r.status === "pending");
  if (pendingList.length === 0) {
    showNotification("ไม่มีคำขค17่งข้ามโซนที่รอค17ุมัตค17", "mine");
    return;
  }

  if (confirm(`ยืนยันค17ุมัติคำขค17่งข้ามโซนที่รอค17ุมัติทั้งหมด ${pendingList.length} รายการ? (กรณีคนขับลค17/กระจายงานล้นโซค17)`)) {
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

    showNotification(`ค17ุมัติคำขค17่งข้ามโซนทั้งหมด ${pendingList.length} รายการ๢รียบร้ค17แล้ว`, "done");
  }
}

// =========================================================
// S3 Engine  17 COD Handover Reconciliation & Day Close
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
      dayStatusChip.innerText = "🔒 ปิดยค17รายวันแล้ว (ข้ค17ูลถูกล็อค17)";
    } else {
      dayStatusChip.className = "chip chip--available";
      dayStatusChip.innerText = "๢ปิดรับมอบเงินประจำวัค17";
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
              <div style="font-weight: 700; color: var(--ink); cursor: pointer;" onclick="openS3DriverOrdersModal('${driver.id}')" title="คลิกดูรายละเค17ยดค17๢ดอร์">${driver.name} <i class="fa-solid fa-circle-info" style="font-size: 10px; color: var(--st-mine);"></i></div>
              <div style="font-size: 10px; color: var(--ink-3);" class="code">${driver.id}</div>
            </div>
          </div>
        </td>
        <td><b class="num">${driverDoneCashOrders.length} จุค17</b></td>
        <td><b class="num" style="color: var(--ink);">ค17${expectedCash.toLocaleString(undefined, {minimumFractionDigits:2})}</b></td>
        <td><b class="num" style="color: var(--st-available);">ค17${reportedCash.toLocaleString(undefined, {minimumFractionDigits:2})}</b></td>
        <td>
          <input type="number" id="s3-input-counted-${driver.id}" class="admin-filter-input num" 
            style="width: 110px; height: 32px; font-weight: 700; text-align: right;" 
            value="${countedCash.toFixed(2)}" ${isDayLocked ? 'disabled' : ''} 
            oninput="recalculateS3DriverDiff('${driver.id}', ${expectedCash})">
        </td>
        <td>
          <b class="num" id="s3-diff-val-${driver.id}" style="color: ${diff === 0 ? 'var(--st-done)' : 'var(--st-failed)'};">
            ค17${diff.toLocaleString(undefined, {minimumFractionDigits:2})}
          </b>
        </td>
        <td>
          <input type="text" id="s3-input-reason-${driver.id}" class="admin-filter-input" 
            placeholder="${diff !== 0 ? 'ระบุ๢ค17ุผค17 (บังคับ)...' : 'ค17าย๢ค17ค17...'}" 
            value="${handoverReason}" ${isDayLocked ? 'disabled' : ''} 
            style="width: 140px; height: 32px; font-size: 11px; ${diff !== 0 && !handoverReason ? 'border-color: var(--st-failed); background: var(--st-failed-bg);' : ''}">
        </td>
        <td>
          <span class="chip ${lastHandover ? (diff === 0 ? 'chip--done' : 'chip--failed') : 'chip--available'}" id="s3-status-chip-${driver.id}" style="font-size: 10px;">
            ${lastHandover ? (diff === 0 ? '✄17 ปิดยค17แล้ว' : '⚠️ มีค17วนต่าง') : 'รอรับมค17'}
          </span>
        </td>
        <td style="text-align: center;">
          <button class="btn btn--secondary btn--sm" onclick="saveDriverCODHandover('${driver.id}', ${expectedCash}, ${reportedCash})" ${isDayLocked ? 'disabled' : ''} style="font-size: 11px; padding: 0 8px;">
            <i class="fa-solid fa-save"></i> รับมค17
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
      logList.innerHTML = `<span style="color: var(--ink-3);">ยังไม่มีประวัติการรับมค17๢งินในระบค17</span>`;
    } else {
      logList.innerHTML = logs.map(e => `
        <div>
          [${new Date(e.created_at).toLocaleTimeString()}] <b style="color: var(--st-available);">${e.created_by}</b> 
          บันทึกรับมค17๢งินคนขับ <b>${e.driver_id}</b>: ควรเก็ค17 ค17${e.expected_cash.toFixed(2)} | นับได้จริง ค17${e.supervisor_counted_cash.toFixed(2)} | ค17วนต่าง ค17${e.diff.toFixed(2)} 
          ${e.diff_reason ? `(๢ค17ุผค17: ${e.diff_reason})` : ''}
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

  diffEl.innerText = `ค17${diff.toLocaleString(undefined, {minimumFractionDigits:2})}`;
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
  if (!requireRole(["supervisor"], "รับมค17๢งิค17 COD")) return;

  const todayStr = "8/12/2026";
  if (state._DAYCLOSE && state._DAYCLOSE[todayStr]?.is_locked) {
    showNotification("🔒 ไม่สามารถบันทึกเงินได้ ๢นื่องจากปิดยค17วันนี้ไปแล้ว", "failed");
    return;
  }

  const inputEl = document.getElementById(`s3-input-counted-${driverId}`);
  const reasonEl = document.getElementById(`s3-input-reason-${driverId}`);
  const counted = parseFloat(inputEl?.value) || 0;
  const diff = counted - expectedCash;
  const reason = reasonEl?.value?.trim() || "";

  if (diff !== 0 && !reason) {
    alert(`พนักงาค17 ${driverId} มีค17วนต่าง ค17${diff.toFixed(2)}  17 บังคับระบุ๢ค17ุผลก่อนบันทึกรับมอบเงิค17 (๢ช่ค17 ทอนผิด / ลูกค้าขอจ่ายพรุ่งนี้)`);
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

  showNotification(`บันทึกรับมค17๢งินคนขับ ${driverId} ๢รียบร้ค17แล้ว (ค17วนต่าง: ค17${diff.toFixed(2)})`, "done");
}

// Action: Execute Daily Close (Day Close Lock)
function executeDailyClose() {
  if (!requireRole(["supervisor"], "ปิดยค17รายวัน")) return;

  const todayStr = "8/12/2026";
  if (confirm(`2223232227232928232520282223282523262629272723212120 ${todayStr}?\n\n222123202325202822232823252127 2021232125252626202529252923292621202521212329212620232129 22282320232020252123242521212121212427212821252821252823`)) {
    if (!state._DAYCLOSE) state._DAYCLOSE = {};
    state._DAYCLOSE[todayStr] = {
      closed_by: state.currentUser.name,
      closed_at: new Date().toISOString(),
      is_locked: true
    };

    saveStateToLocalStorage();
    renderSupervisorS3();
    showNotification(`🔒 ปิดยค17ประจำวันทีไ17 ${todayStr} ๢รียบร้ค17แล้ว ข้ค17ูลพร้อมส่งให้บัญชี`, "done");
  }
}

// Helper: Open Driver Orders Detail Modal in S3
function openS3DriverOrdersModal(driverId) {
  const orders = state.allOrders.filter(o => o.assignedDriverId === driverId || (o.status === 'mine' && driverId === 'DRV-A01'));
  const detailsHtml = orders.map(o => `
     17 <b>${o.id}</b>  17 ${o.customer} (${o.cod ? 'COD ค17' + o.price.toLocaleString() : 'จ่ายค17นไลน์แล้ค17'})
  `).join("\n");
  alert(`รายละเค17ยดค17๢ดอร์ขอค17 ${driverId} (${orders.length} จุค17):\n\n` + detailsHtml);
}

// =========================================================
// S4 Engine  17 Warehouse Returns Management
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
    tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--ink-3); padding: 20px;">ไม่มีรายการขค17ค17งไม่ค17๢ร็จค้างในระบค17</td></tr>`;
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
          <a href="#" style="color: var(--st-available); font-weight: 600; text-decoration: underline;" onclick="openProductQuickEditModal('${pm.row_id}')">✏️ แก้ไขสินค้ค17</a>
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
          ${ret.days_on_truck} วัค17 ${ret.days_on_truck > 1 ? '🚩 ค้าง๢กิค17 1 วัค17' : ''}
        </span>
      </td>
      <td>
        <span style="font-size: 11px; font-weight: 600;">${ret.item_condition || 'รอตรวจรัค17'}</span>
      </td>
      <td>
        <span style="font-size: 11px; color: ${ret.missing_count ? 'var(--st-failed)' : 'var(--ink-3)'};">
          ${ret.missing_count ? ret.missing_count + ' ชิ้นขาดหาย' : ' 17'}
        </span>
      </td>
      <td style="text-align: center;">
        ${isPending ? `
          <button class="btn btn--confirm btn--sm" onclick="receiveWarehouseReturn('${ret.id}')" style="font-size: 11px;">
            <i class="fa-solid fa-box-open"></i> รับขค17คืนแล้ค17
          </button>
        ` : `
          <span class="chip chip--done" style="font-size: 10px;">✄17 รับคืนแล้ว</span>
        `}
      </td>
    `;
    tbody.appendChild(tr);
  });
}

// Action: Receive Warehouse Return
function receiveWarehouseReturn(returnId) {
  if (!requireRole(["supervisor"], "รับขค17คืนเข้าคลัค17")) return;

  const ret = (state._RETURNS || []).find(r => r.id === returnId);
  if (!ret) return;

  const condition = prompt("ระบุค17าพของเมื่อรับคืน๢ข้าคลัค17 (ปกติ / ๢ค17ยหาย / ไม่ครบ):", "ปกติ");
  if (!condition) return;

  let missingCount = 0;
  let notes = "";
  if (condition.includes("๢ค17ยหาย") || condition.includes("ไม่ครบ")) {
    missingCount = parseInt(prompt("ระบุจำนวนสินค้าที่ขาดหายค17ือ๢ค17ยหาย (ชิ้น):", "1") || "0", 10);
    notes = prompt("ระบุค17าย๢ค17ุความเค17ยหาย/ขาดหาย (บังคับ):") || "";
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

  showNotification(`ตรวจรับขค17คืนเข้าคลังอค17ดอร์ ${ret.order_no} ๢รียบร้ค17แล้ว (ค17าพ: ${condition})`, "done");
}

// =========================================================
// S5 Engine  17 Transport Expenses Management
// =========================================================

function renderSupervisorS5() {
  const tbody = document.getElementById("s5-expense-tbody");
  if (!tbody) return;
  tbody.innerHTML = "";

  const expenses = state._EXPENSE || [];
  if (expenses.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--ink-3); padding: 20px;">ยังไม่มีการบันทึกรายจ่ายขนค17งในวันนีไ17</td></tr>`;
    return;
  }

  expenses.forEach(exp => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><span style="font-size: 11px;">${exp.date}</span></td>
      <td><span class="chip chip--available" style="font-size: 10px;">${exp.driver_id}</span></td>
      <td><span style="font-weight: 600;">${exp.expense_type}</span></td>
      <td><b class="num" style="color: var(--st-available);">ค17${exp.amount.toFixed(2)}</b></td>
      <td><span class="num">${exp.mileage ? exp.mileage.toLocaleString() + ' กม.' : ' 17'}</span></td>
      <td><span style="font-size: 11px; color: var(--ink-2);">${exp.notes || ' 17'}</span></td>
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
    alert("กรุณากรอกจำนวน๢งินใค17ถูกต้อค17");
    return;
  }

  const typeLabels = { fuel: "⛄17 ค่าน้ำมัค17", wage: "👷 ค่าเที่ยค17/ค่าแรง", toll: "🛣︄17 ค่าทางด่วน/ค่าจค17", maintenance: "🔧 ค่าซ่อมบำรุงรถ" };

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

  showNotification(`บันทึกรายจ่าค17 ${typeLabels[type]} จำนวค17 ค17${amount.toFixed(2)} ๢รียบร้ค17แล้ว`, "done");
}

// =========================================================
// S6 Engine  17 Accounting Export CSV Generator
// =========================================================

function exportAccountingCSV(datasetType) {
  const todayStr = "8/12/2026";
  const isDayLocked = state._DAYCLOSE && state._DAYCLOSE[todayStr]?.is_locked;

  if (!isDayLocked) {
    alert("🔒 ข้ค17ำหนดทีมบัญชี: ค17มารถค17งอค17ข้ค17ูลได้เฉพาะวันที่ 'ปิดยค17รายวัน (Day Close)' แล้ว๢ท่านั้น\n\nกรุณาไปที่แท็บ 'S3. ตรวจ๢งิค17 COD' แล้วกดปุ่ม '🔒 ปิดยค17วันนี้' ก่ค17ทำการดาวน์โหลดไฟล์ CSV");
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

  showNotification(`ดาวน์โค17ดไฟลไ17 ${filename} ค17ค17ับค17งบัญชี๢รียบร้ค17แล้ว`, "done");
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
  
  // Double multiplier: e.g. ค17บx10แพค175, ค17บx10x5, ลังx6ขวค173
  // Must have a unit word OR an explicit multiplier sign (x or *) between the two numbers.
  const dblMatch = cleanName.match(/(?:ค17บ|ลัง|มัค17)\s*x?\s*(\d+)\s*(?:(?:แพค|กล่อง|ซอง|ค17อ|ขวด|ถุง|ชิ้น|โหค17)\s*x?\s*|[x*]\s*)(\d+)/i);
  if (dblMatch) {
    const v1 = parseInt(dblMatch[1], 10);
    const v2 = parseInt(dblMatch[2], 10);
    return { qty: v1 * v2, reason: `${v1}x${v2}=${v1*v2}` };
  }
  
  // Box single multiplier: ค17บx12 / ลังx12
  const boxMatch = cleanName.match(/(?:ค17บ|ลัง|มัค17)\s*x?\s*(\d+)/i);
  if (boxMatch) {
    const v = parseInt(boxMatch[1], 10);
    return { qty: v, reason: `ค17บx${v}` };
  }
  
  // Pack single multiplier: แพค1712 / กล่อค1730ค17
  const packMatch = cleanName.match(/(?:แพค|กล่อง|ซอค17)\s*x?\s*(\d+)/i);
  if (packMatch) {
    const v = parseInt(packMatch[1], 10);
    return { qty: v, reason: `แพค17/กล่องx${v}` };
  }
  
  // Dozen keyword
  if (cleanName.includes("โหค17")) {
    return { qty: 12, reason: "โหค17=12" };
  }
  
  // Single units
  if (/(?:ค17อ|ขวด|ถุง|ชิ้น|กระป๋อง|ค17ค17|ถ้วย|แก้ว|ตลับ|ก้ค17|ซอค17)(?!\d)/.test(cleanName)) {
    return { qty: 1, reason: "ค17่วยเดี่ยค17=1" };
  }
  
  if (!/(?:ค17บ|แพค|กล่อง|ลัง|มัด|โหค17)/.test(cleanName)) {
    return { qty: 1, reason: "ไม่มีคำระบุแพค=1" };
  }
  
  return null; // Ambiguous
}

// =========================================================
// S7 & S8 JS Controller  17 Product Approvals & Quality Dashboard
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
                ที่สินค้ค17: <b>${log.row_id}</b> | ฟิลดไ17: <code>${log.field}</code> 
                | ค่าเดิค17: <span style="color: var(--st-failed); font-weight: 500;">"${log.old_value || 'ว่าง'}"</span> 
                ➄17 ค่าใค17ไ17: <span style="color: var(--st-done); font-weight: 600;">"${log.new_value || 'ว่าง'}"</span> 
                ${log.note ? `<i style="color: var(--ink-3);"> (ค17าย๢ค17ค17: ${log.note})</i>` : ''}
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
    tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--ink-3); padding: 20px;">ไม่มีคำขค17นหมวดหมู่ความเค17่ยงนี้</td></tr>`;
    return;
  }

  activeQueue.forEach(req => {
    const prod = state.productMaster[req.row_id] || {};
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>
        <div style="font-weight: 700; color: var(--ink);">${prod.name || 'ไม่พบสินค้ค17'}</div>
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
          <button class="btn btn--confirm btn--sm" onclick="approveProductChange('${req.pending_id}')" style="padding: 0 8px; font-size: 11px;">ค17ุมัตค17</button>
          <button class="btn btn--secondary btn--sm" onclick="rejectProductChange('${req.pending_id}')" style="padding: 0 8px; font-size: 11px; border-color: var(--st-failed); color: var(--st-failed);">ปฏิเค17</button>
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

// Action: Approve Product Change
function approveProductChange(pendingId) {
  if (!requireRole(["supervisor"], "ค17ุมัติข้อมูลสินค้ค17")) return;

  const reqIndex = state._PRODUCT_PENDING.findIndex(r => r.pending_id === pendingId);
  if (reqIndex === -1) return;

  const req = state._PRODUCT_PENDING[reqIndex];
  const isHighRisk = ["actual_barcode", "qty_per_unit_override", "net_weight_g", "gross_weight_g"].includes(req.field);

  if (isHighRisk) {
    const confirm2 = confirm(`⚠️ ยืนยันการอนุมัติการแก้ไขระดับสูง (ความ๢ค17่ยงสูง)\n\nการเปลี่ยนข้ค17ูลนี้มีผลกระทบโดยตรงต่ค17ะบบบาร์โค้ค17 ค17๊อค17 และการคำนวณความจุรถจัดค17ง\n\nยืนยันนำ๢ข้าระบบชีตค17ัก?`);
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
  showNotification(`ค17ุมัติคำขค17 ${req.field} ของสินค้ค17 ${req.row_id} ๢รียบร้ค17แล้ว`, "done");
}

// Action: Reject Product Change
function rejectProductChange(pendingId) {
  if (!requireRole(["supervisor"], "ปฏิเค17คำขอแก้สินค้ค17")) return;

  const req = state._PRODUCT_PENDING.find(r => r.pending_id === pendingId);
  if (!req) return;

  const reason = prompt("กรุณาระบุเค17ุผลการปฏิเค17คำขอแก้ไขข้อมูลสินค้ค17 (บังคับ):");
  if (!reason) {
    alert("ต้ค17ระบุ๢ค17ุผลการปฏิเค17!");
    return;
  }

  req.status = "rejected";
  req.reviewed_by = state.currentUser.name;
  req.reviewed_at = new Date().toISOString();
  req.reject_reason = reason;

  appendProductAuditLog("reject", req.row_id, req.field, req.old_value, req.new_value, req.source, pendingId, reason);

  saveStateToLocalStorage();
  renderProductApprovalQueue();
  showNotification(`ปฏิเค17คำขอแก้ไค17 ${req.row_id} ๢รียบร้ค17แล้ว`, "failed");
}

// Bulk Approve Auto Parser results in queue
function approveAllParserPendingRequests() {
  if (!requireRole(["supervisor"], "ค17ุมัติข้อมูลสินค้ากลุ่มใหญ่")) return;

  const pendingList = (state._PRODUCT_PENDING || []).filter(r => r.status === "pending" && r.source === "auto_parse");
  if (pendingList.length === 0) {
    showNotification("ไม่มีรายการที่แกะจาก Parser ตกค้างในระบบ", "mine");
    return;
  }

  if (confirm(`2223232227232928232323242127292026252527282224292823232921262026292327232920232123202722 (Auto Parser) 21272125212128 ${pendingList.length} 2328222928232823212321292723?\n\n2021232125252626202529222021222322202128 override 2023252329202526202023222128232721232127232121`)) {
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

      appendProductAuditLog("approve", req.row_id, req.field, req.old_value, req.new_value, req.source, req.pending_id, "ค17ุมัติกลุ่มใหญ่จาค17 Parser");
      appendProductAuditLog("apply", req.row_id, req.field, req.old_value, req.new_value, req.source, req.pending_id, "บันทึกกลุ่มสำเร็ค17");
    });

    saveStateToLocalStorage();
    renderProductApprovalQueue();
    showNotification(`ค17ุมัติคำขค17าก Parser ทั้งค17ค17 ${pendingList.length} รายการ๢รียบร้ค17แล้ว`, "done");
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
      conflictList.push({ row_id: p.row_id, name: p.name, barcode: p.barcode, type: "ไม่มค17 System SKU" });
    }
    
    // Check digit Mod-10 fail
    if (p.barcode && p.barcode !== "-" && !validateBarcodeMod10(p.barcode)) {
      conflictList.push({ row_id: p.row_id, name: p.name, barcode: p.barcode, type: "Check Digit (Mod-10) ผิดพลาค17" });
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
        conflictList.push({ row_id: rid, name: prod.name, barcode: bc, type: `บาร์โค้ดซ้ำกับค17ค17 ${rowids.length - 1} รายการ` });
      });
    }
  });

  if (conflictsEl) {
    conflictsEl.innerText = `${conflictList.length} 262428`;
  }

  // Render Conflicts list
  if (conflictsTbody) {
    conflictsTbody.innerHTML = "";
    if (conflictList.length === 0) {
      conflictsTbody.innerHTML = `<tr><td colspan="4" style="text-align: center; color: var(--ink-3); padding: 12px;">ไม่พบปัญค17ข้ค17ูลในคลังค17นค้า</td></tr>`;
    } else {
      conflictList.slice(0, 15).forEach(c => {
        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td>
            <div style="font-weight: 700; color: var(--ink);">${c.name}</div>
            <div style="font-size: 10px; color: var(--ink-3);" class="code">${c.row_id}</div>
          </td>
          <td><code class="code">${c.barcode || ' 17'}</code></td>
          <td><span class="chip chip--failed" style="font-size: 10px;">${c.type}</span></td>
          <td style="text-align: center;">
            <button class="btn btn--secondary btn--sm" onclick="openProductQuickEditModal('${c.row_id}')" style="font-size: 11px; padding: 2px 8px;">แก้ไค17</button>
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
      priorityTbody.innerHTML = `<tr><td colspan="4" style="text-align: center; color: var(--st-done); font-weight: 600; padding: 20px;">✄17 ค17นค้าที่มีการซื้อขายวันนี้มีข้อมูลน้ำค17ักครบถ้วนแล้ค17!</td></tr>`;
    } else {
      sortedSkusMissingWeight.slice(0, 10).forEach(item => {
        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td>
            <div style="font-weight: 700; color: var(--ink);">${item.pm.name}</div>
            <div style="font-size: 10px; color: var(--ink-3);" class="code">SKU: ${item.sku} (${item.pm.row_id})</div>
          </td>
          <td style="text-align: right;"><b class="num" style="color: var(--st-failed); font-size: 14px;">${item.orderCount} ชิ้น</b></td>
          <td style="text-align: center;"><span class="chip chip--attention" style="font-size: 10px;">ขาดข้อมูลน้ำค17ัก</span></td>
          <td style="text-align: center;">
            <button class="btn btn--primary btn--sm" onclick="openProductQuickEditModal('${item.pm.row_id}')" style="font-size: 11px; padding: 2px 8px;">กรค17น้ำหนัค17</button>
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
          if (pm.storage_type === "๢ปราะบาค17" || pm.storage_type === "วางทับไม่ได้") {
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
      ? `<div style="font-size: 10px; color: var(--st-failed); background: var(--st-failed-bg); padding: 4px 8px; border-radius: 4px; font-weight: 600; margin-top: 6px;"><i class="fa-solid fa-circle-exclamation"></i> ⚠️ ระวัค17: รถบรรทุกของหนัค17 >50กก. ร่วมกับสินค้าแตกง่าย/๢ปราะบาค17!</div>`
      : "";

    const div = document.createElement("div");
    div.style = "background: var(--card); padding: 12px; border-radius: 6px; border: 1px solid var(--line); display: flex; flex-direction: column; gap: 8px;";
    div.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <span style="font-weight: 700; color: var(--ink);">${drv.name} (${drv.id})</span>
        <span class="chip chip--available" style="font-size: 10px;">${drvOrders.length} จุค17 (${totalItemsCount} ชิ้น)</span>
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
  showNotification("บันทึกการตั้งค่าขีดจำกัดความจุรถ๢รียบร้ค17แล้ว", "done");
}

// =========================================================
// Quick Edit Modal Event Handlers & Openers
// =========================================================

function openProductQuickEditModal(rowId) {
  const prod = state.productMaster[rowId];
  if (!prod) {
    alert("ไม่พบสินค้าที่ต้ค17การแก้ไข!");
    return;
  }

  state.selectedQuickEditRowId = rowId;

  document.getElementById("quick-product-row-id").innerText = `RowID: ${prod.row_id}`;
  document.getElementById("quick-product-system-name").innerText = prod.name;
  document.getElementById("quick-product-system-sku").innerText = prod.system_sku || " 17";
  document.getElementById("quick-product-system-barcode").innerText = prod.barcode || " 17";

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
      appendProductAuditLog("apply", rowId, f, oldVal, val, "manual", "", "ปรับปรุงระดับต่ำ (ค17ุมัติอัตโนมัติ)");
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
      appendProductAuditLog("edit_request", rowId, f, oldVal, val, "manual", pid, "ขอปรับปรุงข้ค17ูลค17นค้า");
      pendingAddedCount++;
    }
  });

  saveStateToLocalStorage();
  closeProductQuickEditModal();
  renderProductApprovalQueue();
  renderProductQualityDashboard();

  if (pendingAddedCount > 0) {
    showNotification(`ค17งคำร้องแก้ไขข้ค17ูลค17นค้า ${pendingAddedCount} ฟิลดไ17 ๢รียบร้ค17แล้ว (รอค17วหน้าอนุมัติ)`, "mine");
  } else {
    showNotification("บันทึกข้ค17ูลระดับต่ำค17๢ร็ค17 ๢รียบร้ค17แล้ว", "done");
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
    resultsDiv.innerHTML = `<div style="color: var(--ink-3); text-align: center; font-size: 11px; padding: 6px;">ไม่พบสินค้าที่ตรงกับการค้นค17</div>`;
    return;
  }

  matches.slice(0, 15).forEach(p => {
    const div = document.createElement("div");
    div.style = "display: flex; justify-content: space-between; align-items: center; background: var(--card); padding: 6px; border-radius: 4px; border: 1px solid var(--line); font-size: 11px;";
    
    // Highlight if search query matches mismatch barcode
    const mismatchBc = document.getElementById("s8-scan-mismatch-bc")?.innerText || "";
    const attachBtn = mismatchBc 
      ? `<button class="btn btn--secondary btn--sm" style="font-size: 10px; padding: 2px 6px; border-color: var(--st-available); color: var(--st-available);" onclick="attachBarcodeToProduct('${p.row_id}', '${mismatchBc}')"><i class="fa-solid fa-link"></i> ผูกบาร์โค้ดสแกค17</button>` 
      : `<button class="btn btn--secondary btn--sm" style="font-size: 10px; padding: 2px 6px;" onclick="openProductQuickEditModal('${p.row_id}')"><i class="fa-solid fa-edit"></i> แก้ไค17</button>`;
      
    div.innerHTML = `
      <div>
        <div style="font-weight: 700; color: var(--ink);">${p.name}</div>
        <div style="font-size: 9px; color: var(--ink-3);" class="code">SKU: ${p.system_sku || ' 17'} | Barcode: ${p.barcode || ' 17'}</div>
      </div>
      <div>
        ${attachBtn}
      </div>
    `;
    resultsDiv.appendChild(div);
  });
}

function simulateBarcodeScan() {
  const bc = prompt("จำลองเครื่ค17ค17กนบาร์โค้ดค17้าคลัง (กรค17ค17าย๢ลขบาร์โค้ดค17นค้าที่ต้องการค17กน):");
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
    showNotification(`ค17กนบาร์โค้ดค17๢ร็ค17: พบบัญชีสินค้ค17 ${prod.name}`, "done");
    closeScanMismatchBanner();
  } else {
    // Mismatch/Not found!
    document.getElementById("s8-scan-mismatch-bc").innerText = cleanBc;
    document.getElementById("s8-scan-mismatch-banner").style.display = "flex";
    showNotification(`⚠️ ค17กนไม่พบบาร์โค้ค17: ${cleanBc} ในระบบค17ัก`, "failed");
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