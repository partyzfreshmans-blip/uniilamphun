/* =========================================================
   Unii Mart 584 — Driver Route App
   Application State & Dynamic Interaction Logic
   ========================================================= */

// --- Initial Mock Orders (Bangkok Sathorn/Bang Rak Zone) ---
const INITIAL_ORDERS = [
  {
    id: "ORD-584-101",
    customer: "คุณนิภา สุวรรณเวช",
    phone: "081-425-9988",
    address: "อาคารสาทรธานี 1 ชั้น 14 ถ.สาทรเหนือ เขตบางรัก",
    zone: "Zone A - สาทร",
    lat: 13.7226,
    lng: 100.5298,
    items: "ข้าวหอมมะลิ 5กก. x 1, น้ำดื่ม 1.5L x 2 แพ็ค, นมสด x 4",
    price: 680,
    cod: true,
    timeWindow: "10:00 - 11:30 น.",
    status: "mine", // จองแล้ว
    distance: 1.2,
    isUrgent: false
  },
  {
    id: "ORD-584-102",
    customer: "คุณวีระพล จิตต์เจริญ",
    phone: "089-112-3344",
    address: "คอนโด Ashton Silom ชั้น 22 ถ.สีลม เขตบางรัก",
    zone: "Zone A - สีลม",
    lat: 13.7258,
    lng: 100.5254,
    items: "ชุดผลไม้พรีเมียม x 1, น้ำผลไม้สกัดเย็น x 6",
    price: 1250,
    cod: true,
    timeWindow: "10:30 - 12:00 น.",
    status: "available", // ในโซนฉัน
    distance: 0.8,
    isUrgent: true
  },
  {
    id: "ORD-584-103",
    customer: "คุณกิตติศักดิ์ พานิชย์",
    phone: "086-778-9900",
    address: "ซอยคอนแวนต์ 2 ถ.สีลม เขตบางรัก",
    zone: "Zone A - คอนแวนต์",
    lat: 13.7275,
    lng: 100.5342,
    items: "ขนมปังโฮลวีต x 2, ไข่ไก่สด 30 ฟอง x 1, เนยสด x 2",
    price: 430,
    cod: false,
    timeWindow: "11:00 - 12:30 น.",
    status: "available", // ในโซนฉัน
    distance: 1.5,
    isUrgent: false
  },
  {
    id: "ORD-584-104",
    customer: "คุณอารียา สมบูรณ์",
    phone: "083-456-7890",
    address: "อาคารเอ็มไพร์ทาวเวอร์ ชั้น 28 ถ.สาทรใต้ เขตยานนาวา",
    zone: "Zone A - ช่องนนทรี",
    lat: 13.7208,
    lng: 100.5305,
    items: "กาแฟแคปซูล x 3 กล่อง, นมโอ๊ต x 4 กล่อง",
    price: 920,
    cod: true,
    timeWindow: "09:00 - 10:00 น.",
    status: "done", // ส่งสำเร็จ
    distance: 1.9,
    isUrgent: false,
    deliveredAt: "09:42 น.",
    recipient: "นิติคอนโดชั้น G"
  },
  {
    id: "ORD-584-105",
    customer: "คุณธนกร เลิศวิทยา",
    phone: "092-887-6655",
    address: "ซอยสุรวงศ์ 3 ถ.สุรวงศ์ เขตบางรัก",
    zone: "Zone A - สุรวงศ์",
    lat: 13.7299,
    lng: 100.5271,
    items: "อาหารพร้อมทาน x 4, เครื่องดื่มอัดลม x 1 แพ็ค",
    price: 390,
    cod: true,
    timeWindow: "10:00 - 11:00 น.",
    status: "failed", // ส่งไม่สำเร็จ
    distance: 1.4,
    isUrgent: false,
    failReason: "ติดต่อผู้รับไม่ได้ (โทรไม่ติด 3 ครั้ง)"
  },
  {
    id: "ORD-584-106",
    customer: "คุณพิมลพรรณ วงศ์สวัสดิ์",
    phone: "085-332-1144",
    address: "ซอยนราธิวาสราชนครินทร์ 6 เขตสาทร",
    zone: "Zone A - นราธิวาส",
    lat: 13.7185,
    lng: 100.5348,
    items: "ชุดของขวัญ Unii Premium x 1",
    price: 2150,
    cod: false,
    timeWindow: "11:30 - 13:00 น.",
    status: "attention", // ต้องเคลียร์/คำเตือน
    distance: 2.3,
    isUrgent: true,
    alertMessage: "สินค้าแช่เย็น — ต้องจัดส่งภายใน 30 นาที!"
  },
  {
    id: "ORD-584-107",
    customer: "คุณศิริพรรณ สุขเกษม",
    phone: "088-990-1122",
    address: "สุขุมวิท 24 แขวงคลองตอง เขตคลองเตย",
    zone: "Zone B - สุขุมวิท (นอกโซน)",
    lat: 13.7291,
    lng: 100.5684,
    items: "น้ำดื่ม 600ml x 5 แพ็ค",
    price: 350,
    cod: true,
    timeWindow: "13:00 - 14:30 น.",
    status: "out", // นอกโซน
    distance: 5.4,
    isUrgent: false
  }
];

