/* =========================================================
   Unii Mart 584 — ศูนย์ควบคุมหัวหน้าคลัง
   supervisor.js — standalone entry point
   แยกจาก app.js / index.html สิ้นเชิง
   ใช้ร่วมกันเฉพาะ styles.css (design tokens)
   ========================================================= */

// --- Constants (copy of shared data, no import dependency on app.js) ---

const WAREHOUSE_HUB = { lat: 18.56228949, lng: 99.04152043 };

const GEOJSON_ZONES = {
  "Zone A — เมืองลำพูน":     [[18.48,98.95],[18.66,98.95],[18.66,99.12],[18.48,99.12]],
  "Zone B — สารภี/เชียงใหม่": [[18.66,98.90],[18.85,98.90],[18.85,99.12],[18.66,99.12]],
  "Zone C — ป่าซาง":          [[18.35,98.75],[18.48,98.75],[18.48,98.95],[18.35,98.95]]
};

const ZONE_COLORS = {
  "Zone A — เมืองลำพูน":     "var(--st-available)",
  "Zone B — สารภี/เชียงใหม่": "#800080",
  "Zone C — ป่าซาง":          "#FF8C00"
};

let DRIVER_PROFILES = [
  { code: "DRV-A01", name: "ตู่2",          zone: "Zone A — เมืองลำพูน",     avatar: "A01", color: "var(--st-available)", status: "active" },
  { code: "DRV-B02", name: "วิน",           zone: "Zone B — หางดง/เชียงใหม่", avatar: "B02", color: "#8b5cf6", status: "active" },
  { code: "DRV-C03", name: "หมี",           zone: "Zone C — ป่าซาง",          avatar: "C03", color: "#f59e0b", status: "active" },
  { code: "DRV-S04", name: "คลัง (ทีมพิเศษ)", zone: "ทุกโซน",                  avatar: "VIP", color: "#06b6d4", status: "active", isSpecial: true },
  { code: "DRV-D05", name: "กิตติพงษ์ ว่องไว", zone: "Zone D",                 avatar: "D05", color: "#06b6d4", status: "inactive" }
];

const THAI_MONTHS_SHORT = [
  "ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.",
  "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."
];

// --- Supervisor State (isolated) ---
const supState = {
  allOrders: [],          // raw orders for selected date
  allOrdersAll: [],       // all dates (for date dropdown)
  selectedDate: null,     // currently selected date string e.g. "8/12/2026"
  availableDates: [],     // list of all date strings
  skuDetails: {},         // live SKU items mapped by orderId
  token: null
};

// --- Store Photo DB (keyed by phone, stored in localStorage) ---
const PHOTO_DB_KEY = "uflow_store_photos_v1";
function photoDbGet(phone) {
  try {
    const db = JSON.parse(localStorage.getItem(PHOTO_DB_KEY) || "{}");
    return db[phone] || null;
  } catch { return null; }
}
function photoDbSet(phone, dataUrl) {
  try {
    const db = JSON.parse(localStorage.getItem(PHOTO_DB_KEY) || "{}");
    db[phone] = dataUrl;
    localStorage.setItem(PHOTO_DB_KEY, JSON.stringify(db));
  } catch (e) { console.warn("[photoDb] write failed", e); }
}

// --- Call Log DB (keyed by orderId, stored in localStorage) ---
const CALL_LOG_KEY = "uflow_call_logs_v1";
function callLogGet(uid) {
  try {
    const db = JSON.parse(localStorage.getItem(CALL_LOG_KEY) || "{}");
    return db[uid] || [];
  } catch { return []; }
}
function callLogAdd(uid, entry) {
  try {
    const db = JSON.parse(localStorage.getItem(CALL_LOG_KEY) || "{}");
    if (!db[uid]) db[uid] = [];
    db[uid].push(entry);
    localStorage.setItem(CALL_LOG_KEY, JSON.stringify(db));
  } catch (e) { console.warn("[callLog] write failed", e); }
}
function callLogHasToday(uid) {
  const logs = callLogGet(uid);
  const todayISO = fmtISO(new Date());
  return logs.some(l => l.date && l.date.startsWith(todayISO));
}

// --- Leaflet map ---
let supMap = null;
let supMapMarkers = [];

// ===========================
// Boot
// ===========================
document.addEventListener("DOMContentLoaded", () => {
  const token = localStorage.getItem("uflow_sup_token");

  // Enter key on PIN input
  const pinInput = document.getElementById("sup-pin-input");
  if (pinInput) {
    pinInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") supLogin();
    });
  }

  if (token) {
    // Validate existing session
    supState.token = token;
    showDashboard();
    supLoadData();
  } else {
    showLogin();
  }
});

// ===========================
// Auth
// ===========================
async function supLogin() {
  const pinInput = document.getElementById("sup-pin-input");
  const errorMsg = document.getElementById("sup-error-msg");
  const errorText = document.getElementById("sup-error-text");
  const btn = document.getElementById("sup-login-btn");

  const pin = pinInput ? pinInput.value.trim() : "";
  if (!pin) {
    showPinError("โปรดใส่รหัส PIN");
    return;
  }

  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> กำลังตรวจสอบ...';
  }
  clearPinError();

  try {
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pin })
    });
    const data = await res.json();

    if (res.ok && data.success) {
      const role = data.user?.role;
      if (role !== "admin" && role !== "supervisor" && role !== "administrator") {
        showPinError("รหัสนี้ไม่มีสิทธิ์เข้าระบบหัวหน้าคลัง");
        if (btn) {
          btn.disabled = false;
          btn.innerHTML = '<i class="fa-solid fa-arrow-right-to-bracket"></i> เข้าสู่ระบบ';
        }
        return;
      }
      // Save supervisor-specific session
      localStorage.setItem("uflow_sup_token", data.token);
      supState.token = data.token;
      if (pinInput) pinInput.value = "";
      showDashboard();
      supLoadData();
    } else {
      showPinError("รหัส PIN ไม่ถูกต้อง โปรดลองอีกครั้ง");
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-arrow-right-to-bracket"></i> เข้าสู่ระบบ';
      }
    }
  } catch (err) {
    console.warn("Network error during login:", err);
    showPinError("ไม่สามารถเชื่อมต่อกับเซิร์ฟเวอร์ได้ โปรดลองอีกครั้ง");
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<i class="fa-solid fa-arrow-right-to-bracket"></i> เข้าสู่ระบบ';
    }
  }
}

function supLogout() {
  localStorage.removeItem("uflow_sup_token");
  supState.token = null;
  supState.allOrders = [];
  supState.allOrdersAll = [];

  // Reset map
  if (supMap) {
    supMap.remove();
    supMap = null;
    supMapMarkers = [];
  }

  showLogin();
  supNotify("ออกจากระบบเรียบร้อยแล้ว", "ok");
}

function showPinError(msg) {
  const pinInput = document.getElementById("sup-pin-input");
  const errorMsg = document.getElementById("sup-error-msg");
  const errorText = document.getElementById("sup-error-text");
  if (pinInput) pinInput.classList.add("is-error");
  if (errorMsg) errorMsg.style.display = "block";
  if (errorText) errorText.textContent = msg;
}

function clearPinError() {
  const pinInput = document.getElementById("sup-pin-input");
  const errorMsg = document.getElementById("sup-error-msg");
  if (pinInput) pinInput.classList.remove("is-error");
  if (errorMsg) errorMsg.style.display = "none";
}

function showLogin() {
  document.getElementById("sup-login-screen").style.display = "flex";
  document.getElementById("sup-shell").classList.remove("is-visible");
  const btn = document.getElementById("sup-login-btn");
  if (btn) {
    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-arrow-right-to-bracket"></i> เข้าสู่ระบบ';
  }
  clearPinError();
}

function showDashboard() {
  document.getElementById("sup-login-screen").style.display = "none";
  document.getElementById("sup-shell").classList.add("is-visible");
}

// ===========================
// Data Loading
// ===========================
async function supLoadData() {
  try {
    const token = supState.token;

    // Fetch all orders (date=all) for date dropdown + full dataset
    let rawOrders = [];
    if (token) {
      try {
        const res = await fetch("/api/supervisor/day?date=all", {
          headers: { "Authorization": `Bearer ${token}` }
        });
        if (res.status === 401) {
          supLogout();
          showPinError("หมดเวลาเข้าสู่ระบบ กรุณาล็อกอินใหม่");
          return;
        }
        if (res.ok) {
          const data = await res.json();
          if (data.success) {
            // รวม orders (มีวันส่ง) + pendingSchedule (ไม่มีวันส่ง) เข้า allOrdersAll
            const withDate    = data.orders           || [];
            const withoutDate = data.pendingSchedule  || [];
            rawOrders = [...withDate, ...withoutDate];
            supState.pendingCount = withoutDate.length; // เก็บแยกไว้สำหรับ chip count
            const tsEl = document.getElementById("ord-sync-ts");
            if (tsEl) tsEl.textContent = "โหลด: " + new Date().toLocaleTimeString('th-TH');
          }
        }
      } catch (apiErr) {
        console.warn("[supLoadData] API error:", apiErr);
        supNotify("ไม่สามารถเชื่อมต่อ server ได้", "err");
      }
    }

    // Load dynamic zones and dynamic drivers before classifying orders
    await zmLoadZones();
    await drvLoadDrivers();

    // Classify zones client-side
    supState.allOrdersAll = rawOrders.map(o => supClassifyZone(o));
    console.log(`[SUP] Loaded ${supState.allOrdersAll.length} total orders (${supState.pendingCount||0} ไม่มีวันส่ง)`);
    ordUpdateFlagCounts(); // อัปเดต chip count ทันที

    // Build date list
    buildDateDropdown();

    // Set default date (most recent or today)
    if (supState.availableDates.length > 0 && !supState.selectedDate) {
      const now = new Date();
      const dd = String(now.getDate()).padStart(2, '0');
      const mm = String(now.getMonth() + 1).padStart(2, '0');
      const yyyy = now.getFullYear();
      const todayKey = `${dd}-${mm}-${yyyy}`;

      if (supState.availableDates.includes(todayKey)) {
        supState.selectedDate = todayKey;
      } else {
        supState.selectedDate = supState.availableDates[0]; // Newest date first
      }
    }
    syncDateSelects();

    // Filter and render S1
    supFilterOrders();
    supRenderS1();

    // If S2 is active or inited, refresh orders filter
    if (document.getElementById("sup-page-s2")?.classList.contains("is-active") || ordState._inited) {
      ordApplyFilters();
    }

    // load routecodes and SKU details in background (don't block UI)
    ordLoadRoutecodes().then(() => ordAutoAssignAll());
    ordLoadSkuDetails();
  } catch (err) {
    console.error("[SUP] Error loading data:", err);
    supNotify("เกิดข้อผิดพลาดในการโหลดข้อมูล", "err");
  }
}

async function ordLoadSkuDetails() {
  try {
    const res = await fetch('/api/sku-details');
    if (res.ok) {
      const data = await res.json();
      if (data.success && data.skuDetails) {
        supState.skuDetails = data.skuDetails;
        console.log(`[SUP] Loaded SKU details for ${Object.keys(data.skuDetails).length} orders`);
      }
    }
  } catch (err) {
    console.warn('[ordLoadSkuDetails] Failed to load sku details:', err);
  }
}

function supClassifyZone(order) {
  const lat = parseFloat(order.lat);
  const lng = parseFloat(order.lng);

  if (!lat || !lng || lat < 17.9 || lat > 19.3 || lng < 98.4 || lng > 99.6) {
    order.geojsonZone = "UNASSIGNED";
    order.isOutOfBounds = true;
    return order;
  }

  // Use dynamic zones if available, or fallback to GEOJSON_ZONES
  const activeZones = (zmState && zmState.zones && zmState.zones.length > 0)
    ? zmState.zones
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

  // Multiple matching zones -> Overlap zone (e.g. Zone AB)
  const combo = Array.from(new Set(matchedLetters)).sort().join('');
  order.geojsonZone = `Zone ${combo}`;
  return order;
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

function ordNormalizeDateKey(dateStr) {
  if (!dateStr || dateStr === "all") return "";
  const comp = ordParseDateComponents(dateStr);
  if (!comp) return String(dateStr).trim();
  const standardYr = comp.yr > 2500 ? comp.yr - 543 : comp.yr;
  const dd = String(comp.dy).padStart(2, '0');
  const mm = String(comp.mo).padStart(2, '0');
  return `${dd}-${mm}-${standardYr}`;
}

function buildDateDropdown() {
  const dateSet = new Set();
  supState.allOrdersAll.forEach(o => {
    const raw = o.timeWindow || o.deliveryDate;
    if (raw) {
      const d = ordNormalizeDateKey(raw);
      if (d) {
        dateSet.add(d);
        o.timeWindow = d;
        o.deliveryDate = d;
      }
    }
  });

  // Sort chronologically descending or ascending
  supState.availableDates = Array.from(dateSet).sort((a, b) => {
    const ta = ordParseDateTimestamp(a);
    const tb = ordParseDateTimestamp(b);
    return tb - ta; // latest date first
  });

  syncDateSelects();
}

function syncDateSelects() {
  const desktopSel = document.getElementById("sup-date-desktop");
  const mobileSel  = document.getElementById("sup-date-mobile");

  [desktopSel, mobileSel].forEach(sel => {
    if (!sel) return;
    sel.innerHTML = "";
    supState.availableDates.forEach(d => {
      const opt = document.createElement("option");
      opt.value = d;
      opt.textContent = formatThaiDate(d);
      if (d === supState.selectedDate) opt.selected = true;
      sel.appendChild(opt);
    });
  });

  codPopulateDateSelect();
}

function ordParseDateComponents(dateStr) {
  if (!dateStr) return null;
  const s = String(dateStr).trim();
  let dy, mo, yr = 2026;

  // Check if string contains Thai month abbreviation
  const thaiMonIdx = THAI_MONTHS_SHORT.findIndex(m => s.includes(m));
  if (thaiMonIdx !== -1) {
    mo = thaiMonIdx + 1;
    const tokens = s.split(/\s+/);
    const dayToken = tokens.find(t => /^\d{1,2}$/.test(t));
    if (dayToken) dy = parseInt(dayToken, 10);
    const yrToken = tokens.find(t => /^\d{4}$/.test(t));
    if (yrToken) {
      yr = parseInt(yrToken, 10);
      if (yr > 2400) yr -= 543;
    }
  } else {
    const datePart = s.split(' ')[0];
    if (datePart.includes('-')) {
      const parts = datePart.split('-');
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
    } else if (datePart.includes('/')) {
      const parts = datePart.split('/');
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
  }

  if (isNaN(dy) || isNaN(mo) || isNaN(yr) || dy < 1 || dy > 31 || mo < 1 || mo > 12) {
    return null;
  }
  return { dy, mo, yr };
}

function ordParseDateTimestamp(dateStr) {
  if (!dateStr) return 0;
  const s = String(dateStr).trim();
  if (!s) return 0;

  const comp = ordParseDateComponents(s);
  if (!comp) return 0;

  let hr = 0, min = 0, sec = 0;
  const tMatch = s.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (tMatch) {
    hr = parseInt(tMatch[1], 10) || 0;
    min = parseInt(tMatch[2], 10) || 0;
    sec = parseInt(tMatch[3], 10) || 0;
  }

  const ceYr = comp.yr > 2400 ? comp.yr - 543 : comp.yr;
  return new Date(ceYr, comp.mo - 1, comp.dy, hr, min, sec).getTime();
}

function ordGetDaysAgo(placedDateStr, orderDeliveryDate) {
  if (!placedDateStr) return null;
  const placedTime = ordParseDateTimestamp(placedDateStr);
  if (!placedTime) return null;

  // Use order's delivery date or current active system date as reference
  let refStr = orderDeliveryDate || supState.selectedDate || '17 ส.ค. 2569';
  let refTime = ordParseDateTimestamp(refStr);
  if (!refTime || refTime < placedTime) {
    refTime = ordParseDateTimestamp('17 ส.ค. 2569');
  }

  const placedD = new Date(placedTime);
  placedD.setHours(0,0,0,0);
  const refD = new Date(refTime);
  refD.setHours(0,0,0,0);

  const diffMs = refD.getTime() - placedD.getTime();
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));
  return Math.max(0, diffDays);
}

function ordCheckOverdue(o, currentActiveDate) {
  const isCompleted = o.status === 'done' || o.apiStatus === 'ส่งสำเร็จ' || o.apiStatus === 'ได้รับแล้ว' || o.status === 'failed' || o.apiStatus === 'ยกเลิก';
  if (isCompleted) return { isOverdue: false, days: 0 };

  const deliveryStr = o.deliveryDate || o.timeWindow || o.syncDeliveryAt;
  if (!deliveryStr) return { isOverdue: false, days: 0 };

  const delivTime = ordParseDateTimestamp(deliveryStr);
  if (!delivTime) return { isOverdue: false, days: 0 };

  // System current date (17 ส.ค. 2569 or active filter date)
  let refStr = currentActiveDate || supState.selectedDate || '17 ส.ค. 2569';
  let refTime = ordParseDateTimestamp(refStr);
  if (!refTime) {
    refTime = ordParseDateTimestamp('17 ส.ค. 2569');
  }

  const delivD = new Date(delivTime);
  delivD.setHours(0,0,0,0);
  const refD = new Date(refTime);
  refD.setHours(0,0,0,0);

  const diffMs = refD.getTime() - delivD.getTime();
  const overdueDays = Math.round(diffMs / (1000 * 60 * 60 * 24));

  return {
    isOverdue: overdueDays > 0,
    days: overdueDays
  };
}

function formatThaiDate(dateStr) {
  if (!dateStr) return "—";
  const comp = ordParseDateComponents(dateStr);
  if (!comp) return String(dateStr);
  const mon = THAI_MONTHS_SHORT[comp.mo - 1] || `เดือน ${comp.mo}`;
  const thaiYr = comp.yr > 2500 ? comp.yr : comp.yr + 543;
  return `${comp.dy} ${mon} ${thaiYr}`;
}

function fmtBaht(amount, fallback = "—") {
  const n = parseFloat(amount);
  if (isNaN(n) || n <= 0) return fallback;
  return `฿${n.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function supChangeDate(val) {
  supState.selectedDate = val;
  // Sync both header selects
  const desktopSel = document.getElementById("sup-date-desktop");
  const mobileSel  = document.getElementById("sup-date-mobile");
  if (desktopSel) desktopSel.value = val;
  if (mobileSel) mobileSel.value = val;

  // 1. S1 (ภาพรวมวันนี้)
  supFilterOrders();
  supRenderS1();

  // 2. S2 (ออเดอร์)
  if (typeof ordApplyFilters === 'function') {
    const iso = ordToISO(val);
    const dateFromEl = document.getElementById("ord-date-from");
    const dateToEl   = document.getElementById("ord-date-to");
    if (dateFromEl) dateFromEl.value = iso;
    if (dateToEl)   dateToEl.value = iso;
    ordState.dateFrom = iso;
    ordState.dateTo   = iso;
    ordApplyFilters();
  }

  // 3. S9 (จัดการรูทส่ง - Dispatch Board)
  if (typeof dspLoadSummary === 'function') {
    dspState.selectedDate = val;
    const dspDateSel = document.getElementById('dsp-date-select');
    if (dspDateSel) dspDateSel.value = val;
    dspLoadSummary();
  }

  // 4. S4 (ตรวจเงิน COD)
  if (typeof codLoadSummary === 'function') {
    codState.selectedDate = val;
    const codDateSel = document.getElementById('cod-date-select');
    if (codDateSel) codDateSel.value = val;
    codLoadSummary();
  }

  // 5. S3 (รออนุมัติ - Approvals)
  if (typeof apprLoadRequests === 'function') {
    apprLoadRequests();
  }
}

function supFilterOrders() {
  if (!supState.selectedDate) {
    supState.allOrders = supState.allOrdersAll;
    return;
  }
  supState.allOrders = supState.allOrdersAll.filter(o => o.timeWindow === supState.selectedDate);
}

// ===========================
// Page Navigation
// ===========================
const PAGE_TITLES = {
  s1: "ภาพรวมวันนี้",
  s2: "ออเดอร์",
  s9: "จัดการรูทส่ง",
  s3: "รออนุมัติ",
  s4: "ตรวจเงิน COD",
  s5: "ของกลับเข้าคลัง",
  s6: "ร้านค้า",
  s7: "โซน",
  s8: "คนขับ"
};

function supShowPage(pageId, btnEl) {
  // Hide all pages
  document.querySelectorAll(".sup-page").forEach(p => p.classList.remove("is-active"));
  // Deactivate all nav items
  document.querySelectorAll(".sup-nav-item").forEach(b => b.classList.remove("is-active"));

  // Show target
  const targetPage = document.getElementById(`sup-page-${pageId}`);
  if (targetPage) targetPage.classList.add("is-active");
  if (btnEl) btnEl.classList.add("is-active");

  const title = PAGE_TITLES[pageId] || "ภาพรวมวันนี้";
  const pageTitleEl = document.getElementById("sup-page-title");
  const mobileTitleEl = document.getElementById("sup-mobile-title");
  if (pageTitleEl) pageTitleEl.textContent = title;
  if (mobileTitleEl) mobileTitleEl.textContent = title;

  // Re-render and sync date for the active page
  if (pageId === "s1") {
    supRenderS1();
  } else if (pageId === "s2") {
    if (supState.selectedDate && (!ordState.dateFrom || !ordState.dateTo)) {
      const iso = ordToISO(supState.selectedDate);
      const dateFromEl = document.getElementById("ord-date-from");
      const dateToEl   = document.getElementById("ord-date-to");
      if (dateFromEl) dateFromEl.value = iso;
      if (dateToEl)   dateToEl.value = iso;
      ordState.dateFrom = iso;
      ordState.dateTo   = iso;
    }
    ordApplyFilters();
  } else if (pageId === "s9") {
    if (supState.selectedDate) {
      dspState.selectedDate = supState.selectedDate;
    }
    dspInit();
  } else if (pageId === "s3") {
    apprInit();
  } else if (pageId === "s4") {
    if (supState.selectedDate) {
      codState.selectedDate = supState.selectedDate;
    }
    codInit();
  } else if (pageId === "s5") {
    retInit();
  } else if (pageId === "s6") {
    stoInit();
  } else if (pageId === "s7") {
    zmInit();
  } else if (pageId === "s8") {
    drvLoadDrivers();
  }

  // Close sidebar on mobile
  closeSidebar();
}

// ===========================
// Sidebar (mobile)
// ===========================
function openSidebar() {
  document.getElementById("sup-sidebar").classList.add("is-open");
  document.getElementById("sup-overlay").classList.add("is-open");
}

function closeSidebar() {
  document.getElementById("sup-sidebar")?.classList.remove("is-open");
  document.getElementById("sup-overlay")?.classList.remove("is-open");
}

// ===========================
// S1 Dashboard Render
// ===========================
function supRenderS1() {
  const orders = supState.allOrders;

  // --- Stat Card 1: รออนุมัติข้ามโซน ---
  const czEl = document.getElementById("sup-stat-crosszone");
  const czCard = document.getElementById("sup-card-crosszone");
  if (czEl) {
    fetch('/api/supervisor/approvals/crosszone', {
      headers: { 'Authorization': `Bearer ${getSupToken()}` }
    })
    .then(r => r.json())
    .then(data => {
      const pendingCount = data.pendingCount || 0;
      if (czEl) czEl.textContent = pendingCount.toString();
      if (czCard) {
        czCard.className = "sup-stat-card " + (pendingCount > 0 ? "is-crit" : "is-ok");
      }
    })
    .catch(() => {
      if (czEl) czEl.textContent = "0";
      if (czCard) czCard.className = "sup-stat-card is-ok";
    });
  }

  // --- Stat Card 2: จุดส่งวันนี้ ---
  const stopsEl   = document.getElementById("sup-stat-stops");
  const stopsSubEl = document.getElementById("sup-stat-stops-sub");
  const stopsCard = document.getElementById("sup-card-stops");
  const doneCount = orders.filter(o => o.status === "done").length;
  const totalStops = orders.length;

  if (stopsEl) stopsEl.textContent = totalStops.toLocaleString();
  if (stopsSubEl) stopsSubEl.textContent = `ส่งสำเร็จแล้ว ${doneCount} จุด`;
  if (stopsCard) {
    stopsCard.className = "sup-stat-card " + (totalStops > 0 ? "is-ok" : "");
  }

  // --- Stat Card 3: เงิน COD ---
  const codEl    = document.getElementById("sup-stat-cod");
  const codSubEl = document.getElementById("sup-stat-cod-sub");
  const codCard  = document.getElementById("sup-card-cod");
  const codOrders = orders.filter(o => o.cod || o.isCod || (o.paymentType && o.paymentType.toLowerCase().includes('cash')) || (o.payment && o.payment.toLowerCase().includes('cash')));
  const shouldCollect = codOrders.reduce((s, o) => s + (parseFloat(o.price || o.totalAmount || o.total) || 0), 0);
  if (codEl) codEl.textContent = `฿${shouldCollect.toLocaleString("th-TH", {minimumFractionDigits: 2})}`;
  if (codSubEl) codSubEl.textContent = `จากออเดอร์ COD ${codOrders.length} รายการ`;
  if (codCard) codCard.className = "sup-stat-card " + (shouldCollect > 0 ? "is-warn" : "is-ok");

  // --- Stat Card 4: ต้องเคลียร์ ---
  const unassignedOrders = orders.filter(o => o.geojsonZone === "UNASSIGNED" || !o.geojsonZone);
  const outOfBoundsOrders = orders.filter(o => o.isOutOfBounds);
  const unbookedOrders = orders.filter(o => o.status === "available" || !o.status);
  const clearCount = unassignedOrders.length + unbookedOrders.length;

  const clearEl    = document.getElementById("sup-stat-clear");
  const clearSubEl = document.getElementById("sup-stat-clear-sub");
  const clearCard  = document.getElementById("sup-card-clear");
  if (clearEl) clearEl.textContent = clearCount.toLocaleString();
  if (clearSubEl) clearSubEl.textContent =
    `ไม่มีโซน ${unassignedOrders.length} · ยังไม่จอง ${unbookedOrders.length}`;
  if (clearCard) {
    clearCard.className = "sup-stat-card " + (clearCount === 0 ? "is-ok" : clearCount > 10 ? "is-crit" : "is-warn");
  }

  // --- Map ---
  supInitMap();
  supRenderMapMarkers();

  // --- Driver progress panel ---
  supRenderDriverPanel();

  // --- Bottom tables ---
  supRenderUnbookedTable(unbookedOrders);
  supRenderNozoneTable(unassignedOrders);

  // --- Roster Leave / Off Warning Check ---
  if (typeof rosCheckTodayLeaveWarnings === 'function') {
    rosCheckTodayLeaveWarnings();
  }

  // --- Zone Quota Alerts (Over Quota Capacity Check) ---
  supCheckZoneQuotas();

  // --- Operational Summary Cards (S3, S4, S5) ---
  supRenderOperationalSummary();
}

function supCheckZoneQuotas() {
  const orders = supState.allOrders || [];
  const activeZones = (zmState && zmState.zones && zmState.zones.length > 0)
    ? zmState.zones
    : [];

  const quotaAlertsContainer = document.getElementById('sup-zone-quota-section');
  if (!quotaAlertsContainer) return;

  const quotaList = [];
  activeZones.forEach(z => {
    const limit = parseInt(z.cardLimit || z.card_limit || 30, 10);
    const zoneLetter = z.letter || z.name?.match(/Zone ([A-Z])/i)?.[1] || '';
    const zoneOrders = orders.filter(o => {
      if (!o.geojsonZone || o.geojsonZone === 'UNASSIGNED') return false;
      return o.geojsonZone === z.name || (zoneLetter && o.geojsonZone === `Zone ${zoneLetter}`);
    });

    const count = zoneOrders.length;
    const isOver = count > limit;
    quotaList.push({
      zone: z,
      name: z.name || `Zone ${z.letter}`,
      letter: zoneLetter,
      count,
      limit,
      isOver,
      excess: count - limit
    });
  });

  const overQuotaZones = quotaList.filter(q => q.isOver);

  if (overQuotaZones.length > 0) {
    quotaAlertsContainer.innerHTML = `
      <div class="sup-table-section">
        <h2 class="sup-table-heading" style="color:var(--st-failed);">
          <i class="fa-solid fa-triangle-exclamation"></i>
          เตือนออเดอร์เกินโควตาโซน (Over Quota)
          <span class="sup-badge" style="background:#fee2e2; color:#b91c1c; border-color:#fca5a5;">${overQuotaZones.length} โซน</span>
        </h2>
        <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap:12px; margin-top:10px;">
          ${overQuotaZones.map(q => `
            <div style="background:#fff1f2; border:1.5px solid #fecdd3; border-radius:8px; padding:12px 14px; display:flex; justify-content:space-between; align-items:center;">
              <div>
                <div style="font-weight:700; color:#9f1239; font-size:14px;">${escHtml(q.name)}</div>
                <div style="font-size:12px; color:#be123c; margin-top:2px;">
                  มี <strong>${q.count}</strong> จุด (โควตากำหนดไว้ <strong>${q.limit}</strong> จุด) &bull; <strong style="color:#b91c1c;">เกิน ${q.excess} จุด</strong>
                </div>
              </div>
              <button class="btn btn--secondary btn--sm" style="border-color:#fca5a5; color:#9f1239; font-size:11px;" onclick="supShowPage('s9', document.querySelector('[data-page=s9]'))">
                <i class="fa-solid fa-people-arrows"></i> เกลี่ยงาน (S9)
              </button>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  } else {
    quotaAlertsContainer.innerHTML = `
      <div class="sup-table-section">
        <h2 class="sup-table-heading" style="color:var(--st-done);">
          <i class="fa-solid fa-circle-check"></i>
          สถานะโควตาโซน (Zone Capacity)
          <span class="sup-badge" style="background:#dcfce7; color:#15803d; border-color:#86efac;">ปกติ</span>
        </h2>
        <div style="font-size:12px; color:var(--ink-2); background:var(--surface); border:1px solid var(--line); border-radius:8px; padding:12px 14px;">
          <i class="fa-solid fa-shield-check" style="color:var(--st-done); margin-right:6px;"></i> ปริมาณงานทุกโซนอยู่ในเกณฑ์ปกติ ไม่มีโซนใดมีออเดอร์เกินขีดจำกัดโควตา
        </div>
      </div>
    `;
  }
}

let supMapZoneLayers = [];

function supRenderS1MapZones() {
  if (!supMap) return;
  supMapZoneLayers.forEach(l => supMap.removeLayer(l));
  supMapZoneLayers = [];

  const activeZones = (zmState && zmState.zones && zmState.zones.length > 0)
    ? zmState.zones
    : Object.entries(GEOJSON_ZONES).map(([name, polygon]) => ({
        letter: name.match(/Zone ([A-Z])/i)?.[1] || 'A',
        name,
        color: ZONE_COLORS[name] || 'var(--st-available)',
        polygon
      }));

  // 1. Base zones
  activeZones.forEach((z, idx) => {
    if (!Array.isArray(z.polygon) || z.polygon.length < 3) return;
    const color = z.color || zmState.colors[idx % zmState.colors.length] || 'var(--st-available)';
    const poly = L.polygon(z.polygon, {
      color: color,
      weight: 2.5,
      fillColor: color,
      fillOpacity: 0.1,
      interactive: false
    }).addTo(supMap);
    supMapZoneLayers.push(poly);
  });

  // 2. Overlap zones
  (zmState.overlapZones || []).forEach(oz => {
    if (!Array.isArray(oz.polygon) || oz.polygon.length < 3) return;
    const poly = L.polygon(oz.polygon, {
      color: '#db2777',
      weight: 2,
      dashArray: '6, 6',
      fillColor: '#ec4899',
      fillOpacity: 0.2,
      interactive: false
    }).addTo(supMap);
    supMapZoneLayers.push(poly);
  });
}

function supInitMap() {
  if (supMap) {
    setTimeout(() => supMap.invalidateSize(), 100);
    return;
  }
  const container = document.getElementById("sup-map");
  if (!container) return;

  supMap = L.map("sup-map", { zoomControl: false }).setView([WAREHOUSE_HUB.lat, WAREHOUSE_HUB.lng], 12);

  L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", {
    maxZoom: 19,
    attribution: "© Unii Mart 584"
  }).addTo(supMap);

  L.control.zoom({ position: "topright" }).addTo(supMap);

  // Warehouse hub marker
  const warehouseIcon = L.divIcon({
    className: "",
    html: `<div style="background:var(--ink);color:#fff;border-radius:50%;width:24px;height:24px;display:flex;align-items:center;justify-content:center;font-size:12px;box-shadow:0 2px 6px rgba(0,0,0,0.3);" title="คลังสินค้าหลัก"><i class="fa-solid fa-warehouse"></i></div>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12]
  });
  L.marker([WAREHOUSE_HUB.lat, WAREHOUSE_HUB.lng], { icon: warehouseIcon })
    .addTo(supMap)
    .bindPopup("<b>คลังสินค้าหลัก Unii Mart 584</b>");

  // Render dynamic zone polygons
  supRenderS1MapZones();

  setTimeout(() => supMap.invalidateSize(), 200);
}

function supRenderMapMarkers() {
  if (!supMap) return;

  // Clear old markers
  supMapMarkers.forEach(m => supMap.removeLayer(m));
  supMapMarkers = [];

  const orders = supState.allOrders;

  // Group by coordinates
  const clusters = {};
  orders.forEach(o => {
    const lat = parseFloat(o.lat);
    const lng = parseFloat(o.lng);
    if (!lat || !lng) return;
    const key = `${lat.toFixed(5)},${lng.toFixed(5)}`;
    if (!clusters[key]) clusters[key] = [];
    clusters[key].push(o);
  });

  for (const [key, group] of Object.entries(clusters)) {
    const first = group[0];
    const lat = parseFloat(first.lat);
    const lng = parseFloat(first.lng);
    const status = first.status || "available";
    const count = group.length;
    const isClustered = count > 1;

    let bgColor = "var(--st-out)";
    if (status === "done")           bgColor = "var(--st-done)";
    else if (status === "mine")       bgColor = "var(--st-mine)";
    else if (status === "available")  bgColor = "var(--st-available)";
    else if (status === "failed")     bgColor = "var(--st-failed)";

    const size = isClustered ? 26 : 14;
    const html = isClustered
      ? `<div style="background:${bgColor};color:#fff;border-radius:50%;width:${size}px;height:${size}px;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;box-shadow:0 1px 4px rgba(0,0,0,0.25);">${count}</div>`
      : `<div style="background:${bgColor};border-radius:50%;width:${size}px;height:${size}px;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,0.25);"></div>`;

    const icon = L.divIcon({
      className: "",
      html,
      iconSize: [size, size],
      iconAnchor: [size / 2, size / 2]
    });

    const popupLines = group.slice(0, 5).map(o =>
      `<div style="margin-bottom:4px;font-size:12px;">${o.customerName || o.name || "ร้านค้า"} — ${o.geojsonZone || "ไม่มีโซน"}</div>`
    ).join("");
    const moreText = group.length > 5 ? `<div style="color:#888;font-size:11px;">+${group.length - 5} รายการ</div>` : "";

    const marker = L.marker([lat, lng], { icon })
      .addTo(supMap)
      .bindPopup(`<div style="font-family:'IBM Plex Sans Thai',sans-serif;">${popupLines}${moreText}</div>`, { maxWidth: 250 });

    supMapMarkers.push(marker);
  }
}

// ===========================
// Driver Progress Panel
// ===========================
function supRenderDriverPanel() {
  const container = document.getElementById("sup-driver-list");
  if (!container) return;
  container.innerHTML = "";

  const orders = supState.allOrders;

  DRIVER_PROFILES.forEach(driver => {
    const dCode = (driver.code || '').toUpperCase();
    const dName = (driver.name || '').toLowerCase();
    const driverOrders = orders.filter(o => {
      const assigned = (o.assignedDriverId || o.assigned_driver || o.driver || o.carrier || '').trim().toUpperCase();
      if (assigned === dCode) return true;
      if (assigned === dCode.replace('DRV-', '')) return true;
      if (o.driver && o.driver.toLowerCase().includes(dName)) return true;
      // If order is claimed or done in this driver's primary zone and not explicitly assigned to another driver
      if ((o.status === 'mine' || o.status === 'done') && !assigned) {
        if (o.geojsonZone && o.geojsonZone.includes(driver.zone.replace('Zone ', ''))) return true;
      }
      return false;
    });

    const bookedCount  = driverOrders.length;
    const doneCount    = driverOrders.filter(o => o.status === "done").length;
    const codOrders    = driverOrders.filter(o => o.cod || o.isCod || (o.paymentType && o.paymentType.toLowerCase().includes('cash')) || (o.payment && o.payment.toLowerCase().includes('cash')));
    const codExpected  = codOrders.reduce((s, o) => s + (parseFloat(o.price || o.totalAmount || o.total) || 0), 0);
    const pct          = bookedCount > 0 ? Math.round((doneCount / bookedCount) * 100) : 0;

    const zoneColor = ZONE_COLORS[driver.zone] || "var(--st-available)";

    const row = document.createElement("div");
    row.className = "sup-driver-row";
    row.innerHTML = `
      <div class="sup-driver-name">${driver.name}</div>
      <div class="sup-driver-zone" style="color:${zoneColor};">${driver.zone}</div>
      <div class="sup-driver-progress-bar">
        <div class="sup-driver-progress-fill" style="width:${pct}%;"></div>
      </div>
      <div class="sup-driver-stats">
        <span>${doneCount}/${bookedCount} จุด</span>
        <span>${bookedCount > 0 ? pct + "%" : "ยังไม่ได้รับงาน"}</span>
      </div>
      ${codExpected > 0 ? `<div style="font-size:var(--fs-label);color:var(--ink-3);margin-top:4px;">COD ควรได้รับ ฿${codExpected.toLocaleString("th-TH",{minimumFractionDigits:2})}</div>` : ""}
    `;
    container.appendChild(row);
  });
}

// ===========================
// Operational Summary Cards (S3, S4, S5)
// ===========================
async function supRenderOperationalSummary() {
  const container = document.getElementById("sup-op-summary-section");
  if (!container) return;

  const token = getSupToken();
  const selectedDate = supState.selectedDate || '';

  try {
    // 1. Fetch Crosszone requests
    const czPromise = fetch('/api/supervisor/approvals/crosszone', {
      headers: { 'Authorization': `Bearer ${token}` }
    }).then(r => r.json()).catch(() => ({ pendingCount: 0, requests: [] }));

    // 2. Fetch COD summary for selected date
    const codPromise = fetch(`/api/cod/summary?date=${encodeURIComponent(selectedDate)}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    }).then(r => r.json()).catch(() => ({ totalDrivers: 0, totalExpected: 0, totalVerified: 0 }));

    // 3. Fetch Returns
    const retPromise = fetch('/api/supervisor/returns', {
      headers: { 'Authorization': `Bearer ${token}` }
    }).then(r => r.json()).catch(() => ({ returns: [] }));

    const [czData, codData, retData] = await Promise.all([czPromise, codPromise, retPromise]);

    // Compute Crosszone stats
    const czPendingCount = czData.pendingCount || (czData.requests ? czData.requests.filter(r => r.status === 'pending').length : 0);
    const czRequests = (czData.requests || []).filter(r => r.status === 'pending');
    let maxWaitMins = 0;
    const nowMs = Date.now();
    czRequests.forEach(r => {
      const reqTime = r.requested_at ? new Date(r.requested_at).getTime() : 0;
      if (reqTime > 0) {
        const diffMins = Math.round((nowMs - reqTime) / 60000);
        if (diffMins > maxWaitMins) maxWaitMins = diffMins;
      }
    });

    // Compute COD stats
    const codVerified = parseFloat(codData.totalVerified || 0);
    const codExpected = parseFloat(codData.totalExpected || 0);
    const codDone = codExpected > 0 && codVerified >= codExpected;

    // Compute Returns stats
    const allReturns = retData.returns || [];
    const pendingReturns = allReturns.filter(r => r.return_status === 'pending_return' || r.status === 'pending');
    const overdueReturns = pendingReturns.filter(r => {
      if (!r.return_created_at && !r.date) return false;
      const t = new Date(r.return_created_at || r.date).getTime();
      return (nowMs - t) > 24 * 60 * 60 * 1000;
    });

    // Check All-Clear Condition
    const isAllClear = (czPendingCount === 0) && (codExpected === 0 || codVerified >= codExpected) && (pendingReturns.length === 0);

    if (isAllClear) {
      container.innerHTML = `
        <div class="sup-op-all-clear-banner">
          <i class="fa-solid fa-circle-check" style="font-size: 20px;"></i>
          <span>ทุกอย่างเรียบร้อย ไม่มีรายการค้างที่ต้องจัดการเพิ่ม</span>
        </div>
      `;
      return;
    }

    // Render 3 Summary Cards
    const czSubClass = maxWaitMins > 15 ? 'is-danger' : (maxWaitMins > 5 ? 'is-warn' : '');
    const czSubText = czPendingCount > 0 
      ? `<i class="fa-regular fa-clock"></i> รอนานสุด ${maxWaitMins > 0 ? maxWaitMins : 1} นาที` 
      : 'ไม่มีคำขอค้าง';

    const codSubClass = (codExpected > 0 && codVerified < codExpected) ? 'is-warn' : '';
    const codSubText = `จากยอดควรเก็บ ฿${codExpected.toLocaleString('th-TH', {minimumFractionDigits: 2})}`;

    const retSubClass = overdueReturns.length > 0 ? 'is-danger' : '';
    const retSubText = overdueReturns.length > 0 
      ? `<i class="fa-solid fa-triangle-exclamation"></i> ค้างเกิน 1 วัน: ${overdueReturns.length} จุด`
      : 'ไม่มีของค้างเกินกำหนด';

    container.innerHTML = `
      <div class="sup-op-grid">
        <!-- Card 1: ขอข้ามโซน (S3) -->
        <div class="sup-op-card">
          <div>
            <div class="sup-op-header">
              <div class="sup-op-title"><i class="fa-solid fa-clock-rotate-left" style="color:#2563eb;"></i> ขอข้ามโซน</div>
              <span class="sup-badge ${czPendingCount === 0 ? 'is-ok' : 'is-crit'}">${czPendingCount}</span>
            </div>
            <div class="sup-op-val">${czPendingCount} <span style="font-size:14px;font-weight:400;color:var(--ink-2);">คำขอ</span></div>
            <div class="sup-op-sub ${czSubClass}">${czSubText}</div>
          </div>
          <button class="sup-op-btn" onclick="supShowPage('s3', document.querySelector('[data-page=s3]'))">
            ไปหน้ารออนุมัติ <i class="fa-solid fa-arrow-right"></i>
          </button>
        </div>

        <!-- Card 2: ตรวจเงิน COD (S4) -->
        <div class="sup-op-card">
          <div>
            <div class="sup-op-header">
              <div class="sup-op-title"><i class="fa-solid fa-coins" style="color:#d97706;"></i> ตรวจเงิน COD</div>
              <span class="sup-badge ${codDone ? 'is-ok' : ''}">${codDone ? 'ตรวจครบ' : 'รอนับ'}</span>
            </div>
            <div class="sup-op-val" style="font-size:19px;">ตรวจแล้ว ฿${codVerified.toLocaleString('th-TH', {minimumFractionDigits:2})}</div>
            <div class="sup-op-sub ${codSubClass}">${codSubText}</div>
          </div>
          <button class="sup-op-btn" onclick="supShowPage('s4', document.querySelector('[data-page=s4]'))">
            ไปหน้าตรวจ COD <i class="fa-solid fa-arrow-right"></i>
          </button>
        </div>

        <!-- Card 3: ของกลับเข้าคลัง (S5) -->
        <div class="sup-op-card">
          <div>
            <div class="sup-op-header">
              <div class="sup-op-title"><i class="fa-solid fa-warehouse" style="color:#dc2626;"></i> ของกลับเข้าคลัง</div>
              <span class="sup-badge ${pendingReturns.length === 0 ? 'is-ok' : 'is-crit'}">${pendingReturns.length}</span>
            </div>
            <div class="sup-op-val">${pendingReturns.length} <span style="font-size:14px;font-weight:400;color:var(--ink-2);">จุดรอรับคืน</span></div>
            <div class="sup-op-sub ${retSubClass}">${retSubText}</div>
          </div>
          <button class="sup-op-btn" onclick="supShowPage('s5', document.querySelector('[data-page=s5]'))">
            ไปหน้าของกลับ <i class="fa-solid fa-arrow-right"></i>
          </button>
        </div>
      </div>
    `;
  } catch (e) {
    console.warn('[supRenderOperationalSummary] Error:', e);
  }
}

// ===========================
// Bottom Tables
// ===========================
function supRenderUnbookedTable(unbookedOrders) {
  const tbody = document.getElementById("sup-tbl-unbooked");
  const badge = document.getElementById("sup-badge-unbooked");
  if (!tbody) return;

  if (badge) {
    badge.textContent = unbookedOrders.length;
    badge.className = "sup-badge " + (unbookedOrders.length === 0 ? "is-ok" : "");
  }

  if (unbookedOrders.length === 0) {
    tbody.innerHTML = `<tr class="sup-empty-row"><td colspan="4"><i class="fa-solid fa-circle-check" style="color:var(--st-done);"></i> ทุกจุดถูกจองแล้ว</td></tr>`;
    return;
  }

  // Show up to 50 rows
  const rows = unbookedOrders.slice(0, 50).map(o => {
    const name = escHtml(o.customer || o.customerName || o.name || "—");
    const zone = escHtml(o.geojsonZone || o.zone || "ไม่มีโซน");
    const isCod = o.cod || o.isCod || (o.paymentType && o.paymentType.toLowerCase().includes('cash')) || (o.payment && o.payment.toLowerCase().includes('cash'));
    const priceVal = parseFloat(o.price || o.totalAmount || o.total || 0);
    const cod = isCod ? `฿${priceVal.toLocaleString("th-TH",{minimumFractionDigits:2})}` : (priceVal > 0 ? `<span style="color:#059669;font-size:11px;">โอนแล้ว</span>` : "—");
    const date = o.deliveryDate ? formatThaiDate(o.deliveryDate) : (o.timeWindow ? formatThaiDate(o.timeWindow) : "—");
    return `<tr><td><strong>${name}</strong></td><td><span style="color:${getZoneColor(o.geojsonZone || o.zone)};font-weight:600;">${zone}</span></td><td>${cod}</td><td>${date}</td></tr>`;
  });

  if (unbookedOrders.length > 50) {
    rows.push(`<tr class="sup-empty-row"><td colspan="4">...และอีก ${unbookedOrders.length - 50} รายการ</td></tr>`);
  }
  tbody.innerHTML = rows.join("");
}

function supRenderNozoneTable(unassignedOrders) {
  const tbody = document.getElementById("sup-tbl-nozone");
  const badge = document.getElementById("sup-badge-nozone");
  if (!tbody) return;

  if (badge) {
    badge.textContent = unassignedOrders.length;
    badge.className = "sup-badge " + (unassignedOrders.length === 0 ? "is-ok" : "");
  }

  if (unassignedOrders.length === 0) {
    tbody.innerHTML = `<tr class="sup-empty-row"><td colspan="4"><i class="fa-solid fa-circle-check" style="color:var(--st-done);"></i> ทุกจุดมีโซนครบ</td></tr>`;
    return;
  }

  const rows = unassignedOrders.slice(0, 50).map(o => {
    const name   = escHtml(o.customer || o.customerName || o.name || "—");
    const lat    = parseFloat(o.lat) || 0;
    const lng    = parseFloat(o.lng) || 0;
    const coords = (lat && lng) ? `${lat.toFixed(5)}, ${lng.toFixed(5)}` : "ไม่มีพิกัด";
    const reason = o.isOutOfBounds ? "พิกัดอยู่นอกพื้นที่รับงาน" : "ตกโซนไม่ได้";
    const date   = o.deliveryDate ? formatThaiDate(o.deliveryDate) : (o.timeWindow ? formatThaiDate(o.timeWindow) : "—");
    return `<tr>
      <td><strong>${name}</strong></td>
      <td style="font-family:var(--font-code);font-size:11px;color:var(--ink-2);">${escHtml(coords)}</td>
      <td><span style="color:var(--st-failed);">${reason}</span></td>
      <td>${date}</td>
    </tr>`;
  });

  if (unassignedOrders.length > 50) {
    rows.push(`<tr class="sup-empty-row"><td colspan="4">...และอีก ${unassignedOrders.length - 50} รายการ</td></tr>`);
  }
  tbody.innerHTML = rows.join("");
}

// ===========================
// Helpers
// ===========================
function escHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function getZoneColor(zone) {
  return ZONE_COLORS[zone] || "var(--ink-3)";
}

// Notification toast
let supNotifyTimer = null;
function supNotify(msg, type = "default") {
  const el = document.getElementById("sup-notification");
  if (!el) return;
  el.textContent = msg;
  el.className = `type-${type} is-visible`;
  if (supNotifyTimer) clearTimeout(supNotifyTimer);
  supNotifyTimer = setTimeout(() => {
    el.classList.remove("is-visible");
  }, 3000);
}

/* ==============================================
   หน้าออเดอร์ (S2) — Orders Page Logic
   ============================================== */

const ordState = {
  // filter values
  dateFrom:     "",       // ISO "YYYY-MM-DD"
  dateTo:       "",
  zones:        new Set(["all"]),
  drivers:      new Set(["all"]),
  statuses:     new Set(["all"]),
  flags:        new Set(),          // "nozone" | "nocoord" | "nodate"
  search:       "",

  // sort
  sortCol:      "orderPlacedAt",
  sortDir:      "desc",            // "asc" | "desc"

  // pagination
  PAGE_SIZE:    80,
  rendered:     0,

  // selection (Set of UIDs)
  selected:     new Set(),

  // bulk action pending
  pendingAction: null,   // { type, selectedOrders }

  // sync
  lastSyncAt:   null,    // Date
  syncing:      false,

  // detail slide-over
  detailOrder:  null,
  detailMap:    null,

  // all filtered orders (result of ordApplyFilters)
  filtered:     [],

  // view mode: 'split' | 'table'
  viewMode:     'split',

  // routecodes: orderId → { routeCode, zone, date, seq, overLimit, ... }
  routecodes:   {},
  // printed: orderId → ISO timestamp
  printed:      {},
  // over-limit warnings seen this session (zone letters)
  overLimitSeen: new Set(),
};

// =====================================
// Sync Functions (Unii API → Sheets → UI)
// =====================================
async function ordSyncIncremental() {
  await _ordDoSync({ pages: 5 });
}

async function ordSyncFull() {
  const ok = confirm('สยงส่็งสแกนทุกหน้าจาก Unii API \n(อาจใช้เวลา 1-2 นาที) ต้องการดำเนินการต่อ?');
  if (!ok) return;
  await _ordDoSync({ fullSync: true });
}

async function _ordDoSync(body) {
  const token = supState.token || localStorage.getItem('uflow_sup_token');
  if (!token) { supNotify('กรุณาล็อกอินก่อน', 'err'); return; }

  const icon   = document.getElementById('ord-sync-icon');
  const tsEl   = document.getElementById('ord-sync-ts');

  // Spin icon
  if (icon) icon.classList.add('fa-spin');
  if (tsEl) tsEl.textContent = 'กำลัง sync…';

  try {
    const res = await fetch('/api/supervisor/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    const data = await res.json();

    if (data.success) {
      const msg = data.newOrders > 0
        ? `✅ เพิ่ม ${data.newOrders} ออเดอร์ใหม่`
        : `✔ ไม่มีออเดอร์ใหม่`;
      supNotify(data.message || msg, data.newOrders > 0 ? 'ok' : 'info');
      if (tsEl) tsEl.textContent = 'สำเร็จ: ' + new Date().toLocaleTimeString('th-TH');

      // Reload UI data ถ้ามีออเดอร์ใหม่
      if (data.newOrders > 0) await supLoadData();
    } else {
      supNotify(data.error || 'Sync ล้มเหลว', 'err');
      if (tsEl) tsEl.textContent = 'สิ่งผิดพลาด';
    }
  } catch (err) {
    console.error('[sync]', err);
    supNotify('ไม่สามารถเชื่อมต่อ server', 'err');
    if (tsEl) tsEl.textContent = 'เชื่อมต่อไม่ได้';
  } finally {
    if (icon) icon.classList.remove('fa-spin');
  }
}

// =====================================
// Boot — called from supShowPage
// =====================================
function ordInit() {
  if (!ordState._inited) {
    ordState._inited = true;

    // Leave dateFrom/dateTo empty by default to show all active orders
    ordState.dateFrom = "";
    ordState.dateTo   = "";

    const fromEl = document.getElementById("ord-date-from");
    const toEl   = document.getElementById("ord-date-to");
    if (fromEl) fromEl.value = "";
    if (toEl)   toEl.value   = "";

    // Build zone chips from real zone data
    ordBuildZoneChips();
    // Build driver chips from real driver profiles
    ordBuildDriverChips();
  }

  ordSetViewMode(ordState.viewMode || 'split');
}

// Called when page becomes active (hooked into supShowPage)
const _origSupShowPage = supShowPage;
supShowPage = function(pageId, btnEl) {
  _origSupShowPage(pageId, btnEl);
  if (pageId === "s2") {
    ordInit();
    if (ordState.viewMode === "split") {
      setTimeout(() => {
        ordInitSplitMap();
        if (ordSplitMap) ordSplitMap.invalidateSize();
      }, 150);
    }
  }
  if (pageId === "s4") codInit();
  if (pageId === "s6") stoInit();
  if (pageId === "s7") zmInit();
};

// =====================================
// Zone + Driver Chip Builders
// =====================================
function ordBuildZoneChips() {
  const container = document.getElementById("ord-zone-chips");
  if (!container) return;
  container.innerHTML = `<button class="ord-chip is-active" data-zone="all" onclick="ordToggleZone(this,'all')">ทั้งหมด</button>`;

  const zoneDefinitions = [
    { key: "Zone A", label: "Zone A — เมืองลำพูน" },
    { key: "Zone B", label: "Zone B — หางดง/เชียงใหม่" },
    { key: "Zone C", label: "Zone C — ป่าซาง" },
    { key: "Zone D", label: "Zone D — ทาปลาดุก" },
    { key: "Zone AB", label: "Zone AB - สารภี/บ้านธิ" },
    { key: "Zone AC", label: "Zone AC - ลำพูน/ป่าซาง" },
    { key: "Zone CD", label: "Zone CD - บ้านทา" },
  ];

  zoneDefinitions.forEach((z) => {
    const btn = document.createElement("button");
    btn.className = "ord-chip";
    btn.dataset.zone = z.key;
    btn.onclick = () => ordToggleZone(btn, z.key);
    btn.textContent = z.label;
    container.appendChild(btn);
  });

  // เพิ่ม "ไม่มีโซน"
  const noZoneBtn = document.createElement("button");
  noZoneBtn.className = "ord-chip";
  noZoneBtn.dataset.zone = "UNASSIGNED";
  noZoneBtn.onclick = () => ordToggleZone(noZoneBtn, "UNASSIGNED");
  noZoneBtn.textContent = "ไม่มีโซน";
  container.appendChild(noZoneBtn);
}

function ordBuildDriverChips() {
  const container = document.getElementById("ord-driver-chips");
  if (!container) return;
  container.innerHTML = `
    <button class="ord-chip is-active" data-driver="all" onclick="ordToggleDriver(this,'all')">ทั้งหมด</button>
    <button class="ord-chip" data-driver="none" onclick="ordToggleDriver(this,'none')">ยังไม่มีคนจอง</button>
  `;
  DRIVER_PROFILES.filter(d => d.status !== 'inactive').forEach(d => {
    const btn = document.createElement("button");
    btn.className = "ord-chip";
    btn.dataset.driver = d.code;
    btn.onclick = () => ordToggleDriver(btn, d.code);
    btn.textContent = d.name.split(" ")[0]; // ย่อชื่อ
    container.appendChild(btn);
  });
}

// =====================================
// Filter Toggles
// =====================================
function ordToggleZone(btn, zone) {
  if (zone === "all") {
    ordState.zones = new Set(["all"]);
    document.querySelectorAll("#ord-zone-chips .ord-chip").forEach(b => b.classList.toggle("is-active", b.dataset.zone === "all"));
  } else {
    ordState.zones.delete("all");
    if (ordState.zones.has(zone)) ordState.zones.delete(zone);
    else ordState.zones.add(zone);
    if (ordState.zones.size === 0) ordState.zones.add("all");
    document.querySelectorAll("#ord-zone-chips .ord-chip").forEach(b => {
      b.classList.toggle("is-active", ordState.zones.has(b.dataset.zone) || (ordState.zones.has("all") && b.dataset.zone === "all"));
    });
  }
  ordApplyFilters();
}

function ordToggleDriver(btn, driver) {
  if (driver === "all") {
    ordState.drivers = new Set(["all"]);
    document.querySelectorAll("#ord-driver-chips .ord-chip").forEach(b => b.classList.toggle("is-active", b.dataset.driver === "all"));
  } else {
    ordState.drivers.delete("all");
    if (ordState.drivers.has(driver)) ordState.drivers.delete(driver);
    else ordState.drivers.add(driver);
    if (ordState.drivers.size === 0) ordState.drivers.add("all");
    document.querySelectorAll("#ord-driver-chips .ord-chip").forEach(b => {
      b.classList.toggle("is-active", ordState.drivers.has(b.dataset.driver) || (ordState.drivers.has("all") && b.dataset.driver === "all"));
    });
  }
  ordApplyFilters();
}

function ordToggleStatus(btn, status) {
  if (status === "all") {
    ordState.statuses = new Set(["all"]);
    document.querySelectorAll("[data-status]").forEach(b => b.classList.toggle("is-active", b.dataset.status === "all"));
  } else if (status === "archived") {
    if (ordState.statuses.has("archived")) {
      ordState.statuses = new Set(["all"]);
    } else {
      ordState.statuses = new Set(["archived"]);
    }
    document.querySelectorAll("[data-status]").forEach(b => {
      b.classList.toggle("is-active", ordState.statuses.has(b.dataset.status) || (ordState.statuses.has("all") && b.dataset.status === "all"));
    });
  } else {
    ordState.statuses.delete("all");
    ordState.statuses.delete("archived");
    if (ordState.statuses.has(status)) ordState.statuses.delete(status);
    else ordState.statuses.add(status);
    if (ordState.statuses.size === 0) ordState.statuses.add("all");
    document.querySelectorAll("[data-status]").forEach(b => {
      b.classList.toggle("is-active", ordState.statuses.has(b.dataset.status) || (ordState.statuses.has("all") && b.dataset.status === "all"));
    });
  }
  ordApplyFilters();
}

function ordToggleFlag(btn, flag) {
  if (ordState.flags.has(flag)) ordState.flags.delete(flag);
  else ordState.flags.add(flag);
  btn.classList.toggle("is-active", ordState.flags.has(flag));
  ordApplyFilters();
}

// กด "ดูจุดที่ไม่มีโซน" จาก zone alert
function ordFilterNoZone() {
  ordState.flags = new Set(["nozone"]);
  ordState.zones = new Set(["all"]);
  document.getElementById("ord-flag-nozone")?.classList.add("is-active");
  ordApplyFilters();
}

// =====================================
// Apply Filters + Render
// =====================================
function ordApplyFilters() {
  const fromEl = document.getElementById("ord-date-from");
  const toEl   = document.getElementById("ord-date-to");
  const searchEl = document.getElementById("ord-search");
  if (fromEl) ordState.dateFrom = fromEl.value;
  if (toEl)   ordState.dateTo   = toEl.value;
  if (searchEl) ordState.search = searchEl.value.trim().toLowerCase();

  const all = supState.allOrdersAll;
  const INACTIVE = new Set(["ยกเลิก", "ส่งสำเร็จ", "ได้รับแล้ว", "cancelled", "delivered", "received"]);

  // ---- Helper: normalize phone (strip non-digits, add 0 prefix if 9 digits) ----
  function normPhone(raw) {
    if (!raw) return "";
    let d = String(raw).replace(/\D/g, "");
    if (d.startsWith("66") && !d.startsWith("660") && d.length === 11) d = "0" + d.slice(2);
    if (d.startsWith("00") && d.length === 11) d = "0" + d.slice(2);
    if (d.length === 9 && /^[689]/.test(d)) d = "0" + d;
    return d;
  }

  const q = ordState.search;
  const qPhone = normPhone(q);
  const isArchivedFilter = ordState.statuses.has("archived");

  let result = all.filter(o => {
    // (0) Archived filter: ถ้าดูแท็บ archived ต้องเป็นออเดอร์ที่ถูก archive, ถ้าดูแท็บทั่วไปต้องไม่ใช่ archived
    if (isArchivedFilter) {
      if (!o.isArchived) return false;
    } else {
      if (o.isArchived) return false;
    }

    // (1) สถานะ inactive ออก (ยกเลิก / ส่งสำเร็จ / ได้รับแล้ว) ถ้าไม่ได้อยู่ในโหมด archived
    const rawStatus = (o.rawStatus || o.apiStatus || "").trim();
    if (!isArchivedFilter && INACTIVE.has(rawStatus)) return false;

    // (2) กรองวันส่ง (คอลัมน์ B คำสั่งซื้อ)
    const isoDate = ordToISO(o.deliveryDate || o.timeWindow || "");
    if (ordState.dateFrom && isoDate && isoDate < ordState.dateFrom) return false;
    if (ordState.dateTo   && isoDate && isoDate > ordState.dateTo)   return false;

    // (3) โซน
    if (!ordState.zones.has("all")) {
      const z = o.geojsonZone || "UNASSIGNED";
      const matched = Array.from(ordState.zones).some(filterZone => {
        if (filterZone === "UNASSIGNED" || filterZone === "ไม่มีโซน") {
          return !o.geojsonZone || o.geojsonZone === "UNASSIGNED" || o.geojsonZone === "ไม่มีโซน";
        }
        if (filterZone === "Zone A") return z.includes("Zone A") && !z.includes("Zone AB") && !z.includes("Zone AC");
        if (filterZone === "Zone B") return z.includes("Zone B") && !z.includes("Zone AB");
        if (filterZone === "Zone C") return z.includes("Zone C") && !z.includes("Zone AC") && !z.includes("Zone CD");
        if (filterZone === "Zone D") return z.includes("Zone D") && !z.includes("Zone CD");
        if (filterZone === "Zone AB") return z.includes("Zone AB");
        if (filterZone === "Zone AC") return z.includes("Zone AC");
        if (filterZone === "Zone CD") return z.includes("Zone CD");
        return z.includes(filterZone) || filterZone.includes(z);
      });
      if (!matched) return false;
    }

    // (4) คนขับ
    if (!ordState.drivers.has("all")) {
      if (ordState.drivers.has("none")) {
        if (o.assignedDriverId) return false;
      } else if (!ordState.drivers.has(o.assignedDriverId)) {
        return false;
      }
    }

    // (5) สถานะ (ถ้าไม่ใช่โหมด archived)
    if (!isArchivedFilter && !ordState.statuses.has("all")) {
      const mappedStatus = mapApiStatus(rawStatus, o.status);
      if (!ordState.statuses.has(mappedStatus)) return false;
    }

    // (6) ธงปัญหา
    if (ordState.flags.size > 0) {
      const hasNoZone  = !o.geojsonZone || o.geojsonZone === "UNASSIGNED";
      const hasNoCoord = !parseFloat(o.lat) || !parseFloat(o.lng);
      const hasNoDate  = !(o.deliveryDate || o.timeWindow);
      const flagged = (ordState.flags.has("nozone")  && hasNoZone)
                   || (ordState.flags.has("nocoord") && hasNoCoord)
                   || (ordState.flags.has("nodate")  && hasNoDate);
      if (!flagged) return false;
    }

    // (7) ค้นหา
    if (q) {
      const uid  = (o.uid || o.id || "").toLowerCase();
      const name = (o.customer || o.customerName || o.name || "").toLowerCase();
      const phone = normPhone(o.phone);
      if (!uid.includes(q) && !name.includes(q) && !phone.includes(qPhone)) return false;
    }

    return true;
  });

  // ---- Sort ----
  result = ordSortData(result);
  ordState.filtered = result;
  ordState.rendered = 0;

  // ---- Update flag counts ----
  ordUpdateFlagCounts();

  // ---- Update zone alert ----
  const noZoneCount = all.filter(o => !o.geojsonZone || o.geojsonZone === "UNASSIGNED").length;
  const alertEl = document.getElementById("ord-zone-alert");
  const alertMsg = document.getElementById("ord-zone-alert-msg");
  if (alertEl) alertEl.style.display = noZoneCount > 20 ? "flex" : "none";
  if (alertMsg) alertMsg.textContent = `${noZoneCount.toLocaleString()} จุดยังไม่มีโซน — อาจเป็นเพราะโซนที่วาดไว้ยังไม่ครอบคลุมพื้นที่จริง`;
  const nozoneFlagCount = document.getElementById("ord-flag-count-nozone");
  if (nozoneFlagCount) nozoneFlagCount.textContent = noZoneCount;

  // ---- Result count ----
  const countEl = document.getElementById("ord-result-count");
  const hintEl  = document.getElementById("ord-result-hint");
  if (countEl) countEl.textContent = `${result.length.toLocaleString()} ออเดอร์`;
  if (hintEl) hintEl.textContent = result.length !== all.length
    ? `(จาก ${all.length.toLocaleString()} ทั้งหมด)`
    : "";

  if (ordState.viewMode === 'split') {
    ordRenderSplitCards();
    ordRenderMapMarkers();
  } else {
    ordRenderTable();
  }
  ordRenderMobileCards();
  ordUpdateStickyBar();
}

function ordUpdateFlagCounts() {
  const all = supState.allOrdersAll;
  const activeOnly = all.filter(o => !o.isArchived);
  const noZone  = activeOnly.filter(o => !o.geojsonZone || o.geojsonZone === "UNASSIGNED").length;
  const noCoord = activeOnly.filter(o => !parseFloat(o.lat) || !parseFloat(o.lng)).length;
  const noDate  = activeOnly.filter(o => !(o.deliveryDate || o.timeWindow)).length;
  const archivedCount = all.filter(o => o.isArchived).length;

  const nz = document.getElementById("ord-flag-count-nozone");
  const nc = document.getElementById("ord-flag-count-nocoord");
  const nd = document.getElementById("ord-flag-count-nodate");
  const arch = document.getElementById("ord-chip-archived");

  if (nz) nz.textContent = noZone.toLocaleString();
  if (nc) nc.textContent = noCoord.toLocaleString();
  if (nd) nd.textContent = noDate.toLocaleString();
  if (arch) arch.textContent = archivedCount.toLocaleString();
}

function ordUpdateStickyBar() {
  const list = ordState.filtered || [];
  const driversCount = (DRIVER_PROFILES || []).length;
  const unassigned = list.filter(o => !o.assignedDriverId).length;
  const done = list.filter(o => o.status === "done").length;
  const codTotal = list.reduce((sum, o) => {
    const isCod = o.cod || (o.paymentType || "").toLowerCase().includes("cod") || (o.paymentType || "").includes("เก็บเงิน");
    const p = parseFloat(o.price) || 0;
    return isCod ? sum + p : sum;
  }, 0);

  const elDrivers = document.getElementById("ord-sticky-active-drivers");
  const elUnassigned = document.getElementById("ord-sticky-unassigned-orders");
  const elDone = document.getElementById("ord-sticky-done-orders");
  const elCod = document.getElementById("ord-sticky-total-cod");

  if (elDrivers) elDrivers.textContent = `${driversCount} คน`;
  if (elUnassigned) elUnassigned.textContent = `${unassigned.toLocaleString()} จุด`;
  if (elDone) elDone.textContent = `${done.toLocaleString()} จุด`;
  if (elCod) elCod.textContent = `฿${codTotal.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// =====================================
// Sort
// =====================================
function ordSort(col) {
  if (ordState.sortCol === col) {
    ordState.sortDir = ordState.sortDir === "asc" ? "desc" : "asc";
  } else {
    ordState.sortCol = col;
    ordState.sortDir = "asc";
  }
  document.querySelectorAll(".ord-sortable").forEach(th => {
    th.classList.remove("is-sorted-asc", "is-sorted-desc");
    if (th.dataset.col === col) th.classList.add(`is-sorted-${ordState.sortDir}`);
  });
  ordApplyFilters();
}

function ordSortData(arr) {
  const col = ordState.sortCol;
  const dir = ordState.sortDir === "asc" ? 1 : -1;
  return [...arr].sort((a, b) => {
    let av = a[col] || "", bv = b[col] || "";
    if (col === "price") {
      av = parseFloat(av) || 0;
      bv = parseFloat(bv) || 0;
    } else if (col === "deliveryDate" || col === "timeWindow") {
      av = ordParseDateTimestamp(a.deliveryDate || a.timeWindow || "");
      bv = ordParseDateTimestamp(b.deliveryDate || b.timeWindow || "");
      if (!av && bv) return 1;
      if (av && !bv) return -1;
    } else if (col === "orderPlacedAt" || col === "orderedAt" || col === "syncDeliveryAt") {
      av = ordParseDateTimestamp(a.orderPlacedAt || a.syncDeliveryAt || a.orderDate || "");
      bv = ordParseDateTimestamp(b.orderPlacedAt || b.syncDeliveryAt || b.orderDate || "");
      if (!av && bv) return 1;
      if (av && !bv) return -1;
    } else if (col === "customer") {
      av = (a.customer || "").toString();
      bv = (b.customer || "").toString();
      return dir * av.localeCompare(bv, 'th');
    }
    if (av < bv) return -dir;
    if (av > bv) return dir;
    return 0;
  });
}

let ordSplitMap = null;
let ordMarkersLayer = null;

function ordSetViewMode(mode) {
  ordState.viewMode = mode;
  const splitBtn = document.getElementById('ord-view-split-btn');
  const tableBtn = document.getElementById('ord-view-table-btn');
  const splitView = document.getElementById('ord-split-view');
  const tableWrap = document.getElementById('ord-table-wrap');

  if (mode === 'split') {
    if (splitBtn) splitBtn.classList.add('is-active');
    if (tableBtn) tableBtn.classList.remove('is-active');
    if (splitView) splitView.style.display = 'grid';
    if (tableWrap) tableWrap.style.display = 'none';

    ordInitSplitMap();
    ordApplyFilters();
    setTimeout(() => { if (ordSplitMap) ordSplitMap.invalidateSize(); }, 150);
  } else {
    if (splitBtn) splitBtn.classList.remove('is-active');
    if (tableBtn) tableBtn.classList.add('is-active');
    if (splitView) splitView.style.display = 'none';
    if (tableWrap) tableWrap.style.display = 'block';
    ordApplyFilters();
  }
}

function ordInitSplitMap() {
  if (ordSplitMap) {
    setTimeout(() => ordSplitMap.invalidateSize(), 100);
    return;
  }
  const container = document.getElementById('ord-split-map');
  if (!container) return;

  ordSplitMap = L.map('ord-split-map', { zoomControl: false }).setView([WAREHOUSE_HUB.lat, WAREHOUSE_HUB.lng], 12);

  L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
    maxZoom: 19,
    attribution: '© Unii Mart 584'
  }).addTo(ordSplitMap);

  L.control.zoom({ position: 'topright' }).addTo(ordSplitMap);

  // Warehouse hub marker
  const warehouseIcon = L.divIcon({
    className: '',
    html: `<div style="background:var(--ink);color:#fff;border-radius:50%;width:34px;height:34px;display:flex;align-items:center;justify-content:center;box-shadow:0 3px 10px rgba(0,0,0,0.3);border:2px solid #fff;font-size:14px;"><i class="fa-solid fa-warehouse"></i></div>`,
    iconSize: [34, 34],
    iconAnchor: [17, 17]
  });
  L.marker([WAREHOUSE_HUB.lat, WAREHOUSE_HUB.lng], { icon: warehouseIcon })
    .addTo(ordSplitMap)
    .bindPopup('<b>คลังสินค้า 584 (Hub)</b><br>จุดเริ่มต้นกระจายสินค้า');

  ordMarkersLayer = L.layerGroup().addTo(ordSplitMap);

  // Render GeoJSON Zones if available
  try {
    if (supState.geojsonPolygons && supState.geojsonPolygons.length > 0) {
      supState.geojsonPolygons.forEach(feature => {
        L.geoJSON(feature, {
          style: {
            color: feature.properties?.color || '#3b82f6',
            weight: 2,
            opacity: 0.6,
            fillOpacity: 0.08
          }
        }).addTo(ordSplitMap);
      });
    }
  } catch (e) {
    console.warn('[ordInitSplitMap] GeoJSON zones error:', e);
  }
}

function ordRenderSplitCards() {
  const container = document.getElementById('ord-split-cards-list');
  if (!container) return;

  const items = ordState.filtered || [];
  if (items.length === 0) {
    container.innerHTML = `<div style="padding:40px 20px;text-align:center;color:var(--ink-3);"><i class="fa-solid fa-inbox" style="font-size:28px;margin-bottom:8px;"></i><div>ไม่พบรายการออเดอร์</div></div>`;
    return;
  }

  container.innerHTML = items.slice(0, 100).map(o => {
    const uid = o.uid || o.id || '';
    const name = escHtml(o.customer || o.customerName || o.name || '—');
    const isoDate = ordToISO(o.deliveryDate || o.timeWindow || '');
    const dateDisplay = isoDate ? formatThaiDate(o.deliveryDate || o.timeWindow) : '—';
    const price = fmtBaht(o.price);
    const mappedStatus = mapApiStatus(o.rawStatus || o.apiStatus, o.status);

    const barVar = { done: '--st-done', mine: '--st-mine', failed: '--st-failed', available: '--st-available' }[o.status] || '--line-strong';

    const phone = o.phone || '';
    const photoUrl = phone ? photoDbGet(phone) : null;
    const thumbInner = photoUrl
      ? `<img src="${photoUrl}" alt="รูปร้าน" loading="lazy">`
      : `<i class="fa-solid fa-store"></i>`;

    const rc = ordState.routecodes[uid];
    const rcBadge = rc ? `<span class="ord-routecode-badge" title="รหัสรูท"><i class="fa-solid fa-route" style="font-size:9px"></i> ${escHtml(rc.routeCode)}</span>` : '';

    const overdueInfo = ordCheckOverdue(o, supState.selectedDate);
    const isOverdue = overdueInfo.isOverdue;
    const overdueBadge = isOverdue ? `<span class="ord-alert-tag ord-alert-tag--overdue" style="font-size:9px;padding:1px 5px;"><i class="fa-solid fa-triangle-exclamation"></i> เลยวันส่ง (${overdueInfo.days} วัน)</span>` : '';

    const orderedRaw = o.orderPlacedAt || o.syncDeliveryAt || o.orderDate || '';
    const daysAgo = ordGetDaysAgo(orderedRaw, o.deliveryDate || o.timeWindow);
    let orderDateHTML = '';
    if (daysAgo !== null) {
      const isStale = daysAgo >= 2;
      const label = daysAgo === 0 ? 'สั่งวันนี้ (0 วัน)' : `สั่งเมื่อ ${daysAgo} วันก่อน`;
      orderDateHTML = `<span class="ord-split-card-date-item ${isStale ? 'is-stale' : ''}" title="วันที่สั่งซื้อ: ${escHtml(orderedRaw)}"><i class="fa-regular fa-clock"></i> ${label}</span>`;
    }

    let delivDateHTML = '';
    if (o.isArchived) {
      delivDateHTML = `<span class="ord-split-card-date-item" style="color:#d97706;font-weight:700;"><i class="fa-solid fa-box-archive"></i> พักรอ</span>`;
    } else if (isoDate) {
      delivDateHTML = `<span class="ord-split-card-deliv-date ${isOverdue ? 'is-overdue' : ''}" title="วันที่จะจัดส่ง"><i class="fa-regular fa-calendar-days"></i> ${dateDisplay}</span>`;
    } else {
      delivDateHTML = `<span class="ord-split-card-date-item" style="color:var(--ink-3);" title="ยังไม่กำหนดวันส่ง"><i class="fa-solid fa-calendar-xmark"></i> ไม่กำหนดวัน</span>`;
    }

    return `
      <div class="ord-split-card ord-status--${mappedStatus} ${isOverdue ? 'is-overdue' : ''}"
        id="ord-split-card-${escHtml(uid)}"
        style="--bar-color:var(${barVar});"
        onclick="ordSelectSplitCard('${escHtml(uid)}', ${parseFloat(o.lat)||0}, ${parseFloat(o.lng)||0})">
        <div class="ord-split-card-thumb">
          ${thumbInner}
        </div>
        <div class="ord-split-card-body">
          <div class="ord-split-card-top">
            <div class="ord-split-card-name" title="${name}">${name}</div>
            <div class="ord-split-card-price">${price}</div>
          </div>
          <div class="ord-split-card-uid">
            ${escHtml(uid)} ${rcBadge} ${overdueBadge}
          </div>
          <div class="ord-split-card-bottom">
            <div class="ord-split-card-left-tags">
              ${ordZoneChipHTML(o.geojsonZone)}
              ${ordStatusChipHTML(o.status, o.apiStatus)}
            </div>
            <div class="ord-split-card-right-dates">
              ${orderDateHTML}
              ${delivDateHTML}
            </div>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

function ordRenderMapMarkers() {
  if (!ordSplitMap || !ordMarkersLayer) return;
  ordMarkersLayer.clearLayers();

  const items = (ordState.filtered || []).filter(o => parseFloat(o.lat) && parseFloat(o.lng));
  if (items.length === 0) return;

  const latLngs = [];

  items.forEach(o => {
    const uid = o.uid || o.id || '';
    const lat = parseFloat(o.lat);
    const lng = parseFloat(o.lng);

    if (!o.isOutOfBounds && lat >= 18.0 && lat <= 19.1 && lng >= 98.6 && lng <= 99.4) {
      latLngs.push([lat, lng]);
    }

    const statusCls = `is-${o.status || 'available'}`;
    const markerIcon = L.divIcon({
      className: '',
      html: `<div class="ord-map-pin ${statusCls}" id="ord-pin-${escHtml(uid)}"><i class="fa-solid fa-store"></i></div>`,
      iconSize: [28, 28],
      iconAnchor: [14, 14]
    });

    const price = fmtBaht(o.price);
    const dateDisplay = formatThaiDate(o.deliveryDate || o.timeWindow);

    const popupHtml = `
      <div style="font-family:'Sarabun',sans-serif;font-size:12px;min-width:180px;">
        <div style="font-weight:700;font-size:14px;color:var(--ink);margin-bottom:2px;">${escHtml(o.customer || 'ร้านค้า')}</div>
        <div style="font-family:monospace;font-size:10px;color:var(--ink-3);">${escHtml(uid)}</div>
        <div style="font-size:11px;color:var(--ink-2);margin:4px 0;">${escHtml(o.address || '')}</div>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-top:6px;border-top:1px solid #eee;padding-top:6px;">
          <strong style="color:var(--st-mine);font-size:13px;">${price}</strong>
          <span style="font-size:10px;color:var(--ink-3);">${dateDisplay}</span>
        </div>
        <button class="btn btn--primary btn--sm" style="width:100%;margin-top:6px;font-size:11px;padding:3px 6px;cursor:pointer;" onclick="ordOpenDetail('${escHtml(uid)}')">
          ดูรายละเอียดออเดอร์
        </button>
      </div>
    `;

    const marker = L.marker([lat, lng], { icon: markerIcon })
      .bindPopup(popupHtml)
      .addTo(ordMarkersLayer);

    marker.on('click', () => {
      document.querySelectorAll('.ord-split-card').forEach(c => c.classList.remove('is-active'));
      const cardEl = document.getElementById(`ord-split-card-${uid}`);
      if (cardEl) {
        cardEl.classList.add('is-active');
        cardEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    });
  });

  if (latLngs.length > 0) {
    const bounds = L.latLngBounds(latLngs);
    ordSplitMap.fitBounds(bounds, { padding: [30, 30], maxZoom: 13 });
  } else {
    ordSplitMap.setView([WAREHOUSE_HUB.lat, WAREHOUSE_HUB.lng], 12);
  }
}

function ordSelectSplitCard(uid, lat, lng) {
  document.querySelectorAll('.ord-split-card').forEach(c => c.classList.remove('is-active'));
  const cardEl = document.getElementById(`ord-split-card-${uid}`);
  if (cardEl) cardEl.classList.add('is-active');

  if (ordSplitMap && lat && lng) {
    ordSplitMap.flyTo([lat, lng], 15, { duration: 0.5 });
    if (ordMarkersLayer) {
      ordMarkersLayer.eachLayer(layer => {
        if (layer.getLatLng && Math.abs(layer.getLatLng().lat - lat) < 0.0001 && Math.abs(layer.getLatLng().lng - lng) < 0.0001) {
          layer.openPopup();
        }
      });
    }
  }
}

// =====================================
// Table Rendering (virtualized in slices)
// =====================================
function ordRenderTable() {
  const tbody = document.getElementById("ord-tbody");
  if (!tbody) return;

  const slice = ordState.filtered.slice(0, ordState.PAGE_SIZE);
  ordState.rendered = slice.length;

  if (slice.length === 0) {
    tbody.innerHTML = `<tr class="sup-empty-row"><td colspan="11"><i class="fa-solid fa-inbox"></i> ไม่พบออเดอร์ที่ตรงเงื่อนไข</td></tr>`;
    document.getElementById("ord-load-more").style.display = "none";
    return;
  }

  tbody.innerHTML = slice.map(o => ordRowHTML(o)).join("");

  const loadMore = document.getElementById("ord-load-more");
  if (loadMore) {
    loadMore.style.display = ordState.filtered.length > ordState.rendered ? "block" : "none";
  }
}

function ordLoadMoreRows() {
  const tbody = document.getElementById("ord-tbody");
  if (!tbody) return;
  const slice = ordState.filtered.slice(ordState.rendered, ordState.rendered + ordState.PAGE_SIZE);
  ordState.rendered += slice.length;
  tbody.insertAdjacentHTML("beforeend", slice.map(o => ordRowHTML(o)).join(""));
  const loadMore = document.getElementById("ord-load-more");
  if (loadMore) loadMore.style.display = ordState.filtered.length > ordState.rendered ? "block" : "none";
}

function ordRowHTML(o) {
  const uid   = o.uid || o.id || "";
  const name  = escHtml(o.customer || o.customerName || o.name || "—");
  const uidShort = uid.slice(-6);
  const isoDate = ordToISO(o.deliveryDate || o.timeWindow || "");
  const dateDisplay = isoDate ? formatThaiDate(o.deliveryDate || o.timeWindow) : '<span class="ord-flag-icon--nodate">—</span>';

  const hasNoZone  = !o.geojsonZone || o.geojsonZone === "UNASSIGNED" || o.geojsonZone === "ไม่มีโซน";
  const hasNoCoord = !parseFloat(o.lat) || !parseFloat(o.lng);
  const hasNoDate  = !isoDate;
  const isFlagged  = hasNoZone || hasNoCoord || hasNoDate;

  // Overdue Check (เลยวันส่ง)
  const overdueInfo = ordCheckOverdue(o, supState.selectedDate);
  const isOverdue = overdueInfo.isOverdue;

  const alertTags = [];
  if (o.isArchived) {
    alertTags.push(`<span class="ord-alert-tag ord-alert-tag--archived" title="ออเดอร์พักรอ: ${escHtml(o.archiveReason || 'ติดขั้นตอน')}"><i class="fa-solid fa-box-archive"></i> พักรอ: ${escHtml(o.archiveReason || 'ติดขั้นตอน')}</span>`);
  }
  if (hasNoDate && !o.isArchived) alertTags.push(`<span class="ord-alert-tag ord-alert-tag--nodate" title="ยังไม่ได้กำหนดวันที่จะจัดส่ง"><i class="fa-solid fa-calendar-xmark"></i> ไม่กำหนดวันส่ง</span>`);
  if (hasNoCoord) alertTags.push(`<span class="ord-alert-tag ord-alert-tag--nocoord" title="ไม่มีพิกัด GPS ร้านค้า"><i class="fa-solid fa-circle-exclamation"></i> ไม่มีพิกัด</span>`);
  if (hasNoZone && !hasNoCoord) alertTags.push(`<span class="ord-alert-tag ord-alert-tag--nozone" title="อยู่นอกขอบเขตโซนจัดส่ง"><i class="fa-solid fa-location-crosshairs"></i> ไม่มีโซน</span>`);
  if (isOverdue && !o.isArchived) alertTags.push(`<span class="ord-alert-tag ord-alert-tag--overdue" title="เลยกำหนดส่งสินค้าแล้ว ${overdueInfo.days} วัน"><i class="fa-solid fa-triangle-exclamation"></i> เลยวันส่ง (${overdueInfo.days} วัน)</span>`);
  const alertTagsHTML = alertTags.join(' ');

  const flagHTML = isFlagged ? ordFlagHTML(hasNoZone, hasNoCoord, hasNoDate) : "";
  const zoneHTML = ordZoneChipHTML(o.geojsonZone);
  const driverHTML = ordDriverCellHTML(o.assignedDriverId, o.driverNote);
  const mappedStatus = mapApiStatus(o.rawStatus || o.apiStatus, o.status);
  const statusHTML = ordStatusChipHTML(o.status, o.apiStatus);
  const price    = fmtBaht(o.price);
  const isSelected = ordState.selected.has(uid);

  // --- (1) Store Thumbnail ---
  const phone = o.phone || "";
  const photoUrl = phone ? photoDbGet(phone) : null;
  const thumbInner = photoUrl
    ? `<img src="${photoUrl}" alt="รูปร้าน" loading="lazy">`
    : `<i class="fa-solid fa-store"></i>`;
  const thumbHTML = `
    <div class="ord-store-thumb"
      onclick="event.stopPropagation();ordOpenPhotoPopover(event,'${escHtml(phone)}','${escHtml(uid)}')"
      title="รูปหน้าร้าน — คลิกเพื่อเปลี่ยน">
      ${thumbInner}
      <div class="ord-store-thumb-overlay"><i class="fa-solid fa-camera"></i></div>
    </div>`;

  // --- (2) Ordered date (วันที่สั่ง + สั่งมากี่วันแล้ว) ---
  const orderedRaw = o.orderPlacedAt || o.syncDeliveryAt || o.orderDate || "";
  const orderedDisplay = orderedRaw ? ordFormatShortDate(orderedRaw) : "—";
  const daysAgo = ordGetDaysAgo(orderedRaw, o.deliveryDate || o.timeWindow);
  let daysAgoHTML = "";
  if (daysAgo !== null) {
    const isStale = daysAgo >= 2;
    const label = daysAgo === 0 ? "วันนี้ (0 วัน)" : `สั่งเมื่อ ${daysAgo} วันก่อน`;
    daysAgoHTML = `<span class="ord-days-ago-chip ${isStale ? 'is-stale' : ''}"><i class="fa-regular fa-clock"></i> ${label}</span>`;
  }
  const orderedHTML = `
    <div class="ord-placed-wrap">
      <div class="ord-placed-time">${orderedDisplay}</div>
      ${daysAgoHTML}
    </div>
  `;

  // --- (3) Delivery Date column with quick-picker and overdue badge ---
  let deliveryColHTML = "";
  if (o.isArchived) {
    deliveryColHTML = `<span class="chip" style="background:#fef3c7;color:#92400e;border:1px solid #fde68a;font-size:11px;font-weight:700;"><i class="fa-solid fa-box-archive"></i> พักรอ</span>`;
  } else if (hasNoDate) {
    deliveryColHTML = `<button type="button" class="ord-set-date-badge" onclick="event.stopPropagation();ordOpenQuickDateModal('${escHtml(uid)}')" title="คลิกเพื่อกำหนดวันจัดส่ง"><i class="fa-solid fa-calendar-plus"></i> กำหนดวันส่ง</button>`;
  } else if (isOverdue) {
    deliveryColHTML = `
      <div class="ord-delivery-overdue" title="เลยวันจัดส่งแล้ว ${overdueInfo.days} วัน">
        <div class="ord-date-cell-wrap">
          <span>${dateDisplay}</span>
          <button type="button" class="ord-date-edit-btn" onclick="event.stopPropagation();ordOpenQuickDateModal('${escHtml(uid)}')" title="เปลี่ยนวันจัดส่ง"><i class="fa-regular fa-calendar-days"></i></button>
        </div>
        <span class="chip chip--failed" style="font-size:10px; padding:1px 5px; font-weight:700;"><i class="fa-solid fa-clock-rotate-left"></i> เลยวันส่ง (${overdueInfo.days} วัน)</span>
      </div>`;
  } else {
    deliveryColHTML = `
      <div class="ord-date-cell-wrap">
        <span>${dateDisplay}</span>
        <button type="button" class="ord-date-edit-btn" onclick="event.stopPropagation();ordOpenQuickDateModal('${escHtml(uid)}')" title="เปลี่ยนวันจัดส่ง"><i class="fa-regular fa-calendar-days"></i></button>
      </div>`;
  }

  // --- (4) Coord column: navigate + pinfix + call ---
  const lat = parseFloat(o.lat);
  const lng = parseFloat(o.lng);
  const hasCoord = lat && lng;
  const isSuspect = hasNoCoord || o.isOutOfBounds;
  const navURL = hasCoord ? `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}` : "";
  const pinCls = `ord-coord-btn ord-coord-btn--pin${isSuspect ? ' is-suspect' : ''}`;
  const pinTitle = isSuspect ? "พิกัดน่าสงสัย — แก้ไขหมุด" : "แก้ไขหมุด";
  const navBtn = hasCoord
    ? `<a href="${navURL}" target="_blank" rel="noopener" class="ord-coord-btn ord-coord-btn--nav" onclick="event.stopPropagation()" title="นำทาง"><i class="fa-solid fa-diamond-turn-right"></i></a>`
    : `<button class="ord-coord-btn" disabled title="ไม่มีพิกัด" style="opacity:0.35"><i class="fa-solid fa-diamond-turn-right"></i></button>`;
  const pinBtn = `<button class="${pinCls}" onclick="event.stopPropagation();ordOpenPinfixModal('${escHtml(uid)}')" title="${pinTitle}"><i class="fa-solid fa-map-pin"></i></button>`;

  // --- (5) Call button ---
  const hasCalledToday = callLogHasToday(uid);
  const callBtn = `<button class="ord-call-btn" onclick="event.stopPropagation();ordOpenCallModal('${escHtml(uid)}')" title="โทร">
    <i class="fa-solid fa-phone"></i>
    ${hasCalledToday ? '<span class="ord-call-badge"></span>' : ''}
  </button>`;

  const coordCellHTML = `<div class="ord-coord-cell">${navBtn}${pinBtn}${callBtn}</div>`;

  return `
  <tr class="ord-tr ord-status--${mappedStatus} ${isFlagged ? "is-flagged" : ""} ${isOverdue ? "is-overdue" : ""} ${isSelected ? "is-selected" : ""}"
      data-uid="${escHtml(uid)}"
      onclick="ordRowClick(event,'${escHtml(uid)}')">
    <td onclick="event.stopPropagation()">
      <input type="checkbox" data-uid="${escHtml(uid)}" ${isSelected ? "checked" : ""}
        onchange="ordToggleRow(this,'${escHtml(uid)}')">
    </td>
    <td>${flagHTML}</td>
    <td>
      <div class="ord-name-cell">
        ${thumbHTML}
        <div class="ord-name-info">
          <div class="ord-name-primary" title="${name}">${name}</div>
          <div class="ord-name-meta">
            <span class="ord-uid-badge" title="เลขออเดอร์: ${escHtml(uid)}">${escHtml(uid)}</span>
            ${(() => { const rc = ordState.routecodes[uid]; return rc ? `<span class="ord-routecode-badge" title="รหัสรูท"><i class="fa-solid fa-route" style="font-size:9px"></i> ${escHtml(rc.routeCode)}</span>` : ''; })()}
            ${alertTagsHTML}
          </div>
          ${o.address ? `<div class="ord-address-line" title="${escHtml(o.address)}">${escHtml((o.address).replace(/, ?ประเทศไทย$/, '').replace(/, ?Thailand$/, ''))}</div>` : ''}
          ${o.district ? `<div class="ord-district-line">${escHtml(o.district)}</div>` : ''}
        </div>
      </div>
    </td>
    <td class="ord-td--ordered">${orderedHTML}</td>
    <td>${deliveryColHTML}</td>
    <td>${zoneHTML}</td>
    <td>${driverHTML}</td>
    <td>${statusHTML}</td>
    <td class="ord-td--price">${price}</td>
    <td class="ord-td--coord" onclick="event.stopPropagation()">
      <div class="ord-coord-cell">
        ${navBtn}${pinBtn}${callBtn}
        ${ordState.routecodes[uid]
          ? `<button class="ord-print-btn ${ordState.printed[uid] ? 'is-printed' : ''}" onclick="event.stopPropagation();ordPrintSingle('${escHtml(uid)}')" title="${ordState.printed[uid] ? 'ปริ้นแล้ว' : 'ปริ้นใบส่งของ'}"><i class="fa-solid fa-print"></i>${ordState.printed[uid] ? '<span class="ord-print-badge"></span>' : ''}</button>`
          : `<button class="ord-print-btn is-disabled" disabled title="ยังไม่มีรหัสรูท"><i class="fa-solid fa-print"></i></button>`}
      </div>
    </td>
    <td class="ord-td--menu">
      <button class="ord-menu-btn" onclick="event.stopPropagation();ordRowMenu(event,'${escHtml(uid)}')" title="เมนู">
        <i class="fa-solid fa-ellipsis-vertical"></i>
      </button>
    </td>
  </tr>`;
}


function ordFlagHTML(noZone, noCoord, noDate) {
  if (noCoord) return `<i class="fa-solid fa-circle-exclamation ord-flag-icon ord-flag-icon--nocoord" title="ไม่มีพิกัด"></i>`;
  if (noZone)  return `<i class="fa-solid fa-location-crosshairs ord-flag-icon ord-flag-icon--nozone" title="ไม่มีโซน"></i>`;
  if (noDate)  return `<i class="fa-solid fa-calendar-xmark ord-flag-icon ord-flag-icon--nodate" title="ไม่กำหนดวันส่ง"></i>`;
  return "";
}

function ordZoneChipHTML(zone) {
  if (!zone || zone === "UNASSIGNED" || zone === "ไม่มีโซน") {
    return `<span class="ord-zone-chip ord-zone-chip--none"><i class="fa-solid fa-location-crosshairs"></i> ไม่มีโซน</span>`;
  }
  
  let cls = 'ord-zone-chip--none';
  let badgeLetter = '';
  
  if (zone.includes('Zone A') && !zone.includes('Zone AB') && !zone.includes('Zone AC')) {
    cls = 'ord-zone-chip--a';
    badgeLetter = 'Zone A';
  } else if (zone.includes('Zone B') && !zone.includes('Zone AB')) {
    cls = 'ord-zone-chip--b';
    badgeLetter = 'Zone B';
  } else if (zone.includes('Zone C') && !zone.includes('Zone AC') && !zone.includes('Zone CD')) {
    cls = 'ord-zone-chip--c';
    badgeLetter = 'Zone C';
  } else if (zone.includes('Zone D') && !zone.includes('Zone CD')) {
    cls = 'ord-zone-chip--d';
    badgeLetter = 'Zone D';
  } else if (zone.includes('Zone AB')) {
    cls = 'ord-zone-chip--ab';
    badgeLetter = 'Zone AB';
  } else if (zone.includes('Zone AC')) {
    cls = 'ord-zone-chip--ac';
    badgeLetter = 'Zone AC';
  } else if (zone.includes('Zone CD')) {
    cls = 'ord-zone-chip--cd';
    badgeLetter = 'Zone CD';
  }

  let displayTitle = zone;
  if (!displayTitle.startsWith('Zone') && badgeLetter) {
    displayTitle = `${badgeLetter} — ${zone}`;
  }

  return `<span class="ord-zone-chip ${cls}" title="${escHtml(zone)}">${escHtml(displayTitle)}</span>`;
}

function ordDriverCellHTML(driverCode, note) {
  if (!driverCode) return `<span style="color:var(--ink-3)">—</span>`;
  const profile = DRIVER_PROFILES.find(d => d.code === driverCode);
  const name = profile ? profile.name.split(" ")[0] : driverCode;
  const avatar = profile ? profile.avatar : driverCode.slice(-3);
  return `<div class="ord-driver-cell">
    <div class="ord-avatar">${escHtml(avatar)}</div>
    <span class="ord-driver-name">${escHtml(name)}</span>
  </div>`;
}

function ordStatusChipHTML(status, rawStatus) {
  const s = status || "available";
  const labels = {
    available: "รอจอง",
    mine:      "จองแล้ว",
    done:      "ส่งสำเร็จ",
    failed:    "ส่งไม่ได้",
    out:       "นอกโซน",
  };
  const clsMap = {
    available: "ord-status-chip--available",
    mine:      "ord-status-chip--mine",
    done:      "ord-status-chip--done",
    failed:    "ord-status-chip--failed",
    out:       "ord-status-chip--out",
  };
  const label = labels[s] || escHtml(rawStatus || s);
  const cls   = clsMap[s] || "ord-status-chip--out";
  return `<span class="ord-status-chip ${cls}">${label}</span>`;
}

function mapApiStatus(rawStatus, localStatus) {
  const done    = ["ส่งสำเร็จ", "ได้รับแล้ว", "delivered", "received"];
  const failed  = ["ส่งไม่สำเร็จ", "failed"];
  const cancelled = ["ยกเลิก", "cancelled"];
  if (localStatus === "done" || done.includes(rawStatus)) return "done";
  if (localStatus === "failed" || failed.includes(rawStatus)) return "failed";
  if (localStatus === "mine") return "mine";
  return "available";
}

// =====================================
// Mobile Card List
// =====================================
function ordRenderMobileCards() {
  const container = document.getElementById("ord-card-list");
  if (!container) return;
  const slice = ordState.filtered.slice(0, ordState.PAGE_SIZE);
  if (slice.length === 0) {
    container.innerHTML = `<div style="text-align:center;padding:40px;color:var(--ink-3)"><i class="fa-solid fa-inbox"></i> ไม่พบออเดอร์</div>`;
    return;
  }
  container.innerHTML = slice.map(o => ordMobileCardHTML(o)).join("");
}

function ordMobileCardHTML(o) {
  const uid   = o.uid || o.id || "";
  const name  = escHtml(o.customer || o.customerName || o.name || "—");
  const uidShort = uid.slice(-8);
  const isoDate = ordToISO(o.deliveryDate || o.timeWindow || "");
  const dateDisplay = isoDate ? formatThaiDate(o.deliveryDate || o.timeWindow) : "—";
  const price = fmtBaht(o.price);
  const hasNoZone  = !o.geojsonZone || o.geojsonZone === "UNASSIGNED";
  const hasNoCoord = !parseFloat(o.lat) || !parseFloat(o.lng);
  const hasNoDate  = !isoDate;
  const isFlagged  = hasNoZone || hasNoCoord || hasNoDate;

  const overdueInfo = ordCheckOverdue(o, supState.selectedDate);
  const isOverdue = overdueInfo.isOverdue;
  const overdueBadge = isOverdue ? `<span class="ord-alert-tag ord-alert-tag--overdue" style="font-size:9px;padding:1px 5px;"><i class="fa-solid fa-triangle-exclamation"></i> เลยวันส่ง (${overdueInfo.days} วัน)</span>` : '';

  const orderedRaw = o.orderPlacedAt || o.syncDeliveryAt || o.orderDate || '';
  const daysAgo = ordGetDaysAgo(orderedRaw, o.deliveryDate || o.timeWindow);
  const daysAgoHTML = daysAgo !== null ? `<span class="ord-days-ago-chip ${daysAgo >= 2 ? 'is-stale' : ''}"><i class="fa-regular fa-clock"></i> ${daysAgo === 0 ? 'สั่งวันนี้ (0 วัน)' : `สั่งเมื่อ ${daysAgo} วันก่อน`}</span>` : '';

  // bar color by status
  const barVar = { done:"--st-done", mine:"--st-mine", failed:"--st-failed", available:"--st-available" }[o.status] || "--line-strong";

  return `
  <div class="ord-mobile-card ${isFlagged ? "is-flagged" : ""} ${isOverdue ? "is-overdue" : ""}" style="--bar-color:var(${barVar})"
    onclick="ordOpenDetail('${escHtml(uid)}')">
    <input type="checkbox" class="ord-mobile-card-checkbox" data-uid="${escHtml(uid)}"
      onclick="event.stopPropagation()" onchange="ordToggleRow(this,'${escHtml(uid)}')">
    <div class="ord-mobile-card-top">
      <div>
        <div class="ord-mobile-card-name">${name}</div>
        <div class="ord-mobile-card-uid">${uidShort} ${overdueBadge}</div>
      </div>
    </div>
    <div class="ord-mobile-card-chips">
      ${ordZoneChipHTML(o.geojsonZone)}
      ${ordStatusChipHTML(o.status, o.apiStatus)}
      ${daysAgoHTML}
    </div>
    <div class="ord-mobile-card-meta">
      <span style="color:${isOverdue ? '#dc2626;font-weight:600;' : 'inherit;'}"><i class="fa-regular fa-calendar fa-xs"></i> ${dateDisplay}</span>
      <span class="ord-mobile-card-price">${price}</span>
    </div>
  </div>`;
}

// =====================================
// Row click → open detail
// =====================================
function ordRowClick(e, uid) {
  // ถ้าคลิก checkbox → ไม่เปิด
  if (e.target.type === "checkbox") return;
  ordOpenDetail(uid);
}

function ordRowMenu(e, uid) {
  e.stopPropagation();
  // Simple context: คลิกเมนูเปิด detail ก่อน (ใช้ slide-over แทน dropdown)
  ordOpenDetail(uid);
}

// =====================================
// Selection
// =====================================
function ordToggleRow(checkbox, uid) {
  if (checkbox.checked) ordState.selected.add(uid);
  else ordState.selected.delete(uid);
  ordUpdateBulkBar();
}

function ordToggleSelectAll(masterCb) {
  if (masterCb.checked) {
    ordState.filtered.slice(0, ordState.rendered).forEach(o => {
      ordState.selected.add(o.uid || o.id);
    });
  } else {
    ordState.selected.clear();
  }
  // Re-render to reflect selection state
  ordRenderTable();
  ordRenderMobileCards();
  ordUpdateBulkBar();
}

function ordClearSelection() {
  ordState.selected.clear();
  ordRenderTable();
  ordRenderMobileCards();
  ordUpdateBulkBar();
}

function ordUpdateBulkBar() {
  const bar = document.getElementById("ord-bulk-bar");
  const countEl = document.getElementById("ord-bulk-count");
  if (!bar) return;
  const count = ordState.selected.size;
  bar.classList.toggle("is-visible", count > 0);
  if (countEl) countEl.textContent = count;
}

// =====================================
// Slide-over Detail Panel
// =====================================
function ordOpenDetail(uid) {
  const order = supState.allOrdersAll.find(o => (o.uid||o.id) === uid);
  if (!order) return;
  ordState.detailOrder = order;

  const titleEl = document.getElementById("ord-detail-title");
  const uidEl   = document.getElementById("ord-detail-uid");
  const bodyEl  = document.getElementById("ord-slideover-body");

  if (titleEl) titleEl.textContent = order.customer || order.customerName || order.name || "—";
  if (uidEl)   uidEl.textContent   = uid;

  if (bodyEl) bodyEl.innerHTML = ordDetailHTML(order);

  // overlay + slideover
  document.getElementById("ord-slideover-overlay")?.classList.add("is-open");
  document.getElementById("ord-slideover")?.classList.add("is-open");
}

function ordCloseDetail() {
  document.getElementById("ord-slideover-overlay")?.classList.remove("is-open");
  document.getElementById("ord-slideover")?.classList.remove("is-open");
  ordState.detailOrder = null;
}

function ordDetailHTML(o) {
  const uid  = o.uid || o.id || "";
  const price = (parseFloat(o.price)||0).toLocaleString("th-TH",{minimumFractionDigits:2});
  const lat  = (parseFloat(o.lat)||0).toFixed(5);
  const lng  = (parseFloat(o.lng)||0).toFixed(5);
  const hasCoord = parseFloat(o.lat) && parseFloat(o.lng);
  const coordSource = o.isPinModified ? "แก้ไขแล้ว" : (o.inCsMaster ? "จาก CS Master" : "จาก Unii API");
  const deliveryDateVal = o.deliveryDate || o.timeWindow || "";

  // zone options
  const zoneOptions = [
    `<option value="">— ให้ระบบคำนวณจากพิกัด —</option>`,
    ...Object.keys(GEOJSON_ZONES).map(z =>
      `<option value="${escHtml(z)}" ${o.geojsonZone===z?"selected":""}>${escHtml(z)}</option>`
    ),
    `<option value="UNASSIGNED" ${o.geojsonZone==="UNASSIGNED"?"selected":""}>กำหนดเป็น "ไม่มีโซน" (ข้อยกเว้น)</option>`,
  ].join("");

  // driver options (exclude inactive drivers unless currently assigned to this order)
  const driverOptions = [
    `<option value="">— ยังไม่มีคนขับ —</option>`,
    ...DRIVER_PROFILES
      .filter(d => d.status !== 'inactive' || o.assignedDriverId === d.code)
      .map(d =>
        `<option value="${escHtml(d.code)}" ${o.assignedDriverId===d.code?"selected":""}>${escHtml(d.name)}${d.status === 'inactive' ? ' (ปิดรับงาน)' : ''}</option>`
      ),
  ].join("");

  // SKU Details
  const skuItems = (supState.skuDetails && supState.skuDetails[uid]) || [];
  const totalSkuQty = skuItems.reduce((sum, it) => sum + (parseFloat(it.qty) || 1), 0);

  const skuItemsHTML = skuItems.length > 0
    ? skuItems.map((it, idx) => `
        <div class="ord-sku-item-row">
          <div class="ord-sku-item-info">
            <div class="ord-sku-item-name" title="${escHtml(it.name)}">${idx + 1}. ${escHtml(it.name)}</div>
            <div class="ord-sku-item-sub">
              <span class="ord-sku-code">SKU: ${escHtml(it.sku)}</span>
              ${it.pricePerUnit ? `<span class="ord-sku-unit-price">@฿${parseFloat(it.pricePerUnit).toLocaleString('th-TH',{minimumFractionDigits:2})}</span>` : ''}
              ${it.orderedAt ? `<span style="color:var(--ink-3);font-size:10px;"><i class="fa-regular fa-clock fa-xs"></i> ${escHtml(it.orderedAt)}</span>` : ''}
            </div>
          </div>
          <div class="ord-sku-item-qty-col">
            <div class="ord-sku-qty-badge">${it.qty} ${escHtml(it.unit || 'ชิ้น')}</div>
            <div class="ord-sku-item-total">฿${(it.total !== undefined ? it.total : (it.qty * (it.pricePerUnit || 0))).toLocaleString('th-TH',{minimumFractionDigits:2})}</div>
          </div>
        </div>
      `).join('')
    : `<div style="text-align:center;padding:12px;color:var(--ink-3);font-size:12px;background:var(--page);border-radius:6px;"><i class="fa-solid fa-box-open" style="margin-right:4px;"></i>ไม่มีข้อมูลรายการสินค้าในแท็บ SKU Detail</div>`;

  return `
    <!-- 1. ข้อมูลจาก Unii (read-only) -->
    ${o.isArchived ? `
      <div style="background:#fef3c7;border:1px solid #fde68a;border-radius:10px;padding:12px;margin-bottom:14px;color:#92400e;">
        <div style="font-weight:700;display:flex;align-items:center;gap:6px;">
          <i class="fa-solid fa-box-archive"></i> ออเดอร์นี้อยู่ในสถานะพักรอ (Archive)
        </div>
        <div style="font-size:12px;margin-top:4px;">เหตุผล: ${escHtml(o.archiveReason || '—')}</div>
        <button type="button" class="btn btn--primary btn--sm" style="margin-top:8px;" onclick="ordUnarchiveOrder('${escHtml(uid)}')">
          <i class="fa-solid fa-box-open"></i> นำกลับมาจัดส่ง (Unarchive)
        </button>
      </div>` : `
      <div style="display:flex;justify-content:flex-end;margin-bottom:10px;">
        <button type="button" class="btn btn--secondary btn--sm" style="color:#d97706;border-color:#fde68a;background:#fffbeb;" onclick="ordOpenArchiveModal('${escHtml(uid)}')">
          <i class="fa-solid fa-box-archive"></i> พักรอออเดอร์ (Archive)
        </button>
      </div>`}

    <div class="ord-detail-section">
      <div class="ord-detail-section-title">
        <i class="fa-solid fa-lock" style="color:var(--ink-3)"></i>
        ข้อมูลจาก Unii (แก้ที่ระบบต้นทาง)
      </div>
      <div class="ord-readonly-box">
        <div class="ord-readonly-row"><span class="ord-readonly-key">ลูกค้า</span><span class="ord-readonly-val">${escHtml(o.customer||o.customerName||o.name||"—")}</span></div>
        <div class="ord-readonly-row"><span class="ord-readonly-key">เบอร์</span><span class="ord-readonly-val" style="font-family:var(--font-code)">${escHtml(o.phone||"—")}</span></div>
        <div class="ord-readonly-row"><span class="ord-readonly-key">ที่อยู่</span><span class="ord-readonly-val" style="text-align:right;max-width:220px">${escHtml(o.address||"—")}</span></div>
        <div class="ord-readonly-row"><span class="ord-readonly-key">ยอดรวม</span><span class="ord-readonly-val" style="font-family:var(--font-code)">฿${price}</span></div>
        <div class="ord-readonly-row"><span class="ord-readonly-key">การชำระ</span><span class="ord-readonly-val">${escHtml(o.paymentType||"—")}</span></div>
        <div class="ord-readonly-row"><span class="ord-readonly-key">สถานะ Unii</span><span class="ord-readonly-val">${escHtml(o.apiStatus||o.rawStatus||"—")}</span></div>
        <div class="ord-readonly-row"><span class="ord-readonly-key">วันที่สั่ง</span><span class="ord-readonly-val" style="font-family:var(--font-code);font-size:var(--fs-label)">${escHtml(o.orderPlacedAt||o.syncDeliveryAt||"—")}</span></div>
      </div>
      <a class="ord-unii-link" href="https://unii.th/admin/orders/${uid}" target="_blank" rel="noopener">
        <i class="fa-solid fa-arrow-up-right-from-square"></i> แก้ที่ระบบ Unii
      </a>
      <div class="ord-unii-caption">การแก้ไขที่ระบบ Unii จะถูก sync กลับมาอัตโนมัติ ยอดขายและข้อมูลลูกค้าจะตรงบัญชีเสมอ</div>
    </div>

    <!-- 1.5 รายการสินค้า (จาก Google Sheets SKU Detail) -->
    <div class="ord-detail-section">
      <div class="ord-detail-section-title" style="display:flex;justify-content:space-between;align-items:center;">
        <span><i class="fa-solid fa-boxes-stacked" style="color:var(--st-mine)"></i> รายการสินค้า (${skuItems.length} รายการ)</span>
        <span style="font-size:11px;font-weight:600;color:var(--ink-2);">${totalSkuQty} ชิ้น</span>
      </div>
      <div class="ord-sku-items-wrap">
        ${skuItemsHTML}
      </div>
    </div>

    <!-- 2. ข้อมูลจัดส่ง (แก้ได้) -->
    <div class="ord-detail-section">
      <div class="ord-detail-section-title">
        <i class="fa-solid fa-pen-to-square" style="color:var(--st-available)"></i>
        ข้อมูลจัดส่ง (แก้ได้)
      </div>

      <div class="ord-edit-row">
        <label class="ord-edit-label" for="ord-edit-date">วันที่จะจัดส่ง</label>
        <div style="display:flex;gap:6px;align-items:center;">
          <input type="date" id="ord-edit-date" class="ord-edit-input" value="${ordToISO(deliveryDateVal)}">
          <button type="button" class="btn btn--secondary btn--sm" onclick="ordOpenQuickDateModal('${escHtml(uid)}')" title="เลือกวันด่วน">
            <i class="fa-solid fa-bolt"></i> วันด่วน
          </button>
        </div>
      </div>

      <div class="ord-edit-row">
        <label class="ord-edit-label" for="ord-edit-zone">โซน</label>
        <select id="ord-edit-zone" class="ord-edit-select">${zoneOptions}</select>
      </div>

      <div class="ord-edit-row">
        <label class="ord-edit-label" for="ord-edit-driver">คนขับที่ถือ</label>
        <select id="ord-edit-driver" class="ord-edit-select">${driverOptions}</select>
      </div>

      <div class="ord-edit-row">
        <label class="ord-edit-label" for="ord-edit-note">หมายเหตุถึงคนขับ</label>
        <textarea id="ord-edit-note" class="ord-edit-textarea" placeholder="ระบุข้อมูลพิเศษสำหรับคนขับ…">${escHtml(o.remark||o.driverNote||"")}</textarea>
      </div>

      <div class="ord-edit-row" style="display:flex;align-items:center;gap:var(--sp-3)">
        <label class="ord-edit-label" style="margin-bottom:0" for="ord-edit-hold">พักไว้ก่อน</label>
        <input type="checkbox" id="ord-edit-hold" ${o.hold?"checked":""} style="width:18px;height:18px;cursor:pointer">
      </div>
    </div>

    <!-- 3. รหัสรูท + ปริ้น -->
    <div class="ord-detail-section">
      <div class="ord-detail-section-title">
        <i class="fa-solid fa-route" style="color:var(--st-available)"></i>
        รหัสรูทและการปริ้น
      </div>
      ${(() => {
        const rc = ordState.routecodes[uid];
        const isPrinted = !!ordState.printed[uid];
        if (rc) {
          return `
          <div class="ord-readonly-box" style="margin-bottom:var(--sp-3)">
            <div class="ord-readonly-row">
              <span class="ord-readonly-key">รหัสรูท</span>
              <span class="ord-readonly-val" style="font-family:var(--font-code);font-size:15px;font-weight:700;color:var(--accent)">${escHtml(rc.routeCode)}</span>
            </div>
            <div class="ord-readonly-row">
              <span class="ord-readonly-key">โซน</span>
              <span class="ord-readonly-val">${escHtml(ORD_ZONE_FULL[rc.zone] || rc.zone || '—')}</span>
            </div>
            <div class="ord-readonly-row">
              <span class="ord-readonly-key">วันส่ง</span>
              <span class="ord-readonly-val" style="font-family:var(--font-code)">${escHtml(rc.date||'—')}</span>
            </div>
            <div class="ord-readonly-row">
              <span class="ord-readonly-key">ปริ้นแล้ว</span>
              <span class="ord-readonly-val">${isPrinted ? `<span style="color:#059669;font-weight:600">✓ ปริ้นแล้ว</span>` : `<span style="color:var(--ink-3)">ยังไม่ปริ้น</span>`}</span>
            </div>
            ${rc.overLimit ? `<div style="background:#fff7e6;border:1px solid #f0c040;border-radius:6px;padding:8px;font-size:11.5px;color:#92600a;margin-top:4px">⚠ รหัสนี้เกินจำนวนการ์ดที่มี</div>` : ''}
          </div>
          <div style="display:flex;gap:8px">
            <button class="ord-sync-btn" style="flex:1" onclick="ordPrintSingle('${escHtml(uid)}')">
              <i class="fa-solid fa-print"></i> ปริ้นใบส่งของ
            </button>
            <button class="ord-sync-btn" style="flex:1;opacity:.7" onclick="ordRegenerateRoutecode('${escHtml(uid)}')">
              <i class="fa-solid fa-rotate"></i> สร้างรหัสใหม่
            </button>
          </div>`;
        } else {
          const hasZone = o.geojsonZone && o.geojsonZone !== 'UNASSIGNED';
          const hasDate = !!(o.deliveryDate || o.timeWindow);
          return `
          <div style="background:var(--page);border-radius:8px;padding:14px;text-align:center;font-size:12.5px;color:var(--ink-3)">
            <i class="fa-solid fa-clock" style="font-size:18px;margin-bottom:8px;display:block;color:var(--ink-4)"></i>
            ยังไม่มีรหัสรูท<br>
            ${!hasZone ? '<span style="color:var(--st-failed);font-size:11px">⚠ ยังไม่มีโซน</span>' : ''}
            ${!hasDate ? '<span style="color:var(--st-failed);font-size:11px">⚠ ยังไม่มีวันจัดส่ง</span>' : ''}
          </div>`;
        }
      })()}
    </div>

    <!-- 4. พิกัดและหมุด -->
    <div class="ord-detail-section">
      <div class="ord-detail-section-title">
        <i class="fa-solid fa-location-dot" style="color:var(--st-available)"></i>
        พิกัดและหมุด
      </div>
      ${hasCoord ? `<div class="ord-mini-map" id="ord-detail-map-${uid}"></div>` : `<div style="background:var(--page);border-radius:8px;padding:var(--sp-6);text-align:center;color:var(--ink-3);font-size:var(--fs-detail);margin-bottom:var(--sp-3)"><i class="fa-solid fa-circle-exclamation" style="color:var(--st-failed)"></i> ไม่มีพิกัด</div>`}
      <div class="ord-readonly-box" style="margin-bottom:var(--sp-3)">
        <div class="ord-readonly-row"><span class="ord-readonly-key">Latitude</span><span class="ord-readonly-val" style="font-family:var(--font-code)">${hasCoord ? lat : "—"}</span></div>
        <div class="ord-readonly-row"><span class="ord-readonly-key">Longitude</span><span class="ord-readonly-val" style="font-family:var(--font-code)">${hasCoord ? lng : "—"}</span></div>
        <div class="ord-readonly-row"><span class="ord-readonly-key">ที่มา</span><span class="ord-readonly-val">${coordSource}</span></div>
      </div>
      <button class="ord-sync-btn" onclick="ordOpenPinfix('${escHtml(uid)}')">
        <i class="fa-solid fa-map-pin"></i> แก้หมุด
      </button>
    </div>

    <!-- 4. ประวัติ -->
    <div class="ord-detail-section">
      <div class="ord-detail-section-title">
        <i class="fa-solid fa-clock-rotate-left" style="color:var(--ink-3)"></i>
        ประวัติการเปลี่ยนแปลง
      </div>
      <ul class="ord-timeline" id="ord-timeline-${uid}">
        <li class="ord-timeline-item">
          <div class="ord-timeline-dot"><i class="fa-solid fa-circle-info" style="font-size:8px"></i></div>
          <div class="ord-timeline-content">
            <div class="ord-timeline-who">ระบบ</div>
            <div class="ord-timeline-what">สร้างออเดอร์จาก Unii API</div>
            <div class="ord-timeline-when">${escHtml(o.orderPlacedAt||o.syncDeliveryAt||"—")}</div>
          </div>
        </li>
      </ul>
    </div>

    <!-- footer -->
    <div class="ord-slideover-foot">
      <button class="ord-save-btn" onclick="ordSaveDetail('${escHtml(uid)}')" id="ord-save-btn-${uid}">
        บันทึก
      </button>
      <button class="ord-cancel-btn" onclick="ordCancelOrder('${escHtml(uid)}')">
        <i class="fa-solid fa-ban"></i> ยกเลิกการจัดส่ง
      </button>
    </div>
  `;

  // วาดแผนที่เล็กหลัง inject + render call logs ใน timeline
  if (hasCoord) {
    setTimeout(() => {
      const mapEl = document.getElementById(`ord-detail-map-${uid}`);
      if (!mapEl || mapEl._leaflet_id) return;
      const miniMap = L.map(mapEl, { zoomControl: false, attributionControl: false })
        .setView([parseFloat(o.lat), parseFloat(o.lng)], 15);
      L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", { maxZoom: 19 }).addTo(miniMap);
      L.marker([parseFloat(o.lat), parseFloat(o.lng)]).addTo(miniMap);
      setTimeout(() => miniMap.invalidateSize(), 100);
    }, 50);
  }

  // Inject call logs into timeline
  const tlEl = document.getElementById(`ord-timeline-${uid}`);
  if (tlEl) {
    const logs = callLogGet(uid);
    const resultLabels = { reached: "ติดต่อได้", no_answer: "ติดต่อไม่ได้", voicemail: "ฝากข้อความไว้" };
    logs.slice().reverse().forEach(entry => {
      const label = resultLabels[entry.result] || entry.result;
      const li = document.createElement("li");
      li.className = "ord-timeline-item";
      li.innerHTML = `
        <div class="ord-timeline-dot ord-timeline-dot--call"><i class="fa-solid fa-phone" style="font-size:8px"></i></div>
        <div class="ord-timeline-content">
          <div class="ord-timeline-who">📞 โทรแล้ว — <span class="ord-timeline-call-result ord-timeline-call-result--${entry.result}">${label}</span></div>
          <div class="ord-timeline-what">โดย ${escHtml(entry.actor || 'supervisor')}</div>
          <div class="ord-timeline-when">${escHtml(entry.displayDate || entry.date || '')}</div>
          ${entry.note ? `<div class="ord-timeline-reason">"${escHtml(entry.note)}"</div>` : ""}
        </div>`;
      tlEl.insertBefore(li, tlEl.firstChild);
    });
  }

}

// Save changes from slide-over
function ordSaveDetail(uid) {
  const dateEl   = document.getElementById("ord-edit-date");
  const zoneEl   = document.getElementById("ord-edit-zone");
  const driverEl = document.getElementById("ord-edit-driver");
  const noteEl   = document.getElementById("ord-edit-note");
  const holdEl   = document.getElementById("ord-edit-hold");

  // ต้องกรอกเหตุผล — ใช้ dialog
  ordShowReasonDialog(
    "บันทึกการเปลี่ยนแปลง",
    `บันทึกข้อมูลจัดส่งให้ออเดอร์ <strong>${uid.slice(-6)}</strong>`,
    () => {
      const reason = document.getElementById("ord-dialog-reason")?.value?.trim();
      if (!reason) { supNotify("โปรดระบุเหตุผลก่อนบันทึก","warn"); return false; }
      const newDate   = dateEl?.value || "";
      const newZone   = zoneEl?.value || "";
      const newDriver = driverEl?.value || "";
      const newNote   = noteEl?.value || "";
      const newHold   = holdEl?.checked || false;

      // Optimistic update
      const order = supState.allOrdersAll.find(o => (o.uid||o.id) === uid);
      if (order) {
        if (newDate) {
          // convert ISO → M/D/YYYY
          const [y,m,d] = newDate.split("-");
          order.deliveryDate = `${parseInt(m)}/${parseInt(d)}/${y}`;
          order.timeWindow   = order.deliveryDate;
        }
        if (newZone !== undefined) order.geojsonZone = newZone || supClassifyZone(order).geojsonZone;
        if (newDriver !== undefined) order.assignedDriverId = newDriver;
        if (newNote !== undefined) { order.remark = newNote; order.driverNote = newNote; }
        order.hold = newHold;
      }

      // Write to server (เฉพาะคอลัมน์ที่เกี่ยวข้องเท่านั้น)
      ordWriteOrderFields(uid, {
        deliveryDate: newDate,
        zone:         newZone,
        driverCode:   newDriver,
        note:         newNote,
        hold:         newHold,
        reason,
        actor:        "supervisor",
      });

      ordCloseDialog();
      ordCloseDetail();
      ordApplyFilters();
      supNotify("บันทึกแล้ว", "ok");
      return true;
    }
  );
}

// Cancel order
function ordCancelOrder(uid) {
  ordShowReasonDialog(
    "ยืนยันยกเลิกการจัดส่ง",
    `<span style="color:var(--st-failed)"><i class="fa-solid fa-triangle-exclamation"></i></span> ยืนยันการยกเลิกจัดส่งออเดอร์ <strong>${uid.slice(-6)}</strong>?<br><small style="color:var(--ink-3)">การยกเลิกนี้จะบันทึกในประวัติและแจ้งคนขับ</small>`,
    () => {
      const reason = document.getElementById("ord-dialog-reason")?.value?.trim();
      if (!reason) { supNotify("โปรดระบุเหตุผลก่อนยืนยัน","warn"); return false; }
      ordWriteOrderFields(uid, { status: "cancelled", reason, actor: "supervisor" });
      ordCloseDialog();
      ordCloseDetail();
      ordApplyFilters();
      supNotify("ยกเลิกการจัดส่งแล้ว", "err");
      return true;
    }
  );
}

function ordOpenPinfix(uid) {
  ordOpenPinfixModal(uid);
}

// =====================================
// Ordered date helpers
// =====================================
function ordFormatShortDate(rawDate) {
  if (!rawDate) return "—";
  const str = String(rawDate).trim();
  const comp = ordParseDateComponents(str);
  if (!comp) return str;

  const mon = (typeof THAI_MONTHS_SHORT !== 'undefined' ? THAI_MONTHS_SHORT[comp.mo - 1] : '') || `เดือน ${comp.mo}`;
  const day = comp.dy;

  let hasTime = false;
  let hours = '00', mins = '00';
  if (str.includes(':')) {
    const timeMatch = str.match(/(\d{1,2}):(\d{2})(?::\d{2})?/);
    if (timeMatch) {
      hasTime = true;
      hours = String(parseInt(timeMatch[1], 10)).padStart(2, '0');
      mins = timeMatch[2];
    }
  }

  if (hasTime) {
    return `<div class="ord-ordered-wrap"><span class="ord-ordered-date">${day} ${mon}</span><span class="ord-ordered-time">${hours}:${mins}</span></div>`;
  }
  return `<span class="ord-ordered-date">${day} ${mon}</span>`;
}

function ordIsStaleUnbooked(o, orderedRaw) {
  // ออเดอร์ที่ยังไม่มีคนจอง + วันที่สั่งนานกว่า 2 วันจากวันนี้
  if (o.assignedDriverId) return false;
  if (o.status && o.status !== "available") return false;
  if (!orderedRaw) return false;
  let d;
  if (orderedRaw.includes("-")) d = new Date(orderedRaw);
  else if (orderedRaw.includes("/")) {
    const p = orderedRaw.split("/");
    if (p.length === 3) d = new Date(parseInt(p[2]), parseInt(p[0])-1, parseInt(p[1]));
  }
  if (!d || isNaN(d.getTime())) return false;
  const diffDays = (Date.now() - d.getTime()) / 86400000;
  return diffDays > 2;
}

// =====================================
// Photo Popover
// =====================================
let _photoPopoverPhone = null;
let _photoPopoverUid   = null;

function ordOpenPhotoPopover(evt, phone, uid) {
  _photoPopoverPhone = phone;
  _photoPopoverUid   = uid;

  const popover = document.getElementById("ord-photo-popover-global");
  if (!popover) return;

  // Position near thumbnail
  const rect = evt.currentTarget.getBoundingClientRect();
  const top  = rect.bottom + window.scrollY + 8;
  let left   = rect.left + window.scrollX;
  if (left + 180 > window.innerWidth - 8) left = window.innerWidth - 188;
  popover.style.top  = `${top}px`;
  popover.style.left = `${left}px`;

  // Update preview
  const preview = document.getElementById("ord-photo-preview");
  const placeholder = document.getElementById("ord-photo-placeholder");
  const photoUrl = phone ? photoDbGet(phone) : null;
  if (photoUrl && preview) {
    preview.src = photoUrl;
    preview.style.display = "block";
    if (placeholder) placeholder.style.display = "none";
  } else {
    if (preview) preview.style.display = "none";
    if (placeholder) placeholder.style.display = "flex";
  }

  popover.style.display = "block";

  // Close on outside click
  setTimeout(() => {
    document.addEventListener("click", ordClosePhotoPopover, { once: true });
  }, 10);
}

function ordClosePhotoPopover() {
  const popover = document.getElementById("ord-photo-popover-global");
  if (popover) popover.style.display = "none";
}

function ordHandlePhotoUpload(evt) {
  const file = evt.target.files[0];
  if (!file || !_photoPopoverPhone) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    const dataUrl = e.target.result;
    photoDbSet(_photoPopoverPhone, dataUrl);
    // Update preview in popover
    const preview = document.getElementById("ord-photo-preview");
    const placeholder = document.getElementById("ord-photo-placeholder");
    if (preview) { preview.src = dataUrl; preview.style.display = "block"; }
    if (placeholder) placeholder.style.display = "none";
    // Refresh thumbnail in table
    const thumbEl = document.querySelector(`tr[data-uid="${CSS.escape(_photoPopoverUid)}"] .ord-store-thumb`);
    if (thumbEl) {
      thumbEl.innerHTML = `<img src="${dataUrl}" alt="รูปร้าน" loading="lazy"><div class="ord-store-thumb-overlay"><i class="fa-solid fa-camera"></i></div>`;
    }
    supNotify("บันทึกรูปหน้าร้านแล้ว", "ok");
  };
  reader.readAsDataURL(file);
  evt.target.value = ""; // reset input
}

// =====================================
// Call Log Modal
// =====================================
let _callModalUid = null;

function ordOpenCallModal(uid) {
  _callModalUid = uid;
  const order = supState.allOrdersAll.find(o => (o.uid||o.id) === uid);
  if (!order) return;

  const phone = order.phone || "—";
  const phoneEl = document.getElementById("ord-call-phone-display");
  const copyBtn = document.getElementById("ord-call-copy-btn");
  const noteEl  = document.getElementById("ord-call-note");
  const overlay = document.getElementById("ord-call-modal-overlay");
  const modal   = document.getElementById("ord-call-modal");

  if (phoneEl) phoneEl.textContent = phone;

  // On mobile (coarse pointer): show tel: link instead of plain number
  if (window.matchMedia("(pointer: coarse)").matches && phone !== "—") {
    if (phoneEl) phoneEl.innerHTML = `<a href="tel:${phone.replace(/\D/g,"")}" style="color:var(--st-available);text-decoration:none">${phone}</a>`;
  }

  // Reset form
  document.querySelectorAll("input[name='call-result']").forEach(r => r.checked = false);
  if (noteEl) noteEl.value = "";
  if (copyBtn) copyBtn.innerHTML = '<i class="fa-regular fa-copy"></i> คัดลอก';

  if (overlay) { overlay.style.display = "block"; overlay.classList.add("is-open"); }
  if (modal)   { modal.style.display = "block"; setTimeout(() => modal.classList.add("is-open"), 10); }
}

function ordCloseCallModal(evt) {
  if (evt && evt.target !== document.getElementById("ord-call-modal-overlay")) return;
  const overlay = document.getElementById("ord-call-modal-overlay");
  const modal   = document.getElementById("ord-call-modal");
  if (overlay) { overlay.classList.remove("is-open"); overlay.style.display = "none"; }
  if (modal)   { modal.classList.remove("is-open"); setTimeout(() => modal.style.display = "none", 220); }
  _callModalUid = null;
}

function ordCopyPhone() {
  const phoneEl = document.getElementById("ord-call-phone-display");
  const text = phoneEl ? (phoneEl.textContent || phoneEl.innerText) : "";
  if (!text || text === "—") return;
  navigator.clipboard.writeText(text.trim()).then(() => {
    const btn = document.getElementById("ord-call-copy-btn");
    if (btn) {
      btn.innerHTML = '<i class="fa-solid fa-check"></i> คัดลอกแล้ว';
      setTimeout(() => { btn.innerHTML = '<i class="fa-regular fa-copy"></i> คัดลอก'; }, 1800);
    }
  }).catch(() => supNotify("ไม่สามารถคัดลอกได้", "warn"));
}

function ordSaveCallLog() {
  const uid = _callModalUid;
  if (!uid) return;

  const result = document.querySelector("input[name='call-result']:checked")?.value;
  if (!result) { supNotify("โปรดเลือกผลการโทรก่อนบันทึก", "warn"); return; }

  const note = document.getElementById("ord-call-note")?.value?.trim() || "";
  const now  = new Date();
  const actor = "supervisor";

  const entry = {
    type:   "call_log",
    result,
    note,
    actor,
    date: now.toISOString(),
    displayDate: `${now.getDate()} ${THAI_MONTHS_SHORT[now.getMonth()]} ${now.getHours()}:${String(now.getMinutes()).padStart(2,"0")}`
  };

  callLogAdd(uid, entry);

  // Update timeline in slide-over if open
  const tlEl = document.getElementById(`ord-timeline-${uid}`);
  if (tlEl) {
    const resultLabels = { reached: "ติดต่อได้", no_answer: "ติดต่อไม่ได้", voicemail: "ฝากข้อความไว้" };
    const resultLabel = resultLabels[result] || result;
    const li = document.createElement("li");
    li.className = "ord-timeline-item";
    li.innerHTML = `
      <div class="ord-timeline-dot ord-timeline-dot--call"><i class="fa-solid fa-phone" style="font-size:8px"></i></div>
      <div class="ord-timeline-content">
        <div class="ord-timeline-who">📞 โทรแล้ว — <span class="ord-timeline-call-result ord-timeline-call-result--${result}">${resultLabel}</span></div>
        <div class="ord-timeline-what">โดย ${actor}</div>
        <div class="ord-timeline-when">${entry.displayDate}</div>
        ${note ? `<div class="ord-timeline-reason">"${escHtml(note)}"</div>` : ""}
      </div>`;
    tlEl.insertBefore(li, tlEl.firstChild);
  }

  // Refresh call badge on the table row
  const callBtnEl = document.querySelector(`tr[data-uid="${CSS.escape(uid)}"] .ord-call-btn`);
  if (callBtnEl && !callBtnEl.querySelector(".ord-call-badge")) {
    callBtnEl.insertAdjacentHTML("beforeend", '<span class="ord-call-badge"></span>');
  }

  ordCloseCallModal();
  supNotify("บันทึกผลการโทรแล้ว", "ok");
}

// =====================================
// Pinfix Modal (mini-map in row)
// =====================================
let _pinfixMap     = null;
let _pinfixMarker  = null;
let _pinfixUid     = null;

function ordOpenPinfixModal(uid) {
  _pinfixUid = uid;
  const order = supState.allOrdersAll.find(o => (o.uid||o.id) === uid);
  if (!order) return;

  const overlay = document.getElementById("ord-pinfix-modal-overlay");
  const modal   = document.getElementById("ord-pinfix-modal");
  if (!overlay || !modal) return;

  overlay.classList.add("is-open"); overlay.style.display = "block";
  modal.style.display = "flex"; setTimeout(() => modal.classList.add("is-open"), 10);

  const lat = parseFloat(order.lat) || WAREHOUSE_HUB.lat;
  const lng = parseFloat(order.lng) || WAREHOUSE_HUB.lng;

  // Update coord display
  const coordEl = document.getElementById("ord-pinfix-coord-display");
  if (coordEl) coordEl.textContent = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;

  // Init or reuse map
  setTimeout(() => {
    const mapEl = document.getElementById("ord-pinfix-map");
    if (!mapEl) return;
    if (!_pinfixMap) {
      _pinfixMap = L.map(mapEl, { zoomControl: true, attributionControl: false })
        .setView([lat, lng], 16);
      L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", { maxZoom: 19 }).addTo(_pinfixMap);
      _pinfixMarker = L.marker([lat, lng], { draggable: true }).addTo(_pinfixMap);
      _pinfixMarker.on("dragend", (e) => {
        const ll = e.target.getLatLng();
        if (coordEl) coordEl.textContent = `${ll.lat.toFixed(5)}, ${ll.lng.toFixed(5)}`;
      });
    } else {
      _pinfixMap.setView([lat, lng], 16);
      _pinfixMarker.setLatLng([lat, lng]);
      if (coordEl) coordEl.textContent = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    }
    setTimeout(() => _pinfixMap.invalidateSize(), 100);
  }, 50);
}

function ordClosePinfixModal(evt) {
  if (evt && evt.target !== document.getElementById("ord-pinfix-modal-overlay")) return;
  const overlay = document.getElementById("ord-pinfix-modal-overlay");
  const modal   = document.getElementById("ord-pinfix-modal");
  if (overlay) { overlay.classList.remove("is-open"); overlay.style.display = "none"; }
  if (modal)   { modal.classList.remove("is-open"); setTimeout(() => modal.style.display = "none", 220); }
  _pinfixUid = null;
}

async function ordSavePinfix() {
  if (!_pinfixMarker || !_pinfixUid) return;
  const ll  = _pinfixMarker.getLatLng();
  const uid = _pinfixUid;
  const order = supState.allOrdersAll.find(o => (o.uid||o.id) === uid);
  if (!order) return;

  const phone = order.phone || "";

  try {
    // Write to server: /api/stop/pinfix
    const res = await fetch("/api/stop/pinfix", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${supState.token}` },
      body: JSON.stringify({ phone, lat: ll.lat, lng: ll.lng })
    });
    if (!res.ok) throw new Error(await res.text());
  } catch (e) {
    console.warn("[pinfix] server write failed, saving locally", e);
  }

  // Optimistic update in memory
  order.lat = String(ll.lat);
  order.lng = String(ll.lng);
  order.isPinModified = true;
  order.geojsonZone = supClassifyZone({ ...order }).geojsonZone;

  // Log to timeline
  const now = new Date();
  const tlEl = document.getElementById(`ord-timeline-${uid}`);
  if (tlEl) {
    const li = document.createElement("li");
    li.className = "ord-timeline-item";
    li.innerHTML = `
      <div class="ord-timeline-dot" style="background:var(--st-available-bg);border-color:var(--st-available);color:var(--st-available)"><i class="fa-solid fa-map-pin" style="font-size:8px"></i></div>
      <div class="ord-timeline-content">
        <div class="ord-timeline-who">แก้หมุด</div>
        <div class="ord-timeline-what">${ll.lat.toFixed(5)}, ${ll.lng.toFixed(5)}</div>
        <div class="ord-timeline-when">${now.getDate()} ${THAI_MONTHS_SHORT[now.getMonth()]} ${now.getHours()}:${String(now.getMinutes()).padStart(2,"0")}</div>
      </div>`;
    tlEl.insertBefore(li, tlEl.firstChild);
  }

  ordClosePinfixModal();
  supNotify("บันทึกหมุดใหม่แล้ว", "ok");
  ordApplyFilters();
}

// =====================================
// Bulk Actions
// =====================================
const BULK_META = {
  reschedule:   { title: "กำหนด/เลื่อนวันส่ง", icon: "fa-calendar-pen" },
  assignzone:   { title: "กำหนดโซน",         icon: "fa-map-location-dot" },
  assigndriver: { title: "มอบหมายคนขับ",     icon: "fa-user-check" },
  archive:      { title: "พักรอ (Archive)",  icon: "fa-box-archive" },
  unarchive:    { title: "นำกลับมาจัดส่ง",   icon: "fa-box-open" },
  hold:         { title: "พักไว้ก่อน",        icon: "fa-pause" },
};

function ordBulkAction(type) {
  const selectedOrders = supState.allOrdersAll.filter(o => ordState.selected.has(o.uid||o.id));
  if (selectedOrders.length === 0) return;
  ordState.pendingAction = { type, selectedOrders };

  const meta    = BULK_META[type] || { title: type };
  const count   = selectedOrders.length;
  const preview = selectedOrders.slice(0,3).map(o =>
    `<div class="ord-dialog-preview-item">${escHtml(o.customer||o.name||"—")} <span style="color:var(--ink-3);font-family:var(--font-code);font-size:var(--fs-label)">${(o.uid||o.id||"").slice(-6)}</span></div>`
  ).join("");
  const more = count > 3 ? `<div style="color:var(--ink-3);font-size:var(--fs-label);margin-top:4px">…และอีก ${count-3} รายการ</div>` : "";

  // extra input per type
  let extraHTML = "";
  if (type === "reschedule") {
    extraHTML = `<div class="ord-edit-row" style="margin-top:var(--sp-3)">
      <label class="ord-edit-label" for="ord-bulk-date">วันส่งใหม่</label>
      <input type="date" id="ord-bulk-date" class="ord-edit-input">
    </div>`;
  } else if (type === "assignzone") {
    const opts = [
      `<option value="">— ให้ระบบคำนวณจากพิกัด —</option>`,
      ...Object.keys(GEOJSON_ZONES).map(z => `<option value="${escHtml(z)}">${escHtml(z)}</option>`),
    ].join("");
    extraHTML = `<div class="ord-edit-row" style="margin-top:var(--sp-3)">
      <label class="ord-edit-label" for="ord-bulk-zone">โซนที่กำหนด</label>
      <select id="ord-bulk-zone" class="ord-edit-select">${opts}</select>
    </div>`;
  } else if (type === "assigndriver") {
    const opts = [
      `<option value="">— ยังไม่มีคนขับ —</option>`,
      ...DRIVER_PROFILES.filter(d => d.status !== 'inactive').map(d => `<option value="${escHtml(d.code)}">${escHtml(d.name)}</option>`),
    ].join("");
    extraHTML = `<div class="ord-edit-row" style="margin-top:var(--sp-3)">
      <label class="ord-edit-label" for="ord-bulk-driver">คนขับ</label>
      <select id="ord-bulk-driver" class="ord-edit-select">${opts}</select>
    </div>`;
  } else if (type === "archive") {
    extraHTML = `<div class="ord-edit-row" style="margin-top:var(--sp-3)">
      <div style="font-size:12px;color:var(--ink-2);margin-bottom:8px;">ออเดอร์ที่เลือกจะถูกย้ายไปยังคลังพักรอ (Archive) และไม่ปรากฏในคิวจัดส่งประจำวัน</div>
    </div>`;
  } else if (type === "unarchive") {
    extraHTML = `<div class="ord-edit-row" style="margin-top:var(--sp-3)">
      <div style="font-size:12px;color:var(--ink-2);margin-bottom:8px;">ออเดอร์ที่เลือกจะถูกนำกลับเข้าสู่คิวจัดส่งตามปกติ</div>
    </div>`;
  }

  document.getElementById("ord-dialog-title").textContent = `${meta.title} (${count} รายการ)`;
  document.getElementById("ord-dialog-body").innerHTML = `
    <div>กำลังจะ<strong>${meta.title}</strong>ให้ ${count} ออเดอร์ดังนี้:</div>
    <div class="ord-dialog-preview">${preview}${more}</div>
    ${extraHTML}
  `;
  document.getElementById("ord-dialog-reason").value = "";
  document.getElementById("ord-dialog-overlay").classList.add("is-open");
}

function ordConfirmBulk() {
  const reason = document.getElementById("ord-dialog-reason")?.value?.trim();
  if (!reason) { supNotify("โปรดระบุเหตุผลก่อนยืนยัน","warn"); return; }

  const { type, selectedOrders } = ordState.pendingAction || {};
  if (!selectedOrders) return;

  let extraData = {};
  if (type === "reschedule") extraData.deliveryDate = document.getElementById("ord-bulk-date")?.value || "";
  if (type === "assignzone") extraData.zone = document.getElementById("ord-bulk-zone")?.value || "";
  if (type === "assigndriver") extraData.driverCode = document.getElementById("ord-bulk-driver")?.value || "";

  const token = localStorage.getItem("uflow_jwt_token") || localStorage.getItem("token");
  const targetIds = selectedOrders.map(o => o.uid || o.id);

  if (type === "archive") {
    selectedOrders.forEach(o => {
      o.isArchived = true;
      o.archiveReason = reason;
      o.archivedAt = new Date().toISOString();
    });
    fetch("/api/supervisor/order/archive", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
      body: JSON.stringify({ orderIds: targetIds, archived: true, reason, actor: "supervisor" })
    }).catch(e => console.error(e));
  } else if (type === "unarchive") {
    selectedOrders.forEach(o => {
      o.isArchived = false;
      o.archiveReason = "";
      o.archivedAt = "";
    });
    fetch("/api/supervisor/order/archive", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
      body: JSON.stringify({ orderIds: targetIds, archived: false, reason, actor: "supervisor" })
    }).catch(e => console.error(e));
  } else if (type === "reschedule" && extraData.deliveryDate) {
    const [y,m,d] = extraData.deliveryDate.split("-");
    const formattedDate = `${parseInt(m)}/${parseInt(d)}/${y}`;
    selectedOrders.forEach(o => {
      o.deliveryDate = formattedDate;
      o.timeWindow = formattedDate;
      o.noDeliveryDate = !formattedDate;
    });
    fetch("/api/supervisor/order/update-date", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
      body: JSON.stringify({ orderIds: targetIds, deliveryDate: formattedDate, reason, actor: "supervisor" })
    }).catch(e => console.error(e));
  } else {
    selectedOrders.forEach(o => {
      const uid = o.uid || o.id;
      ordWriteOrderFields(uid, { ...extraData, type, reason, actor: "supervisor" });
      if (type === "assignzone" && extraData.zone !== undefined) o.geojsonZone = extraData.zone || supClassifyZone(o).geojsonZone;
      if (type === "assigndriver" && extraData.driverCode !== undefined) o.assignedDriverId = extraData.driverCode;
      if (type === "hold") o.hold = true;
    });
  }

  ordState.selected.clear();
  ordCloseDialog();
  ordApplyFilters();
  supNotify(`ดำเนินการ ${selectedOrders.length} รายการแล้ว`, "ok");
}

function ordCloseDialog() {
  document.getElementById("ord-dialog-overlay")?.classList.remove("is-open");
  ordState.pendingAction = null;
}

function ordShowReasonDialog(title, bodyHTML, onConfirm) {
  document.getElementById("ord-dialog-title").textContent = title;
  document.getElementById("ord-dialog-body").innerHTML = bodyHTML;
  document.getElementById("ord-dialog-reason").value = "";
  document.getElementById("ord-dialog-confirm-btn").onclick = () => onConfirm();
  document.getElementById("ord-dialog-overlay").classList.add("is-open");
}

// =====================================
// Write to server
// =====================================
async function ordWriteOrderFields(uid, data) {
  try {
    const token = localStorage.getItem("uflow_jwt_token") || localStorage.getItem("token");
    await fetch("/api/supervisor/order/update", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`
      },
      body: JSON.stringify({
        uid,
        ...data
      })
    });
  } catch (err) {
    console.error("[ordWriteOrderFields] Error:", err);
  }
}

// =====================================
// Quick Date Picker Modal Handlers
// =====================================
function ordOpenQuickDateModal(uid) {
  const order = supState.allOrdersAll.find(o => (o.uid || o.id) === uid);
  if (!order) return;
  ordState.quickDateUid = uid;

  const targetEl = document.getElementById("ord-quick-date-target");
  if (targetEl) {
    targetEl.innerHTML = `
      <div style="font-weight:700;color:var(--ink);">${escHtml(order.customer || order.customerName || order.name || '—')}</div>
      <div style="font-size:12px;color:var(--ink-2);font-family:var(--font-code);">ออเดอร์: ${escHtml(uid)} | โซน: ${escHtml(order.geojsonZone || '—')}</div>
    `;
  }

  // Update preset labels
  const now = new Date();
  const tmr = new Date(now.getTime() + 86400000);
  const dayAfter = new Date(now.getTime() + 86400000 * 2);

  const todayStr = `${now.getDate()} ${THAI_MONTHS_SHORT[now.getMonth()]}`;
  const tmrStr = `${tmr.getDate()} ${THAI_MONTHS_SHORT[tmr.getMonth()]}`;
  const dayAfterStr = `${dayAfter.getDate()} ${THAI_MONTHS_SHORT[dayAfter.getMonth()]}`;

  const l0 = document.getElementById("ord-preset-today-label");
  const l1 = document.getElementById("ord-preset-tmr-label");
  const l2 = document.getElementById("ord-preset-dayafter-label");
  if (l0) l0.textContent = todayStr;
  if (l1) l1.textContent = tmrStr;
  if (l2) l2.textContent = dayAfterStr;

  const inputEl = document.getElementById("ord-quick-date-input");
  if (inputEl) {
    const curVal = ordToISO(order.deliveryDate || order.timeWindow || "");
    inputEl.value = curVal || "";
  }

  const overlay = document.getElementById("ord-quick-date-overlay");
  const modal = document.getElementById("ord-quick-date-modal");
  if (overlay) overlay.style.display = "block";
  if (modal) modal.style.display = "flex";
}

function ordCloseQuickDateModal() {
  const overlay = document.getElementById("ord-quick-date-overlay");
  const modal = document.getElementById("ord-quick-date-modal");
  if (overlay) overlay.style.display = "none";
  if (modal) modal.style.display = "none";
  ordState.quickDateUid = null;
}

function ordSelectQuickDatePreset(offsetDays) {
  const d = new Date(Date.now() + offsetDays * 86400000);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const isoStr = `${yyyy}-${mm}-${dd}`;

  const inputEl = document.getElementById("ord-quick-date-input");
  if (inputEl) inputEl.value = isoStr;

  ordSaveQuickDateFromModal();
}

function ordClearQuickDate() {
  const uid = ordState.quickDateUid;
  if (!uid) return;
  ordSaveQuickDate(uid, "");
  ordCloseQuickDateModal();
}

function ordSaveQuickDateFromModal() {
  const uid = ordState.quickDateUid;
  if (!uid) return;
  const inputEl = document.getElementById("ord-quick-date-input");
  const isoVal = inputEl?.value || "";
  if (!isoVal) {
    supNotify("โปรดเลือกวันที่จัดส่ง", "warn");
    return;
  }
  const [y, m, d] = isoVal.split("-");
  const formattedDate = `${parseInt(m)}/${parseInt(d)}/${y}`;
  ordSaveQuickDate(uid, formattedDate);
  ordCloseQuickDateModal();
}

async function ordSaveQuickDate(uid, dateStr) {
  const order = supState.allOrdersAll.find(o => (o.uid || o.id) === uid);
  if (order) {
    order.deliveryDate = dateStr;
    order.timeWindow = dateStr;
    order.noDeliveryDate = !dateStr;
  }

  ordApplyFilters();
  supNotify(`บันทึกวันส่ง ${dateStr ? dateStr : '(ล้างวันส่ง)'} แล้ว`, "ok");

  try {
    const token = localStorage.getItem("uflow_jwt_token") || localStorage.getItem("token");
    await fetch("/api/supervisor/order/update-date", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`
      },
      body: JSON.stringify({
        orderId: uid,
        deliveryDate: dateStr,
        reason: "กำหนดวันจัดส่งด่วนจากหน้าออเดอร์",
        actor: "supervisor"
      })
    });
  } catch (err) {
    console.error("[ordSaveQuickDate] Error:", err);
  }
}

// =====================================
// Archive / Unarchive Modal Handlers
// =====================================
function ordOpenArchiveModal(uid) {
  const order = supState.allOrdersAll.find(o => (o.uid || o.id) === uid);
  if (!order) return;
  ordState.archiveUid = uid;

  const targetEl = document.getElementById("ord-archive-target");
  if (targetEl) {
    targetEl.innerHTML = `
      <div style="font-weight:700;color:var(--ink);">${escHtml(order.customer || order.customerName || order.name || '—')}</div>
      <div style="font-size:12px;color:var(--ink-2);font-family:var(--font-code);">ออเดอร์: ${escHtml(uid)} | ยอด ฿${fmtBaht(order.price)}</div>
    `;
  }

  const reasonInput = document.getElementById("ord-archive-reason-input");
  if (reasonInput) reasonInput.value = "";

  const overlay = document.getElementById("ord-archive-overlay");
  const modal = document.getElementById("ord-archive-modal");
  if (overlay) overlay.style.display = "block";
  if (modal) modal.style.display = "flex";
}

function ordCloseArchiveModal() {
  const overlay = document.getElementById("ord-archive-overlay");
  const modal = document.getElementById("ord-archive-modal");
  if (overlay) overlay.style.display = "none";
  if (modal) modal.style.display = "none";
  ordState.archiveUid = null;
}

function ordPickArchiveReason(reasonText) {
  const input = document.getElementById("ord-archive-reason-input");
  if (input) input.value = reasonText;
}

function ordConfirmArchiveFromModal() {
  const uid = ordState.archiveUid;
  if (!uid) return;
  const input = document.getElementById("ord-archive-reason-input");
  const reason = input?.value?.trim() || "พักรอตามขั้นตอน";

  ordArchiveOrder(uid, reason);
  ordCloseArchiveModal();
}

async function ordArchiveOrder(uid, reason) {
  const order = supState.allOrdersAll.find(o => (o.uid || o.id) === uid);
  if (order) {
    order.isArchived = true;
    order.archiveReason = reason;
    order.archivedAt = new Date().toISOString();
  }

  ordCloseDetail();
  ordApplyFilters();
  supNotify(`ย้ายออเดอร์ ${uid.slice(-6)} ไปยังคลังพักรอ (Archive) แล้ว`, "ok");

  try {
    const token = localStorage.getItem("uflow_jwt_token") || localStorage.getItem("token");
    await fetch("/api/supervisor/order/archive", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`
      },
      body: JSON.stringify({
        orderId: uid,
        archived: true,
        reason: reason,
        actor: "supervisor"
      })
    });
  } catch (err) {
    console.error("[ordArchiveOrder] Error:", err);
  }
}

async function ordUnarchiveOrder(uid) {
  const order = supState.allOrdersAll.find(o => (o.uid || o.id) === uid);
  if (order) {
    order.isArchived = false;
    order.archiveReason = "";
    order.archivedAt = "";
  }

  ordCloseDetail();
  ordApplyFilters();
  supNotify(`นำออเดอร์ ${uid.slice(-6)} กลับมาจัดส่งเรียบร้อยแล้ว`, "ok");

  try {
    const token = localStorage.getItem("uflow_jwt_token") || localStorage.getItem("token");
    await fetch("/api/supervisor/order/archive", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`
      },
      body: JSON.stringify({
        orderId: uid,
        archived: false,
        reason: "นำกลับมาจัดส่งจากหน้าออเดอร์",
        actor: "supervisor"
      })
    });
  } catch (err) {
    console.error("[ordUnarchiveOrder] Error:", err);
  }
}

// =====================================
// Sync
// =====================================
async function ordSyncIncremental() {
  if (ordState.syncing) return;
  ordSetSyncing(true);
  try {
    // Reuse supLoadData — incremental (ยังโหลด all แล้ว filter)
    await supLoadData();
    ordState.lastSyncAt = new Date();
    ordUpdateSyncTs();
    ordApplyFilters();
    supNotify("sync ข้อมูลสำเร็จ", "ok");
  } catch(e) {
    console.error("[ordSync]", e);
    supNotify("sync ไม่สำเร็จ: " + e.message, "err");
  } finally {
    ordSetSyncing(false);
  }
}

async function ordSyncFull() {
  if (ordState.syncing) return;
  const ok = confirm("sync เต็มจะโหลดออเดอร์ทั้งหมดใหม่ อาจใช้เวลาสักครู่ ต้องการดำเนินการต่อ?");
  if (!ok) return;
  ordSetSyncing(true);
  try {
    await supLoadData();
    ordState.lastSyncAt = new Date();
    ordUpdateSyncTs();
    ordApplyFilters();
    supNotify("sync เต็มสำเร็จ", "ok");
  } catch(e) {
    supNotify("sync ไม่สำเร็จ: " + e.message, "err");
  } finally {
    ordSetSyncing(false);
  }
}

function ordSetSyncing(v) {
  ordState.syncing = v;
  const icon = document.getElementById("ord-sync-icon");
  const btn  = document.getElementById("ord-sync-inc-btn");
  if (icon) icon.classList.toggle("ord-sync-spinning", v);
  if (btn) btn.disabled = v;
}

function ordUpdateSyncTs() {
  const el = document.getElementById("ord-sync-ts");
  if (!el || !ordState.lastSyncAt) return;
  const d = ordState.lastSyncAt;
  el.textContent = `sync ${d.getHours()}:${String(d.getMinutes()).padStart(2,"0")} น.`;
}

// =====================================
// Helpers
// =====================================
function ordToISO(dateStr) {
  const comp = ordParseDateComponents(dateStr);
  if (!comp) return "";
  return `${comp.yr}-${String(comp.mo).padStart(2,"0")}-${String(comp.dy).padStart(2,"0")}`;
}

function fmtISO(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth()+1).padStart(2,"0");
  const d = String(date.getDate()).padStart(2,"0");
  return `${y}-${m}-${d}`;
}


// =====================================
// RouteCode System
// =====================================

async function ordLoadRoutecodes() {
  try {
    const res = await fetch('/api/routecode/list', {
      headers: { 'Authorization': `Bearer ${supState.token}` }
    });
    if (!res.ok) return;
    const data = await res.json();
    ordState.routecodes = data.assignments || {};
    ordState.printed    = data.printed    || {};
  } catch(e) { console.warn('[ordLoadRoutecodes]', e.message); }
}

async function ordAutoAssignAll() {
  const all = supState.allOrdersAll || [];
  const eligible = all.filter(o => {
    const uid = o.uid || o.id;
    const zone = o.geojsonZone;
    const date = o.deliveryDate || o.timeWindow;
    return uid && zone && zone !== 'UNASSIGNED' && date && !ordState.routecodes[uid];
  }).map(o => ({
    orderId:      o.uid || o.id,
    geojsonZone:  o.geojsonZone,
    deliveryDate: o.deliveryDate || o.timeWindow,
  }));
  if (eligible.length === 0) { if (ordState._inited) ordRenderTable(); return; }
  try {
    const res = await fetch('/api/routecode/assign-batch', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${supState.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ orders: eligible }),
    });
    if (!res.ok) return;
    const data = await res.json();
    Object.entries(data.results || {}).forEach(([id, rc]) => {
      if (!ordState.routecodes[id]) ordState.routecodes[id] = { routeCode: rc };
    });
    await ordLoadRoutecodes();
    (data.warnings || []).forEach(w => {
      const zMatch = w.match(/โซน ([A-Z])/);
      const zL = zMatch ? zMatch[1] : null;
      if (zL && !ordState.overLimitSeen.has(zL)) { ordState.overLimitSeen.add(zL); supNotify(w, 'warn'); }
    });
    if (ordState._inited) ordRenderTable();
  } catch(e) { console.warn('[ordAutoAssignAll]', e.message); }
}

async function ordAssignRoutecode(uid, geojsonZone, deliveryDate) {
  if (!uid || !geojsonZone || geojsonZone === 'UNASSIGNED' || !deliveryDate) return;
  if (ordState.routecodes[uid]) return;
  try {
    const res = await fetch('/api/routecode/assign', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${supState.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderId: uid, geojsonZone, deliveryDate }),
    });
    if (!res.ok) return;
    const data = await res.json();
    ordState.routecodes[uid] = { routeCode: data.routeCode, zone: data.zone, seq: data.seq, overLimit: data.overLimit };
    if (data.overLimit && data.warning) {
      const zL = (data.routeCode || '')[0];
      if (zL && !ordState.overLimitSeen.has(zL)) { ordState.overLimitSeen.add(zL); supNotify(data.warning, 'warn'); }
    }
    ordRenderTable();
    // เขียนรหัสรูตกลับ sheet เงียบๆ (ไม่บล็อก UI)
    ordWritebackRoutecodeToSheet([uid]).catch(e => console.warn('[writeback]', e.message));
  } catch(e) { console.warn('[ordAssignRoutecode]', e.message); }
}

async function ordRegenerateRoutecode(uid) {
  const existing = ordState.routecodes[uid];
  if (!existing) { supNotify('ออเดอร์นี้ยังไม่มีรหัสรูท', 'err'); return; }
  if (!confirm(`ยืนยันสร้างรหัสรูทใหม่?\nรหัสเดิม "${existing.routeCode}" จะถูกแทนที่`)) return;
  if (!confirm(`ยืนยันอีกครั้ง — รหัส "${existing.routeCode}" จะถูกยกเลิกถาวร`)) return;
  const order = (supState.allOrdersAll || []).find(o => (o.uid||o.id) === uid);
  if (!order) { supNotify('ไม่พบออเดอร์', 'err'); return; }
  try {
    const res = await fetch('/api/routecode/assign', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${supState.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderId: uid, geojsonZone: order.geojsonZone, deliveryDate: order.deliveryDate || order.timeWindow, force: true }),
    });
    if (!res.ok) { supNotify('สร้างรหัสใหม่ไม่สำเร็จ', 'err'); return; }
    const data = await res.json();
    ordState.routecodes[uid] = { routeCode: data.routeCode, zone: data.zone, seq: data.seq };
    supNotify(`สร้างรหัสใหม่สำเร็จ: ${data.routeCode}`, 'ok');
    ordRenderTable();
    // เขียนรหัสรูตใหม่กลับ sheet
    ordWritebackRoutecodeToSheet([uid]).catch(e => console.warn('[writeback]', e.message));
  } catch(e) { supNotify('สร้างรหัสใหม่ไม่สำเร็จ: ' + e.message, 'err'); }
}

// เขียน routecode ลง col A ของ sheet คำสั่งซื้อ
async function ordWritebackRoutecodeToSheet(orderIds) {
  const token = supState.token || localStorage.getItem('uflow_sup_token');
  if (!token) return;
  const body = orderIds && orderIds.length > 0 ? { orderIds } : {};
  const res = await fetch('/api/routecode/writeback', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// writeback ทุก routecode ในครั้งเดียว (ใช้เมื่อต้องการ sync ทั้งหมด)
async function ordWritebackAll() {
  const tsEl = document.getElementById('ord-sync-ts');
  if (tsEl) tsEl.textContent = 'เขียนรหัสรูตลง Sheet…';
  try {
    const result = await ordWritebackRoutecodeToSheet([]);
    supNotify(result.message || `เขียนรหัสรูต ${result.updated} รายการ`, 'ok');
    if (tsEl) tsEl.textContent = 'เขียนแล้ว: ' + new Date().toLocaleTimeString('th-TH');
  } catch(e) {
    supNotify('เขียนรหัสรูตไม่สำเร็จ: ' + e.message, 'err');
    if (tsEl) tsEl.textContent = 'เขียนไม่สำเร็จ';
  }
}

// =====================================
// Print — Delivery Note
// =====================================

const ORD_ZONE_FULL = { A: 'A — เมืองลำพูน', B: 'B — สารภี/เชียงใหม่', C: 'C — ป่าซาง' };

function ordZoneFullName(geojsonZone) {
  const letter = (geojsonZone || '').match(/Zone ([A-Z])/i)?.[1]?.toUpperCase();
  return letter ? (ORD_ZONE_FULL[letter] || geojsonZone) : (geojsonZone || '—');
}

function ordFormatThaiDateLong(dateStr) {
  if (!dateStr) return '—';
  const comp = ordParseDateComponents(dateStr);
  if (!comp) return String(dateStr);
  const M = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
  const thaiYr = comp.yr > 2500 ? comp.yr : comp.yr + 543;
  return `${comp.dy} ${M[comp.mo - 1] || ''} ${thaiYr}`;
}

function ordBuildDeliveryNoteHTML(order) {
  const uid = order.uid || order.id || '';
  const rcEntry = ordState.routecodes[uid] || {};
  const routeCode = rcEntry.routeCode || '';
  const zoneLetter = routeCode.match(/^([A-Z])/)?.[1] || '';
  const cardLabel  = routeCode.split('-')[1] || '';
  const routeFull  = routeCode.split('-')[0] || '';
  const deliveryDateStr = ordFormatThaiDateLong(order.deliveryDate || order.timeWindow || '');
  const zoneFullName = ordZoneFullName(order.geojsonZone);
  const isCoD = order.cod || (order.paymentType||'').toLowerCase().includes('cod') || (order.paymentType||'').includes('เก็บเงิน');
  const price = parseFloat(order.price) || 0;
  const priceStr = price > 0 ? `฿${price.toLocaleString('th-TH',{minimumFractionDigits:2})}` : '—';
  const now = new Date();
  const PM = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
  const printTime = `${now.getDate()} ${PM[now.getMonth()]} ${now.getFullYear()+543} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
  const printedBy = supState.userName || 'ผู้ดูแลระบบ';
  const addr = (order.address||'').replace(/, ?ประเทศไทย$/,'').replace(/, ?Thailand$/,'');

  return `<div class="dn-page" style="font-family:'Sarabun',sans-serif;font-size:13px;width:210mm;min-height:297mm;margin:0 auto;padding:16mm 14mm;box-sizing:border-box;color:#111;background:#fff">
<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:6mm">
  <div><div style="font-size:18px;font-weight:700">Unii Mart 584</div>
    <div style="color:#555;margin-top:3px;font-size:11.5px">คลังสินค้าสาขา 584 (เชียงใหม่–ลำพูน)<br>โทร. 0X-XXX-XXXX &middot; ออกเอกสารโดยระบบ u-flow</div>
  </div>
  <div style="text-align:right">
    <div style="font-size:22px;font-weight:800;letter-spacing:1px">ใบส่งของ</div>
    <div style="font-size:11px;color:#555;margin-top:4px;font-family:monospace">${escHtml(uid)}</div>
    ${routeCode
      ? `<div style="display:inline-flex;align-items:center;gap:8px;margin-top:8px;border:2.5px solid #111;border-radius:8px;padding:5px 12px 5px 8px"><div style="background:#111;color:#fff;font-size:15px;font-weight:700;border-radius:5px;width:26px;height:26px;display:flex;align-items:center;justify-content:center">${escHtml(zoneLetter)}</div><div style="font-size:20px;font-weight:700;font-family:monospace;letter-spacing:1px">${escHtml(routeFull)}-<span style="color:#1a56db">${escHtml(cardLabel)}</span></div></div>`
      : `<div style="border:2px dashed #d00;color:#d00;border-radius:6px;padding:6px 12px;margin-top:8px;font-size:12px">&#9888; ยังไม่มีรหัสรูท</div>`}
  </div>
</div>
<hr style="border:none;border-top:2px solid #111;margin:0 0 5mm">
<div style="display:grid;grid-template-columns:1fr 1fr;gap:5mm;margin-bottom:5mm">
  <div style="border:1px solid #ddd;border-radius:8px;padding:5mm">
    <div style="font-size:10px;color:#888;text-transform:uppercase;letter-spacing:.5px;margin-bottom:3mm">ผู้รับสินค้า</div>
    <div style="font-size:16px;font-weight:700;margin-bottom:2mm">${escHtml(order.customer || order.customerName || '—')}</div>
    <div style="color:#444;line-height:1.6;font-size:12px">${escHtml(addr)}</div>
    ${order.district ? `<div style="color:#666;font-size:11px;margin-top:2px">${escHtml(order.district)}</div>` : ''}
    ${order.phone ? `<div style="margin-top:3mm;font-size:13px">&#128222; ${escHtml(order.phone)}</div>` : ''}
  </div>
  <div style="border:1px solid #ddd;border-radius:8px;padding:5mm">
    <div style="font-size:10px;color:#888;text-transform:uppercase;letter-spacing:.5px;margin-bottom:3mm">ข้อมูลจัดส่ง</div>
    <table style="width:100%;font-size:12px;border-collapse:collapse">
      <tr><td style="color:#666;padding:1.5mm 0;width:42%">วันที่ส่ง</td><td style="font-weight:600">${deliveryDateStr}</td></tr>
      <tr><td style="color:#666;padding:1.5mm 0">โซน</td><td style="font-weight:600">${escHtml(zoneFullName)}</td></tr>
      <tr><td style="color:#666;padding:1.5mm 0">ชำระเงิน</td><td style="font-weight:600">${isCoD ? 'เก็บเงินปลายทาง (COD)' : 'จ่ายเงินแล้ว'}</td></tr>
      ${order.assignedDriverId ? `<tr><td style="color:#666;padding:1.5mm 0">คนขับ</td><td style="font-weight:600">${escHtml(order.assignedDriverId)}</td></tr>` : ''}
    </table>
  </div>
</div>
<div style="margin-bottom:5mm">
  <table style="width:100%;border-collapse:collapse">
    <thead><tr style="background:#111;color:#fff">
      <th style="padding:3mm 2mm;text-align:left;width:8mm;font-size:12px">#</th>
      <th style="padding:3mm 2mm;text-align:left;font-size:12px">รายการสินค้า</th>
      <th style="padding:3mm 4mm;text-align:right;width:20mm;font-size:12px">จำนวน</th>
      <th style="padding:3mm 4mm;text-align:right;width:18mm;font-size:12px">หน่วย</th>
    </tr></thead>
    <tbody><tr><td colspan="4" style="text-align:center;padding:8mm;color:#888;font-size:12px;font-style:italic">&#9203; รายการสินค้า — รอเชื่อมต่อ Unii API (ฟีเจอร์กำลังพัฒนา)</td></tr></tbody>
  </table>
  <div style="text-align:center;font-size:10.5px;color:#aaa;margin-top:2mm">— รายการสินค้าจะดึงจาก Unii API สด เมื่อฟีเจอร์พร้อม —</div>
</div>
<div style="display:flex;justify-content:flex-end;margin-bottom:8mm">
  <div style="min-width:72mm">
    <div style="display:flex;justify-content:space-between;padding:2mm 3mm;font-size:12px;border:1px solid #ddd;border-radius:6px 6px 0 0"><span>จำนวนรายการรวม</span><span style="font-weight:600">—</span></div>
    ${isCoD
      ? `<div style="display:flex;justify-content:space-between;padding:3mm;font-size:15px;font-weight:700;background:#111;color:#fff;border-radius:0 0 6px 6px"><span>ยอดเก็บปลายทาง</span><span>${priceStr}</span></div>`
      : `<div style="display:flex;justify-content:space-between;padding:3mm;font-size:12px;border:1px solid #ddd;border-radius:0 0 6px 6px"><span>จ่ายเงินแล้ว</span><span style="font-weight:600">${priceStr}</span></div>`}
  </div>
</div>
<div style="border-top:1px solid #ccc;padding-top:6mm;display:grid;grid-template-columns:1fr 1fr;gap:10mm">
  <div style="text-align:center">
    <div style="border-bottom:1.5px solid #333;height:12mm;margin-bottom:2mm"></div>
    <div style="font-weight:700;font-size:12px">ผู้ส่งของ</div>
    <div style="font-size:10px;color:#888;margin-top:1mm">ลงชื่อคนขับ พร้อมวันที่/เวลา</div>
    <div style="font-size:10px;color:#bbb;margin-top:1mm">รหัสรูท ${escHtml(routeCode)} &middot; ${escHtml(uid)}</div>
  </div>
  <div style="text-align:center">
    <div style="border-bottom:1.5px solid #333;height:12mm;margin-bottom:2mm"></div>
    <div style="font-weight:700;font-size:12px">ผู้รับของ</div>
    <div style="font-size:10px;color:#888;margin-top:1mm">ลงชื่อผู้รับ พร้อมวันที่/เวลา</div>
    <div style="font-size:10px;color:#bbb;margin-top:1mm">ปริ้นโดย: ${escHtml(printedBy)} &middot; ${printTime}</div>
  </div>
</div>
</div>`;
}

function ordPrintSingle(uid) {
  const order = (supState.allOrdersAll || []).find(o => (o.uid||o.id) === uid);
  if (!order) { supNotify('ไม่พบออเดอร์', 'err'); return; }
  if (!ordState.routecodes[uid]) { supNotify('ยังปริ้นไม่ได้ — รอกำหนดวันส่งหรือยืนยันโซนก่อน', 'warn'); return; }
  ordOpenPrintWindow([order]);
}

function ordPrintBatch() {
  const selectedUids = [...ordState.selected];
  if (selectedUids.length === 0) { supNotify('เลือกออเดอร์ก่อนปริ้น', 'warn'); return; }
  const noCode = selectedUids.filter(uid => !ordState.routecodes[uid]);
  if (noCode.length > 0) {
    if (!confirm(`${noCode.length} ออเดอร์ยังไม่มีรหัสรูท จะข้ามและปริ้นที่เหลือต่อ?`)) return;
  }
  const printable = selectedUids
    .filter(uid => ordState.routecodes[uid])
    .map(uid => (supState.allOrdersAll || []).find(o => (o.uid||o.id) === uid))
    .filter(Boolean)
    .sort((a, b) => (ordState.routecodes[a.uid||a.id]?.routeCode||'').localeCompare(ordState.routecodes[b.uid||b.id]?.routeCode||''));
  if (printable.length === 0) { supNotify('ไม่มีออเดอร์ที่ปริ้นได้', 'err'); return; }
  ordOpenPrintWindow(printable);
}

function ordOpenPrintWindow(orders) {
  const win = window.open('', '_blank', 'width=900,height=700');
  if (!win) { supNotify('บราวเซอร์บล็อก popup — กรุณาอนุญาต popup แล้วลองใหม่', 'err'); return; }
  const bodyPages = orders.map(o => ordBuildDeliveryNoteHTML(o)).join('<div style="page-break-after:always"></div>');
  const uidList = JSON.stringify(orders.map(o => o.uid||o.id));
  win.document.write(`<!DOCTYPE html><html lang="th"><head><meta charset="UTF-8"><title>ใบส่งของ</title>
<link href="https://fonts.googleapis.com/css2?family=Sarabun:wght@400;600;700;800&display=swap" rel="stylesheet">
<style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:'Sarabun',sans-serif;background:#f4f4f4}
@media print{body{background:#fff}.dn-page{page-break-after:always}@page{size:A4 portrait;margin:0}}</style>
</head><body>${bodyPages}<script>
window.addEventListener('load',function(){setTimeout(function(){window.print()},800)});
window.addEventListener('afterprint',function(){if(window.opener)window.opener.ordAfterPrint(${uidList});setTimeout(function(){window.close()},300)});
<\/script></body></html>`);
  win.document.close();
}

function ordAfterPrint(uids) { ordShowPrintedDialog(uids); }

function ordShowPrintedDialog(uids) {
  let el = document.getElementById('ord-printed-dialog');
  if (!el) { el = document.createElement('div'); el.id = 'ord-printed-dialog'; el.className = 'ord-printed-dialog-overlay'; document.body.appendChild(el); }
  el.innerHTML = `<div class="ord-printed-dialog">
    <div class="ord-printed-dialog-icon">&#128424;</div>
    <div class="ord-printed-dialog-title">ทำเครื่องหมายว่าปริ้นแล้ว?</div>
    <div class="ord-printed-dialog-desc">${uids.length} ใบส่งของ จะถูกบันทึกว่า "ปริ้นแล้ว"</div>
    <div class="ord-printed-dialog-actions">
      <button class="ord-printed-btn ord-printed-btn--yes" onclick="ordMarkPrinted(${JSON.stringify(uids)})">ใช่ — บันทึกว่าปริ้นแล้ว</button>
      <button class="ord-printed-btn ord-printed-btn--no" onclick="document.getElementById('ord-printed-dialog').style.display='none'">ไม่ใช่ตอนนี้</button>
    </div>
  </div>`;
  el.style.display = 'flex';
}

async function ordMarkPrinted(uids) {
  document.getElementById('ord-printed-dialog').style.display = 'none';
  try {
    const res = await fetch('/api/order/printed', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${supState.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderIds: uids }),
    });
    if (res.ok) {
      uids.forEach(id => { ordState.printed[id] = new Date().toISOString(); });
      supNotify(`บันทึก "ปริ้นแล้ว" สำเร็จ ${uids.length} ออเดอร์`, 'ok');
      ordRenderTable();
    }
  } catch(e) { supNotify('บันทึกไม่สำเร็จ: ' + e.message, 'err'); }
}

// =========================================================
// Zone Management (S7) — zm* namespace
// =========================================================

const zmState = {
  _inited: false,
  map: null,
  zones: [],
  overlapZones: [],
  customerPoints: [],
  selectedZoneId: null,
  isEditing: false,
  showHeatmap: true,
  polygonLayers: {},     // zoneId -> L.Polygon
  labelLayers: {},       // zoneId -> L.Marker or tooltip
  customerLayerGroup: null,
  coverageLayerGroup: null,
  drawControl: null,
  drawHandler: null,
  colors: ['#10b981', '#8b5cf6', '#f59e0b', '#06b6d4', '#ec4899', '#3b82f6', '#14b8a6', '#6366f1']
};

async function zmInit() {
  if (!zmState.map) {
    const mapEl = document.getElementById('zm-map');
    if (!mapEl) return;

    zmState.map = L.map(mapEl, {
      zoomControl: true,
      attributionControl: false
    }).setView([WAREHOUSE_HUB.lat, WAREHOUSE_HUB.lng], 12);

    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
      maxZoom: 19
    }).addTo(zmState.map);

    // Warehouse marker
    const whIcon = L.divIcon({
      className: '',
      html: `<div style="background:#0f172a;color:#fff;border-radius:50%;width:28px;height:28px;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 8px rgba(0,0,0,0.3);border:2px solid #fff;font-size:12px;"><i class="fa-solid fa-warehouse"></i></div>`,
      iconSize: [28, 28],
      iconAnchor: [14, 14]
    });
    L.marker([WAREHOUSE_HUB.lat, WAREHOUSE_HUB.lng], { icon: whIcon })
      .bindPopup('<b>ศูนย์กระจายสินค้า Unii Mart 584</b>')
      .addTo(zmState.map);

    zmState.customerLayerGroup = L.layerGroup().addTo(zmState.map);
    zmState.coverageLayerGroup = L.layerGroup().addTo(zmState.map);
  }

  // Invalidate map size so it renders properly inside tabs
  setTimeout(() => {
    if (zmState.map) zmState.map.invalidateSize();
  }, 200);

  await Promise.all([zmLoadZones(), zmLoadCustomerPoints()]);
  zmRenderAll();
  zmState._inited = true;
}

// โหลดข้อมูลโซนจาก /api/zones
async function zmLoadZones() {
  const token = supState.token || localStorage.getItem('uflow_sup_token') || localStorage.getItem('token');
  try {
    const res = await fetch('/api/zones', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (res.ok) {
      const data = await res.json();
      zmState.zones = data.zones || [];
      zmState.overlapZones = data.overlapZones || [];
    }
  } catch (e) {
    console.warn('[zmLoadZones] Error loading zones:', e.message);
  }
}

// โหลดพิกัดออเดอร์สำหรับแสดงจุดจางๆ
async function zmLoadCustomerPoints() {
  const token = supState.token || localStorage.getItem('uflow_sup_token') || localStorage.getItem('token');
  try {
    const res = await fetch('/api/zones/orders-heatmap', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (res.ok) {
      const data = await res.json();
      zmState.customerPoints = data.points || [];
      const statusEl = document.getElementById('zm-coverage-status');
      if (statusEl) {
        statusEl.textContent = `โหลดลูกค้าแล้ว ${zmState.customerPoints.length.toLocaleString()} จุด`;
      }
    }
  } catch (e) {
    console.warn('[zmLoadCustomerPoints] Error:', e.message);
  }
}

// คำนวณหาพื้นที่ทับซ้อนระหว่าง Polygon 2 อัน (polygon-clipping)
function zmIntersection(polyA, polyB) {
  if (!polyA || !polyB || polyA.length < 3 || polyB.length < 3) return null;
  const pc = window.polygonClipping || (typeof polygonClipping !== 'undefined' ? polygonClipping : null);
  if (!pc || typeof pc.intersection !== 'function') return null;

  // Convert Leaflet [lat, lng] to GeoJSON [[lng, lat]] with closed ring
  const ringA = polyA.map(p => [p[1], p[0]]);
  if (ringA[0][0] !== ringA[ringA.length - 1][0] || ringA[0][1] !== ringA[ringA.length - 1][1]) {
    ringA.push([ringA[0][0], ringA[0][1]]);
  }
  const ringB = polyB.map(p => [p[1], p[0]]);
  if (ringB[0][0] !== ringB[ringB.length - 1][0] || ringB[0][1] !== ringB[ringB.length - 1][1]) {
    ringB.push([ringB[0][0], ringB[0][1]]);
  }

  try {
    const res = pc.intersection([ringA], [ringB]);
    if (Array.isArray(res) && res.length > 0 && res[0].length > 0) {
      const outer = res[0][0];
      if (outer && outer.length >= 3) {
        return outer.map(pt => [parseFloat(pt[1].toFixed(5)), parseFloat(pt[0].toFixed(5))]);
      }
    }
  } catch (e) {
    console.warn('[zmIntersection] Error:', e.message);
  }
  return null;
}

// คำนวณหา Overlap Zones ทั้งหมดอัตโนมัติ
function zmComputeOverlaps() {
  const existingMap = {};
  (zmState.overlapZones || []).forEach(oz => {
    if (oz.letters) existingMap[oz.letters] = oz;
  });

  const newOverlaps = [];
  const zones = zmState.zones || [];

  for (let i = 0; i < zones.length; i++) {
    for (let j = i + 1; j < zones.length; j++) {
      const zA = zones[i];
      const zB = zones[j];
      const inter = zmIntersection(zA.polygon, zB.polygon);
      if (inter && inter.length >= 3) {
        const letters = [zA.letter, zB.letter].sort().join('');
        const prev = existingMap[letters] || {};
        newOverlaps.push({
          id: `overlap_${letters.toLowerCase()}`,
          letters,
          name: `Zone ${letters}`,
          driverCode: prev.driverCode || '',
          cardLimit: prev.cardLimit || 30,
          polygon: inter
        });
      }
    }
  }

  zmState.overlapZones = newOverlaps;
}

// Render ทั้งหมด
function zmRenderAll() {
  zmComputeOverlaps();
  zmRenderPolygons();
  zmRenderCustomerDots();
  zmRenderRightPanel();
}

// วาด Polygons บนแผนที่
function zmRenderPolygons() {
  if (!zmState.map) return;

  // ลบ layer เดิม
  Object.values(zmState.polygonLayers).forEach(layer => zmState.map.removeLayer(layer));
  Object.values(zmState.labelLayers).forEach(layer => zmState.map.removeLayer(layer));
  zmState.polygonLayers = {};
  zmState.labelLayers = {};

  // 1. วาด Base Zones
  zmState.zones.forEach((zone, idx) => {
    if (!Array.isArray(zone.polygon) || zone.polygon.length < 3) return;

    const color = zone.color || zmState.colors[idx % zmState.colors.length];
    const isSelected = zone.id === zmState.selectedZoneId;

    const poly = L.polygon(zone.polygon, {
      color: color,
      weight: isSelected ? 3.5 : 2.5,
      opacity: 0.9,
      fillColor: color,
      fillOpacity: isSelected ? 0.35 : 0.18,
      dashArray: null // เส้นทึบตาม spec
    }).addTo(zmState.map);

    poly.on('click', () => {
      zmSelectZone(zone.id);
    });

    // Label กลางโซน
    const center = poly.getBounds().getCenter();
    const labelMarker = L.marker(center, {
      icon: L.divIcon({
        className: 'zm-zone-label',
        html: `<span>${zone.letter || ''}</span>`,
        iconSize: [24, 24],
        iconAnchor: [12, 12]
      })
    }).addTo(zmState.map);

    zmState.polygonLayers[zone.id] = poly;
    zmState.labelLayers[zone.id] = labelMarker;

    if (zmState.isEditing && (isSelected || !zmState.selectedZoneId)) {
      zmEnablePolygonEdit(zone.id, poly);
    }
  });

  // 2. วาด Overlap Polygons (พื้นที่ทับซ้อน)
  zmState.overlapZones.forEach(oz => {
    if (!Array.isArray(oz.polygon) || oz.polygon.length < 3) return;
    const isSelected = oz.id === zmState.selectedZoneId;

    const poly = L.polygon(oz.polygon, {
      color: '#db2777',
      weight: isSelected ? 3.5 : 2.5,
      opacity: 1,
      dashArray: '6, 6', // เส้นประระบุเป็นพื้นที่ทับซ้อน
      fillColor: '#ec4899',
      fillOpacity: isSelected ? 0.5 : 0.3
    }).addTo(zmState.map);

    poly.on('click', () => {
      zmSelectZone(oz.id);
    });

    const center = poly.getBounds().getCenter();
    const labelMarker = L.marker(center, {
      icon: L.divIcon({
        className: 'zm-zone-label zm-zone-label--overlap',
        html: `<span style="color:#db2777;font-weight:800;">${oz.letters}</span>`,
        iconSize: [28, 24],
        iconAnchor: [14, 12]
      })
    }).addTo(zmState.map);

    zmState.polygonLayers[oz.id] = poly;
    zmState.labelLayers[oz.id] = labelMarker;
  });
}

// วาดจุดลูกค้า 30 วันจางๆ
function zmRenderCustomerDots() {
  if (!zmState.customerLayerGroup) return;
  zmState.customerLayerGroup.clearLayers();

  if (!zmState.showHeatmap) return;

  zmState.customerPoints.forEach(pt => {
    if (!pt.lat || !pt.lng) return;

    const dot = L.circleMarker([pt.lat, pt.lng], {
      radius: 3.5,
      fillColor: '#475569',
      color: '#334155',
      weight: 0.5,
      opacity: 0.5,
      fillOpacity: 0.35,
      className: 'zm-customer-dot'
    });

    dot.bindTooltip(`<b>${escHtml(pt.name || 'ลูกค้า')}</b><br><span style="font-size:11px">${escHtml(pt.address || '')}</span>`, {
      direction: 'top',
      offset: [0, -4]
    });

    zmState.customerLayerGroup.addLayer(dot);
  });
}

// นับจำนวนลูกค้าใน Polygon
function zmCountCustomersInPolygon(polygonCoords) {
  if (!polygonCoords || polygonCoords.length < 3) return 0;
  let count = 0;
  for (const pt of zmState.customerPoints) {
    if (pointInPolygon([pt.lat, pt.lng], polygonCoords)) {
      count++;
    }
  }
  return count;
}

// Render Panel ขวา
function zmRenderRightPanel() {
  const container = document.getElementById('zm-zone-list');
  const countEl = document.getElementById('zm-zone-total-count');
  if (!container) return;

  const total = zmState.zones.length + zmState.overlapZones.length;
  if (countEl) countEl.textContent = total;

  if (total === 0) {
    container.innerHTML = `<div style="text-align:center;padding:32px;color:var(--ink-3);font-size:var(--fs-detail);">
      <i class="fa-solid fa-draw-polygon" style="font-size:28px;margin-bottom:8px;opacity:0.4;"></i>
      <div>ยังไม่มีโซนจัดส่ง</div>
      <div style="font-size:var(--fs-label);margin-top:4px;">กดปุ่ม "วาดโซนใหม่" บนแผนที่เพื่อเริ่มต้น</div>
    </div>`;
    return;
  }

  // Get all active drivers list
  const driversList = (typeof drvState !== 'undefined' && Array.isArray(drvState.drivers) && drvState.drivers.length > 0)
    ? drvState.drivers
    : DRIVER_PROFILES;

  let html = '';

  // Helper to get assigned driver objects for a zone
  function getZoneDrivers(z) {
    let codes = [];
    if (Array.isArray(z.driverCodes) && z.driverCodes.length > 0) {
      codes = z.driverCodes;
    } else if (z.driverCode) {
      codes = [z.driverCode];
    }
    return codes.map(c => {
      const found = driversList.find(d => d.code === c);
      return found || { code: c, name: c, avatar: c.replace('DRV-',''), color: 'var(--st-available)' };
    });
  }

  // 1. Regular Zones
  zmState.zones.forEach((zone, idx) => {
    const isSelected = zone.id === zmState.selectedZoneId;
    const color = zone.color || zmState.colors[idx % zmState.colors.length];
    const custCount = zmCountCustomersInPolygon(zone.polygon);
    const assignedDrivers = getZoneDrivers(zone);
    const assignedCodes = new Set(assignedDrivers.map(d => d.code));
    const availableToAdd = driversList.filter(d => !assignedCodes.has(d.code));

    html += `
      <div class="zm-card ${isSelected ? 'is-selected' : ''}" id="zm-card-${zone.id}" onclick="zmSelectZone('${zone.id}')">
        <div class="zm-card-head">
          <div class="zm-card-title-row">
            <div class="zm-color-badge" style="background:${color};"></div>
            <div class="zm-card-name" onclick="event.stopPropagation();zmEditZoneName('${zone.id}')" title="คลิกเพื่อแก้ไขชื่อโซน">
              <span>${escHtml(zone.name || `Zone ${zone.letter}`)}</span>
              <button type="button" class="zm-name-edit-btn" onclick="event.stopPropagation();zmEditZoneName('${zone.id}')" title="แก้ไขชื่อโซน">
                <i class="fa-solid fa-pen"></i>
              </button>
            </div>
          </div>
          <div class="zm-card-stat">${custCount.toLocaleString()} ลูกค้า</div>
        </div>

        <div class="zm-card-body" style="grid-template-columns: 1fr; gap: 8px;">
          <div class="zm-field-group">
            <div style="display:flex; justify-content:space-between; align-items:center;">
              <label class="zm-field-label">คนขับรับผิดชอบ (${assignedDrivers.length} คน)</label>
              <div style="display:flex; align-items:center; gap:4px;">
                <label class="zm-field-label" style="margin:0;">โควตา</label>
                <input type="number" class="zm-input" style="width:55px; height:24px; font-size:11px; padding:0 4px;" value="${zone.cardLimit || 30}" min="1" max="200"
                  onchange="zmUpdateZoneCardLimit('${zone.id}', this.value)" onclick="event.stopPropagation()">
              </div>
            </div>

            <div class="zm-drivers-wrap">
              <div class="zm-driver-chips">
                ${assignedDrivers.length > 0 ? assignedDrivers.map(d => `
                  <span class="zm-driver-chip" style="--drv-color:${d.color || 'var(--st-available)'}">
                    <span class="zm-driver-chip-avatar">${escHtml(d.avatar || d.code.replace('DRV-',''))}</span>
                    <span class="zm-driver-chip-name">${escHtml(d.name ? d.name.split(' ')[0] : d.code)}</span>
                    <button type="button" class="zm-driver-chip-del" onclick="event.stopPropagation();zmRemoveZoneDriver('${zone.id}', '${d.code}')" title="นำคนขับออก">&times;</button>
                  </span>
                `).join('') : '<span class="zm-driver-empty-hint">ยังไม่กำหนดคนขับ</span>'}
              </div>
              ${availableToAdd.length > 0 ? `
                <select class="zm-select" style="height: 28px; font-size: 11px; margin-top: 2px;"
                  onchange="if(this.value){zmAddZoneDriver('${zone.id}', this.value);this.value='';}" onclick="event.stopPropagation()">
                  <option value="">+ เพิ่มคนขับรับผิดชอบ...</option>
                  ${availableToAdd.map(d => `<option value="${d.code}">${escHtml(d.name)} (${d.code})</option>`).join('')}
                </select>
              ` : ''}
            </div>
          </div>
        </div>

        <div class="zm-card-actions">
          <button class="zm-action-btn" onclick="event.stopPropagation();zmFocusZone('${zone.id}')" title="ดูบนแผนที่">
            <i class="fa-solid fa-location-crosshairs"></i> ดูตำแหน่ง
          </button>
          <button class="zm-action-btn zm-action-btn--delete" onclick="event.stopPropagation();zmDeleteZone('${zone.id}')" title="ลบโซนนี้">
            <i class="fa-solid fa-trash-can"></i> ลบ
          </button>
        </div>
      </div>
    `;
  });

  // 2. Overlap Zones (if any)
  zmState.overlapZones.forEach(oz => {
    const isSelected = oz.id === zmState.selectedZoneId;
    const custCount = zmCountCustomersInPolygon(oz.polygon);
    const assignedDrivers = getZoneDrivers(oz);
    const assignedCodes = new Set(assignedDrivers.map(d => d.code));
    const availableToAdd = driversList.filter(d => !assignedCodes.has(d.code));

    html += `
      <div class="zm-card is-overlap ${isSelected ? 'is-selected' : ''}" id="zm-card-${oz.id}" onclick="zmSelectZone('${oz.id}')">
        <div class="zm-card-head">
          <div class="zm-card-title-row">
            <div class="zm-color-badge" style="background:#ec4899;"></div>
            <div class="zm-card-name" onclick="event.stopPropagation();zmEditZoneName('${oz.id}')" title="คลิกเพื่อแก้ไขชื่อโซน">
              <span>${escHtml(oz.name || `Zone ${oz.letters}`)}</span>
              <button type="button" class="zm-name-edit-btn" onclick="event.stopPropagation();zmEditZoneName('${oz.id}')" title="แก้ไขชื่อโซน">
                <i class="fa-solid fa-pen"></i>
              </button>
            </div>
            <span class="zm-card-overlap-tag">⚠ ทับซ้อน ${oz.letters.split('').join('+')}</span>
          </div>
          <div class="zm-card-stat">${custCount.toLocaleString()} ลูกค้า</div>
        </div>

        <div class="zm-card-body" style="grid-template-columns: 1fr; gap: 8px;">
          <div class="zm-field-group">
            <div style="display:flex; justify-content:space-between; align-items:center;">
              <label class="zm-field-label">คนขับรับผิดชอบ (${assignedDrivers.length} คน)</label>
              <div style="display:flex; align-items:center; gap:4px;">
                <label class="zm-field-label" style="margin:0;">โควตา</label>
                <input type="number" class="zm-input" style="width:55px; height:24px; font-size:11px; padding:0 4px;" value="${oz.cardLimit || 30}" min="1" max="200"
                  onchange="zmUpdateOverlapCardLimit('${oz.id}', this.value)" onclick="event.stopPropagation()">
              </div>
            </div>

            <div class="zm-drivers-wrap">
              <div class="zm-driver-chips">
                ${assignedDrivers.length > 0 ? assignedDrivers.map(d => `
                  <span class="zm-driver-chip" style="--drv-color:${d.color || 'var(--st-available)'}">
                    <span class="zm-driver-chip-avatar">${escHtml(d.avatar || d.code.replace('DRV-',''))}</span>
                    <span class="zm-driver-chip-name">${escHtml(d.name ? d.name.split(' ')[0] : d.code)}</span>
                    <button type="button" class="zm-driver-chip-del" onclick="event.stopPropagation();zmRemoveZoneDriver('${oz.id}', '${d.code}')" title="นำคนขับออก">&times;</button>
                  </span>
                `).join('') : '<span class="zm-driver-empty-hint" style="color:var(--st-attention);">-- ยังไม่ตั้งคนขับ (จำเป็น) --</span>'}
              </div>
              ${availableToAdd.length > 0 ? `
                <select class="zm-select" style="height: 28px; font-size: 11px; margin-top: 2px;"
                  onchange="if(this.value){zmAddZoneDriver('${oz.id}', this.value);this.value='';}" onclick="event.stopPropagation()">
                  <option value="">+ เพิ่มคนขับรับผิดชอบ...</option>
                  ${availableToAdd.map(d => `<option value="${d.code}">${escHtml(d.name)} (${d.code})</option>`).join('')}
                </select>
              ` : ''}
            </div>
          </div>
        </div>
      </div>
    `;
  });

  container.innerHTML = html;

  // ตรวจสอบ banner เตือน
  const unassignedOverlap = zmState.overlapZones.some(oz => {
    const drivers = getZoneDrivers(oz);
    return drivers.length === 0;
  });
  const banner = document.getElementById('zm-overlap-banner');
  if (banner) {
    banner.style.display = unassignedOverlap ? 'flex' : 'none';
  }
}

// Helper เปิดโหมด Edit บน Polygon
function zmEnablePolygonEdit(zoneId, poly) {
  if (!poly) poly = zmState.polygonLayers[zoneId];
  if (!poly) return;

  if (!poly.editing) {
    if (typeof L !== 'undefined' && L.Edit && L.Edit.Poly) {
      poly.editing = new L.Edit.Poly(poly);
    }
  }
  if (poly.editing) {
    poly.editing.enable();

    // Listen to edit / vertex drag events
    poly.off('edit');
    poly.on('edit', () => {
      const latLngs = poly.getLatLngs()[0];
      if (Array.isArray(latLngs) && latLngs.length >= 3) {
        const coords = latLngs.map(ll => [parseFloat(ll.lat.toFixed(5)), parseFloat(ll.lng.toFixed(5))]);
        const z = zmState.zones.find(x => x.id === zoneId);
        if (z) {
          z.polygon = coords;
          // Update center label
          const center = poly.getBounds().getCenter();
          const lbl = zmState.labelLayers[zoneId];
          if (lbl) lbl.setLatLng(center);
          // Recalculate overlaps and counts
          zmComputeOverlaps();
          zmRenderRightPanel();
        }
      }
    });
  }
}

// เลือกโซน
function zmSelectZone(zoneId) {
  zmState.selectedZoneId = zoneId;
  const deleteBtn = document.getElementById('zm-btn-delete');
  if (deleteBtn) deleteBtn.style.display = zoneId ? 'inline-flex' : 'none';

  // Update styles and edit handles without recreating layers
  Object.entries(zmState.polygonLayers).forEach(([id, poly]) => {
    const isSelected = id === zoneId;
    const isBase = zmState.zones.some(z => z.id === id);
    const oz = zmState.overlapZones.find(x => x.id === id);

    poly.setStyle({
      weight: isSelected ? 3.5 : 2.5,
      fillOpacity: isSelected ? (oz ? 0.5 : 0.35) : (oz ? 0.3 : 0.18)
    });

    if (zmState.isEditing && isBase) {
      if (isSelected) {
        zmEnablePolygonEdit(id, poly);
      } else if (poly.editing) {
        poly.editing.disable();
      }
    }
  });

  zmRenderRightPanel();

  const card = document.getElementById(`zm-card-${zoneId}`);
  if (card) card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// แก้ไขชื่อโซน
function zmEditZoneName(zoneId) {
  const zone = zmState.zones.find(z => z.id === zoneId) || zmState.overlapZones.find(oz => oz.id === zoneId);
  if (!zone) return;

  const currentName = zone.name || (zone.letter ? `Zone ${zone.letter}` : `Zone ${zone.letters}`);
  const newName = prompt(`ระบุชื่อโซนใหม่สำหรับ "${currentName}":`, currentName);
  if (newName === null) return;
  const trimmed = newName.trim();
  if (!trimmed) {
    supNotify('ชื่อโซนต้องไม่ว่างเปล่า', 'warn');
    return;
  }

  zone.name = trimmed;
  zmRenderRightPanel();
  supNotify(`เปลี่ยนชื่อเป็น "${trimmed}" แล้ว — อย่าลืมกด "บันทึกโซน"`, 'ok');
}

// โฟกัสไปยังโซนบนแผนที่
function zmFocusZone(zoneId) {
  const poly = zmState.polygonLayers[zoneId];
  if (poly && zmState.map) {
    zmState.map.fitBounds(poly.getBounds(), { padding: [40, 40] });
    zmSelectZone(zoneId);
  }
}

// เพิ่มคนขับให้โซน (รองรับหลายคนขับต่อโซน)
function zmAddZoneDriver(zoneId, driverCode) {
  if (!driverCode) return;
  const z = zmState.zones.find(x => x.id === zoneId) || zmState.overlapZones.find(x => x.id === zoneId);
  if (!z) return;

  if (!Array.isArray(z.driverCodes)) {
    z.driverCodes = z.driverCode ? [z.driverCode] : [];
  }
  if (!z.driverCodes.includes(driverCode)) {
    z.driverCodes.push(driverCode);
    z.driverCode = z.driverCodes[0] || '';
  }

  const driversList = (typeof drvState !== 'undefined' && Array.isArray(drvState.drivers) && drvState.drivers.length > 0)
    ? drvState.drivers
    : DRIVER_PROFILES;
  const d = driversList.find(x => x.code === driverCode);
  if (d) supNotify(`เพิ่ม ${d.name} ใน ${z.name || z.letter || z.letters}`, 'info');

  zmRenderRightPanel();
}

// นำคนขับออกจากโซน
function zmRemoveZoneDriver(zoneId, driverCode) {
  const z = zmState.zones.find(x => x.id === zoneId) || zmState.overlapZones.find(x => x.id === zoneId);
  if (!z) return;

  if (!Array.isArray(z.driverCodes)) {
    z.driverCodes = z.driverCode ? [z.driverCode] : [];
  }
  z.driverCodes = z.driverCodes.filter(c => c !== driverCode);
  z.driverCode = z.driverCodes[0] || '';

  const driversList = (typeof drvState !== 'undefined' && Array.isArray(drvState.drivers) && drvState.drivers.length > 0)
    ? drvState.drivers
    : DRIVER_PROFILES;
  const d = driversList.find(x => x.code === driverCode);
  if (d) supNotify(`นำ ${d.name} ออกจาก ${z.name || z.letter || z.letters}`, 'info');

  zmRenderRightPanel();
}

// อัปเดตคนขับของโซน (backward compatibility)
function zmUpdateZoneDriver(zoneId, driverCode) {
  if (!driverCode) {
    const z = zmState.zones.find(x => x.id === zoneId);
    if (z) {
      z.driverCodes = [];
      z.driverCode = '';
      zmRenderRightPanel();
    }
    return;
  }
  zmAddZoneDriver(zoneId, driverCode);
}

// อัปเดต Card Limit
function zmUpdateZoneCardLimit(zoneId, limit) {
  const z = zmState.zones.find(x => x.id === zoneId);
  if (z) z.cardLimit = parseInt(limit, 10) || 30;
}

// อัปเดตคนขับโซนทับซ้อน (backward compatibility)
function zmUpdateOverlapDriver(overlapId, driverCode) {
  if (!driverCode) {
    const oz = zmState.overlapZones.find(x => x.id === overlapId);
    if (oz) {
      oz.driverCodes = [];
      oz.driverCode = '';
      zmRenderRightPanel();
    }
    return;
  }
  zmAddZoneDriver(overlapId, driverCode);
}

// อัปเดต Card limit โซนทับซ้อน
function zmUpdateOverlapCardLimit(overlapId, limit) {
  const oz = zmState.overlapZones.find(x => x.id === overlapId);
  if (oz) oz.cardLimit = parseInt(limit, 10) || 30;
}

// เริ่มวาดโซนใหม่ (Leaflet.draw)
function zmStartDraw() {
  if (!zmState.map) return;
  if (zmState.drawHandler) zmState.drawHandler.disable();

  // กำหนดตัวอักษรโซนถัดไป (A, B, C, D, ...)
  const existingLetters = new Set(zmState.zones.map(z => z.letter));
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let nextLetter = 'A';
  for (let i = 0; i < alphabet.length; i++) {
    if (!existingLetters.has(alphabet[i])) {
      nextLetter = alphabet[i];
      break;
    }
  }

  const drawBtn = document.getElementById('zm-btn-draw');
  const cancelBtn = document.getElementById('zm-btn-cancel');
  if (drawBtn) drawBtn.classList.add('is-active');
  if (cancelBtn) cancelBtn.style.display = 'inline-flex';

  supNotify(`คลิกบนแผนที่เพื่อเริ่มวาด Zone ${nextLetter} (ดับเบิลคลิกเพื่อจบ)`, 'info');

  zmState.drawHandler = new L.Draw.Polygon(zmState.map, {
    shapeOptions: {
      color: zmState.colors[zmState.zones.length % zmState.colors.length],
      weight: 3,
      fillOpacity: 0.25
    }
  });

  zmState.drawHandler.enable();

  // Event เมื่อวาดเสร็จ
  zmState.map.once(L.Draw.Event.CREATED, (e) => {
    const layer = e.layer;
    const latLngs = layer.getLatLngs()[0];
    const coords = latLngs.map(ll => [parseFloat(ll.lat.toFixed(5)), parseFloat(ll.lng.toFixed(5))]);

    const newZone = {
      id: 'zone_' + nextLetter.toLowerCase() + '_' + Date.now().toString(36),
      letter: nextLetter,
      name: `Zone ${nextLetter}`,
      color: zmState.colors[zmState.zones.length % zmState.colors.length],
      driverCode: '',
      cardLimit: 30,
      polygon: coords
    };

    zmState.zones.push(newZone);
    zmCancelAction();
    zmRenderAll();
    zmSelectZone(newZone.id);
    supNotify(`เพิ่ม Zone ${nextLetter} สำเร็จ — อย่าลืมกด "บันทึกโซน"`, 'ok');
  });
}

// สลับโหมดแก้ไขรูปทรง (ลากจุดมุม/กึ่งกลาง)
function zmToggleEdit() {
  zmState.isEditing = !zmState.isEditing;
  const editBtn = document.getElementById('zm-btn-edit');
  const editLabel = document.getElementById('zm-edit-label');

  if (zmState.isEditing) {
    if (editBtn) editBtn.classList.add('is-active');
    if (editLabel) editLabel.textContent = 'เสร็จสิ้นการแก้ไข';

    if (!zmState.selectedZoneId && zmState.zones.length > 0) {
      zmState.selectedZoneId = zmState.zones[0].id;
    }

    const targetZone = zmState.zones.find(z => z.id === zmState.selectedZoneId);

    // เปิด Edit บนโซนที่เลือก
    Object.entries(zmState.polygonLayers).forEach(([zoneId, poly]) => {
      const isTarget = !zmState.selectedZoneId || zoneId === zmState.selectedZoneId;
      const isBase = zmState.zones.some(z => z.id === zoneId);
      if (isBase && isTarget) {
        zmEnablePolygonEdit(zoneId, poly);
      } else if (poly.editing) {
        poly.editing.disable();
      }
    });

    supNotify(`กำลังแก้ไข ${targetZone ? (targetZone.name || targetZone.letter) : 'โซน'} — ลากจุดสี่เหลี่ยมที่มุมหรือจุดกลมกลางเส้น`, 'info');
  } else {
    if (editBtn) editBtn.classList.remove('is-active');
    if (editLabel) editLabel.textContent = 'แก้ไขรูปทรง';

    Object.values(zmState.polygonLayers).forEach(poly => {
      if (poly.editing) poly.editing.disable();
    });

    zmRenderAll();
    supNotify('เสร็จสิ้นการแก้ไขรูปทรง — อย่าลืมกด "บันทึกโซน"', 'ok');
  }
}

// ยกเลิก Action
function zmCancelAction() {
  if (zmState.drawHandler) {
    zmState.drawHandler.disable();
    zmState.drawHandler = null;
  }
  const drawBtn = document.getElementById('zm-btn-draw');
  const cancelBtn = document.getElementById('zm-btn-cancel');
  if (drawBtn) drawBtn.classList.remove('is-active');
  if (cancelBtn) cancelBtn.style.display = 'none';
}

// ลบโซนที่เลือก
function zmDeleteSelected() {
  if (!zmState.selectedZoneId) return;
  zmDeleteZone(zmState.selectedZoneId);
}

// ลบโซน
function zmDeleteZone(zoneId) {
  const z = zmState.zones.find(x => x.id === zoneId);
  const name = z ? (z.name || `Zone ${z.letter}`) : 'โซนนี้';
  if (!confirm(`ยืนยันการลบ ${name}?\nลูกค้าในพื้นที่นี้จะกลายเป็น "ไม่มีโซน"`)) return;

  zmState.zones = zmState.zones.filter(x => x.id !== zoneId);
  zmState.selectedZoneId = null;
  zmRenderAll();
  supNotify(`ลบ ${name} แล้ว — อย่าลืมกด "บันทึกโซน"`, 'ok');
}

// สลับแสดงจุดลูกค้า 30 วัน
function zmToggleHeatmap() {
  zmState.showHeatmap = !zmState.showHeatmap;
  const label = document.getElementById('zm-heatmap-label');
  const btn = document.getElementById('zm-btn-toggle-heatmap');
  if (btn) btn.classList.toggle('is-active', zmState.showHeatmap);
  if (label) label.textContent = zmState.showHeatmap ? 'จุดลูกค้า 30 วัน' : 'ซ่อนจุดลูกค้า';
  zmRenderCustomerDots();
}

// ตรวจความครอบคลุม
function zmCheckCoverage() {
  if (!zmState.map) return;
  zmState.coverageLayerGroup.clearLayers();

  let unassignedCount = 0;
  const unassignedLatLngs = [];

  zmState.customerPoints.forEach(pt => {
    let inAny = false;
    for (const z of zmState.zones) {
      if (pointInPolygon([pt.lat, pt.lng], z.polygon)) {
        inAny = true;
        break;
      }
    }

    if (!inAny) {
      unassignedCount++;
      unassignedLatLngs.push([pt.lat, pt.lng]);

      // ไฮไลต์จุดที่ไม่มีโซนด้วยวงแหวนสีส้ม/แดง
      const ring = L.circleMarker([pt.lat, pt.lng], {
        radius: 6.5,
        fillColor: '#ef4444',
        color: '#b91c1c',
        weight: 2,
        fillOpacity: 0.8
      });
      ring.bindPopup(`<b>จุดที่ยังไม่มีโซนครอบคลุม</b><br>${escHtml(pt.name || '')}<br><span style="font-size:11px">${escHtml(pt.address || '')}</span>`);
      zmState.coverageLayerGroup.addLayer(ring);
    }
  });

  const statusEl = document.getElementById('zm-coverage-status');
  if (unassignedCount > 0) {
    if (statusEl) {
      statusEl.innerHTML = `<span style="color:var(--st-attention);font-weight:700;">⚠ พบ ${unassignedCount} จุดที่ยังไม่มีโซน</span>`;
    }
    supNotify(`พบ ${unassignedCount} จุดที่ยังไม่มีโซนครอบคลุม`, 'warn');
    if (unassignedLatLngs.length > 0) {
      zmState.map.fitBounds(L.latLngBounds(unassignedLatLngs), { padding: [50, 50], maxZoom: 14 });
    }
  } else {
    if (statusEl) {
      statusEl.innerHTML = `<span style="color:var(--st-done);font-weight:700;">✔ โซนครอบคลุมลูกค้าทั้งหมด 100%</span>`;
    }
    supNotify('โซนครอบคลุมลูกค้าทั้งหมด 100%', 'ok');
  }
}

// บันทึกโซนทั้งหมดไปยัง backend
async function zmSaveAll() {
  const token = supState.token || localStorage.getItem('uflow_sup_token') || localStorage.getItem('token');
  if (!token) { supNotify('กรุณาล็อกอินก่อน', 'err'); return; }

  const saveBtn = document.getElementById('zm-save-btn');
  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> กำลังบันทึก…';
  }

  // เตรียม payload ที่สะอาดและตัดค่าแปลกปลอมออก
  const cleanZones = (zmState.zones || []).map(z => {
    const dCodes = Array.isArray(z.driverCodes) ? z.driverCodes.filter(Boolean) : (z.driverCode ? [z.driverCode] : []);
    return {
      id: z.id,
      letter: z.letter || 'A',
      name: z.name || `Zone ${z.letter}`,
      color: z.color || '#10b981',
      driverCodes: dCodes,
      driverCode: dCodes[0] || '',
      cardLimit: parseInt(z.cardLimit, 10) || 30,
      polygon: (z.polygon || []).map(pt => [parseFloat(Number(pt[0]).toFixed(5)), parseFloat(Number(pt[1]).toFixed(5))])
    };
  });

  const cleanOverlaps = (zmState.overlapZones || []).map(oz => {
    const dCodes = Array.isArray(oz.driverCodes) ? oz.driverCodes.filter(Boolean) : (oz.driverCode ? [oz.driverCode] : []);
    return {
      id: oz.id,
      letters: oz.letters,
      name: oz.name || `Zone ${oz.letters}`,
      driverCodes: dCodes,
      driverCode: dCodes[0] || '',
      cardLimit: parseInt(oz.cardLimit, 10) || 30,
      polygon: (oz.polygon || []).map(pt => [parseFloat(Number(pt[0]).toFixed(5)), parseFloat(Number(pt[1]).toFixed(5))])
    };
  });

  try {
    const res = await fetch('/api/zones/save', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        zones: cleanZones,
        overlapZones: cleanOverlaps
      })
    });

    const data = await res.json();
    if (data.success) {
      supNotify('✅ บันทึกข้อมูลโซนเรียบร้อยแล้ว', 'ok');
      ordBuildZoneChips();
      supRenderS1MapZones();
      if (Array.isArray(supState.allOrdersAll)) {
        supState.allOrdersAll = supState.allOrdersAll.map(o => supClassifyZone(o));
      }
      supFilterOrders();
      supRenderS1();
      if (typeof ordApplyFilters === 'function') ordApplyFilters();
    } else {
      supNotify(data.error || 'บันทึกไม่สำเร็จ', 'err');
    }
  } catch (e) {
    console.error('[zmSaveAll] Error:', e);
    supNotify('เกิดข้อผิดพลาดในการเชื่อมต่อเซิร์ฟเวอร์: ' + e.message, 'err');
  } finally {
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> บันทึกโซน';
    }
  }
}

// =========================================================
// S8: Driver Management (จัดการคนขับ)
// =========================================================

const drvState = {
  activeTab: 'list',
  drivers: [],
  isLoading: false,
  pinVisibility: {}
};

// โหลดรายชื่อคนขับ
async function drvLoadDrivers() {
  const token = supState.token || localStorage.getItem('uflow_sup_token') || localStorage.getItem('token');
  if (!token) return;

  drvState.isLoading = true;
  const gridEl = document.getElementById('drv-grid');
  if (gridEl) gridEl.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:40px;color:var(--ink-3);"><i class="fa-solid fa-spinner fa-spin" style="font-size:24px;"></i><div style="margin-top:8px;">กำลังโหลดรายชื่อคนขับ…</div></div>';

  try {
    const res = await fetch('/api/drivers', {
      headers: { 'Authorization': `Bearer ${token}` }
    });

    if (res.ok) {
      const data = await res.json();
      if (data.success && Array.isArray(data.drivers)) {
        drvState.drivers = data.drivers;
        DRIVER_PROFILES.length = 0;
        data.drivers.forEach(d => {
          DRIVER_PROFILES.push({
            id: d.id || d.code,
            code: d.code,
            name: d.name,
            phone: d.phone,
            zone: d.zone || (d.zones && d.zones[0]) || 'Zone A',
            zones: d.zones || [d.zone],
            avatar: d.avatar || d.code.replace('DRV-', ''),
            color: d.color || 'var(--st-available)',
            status: d.status || 'active',
            isSpecial: !!d.isSpecial
          });
        });
        drvUpdateCounts();
        drvRenderGrid();
        if (typeof ordBuildDriverChips === 'function') ordBuildDriverChips();
      }
    } else {
      supNotify('ไม่สามารถโหลดรายชื่อคนขับได้', 'err');
    }
  } catch (err) {
    console.error('[drvLoadDrivers] Error:', err);
    supNotify('เกิดข้อผิดพลาดในการโหลดคนขับ', 'err');
  } finally {
    drvState.isLoading = false;
  }
}

function drvUpdateCounts() {
  const total = drvState.drivers.length;
  const active = drvState.drivers.filter(d => d.status !== 'inactive').length;

  const totalEl = document.getElementById('drv-total-count');
  const activeEl = document.getElementById('drv-active-count');
  if (totalEl) totalEl.textContent = total;
  if (activeEl) activeEl.textContent = active;
}

// วาด Grid รายการคนขับ
function drvRenderGrid() {
  const gridEl = document.getElementById('drv-grid');
  if (!gridEl) return;

  if (drvState.drivers.length === 0) {
    gridEl.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:40px;color:var(--ink-3);">ยังไม่มีคนขับในระบบ กดปุ่ม "เพิ่มคนขับ" เพื่อเริ่มต้น</div>';
    return;
  }

  gridEl.innerHTML = drvState.drivers.map(d => {
    const isInactive = d.status === 'inactive';
    const isVisible = !!drvState.pinVisibility[d.code];
    const pinDisplay = isVisible ? d.pin : '••••';
    const avatarColor = d.color || 'var(--st-available)';
    const avatarText = d.avatar || d.code || 'DRV';
    const avgJobs = d.avgJobsPerDay !== undefined ? d.avgJobsPerDay : 0;
    const zonesList = Array.isArray(d.zones) && d.zones.length > 0 ? d.zones : [d.zone || 'Zone A'];

    return `
      <div class="drv-card ${isInactive ? 'is-inactive' : ''}" id="drv-card-${d.code}">
        <div class="drv-card-top">
          <div class="drv-profile-row">
            <div class="drv-avatar" style="background:${avatarColor};">${escHtml(avatarText)}</div>
            <div class="drv-info">
              <div class="drv-name-row">
                <span class="drv-name">${escHtml(d.name)}</span>
                <span class="sup-tag sup-tag-neutral" style="font-size:10px;">${escHtml(d.code)}</span>
              </div>
              <div class="drv-phone">
                <i class="fa-solid fa-phone" style="font-size:10px;"></i>
                <span>${d.phone ? escHtml(d.phone) : 'ไม่มีเบอร์โทร'}</span>
              </div>
            </div>
          </div>

          <div class="drv-status-toggle" title="${isInactive ? 'คลิกเพื่อเปิดใช้งาน' : 'คลิกเพื่อปิดใช้งาน'}">
            <label class="drv-switch">
              <input type="checkbox" ${isInactive ? '' : 'checked'} onchange="drvHandleStatusToggle('${d.code}', this.checked)">
              <span class="drv-slider"></span>
            </label>
          </div>
        </div>

        <!-- Zone Chips -->
        <div class="drv-zones-wrap">
          <span style="font-size:11px;color:var(--ink-3);margin-right:2px;">โซน:</span>
          ${zonesList.map(z => `<span class="drv-zone-chip"><i class="fa-solid fa-map-pin" style="font-size:9px;color:${avatarColor};margin-right:4px;"></i>${escHtml(z)}</span>`).join('')}
        </div>

        <!-- 30-Day Stats & PIN -->
        <div class="drv-stats-row">
          <div>
            <span style="color:var(--ink-3);">งานเฉลี่ย:</span>
            <strong style="color:var(--ink);margin-left:4px;">${avgJobs}</strong> <span style="font-size:11px;color:var(--ink-3);">จุด/วัน</span>
          </div>
          <div class="drv-pin-box">
            <span style="color:var(--ink-3);">PIN:</span>
            <span class="drv-pin-val" id="drv-pin-txt-${d.code}">${pinDisplay}</span>
            <button type="button" class="drv-pin-btn" onclick="drvTogglePinVisible('${d.code}')" title="แสดง/ซ่อน PIN">
              <i class="fa-solid ${isVisible ? 'fa-eye-slash' : 'fa-eye'}"></i>
            </button>
            <button type="button" class="drv-pin-btn" onclick="drvPromptResetPin('${d.code}')" title="รีเซ็ตรหัส PIN">
              รีเซ็ต
            </button>
          </div>
        </div>

        <!-- Actions -->
        <div class="drv-card-actions">
          <button class="sup-btn-action" onclick="drvOpenEditModal('${d.code}')">
            <i class="fa-solid fa-pen-to-square"></i> แก้ไขข้อมูล
          </button>
        </div>
      </div>
    `;
  }).join('');
}

// สลับแสดง/ซ่อน PIN
function drvTogglePinVisible(code) {
  drvState.pinVisibility[code] = !drvState.pinVisibility[code];
  const driver = drvState.drivers.find(d => d.code === code);
  if (!driver) return;

  const txtEl = document.getElementById(`drv-pin-txt-${code}`);
  if (txtEl) {
    txtEl.textContent = drvState.pinVisibility[code] ? driver.pin : '••••';
  }
  drvRenderGrid();
}

// สลับสถานะเปิด/ปิดใช้งาน (พร้อมแจ้งเตือนงานค้างจริง)
async function drvHandleStatusToggle(code, willBeActive) {
  const driver = drvState.drivers.find(d => d.code === code);
  if (!driver) return;

  const token = supState.token || localStorage.getItem('uflow_sup_token') || localStorage.getItem('token');
  if (!token) return;

  if (!willBeActive) {
    // ปิดใช้งาน -> เช็คงานค้างวันนี้ก่อน
    try {
      const checkRes = await fetch(`/api/drivers/pending-check?driverCode=${encodeURIComponent(code)}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const checkData = await checkRes.json();
      const pendingCount = (checkData.success && checkData.count) || 0;

      let confirmMsg = '';
      if (pendingCount > 0) {
        confirmMsg = `${driver.name} มีงานค้าง ${pendingCount} จุดวันนี้\nงานเหล่านี้จะกลับไปอยู่ใน "รายการต้องเคลียร์" ทันที\n\nยืนยันปิดใช้งานคนขับ?`;
      } else {
        confirmMsg = `ยืนยันการปิดใช้งาน ${driver.name}?\n(ประวัติงานและ COD ทั้งหมดยังคงอยู่ครบ)`;
      }

      if (!confirm(confirmMsg)) {
        // ยกเลิก -> คืนค่า toggle switch
        drvRenderGrid();
        return;
      }
    } catch (e) {
      console.warn('[drvHandleStatusToggle] Check failed:', e);
    }
  }

  // ส่งคำขอเปลี่ยนสถานะ
  try {
    const res = await fetch('/api/drivers/toggle-status', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        code,
        status: willBeActive ? 'active' : 'inactive'
      })
    });

    const data = await res.json();
    if (data.success) {
      supNotify(data.message || (willBeActive ? 'เปิดใช้งานสำเร็จ' : 'ปิดใช้งานสำเร็จ'), 'ok');
      await drvLoadDrivers();
      // รีเฟรชข้อมูลหน้างาน S1, S2, S3 ด้วย
      if (typeof dspLoadSummary === 'function') dspLoadSummary();
      if (typeof supLoadData === 'function') supLoadData();
      if (typeof ordApplyFilters === 'function') ordApplyFilters();
    } else {
      supNotify(data.error || 'เปลี่ยนสถานะไม่สำเร็จ', 'err');
      drvRenderGrid();
    }
  } catch (err) {
    console.error('[drvHandleStatusToggle] Error:', err);
    supNotify('เกิดข้อผิดพลาดในการเชื่อมต่อ', 'err');
    drvRenderGrid();
  }
}

// รีเซ็ต PIN
async function drvPromptResetPin(code) {
  const driver = drvState.drivers.find(d => d.code === code);
  if (!driver) return;

  const defaultNewPin = String(Math.floor(1000 + Math.random() * 9000));
  const input = prompt(`ระบุ PIN 4 หลักใหม่สำหรับ ${driver.name}:`, defaultNewPin);
  if (!input) return;

  const newPin = input.trim();
  if (!/^\d{4}$/.test(newPin)) {
    alert('รหัส PIN ต้องเป็นตัวเลข 4 หลักเท่านั้น');
    return;
  }

  const token = supState.token || localStorage.getItem('uflow_sup_token') || localStorage.getItem('token');
  try {
    const res = await fetch('/api/drivers/reset-pin', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ code, pin: newPin })
    });

    const data = await res.json();
    if (data.success) {
      supNotify(data.message || 'รีเซ็ต PIN สำเร็จ', 'ok');
      await drvLoadDrivers();
    } else {
      supNotify(data.error || 'รีเซ็ต PIN ไม่สำเร็จ', 'err');
    }
  } catch (e) {
    supNotify('เกิดข้อผิดพลาดในการรีเซ็ต PIN', 'err');
  }
}

// สุ่ม PIN 4 หลักใน Form
function drvGenRandomPin() {
  const pinInput = document.getElementById('drv-form-pin');
  if (pinInput) {
    pinInput.value = String(Math.floor(1000 + Math.random() * 9000));
  }
}

// เปิด Modal เพิ่มคนขับ
function drvOpenAddModal() {
  const titleEl = document.getElementById('drv-modal-title');
  const codeInput = document.getElementById('drv-form-code');
  const nameInput = document.getElementById('drv-form-name');
  const phoneInput = document.getElementById('drv-form-phone');
  const colorInput = document.getElementById('drv-form-color');

  if (titleEl) titleEl.textContent = 'เพิ่มคนขับใหม่';
  if (codeInput) codeInput.value = '';
  if (nameInput) nameInput.value = '';
  if (phoneInput) phoneInput.value = '';
  if (colorInput) colorInput.value = 'var(--st-available)';

  drvGenRandomPin();
  drvRenderZoneCheckboxes([]);

  const modal = document.getElementById('drv-modal-overlay');
  if (modal) modal.style.display = 'flex';
}

// เปิด Modal แก้ไขคนขับ
function drvOpenEditModal(code) {
  const driver = drvState.drivers.find(d => d.code === code);
  if (!driver) return;

  const titleEl = document.getElementById('drv-modal-title');
  const codeInput = document.getElementById('drv-form-code');
  const nameInput = document.getElementById('drv-form-name');
  const phoneInput = document.getElementById('drv-form-phone');
  const pinInput = document.getElementById('drv-form-pin');
  const colorInput = document.getElementById('drv-form-color');

  if (titleEl) titleEl.textContent = `แก้ไขข้อมูล ${driver.name}`;
  if (codeInput) codeInput.value = driver.code;
  if (nameInput) nameInput.value = driver.name || '';
  if (phoneInput) phoneInput.value = driver.phone || '';
  if (pinInput) pinInput.value = driver.pin || '';
  if (colorInput) colorInput.value = driver.color || 'var(--st-available)';

  drvRenderZoneCheckboxes(driver.zones || [driver.zone]);

  const modal = document.getElementById('drv-modal-overlay');
  if (modal) modal.style.display = 'flex';
}

// วาด Checkbox เลือกโซนใน Modal
function drvRenderZoneCheckboxes(selectedZones = []) {
  const container = document.getElementById('drv-form-zones');
  if (!container) return;

  // รวมโซนทั้งหมดจาก zmState (Base + Overlap)
  const availableZones = [];
  if (zmState.zones && zmState.zones.length > 0) {
    zmState.zones.forEach(z => availableZones.push(z.name || `Zone ${z.letter}`));
  } else {
    availableZones.push('Zone A — เมืองลำพูน', 'Zone B — สารภี/เชียงใหม่', 'Zone C — ป่าซาง', 'Zone D');
  }

  if (zmState.overlapZones && zmState.overlapZones.length > 0) {
    zmState.overlapZones.forEach(oz => availableZones.push(oz.name || `Zone ${oz.letters}`));
  }

  availableZones.push('ทุกโซน');

  container.innerHTML = availableZones.map(zName => {
    const isChecked = selectedZones.includes(zName);
    return `
      <label class="drv-zone-cb-label">
        <input type="checkbox" name="drv_zone_item" value="${escHtml(zName)}" ${isChecked ? 'checked' : ''}>
        <span>${escHtml(zName)}</span>
      </label>
    `;
  }).join('');
}

function drvCloseModal(e) {
  if (e && e.target && e.target.id !== 'drv-modal-overlay' && !e.target.closest('.drv-modal-close') && !e.target.classList.contains('drv-btn-cancel')) {
    return;
  }
  const modal = document.getElementById('drv-modal-overlay');
  if (modal) modal.style.display = 'none';
}

// บันทึกคนขับ (เพิ่มใหม่ / แก้ไข)
async function drvHandleSave(e) {
  e.preventDefault();
  const token = supState.token || localStorage.getItem('uflow_sup_token') || localStorage.getItem('token');
  if (!token) { supNotify('กรุณาล็อกอินก่อน', 'err'); return; }

  const code = (document.getElementById('drv-form-code')?.value || '').trim();
  const name = (document.getElementById('drv-form-name')?.value || '').trim();
  const phone = (document.getElementById('drv-form-phone')?.value || '').trim();
  const pin = (document.getElementById('drv-form-pin')?.value || '').trim();
  const color = document.getElementById('drv-form-color')?.value || 'var(--st-available)';

  // อ่านโซนที่เลือก
  const zoneCbs = document.querySelectorAll('input[name="drv_zone_item"]:checked');
  const selectedZones = Array.from(zoneCbs).map(cb => cb.value);

  if (!name) { alert('กรุณาระบุชื่อคนขับ'); return; }
  if (!/^\d{4}$/.test(pin)) { alert('รหัส PIN ต้องเป็นตัวเลข 4 หลัก'); return; }

  const submitBtn = document.getElementById('drv-btn-submit');
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> กำลังบันทึก…';
  }

  const endpoint = code ? '/api/drivers/update' : '/api/drivers/create';
  const payload = { code, name, phone, pin, color, zones: selectedZones };

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    if (data.success) {
      supNotify(data.message || 'บันทึกข้อมูลสำเร็จ', 'ok');
      drvCloseModal();
      await drvLoadDrivers();
    } else {
      supNotify(data.error || 'บันทึกไม่สำเร็จ', 'err');
    }
  } catch (err) {
    console.error('[drvHandleSave] Error:', err);
    supNotify('เกิดข้อผิดพลาดในการบันทึกข้อมูล', 'err');
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> บันทึกคนขับ';
    }
  }
}

// สลับแท็บในหน้าคนขับ
function drvSwitchTab(tab) {
  drvState.activeTab = tab;

  const listTabBtn = document.getElementById('drv-tab-list');
  const rosterTabBtn = document.getElementById('drv-tab-roster');
  const listSec = document.getElementById('drv-sec-list');
  const rosterSec = document.getElementById('drv-sec-roster');

  if (tab === 'list') {
    if (listTabBtn) listTabBtn.classList.add('is-active');
    if (rosterTabBtn) rosterTabBtn.classList.remove('is-active');
    if (listSec) listSec.style.display = 'block';
    if (rosterSec) rosterSec.style.display = 'none';
    drvLoadDrivers();
  } else {
    if (listTabBtn) listTabBtn.classList.remove('is-active');
    if (rosterTabBtn) rosterTabBtn.classList.add('is-active');
    if (listSec) listSec.style.display = 'none';
    if (rosterSec) rosterSec.style.display = 'block';
    rosInit();
  }
}

// =========================================================
// Weekly Roster (ตารางงานรายสัปดาห์) Logic
// =========================================================

const rosState = {
  mondayDate: null,
  scheduleMap: {}, // key: `${driver_id}_${dateStr}` -> { status, note }
  isLoading: false
};

// หาวันจันทร์ของสัปดาห์สำหรับวันที่กำหนด
function rosGetMonday(d) {
  const date = new Date(d);
  const day = date.getDay(); // 0 is Sun, 1 is Mon, ...
  const diff = date.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(date.setDate(diff));
  monday.setHours(0, 0, 0, 0);
  return monday;
}

// แปลง Date เป็น YYYY-MM-DD
function rosFormatDateStr(d) {
  const yr = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const da = String(d.getDate()).padStart(2, '0');
  return `${yr}-${mo}-${da}`;
}

// แปลงเป็นวันที่ภาษาไทยย่อ (เช่น 17 ส.ค. 2569)
function rosFormatThaiDate(d) {
  const months = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
  const da = d.getDate();
  const mo = months[d.getMonth()];
  const yr = d.getFullYear() + 543;
  return `${da} ${mo} ${yr}`;
}

const THAI_DAYS = ['จันทร์', 'อังคาร', 'พุธ', 'พฤหัสฯ', 'ศุกร์', 'เสาร์', 'อาทิตย์'];
const THAI_DAYS_SHORT = ['จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.', 'อา.'];

function rosInit() {
  if (!rosState.mondayDate) {
    rosState.mondayDate = rosGetMonday(new Date());
  }
  rosLoadSchedule();
}

function rosPrevWeek() {
  if (!rosState.mondayDate) rosState.mondayDate = rosGetMonday(new Date());
  rosState.mondayDate.setDate(rosState.mondayDate.getDate() - 7);
  rosLoadSchedule();
}

function rosNextWeek() {
  if (!rosState.mondayDate) rosState.mondayDate = rosGetMonday(new Date());
  rosState.mondayDate.setDate(rosState.mondayDate.getDate() + 7);
  rosLoadSchedule();
}

function rosThisWeek() {
  rosState.mondayDate = rosGetMonday(new Date());
  rosLoadSchedule();
}

async function rosLoadSchedule() {
  const token = supState.token || localStorage.getItem('uflow_sup_token') || localStorage.getItem('token');
  if (!token) return;

  if (!rosState.mondayDate) rosState.mondayDate = rosGetMonday(new Date());

  const monday = new Date(rosState.mondayDate);
  const sunday = new Date(monday);
  sunday.setDate(sunday.getDate() + 6);

  const startStr = rosFormatDateStr(monday);
  const endStr = rosFormatDateStr(sunday);

  const rangeEl = document.getElementById('ros-week-range-text');
  if (rangeEl) {
    rangeEl.textContent = `${rosFormatThaiDate(monday)} – ${rosFormatThaiDate(sunday)}`;
  }

  // โหลดรายชื่อคนขับถ้ายังไม่มี
  if (!drvState.drivers || drvState.drivers.length === 0) {
    await drvLoadDrivers();
  }

  try {
    const res = await fetch(`/api/schedule?startDate=${startStr}&endDate=${endStr}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });

    if (res.ok) {
      const data = await res.json();
      if (data.success && Array.isArray(data.schedule)) {
        rosState.scheduleMap = {};
        data.schedule.forEach(item => {
          rosState.scheduleMap[`${item.driver_id}_${item.date}`] = item;
        });
      }
    }
  } catch (err) {
    console.warn('[rosLoadSchedule] Error:', err);
  }

  rosRenderGrid();
  rosCheckTodayLeaveWarnings();
}

function rosRenderGrid() {
  const theadRow = document.getElementById('ros-thead-row');
  const tbody = document.getElementById('ros-tbody');
  if (!theadRow || !tbody) return;

  if (!rosState.mondayDate) rosState.mondayDate = rosGetMonday(new Date());

  const todayStr = rosFormatDateStr(new Date());

  // 7 วันในสัปดาห์
  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(rosState.mondayDate);
    d.setDate(d.getDate() + i);
    const dateStr = rosFormatDateStr(d);
    days.push({
      date: d,
      dateStr,
      dayName: THAI_DAYS[i],
      dayShort: THAI_DAYS_SHORT[i],
      dayNum: d.getDate(),
      isToday: dateStr === todayStr
    });
  }

  // 1. Render Header
  theadRow.innerHTML = `
    <th class="ros-th-driver">คนขับ (${drvState.drivers.length})</th>
    ${days.map(day => `
      <th class="ros-th-day ${day.isToday ? 'is-today' : ''}">
        <span class="ros-day-name">${day.dayShort}</span>
        <span class="ros-day-date">${day.dayNum}</span>
      </th>
    `).join('')}
  `;

  // 2. Render Body Rows
  const drivers = drvState.drivers || [];
  if (drivers.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" style="padding:40px;text-align:center;color:var(--ink-3);">ไม่พบข้อมูลคนขับ</td></tr>`;
    return;
  }

  tbody.innerHTML = drivers.map(d => {
    const isInactive = d.status === 'inactive';
    const avatarColor = d.color || 'var(--st-available)';
    const avatarText = d.avatar || d.code || 'DRV';
    const zoneName = (Array.isArray(d.zones) && d.zones[0]) || d.zone || 'ทุกโซน';

    return `
      <tr class="${isInactive ? 'is-inactive' : ''}" style="${isInactive ? 'opacity:0.6;' : ''}">
        <td class="ros-td-driver">
          <div class="ros-driver-cell">
            <div class="ros-driver-avatar" style="background:${avatarColor};">${escHtml(avatarText)}</div>
            <div class="ros-driver-info">
              <div class="ros-driver-name">${escHtml(d.name)}</div>
              <div class="ros-driver-sub">${escHtml(d.code)} · ${escHtml(zoneName)}</div>
            </div>
          </div>
        </td>

        ${days.map(day => {
          const key = `${d.code}_${day.dateStr}`;
          const rec = rosState.scheduleMap[key];
          const status = rec ? rec.status : 'working'; // default: working
          const note = rec ? rec.note : '';

          let chipClass = 'is-working';
          let chipLabel = 'ทำงาน';
          if (status === 'off') {
            chipClass = 'is-off';
            chipLabel = 'หยุด';
          } else if (status === 'leave') {
            chipClass = 'is-leave';
            chipLabel = 'ลา';
          }

          return `
            <td class="ros-td-day ${day.isToday ? 'is-today' : ''}">
              <div class="ros-chip ${chipClass}" onclick="rosCycleStatus('${d.code}', '${day.dateStr}')" title="คลิกเพื่อสลับสถานะ (ทำงาน/หยุด/ลา)">
                ${chipLabel}
              </div>
              ${status === 'leave' && note ? `<span class="ros-note-text" title="${escHtml(note)}">${escHtml(note)}</span>` : ''}
            </td>
          `;
        }).join('')}
      </tr>
    `;
  }).join('');
}

// สลับสถานะช่อง (ทำงาน -> หยุด -> ลา -> ทำงาน)
async function rosCycleStatus(driverId, dateStr) {
  const key = `${driverId}_${dateStr}`;
  const currentRec = rosState.scheduleMap[key];
  const currentStatus = currentRec ? currentRec.status : 'working';

  let nextStatus = 'working';
  if (currentStatus === 'working') {
    nextStatus = 'off';
  } else if (currentStatus === 'off') {
    // เปิด modal สำหรับใส่หมายเหตุการลา
    rosOpenNoteModal(driverId, dateStr);
    return;
  } else if (currentStatus === 'leave') {
    nextStatus = 'working';
  }

  await rosUpdateStatusApi(driverId, dateStr, nextStatus, '');
}

async function rosUpdateStatusApi(driverId, dateStr, status, note) {
  const token = supState.token || localStorage.getItem('uflow_sup_token') || localStorage.getItem('token');
  if (!token) return;

  const key = `${driverId}_${dateStr}`;
  rosState.scheduleMap[key] = {
    driver_id: driverId,
    date: dateStr,
    status,
    note: note || ''
  };

  rosRenderGrid();

  try {
    const res = await fetch('/api/schedule/update', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        driverId,
        date: dateStr,
        status,
        note
      })
    });

    const data = await res.json();
    if (data.success) {
      supNotify(`อัปเดตตารางงานเรียบร้อย (${status === 'working' ? 'ทำงาน' : status === 'off' ? 'หยุด' : 'ลา'})`, 'ok');
      rosCheckTodayLeaveWarnings();
    } else {
      supNotify(data.error || 'อัปเดตตารางงานไม่สำเร็จ', 'err');
    }
  } catch (err) {
    console.error('[rosUpdateStatusApi] Error:', err);
    supNotify('เกิดข้อผิดพลาดในการเชื่อมต่อ', 'err');
  }
}

// Modal หมายเหตุการลา
function rosOpenNoteModal(driverId, dateStr) {
  const driver = drvState.drivers.find(d => d.code === driverId);
  const driverName = driver ? driver.name : driverId;

  const d = new Date(dateStr);
  const thaiDateStr = isNaN(d.getTime()) ? dateStr : rosFormatThaiDate(d);

  document.getElementById('ros-note-driver-id').value = driverId;
  document.getElementById('ros-note-date').value = dateStr;
  document.getElementById('ros-note-summary').textContent = `${driverName} (${driverId}) — วันที่ ${thaiDateStr}`;

  const presetSel = document.getElementById('ros-note-preset');
  if (presetSel) presetSel.value = 'ลาป่วย';
  const customGroup = document.getElementById('ros-note-custom-group');
  if (customGroup) customGroup.style.display = 'none';
  const customInput = document.getElementById('ros-note-custom-input');
  if (customInput) customInput.value = '';

  const modal = document.getElementById('ros-note-modal-overlay');
  if (modal) modal.style.display = 'flex';
}

function rosSelectNotePreset(val) {
  const customGroup = document.getElementById('ros-note-custom-group');
  if (customGroup) {
    customGroup.style.display = val === 'custom' ? 'flex' : 'none';
  }
}

function rosCloseNoteModal(e) {
  if (e && e.target && e.target.id !== 'ros-note-modal-overlay' && !e.target.closest('.drv-modal-close') && !e.target.classList.contains('drv-btn-cancel')) {
    return;
  }
  const modal = document.getElementById('ros-note-modal-overlay');
  if (modal) modal.style.display = 'none';
}

async function rosSaveLeaveNote(e) {
  e.preventDefault();
  const driverId = document.getElementById('ros-note-driver-id').value;
  const dateStr = document.getElementById('ros-note-date').value;
  const presetVal = document.getElementById('ros-note-preset').value;
  const customVal = (document.getElementById('ros-note-custom-input')?.value || '').trim();

  const finalNote = presetVal === 'custom' ? (customVal || 'ลากิจ') : presetVal;

  rosCloseNoteModal();
  await rosUpdateStatusApi(driverId, dateStr, 'leave', finalNote);
}

// ตรวจสอบการลาในวันปัจจุบันและแสดงการแจ้งเตือนบนหน้าภาพรวมวันนี้ (S1)
function rosCheckTodayLeaveWarnings() {
  const alertContainer = document.getElementById('sup-s1-roster-alerts');
  if (!alertContainer) return;

  const todayStr = rosFormatDateStr(new Date());
  const warnings = [];

  // ตรวจสอบคนขับทุกคน
  (drvState.drivers || []).forEach(d => {
    if (d.status === 'inactive') return;

    const key = `${d.code}_${todayStr}`;
    const rec = rosState.scheduleMap[key];
    if (rec && (rec.status === 'leave' || rec.status === 'off')) {
      const statusText = rec.status === 'leave' ? `ลา (${rec.note || 'แจ้งลา'})` : 'หยุดประจำสัปดาห์';
      const assignedZones = Array.isArray(d.zones) && d.zones.length > 0 ? d.zones : [d.zone || 'Zone A'];

      // นับงานค้างวันนี้ในโซนที่คนขับนี้รับผิดชอบ
      let pendingZoneOrdersCount = 0;
      (supState.allOrders || []).forEach(o => {
        if ((o.status === 'available' || !o.status) && assignedZones.includes(o.geojsonZone)) {
          pendingZoneOrdersCount++;
        }
      });

      if (pendingZoneOrdersCount > 0) {
        warnings.push(`⚠ ${assignedZones.join(', ')} มีงานค้าง ${pendingZoneOrdersCount} จุดวันนี้ แต่ ${d.name} ${statusText} — ยังไม่ได้มอบหมายคนอื่น`);
      }
    }
  });

  if (warnings.length > 0) {
    alertContainer.innerHTML = warnings.map(w => `<div class="ros-alert-banner"><i class="fa-solid fa-triangle-exclamation" style="font-size:18px;"></i><div>${escHtml(w)}</div></div>`).join('');
    alertContainer.style.display = 'block';
  } else {
    alertContainer.innerHTML = '';
    alertContainer.style.display = 'none';
  }
}




// =========================================================
// Store Registry & Requirements (S6 ร้านค้า) Logic
// =========================================================

const stoState = {
  stores: [],
  filteredStores: [],
  activeFilter: 'all', // 'all' | 'incomplete' | 'complete'
  searchQuery: '',
  isLoading: false,
  activePhone: null
};

function stoInit() {
  stoLoadStores();
}

async function stoLoadStores(force = false) {
  const token = supState.token || localStorage.getItem('uflow_sup_token') || localStorage.getItem('token');
  if (!token) return;

  const tbody = document.getElementById('sto-tbody');
  if (tbody && (!stoState.stores || stoState.stores.length === 0)) {
    tbody.innerHTML = `<tr><td colspan="9" style="padding:40px;text-align:center;color:var(--ink-3);"><i class="fa-solid fa-spinner fa-spin"></i> กำลังโหลดทะเบียนร้านค้า…</td></tr>`;
  }

  stoState.isLoading = true;
  try {
    const res = await fetch(`/api/stores?force=${force ? 'true' : 'false'}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });

    if (res.ok) {
      const data = await res.json();
      if (data.success && Array.isArray(data.stores)) {
        stoState.stores = data.stores;

        const countAll = document.getElementById('sto-count-all');
        const countIncomplete = document.getElementById('sto-count-incomplete');
        const countComplete = document.getElementById('sto-count-complete');

        if (countAll) countAll.textContent = (data.count || data.stores.length).toLocaleString();
        if (countIncomplete) countIncomplete.textContent = (data.incompleteCount || data.stores.filter(s => !s.hasRequirements).length).toLocaleString();
        if (countComplete) countComplete.textContent = (data.completeCount || data.stores.filter(s => s.hasRequirements).length).toLocaleString();
      }
    }
  } catch (err) {
    console.error('[stoLoadStores] Error:', err);
  } finally {
    stoState.isLoading = false;
    stoApplyFilters();
  }
}

function stoSetFilter(filter) {
  stoState.activeFilter = filter;

  ['all', 'incomplete', 'complete'].forEach(f => {
    const btn = document.getElementById(`sto-filter-${f}`);
    if (btn) {
      if (f === filter) btn.classList.add('is-active');
      else btn.classList.remove('is-active');
    }
  });

  stoApplyFilters();
}

function stoApplyFilters() {
  const searchInput = document.getElementById('sto-search-input');
  const q = searchInput ? searchInput.value.trim().toLowerCase() : '';
  stoState.searchQuery = q;

  let list = stoState.stores || [];

  // 1. Filter by completion status
  if (stoState.activeFilter === 'incomplete') {
    list = list.filter(s => !s.hasRequirements);
  } else if (stoState.activeFilter === 'complete') {
    list = list.filter(s => s.hasRequirements);
  }

  // 2. Search query (normalize phone for search)
  if (q) {
    const normQ = q.replace(/[^0-9]/g, '');
    list = list.filter(s => {
      const nameMatch = (s.name || '').toLowerCase().includes(q);
      const addrMatch = (s.address || '').toLowerCase().includes(q);
      const zoneMatch = (s.zone || '').toLowerCase().includes(q);
      const phoneMatch = normQ ? (s.phone || '').includes(normQ) : (s.phone || '').includes(q);
      const notesMatch = s.requirements && s.requirements.customNotes && s.requirements.customNotes.toLowerCase().includes(q);
      return nameMatch || addrMatch || zoneMatch || phoneMatch || notesMatch;
    });
  }

  stoState.filteredStores = list;
  stoRenderTable();
}

function stoRenderTable() {
  const tbody = document.getElementById('sto-tbody');
  const displayedCount = document.getElementById('sto-displayed-count');
  const totalCount = document.getElementById('sto-total-count');

  if (displayedCount) displayedCount.textContent = (stoState.filteredStores || []).length.toLocaleString();
  if (totalCount) totalCount.textContent = (stoState.stores || []).length.toLocaleString();

  if (!tbody) return;

  if (stoState.isLoading && (!stoState.stores || stoState.stores.length === 0)) {
    tbody.innerHTML = `<tr><td colspan="9" style="padding:40px;text-align:center;color:var(--ink-3);"><i class="fa-solid fa-spinner fa-spin"></i> กำลังโหลดทะเบียนร้านค้า…</td></tr>`;
    return;
  }

  if (stoState.filteredStores.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9" style="padding:40px;text-align:center;color:var(--ink-3);">ไม่พบข้อมูลร้านค้าตามเงื่อนไขที่เลือก</td></tr>`;
    return;
  }

  // Render max 100 at a time for smooth performance
  const displayItems = stoState.filteredStores.slice(0, 100);

  tbody.innerHTML = displayItems.map(store => {
    const phone = store.phone || '';
    const photoUrl = phone ? photoDbGet(phone) : null;
    const thumbInner = photoUrl
      ? `<img src="${photoUrl}" alt="รูปร้าน" loading="lazy" style="width:32px;height:32px;border-radius:6px;object-fit:cover;">`
      : `<div style="width:32px;height:32px;border-radius:6px;background:var(--page);display:flex;align-items:center;justify-content:center;color:var(--ink-3);font-size:13px;"><i class="fa-solid fa-store"></i></div>`;

    const zoneName = store.zone || 'UNASSIGNED';
    const chipsHTML = (store.chips && store.chips.length > 0)
      ? store.chips.map(c => `<span class="sto-req-chip">${escHtml(c)}</span>`).join('')
      : '<span style="color:var(--ink-3);font-size:11px;">—</span>';

    const statusBadge = store.hasRequirements
      ? `<span class="sto-status-badge is-done"><i class="fa-solid fa-circle-check"></i> ครบแล้ว</span>`
      : `<span class="sto-status-badge is-incomplete"><i class="fa-solid fa-circle-exclamation"></i> ยังไม่กรอก</span>`;

    const lastDate = store.lastOrderDate ? ordFormatShortDate(store.lastOrderDate) : '—';

    return `
      <tr onclick="stoOpenSlideover('${escHtml(phone)}')">
        <td style="text-align:center;">${thumbInner}</td>
        <td>
          <div class="sto-store-name">${escHtml(store.name || 'ร้านค้า')}</div>
          <div style="font-size:11px;color:var(--ink-3);max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escHtml(store.address || '—')}</div>
        </td>
        <td>
          <div class="sto-phone-txt">${escHtml(phone)}</div>
        </td>
        <td>
          <span class="sto-zone-chip">${escHtml(zoneName)}</span>
        </td>
        <td>
          <div class="sto-req-chips-wrap">${chipsHTML}</div>
        </td>
        <td style="text-align:center;font-weight:700;">
          ${store.orderCount || 0}
        </td>
        <td style="font-size:12px;color:var(--ink-2);">
          ${lastDate}
        </td>
        <td style="text-align:center;">
          ${statusBadge}
        </td>
        <td style="text-align:center;color:var(--ink-3);">
          <i class="fa-solid fa-chevron-right" style="font-size:12px;"></i>
        </td>
      </tr>
    `;
  }).join('');
}

// เปิดหน้ารายละเอียดร้านค้า (Slide-over)
function stoOpenSlideover(phone) {
  const store = (stoState.stores || []).find(s => s.phone === phone);
  if (!store) return;

  stoState.activePhone = phone;
  const req = store.requirements || {};

  // 1. Meta & Header
  document.getElementById('sto-detail-name').textContent = store.name || 'ร้านค้า';
  document.getElementById('sto-form-phone').value = phone;
  document.getElementById('sto-form-name').value = store.name || '';
  document.getElementById('sto-meta-phone').textContent = phone;
  document.getElementById('sto-meta-zone').textContent = store.zone || 'ทุกโซน';
  document.getElementById('sto-meta-orders').textContent = `${store.orderCount || 0} ออเดอร์`;

  const statusBadge = document.getElementById('sto-detail-status-badge');
  if (statusBadge) {
    if (store.hasRequirements) {
      statusBadge.className = 'sto-status-badge is-done';
      statusBadge.innerHTML = '<i class="fa-solid fa-circle-check"></i> ครบแล้ว';
    } else {
      statusBadge.className = 'sto-status-badge is-incomplete';
      statusBadge.innerHTML = '<i class="fa-solid fa-circle-exclamation"></i> ยังไม่กรอกข้อมูล';
    }
  }

  // 2. Group 1: เวลา
  document.getElementById('sto-form-open-time').value = req.openTime || '';
  document.getElementById('sto-form-close-time').value = req.closeTime || '';
  document.getElementById('sto-form-break-time').value = req.breakTime || '';

  const closedDaysArr = Array.isArray(req.closedDays) ? req.closedDays : (req.closedDays ? String(req.closedDays).split(',') : []);
  document.querySelectorAll('input[name="sto_closed_day"]').forEach(cb => {
    cb.checked = closedDaysArr.includes(cb.value);
  });

  // 3. Group 2: การเข้าถึง
  document.getElementById('sto-form-narrow-alley').checked = !!req.narrowAlley;
  document.getElementById('sto-form-stairs').checked = !!req.stairs;
  document.getElementById('sto-form-parking').value = req.parkingSpot || '';
  document.getElementById('sto-form-entrance').value = req.entrance || '';

  // 4. Group 3: การติดต่อ
  document.getElementById('sto-form-call-before').value = req.callBeforeMinutes || '';
  document.getElementById('sto-form-signee').value = req.signee || '';
  document.getElementById('sto-form-backup-phone').value = req.backupPhone || '';

  // 5. Group 4: การเงิน
  document.getElementById('sto-form-payment-type').value = req.paymentType || 'สดเท่านั้น';
  document.getElementById('sto-form-tax-count').value = req.taxInvoicesCount || 1;
  document.getElementById('sto-form-check-day').value = req.checkCollectionDay || '';

  // 6. Group 5: อื่นๆ
  document.getElementById('sto-form-heavy-help').checked = !!req.heavyHelpNeeded;
  document.getElementById('sto-form-custom-notes').value = req.customNotes || '';

  // 7. Group 6: พิกัด & ที่อยู่
  document.getElementById('sto-detail-address').textContent = store.address || 'ไม่มีข้อมูลที่อยู่';
  const coordsTxt = (store.lat && store.lng) ? `${store.lat.toFixed(6)}, ${store.lng.toFixed(6)}` : 'ไม่มีพิกัด';
  document.getElementById('sto-detail-coords').textContent = coordsTxt;

  const mapsBtn = document.getElementById('sto-detail-maps-link');
  if (mapsBtn) {
    if (store.lat && store.lng) {
      mapsBtn.href = `https://www.google.com/maps/search/?api=1&query=${store.lat},${store.lng}`;
      mapsBtn.style.display = 'inline-flex';
    } else {
      mapsBtn.style.display = 'none';
    }
  }

  // 8. Group 7: ประวัติออเดอร์
  const histContainer = document.getElementById('sto-detail-orders-history');
  if (histContainer) {
    if (store.orders && store.orders.length > 0) {
      histContainer.innerHTML = store.orders.map(o => `
        <div class="sto-order-hist-item">
          <div>
            <strong style="font-family:var(--font-code);">${escHtml(o.uid || '—')}</strong>
            <span style="color:var(--ink-3);margin-left:6px;">${escHtml(o.date || '')}</span>
          </div>
          <div>
            <span style="font-weight:700;margin-right:8px;">฿${escHtml(o.totalSales || '0')}</span>
            <span style="font-size:11px;color:var(--st-available);">${escHtml(o.status || 'สำเร็จ')}</span>
          </div>
        </div>
      `).join('');
    } else {
      histContainer.innerHTML = `<div style="padding:10px;text-align:center;color:var(--ink-3);font-size:12px;">ไม่มีประวัติออเดอร์ย่อย</div>`;
    }
  }

  // เปิด Slideover
  const overlay = document.getElementById('sto-slideover-overlay');
  if (overlay) overlay.style.display = 'flex';
}

function stoCloseSlideover(e) {
  if (e && e.target && e.target.id !== 'sto-slideover-overlay' && !e.target.closest('.sto-slideover-close') && !e.target.classList.contains('drv-btn-cancel')) {
    return;
  }
  const overlay = document.getElementById('sto-slideover-overlay');
  if (overlay) overlay.style.display = 'none';
}

async function stoSaveRequirements(e) {
  e.preventDefault();
  const token = supState.token || localStorage.getItem('uflow_sup_token') || localStorage.getItem('token');
  if (!token) return;

  const phone = document.getElementById('sto-form-phone').value;
  const name = document.getElementById('sto-form-name').value;
  if (!phone) return;

  const closedDays = [];
  document.querySelectorAll('input[name="sto_closed_day"]:checked').forEach(cb => {
    closedDays.push(cb.value);
  });

  const payload = {
    phone,
    name,
    openTime: document.getElementById('sto-form-open-time').value,
    closeTime: document.getElementById('sto-form-close-time').value,
    breakTime: document.getElementById('sto-form-break-time').value,
    closedDays,
    narrowAlley: document.getElementById('sto-form-narrow-alley').checked,
    stairs: document.getElementById('sto-form-stairs').checked,
    parkingSpot: document.getElementById('sto-form-parking').value,
    entrance: document.getElementById('sto-form-entrance').value,
    callBeforeMinutes: parseInt(document.getElementById('sto-form-call-before').value, 10) || 0,
    signee: document.getElementById('sto-form-signee').value,
    backupPhone: document.getElementById('sto-form-backup-phone').value,
    paymentType: document.getElementById('sto-form-payment-type').value,
    taxInvoicesCount: parseInt(document.getElementById('sto-form-tax-count').value, 10) || 1,
    checkCollectionDay: document.getElementById('sto-form-check-day').value,
    heavyHelpNeeded: document.getElementById('sto-form-heavy-help').checked,
    customNotes: document.getElementById('sto-form-custom-notes').value
  };

  const submitBtn = document.getElementById('sto-btn-submit');
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> กำลังบันทึก…';
  }

  try {
    const res = await fetch('/api/stores/save', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    if (data.success) {
      supNotify('บันทึกข้อกำหนดร้านค้าสำเร็จ', 'ok');

      // Update in local state
      const targetStore = (stoState.stores || []).find(s => s.phone === phone);
      if (targetStore) {
        targetStore.requirements = data.store;
        targetStore.hasRequirements = true;

        const chips = [];
        if (data.store.callBeforeMinutes) chips.push(`โทรก่อน ${data.store.callBeforeMinutes} น.`);
        if (data.store.openTime && data.store.closeTime) chips.push(`เปิด ${data.store.openTime}-${data.store.closeTime}`);
        if (data.store.breakTime) chips.push(`พัก ${data.store.breakTime}`);
        if (data.store.narrowAlley) chips.push('ซอยแคบ');
        if (data.store.stairs) chips.push('ขึ้นบันได');
        if (data.store.heavyHelpNeeded) chips.push('ต้องช่วยยก');
        targetStore.chips = chips.slice(0, 3);
      }

      stoCloseSlideover();
      stoApplyFilters();
    } else {
      supNotify(data.error || 'บันทึกไม่สำเร็จ', 'err');
    }
  } catch (err) {
    console.error('[stoSaveRequirements] Error:', err);
    supNotify('เกิดข้อผิดพลาดในการบันทึกข้อมูล', 'err');
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> บันทึกข้อกำหนดร้านค้า';
    }
  }
}

// ==========================================================================
// S4: Cash On Delivery (COD) Reconciliation System
// ==========================================================================

let codState = {
  selectedDate: '17-08-2026',
  data: null,
  activeDriverDetail: null,
  localInputs: {}, // { [driverCode]: { verified, reason, customReason } }
  _inited: false
};

function codInit() {
  codPopulateDateSelect();
  codLoadSummary();
}

function codPopulateDateSelect() {
  const sel = document.getElementById('cod-date-select');
  if (!sel) return;

  const dates = (supState.availableDates && supState.availableDates.length > 0)
    ? supState.availableDates
    : ['17-08-2026', '15-08-2026', '14-08-2026', '13-08-2026', '12-08-2026'];

  if (!codState.selectedDate) {
    codState.selectedDate = supState.selectedDate || dates[0] || '17-08-2026';
  }

  sel.innerHTML = dates.map(d => {
    const isSelected = d === codState.selectedDate ? 'selected' : '';
    return `<option value="${d}" ${isSelected}>${formatThaiDate(d)}</option>`;
  }).join('');

  sel.value = codState.selectedDate;
}

function codChangeDate(val) {
  codState.selectedDate = val;
  codState.localInputs = {};
  codLoadSummary();
}

async function codLoadSummary() {
  const token = supState.token || localStorage.getItem('uflow_sup_token');
  const date = codState.selectedDate || '17-08-2026';
  const tbody = document.getElementById('cod-tbody');

  if (tbody) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; padding: 40px; color: var(--ink-3);"><i class="fa-solid fa-spinner fa-spin"></i> กำลังโหลดและคำนวณยอด COD...</td></tr>`;
  }

  try {
    const res = await fetch(`/api/cod/summary?date=${encodeURIComponent(date)}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (data.success) {
      codState.data = data;
      codRenderSummary(data);
    } else {
      if (tbody) tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; padding: 30px; color: var(--st-failed);">${data.error || 'โหลดข้อมูลไม่สำเร็จ'}</td></tr>`;
    }
  } catch (err) {
    console.error('[codLoadSummary]', err);
    if (tbody) tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; padding: 30px; color: var(--st-failed);"><i class="fa-solid fa-triangle-exclamation"></i> เกิดข้อผิดพลาดในการโหลดข้อมูล</td></tr>`;
  }
}

function codRenderSummary(data) {
  const totals = data.totals || {};
  const drivers = data.drivers || [];
  const isLocked = !!data.isLocked;

  // 0. Locked State & Banner
  const lockedBanner = document.getElementById('cod-locked-banner');
  const lockedDesc = document.getElementById('cod-locked-desc');
  const daycloseBtn = document.getElementById('cod-btn-dayclose');

  if (isLocked) {
    if (lockedBanner) {
      lockedBanner.style.display = 'flex';
      const closedInfo = data.dayClose ? `ปิดโดย ${data.dayClose.closed_by} เมื่อ ${new Date(data.dayClose.closed_at).toLocaleString('th-TH')}` : 'บันทึกบัญชีเรียบร้อยแล้ว';
      if (lockedDesc) lockedDesc.innerText = `${closedInfo} — ข้อมูลทั้งหมดเป็นแบบอ่านอย่างเดียว (Read-only) เพื่อความปลอดภัยทางบัญชี`;
    }
    if (daycloseBtn) {
      daycloseBtn.disabled = true;
      daycloseBtn.className = 'btn cod-btn-dayclose is-locked';
      daycloseBtn.innerHTML = '<i class="fa-solid fa-lock"></i> ปิดยอดแล้ว (Locked)';
    }
  } else {
    if (lockedBanner) lockedBanner.style.display = 'none';
    if (daycloseBtn) {
      if (totals.allDriversVerified) {
        daycloseBtn.disabled = false;
        daycloseBtn.className = 'btn btn--primary cod-btn-dayclose is-ready';
        daycloseBtn.innerHTML = '<i class="fa-solid fa-lock"></i> ปิดยอดวันนี้';
      } else {
        daycloseBtn.disabled = true;
        daycloseBtn.className = 'btn btn--primary cod-btn-dayclose';
        daycloseBtn.innerHTML = '<i class="fa-solid fa-lock"></i> ปิดยอดวันนี้ (ตรวจยังไม่ครบ)';
      }
    }
  }

  // 1. KPI Cards
  const expEl = document.getElementById('cod-kpi-expected');
  if (expEl) expEl.innerText = fmtBaht(totals.totalExpectedCash);
  const expSub = document.getElementById('cod-kpi-expected-sub');
  if (expSub) expSub.innerText = `กรองเฉพาะเงินสด + ส่งสำเร็จแล้ว ${totals.deliveredPointsCount || 0} จุด`;

  const repEl = document.getElementById('cod-kpi-reported');
  if (repEl) repEl.innerText = fmtBaht(totals.totalDriverReported);

  // Recalculate verified cash from local inputs + saved
  let totalVerified = 0;
  let verifiedDriversCount = 0;
  drivers.forEach(d => {
    const local = codState.localInputs[d.code] || {};
    const val = local.verified !== undefined ? local.verified : d.verifiedCash;
    if (val !== null && val !== '') {
      totalVerified += parseFloat(val) || 0;
      verifiedDriversCount++;
    }
  });

  const verEl = document.getElementById('cod-kpi-verified');
  if (verEl) verEl.innerText = verifiedDriversCount > 0 ? fmtBaht(totalVerified) : '—';
  const verSub = document.getElementById('cod-kpi-verified-sub');
  if (verSub) verSub.innerText = `รับมอบเงินสดเข้าคลังแล้ว ${verifiedDriversCount}/${drivers.length} คน`;

  // Diff Card
  const diffCard = document.getElementById('cod-kpi-diff-card');
  const diffEl = document.getElementById('cod-kpi-diff');
  const diff = verifiedDriversCount > 0 ? (totalVerified - totals.totalExpectedCash) : null;
  if (diffEl) {
    if (diff === null) {
      diffEl.innerText = '—';
      if (diffCard) diffCard.className = 'cod-kpi-card is-diff';
    } else if (diff === 0) {
      diffEl.innerText = '฿0.00 (ยอดตรง)';
      if (diffCard) diffCard.className = 'cod-kpi-card is-diff is-matched';
    } else if (diff > 0) {
      diffEl.innerText = `+${fmtBaht(diff)} (เงินเกิน)`;
      if (diffCard) diffCard.className = 'cod-kpi-card is-diff is-discrepancy';
    } else {
      diffEl.innerText = `-${fmtBaht(Math.abs(diff))} (เงินขาด)`;
      if (diffCard) diffCard.className = 'cod-kpi-card is-diff is-discrepancy';
    }
  }

  // Transfer Banner
  const tfEl = document.getElementById('cod-transfer-amount');
  if (tfEl) tfEl.innerText = fmtBaht(totals.totalTransferDelivered);

  // 2. Main Driver Table
  const tbody = document.getElementById('cod-tbody');
  const tableEl = document.querySelector('.cod-table');
  if (tableEl) {
    if (isLocked) tableEl.classList.add('is-locked');
    else tableEl.classList.remove('is-locked');
  }

  if (!tbody) return;

  if (drivers.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; padding: 40px; color: var(--ink-3);">ไม่มีรายการจัดส่งของคนขับในวันที่เลือก</td></tr>`;
    return;
  }

  tbody.innerHTML = drivers.map(d => codRenderDriverRow(d, isLocked)).join('');
}

function codRenderDriverRow(d, isLocked) {
  const local = codState.localInputs[d.code] || {};
  const currentVerified = local.verified !== undefined ? local.verified : (d.verifiedCash !== null ? d.verifiedCash : '');
  const currentNum = currentVerified !== '' ? parseFloat(currentVerified) : null;
  const currentDiff = currentNum !== null ? (currentNum - d.expectedCash) : d.diff;

  let rowCls = '';
  let statusBadge = '<span class="chip" style="background: var(--page); color: var(--ink-3);"><i class="fa-regular fa-clock"></i> รอรับมอบ</span>';
  let hasDiscrepancy = false;

  if (isLocked) {
    rowCls = 'cod-tr--locked';
    statusBadge = '<span class="chip chip--done"><i class="fa-solid fa-lock"></i> ปิดยอดแล้ว</span>';
  } else if (currentNum !== null) {
    if (currentDiff === 0) {
      rowCls = 'cod-tr--matched';
      statusBadge = '<span class="chip chip--done"><i class="fa-solid fa-check"></i> ยอดตรง</span>';
    } else {
      rowCls = 'cod-tr--discrepancy';
      hasDiscrepancy = true;
      const diffSign = currentDiff > 0 ? `+${fmtBaht(currentDiff)}` : `-${fmtBaht(Math.abs(currentDiff))}`;
      statusBadge = `<span class="chip chip--failed"><i class="fa-solid fa-triangle-exclamation"></i> ต่าง ${diffSign}</span>`;
    }
  }

  let diffText = '—';
  let diffCls = '';
  if (currentDiff !== null && currentNum !== null) {
    if (currentDiff === 0) {
      diffText = '฿0.00';
      diffCls = 'is-zero';
    } else if (currentDiff > 0) {
      diffText = `+${fmtBaht(currentDiff)}`;
      diffCls = 'is-surplus';
    } else {
      diffText = `-${fmtBaht(Math.abs(currentDiff))}`;
      diffCls = 'is-deficit';
    }
  }

  const selectedReason = local.reason !== undefined ? local.reason : (d.reason || 'ทอนผิด');
  const selectedCustom = local.customReason !== undefined ? local.customReason : (d.customReason || '');

  // Row 1: Main Table Row
  let html = `
  <tr class="${rowCls}" id="cod-row-${escHtml(d.code)}">
    <td>
      <div class="cod-driver-info">
        <div class="cod-avatar-badge">${escHtml(d.avatar || d.code.replace('DRV-', ''))}</div>
        <div class="cod-driver-name-wrap">
          <span class="cod-driver-name">${escHtml(d.name)}</span>
          <span class="cod-driver-code">${escHtml(d.code)} • ${escHtml((d.zones || [d.zone]).join(', '))}</span>
        </div>
      </div>
    </td>
    <td style="text-align: center;">
      <span class="chip chip--available">${d.deliveredCount} / ${d.totalOrders} จุด</span>
    </td>
    <td style="text-align: right;">
      <span class="cod-num">${fmtBaht(d.expectedCash)}</span>
    </td>
    <td style="text-align: right;">
      <span class="cod-num" style="color: var(--ink-2);">${fmtBaht(d.driverReportedCash)}</span>
    </td>
    <td style="text-align: center;">
      <div class="cod-input-wrap">
        <span style="color: var(--ink-3); font-size: 12px;">฿</span>
        <input type="number" step="0.01" class="cod-input" placeholder="0.00"
          value="${currentVerified !== '' ? currentVerified : ''}"
          ${isLocked ? 'disabled readonly' : ''}
          oninput="codOnInputVerified('${escHtml(d.code)}', this.value)"
          onkeydown="if(event.key==='Enter') codSaveDriverVerification('${escHtml(d.code)}');">
        ${!isLocked ? `<button class="cod-btn-quick" onclick="codQuickMatch('${escHtml(d.code)}', ${d.expectedCash})" title="ใส่ค่ายอดตรง">ตรง</button>` : ''}
      </div>
    </td>
    <td style="text-align: right;">
      <span class="cod-num ${diffCls}">${diffText}</span>
    </td>
    <td style="text-align: center;">
      ${statusBadge}
    </td>
    <td style="text-align: center;">
      <div style="display: flex; gap: 6px; justify-content: center;">
        <button class="btn btn--secondary btn--sm" onclick="codOpenDriverDetail('${escHtml(d.code)}')" title="ดูรายละเอียดบิล">
          <i class="fa-solid fa-list-check"></i> บิล (${d.totalOrders})
        </button>
        ${(currentNum !== null && !isLocked) ? `
          <button class="btn btn--primary btn--sm" onclick="codSaveDriverVerification('${escHtml(d.code)}')" title="บันทึกรับมอบ">
            <i class="fa-solid fa-check"></i>
          </button>
        ` : ''}
      </div>
    </td>
  </tr>
  `;

  // Row 2: Discrepancy Reason Input (if diff != 0)
  if (hasDiscrepancy && !isLocked) {
    html += `
    <tr class="cod-reason-row" id="cod-reason-row-${escHtml(d.code)}">
      <td colspan="8" style="padding: 8px 14px;">
        <div class="cod-reason-box">
          <i class="fa-solid fa-triangle-exclamation" style="color: #b45309;"></i>
          <strong>ระบุเหตุผลส่วนต่าง (${diffText}):</strong>
          <select class="cod-reason-select" onchange="codSetReason('${escHtml(d.code)}', this.value)">
            <option value="ทอนผิด" ${selectedReason === 'ทอนผิด' ? 'selected' : ''}>ทอนผิด</option>
            <option value="ลูกค้าจ่ายไม่ครบ" ${selectedReason === 'ลูกค้าจ่ายไม่ครบ' ? 'selected' : ''}>ลูกค้าจ่ายไม่ครบ</option>
            <option value="ลูกค้าขอจ่ายพรุ่งนี้" ${selectedReason === 'ลูกค้าขอจ่ายพรุ่งนี้' ? 'selected' : ''}>ลูกค้าขอจ่ายพรุ่งนี้</option>
            <option value="เงินสดสูญหาย" ${selectedReason === 'เงินสดสูญหาย' ? 'selected' : ''}>เงินสดสูญหาย</option>
            <option value="อื่นๆ" ${selectedReason === 'อื่นๆ' ? 'selected' : ''}>อื่นๆ (ระบุในช่อง)</option>
          </select>
          <input type="text" class="cod-reason-input" placeholder="คำอธิบายเพิ่มเติม เช่น ลูกค้าขอโอนวันพรุ่งนี้..."
            value="${escHtml(selectedCustom)}"
            oninput="codSetCustomReason('${escHtml(d.code)}', this.value)">
          <button class="btn btn--primary btn--sm" onclick="codSaveDriverVerification('${escHtml(d.code)}')">
            <i class="fa-solid fa-floppy-disk"></i> บันทึกเหตุผล
          </button>
        </div>
      </td>
    </tr>
    `;
  }

  return html;
}

function codOnInputVerified(code, val) {
  if (!codState.localInputs[code]) codState.localInputs[code] = {};
  codState.localInputs[code].verified = val;
  if (codState.data) codRenderSummary(codState.data);
}

function codQuickMatch(code, expected) {
  if (!codState.localInputs[code]) codState.localInputs[code] = {};
  codState.localInputs[code].verified = expected.toFixed(2);
  if (codState.data) codRenderSummary(codState.data);
}

function codSetReason(code, reason) {
  if (!codState.localInputs[code]) codState.localInputs[code] = {};
  codState.localInputs[code].reason = reason;
}

function codSetCustomReason(code, custom) {
  if (!codState.localInputs[code]) codState.localInputs[code] = {};
  codState.localInputs[code].customReason = custom;
}

async function codSaveDriverVerification(code) {
  const driver = (codState.data?.drivers || []).find(d => d.code === code);
  if (!driver) return;

  const local = codState.localInputs[code] || {};
  const verifiedVal = local.verified !== undefined ? local.verified : driver.verifiedCash;
  if (verifiedVal === null || verifiedVal === '') {
    supNotify('กรุณาระบุจำนวนเงินที่นับได้จริง', 'err');
    return;
  }

  const verified = parseFloat(verifiedVal);
  const diff = verified - driver.expectedCash;
  const reason = local.reason !== undefined ? local.reason : (driver.reason || 'ทอนผิด');
  const customReason = local.customReason !== undefined ? local.customReason : (driver.customReason || '');

  if (diff !== 0 && !reason && !customReason) {
    supNotify('มียอดส่วนต่าง กรุณาระบุเหตุผลก่อนบันทึก', 'err');
    return;
  }

  const token = supState.token || localStorage.getItem('uflow_sup_token') || localStorage.getItem('token');
  try {
    const res = await fetch('/api/cod/verify-driver', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        date: codState.selectedDate,
        driverId: code,
        expected: driver.expectedCash,
        collected: driver.driverReportedCash,
        verified: verified,
        reason: diff !== 0 ? reason : '',
        customReason: diff !== 0 ? customReason : ''
      })
    });
    const result = await res.json();
    if (result.success) {
      supNotify(`บันทึกรับมอบเงินสดของ ${driver.name} เรียบร้อยแล้ว (ซิงค์ _COD)`, 'ok');
      delete codState.localInputs[code];
      await codLoadSummary();
    } else {
      supNotify(result.error || 'บันทึกไม่สำเร็จ', 'err');
    }
  } catch (err) {
    console.error('[codSaveDriverVerification]', err);
    supNotify('เกิดข้อผิดพลาดในการบันทึกข้อมูล', 'err');
  }
}

// Day Close Modal
function codOpenDaycloseModal() {
  if (!codState.data) return;
  if (codState.data.isLocked) {
    supNotify('วันที่นี้ปิดยอดและล็อกบัญชีแล้ว', 'info');
    return;
  }

  const totals = codState.data.totals || {};
  if (!totals.allDriversVerified) {
    supNotify('ไม่สามารถปิดยอดได้ เนื่องจากยังมีคนขับที่ยังไม่ได้รับการตรวจนับและยืนยันยอดเงิน', 'err');
    return;
  }

  const modal = document.getElementById('cod-dayclose-modal');
  const dateEl = document.getElementById('cod-dc-date');
  const drvEl = document.getElementById('cod-dc-drivers');
  const ptsEl = document.getElementById('cod-dc-points');
  const expEl = document.getElementById('cod-dc-expected');
  const verEl = document.getElementById('cod-dc-verified');
  const diffEl = document.getElementById('cod-dc-diff');

  if (dateEl) dateEl.innerText = formatThaiDate(codState.selectedDate);
  if (drvEl) drvEl.innerText = `${codState.data.drivers.length} คน (ตรวจครบแล้ว)`;
  if (ptsEl) ptsEl.innerText = `${totals.deliveredPointsCount || 0} จุด`;
  if (expEl) expEl.innerText = fmtBaht(totals.totalExpectedCash);
  if (verEl) verEl.innerText = fmtBaht(totals.totalVerifiedCash);
  if (diffEl) {
    if (totals.netDifference === 0) {
      diffEl.innerText = '฿0.00 (ยอดตรงครบถ้วน)';
      diffEl.style.color = 'var(--st-available)';
    } else if (totals.netDifference > 0) {
      diffEl.innerText = `+${fmtBaht(totals.netDifference)} (เงินเกิน)`;
      diffEl.style.color = '#b45309';
    } else {
      diffEl.innerText = `-${fmtBaht(Math.abs(totals.netDifference))} (เงินขาด)`;
      diffEl.style.color = 'var(--st-failed)';
    }
  }

  if (modal) {
    modal.style.display = 'flex';
  }
}

function codCloseDaycloseModal(event) {
  if (event && event.target && event.target.closest('.modal-dialog')) return;
  const modal = document.getElementById('cod-dayclose-modal');
  if (modal) modal.style.display = 'none';
}

async function codConfirmDayclose() {
  const confirmBtn = document.getElementById('cod-dc-confirm-btn');
  if (confirmBtn) {
    confirmBtn.disabled = true;
    confirmBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> กำลังบันทึกและล็อกวัน…';
  }

  const token = supState.token || localStorage.getItem('uflow_sup_token') || localStorage.getItem('token');
  try {
    const res = await fetch('/api/cod/dayclose', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ date: codState.selectedDate })
    });
    const result = await res.json();
    if (result.success) {
      supNotify(`✅ ปิดยอดวันที่ ${formatThaiDate(codState.selectedDate)} สำเร็จและล็อกบัญชีแล้ว (ซิงค์ _DAYCLOSE)`, 'ok');
      codCloseDaycloseModal();
      await codLoadSummary();
    } else {
      supNotify(result.error || 'ปิดยอดไม่สำเร็จ', 'err');
    }
  } catch (err) {
    console.error('[codConfirmDayclose]', err);
    supNotify('เกิดข้อผิดพลาดในการเชื่อมต่อเซิร์ฟเวอร์', 'err');
  } finally {
    if (confirmBtn) {
      confirmBtn.disabled = false;
      confirmBtn.innerHTML = '<i class="fa-solid fa-lock"></i> ยืนยันปิดยอดและล็อกวัน';
    }
  }
}

// Level 2: Detail Modal
function codOpenDriverDetail(code) {
  const driver = (codState.data?.drivers || []).find(d => d.code === code);
  if (!driver) return;

  codState.activeDriverDetail = driver;
  const modal = document.getElementById('modal-cod-driver-detail');
  const title = document.getElementById('cod-detail-modal-title');
  const sub = document.getElementById('cod-detail-modal-sub');
  const bar = document.getElementById('cod-modal-summary-bar');
  const tbody = document.getElementById('cod-modal-tbody');

  if (title) title.innerText = `รายละเอียดออเดอร์: ${driver.name} (${driver.code})`;
  if (sub) sub.innerText = `วันที่จัดส่ง: ${formatThaiDate(codState.selectedDate)} • โซน: ${(driver.zones || [driver.zone]).join(', ')}`;

  if (bar) {
    bar.innerHTML = `
      <div><strong>ส่งสำเร็จ:</strong> <span class="num">${driver.deliveredCount} / ${driver.totalOrders} จุด</span></div>
      <div><strong>ควรเก็บสด:</strong> <span class="num" style="color:var(--st-available);font-weight:700;">${fmtBaht(driver.expectedCash)}</span></div>
      <div><strong>ยอดโอน (ไม่รวม COD):</strong> <span class="num" style="color:var(--ink-2);">${fmtBaht(driver.transferAmount)}</span></div>
    `;
  }

  if (tbody) {
    if (!driver.orders || driver.orders.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding: 24px; color: var(--ink-3);">ไม่มีรายการออเดอร์</td></tr>`;
    } else {
      tbody.innerHTML = driver.orders.map(o => {
        const isCash = o.isCash;
        const isDone = o.isDelivered;
        const codBadge = isDone
          ? (isCash ? '<span class="chip chip--done"><i class="fa-solid fa-money-bill"></i> รวมใน COD</span>' : '<span class="chip" style="background:var(--page);color:var(--ink-3);">โอนเงิน (ไม่รวม)</span>')
          : '<span class="chip chip--failed">ยังไม่ส่ง (ไม่รวม)</span>';

        const paymentBadge = isCash
          ? '<span style="color: #059669; font-weight:600;"><i class="fa-solid fa-money-bill"></i> เงินสด (COD)</span>'
          : '<span style="color: #2563eb; font-weight:600;"><i class="fa-solid fa-building-columns"></i> โอนเงิน</span>';

        return `
        <tr>
          <td><span class="ord-uid-badge">${escHtml(o.id)}</span></td>
          <td>
            <div style="font-weight:600; color:var(--ink);">${escHtml(o.customer || '—')}</div>
            <div style="font-size:11px; color:var(--ink-3);">${escHtml(o.district || '')}</div>
          </td>
          <td>${escHtml(o.deliveredAt ? o.deliveredAt.split(' ')[1] || o.deliveredAt : '—')}</td>
          <td style="text-align:center;">${paymentBadge}</td>
          <td style="text-align:right;" class="cod-num">${fmtBaht(o.price)}</td>
          <td style="text-align:center;">${codBadge}</td>
          <td style="text-align:center; font-size:11px; color:var(--ink-3);">${o.distanceWh ? o.distanceWh + ' km' : '—'}</td>
        </tr>
        `;
      }).join('');
    }
  }

  if (modal) modal.classList.add('is-open');
}

function codCloseDriverDetail() {
  const modal = document.getElementById('modal-cod-driver-detail');
  if (modal) modal.classList.remove('is-open');
}

// ==========================================================================
// S9: Dispatch Board / Workload Balancing (จัดการรูทส่ง / กระดานเกลี่ยงาน)
// ==========================================================================

let dspState = {
  selectedDate: '17-08-2026',
  data: null,
  activeZoneFilter: 'all',
  _inited: false
};

function dspInit() {
  dspPopulateDateSelect();
  dspLoadSummary();
}

function dspPopulateDateSelect() {
  const sel = document.getElementById('dsp-date-select');
  if (!sel) return;

  const dates = (supState.availableDates && supState.availableDates.length > 0)
    ? supState.availableDates
    : ['17-08-2026', '15-08-2026', '14-08-2026', '13-08-2026', '12-08-2026'];

  if (!dspState.selectedDate) {
    dspState.selectedDate = supState.selectedDate || dates[0] || '17-08-2026';
  }

  sel.innerHTML = dates.map(d => {
    const isSelected = d === dspState.selectedDate ? 'selected' : '';
    return `<option value="${d}" ${isSelected}>${formatThaiDate(d)}</option>`;
  }).join('');

  sel.value = dspState.selectedDate;
}

function dspChangeDate(val) {
  dspState.selectedDate = val;
  dspLoadSummary();
}

async function dspLoadSummary() {
  const token = supState.token || localStorage.getItem('uflow_sup_token') || localStorage.getItem('token');
  const date = dspState.selectedDate || '17-08-2026';

  const unassignedListEl = document.getElementById('dsp-unassigned-list');
  const driverGridEl = document.getElementById('dsp-driver-grid');
  if (unassignedListEl) {
    unassignedListEl.innerHTML = `<div style="padding: 30px; text-align: center; color: var(--ink-3);"><i class="fa-solid fa-spinner fa-spin"></i> กำลังโหลดออเดอร์...</div>`;
  }
  if (driverGridEl) {
    driverGridEl.innerHTML = `<div style="padding: 30px; text-align: center; color: var(--ink-3);"><i class="fa-solid fa-spinner fa-spin"></i> กำลังโหลดกระดานคนขับ...</div>`;
  }

  try {
    const res = await fetch(`/api/dispatch/summary?date=${encodeURIComponent(date)}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (data.success) {
      dspState.data = data;
      dspRender(data);
    } else {
      if (unassignedListEl) unassignedListEl.innerHTML = `<div style="padding:20px; color:var(--st-failed); text-align:center;">${data.error || 'โหลดข้อมูลไม่สำเร็จ'}</div>`;
    }
  } catch (err) {
    console.error('[dspLoadSummary]', err);
    if (unassignedListEl) unassignedListEl.innerHTML = `<div style="padding:20px; color:var(--st-failed); text-align:center;"><i class="fa-solid fa-triangle-exclamation"></i> เกิดข้อผิดพลาดในการโหลดกระดาน</div>`;
  }
}

function dspRender(data) {
  const totals = data.totals || {};
  const unassigned = data.unassignedOrders || [];
  const drivers = data.drivers || [];
  const avgPending = data.averagePending || 0;

  // 1. Top 4 KPI Cards
  const statTotal = document.getElementById('dsp-stat-total');
  const statClaimed = document.getElementById('dsp-stat-claimed');
  const statDrivers = document.getElementById('dsp-stat-drivers');
  const statClear = document.getElementById('dsp-stat-clear');

  if (statTotal) statTotal.innerText = (totals.totalStops || 0).toLocaleString();
  if (statClaimed) statClaimed.innerText = (totals.claimedCount || 0).toLocaleString();
  if (statDrivers) statDrivers.innerText = `${totals.workingDriversCount || 0} คน`;
  if (statClear) statClear.innerText = (totals.needClearCount || 0).toLocaleString();

  // Badges & Header
  const unassignedBadge = document.getElementById('dsp-unassigned-badge');
  if (unassignedBadge) unassignedBadge.innerText = `${unassigned.length} จุด`;

  const driversBadge = document.getElementById('dsp-drivers-badge');
  if (driversBadge) driversBadge.innerText = `${drivers.length} คน`;

  const avgEl = document.getElementById('dsp-avg-val');
  if (avgEl) avgEl.innerText = avgPending;

  // 2. Zone Filter Bar
  dspRenderZoneFilterBar(unassigned);

  // 3. Unassigned Orders List
  dspRenderUnassignedList();

  // 4. Drivers Grid
  dspRenderDriverGrid(drivers, avgPending);
}

function dspRenderZoneFilterBar(orders) {
  const bar = document.getElementById('dsp-zone-filter-bar');
  if (!bar) return;

  const zones = ['all', 'Zone A', 'Zone B', 'Zone C', 'Zone D', 'Zone AB', 'ไม่มีโซน'];
  const counts = { all: orders.length };

  orders.forEach(o => {
    const z = o.geojsonZone || 'ไม่มีโซน';
    if (z.includes('Zone A') && !z.includes('Zone AB') && !z.includes('Zone AC')) counts['Zone A'] = (counts['Zone A'] || 0) + 1;
    else if (z.includes('Zone B') && !z.includes('Zone AB')) counts['Zone B'] = (counts['Zone B'] || 0) + 1;
    else if (z.includes('Zone C') && !z.includes('Zone AC') && !z.includes('Zone CD')) counts['Zone C'] = (counts['Zone C'] || 0) + 1;
    else if (z.includes('Zone D') && !z.includes('Zone CD')) counts['Zone D'] = (counts['Zone D'] || 0) + 1;
    else if (z.includes('Zone AB') || z.includes('Zone AC') || z.includes('Zone CD')) counts['Zone AB'] = (counts['Zone AB'] || 0) + 1;
    else counts['ไม่มีโซน'] = (counts['ไม่มีโซน'] || 0) + 1;
  });

  bar.innerHTML = zones.map(z => {
    const isActive = dspState.activeZoneFilter === z ? 'is-active' : '';
    const label = z === 'all' ? 'ทั้งหมด' : z;
    const cnt = counts[z] || 0;
    return `
      <button class="dsp-filter-btn ${isActive}" onclick="dspSetZoneFilter('${escHtml(z)}')">
        ${label} (${cnt})
      </button>
    `;
  }).join('');
}

function dspSetZoneFilter(zone) {
  dspState.activeZoneFilter = zone;
  const bar = document.getElementById('dsp-zone-filter-bar');
  if (bar) {
    bar.querySelectorAll('.dsp-filter-btn').forEach(b => {
      if (b.innerText.startsWith(zone === 'all' ? 'ทั้งหมด' : zone)) b.classList.add('is-active');
      else b.classList.remove('is-active');
    });
  }
  dspRenderUnassignedList();
}

function dspRenderUnassignedList() {
  const container = document.getElementById('dsp-unassigned-list');
  if (!container) return;

  const allOrders = dspState.data?.unassignedOrders || [];
  const filter = dspState.activeZoneFilter || 'all';

  const filtered = allOrders.filter(o => {
    if (filter === 'all') return true;
    const z = o.geojsonZone || 'ไม่มีโซน';
    if (filter === 'Zone A') return z.includes('Zone A') && !z.includes('Zone AB') && !z.includes('Zone AC');
    if (filter === 'Zone B') return z.includes('Zone B') && !z.includes('Zone AB');
    if (filter === 'Zone C') return z.includes('Zone C') && !z.includes('Zone AC') && !z.includes('Zone CD');
    if (filter === 'Zone D') return z.includes('Zone D') && !z.includes('Zone CD');
    if (filter === 'Zone AB') return z.includes('Zone AB') || z.includes('Zone AC') || z.includes('Zone CD');
    if (filter === 'ไม่มีโซน') return z === 'ไม่มีโซน' || !z;
    return true;
  });

  if (filtered.length === 0) {
    container.innerHTML = `
      <div style="padding: 32px 16px; text-align: center; color: var(--ink-3); font-size: 13px;">
        <i class="fa-solid fa-circle-check" style="color: var(--st-available); font-size: 20px; margin-bottom: 6px; display: block;"></i>
        ไม่มีรายการออเดอร์ค้างในโซนนี้
      </div>
    `;
    return;
  }

  container.innerHTML = filtered.map(o => {
    const isCash = o.isCash;
    const paymentTag = isCash
      ? `<span class="chip chip--done" style="font-size:10px; padding:1px 5px;"><i class="fa-solid fa-money-bill"></i> COD ฿${fmtBaht(o.price)}</span>`
      : `<span class="chip" style="font-size:10px; padding:1px 5px; background:var(--page); color:var(--ink-2);"><i class="fa-solid fa-building-columns"></i> โอน</span>`;

    // Zone chip
    let zoneChipCls = 'chip--neutral';
    const zName = o.geojsonZone || 'ไม่มีโซน';
    if (zName.includes('Zone A')) zoneChipCls = 'chip--available';
    else if (zName.includes('Zone B')) zoneChipCls = 'chip--active';
    else if (zName.includes('Zone C')) zoneChipCls = 'chip--attention';
    else if (zName.includes('Zone D')) zoneChipCls = 'chip--blue';
    else if (zName.includes('Zone AB') || zName.includes('Zone AC')) zoneChipCls = 'chip--active';
    else if (zName === 'ไม่มีโซน') zoneChipCls = 'chip--failed';

    const storeChipHtml = (o.storeChips && o.storeChips.length > 0)
      ? o.storeChips.slice(0, 1).map(c => `<span class="chip" style="font-size:10px; padding:1px 5px; background:#fef3c7; color:#92400e; border:1px solid #fde68a;">${escHtml(c)}</span>`).join('')
      : '';

    return `
      <div class="dsp-order-card"
        data-order-id="${escHtml(o.id)}"
        draggable="true"
        ondragstart="dspOnDragStart(event, '${escHtml(o.id)}')"
        ondragend="dspOnDragEnd(event)">
        <div class="dsp-drag-handle" title="คลิกค้างแล้วลากไปใส่การ์ดคนขับฝั่งขวา"><i class="fa-solid fa-grip-vertical"></i></div>
        <div class="dsp-order-body">
          <div class="dsp-order-top">
            <span class="dsp-order-uid">${escHtml(o.uid || o.id)}</span>
            <span class="dsp-order-price">${fmtBaht(o.price)}</span>
          </div>
          <div class="dsp-order-customer" title="${escHtml(o.customer)}">${escHtml(o.customer)}</div>
          <div class="dsp-order-address" title="${escHtml(o.address)}">${escHtml(o.district ? o.district + ' • ' + o.address : o.address)}</div>
          <div class="dsp-order-meta">
            <span class="chip ${zoneChipCls}" style="font-size:10px; padding:1px 5px;">${escHtml(zName)}</span>
            ${paymentTag}
            ${storeChipHtml}
            <button type="button" class="dsp-mob-assign-btn" onclick="dspOpenMobileAssign('${escHtml(o.id)}')">
              <i class="fa-solid fa-user-plus"></i> มอบหมาย
            </button>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

function dspRenderDriverGrid(drivers, avgPending) {
  const grid = document.getElementById('dsp-driver-grid');
  if (!grid) return;

  if (drivers.length === 0) {
    grid.innerHTML = `<div style="padding: 40px; text-align: center; color: var(--ink-3);">ไม่มีรายชื่อคนขับ</div>`;
    return;
  }

  grid.innerHTML = drivers.map(d => {
    const badge = d.statusBadge || { label: 'ปกติ', variant: 'done' };
    const warning = d.workloadWarning;

    const zoneChipsHtml = (d.zones || [d.zone]).map(z => {
      return `<span class="chip" style="font-size: 11px; background: var(--page); color: var(--ink); border: 1px solid var(--line);">${escHtml(z)}</span>`;
    }).join('');

    return `
      <div class="dsp-driver-card"
        id="dsp-driver-card-${escHtml(d.code)}"
        data-driver-code="${escHtml(d.code)}"
        ondragover="dspOnDragOver(event)"
        ondragleave="dspOnDragLeave(event)"
        ondrop="dspOnDrop(event, '${escHtml(d.code)}')">
        
        <!-- Drop Overlay Hint -->
        <div class="dsp-driver-drop-overlay">
          <i class="fa-solid fa-circle-down" style="font-size: 28px; color: var(--st-available);"></i>
          <div style="font-weight: 700; color: var(--ink); font-size: 14px;">ปล่อยเพื่อมอบหมายให้ ${escHtml(d.name)}</div>
          <div style="font-size: 11px; color: var(--ink-2);">${escHtml((d.zones || [d.zone]).join(', '))}</div>
        </div>

        <!-- Header -->
        <div class="dsp-driver-header">
          <div class="dsp-driver-profile">
            <div class="dsp-driver-avatar" style="background: ${d.color || 'var(--st-available)'};">
              ${escHtml(d.avatar || d.code.replace('DRV-', ''))}
            </div>
            <div class="dsp-driver-name-box">
              <span class="dsp-driver-name">${escHtml(d.name)}</span>
              <span class="dsp-driver-code">${escHtml(d.code)}</span>
            </div>
          </div>
          <span class="chip chip--${badge.variant}" style="font-weight: 700;">
            ${escHtml(badge.label)}
          </span>
        </div>

        <!-- Zones -->
        <div class="dsp-driver-zones">
          ${zoneChipsHtml}
        </div>

        <!-- Progress Bar -->
        <div class="dsp-progress-wrap">
          <div class="dsp-progress-info">
            <span>ส่งสำเร็จแล้ว <b>${d.deliveredCount}</b> / ${d.totalCount} จุด</span>
            <strong>${d.progressPercent}%</strong>
          </div>
          <div class="dsp-progress-track">
            <div class="dsp-progress-fill" style="width: ${d.progressPercent}%;"></div>
          </div>
        </div>

        <!-- Sub Stats Row -->
        <div class="dsp-sub-stats">
          <div class="dsp-sub-stat-item">
            <span class="dsp-sub-lbl">จุดที่เหลือ</span>
            <span class="dsp-sub-val" style="color: ${d.pendingCount > 0 ? 'var(--ink)' : 'var(--st-available)'};">
              ${d.pendingCount} จุด
            </span>
          </div>
          <div class="dsp-sub-stat-item">
            <span class="dsp-sub-lbl">ยอด COD ต้องเก็บ</span>
            <span class="dsp-sub-val" style="color: var(--st-available);">
              ${fmtBaht(d.codAmount)}
            </span>
          </div>
        </div>

        <!-- High Workload Warning Box (if applicable) -->
        ${warning ? `
          <div class="dsp-warning-box">
            <div class="dsp-warning-text">
              <i class="fa-solid fa-triangle-exclamation" style="color: #d97706; font-size: 14px;"></i>
              <span>${escHtml(warning.message)}</span>
            </div>
            <button class="btn btn--secondary btn--sm" style="align-self: flex-start; background: #fff; font-size: 11px;" onclick="dspOpenRebalanceModal('${escHtml(d.code)}')">
              <i class="fa-solid fa-sliders"></i> ดูตัวเลือกเกลี่ยงาน
            </button>
          </div>
        ` : ''}

        <!-- Team / Cross-zone helpers info -->
        <div class="dsp-team-row">
          <i class="fa-solid fa-people-arrows"></i>
          <span>${d.hasHelperOrders ? `มีออเดอร์ช่วยข้ามโซน (${d.helperOrderCount} จุด)` : 'วิ่งงานในโซนรับผิดชอบ'}</span>
        </div>

        <!-- Footer / Action -->
        <div class="dsp-card-footer">
          <button class="btn btn--secondary btn--sm" onclick="dspGoToOrdersWithFilter('${escHtml(d.code)}')">
            <i class="fa-solid fa-arrow-up-right-from-square"></i> ดูรายละเอียดโซน
          </button>
        </div>
      </div>
    `;
  }).join('');
}

function dspGoToOrdersWithFilter(driverCode) {
  supShowPage('s2');
  const filterSel = document.getElementById('ord-driver-filter');
  if (filterSel) {
    filterSel.value = driverCode;
    ordApplyFilters();
  }
}

function dspOpenRebalanceModal(driverCode) {
  supNotify(`เปิดตัวเลือกเกลี่ยงานสำหรับคนขับ ${driverCode} (ลากออเดอร์จากฝั่งซ้ายมาใส่การ์ดนี้ได้เลย)`, 'info');
}

// Current pending cross-zone assignment state
let dspCrosszonePending = null;

// HTML5 Drag & Drop handlers
function dspOnDragStart(event, orderId) {
  const order = dspState.data?.unassignedOrders?.find(o => o.id === orderId || o.uid === orderId);
  if (!order) return;

  event.dataTransfer.setData('text/plain', JSON.stringify(order));
  event.dataTransfer.effectAllowed = 'move';

  const card = event.currentTarget;
  if (card) {
    setTimeout(() => card.classList.add('is-dragging'), 0);
  }
}

function dspOnDragEnd(event) {
  const card = event.currentTarget;
  if (card) card.classList.remove('is-dragging');
  document.querySelectorAll('.dsp-driver-card').forEach(el => el.classList.remove('is-drag-over'));
}

function dspOnDragOver(event) {
  event.preventDefault();
  event.dataTransfer.dropEffect = 'move';
  const card = event.currentTarget;
  if (card && !card.classList.contains('is-drag-over')) {
    card.classList.add('is-drag-over');
  }
}

function dspOnDragLeave(event) {
  const card = event.currentTarget;
  if (card) card.classList.remove('is-drag-over');
}

async function dspOnDrop(event, driverCode) {
  event.preventDefault();
  const card = event.currentTarget;
  if (card) card.classList.remove('is-drag-over');

  try {
    const rawData = event.dataTransfer.getData('text/plain');
    if (!rawData) return;
    const order = JSON.parse(rawData);
    if (!order || !order.id) return;

    await dspExecuteAssign({
      orderId: order.id,
      driverId: driverCode,
      order: order
    });
  } catch (err) {
    console.error('[dspOnDrop]', err);
  }
}

async function dspExecuteAssign({ orderId, driverId, reason = '', order = null }) {
  const token = supState.token || localStorage.getItem('uflow_sup_token') || localStorage.getItem('token');
  const driver = dspState.data?.drivers?.find(d => d.code === driverId || d.id === driverId);

  try {
    const res = await fetch('/api/dispatch/assign', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ orderId, driverId, reason })
    });

    const data = await res.json();

    if (res.status === 400 && data.requiresReason) {
      // Need cross-zone release reason
      dspOpenCrosszoneModal({
        orderId,
        driverId,
        orderZone: data.orderZone || order?.geojsonZone || 'ไม่มีโซน',
        customer: order?.customer || orderId,
        driverName: driver ? `${driver.name} (${driver.code})` : driverId,
        driverZones: data.driverZones || (driver?.zones || [driver?.zone] || [])
      });
      return;
    }

    if (res.status === 409) {
      // Collision detected
      supNotify(`⚠️ ${data.error || 'ออเดอร์นี้ถูกจองไปแล้วโดยคนขับอื่น'}`, 'failed');
      dspLoadSummary();
      return;
    }

    if (!res.ok) {
      throw new Error(data.error || `HTTP ${res.status}`);
    }

    supNotify(`✓ มอบหมายออเดอร์ ${orderId} ให้ ${driver ? driver.name : driverId} สำเร็จ`, 'success');
    dspCloseCrosszoneModal();
    dspLoadSummary();
  } catch (err) {
    console.error('[dspExecuteAssign]', err);
    supNotify(`เกิดข้อผิดพลาด: ${err.message}`, 'failed');
  }
}

function dspOpenCrosszoneModal({ orderId, driverId, orderZone, customer, driverName, driverZones }) {
  dspCrosszonePending = { orderId, driverId };

  const uidEl = document.getElementById('dsp-cz-order-uid');
  const custEl = document.getElementById('dsp-cz-customer');
  const ozEl = document.getElementById('dsp-cz-order-zone');
  const dNameEl = document.getElementById('dsp-cz-driver-name');
  const dZonesEl = document.getElementById('dsp-cz-driver-zones');
  const modal = document.getElementById('dsp-crosszone-modal');

  if (uidEl) uidEl.innerText = orderId;
  if (custEl) custEl.innerText = customer || '-';
  if (ozEl) ozEl.innerText = orderZone || 'ไม่มีโซน';
  if (dNameEl) dNameEl.innerText = driverName || driverId;
  if (dZonesEl) dZonesEl.innerText = Array.isArray(driverZones) ? driverZones.join(', ') : driverZones;

  const sel = document.getElementById('dsp-cz-reason-select');
  if (sel) sel.value = 'ช่วยกระจายภาระงาน (โซนหลักงานล้น)';
  const custom = document.getElementById('dsp-cz-custom-input');
  if (custom) {
    custom.value = '';
    custom.style.display = 'block';
  }

  if (modal) modal.style.display = 'flex';
}

function dspCloseCrosszoneModal(e) {
  if (e && e.target && e.target.id !== 'dsp-crosszone-modal' && !e.target.classList.contains('modal-close')) {
    // click inside modal
  }
  const modal = document.getElementById('dsp-crosszone-modal');
  if (modal) modal.style.display = 'none';
  dspCrosszonePending = null;
}

function dspOnSelectCzReason(val) {
  const custom = document.getElementById('dsp-cz-custom-input');
  if (custom) {
    custom.style.display = val === 'อื่นๆ' ? 'block' : 'none';
    if (val === 'อื่นๆ') custom.focus();
  }
}

async function dspConfirmCrosszone() {
  if (!dspCrosszonePending) return;

  const sel = document.getElementById('dsp-cz-reason-select');
  const custom = document.getElementById('dsp-cz-custom-input');
  let reason = sel ? sel.value : 'ช่วยกระจายภาระงาน (โซนหลักงานล้น)';
  if (reason === 'อื่นๆ' && custom && custom.value.trim()) {
    reason = custom.value.trim();
  } else if (custom && custom.value.trim()) {
    reason = `${reason}: ${custom.value.trim()}`;
  }

  const { orderId, driverId } = dspCrosszonePending;
  const btn = document.getElementById('dsp-cz-confirm-btn');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> กำลังบันทึก...`;
  }

  try {
    await dspExecuteAssign({ orderId, driverId, reason });
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `<i class="fa-solid fa-check"></i> ยืนยันมอบหมายข้ามโซน`;
    }
  }
}

// Mobile Assign modal
let dspMobSelectedOrderId = null;

function dspOpenMobileAssign(orderId) {
  dspMobSelectedOrderId = orderId;
  const order = dspState.data?.unassignedOrders?.find(o => o.id === orderId || o.uid === orderId);
  const infoEl = document.getElementById('dsp-mob-order-info');
  const listEl = document.getElementById('dsp-mob-drivers-list');
  const modal = document.getElementById('dsp-mobile-assign-modal');

  if (infoEl && order) {
    infoEl.innerHTML = `
      <div style="font-weight:700; color:var(--ink);">${escHtml(order.uid || order.id)} • ${fmtBaht(order.price)}</div>
      <div style="color:var(--ink-2); font-size:11px;">${escHtml(order.customer)} (${escHtml(order.geojsonZone)})</div>
    `;
  }

  if (listEl) {
    const drivers = dspState.data?.drivers || [];
    listEl.innerHTML = drivers.map(d => {
      return `
        <div class="dsp-mob-drv-item" onclick="dspSelectDriverMobile('${escHtml(d.code)}')">
          <div style="display:flex; align-items:center; gap:8px;">
            <div class="dsp-driver-avatar" style="background:${d.color || 'var(--st-available)'}; width:28px; height:28px; font-size:10px;">
              ${escHtml(d.avatar || d.code.replace('DRV-',''))}
            </div>
            <div>
              <div style="font-weight:700; font-size:13px; color:var(--ink);">${escHtml(d.name)}</div>
              <div style="font-size:11px; color:var(--ink-3);">${escHtml((d.zones||[d.zone]).join(', '))}</div>
            </div>
          </div>
          <button type="button" class="btn btn--primary btn--sm" style="font-size:11px;">เลือก</button>
        </div>
      `;
    }).join('');
  }

  if (modal) modal.style.display = 'flex';
}

function dspCloseMobileAssignModal() {
  const modal = document.getElementById('dsp-mobile-assign-modal');
  if (modal) modal.style.display = 'none';
  dspMobSelectedOrderId = null;
}

function dspSelectDriverMobile(driverCode) {
  if (!dspMobSelectedOrderId) return;
  const orderId = dspMobSelectedOrderId;
  const order = dspState.data?.unassignedOrders?.find(o => o.id === orderId || o.uid === orderId);
  dspCloseMobileAssignModal();
  dspExecuteAssign({ orderId, driverId: driverCode, order });
}

/* ===================================================
   S3: ศูนย์รออนุมัติ (Approval Center Logic)
   =================================================== */

const apprState = {
  activeTab: 'crosszone', // 'crosszone' | 'products'
  crossZoneRequests: [],
  productPendingCount: 0,
  timerInterval: null,
  rejectPendingId: null
};

function getSupToken() {
  return supState.token || localStorage.getItem('uflow_sup_token') || localStorage.getItem('token') || '';
}

function apprInit() {
  apprSwitchTab(apprState.activeTab || 'crosszone');
  apprLoadCrossZoneSummary();

  if (apprState.timerInterval) clearInterval(apprState.timerInterval);
  apprState.timerInterval = setInterval(apprUpdateTimers, 1000);
}

function apprSwitchTab(tabName) {
  apprState.activeTab = tabName;

  const btnCz = document.getElementById('appr-tab-btn-cz');
  const btnProd = document.getElementById('appr-tab-btn-prod');
  const paneCz = document.getElementById('appr-pane-cz');
  const paneProd = document.getElementById('appr-pane-prod');

  if (btnCz) btnCz.classList.toggle('is-active', tabName === 'crosszone');
  if (btnProd) btnProd.classList.toggle('is-active', tabName === 'products');
  if (paneCz) paneCz.style.display = tabName === 'crosszone' ? 'block' : 'none';
  if (paneProd) paneProd.style.display = tabName === 'products' ? 'block' : 'none';

  if (tabName === 'crosszone') {
    apprLoadCrossZoneSummary();
  }
}

function apprRefreshCurrentTab() {
  if (apprState.activeTab === 'crosszone') {
    apprLoadCrossZoneSummary();
  }
}

async function apprLoadCrossZoneSummary() {
  try {
    const res = await fetch('/api/supervisor/approvals/crosszone', {
      headers: { 'Authorization': `Bearer ${getSupToken()}` }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    apprState.crossZoneRequests = data.requests || [];

    // Update Tab Badges
    const badgeCz = document.getElementById('appr-badge-cz');
    const badgeProd = document.getElementById('appr-badge-prod');
    if (badgeCz) {
      badgeCz.textContent = data.pendingCount || 0;
      badgeCz.classList.toggle('is-urgent', (data.pendingCount || 0) > 0);
    }
    if (badgeProd) {
      badgeProd.textContent = 0;
    }

    apprRenderCrossZone();
  } catch (err) {
    console.error('[apprLoadCrossZoneSummary]', err);
    supNotify('เกิดข้อผิดพลาดในการโหลดข้อมูลรออนุมัติ', 'err');
  }
}

function apprGetElapsedText(requestedAt) {
  const reqTime = new Date(requestedAt).getTime();
  if (isNaN(reqTime)) return { text: '0 นาที', cls: 'is-normal', minutes: 0 };
  const diffSec = Math.max(0, Math.floor((Date.now() - reqTime) / 1000));
  const min = Math.floor(diffSec / 60);
  const sec = diffSec % 60;

  let text = '';
  if (min === 0) {
    text = `รอมาแล้ว ${sec} วินาที`;
  } else {
    text = `รอมาแล้ว ${min} นาที ${sec} วิ`;
  }

  let cls = 'is-normal';
  if (min >= 15) {
    cls = 'is-urgent';
  } else if (min >= 5) {
    cls = 'is-amber';
  }

  return { text, cls, minutes: min };
}

function apprUpdateTimers() {
  const badges = document.querySelectorAll('.appr-timer-badge[data-req-at]');
  badges.forEach(el => {
    const reqAt = el.getAttribute('data-req-at');
    const { text, cls } = apprGetElapsedText(reqAt);
    el.className = `appr-timer-badge ${cls}`;
    el.innerHTML = `<i class="fa-regular fa-clock"></i> <span>${text}</span>`;
  });
}

function apprRenderCrossZone() {
  const listEl = document.getElementById('appr-cz-list');
  const emptyEl = document.getElementById('appr-cz-empty');
  if (!listEl) return;

  const requests = apprState.crossZoneRequests || [];

  if (requests.length === 0) {
    listEl.innerHTML = '';
    if (emptyEl) emptyEl.style.display = 'flex';
    return;
  }

  if (emptyEl) emptyEl.style.display = 'none';

  listEl.innerHTML = requests.map(req => {
    const { text: timerText, cls: timerCls } = apprGetElapsedText(req.requestedAt);
    const driverAvatar = req.driverName ? req.driverName.slice(-3) : req.driverId;
    const reqWorkload = req.requesterWorkload || { assignedCount: 0, cardLimit: 30 };
    const priceDisplay = req.price ? `฿${parseFloat(req.price).toLocaleString('th-TH', { minimumFractionDigits: 2 })}` : '—';
    const isCod = req.cod || true;

    // Render Zone Owners status
    let ownersHTML = '';
    if (req.zoneOwners && req.zoneOwners.length > 0) {
      ownersHTML = req.zoneOwners.map(o => {
        const icon = o.statusCls === 'leave'
          ? '<i class="fa-solid fa-umbrella-beach"></i>'
          : o.statusCls === 'busy'
            ? '<i class="fa-solid fa-truck"></i>'
            : '<i class="fa-solid fa-bed"></i>';
        return `
          <span class="appr-owner-chip is-${o.statusCls}" title="คนขับประจำโซน: ${escHtml(o.name)} (${escHtml(o.code)})">
            ${icon} <strong>${escHtml(o.name)}:</strong> ${escHtml(o.statusText)}
          </span>
        `;
      }).join(' ');
    } else {
      ownersHTML = `<span class="appr-owner-chip is-inactive"><i class="fa-solid fa-circle-question"></i> ยังไม่มีคนขับประจำโซนนี้</span>`;
    }

    return `
      <div class="appr-card" id="appr-card-${escHtml(req.id)}">
        <div class="appr-card-header">
          <div class="appr-card-requester">
            <div class="appr-driver-avatar">${escHtml(driverAvatar)}</div>
            <div>
              <div class="appr-driver-name">${escHtml(req.driverName)} (${escHtml(req.driverId)})</div>
              <div class="appr-driver-meta">
                <span>โซนประจำตัว: <strong>${escHtml((req.driverZones || []).join(', '))}</strong></span>
                <span>•</span>
                <span>จองวันนี้: <strong>${reqWorkload.assignedCount} จุด</strong></span>
              </div>
            </div>
          </div>
          <div class="appr-timer-badge ${timerCls}" data-req-at="${escHtml(req.requestedAt)}">
            <i class="fa-regular fa-clock"></i>
            <span>${timerText}</span>
          </div>
        </div>

        <div class="appr-comparison-grid">
          <div class="appr-comp-col">
            <div class="appr-comp-label"><i class="fa-solid fa-store"></i> ข้อมูลจุดส่งที่ขอรับงาน</div>
            <div class="appr-comp-main">${escHtml(req.customer || 'ร้านค้า')}</div>
            <div class="appr-comp-sub" style="font-family:monospace;">${escHtml(req.orderNumber)}</div>
            <div class="appr-comp-sub" style="margin-top:2px;">
              ${ordZoneChipHTML(req.orderZone)}
              <span style="font-weight:700; color:var(--st-mine); margin-left:6px;">${priceDisplay} ${isCod ? '<span class="chip chip--mine" style="font-size:10px; padding:1px 4px;">COD</span>' : ''}</span>
            </div>
          </div>

          <div class="appr-comp-col">
            <div class="appr-comp-label"><i class="fa-solid fa-shield-halved"></i> สถานะคนขับเจ้าของโซนจริง (${escHtml(req.orderZone)})</div>
            <div style="display:flex; flex-wrap:wrap; gap:6px; margin-top:2px;">
              ${ownersHTML}
            </div>
          </div>
        </div>

        <div class="appr-reason-box">
          <div class="appr-reason-label"><i class="fa-solid fa-comment-dots"></i> เหตุผลจากคนขับ:</div>
          <div style="color:var(--ink); font-weight:500;">"${escHtml(req.reason || '—')}"</div>
        </div>

        <div class="appr-card-actions">
          <button type="button" class="appr-btn-reject" onclick="apprOpenRejectModal('${escHtml(req.id)}')">
            <i class="fa-solid fa-xmark"></i> ไม่อนุมัติ
          </button>
          <button type="button" class="appr-btn-approve" onclick="apprApproveCrossZone('${escHtml(req.id)}')">
            <i class="fa-solid fa-check"></i> อนุมัติทันที
          </button>
        </div>
      </div>
    `;
  }).join('');
}

async function apprApproveCrossZone(reqId) {
  const req = apprState.crossZoneRequests.find(r => r.id === reqId);
  if (!req) return;

  const card = document.getElementById(`appr-card-${reqId}`);
  if (card) card.style.opacity = '0.5';

  try {
    const res = await fetch('/api/supervisor/approvals/crosszone/approve', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${getSupToken()}`
      },
      body: JSON.stringify({ requestId: reqId })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'เกิดข้อผิดพลาด');

    supNotify(`✅ อนุมัติคำขอของ ${req.driverName} เรียบร้อยแล้ว (บันทึกลง _ASSIGN และแจ้งคนขับ)`, 'ok');
    await apprLoadCrossZoneSummary();
  } catch (err) {
    if (card) card.style.opacity = '1';
    console.error('[apprApproveCrossZone]', err);
    supNotify(`❌ ${err.message}`, 'err');
  }
}

function apprOpenRejectModal(reqId) {
  const req = apprState.crossZoneRequests.find(r => r.id === reqId);
  if (!req) return;

  apprState.rejectPendingId = reqId;
  const modal = document.getElementById('appr-reject-modal');
  const orderIdEl = document.getElementById('appr-rej-order-id');
  const driverNameEl = document.getElementById('appr-rej-driver-name');
  const sel = document.getElementById('appr-rej-reason-select');
  const custom = document.getElementById('appr-rej-custom-input');

  if (orderIdEl) orderIdEl.textContent = req.orderNumber || req.orderId;
  if (driverNameEl) driverNameEl.textContent = `${req.driverName} (${req.driverId})`;
  if (sel) sel.value = 'คนขับประจำโซนพร้อมรับงานแล้ว';
  if (custom) custom.value = '';

  if (modal) modal.style.display = 'flex';
}

function apprCloseRejectModal() {
  const modal = document.getElementById('appr-reject-modal');
  if (modal) modal.style.display = 'none';
  apprState.rejectPendingId = null;
}

function apprOnSelectRejReason(val) {
  const custom = document.getElementById('appr-rej-custom-input');
  if (custom && val === 'อื่นๆ') {
    custom.focus();
  }
}

async function apprConfirmReject() {
  const reqId = apprState.rejectPendingId;
  if (!reqId) return;

  const sel = document.getElementById('appr-rej-reason-select');
  const custom = document.getElementById('appr-rej-custom-input');
  let reason = sel ? sel.value : '';
  if (custom && custom.value.trim()) {
    reason = reason === 'อื่นๆ' ? custom.value.trim() : `${reason} (${custom.value.trim()})`;
  }

  if (!reason.trim()) {
    supNotify('กรุณาระบุเหตุผลการไม่อนุมัติ', 'err');
    return;
  }

  try {
    const res = await fetch('/api/supervisor/approvals/crosszone/reject', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${getSupToken()}`
      },
      body: JSON.stringify({
        requestId: reqId,
        reason
      })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'เกิดข้อผิดพลาด');

    apprCloseRejectModal();
    supNotify('ไม่อนุมัติคำขอเรียบร้อยแล้ว (แจ้งผลกลับคนขับ)', 'ok');
    await apprLoadCrossZoneSummary();
  } catch (err) {
    console.error('[apprConfirmReject]', err);
    supNotify(`❌ ${err.message}`, 'err');
  }
}

/* ===================================================
   S5: ของกลับเข้าคลัง (Warehouse Returns Intake Logic)
   =================================================== */

const retState = {
  data: [],
  stats: { pendingCount: 0, overdueCount: 0, receivedTodayCount: 0 },
  filterStatus: 'all',
  filterDriver: 'all',
  filterCondition: 'all',
  searchQuery: '',
  selectedOrderNo: null
};

function retInit() {
  retPopulateDrivers();
  retLoadReturns();
}

function retPopulateDrivers() {
  const select = document.getElementById('ret-driver-select');
  if (!select) return;

  const drivers = Array.isArray(supState.drivers) ? supState.drivers : [];
  const currentVal = select.value || 'all';

  select.innerHTML = `<option value="all">คนขับทั้งหมด</option>` +
    drivers.map(d => `<option value="${escHtml(d.id || d.code)}">${escHtml(d.name)} (${escHtml(d.code || d.id)})</option>`).join('');

  select.value = currentVal;
}

async function retLoadReturns() {
  try {
    const res = await fetch('/api/supervisor/returns', {
      headers: { 'Authorization': `Bearer ${getSupToken()}` }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    retState.data = data.returns || [];
    retState.stats = data.stats || { pendingCount: 0, overdueCount: 0, receivedTodayCount: 0 };

    retRenderStats();
    retApplyFilters();
  } catch (err) {
    console.error('[retLoadReturns]', err);
    supNotify('เกิดข้อผิดพลาดในการโหลดรายการของกลับเข้าคลัง', 'err');
  }
}

function retRenderStats() {
  const pendingEl = document.getElementById('ret-stat-pending');
  const overdueEl = document.getElementById('ret-stat-overdue');
  const receivedEl = document.getElementById('ret-stat-received');
  const subOverdueEl = document.getElementById('ret-sub-overdue');
  const cardOverdueEl = document.getElementById('ret-card-overdue');

  const { pendingCount, overdueCount, receivedTodayCount } = retState.stats;

  if (pendingEl) pendingEl.textContent = `${pendingCount} จุด`;
  if (overdueEl) overdueEl.textContent = `${overdueCount} จุด`;
  if (receivedEl) receivedEl.textContent = `${receivedTodayCount} จุด`;

  if (subOverdueEl) {
    subOverdueEl.textContent = overdueCount > 0 ? `🚨 ต้องรีบตรวจรับทันที` : 'ไม่มีของค้างข้ามวัน';
  }
  if (cardOverdueEl) {
    cardOverdueEl.style.borderColor = overdueCount > 0 ? '#fca5a5' : 'var(--line)';
    cardOverdueEl.style.background = overdueCount > 0 ? '#fff1f2' : 'var(--surface)';
  }
}

function retSetStatusFilter(status) {
  retState.filterStatus = status;
  document.querySelectorAll('#sup-page-s5 .ret-chip[data-status]').forEach(btn => {
    btn.classList.toggle('is-active', btn.getAttribute('data-status') === status);
  });
  retApplyFilters();
}

function retSetDriverFilter(driverId) {
  retState.filterDriver = driverId;
  retApplyFilters();
}

function retSetConditionFilter(condition) {
  retState.filterCondition = condition;
  retApplyFilters();
}

function retApplyFilters() {
  const searchInput = document.getElementById('ret-search-input');
  retState.searchQuery = (searchInput ? searchInput.value : '').trim().toLowerCase();

  let list = [...retState.data];

  // 1. Filter Status
  if (retState.filterStatus !== 'all') {
    list = list.filter(r => r.status === retState.filterStatus);
  }

  // 2. Filter Driver
  if (retState.filterDriver !== 'all') {
    list = list.filter(r => r.driver_id === retState.filterDriver || r.driver_code === retState.filterDriver);
  }

  // 3. Filter Condition
  if (retState.filterCondition !== 'all') {
    list = list.filter(r => r.condition === retState.filterCondition);
  }

  // 4. Search Query
  if (retState.searchQuery) {
    const q = retState.searchQuery;
    list = list.filter(r => {
      return (r.order_no || '').toLowerCase().includes(q) ||
        (r.customer_name || '').toLowerCase().includes(q) ||
        (r.driver_name || '').toLowerCase().includes(q) ||
        (r.fail_reason || '').toLowerCase().includes(q);
    });
  }

  retRender(list);
}

function retRender(list) {
  const tbody = document.getElementById('ret-table-tbody');
  const mobList = document.getElementById('ret-mobile-list');
  const emptyEl = document.getElementById('ret-empty-state');

  if (!tbody || !mobList) return;

  if (list.length === 0) {
    tbody.innerHTML = '';
    mobList.innerHTML = '';
    if (emptyEl) emptyEl.style.display = 'block';
    return;
  }

  if (emptyEl) emptyEl.style.display = 'none';

  // Desktop Table Rows
  tbody.innerHTML = list.map(item => {
    const isOverdue = item.is_overdue;
    const isPending = item.status === 'รอรับคืน';
    const overdueText = item.days_overdue > 0 ? `${item.days_overdue} วัน` : 'วันนี้';
    const failDateFormatted = item.fail_at ? new Date(item.fail_at).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' }) : '—';
    const itemCount = item.item_count || 1;

    let actionHTML = '';
    if (isPending) {
      actionHTML = `
        <button type="button" class="ret-btn-intake" onclick="event.stopPropagation(); retOpenIntakeModal('${escHtml(item.order_no)}')">
          <i class="fa-solid fa-boxes-packing"></i> รับของคืนแล้ว
        </button>
      `;
    } else {
      const condCls = item.condition === 'เสียหาย' ? 'is-damaged' : item.condition === 'ไม่ครบ' ? 'is-shortage' : 'is-normal';
      actionHTML = `
        <div style="display:flex; flex-direction:column; align-items:flex-end; gap:2px;">
          <span class="ret-condition-chip ${condCls}">
            <i class="fa-solid fa-check"></i> ${escHtml(item.condition || 'ปกติ')}
          </span>
          <span style="font-size:11px; color:var(--ink-3);">รับโดย ${escHtml(item.received_by || 'คลัง')}</span>
        </div>
      `;
    }

    return `
      <tr class="${isOverdue ? 'is-overdue-return' : ''}" onclick="retOpenDetailModal('${escHtml(item.order_no)}')">
        <td>
          <div style="font-weight:700; color:var(--ink);">${escHtml(item.customer_name || 'ร้านค้า')}</div>
          <div style="font-size:11px; color:var(--ink-3);">${failDateFormatted}</div>
        </td>
        <td style="font-family:monospace; font-weight:600;">${escHtml(item.order_no)}</td>
        <td>
          <span style="font-weight:600;">${escHtml(item.driver_name)}</span>
          <span style="font-size:11px; color:var(--ink-3);">(${escHtml(item.driver_code)})</span>
        </td>
        <td><strong>${itemCount}</strong> รายการ</td>
        <td>
          <span class="chip chip--failed" style="font-size:11px; padding:2px 6px;">
            <i class="fa-solid fa-circle-exclamation"></i> ${escHtml(item.fail_reason || 'ส่งไม่สำเร็จ')}
          </span>
        </td>
        <td>
          ${isOverdue ? `<span class="ret-overdue-chip"><i class="fa-solid fa-triangle-exclamation"></i> ค้าง ${overdueText}</span>` : `<span style="color:var(--ink-2);">${overdueText}</span>`}
        </td>
        <td>
          <span class="ret-status-badge ${isPending ? 'is-pending' : 'is-received'}">
            ${isPending ? '<i class="fa-solid fa-clock"></i> รอรับคืน' : '<i class="fa-solid fa-check-double"></i> รับคืนแล้ว'}
          </span>
        </td>
        <td style="text-align:right;">
          ${actionHTML}
        </td>
      </tr>
    `;
  }).join('');

  // Mobile Cards
  mobList.innerHTML = list.map(item => {
    const isOverdue = item.is_overdue;
    const isPending = item.status === 'รอรับคืน';
    const overdueText = item.days_overdue > 0 ? `${item.days_overdue} วัน` : 'วันนี้';
    const failDateFormatted = item.fail_at ? new Date(item.fail_at).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' }) : '—';

    return `
      <div class="ret-mobile-card ${isOverdue ? 'is-overdue-return' : ''}" onclick="retOpenDetailModal('${escHtml(item.order_no)}')">
        <div style="display:flex; justify-content:space-between; align-items:flex-start;">
          <div>
            <div style="font-weight:700; font-size:14px; color:var(--ink);">${escHtml(item.customer_name || 'ร้านค้า')}</div>
            <div style="font-size:11px; font-family:monospace; color:var(--ink-2);">${escHtml(item.order_no)}</div>
          </div>
          <span class="ret-status-badge ${isPending ? 'is-pending' : 'is-received'}">
            ${isPending ? 'รอรับคืน' : 'รับคืนแล้ว'}
          </span>
        </div>

        <div style="display:flex; justify-content:space-between; align-items:center; font-size:12px; color:var(--ink-2); background:var(--page); padding:8px 10px; border-radius:6px;">
          <div>คนขับ: <strong>${escHtml(item.driver_name)}</strong></div>
          <div>${isOverdue ? `<span class="ret-overdue-chip">ค้าง ${overdueText}</span>` : `ค้าง: ${overdueText}`}</div>
        </div>

        <div style="font-size:12px; color:var(--st-failed); font-weight:600;">
          <i class="fa-solid fa-circle-exclamation"></i> เหตุผล: ${escHtml(item.fail_reason || 'ส่งไม่สำเร็จ')}
        </div>

        <div style="display:flex; justify-content:flex-end; padding-top:4px;">
          ${isPending ? `
            <button type="button" class="ret-btn-intake" style="width:100%; justify-content:center; padding:9px 0;" onclick="event.stopPropagation(); retOpenIntakeModal('${escHtml(item.order_no)}')">
              <i class="fa-solid fa-boxes-packing"></i> รับของคืนแล้ว
            </button>
          ` : `
            <div style="font-size:12px; color:var(--st-available); font-weight:700;">
              <i class="fa-solid fa-check"></i> รับคืนแล้ว (${escHtml(item.condition || 'ปกติ')})
            </div>
          `}
        </div>
      </div>
    `;
  }).join('');
}

function retOpenIntakeModal(orderNo) {
  const item = retState.data.find(r => r.order_no === orderNo);
  if (!item) return;

  retState.selectedOrderNo = orderNo;
  const modal = document.getElementById('ret-intake-modal');
  const orderNoEl = document.getElementById('ret-modal-order-no');
  const customerEl = document.getElementById('ret-modal-customer');
  const driverEl = document.getElementById('ret-modal-driver');
  const reasonEl = document.getElementById('ret-modal-reason');

  if (orderNoEl) orderNoEl.textContent = item.order_no;
  if (customerEl) customerEl.textContent = item.customer_name || '—';
  if (driverEl) driverEl.textContent = `${item.driver_name} (${item.driver_code})`;
  if (reasonEl) reasonEl.textContent = item.fail_reason || 'ส่งไม่สำเร็จ';

  // Reset inputs
  const normalRadio = document.querySelector('input[name="ret-condition"][value="ปกติ"]');
  if (normalRadio) normalRadio.checked = true;
  retOnConditionChange('ปกติ');

  const shortageCountInput = document.getElementById('ret-shortage-count');
  const shortageNoteInput = document.getElementById('ret-shortage-note');
  if (shortageCountInput) shortageCountInput.value = '';
  if (shortageNoteInput) shortageNoteInput.value = '';

  retValidateIntakeForm();

  if (modal) modal.style.display = 'flex';
}

function retCloseIntakeModal() {
  const modal = document.getElementById('ret-intake-modal');
  if (modal) modal.style.display = 'none';
  retState.selectedOrderNo = null;
}

function retOnConditionChange(val) {
  const fields = document.getElementById('ret-shortage-fields');
  if (fields) {
    fields.style.display = (val === 'เสียหาย' || val === 'ไม่ครบ') ? 'flex' : 'none';
  }
  retValidateIntakeForm();
}

function retValidateIntakeForm() {
  const selectedCond = document.querySelector('input[name="ret-condition"]:checked')?.value || 'ปกติ';
  const confirmBtn = document.getElementById('ret-btn-confirm-intake');
  if (!confirmBtn) return;

  if (selectedCond === 'ปกติ') {
    confirmBtn.disabled = false;
    confirmBtn.style.opacity = '1';
    confirmBtn.style.cursor = 'pointer';
  } else {
    const count = (document.getElementById('ret-shortage-count')?.value || '').trim();
    const note = (document.getElementById('ret-shortage-note')?.value || '').trim();
    const isValid = count.length > 0 && note.length > 0;
    confirmBtn.disabled = !isValid;
    confirmBtn.style.opacity = isValid ? '1' : '0.5';
    confirmBtn.style.cursor = isValid ? 'pointer' : 'not-allowed';
  }
}

async function retConfirmIntake() {
  const orderNo = retState.selectedOrderNo;
  if (!orderNo) return;

  const selectedCond = document.querySelector('input[name="ret-condition"]:checked')?.value || 'ปกติ';
  const shortageCount = document.getElementById('ret-shortage-count')?.value || '';
  const shortageNote = document.getElementById('ret-shortage-note')?.value || '';

  if (selectedCond !== 'ปกติ' && (!shortageCount || !shortageNote.trim())) {
    supNotify('กรณีสินค้าเสียหายหรือไม่ครบ บังคับกรอกจำนวนและหมายเหตุ', 'err');
    return;
  }

  const confirmBtn = document.getElementById('ret-btn-confirm-intake');
  if (confirmBtn) confirmBtn.disabled = true;

  try {
    const res = await fetch('/api/supervisor/returns/receive', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${getSupToken()}`
      },
      body: JSON.stringify({
        orderNo,
        condition: selectedCond,
        shortageCount,
        shortageNote
      })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'เกิดข้อผิดพลาดในการบันทึก');

    retCloseIntakeModal();
    supNotify(`✅ ตรวจรับของคืนออเดอร์ ${orderNo} สภาพ: ${selectedCond} เรียบร้อยแล้ว`, 'ok');
    await retLoadReturns();
  } catch (err) {
    console.error('[retConfirmIntake]', err);
    supNotify(`❌ ${err.message}`, 'err');
    if (confirmBtn) confirmBtn.disabled = false;
  }
}

function retOpenDetailModal(orderNo) {
  const item = retState.data.find(r => r.order_no === orderNo);
  if (!item) return;

  const modal = document.getElementById('ret-detail-modal');
  const body = document.getElementById('ret-detail-modal-body');
  if (!modal || !body) return;

  const failDateFormatted = item.fail_at ? new Date(item.fail_at).toLocaleString('th-TH', { dateStyle: 'full', timeStyle: 'medium' }) : '—';
  const receivedDateFormatted = item.received_at ? new Date(item.received_at).toLocaleString('th-TH', { dateStyle: 'full', timeStyle: 'medium' }) : '—';
  const isOverdue = item.is_overdue;

  let photoHTML = '';
  if (item.photo_url) {
    photoHTML = `
      <div style="margin-top:14px;">
        <label style="font-size:12px; font-weight:700; color:var(--ink); display:block; margin-bottom:6px;">
          <i class="fa-solid fa-camera"></i> รูปถ่ายหลักฐานจากคนขับ:
        </label>
        <div style="border-radius:8px; overflow:hidden; border:1px solid var(--line); max-height:220px; display:flex; align-items:center; justify-content:center; background:#000;">
          <img src="${escHtml(item.photo_url)}" alt="หลักฐานจัดส่งไม่สำเร็จ" style="max-width:100%; max-height:220px; object-fit:contain;">
        </div>
      </div>
    `;
  } else {
    photoHTML = `
      <div style="margin-top:10px; padding:12px; background:var(--page); border-radius:6px; font-size:12px; color:var(--ink-3); text-align:center;">
        <i class="fa-solid fa-camera-slash"></i> ไม่มีรูปถ่ายหลักฐานแนบมา
      </div>
    `;
  }

  body.innerHTML = `
    <div class="cod-close-summary">
      <div class="cod-close-row">
        <span class="cod-close-label">เลขออเดอร์:</span>
        <span class="cod-close-val" style="font-family:monospace; font-weight:700;">${escHtml(item.order_no)}</span>
      </div>
      <div class="cod-close-row">
        <span class="cod-close-label">ชื่อร้านค้า / ลูกค้า:</span>
        <span class="cod-close-val" style="font-weight:700;">${escHtml(item.customer_name || '—')}</span>
      </div>
      <div class="cod-close-row">
        <span class="cod-close-label">คนขับผู้นำส่ง:</span>
        <span class="cod-close-val">${escHtml(item.driver_name)} (${escHtml(item.driver_code)})</span>
      </div>
      <div class="cod-close-row">
        <span class="cod-close-label">เวลาที่ส่งไม่สำเร็จ:</span>
        <span class="cod-close-val">${failDateFormatted}</span>
      </div>
      <div class="cod-close-row">
        <span class="cod-close-label">เหตุผลที่ส่งไม่สำเร็จ:</span>
        <span class="cod-close-val" style="color:var(--st-failed); font-weight:700;">${escHtml(item.fail_reason || '—')}</span>
      </div>
      <div class="cod-close-row">
        <span class="cod-close-label">สถานะการรับคืน:</span>
        <span class="cod-close-val">
          <span class="ret-status-badge ${item.status === 'รอรับคืน' ? 'is-pending' : 'is-received'}">${escHtml(item.status)}</span>
          ${isOverdue ? '<span class="ret-overdue-chip" style="margin-left:4px;">ค้างเกิน 1 วัน</span>' : ''}
        </span>
      </div>
      ${item.status === 'รับคืนแล้ว' ? `
        <div class="cod-close-row">
          <span class="cod-close-label">สภาพสินค้า:</span>
          <span class="cod-close-val"><strong>${escHtml(item.condition || 'ปกติ')}</strong> ${escHtml(item.shortage_note || '')}</span>
        </div>
        <div class="cod-close-row">
          <span class="cod-close-label">ผู้รับคืน & เวลา:</span>
          <span class="cod-close-val">${escHtml(item.received_by)} (${receivedDateFormatted})</span>
        </div>
      ` : ''}
    </div>

    ${photoHTML}
  `;

  modal.style.display = 'flex';
}

function retCloseDetailModal() {
  const modal = document.getElementById('ret-detail-modal');
  if (modal) modal.style.display = 'none';
}

// ==========================================
// Sync Orders from API Import Tab
// ==========================================
async function syncApiImport() {
  const btnDesktop = document.getElementById('btn-sync-api-import');
  const origDesktopHtml = btnDesktop ? btnDesktop.innerHTML : '';
  if (btnDesktop) {
    btnDesktop.disabled = true;
    btnDesktop.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> กำลังซิงก์...`;
  }

  const token = (typeof supState !== 'undefined' && supState.token) || localStorage.getItem('uflow_sup_token') || localStorage.getItem('token');

  try {
    const res = await fetch('/api/sync/api-import', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      }
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to sync API Import');

    if (data.importedCount > 0) {
      supNotify(`✅ นำเข้าออเดอร์ใหม่สำเร็จ ${data.importedCount} รายการจาก API Import`, 'success');
      if (typeof supLoadAll === 'function') await supLoadAll();
      if (typeof ordLoadOrders === 'function') await ordLoadOrders();
      if (typeof dspLoadSummary === 'function') await dspLoadSummary();
    } else {
      supNotify('ℹ️ ไม่มีออเดอร์ใหม่ ข้อมูลเป็นปัจจุบันแล้ว', 'default');
    }
  } catch (err) {
    console.error('[syncApiImport]', err);
    supNotify(`❌ เกิดข้อผิดพลาดในการซิงก์: ${err.message}`, 'failed');
  } finally {
    if (btnDesktop) {
      btnDesktop.disabled = false;
      btnDesktop.innerHTML = origDesktopHtml;
    }
  }
}

// Auto-sync in background every 5 minutes while supervisor portal is open
setInterval(() => {
  const token = (typeof supState !== 'undefined' && supState.token) || localStorage.getItem('uflow_sup_token') || localStorage.getItem('token');
  if (token) {
    syncApiImport().catch(() => {});
  }
}, 5 * 60 * 1000);