// Hub Warehouse Location
const WAREHOUSE_HUB = {
  name: "Unii Mart Hub 584 (สีลม)",
  lat: 13.7265,
  lng: 100.5285
};

// Application State Variable Container
let state = {
  orders: [...INITIAL_ORDERS],
  activeFilter: "all",
  searchQuery: "",
  selectedOrderId: null,
  isOptimized: false,
  activeRoutePolyline: null,
  driverMarker: null,
  simulating: false,
  signaturePad: null,
  signatureContext: null,
  isDrawing: false,
  podPhotoData: null
};

// Global Leaflet Map Handle
let map;
let mapMarkers = {};
let zonePolygon;

// --- Initialize App ---
document.addEventListener("DOMContentLoaded", () => {
  initMap();
  initSignaturePad();
  initEventListeners();
  renderOrders();
  updateStats();
  updatePrintDate();
});

// --- Initialize Interactive Map ---
function initMap() {
  // Center map on Sathorn/Bang Rak Bangkok hub
  map = L.map("map", {
    zoomControl: false
  }).setView([13.7245, 100.5290], 15);

  // OpenStreetMap Tile Layer with clean grey canvas style
  L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", {
    maxZoom: 19,
    attribution: '&copy; Unii Mart 584 Route Map'
  }).addTo(map);

  // Add Zoom Control to Top Right
  L.control.zoom({ position: "topright" }).addTo(map);

  // Render Zone A Boundary Polygon
  const zoneACoords = [
    [13.7320, 100.5210],
    [13.7340, 100.5350],
    [13.7150, 100.5400],
    [13.7140, 100.5230]
  ];
  
  zonePolygon = L.polygon(zoneACoords, {
    color: "var(--st-available)",
    weight: 1.5,
    fillColor: "var(--st-available)",
    fillOpacity: 0.10,
    dashArray: "4, 4"
  }).addTo(map);

  // Add Warehouse Hub Marker
  const warehouseIcon = L.divIcon({
    className: "leaflet-div-icon",
    html: `<div class="pin pin--warehouse" title="${WAREHOUSE_HUB.name}"><i class="fa-solid fa-store"></i></div>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12]
  });

  L.marker([WAREHOUSE_HUB.lat, WAREHOUSE_HUB.lng], { icon: warehouseIcon })
    .addTo(map)
    .bindPopup(`<b>${WAREHOUSE_HUB.name}</b><br>จุดเริ่มต้นกระจายสินค้าหลัก`);

  // Render Pins for all orders
  renderMapMarkers();
}

// --- Render Map Pins matching Design Tokens ---
function renderMapMarkers() {
  // Clear existing markers
  Object.values(mapMarkers).forEach(marker => map.removeLayer(marker));
  mapMarkers = {};

  state.orders.forEach(order => {
    // Determine status CSS modifier
    let statusClass = `is-${order.status}`;
    let pinHtml = `<div class="pin ${statusClass} ${state.selectedOrderId === order.id ? 'pin--active' : ''}" data-id="${order.id}"></div>`;

    const customIcon = L.divIcon({
      className: "leaflet-div-icon",
      html: pinHtml,
      iconSize: [16, 16],
      iconAnchor: [8, 8]
    });

    const marker = L.marker([order.lat, order.lng], { icon: customIcon }).addTo(map);

    marker.on("click", () => {
      selectOrder(order.id);
      highlightMapMarker(order.id);
    });

    mapMarkers[order.id] = marker;
  });
}

// --- Render Order Cards List ---
function renderOrders() {
  const container = document.getElementById("orders-container");
  container.innerHTML = "";

  // Filter orders based on active filter & search query
  const filtered = state.orders.filter(order => {
    const matchesFilter = state.activeFilter === "all" ? true : order.status === state.activeFilter;
    const q = state.searchQuery.toLowerCase();
    const matchesSearch = !q || 
      order.id.toLowerCase().includes(q) ||
      order.customer.toLowerCase().includes(q) ||
      order.address.toLowerCase().includes(q);

    return matchesFilter && matchesSearch;
  });

  // Update Status Tab Counter Chips
  updateTabCounts();

  if (filtered.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 32px 16px; color: var(--ink-3);">
        <i class="fa-solid fa-box-open" style="font-size: 32px; margin-bottom: 8px;"></i>
        <div>ไม่พบรายการออเดอร์ในหมวดหมู่นี้</div>
      </div>
    `;
    return;
  }

  filtered.forEach(order => {
    const isSelected = order.id === state.selectedOrderId;
    const cardHtml = document.createElement("div");
    cardHtml.className = `card card--status is-${order.status} ${isSelected ? 'is-active' : ''}`;
    cardHtml.dataset.id = order.id;

    // Status label mapping
    let statusBadge = "";
    if (order.status === "available") statusBadge = `<span class="chip chip--available">ว่าง (ในโซน)</span>`;
    else if (order.status === "mine") statusBadge = `<span class="chip chip--mine"><i class="fa-solid fa-truck"></i> ฉันจองแล้ว</span>`;
    else if (order.status === "done") statusBadge = `<span class="chip chip--done"><i class="fa-solid fa-circle-check"></i> ส่งสำเร็จ</span>`;
    else if (order.status === "failed") statusBadge = `<span class="chip chip--failed"><i class="fa-solid fa-triangle-exclamation"></i> ส่งไม่สำเร็จ</span>`;
    else if (order.status === "attention") statusBadge = `<span class="chip chip--attention"><i class="fa-solid fa-bell"></i> ต้องเคลียร์</span>`;
    else if (order.status === "out") statusBadge = `<span class="chip">นอกโซน</span>`;

    // Action button based on status
    let actionBtn = "";
    if (order.status === "available") {
      actionBtn = `<button class="btn btn--primary btn--sm btn-accept" onclick="acceptOrder('${order.id}', event)">จองงานนี้</button>`;
    } else if (order.status === "mine" || order.status === "attention") {
      actionBtn = `
        <div style="display: flex; gap: 6px;">
          <button class="btn btn--danger btn--sm" onclick="openFailModal('${order.id}', event)">ส่งไม่ได้</button>
          <button class="btn btn--confirm btn--sm" onclick="openPodModal('${order.id}', event)">ส่งสำเร็จ</button>
        </div>
      `;
    } else if (order.status === "done") {
      actionBtn = `<span style="font-size: 11px; color: var(--st-done); font-weight: 500;"><i class="fa-solid fa-check"></i> เรียบร้อย ${order.deliveredAt || ''}</span>`;
    } else if (order.status === "failed") {
      actionBtn = `<span style="font-size: 11px; color: var(--st-failed);">${order.failReason || 'ไม่สำเร็จ'}</span>`;
    } else if (order.status === "out") {
      actionBtn = `<button class="btn btn--secondary btn--sm" disabled style="opacity: 0.5;">รับไม่ได้</button>`;
    }

    cardHtml.innerHTML = `
      <div class="order-card-header">
        <div>
          <span class="code" style="font-weight: 600; font-size: 14px;">${order.id}</span>
          ${order.isUrgent ? '<span class="chip chip--attention" style="margin-left: 6px;">ด่วน!</span>' : ''}
        </div>
        ${statusBadge}
      </div>

      <div class="order-title">${order.customer}</div>
      <div class="order-address"><i class="fa-solid fa-location-dot" style="color: var(--ink-3);"></i> ${order.address}</div>
      
      ${order.alertMessage ? `<div style="background: var(--st-attention-bg); color: var(--st-attention); border: 1px solid var(--st-attention-line); padding: 4px 8px; border-radius: 6px; font-size: 11px; font-weight: 500;"><i class="fa-solid fa-triangle-exclamation"></i> ${order.alertMessage}</div>` : ''}

      <div style="font-size: 12px; color: var(--ink-2); background: var(--page); padding: 6px 8px; border-radius: 6px; margin-top: 4px;">
        <i class="fa-solid fa-box" style="color: var(--ink-3);"></i> ${order.items}
      </div>

      <div class="order-footer">
        <div>
          <span class="num" style="font-weight: 700; font-size: 15px; color: var(--ink);">${order.cod ? 'COD ฿' + order.price : 'จ่ายแล้ว'}</span>
          <span class="num" style="font-size: 12px; color: var(--ink-3); margin-left: 6px;">${order.distance} km</span>
        </div>
        ${actionBtn}
      </div>
    `;

    cardHtml.addEventListener("click", (e) => {
      // Don't trigger card click if clicking nested buttons
      if (e.target.closest("button")) return;
      selectOrder(order.id);
    });

    container.appendChild(cardHtml);
  });

  // Render Desktop Right Sidebar Route Sequence
  renderRouteSequence();
}

// --- Render Route Sequence in Right Panel ---
function renderRouteSequence() {
  const container = document.getElementById("route-sequence-list");
  if (!container) return;
  container.innerHTML = "";

  const activeOrders = state.orders.filter(o => o.status === "mine" || o.status === "attention");

  if (activeOrders.length === 0) {
    container.innerHTML = `
      <div style="font-size: 12px; color: var(--ink-3); text-align: center; padding: 20px 0;">
        ยังไม่มีงานที่รับไว้ในระบบ<br>กด "จองงานนี้" จากรายการซ้ายมือ
      </div>
    `;
    return;
  }

  activeOrders.forEach((order, idx) => {
    const item = document.createElement("div");
    item.className = "card card--status is-mine";
    item.style.padding = "8px 10px 8px 14px";
    item.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center;">
        <div style="display: flex; align-items: center; gap: 8px;">
          <span style="width: 20px; height: 20px; border-radius: 50%; background: var(--st-mine); color: #fff; display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 600;" class="num">${idx + 1}</span>
          <div>
            <div class="code" style="font-weight: 600; font-size: 12px;">${order.id}</div>
            <div style="font-size: 12px; color: var(--ink); font-weight: 500;">${order.customer}</div>
          </div>
        </div>
        <div style="text-align: right;">
          <div class="num" style="font-size: 12px; font-weight: 600;">${order.distance} km</div>
          <div class="num" style="font-size: 10px; color: var(--ink-3);">${order.timeWindow}</div>
        </div>
      </div>
    `;
    container.appendChild(item);
  });
}

// --- Select Order Event ---
function selectOrder(orderId) {
  state.selectedOrderId = orderId;
  const order = state.orders.find(o => o.id === orderId);

  if (order) {
    // Pan map to order marker smoothly
    map.flyTo([order.lat, order.lng], 16, { animate: true, duration: 0.8 });
    highlightMapMarker(orderId);
  }

  // Re-render orders to apply active state visual
  renderOrders();
}

// --- Highlight Map Marker ---
function highlightMapMarker(orderId) {
  state.orders.forEach(o => {
    const marker = mapMarkers[o.id];
    if (marker) {
      const el = marker.getElement();
      if (el) {
        const pinDiv = el.querySelector(".pin");
        if (pinDiv) {
          if (o.id === orderId) {
            pinDiv.classList.add("pin--active");
          } else {
            pinDiv.classList.remove("pin--active");
          }
        }
      }
    }
  });
}

// --- Accept Order Status Transition ---
function acceptOrder(orderId, e) {
  if (e) e.stopPropagation();
  const order = state.orders.find(o => o.id === orderId);
  if (order && order.status === "available") {
    order.status = "mine";
    
    // Refresh Map Markers & List
    renderMapMarkers();
    renderOrders();
    updateStats();

    showNotification(`จองออเดอร์ ${order.id} เรียบร้อยแล้ว!`, "mine");
  }
}

// --- Tab Counts Counter Update ---
function updateTabCounts() {
  const counts = {
    all: state.orders.length,
    available: state.orders.filter(o => o.status === "available").length,
    mine: state.orders.filter(o => o.status === "mine").length,
    done: state.orders.filter(o => o.status === "done").length,
    failed: state.orders.filter(o => o.status === "failed").length,
    out: state.orders.filter(o => o.status === "out").length
  };

  document.getElementById("count-all").innerText = counts.all;
  document.getElementById("count-available").innerText = counts.available;
  document.getElementById("count-mine").innerText = counts.mine;
  document.getElementById("count-done").innerText = counts.done;
  document.getElementById("count-failed").innerText = counts.failed;
  document.getElementById("count-out").innerText = counts.out;
}

// --- Live Stats Update ---
function updateStats() {
  const completed = state.orders.filter(o => o.status === "done");
  const total = state.orders.length;
  const totalCod = completed.reduce((sum, o) => sum + (o.cod ? o.price : 0), 0);
  const totalDist = state.orders.reduce((sum, o) => sum + o.distance, 0);
  const successRate = total > 0 ? Math.round((completed.length / (completed.length + state.orders.filter(o => o.status === "failed").length || 1)) * 100) : 100;

  document.getElementById("stat-completed-count").innerText = `${completed.length}/${total}`;
  document.getElementById("stat-cod-amount").innerText = `฿${totalCod.toLocaleString()}`;
  document.getElementById("stat-distance").innerText = `${totalDist.toFixed(1)} km`;
  document.getElementById("stat-success-rate").innerText = `${successRate}%`;

  // Update print total COD
  const printTotalCodEl = document.getElementById("print-total-cod");
  if (printTotalCodEl) printTotalCodEl.innerText = `฿${totalCod.toLocaleString()}`;
}

// --- Proof of Delivery (POD) Modal ---
function openPodModal(orderId, e) {
  if (e) e.stopPropagation();
  state.selectedOrderId = orderId;
  const order = state.orders.find(o => o.id === orderId);
  if (!order) return;

  document.getElementById("pod-order-id").innerText = order.id;
  document.getElementById("pod-customer-name").innerText = order.customer;
  document.getElementById("pod-cod-price").innerText = order.cod ? `฿${order.price.toLocaleString()}` : "ชำระออนไลน์แล้ว";

  clearSignatureCanvas();

  const modal = document.getElementById("pod-modal");
  modal.classList.add("is-open");
}

function closePodModal() {
  document.getElementById("pod-modal").classList.remove("is-open");
}

// --- Signature Pad Canvas Setup ---
function initSignaturePad() {
  const canvas = document.getElementById("signature-canvas");
  if (!canvas) return;

  // Set crisp canvas dimensions
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width || 400;
  canvas.height = 160;

  const ctx = canvas.getContext("2d");
  ctx.strokeStyle = "#16202B";
  ctx.lineWidth = 2.5;
  ctx.lineCap = "round";

  state.signatureCanvas = canvas;
  state.signatureContext = ctx;

  // Touch & Mouse Drawing Events
  const startDraw = (e) => {
    state.isDrawing = true;
    const pos = getCanvasPos(e, canvas);
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y);
  };

  const draw = (e) => {
    if (!state.isDrawing) return;
    e.preventDefault();
    const pos = getCanvasPos(e, canvas);
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
  };

  const stopDraw = () => {
    state.isDrawing = false;
  };

  canvas.addEventListener("mousedown", startDraw);
  canvas.addEventListener("mousemove", draw);
  canvas.addEventListener("mouseup", stopDraw);
  canvas.addEventListener("mouseleave", stopDraw);

  canvas.addEventListener("touchstart", startDraw);
  canvas.addEventListener("touchmove", draw);
  canvas.addEventListener("touchend", stopDraw);

  document.getElementById("btn-clear-signature").addEventListener("click", clearSignatureCanvas);
  
  // Submit POD
  document.getElementById("btn-submit-pod").addEventListener("click", () => {
    const recipient = document.getElementById("pod-recipient-input").value || "ผู้รับสินค้า";
    const order = state.orders.find(o => o.id === state.selectedOrderId);
    
    if (order) {
      const now = new Date();
      const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')} น.`;
      
      order.status = "done";
      order.deliveredAt = timeStr;
      order.recipient = recipient;

      closePodModal();
      renderMapMarkers();
      renderOrders();
      updateStats();

      showNotification(`บันทึกจัดส่งสำเร็จสำหรับ ${order.id}`, "done");
    }
  });

  // Simulated Camera Capture
  document.getElementById("camera-trigger").addEventListener("click", () => {
    const previewImg = document.getElementById("photo-preview-img");
    previewImg.src = "assets/logo.png"; // Simulated delivery photo
    previewImg.style.display = "block";
    showNotification("ถ่ายภาพหลักฐานการส่งสินค้าแล้ว", "mine");
  });
}

function getCanvasPos(e, canvas) {
  const rect = canvas.getBoundingClientRect();
  const clientX = e.touches ? e.touches[0].clientX : e.clientX;
  const clientY = e.touches ? e.touches[0].clientY : e.clientY;
  return {
    x: clientX - rect.left,
    y: clientY - rect.top
  };
}

function clearSignatureCanvas() {
  if (state.signatureContext && state.signatureCanvas) {
    state.signatureContext.clearRect(0, 0, state.signatureCanvas.width, state.signatureCanvas.height);
  }
}

// --- Delivery Failure Modal ---
function openFailModal(orderId, e) {
  if (e) e.stopPropagation();
  state.selectedOrderId = orderId;
  const order = state.orders.find(o => o.id === orderId);
  if (!order) return;

  document.getElementById("fail-order-id").innerText = order.id;
  document.getElementById("failed-modal").classList.add("is-open");
}

function closeFailModal() {
  document.getElementById("failed-modal").classList.remove("is-open");
}

document.getElementById("btn-submit-fail").addEventListener("click", () => {
  const selectedReason = document.querySelector('input[name="fail-reason"]:checked')?.value || "ส่งไม่สำเร็จ";
  const notes = document.getElementById("fail-notes-input").value;
  const order = state.orders.find(o => o.id === state.selectedOrderId);

  if (order) {
    order.status = "failed";
    order.failReason = selectedReason + (notes ? ` (${notes})` : "");

    closeFailModal();
    renderMapMarkers();
    renderOrders();
    updateStats();

    showNotification(`บันทึกสถานะส่งไม่สำเร็จ: ${order.id}`, "failed");
  }
});

// --- Auto Route Optimization & Animated Path ---
document.getElementById("btn-optimize-route").addEventListener("click", optimizeRoute);

function optimizeRoute() {
  const mineOrders = state.orders.filter(o => o.status === "mine" || o.status === "attention");

  if (mineOrders.length === 0) {
    showNotification("กรุณาเลือกจองงานอย่างน้อย 1 รายการเพื่อจัดเส้นทาง", "attention");
    return;
  }

  // Calculate polyline coordinates from Warehouse Hub through all mine orders
  const waypoints = [[WAREHOUSE_HUB.lat, WAREHOUSE_HUB.lng]];
  mineOrders.forEach(o => waypoints.push([o.lat, o.lng]));

  // Clear previous route polyline
  if (state.activeRoutePolyline) {
    map.removeLayer(state.activeRoutePolyline);
  }

  state.activeRoutePolyline = L.polyline(waypoints, {
    color: "var(--st-mine)",
    weight: 4,
    opacity: 0.8,
    dashArray: "8, 8"
  }).addTo(map);

  map.fitBounds(state.activeRoutePolyline.getBounds(), { padding: [40, 40] });
  state.isOptimized = true;

  showNotification(`จัดเส้นทางจัดส่งสำหรับ ${mineOrders.length} ออเดอร์เรียบร้อยแล้ว`, "mine");
}

// --- Navigation Simulation ---
document.getElementById("btn-start-sim").addEventListener("click", startDriverSimulation);

function startDriverSimulation() {
  if (state.simulating) return;

  const mineOrders = state.orders.filter(o => o.status === "mine" || o.status === "attention");
  if (mineOrders.length === 0) {
    showNotification("ยังไม่มีงานในเส้นทางเพื่อจำลองการขับรถ", "attention");
    return;
  }

  optimizeRoute();
  state.simulating = true;

  // Driver Moving Icon
  const driverIcon = L.divIcon({
    className: "leaflet-div-icon",
    html: `<div style="background: var(--st-available); color: #fff; width: 28px; height: 28px; border-radius: 50%; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 10px rgba(0,0,0,0.4); border: 2px solid #fff;"><i class="fa-solid fa-motorcycle" style="font-size: 14px;"></i></div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14]
  });

  if (state.driverMarker) map.removeLayer(state.driverMarker);
  state.driverMarker = L.marker([WAREHOUSE_HUB.lat, WAREHOUSE_HUB.lng], { icon: driverIcon }).addTo(map);

  let targetIndex = 0;
  
  const moveNext = () => {
    if (targetIndex >= mineOrders.length) {
      state.simulating = false;
      showNotification("จำลองการเดินทางถึงทุกจุดหมายแล้ว!", "done");
      return;
    }

    const targetOrder = mineOrders[targetIndex];
    let step = 0;
    const steps = 30;
    const startLat = state.driverMarker.getLatLng().lat;
    const startLng = state.driverMarker.getLatLng().lng;

    const interval = setInterval(() => {
      step++;
      const curLat = startLat + (targetOrder.lat - startLat) * (step / steps);
      const curLng = startLng + (targetOrder.lng - startLng) * (step / steps);

      state.driverMarker.setLatLng([curLat, curLng]);
      map.setView([curLat, curLng]);

      if (step >= steps) {
        clearInterval(interval);
        selectOrder(targetOrder.id);
        targetIndex++;
        setTimeout(moveNext, 1200);
      }
    }, 60);
  };

  moveNext();
}

// --- Event Listeners Setup ---
function initEventListeners() {
  // Search Bar Filter
  document.getElementById("search-input").addEventListener("input", (e) => {
    state.searchQuery = e.target.value;
    renderOrders();
  });

  // Status Tab Buttons
  document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("is-active"));
      btn.classList.add("is-active");
      state.activeFilter = btn.dataset.status;
      renderOrders();
    });
  });

  // Map Recenter & Zone Toggle
  document.getElementById("btn-recenter-map").addEventListener("click", () => {
    map.setView([13.7245, 100.5290], 15);
  });

  document.getElementById("btn-toggle-zones").addEventListener("click", () => {
    if (map.hasLayer(zonePolygon)) {
      map.removeLayer(zonePolygon);
    } else {
      map.addLayer(zonePolygon);
    }
  });

  // Mobile Bottom Sheet Drag Interaction
  const sheet = document.getElementById("bottom-sheet");
  const handle = document.getElementById("sheet-handle");
  let startY = 0;
  let startHeight = 0;

  if (handle) {
    handle.addEventListener("touchstart", (e) => {
      startY = e.touches[0].clientY;
      startHeight = sheet.getBoundingClientRect().height;
    });

    handle.addEventListener("touchmove", (e) => {
      const deltaY = startY - e.touches[0].clientY;
      const newHeight = Math.max(120, Math.min(window.innerHeight * 0.85, startHeight + deltaY));
      sheet.style.height = `${newHeight}px`;
    });
  }
}

// --- Helper Notifications ---
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

  let dotClass = `is-${statusType}`;
  toast.innerHTML = `<span class="legend-dot ${dotClass}"></span> ${message}`;

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
