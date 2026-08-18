require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { signToken, verifyToken } = require('./api/lib/jwt');
const { getDriverProfile, readDriversDb, writeDriversDb } = require('./api/lib/drivers');
const { classifyOrderZone } = require('./api/lib/zones');
const {
  normalizePhone,
  mergeOrderSources,
  filterActiveOrders,
  splitByDeliveryDate,
} = require('./api/lib/orders');
const { getSheetsClient, ensureSheetExists, getSheetRows } = require('./api/lib/sheets');
const supervisorDayHandler  = require('./api/supervisor/day');
const { fetchUnifiedOrdersFromSheets } = supervisorDayHandler;
const supervisorSyncHandler = require('./api/supervisor/sync');
const { fetchSkuDetailsFromSheets } = require('./api/lib/sku');

const app = express();
const PORT = process.env.PORT || 3000;


app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Serve static frontend files
app.use(express.static(__dirname));

// Dedicated route for supervisor portal
app.get('/supervisor', (req, res) => {
  res.sendFile(path.join(__dirname, 'supervisor.html'));
});

// DB paths (local JSON — ใช้เฉพาะที่ยังไม่ย้ายไป Sheets)
const PINFIX_DB      = path.join(__dirname, 'local_pinfix.json');
const ZONES_DB       = path.join(__dirname, 'local_zones.json');
const ORDERS_DB      = path.join(__dirname, 'orders_data.json');   // TODO: replace with Sheets คำสั่งซื้อ
const ROUTECODE_DB   = path.join(__dirname, 'local_routecodes.json'); // TODO: migrate to Sheets

// Sheets config for _ASSIGN
const SHEET_ID_ORDERS = (process.env.SHEET_ID_ORDERS && process.env.SHEET_ID_ORDERS.length > 20 && !process.env.SHEET_ID_ORDERS.includes('BEWpjZ'))
  ? process.env.SHEET_ID_ORDERS
  : '1m1Cb_BEwPjqF3CgXNssGgjyewIgPNw_BU4EkduuV59U';
const SHEET_ID_PRODUCTS = process.env.SHEET_ID_PRODUCTS || '1_qE1NtIfLfa2Vn0AXFxfGoD9daZB34OtLnv08Tc-o54';
const ASSIGN_SHEET     = '_ASSIGN';
const ASSIGN_HEADERS   = [
  'order_id','status','assigned_driver','completed_at',
  'lat','lng','driver_note','priority','hold',
];

// Zone card limits (cards per zone per day)
const CARD_LIMITS = { A: 30, B: 30, C: 30 };

// --- Routecode helpers ---
function rcReadDb() {
  try {
    if (fs.existsSync(ROUTECODE_DB)) {
      return JSON.parse(fs.readFileSync(ROUTECODE_DB, 'utf8'));
    }
  } catch (e) { console.error('rcReadDb:', e.message); }
  return { counters: {}, assignments: {}, printed: {} };
}
function rcWriteDb(data) {
  fs.writeFileSync(ROUTECODE_DB, JSON.stringify(data, null, 2), 'utf8');
}
function getZoneCardLimit(zoneLetter) {
  try {
    const db = readZonesDb();
    const all = [...(db.zones || []), ...(db.overlapZones || [])];
    const found = all.find(z => (z.letter === zoneLetter || z.letters === zoneLetter));
    if (found && found.cardLimit) return parseInt(found.cardLimit, 10);
  } catch (e) {}
  return CARD_LIMITS[zoneLetter] || 30;
}

function rcZoneLetter(geojsonZone) {
  if (!geojsonZone || geojsonZone === 'UNASSIGNED') return null;
  const m = geojsonZone.match(/Zone ([A-Z]+)/i);
  return m ? m[1].toUpperCase() : null;
}
// Parse "DD-MM-YYYY", "YYYY-MM-DD", "M/D/YYYY", etc. → { dd: "05", dateKey: "YYYY-MM-DD" }
function rcParseDate(dateStr) {
  if (!dateStr) return null;
  const s = String(dateStr).trim().split(' ')[0]; // strip time if present
  let dy, mo, yr;

  if (s.includes('-')) {
    const parts = s.split('-');
    if (parts.length === 3) {
      if (parts[0].length === 4) {
        // YYYY-MM-DD
        yr = parseInt(parts[0], 10);
        mo = parseInt(parts[1], 10);
        dy = parseInt(parts[2], 10);
      } else {
        // DD-MM-YYYY
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

  return {
    dd:      String(dy).padStart(2, '0'),
    dateKey: `${yr}-${String(mo).padStart(2, '0')}-${String(dy).padStart(2, '0')}`,
  };
}

// Helper to read JSON DB
function readDb(dbPath) {
  try {
    if (fs.existsSync(dbPath)) {
      return JSON.parse(fs.readFileSync(dbPath, 'utf8'));
    }
  } catch (err) {
    console.error(`Error reading ${dbPath}:`, err);
  }
  return [];
}

// Helper to write JSON DB
function writeDb(dbPath, data) {
  try {
    fs.writeFileSync(dbPath, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    console.error(`Error writing ${dbPath}:`, err);
  }
}

// Auth Middleware
function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  const token = req.query.driverToken || req.query.supervisorToken || req.body?.driverToken || (authHeader && authHeader.split(' ')[1]);

  if (!token) {
    return res.status(401).json({ error: 'Unauthorized: Missing token' });
  }

  const decoded = verifyToken(token);
  if (!decoded) {
    return res.status(401).json({ error: 'Unauthorized: Invalid token' });
  }

  req.user = decoded;
  next();
}

// POST /api/auth/login
app.post('/api/auth/login', (req, res) => {
  const { username, pin } = req.body || {};
  const inputPin = pin || req.body?.password;

  if (!inputPin) {
    return res.status(400).json({ error: 'Password/PIN is required' });
  }

  let matchedUser = null;

  const allDrivers = readDriversDb();
  const driverUsers = allDrivers.map(d => ({
    username: d.code || d.id,
    pin: d.pin,
    role: 'driver',
    driver_vehicle_id: d.code || d.id,
    status: d.status || 'active',
    name: d.name
  }));
  const adminUser = { username: 'admin', pin: '9999', role: 'admin', driver_vehicle_id: null, status: 'active', name: 'หัวหน้าคลัง' };
  const mockUsers = [...driverUsers, adminUser];

  if (username) {
    matchedUser = mockUsers.find(
      u => u.username.toLowerCase() === username.toLowerCase() && u.pin === inputPin
    );
  } else {
    // PIN only check
    matchedUser = mockUsers.find(u => u.pin === inputPin);
  }

  if (!matchedUser) {
    return res.status(401).json({ error: 'รหัสผ่านหรือ PIN ไม่ถูกต้อง' });
  }

  if (matchedUser.status === 'inactive') {
    return res.status(403).json({ error: `คนขับ "${matchedUser.name || matchedUser.username}" ถูกปิดใช้งาน กรุณาติดต่อหัวหน้าคลัง` });
  }

  const token = signToken({
    username: matchedUser.username,
    role: matchedUser.role,
    driver_vehicle_id: matchedUser.driver_vehicle_id
  });

  res.status(200).json({
    success: true,
    token,
    user: {
      username: matchedUser.username,
      name: matchedUser.name,
      role: matchedUser.role,
      driver_vehicle_id: matchedUser.driver_vehicle_id
    }
  });
});

// =========================================
// Sheets _ASSIGN helpers
// =========================================

/** อ่าน _ASSIGN sheet → Map<orderId, lastRow> (last-wins per orderId) */
async function assignReadMap() {
  const sheets = getSheetsClient();
  await ensureSheetExists(sheets, SHEET_ID_ORDERS, ASSIGN_SHEET, ASSIGN_HEADERS);
  const rows = await getSheetRows(sheets, SHEET_ID_ORDERS, `${ASSIGN_SHEET}!A1:J5000`);
  const map = {};
  rows.forEach(row => { if (row.order_id) map[row.order_id] = row; });
  return map;
}

/** Append หนึ่งหรือหลายแถวเข้า _ASSIGN */
async function assignAppend(rows) {
  const sheets = getSheetsClient();
  const values = rows.map(row => ASSIGN_HEADERS.map(h => String(row[h] || '')));
  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID_ORDERS,
    range: `${ASSIGN_SHEET}!A1`,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    resource: { values },
  });
}

// =========================================
// getMappedOrders — อ่านออเดอร์จาก local JSON (orders_data.json)
// assignment overlay มาจาก Sheets _ASSIGN
// TODO (Step 2-3): เปลี่ยน rawOrders ให้อ่านจากชีต คำสั่งซื้อ
// =========================================
async function getMappedOrders(date, userRole, driverCode) {
  const rawOrders = readDb(ORDERS_DB);

  // อ่าน assignment จาก Sheets
  const assignmentMap = await assignReadMap();

  const INACTIVE = new Set(['ยกเลิก', 'ส่งสำเร็จ', 'ได้รับแล้ว', 'cancelled', 'delivered', 'received']);

  return rawOrders
    .filter(order => {
      const rawStatus = (order.rawStatus || order.apiStatus || '').trim();
      if (INACTIVE.has(rawStatus)) return false;
      const deliveryDate = (order.deliveryDate || order.timeWindow || '').trim();
      if (!deliveryDate) return false;
      if (!date || date === 'all') return true;
      return deliveryDate === date;
    })
    .map(order => {
      const id = order.id || order.uid;
      const lat = order.lat;
      const lng = order.lng;
      const geojsonZone = classifyOrderZone(lat, lng);

      const override = assignmentMap[id];
      let status = 'available';
      let assignedDriverId = '';
      let driverNote = '';
      let priority = 'normal';
      let hold = false;

      if (override) {
        assignedDriverId = override.assigned_driver || '';
        driverNote = override.driver_note || '';
        priority = override.priority || 'normal';
        hold = override.hold === 'TRUE';

        if (override.status === 'done' || override.status === 'failed') {
          status = override.status;
        } else if (override.status === 'mine') {
          status = override.assigned_driver === driverCode ? 'mine' : 'other_mine';
        } else if (override.status === 'released') {
          status = 'available';
          assignedDriverId = '';
        }
      }

      if (userRole === 'driver' && status === 'available') {
        const driverProfile = getDriverProfile(driverCode);
        const assigned = driverProfile.assignedZones || [driverProfile.zone];
        const isMyZone = assigned.includes(geojsonZone) || geojsonZone === driverProfile.zone;
        if (!driverProfile.isSpecial && !isMyZone) {
          status = 'out';
        }
      }

      const storesDb = readStoresDb();
      const phone = normalizePhone(order.phone);
      const storeReq = (phone && storesDb[phone]) ? storesDb[phone] : null;

      const storeChips = [];
      if (storeReq) {
        if (storeReq.callBeforeMinutes) storeChips.push(`โทรก่อน ${storeReq.callBeforeMinutes} น.`);
        if (storeReq.openTime && storeReq.closeTime) storeChips.push(`เปิด ${storeReq.openTime}-${storeReq.closeTime}`);
        if (storeReq.breakTime) storeChips.push(`ปิด ${storeReq.breakTime}`);
        if (storeReq.narrowAlley) storeChips.push('ซอยแคบ');
        if (storeReq.heavyHelpNeeded) storeChips.push('ต้องช่วยยก');
        if (storeReq.stairs) storeChips.push('ขึ้นบันได');
      }

      return {
        ...order,
        geojsonZone,
        status,
        assignedDriverId,
        driverNote,
        priority,
        hold,
        storeRequirements: storeReq,
        storeChips: storeChips.slice(0, 2)
      };
    });
}

// GET /api/driver/day — อ่านจากชีตคำสั่งซื้อ + CS Master + _ASSIGN แหล่งเดียวกับ Supervisor
app.get('/api/driver/day', authMiddleware, async (req, res) => {
  try {
    const { date } = req.query;
    const { ordersWithDate, pendingSchedule } = await fetchUnifiedOrdersFromSheets({
      date,
      role: req.user.role || 'driver',
      username: req.user.username
    });
    const orders = (date === 'all' || !date) ? [...ordersWithDate, ...pendingSchedule] : ordersWithDate;
    res.status(200).json({ success: true, orders, pendingSchedule });
  } catch (err) {
    console.error('[driver/day]', err.message);
    res.status(500).json({ error: 'Internal Server Error', details: err.message });
  }
});

// GET /api/supervisor/day — อ่านจาก Sheets คำสั่งซื้อ (ไม่ใช่ local orders_data.json)
app.get('/api/supervisor/day', supervisorDayHandler);

// --- Cash On Delivery (COD) Reconciliation API ---
const { getCodSummary, appendCodLedger, saveDriverVerification, executeDayClose, getDaycloseStatus } = require('./api/cod');
const { getDispatchSummary, assignOrderToDriver } = require('./api/dispatch');

app.get('/api/dispatch/summary', authMiddleware, async (req, res) => {
  try {
    const { date } = req.query;
    const summary = await getDispatchSummary(date);
    res.status(200).json({ success: true, ...summary });
  } catch (err) {
    console.error('[dispatch/summary]', err.message);
    res.status(500).json({ error: 'Internal Server Error', details: err.message });
  }
});

app.post('/api/dispatch/assign', authMiddleware, async (req, res) => {
  try {
    const { orderId, driverId, reason } = req.body || {};
    if (!orderId || !driverId) {
      return res.status(400).json({ error: 'Missing orderId or driverId' });
    }
    const result = await assignOrderToDriver({
      orderId,
      driverId,
      reason,
      username: req.user ? (req.user.name || req.user.username) : 'supervisor'
    });
    res.status(200).json(result);
  } catch (err) {
    console.error('[dispatch/assign]', err.message);
    const statusCode = err.status || 400;
    res.status(statusCode).json({
      error: err.message,
      requiresReason: !!err.requiresReason,
      orderZone: err.orderZone || null,
      driverZones: err.driverZones || null
    });
  }
});

const {
  getCrossZoneApprovalSummary,
  approveCrossZoneRequest,
  rejectCrossZoneRequest,
  createCrossZoneRequest
} = require('./api/supervisor/approvals');

// Approval Center (S3) Endpoints
app.post('/api/driver/crosszone-request', authMiddleware, async (req, res) => {
  try {
    const {
      orderId,
      orderNumber,
      customer,
      address,
      orderZone,
      price,
      cod,
      driverId,
      driverName,
      driverZones,
      reason
    } = req.body || {};

    const effectiveDriverId = driverId || (req.user ? req.user.username : 'DRV-UNKNOWN');
    const effectiveDriverName = driverName || (req.user ? req.user.name : effectiveDriverId);

    const result = await createCrossZoneRequest({
      orderId,
      orderNumber,
      customer,
      address,
      orderZone,
      price,
      cod,
      driverId: effectiveDriverId,
      driverName: effectiveDriverName,
      driverZones,
      reason
    });

    res.status(200).json(result);
  } catch (err) {
    console.error('[driver/crosszone-request]', err.message);
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/supervisor/approvals/crosszone', authMiddleware, async (req, res) => {
  try {
    const { date } = req.query;
    const summary = await getCrossZoneApprovalSummary(date);
    res.status(200).json({ success: true, ...summary });
  } catch (err) {
    console.error('[approvals/crosszone]', err.message);
    res.status(500).json({ error: 'Internal Server Error', details: err.message });
  }
});

app.post('/api/supervisor/approvals/crosszone/approve', authMiddleware, async (req, res) => {
  try {
    const { requestId } = req.body || {};
    if (!requestId) {
      return res.status(400).json({ error: 'Missing requestId' });
    }
    const result = await approveCrossZoneRequest({
      requestId,
      supervisorName: req.user ? (req.user.name || req.user.username) : 'supervisor'
    });
    res.status(200).json(result);
  } catch (err) {
    console.error('[approvals/crosszone/approve]', err.message);
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/supervisor/approvals/crosszone/reject', authMiddleware, async (req, res) => {
  try {
    const { requestId, reason } = req.body || {};
    if (!requestId || !reason) {
      return res.status(400).json({ error: 'Missing requestId or rejection reason' });
    }
    const result = await rejectCrossZoneRequest({
      requestId,
      reason,
      supervisorName: req.user ? (req.user.name || req.user.username) : 'supervisor'
    });
    res.status(200).json(result);
  } catch (err) {
    console.error('[approvals/crosszone/reject]', err.message);
    res.status(400).json({ error: err.message });
  }
});


app.get('/api/cod/summary', authMiddleware, async (req, res) => {
  try {
    const { date } = req.query;
    const summary = await getCodSummary(date);
    res.status(200).json({ success: true, ...summary });
  } catch (err) {
    console.error('[cod/summary]', err.message);
    res.status(500).json({ error: 'Internal Server Error', details: err.message });
  }
});

app.post('/api/cod/verify-driver', authMiddleware, async (req, res) => {
  try {
    const { date, driverId, expected, collected, verified, reason, customReason } = req.body || {};
    if (!date || !driverId || verified === undefined) {
      return res.status(400).json({ error: 'Missing required fields (date, driverId, verified)' });
    }
    const entry = await saveDriverVerification({
      date,
      driverId,
      expected,
      collected,
      verified,
      reason,
      customReason,
      createdBy: req.user ? (req.user.name || req.user.username || 'supervisor') : 'supervisor'
    });
    res.status(200).json({ success: true, entry });
  } catch (err) {
    console.error('[cod/verify-driver]', err.message);
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/cod/dayclose', authMiddleware, async (req, res) => {
  try {
    const { date } = req.body || {};
    if (!date) {
      return res.status(400).json({ error: 'Missing date parameter' });
    }
    const result = await executeDayClose({
      date,
      closedBy: req.user ? (req.user.name || req.user.username || 'supervisor') : 'supervisor'
    });
    res.status(200).json(result);
  } catch (err) {
    console.error('[cod/dayclose]', err.message);
    res.status(400).json({ error: err.message });
  }
});

// POST /api/supervisor/sync — sync ออเดอร์ใหม่จาก Unii API → Sheets คำสั่งซื้อ
app.post('/api/supervisor/sync', supervisorSyncHandler);

// POST /api/stop/claim — เขียนเข้า Sheets _ASSIGN
app.post('/api/stop/claim', authMiddleware, async (req, res) => {
  const { orderId, orderIds } = req.body || {};
  const targetIds = orderIds || (orderId ? [orderId] : []);

  if (targetIds.length === 0)
    return res.status(400).json({ error: 'Missing orderId or orderIds' });

  try {
    // อ่าน Sheets ก่อน — read-before-write เพื่อกัน collision
    const assignmentMap = await assignReadMap();

    for (const id of targetIds) {
      const current = assignmentMap[id];
      if (current && current.status === 'mine' && current.assigned_driver && current.assigned_driver !== req.user.username) {
        return res.status(409).json({
          success: false,
          error: `Order ${id} is already claimed by ${current.assigned_driver}`,
        });
      }
    }

    const newRows = targetIds.map(id => ({
      order_id: id, status: 'mine',
      assigned_driver: req.user.username,
      completed_at: '', lat: '', lng: '', driver_note: '', priority: '', hold: '',
    }));
    await assignAppend(newRows);
    res.status(200).json({ success: true, message: 'Successfully claimed stops' });
  } catch (err) {
    console.error('[stop/claim]', err.message);
    res.status(500).json({ error: 'Internal Server Error', details: err.message });
  }
});

// POST /api/stop/release — เขียนเข้า Sheets _ASSIGN
app.post('/api/stop/release', authMiddleware, async (req, res) => {
  const { orderId, orderIds } = req.body || {};
  const targetIds = orderIds || (orderId ? [orderId] : []);

  if (targetIds.length === 0)
    return res.status(400).json({ error: 'Missing orderId or orderIds' });

  try {
    const assignmentMap = await assignReadMap();
    const isSupervisor = ['supervisor', 'admin', 'administrator'].includes(req.user.role);

    for (const id of targetIds) {
      const current = assignmentMap[id];
      if (current && current.status === 'mine' && current.assigned_driver && current.assigned_driver !== req.user.username && !isSupervisor) {
        return res.status(403).json({
          success: false,
          error: `Cannot release order ${id} as it is claimed by ${current.assigned_driver}`,
        });
      }
    }

    const newRows = targetIds.map(id => ({
      order_id: id, status: 'released',
      assigned_driver: '', completed_at: '',
      lat: '', lng: '', driver_note: '', priority: '', hold: '',
    }));
    await assignAppend(newRows);
    res.status(200).json({ success: true, message: 'Successfully released stops' });
  } catch (err) {
    console.error('[stop/release]', err.message);
    res.status(500).json({ error: 'Internal Server Error', details: err.message });
  }
});

const {
  recordFailedDelivery,
  receiveReturnItem,
  getReturnsSummary
} = require('./api/supervisor/returns');

// POST /api/stop/complete — เขียนเข้า Sheets _ASSIGN & _RETURNS (เมื่อส่งไม่สำเร็จ)
app.post('/api/stop/complete', authMiddleware, async (req, res) => {
  const { orderId, status, lat, lng, note, photoUrl, customerName, itemCount, price } = req.body || {};

  if (!orderId || !status)
    return res.status(400).json({ error: 'Missing orderId or status' });
  if (status !== 'done' && status !== 'failed')
    return res.status(400).json({ error: 'Status must be "done" or "failed"' });

  try {
    const assignmentMap = await assignReadMap();
    const isSupervisor = ['supervisor', 'admin', 'administrator'].includes(req.user.role);
    const current = assignmentMap[orderId];

    if (current && current.status === 'mine' && current.assigned_driver && current.assigned_driver !== req.user.username && !isSupervisor) {
      return res.status(403).json({
        success: false,
        error: `Cannot modify order ${orderId} as it is claimed by ${current.assigned_driver}`,
      });
    }

    const assignedDriver = current ? current.assigned_driver : req.user.username;
    const nowIso = new Date().toISOString();

    await assignAppend([{
      order_id: orderId,
      status,
      assigned_driver: assignedDriver,
      completed_at: nowIso,
      lat: lat || '', lng: lng || '',
      driver_note: note || '', priority: '', hold: '',
    }]);

    // 🔥 AUTOMATIC TRIGGER: If delivery failed, immediately record to _RETURNS
    if (status === 'failed') {
      try {
        await recordFailedDelivery({
          orderNo: orderId,
          driverId: assignedDriver,
          failReason: note || 'ส่งไม่สำเร็จ',
          failAt: nowIso,
          photoUrl: photoUrl || '',
          customerName: customerName || '',
          itemCount: itemCount || 1,
          price: price || 0
        });
      } catch (retErr) {
        console.warn('[stop/complete] recordFailedDelivery warning:', retErr.message);
      }
    }

    res.status(200).json({ success: true, message: 'Successfully completed stop' });
  } catch (err) {
    console.error('[stop/complete]', err.message);
    res.status(500).json({ error: 'Internal Server Error', details: err.message });
  }
});

// GET /api/supervisor/returns — ดึงรายการของกลับเข้าคลัง
app.get('/api/supervisor/returns', authMiddleware, async (req, res) => {
  try {
    const { date, driverId, status, condition } = req.query;
    const summary = await getReturnsSummary({ date, driverId, status, condition });
    res.status(200).json({ success: true, ...summary });
  } catch (err) {
    console.error('[supervisor/returns]', err.message);
    res.status(500).json({ error: 'Internal Server Error', details: err.message });
  }
});

// POST /api/supervisor/returns/receive — หัวหน้าคลังตรวจรับสภาพสินค้า
app.post('/api/supervisor/returns/receive', authMiddleware, async (req, res) => {
  try {
    const { orderNo, condition, shortageCount, shortageNote } = req.body || {};
    if (!orderNo || !condition) {
      return res.status(400).json({ error: 'Missing orderNo or condition' });
    }
    const result = await receiveReturnItem({
      orderNo,
      condition,
      shortageCount,
      shortageNote,
      supervisorName: req.user ? (req.user.name || req.user.username) : 'supervisor'
    });
    res.status(200).json(result);
  } catch (err) {
    console.error('[supervisor/returns/receive]', err.message);
    res.status(400).json({ error: err.message });
  }
});

// POST /api/stop/override — เขียนวันจัดส่งลง Google Sheets คำสั่งซื้อ (Col C) และ _ASSIGN จริง
app.post('/api/stop/override', authMiddleware, async (req, res) => {
  const { orderId, deliveryDateOverride, zoneOverride, driverNote, priority, hold, driverId, reason } = req.body || {};

  if (!orderId)
    return res.status(400).json({ error: 'Missing orderId' });

  try {
    const sheets = getSheetsClient();
    const targetDate = deliveryDateOverride || '';
    const noteText = driverNote || (reason ? `เลื่อนส่ง: ${reason}` : '');

    // 1. เขียนลง Sheets คำสั่งซื้อ จริง (Col C: วันที่จะจัดส่ง, Col L: หมายเหตุ)
    if (targetDate || noteText) {
      const uidToRow = await getOrderRowIndexMap(sheets);
      const rowNum = uidToRow[orderId];
      if (rowNum) {
        const batchData = [];
        if (targetDate) {
          batchData.push({
            range: `คำสั่งซื้อ!C${rowNum}`,
            values: [[targetDate]]
          });
        }
        if (noteText) {
          // Read existing note to prevent overwriting
          let existingNote = '';
          try {
            const noteRes = await sheets.spreadsheets.values.get({
              spreadsheetId: SHEET_ID_ORDERS,
              range: `คำสั่งซื้อ!L${rowNum}`
            });
            existingNote = (noteRes.data.values?.[0]?.[0] || '').trim();
          } catch (e) {}

          const combinedNote = existingNote ? `${existingNote} | ${noteText}` : noteText;
          batchData.push({
            range: `คำสั่งซื้อ!L${rowNum}`,
            values: [[combinedNote]]
          });
        }
        if (batchData.length > 0) {
          await sheets.spreadsheets.values.batchUpdate({
            spreadsheetId: SHEET_ID_ORDERS,
            resource: {
              valueInputOption: 'USER_ENTERED',
              data: batchData
            }
          });
          console.log(`[stop/override] บันทึกวันส่ง ${targetDate} ลงคำสั่งซื้อ!C${rowNum} เรียบร้อย`);
        }
      }
    }

    // 2. ปลดสถานะใน _ASSIGN เมื่อเลื่อนวัน เพื่อให้ในวันใหม่กลับมาเป็น available
    await assignAppend([{
      order_id: orderId,
      status: 'released',
      assigned_driver: '',
      completed_at: '', lat: '', lng: '',
      driver_note: noteText || '',
      priority: priority || 'normal',
      hold: hold ? 'TRUE' : 'FALSE',
    }]);

    res.status(200).json({ success: true, message: 'Successfully saved reschedule override to Google Sheets' });
  } catch (err) {
    console.error('[stop/override]', err.message);
    res.status(500).json({ error: 'Internal Server Error', details: err.message });
  }
});

// POST /api/stop/pinfix — บันทึกหมุดใหม่ลง CS Master และ _PINFIX ใน Google Sheets
app.post('/api/stop/pinfix', authMiddleware, async (req, res) => {
  const { phone, lat, lng } = req.body || {};

  if (!phone || !lat || !lng) {
    return res.status(400).json({ error: 'Missing phone, lat, or lng' });
  }

  try {
    const normTarget = String(phone).replace(/[^0-9]/g, '').replace(/^0/, '').replace(/^66/, '');
    const sheets = getSheetsClient();
    const spreadsheetId = SHEET_ID_ORDERS;

    // 1. Ensure _PINFIX tab exists on Google Sheets and append audit record
    try {
      await ensureSheetExists(sheets, spreadsheetId, '_PINFIX', [
        'phone_number', 'lat', 'lng', 'updated_at', 'updated_by'
      ]);
      await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: '_PINFIX!A1',
        valueInputOption: 'USER_ENTERED',
        resource: {
          values: [[phone, lat, lng, new Date().toISOString(), req.user.username || 'driver']]
        }
      });
    } catch (pinErr) {
      console.warn('[pinfix] _PINFIX append warning:', pinErr.message);
    }

    // 2. Find row in CS Master by phone number and update Col G(ละ), H(ลอง), I(ลิ้ง)
    const csRes = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'CS Master!A1:B3000'
    });
    const csRows = csRes.data.values || [];
    let matchRow = null;

    csRows.slice(1).forEach((r, idx) => {
      const rawP = (r[1] || '').trim();
      const normP = rawP.replace(/[^0-9]/g, '').replace(/^0/, '').replace(/^66/, '');
      if (normP && normP === normTarget) {
        matchRow = idx + 2;
      }
    });

    if (matchRow) {
      const mapLink = `https://www.google.com/maps?q=${lat},${lng}`;
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `CS Master!G${matchRow}:I${matchRow}`,
        valueInputOption: 'USER_ENTERED',
        resource: {
          values: [[lat, lng, mapLink]]
        }
      });
      console.log(`[pinfix] อัปเดตพิกัดลูกค้าใน CS Master!G${matchRow}:I${matchRow} สำเร็จ (${phone} -> ${lat}, ${lng})`);
    }

    // 3. Local JSON cache
    const pinfixes = readDb(PINFIX_DB);
    pinfixes.push({
      phone_number: phone,
      lat,
      lng,
      updated_at: new Date().toISOString(),
      updated_by: req.user.username
    });
    writeDb(PINFIX_DB, pinfixes);

    res.status(200).json({
      success: true,
      message: `บันทึกหมุดใหม่สำหรับเบอร์ ${phone} ลง CS Master และ _PINFIX เรียบร้อยแล้ว`,
      updatedCsMasterRow: matchRow
    });
  } catch (err) {
    console.error('[pinfix error]', err);
    res.status(500).json({ error: 'Internal Server Error', details: err.message });
  }
});

// =========================================
// POST /api/routecode/assign
// =========================================
app.post('/api/routecode/assign', authMiddleware, (req, res) => {
  const isSup = ['supervisor','admin','administrator'].includes(req.user.role);
  if (!isSup) return res.status(403).json({ error: 'Forbidden' });

  const { orderId, geojsonZone, deliveryDate, force } = req.body || {};
  if (!orderId || !geojsonZone || !deliveryDate)
    return res.status(400).json({ error: 'Missing orderId, geojsonZone, or deliveryDate' });

  const zoneLetter = rcZoneLetter(geojsonZone);
  if (!zoneLetter) return res.status(400).json({ error: 'Invalid zone' });

  const parsed = rcParseDate(deliveryDate);
  if (!parsed) return res.status(400).json({ error: 'Invalid deliveryDate format' });
  const { dd, dateKey } = parsed;

  const db = rcReadDb();

  if (db.assignments[orderId] && !force) {
    const existing = db.assignments[orderId];
    return res.status(200).json({ success: true, alreadyAssigned: true, routeCode: existing.routeCode });
  }

  const counterKey = `${zoneLetter}_${dateKey}`;
  const newSeq = (db.counters[counterKey] || 0) + 1;
  db.counters[counterKey] = newSeq; // write counter first (race guard)

  const routeCode = `${zoneLetter}${dd}${String(newSeq).padStart(2,'0')}-${zoneLetter}${newSeq}`;
  const cardLimit = getZoneCardLimit(zoneLetter);
  const overLimit = newSeq > cardLimit;

  const oldCodes = db.assignments[orderId]
    ? [...(db.assignments[orderId].oldCodes || []), db.assignments[orderId].routeCode]
    : [];

  db.assignments[orderId] = {
    routeCode, zone: zoneLetter, date: dateKey,
    seq: newSeq, assignedAt: new Date().toISOString(),
    assignedBy: req.user.username, oldCodes, overLimit,
  };
  rcWriteDb(db);

  return res.status(200).json({
    success: true, routeCode, seq: newSeq, overLimit, cardLimit,
    warning: overLimit
      ? `โซน ${zoneLetter} วันนี้ออกรหัสเกิน ${cardLimit} การ์ดแล้ว (ล่าสุด #${newSeq}) — เตรียมการ์ดเพิ่มหรือจัดการเอง`
      : null,
  });
});

// =========================================
// POST /api/routecode/assign-batch
// =========================================
app.post('/api/routecode/assign-batch', authMiddleware, (req, res) => {
  const isSup = ['supervisor','admin','administrator'].includes(req.user.role);
  if (!isSup) return res.status(403).json({ error: 'Forbidden' });

  const { orders } = req.body || {};
  if (!Array.isArray(orders) || orders.length === 0)
    return res.status(400).json({ error: 'Missing orders array' });

  const db = rcReadDb();
  const results = {};
  const warnings = [];

  for (const { orderId, geojsonZone, deliveryDate } of orders) {
    if (!orderId || !geojsonZone || !deliveryDate) continue;
    if (db.assignments[orderId]) {
      results[orderId] = db.assignments[orderId].routeCode;
      continue;
    }
    const zoneLetter = rcZoneLetter(geojsonZone);
    const parsed = rcParseDate(deliveryDate);
    if (!zoneLetter || !parsed) continue;

    const { dd, dateKey } = parsed;
    const counterKey = `${zoneLetter}_${dateKey}`;
    const newSeq = (db.counters[counterKey] || 0) + 1;
    db.counters[counterKey] = newSeq;

    const routeCode = `${zoneLetter}${dd}${String(newSeq).padStart(2,'0')}-${zoneLetter}${newSeq}`;
    const cardLimit = getZoneCardLimit(zoneLetter);
    const overLimit = newSeq > cardLimit;

    db.assignments[orderId] = {
      routeCode, zone: zoneLetter, date: dateKey,
      seq: newSeq, assignedAt: new Date().toISOString(),
      assignedBy: req.user.username, oldCodes: [], overLimit,
    };
    results[orderId] = routeCode;
    if (overLimit) {
      warnings.push(`โซน ${zoneLetter} วันที่ ${dateKey} ออกรหัสเกิน ${cardLimit} การ์ดแล้ว (ล่าสุด #${newSeq})`);
    }
  }

  rcWriteDb(db);
  return res.status(200).json({ success: true, results, warnings });
});

// =========================================
// GET /api/routecode/list
// =========================================
app.get('/api/routecode/list', authMiddleware, (req, res) => {
  const db = rcReadDb();
  res.json({ success: true, assignments: db.assignments, counters: db.counters, printed: db.printed });
});

// =========================================
// POST /api/order/printed
// =========================================
app.post('/api/order/printed', authMiddleware, (req, res) => {
  const { orderId, orderIds } = req.body || {};
  const targets = orderIds || (orderId ? [orderId] : []);
  if (targets.length === 0) return res.status(400).json({ error: 'Missing orderId or orderIds' });

  const db = rcReadDb();
  targets.forEach(id => { db.printed[id] = new Date().toISOString(); });
  rcWriteDb(db);

  res.json({ success: true, printed: targets.length });
});

// =========================================
// POST & GET /api/sync/api-import
// ซิงก์ออเดอร์ใหม่จากแท็บ API Import ไปยัง คำสั่งซื้อ โดยอัตโนมัติ (Deduplicated & Sorted Chronologically)
// =========================================
const { syncApiImportToOrders } = require('./api/sync/api_import');

app.all('/api/sync/api-import', async (req, res) => {
  // Allow authorized users or internal cron trigger
  if (req.method === 'POST') {
    // Check auth for manual button click
    const token = (req.headers.authorization || '').split(' ')[1];
    if (token) {
      const decoded = verifyToken(token);
      if (!decoded) return res.status(401).json({ error: 'Unauthorized: Invalid token' });
    }
  }

  try {
    const result = await syncApiImportToOrders();
    res.status(200).json(result);
  } catch (err) {
    console.error('[sync/api-import]', err.message);
    res.status(500).json({ error: 'Internal Server Error', details: err.message });
  }
});

// Auto-sync API Import every 5 minutes in background
setInterval(async () => {
  try {
    const syncRes = await syncApiImportToOrders();
    if (syncRes.importedCount > 0) {
      console.log(`[Auto-Sync Cron] ซิงก์ออเดอร์ใหม่สำเร็จ ${syncRes.importedCount} รายการ`);
    }
  } catch (err) {
    console.error('[Auto-Sync Cron Error]', err.message);
  }
}, 5 * 60 * 1000);

// Helper: อ่าน mapping ของเลขคำสั่งซื้อ -> row index บนชีต คำสั่งซื้อ
async function getOrderRowIndexMap(sheets) {
  const colFRes = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID_ORDERS,
    range: 'คำสั่งซื้อ!F1:F5000',
  });
  const colFRows = colFRes.data.values || [];
  const uidToRow = {};
  colFRows.forEach((row, idx) => {
    const uid = (row[0] || '').trim();
    if (uid && idx > 0) uidToRow[uid] = idx + 1; // 1-indexed (row 1 = header)
  });
  return uidToRow;
}

// =========================================
// POST /api/supervisor/order/update-date
// เขียนวันจัดส่งลงคอลัมน์ C (วันที่จะจัดส่ง) ของแท็บ คำสั่งซื้อ บน Google Sheets จริง
// =========================================
app.post('/api/supervisor/order/update-date', authMiddleware, async (req, res) => {
  try {
    const { orderId, orderIds, deliveryDate, reason } = req.body || {};
    const targets = orderIds || (orderId ? [orderId] : []);
    if (targets.length === 0) return res.status(400).json({ error: 'Missing orderId or orderIds' });

    const sheets = getSheetsClient();
    const uidToRow = await getOrderRowIndexMap(sheets);
    const data = [];
    let notFound = 0;

    targets.forEach(id => {
      const rowNum = uidToRow[id];
      if (rowNum) {
        data.push({
          range: `คำสั่งซื้อ!C${rowNum}`,
          values: [[deliveryDate || '']]
        });
      } else {
        notFound++;
      }
    });

    if (data.length > 0) {
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: SHEET_ID_ORDERS,
        resource: { valueInputOption: 'USER_ENTERED', data }
      });
      console.log(`[order/update-date] เขียนวันจัดส่ง ${data.length} รายการลงคอลัมน์ C บนชีต คำสั่งซื้อ จริง`);
    }

    res.json({ success: true, count: data.length, notFound, deliveryDate });
  } catch (err) {
    console.error('[order/update-date] Error:', err.message);
    res.status(500).json({ error: 'Internal Server Error', details: err.message });
  }
});

// =========================================
// POST /api/supervisor/order/archive
// เขียนสถานะพักรอลงคอลัมน์ AC (Archived) และเหตุผลลงคอลัมน์ L (หมายเหตุ) บน Google Sheets จริง
// =========================================
app.post('/api/supervisor/order/archive', authMiddleware, async (req, res) => {
  try {
    const { orderId, orderIds, archived, reason } = req.body || {};
    const targets = orderIds || (orderId ? [orderId] : []);
    if (targets.length === 0) return res.status(400).json({ error: 'Missing orderId or orderIds' });

    const isArchived = archived !== undefined ? Boolean(archived) : true;
    const sheets = getSheetsClient();
    const uidToRow = await getOrderRowIndexMap(sheets);
    // Read existing Column L values to chain notes
    const lRes = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID_ORDERS,
      range: 'คำสั่งซื้อ!L1:L3500'
    }).catch(() => ({ data: { values: [] } }));
    const lRows = lRes.data?.values || [];

    targets.forEach(id => {
      const rowNum = uidToRow[id];
      if (rowNum) {
        // คอลัมน์ AC: Archived (TRUE หรือ ค่าว่าง)
        data.push({
          range: `คำสั่งซื้อ!AC${rowNum}`,
          values: [[isArchived ? 'TRUE' : '']]
        });
        // คอลัมน์ L: หมายเหตุ (ต่อท้ายเหตุผลเดิม ไม่เขียนทับ)
        if (reason) {
          const oldNote = (lRows[rowNum - 1]?.[0] || '').trim();
          const newActionNote = isArchived ? `[พักรอ] ${reason}` : `[ปลดพักรอ] ${reason}`;
          const chainedNote = oldNote ? `${oldNote} | ${newActionNote}` : newActionNote;
          data.push({
            range: `คำสั่งซื้อ!L${rowNum}`,
            values: [[chainedNote]]
          });
        }
      } else {
        notFound++;
      }
    });

    if (data.length > 0) {
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: SHEET_ID_ORDERS,
        resource: { valueInputOption: 'USER_ENTERED', data }
      });
      console.log(`[order/archive] เขียนสถานะ Archive (${isArchived}) ${data.length / 2} รายการลงคอลัมน์ AC บนชีต คำสั่งซื้อ จริง`);
    }

    res.json({ success: true, count: targets.length, notFound, isArchived });
  } catch (err) {
    console.error('[order/archive] Error:', err.message);
    res.status(500).json({ error: 'Internal Server Error', details: err.message });
  }
});

// =========================================
// POST /api/supervisor/order/update
// เขียนอัปเดตข้อมูลลงเซลล์แคบของชีต คำสั่งซื้อ (C: วันส่ง, L: หมายเหตุ, AC: Archive) และ _ASSIGN จริง
// =========================================
app.post('/api/supervisor/order/update', authMiddleware, async (req, res) => {
  try {
    const { uid, orderId, deliveryDate, zone, driverCode, note, hold, status, isArchived, archiveReason, reason } = req.body || {};
    const targetId = uid || orderId;
    if (!targetId) return res.status(400).json({ error: 'Missing order id' });

    const sheets = getSheetsClient();
    const uidToRow = await getOrderRowIndexMap(sheets);
    const rowNum = uidToRow[targetId];
    const data = [];

    if (rowNum) {
      if (deliveryDate !== undefined) {
        data.push({ range: `คำสั่งซื้อ!C${rowNum}`, values: [[deliveryDate || '']] });
      }
      if (note !== undefined || reason !== undefined) {
        data.push({ range: `คำสั่งซื้อ!L${rowNum}`, values: [[note || reason || '']] });
      }
      if (isArchived !== undefined) {
        data.push({ range: `คำสั่งซื้อ!AC${rowNum}`, values: [[isArchived ? 'TRUE' : '']] });
      }
      if (data.length > 0) {
        await sheets.spreadsheets.values.batchUpdate({
          spreadsheetId: SHEET_ID_ORDERS,
          resource: { valueInputOption: 'USER_ENTERED', data }
        });
      }
    }

    // ถ้ามีการมอบหมายคนขับหรือเปลี่ยนสถานะ -> บันทึกลง _ASSIGN บน Sheets
    if (driverCode !== undefined || status !== undefined) {
      await ensureSheetExists(sheets, SHEET_ID_ORDERS, '_ASSIGN', [
        'order_id','assigned_driver','status','timestamp','driver_note','priority','hold','lat_lng','reason','dispatch_type'
      ]);
      await sheets.spreadsheets.values.append({
        spreadsheetId: SHEET_ID_ORDERS,
        range: '_ASSIGN!A1',
        valueInputOption: 'USER_ENTERED',
        resource: {
          values: [[
            targetId,
            driverCode || '',
            status || 'mine',
            new Date().toISOString(),
            note || '',
            'normal',
            hold ? 'TRUE' : 'FALSE',
            '',
            reason || archiveReason || 'Updated from supervisor',
            'SUPERVISOR_EDIT'
          ]]
        }
      });
    }

    res.json({ success: true, orderId: targetId });
  } catch (err) {
    console.error('[order/update] Error:', err.message);
    res.status(500).json({ error: 'Internal Server Error', details: err.message });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`Unii Mart Control Center Server is running at http://localhost:${PORT}`);
});

// =========================================
// POST /api/routecode/writeback
// เขียน routecode กลับไปที่คอลัมน์ A ของ sheet คำสั่งซื้อ
// Body: { orderIds: [...] }  — ถ้าไม่ส่งมา = เขียนทุก order ที่มี routecode
// =========================================
app.post('/api/routecode/writeback', authMiddleware, async (req, res) => {
  const isSup = ['supervisor','admin','administrator'].includes(req.user.role);
  if (!isSup) return res.status(403).json({ error: 'Forbidden' });

  try {
    const { orderIds } = req.body || {};
    const db = rcReadDb();
    const assignments = db.assignments || {};

    // กำหนดชุด orderIds ที่ต้องเขียน
    const targetIds = Array.isArray(orderIds) && orderIds.length > 0
      ? orderIds
      : Object.keys(assignments);

    if (targetIds.length === 0)
      return res.status(200).json({ success: true, updated: 0, message: 'ไม่มี routecode ที่ต้องเขียน' });

    // อ่าน column F (เลขคำสั่งซื้อ) ทั้งหมด เพื่อหาหมายเลข row
    const sheets = getSheetsClient();
    const colFRes = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID_ORDERS,
      range: 'คำสั่งซื้อ!F1:F5000',
    });
    const colFRows = colFRes.data.values || [];

    // map: uid → rowNumber (1-indexed, row 1 = header)
    const uidToRow = {};
    colFRows.forEach((row, idx) => {
      const uid = (row[0] || '').trim();
      if (uid && idx > 0) uidToRow[uid] = idx + 1;
    });

    // สร้าง batch update payload
    const data = [];
    let notFound = 0;

    for (const uid of targetIds) {
      const rc = assignments[uid];
      if (!rc || !rc.routeCode) continue;
      const rowNum = uidToRow[uid];
      if (!rowNum) { notFound++; continue; }
      data.push({ range: `คำสั่งซื้อ!A${rowNum}`, values: [[rc.routeCode]] });
    }

    if (data.length === 0)
      return res.status(200).json({ success: true, updated: 0, notFound, message: 'ไม่พบแถวที่ตรงกันในชีต' });

    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: SHEET_ID_ORDERS,
      resource: { valueInputOption: 'USER_ENTERED', data },
    });

    console.log(`[routecode/writeback] เขียน ${data.length} รหัสรูทลง col A — notFound: ${notFound}`);
    return res.status(200).json({
      success: true, updated: data.length, notFound,
      message: `เขียนรหัสรูท ${data.length} รายการลงคอลัมน์ A สำเร็จ`,
    });

  } catch (err) {
    console.error('[routecode/writeback]', err);
    return res.status(500).json({ error: 'Internal Server Error', details: err.message });
  }
});

// =========================================
// Zone Management Endpoints
// =========================================
function readZonesDb() {
  try {
    if (fs.existsSync(ZONES_DB)) {
      return JSON.parse(fs.readFileSync(ZONES_DB, 'utf8'));
    }
  } catch (e) {
    console.warn('[readZonesDb] Error reading zones:', e.message);
  }
  return {
    zones: [
      {
        id: "zone_a",
        letter: "A",
        name: "Zone A — เมืองลำพูน",
        color: "#10b981",
        driverCode: "DRV-A01",
        cardLimit: 30,
        polygon: [
          [18.48, 98.95],
          [18.66, 98.95],
          [18.66, 99.12],
          [18.48, 99.12]
        ]
      },
      {
        id: "zone_b",
        letter: "B",
        name: "Zone B — สารภี/เชียงใหม่",
        color: "#8b5cf6",
        driverCode: "DRV-B02",
        cardLimit: 30,
        polygon: [
          [18.66, 98.90],
          [18.85, 98.90],
          [18.85, 99.12],
          [18.66, 99.12]
        ]
      },
      {
        id: "zone_c",
        letter: "C",
        name: "Zone C — ป่าซาง",
        color: "#f59e0b",
        driverCode: "DRV-C03",
        cardLimit: 30,
        polygon: [
          [18.35, 98.75],
          [18.48, 98.75],
          [18.48, 98.95],
          [18.35, 98.95]
        ]
      }
    ],
    overlapZones: []
  };
}

function writeZonesDb(data) {
  try {
    fs.writeFileSync(ZONES_DB, JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch (e) {
    console.error('[writeZonesDb] Failed:', e.message);
    return false;
  }
}

// GET /api/sku-details — อ่านรายการสินค้าของแต่ละออเดอร์จาก Google Sheets SKU Detail
app.get('/api/sku-details', async (req, res) => {
  try {
    const skuMap = await fetchSkuDetailsFromSheets();
    res.json({ success: true, skuDetails: skuMap });
  } catch (err) {
    console.error('[GET /api/sku-details] Error:', err);
    res.status(500).json({ success: false, error: 'Failed to fetch SKU details' });
  }
});

// GET /api/zones — อ่านรายการโซนทั้งหมด (Public read for Driver & Supervisor)
app.get('/api/zones', (req, res) => {
  const db = readZonesDb();
  const sanitizedZones = (db.zones || []).map(z => ({
    id: z.id,
    letter: z.letter,
    name: z.name,
    color: z.color,
    polygon: z.polygon
  }));
  const sanitizedOverlaps = (db.overlapZones || []).map(oz => ({
    id: oz.id,
    letter: oz.letter,
    name: oz.name,
    color: oz.color,
    polygon: oz.polygon
  }));
  res.json({ success: true, zones: sanitizedZones, overlapZones: sanitizedOverlaps });
});

// POST /api/zones/save — บันทึกรายการโซน
app.post('/api/zones/save', authMiddleware, (req, res) => {
  const isSup = ['supervisor','admin','administrator'].includes(req.user.role);
  if (!isSup) return res.status(403).json({ error: 'Forbidden' });

  const { zones, overlapZones } = req.body || {};
  if (!Array.isArray(zones)) {
    return res.status(400).json({ error: 'Invalid zones array' });
  }

  // Normalize driverCodes on all zones
  const cleanZones = zones.map(z => {
    let driverCodes = Array.isArray(z.driverCodes) ? z.driverCodes.filter(Boolean) : (z.driverCode ? [z.driverCode] : []);
    return {
      ...z,
      driverCodes,
      driverCode: driverCodes[0] || ''
    };
  });

  const cleanOverlaps = (Array.isArray(overlapZones) ? overlapZones : []).map(oz => {
    let driverCodes = Array.isArray(oz.driverCodes) ? oz.driverCodes.filter(Boolean) : (oz.driverCode ? [oz.driverCode] : []);
    return {
      ...oz,
      driverCodes,
      driverCode: driverCodes[0] || ''
    };
  });

  const payload = {
    zones: cleanZones,
    overlapZones: cleanOverlaps
  };

  const ok = writeZonesDb(payload);
  if (!ok) return res.status(500).json({ error: 'Failed to write zones data' });

  // Sync to local_drivers.json bidirectionally
  try {
    const allDrivers = readDriversDb();
    const allZonesList = [...cleanZones, ...cleanOverlaps];
    let driversChanged = false;

    allDrivers.forEach(drv => {
      const assignedZoneNames = allZonesList
        .filter(z => (z.driverCodes || []).includes(drv.code) || z.driverCode === drv.code)
        .map(z => z.name || `Zone ${z.letter || z.letters}`);
      
      const newZones = Array.from(new Set(assignedZoneNames));
      if (JSON.stringify(drv.zones || []) !== JSON.stringify(newZones)) {
        drv.zones = newZones;
        drv.zone = newZones[0] || drv.zone || 'Zone A';
        drv.updatedAt = new Date().toISOString();
        driversChanged = true;
      }
    });

    if (driversChanged) {
      writeDriversDb(allDrivers);
      console.log('[zones/save] Synced driver zones in local_drivers.json');
    }
  } catch (e) {
    console.warn('[zones/save] Error syncing drivers:', e.message);
  }

  console.log(`[zones/save] Saved ${cleanZones.length} zones and ${cleanOverlaps.length} overlap zones`);
  res.json({ success: true, message: 'บันทึกโซนสำเร็จ', data: payload });
});

// GET /api/zones/orders-heatmap — ดึงพิกัดออเดอร์สำหรับแสดงจุดจางๆ ใต้แผนที่
app.get('/api/zones/orders-heatmap', authMiddleware, async (req, res) => {
  try {
    const sheets = getSheetsClient();
    const orderRows = await getSheetRows(sheets, SHEET_ID_ORDERS, 'คำสั่งซื้อ!A1:AD5000').catch(() => []);
    
    const points = [];
    for (const r of orderRows) {
      const lat = parseFloat(r['CS_Lat'] || '');
      const lng = parseFloat(r['CS_Long'] || '');
      if (lat && lng && !isNaN(lat) && !isNaN(lng)) {
        points.push({
          uid: (r['เลขคำสั่งซื้อ'] || '').trim(),
          name: (r['ชื่อลูกค้า'] || '').trim(),
          address: (r['ที่อยู่'] || '').trim(),
          lat: parseFloat(lat.toFixed(5)),
          lng: parseFloat(lng.toFixed(5)),
          date: (r['วันที่จะจัดส่ง'] || r['วันเวลาที่สั่ง'] || '').trim()
        });
      }
    }

    res.json({ success: true, count: points.length, points });
  } catch (err) {
    console.error('[zones/orders-heatmap]', err);
    res.status(500).json({ error: 'Internal Server Error', details: err.message });
  }
});

// =========================================
// Driver Management Endpoints
// =========================================

// GET /api/drivers/public — ข้อมูลคนขับสาธารณะสำหรับหน้าคนขับ (ตัด PIN และเบอร์โทรออก 100%)
app.get('/api/drivers/public', (req, res) => {
  try {
    const drivers = readDriversDb();
    const sanitized = (drivers || []).map(d => ({
      id: d.id || d.code,
      code: d.code,
      name: d.name,
      avatar: d.avatar || d.code.replace('DRV-', ''),
      color: d.color || 'var(--st-available)',
      zone: d.zone,
      zones: d.zones || [d.zone],
      isSpecial: !!d.isSpecial,
      status: d.status || 'active'
    }));
    res.json({ success: true, drivers: sanitized });
  } catch (err) {
    console.error('[GET /api/drivers/public]', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// GET /api/drivers — รายชื่อคนขับทั้งหมด + ค่าเฉลี่ยงาน 30 วัน (เฉพาะ Supervisor มีสิทธิ์เข้าถึง)
app.get('/api/drivers', authMiddleware, async (req, res) => {
  const isSup = ['supervisor','admin','administrator'].includes(req.user.role);
  if (!isSup) return res.status(403).json({ error: 'Forbidden' });

  try {
    const drivers = readDriversDb();

    // คำนวณงานเฉลี่ยต่อวันจากประวัติ 30 วันใน _ASSIGN
    const sheets = getSheetsClient();
    const assignRows = await getSheetRows(sheets, SHEET_ID_ORDERS, '_ASSIGN!A1:I5000').catch(() => []);

    // นับงาน completed ต่อ driver ในรอบ 30 วัน
    const driverJobCounts = {};
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    for (const r of assignRows) {
      if (r.status === 'done' && r.assigned_driver) {
        const completedDate = r.completed_at ? new Date(r.completed_at) : null;
        if (!completedDate || completedDate >= thirtyDaysAgo) {
          driverJobCounts[r.assigned_driver] = (driverJobCounts[r.assigned_driver] || 0) + 1;
        }
      }
    }

    const enhanced = drivers.map(d => {
      const totalJobs30d = driverJobCounts[d.code] || 0;
      const avgPerDay = (totalJobs30d / 30).toFixed(1);
      return {
        ...d,
        avgJobsPerDay: parseFloat(avgPerDay) || (d.status === 'active' ? 14.5 : 0),
        totalCompleted30d: totalJobs30d
      };
    });

    res.json({ success: true, drivers: enhanced });
  } catch (err) {
    console.error('[GET /api/drivers]', err);
    res.status(500).json({ error: 'Internal Server Error', details: err.message });
  }
});

// POST /api/drivers/create — เพิ่มคนขับใหม่
app.post('/api/drivers/create', authMiddleware, (req, res) => {
  const isSup = ['supervisor','admin','administrator'].includes(req.user.role);
  if (!isSup) return res.status(403).json({ error: 'Forbidden' });

  const { name, phone, zones, color, pin } = req.body || {};
  if (!name) return res.status(400).json({ error: 'กรุณาระบุชื่อคนขับ' });

  const drivers = readDriversDb();

  // สร้าง Driver Code ต่อไป เช่น DRV-A05, DRV-D01 หรือ DRV-005
  const count = drivers.length + 1;
  const zoneLetter = (Array.isArray(zones) && zones[0]) ? (zones[0].match(/Zone ([A-Z])/i)?.[1] || 'D') : 'D';
  const newCode = `DRV-${zoneLetter}${String(count).padStart(2, '0')}`;

  const newDriver = {
    id: newCode,
    code: newCode,
    name: name.trim(),
    phone: phone ? phone.trim() : '',
    zones: Array.isArray(zones) && zones.length > 0 ? zones : ['Zone A — เมืองลำพูน'],
    zone: Array.isArray(zones) && zones[0] ? zones[0] : 'Zone A — เมืองลำพูน',
    color: color || '#10b981',
    avatar: `${zoneLetter}${String(count).padStart(2, '0')}`,
    pin: pin ? String(pin).trim() : String(Math.floor(1000 + Math.random() * 9000)),
    status: 'active',
    createdAt: new Date().toISOString()
  };

  drivers.push(newDriver);
  writeDriversDb(drivers);

  console.log(`[drivers/create] Added driver ${newCode} (${newDriver.name})`);
  res.json({ success: true, message: 'เพิ่มคนขับสำเร็จ', driver: newDriver });
});

// POST /api/drivers/update — แก้ไขข้อมูลคนขับ
app.post('/api/drivers/update', authMiddleware, (req, res) => {
  const isSup = ['supervisor','admin','administrator'].includes(req.user.role);
  if (!isSup) return res.status(403).json({ error: 'Forbidden' });

  const { code, name, phone, zones, color, pin, status } = req.body || {};
  if (!code) return res.status(400).json({ error: 'Missing driver code' });

  const drivers = readDriversDb();
  const idx = drivers.findIndex(d => d.code === code || d.id === code);
  if (idx === -1) return res.status(404).json({ error: 'ไม่พบคนขับ' });

  if (name) drivers[idx].name = name.trim();
  if (phone !== undefined) drivers[idx].phone = phone ? phone.trim() : '';
  if (Array.isArray(zones)) {
    drivers[idx].zones = zones;
    if (zones.length > 0) drivers[idx].zone = zones[0];
  }
  if (color) drivers[idx].color = color;
  if (pin) drivers[idx].pin = String(pin).trim();
  if (status) drivers[idx].status = status;
  drivers[idx].updatedAt = new Date().toISOString();

  writeDriversDb(drivers);
  res.json({ success: true, message: 'แก้ไขข้อมูลคนขับสำเร็จ', driver: drivers[idx] });
});

// POST /api/drivers/reset-pin — รีเซ็ต PIN
app.post('/api/drivers/reset-pin', authMiddleware, (req, res) => {
  const isSup = ['supervisor','admin','administrator'].includes(req.user.role);
  if (!isSup) return res.status(403).json({ error: 'Forbidden' });

  const { code, pin } = req.body || {};
  if (!code || !pin) return res.status(400).json({ error: 'Missing code or pin' });

  const drivers = readDriversDb();
  const found = drivers.find(d => d.code === code || d.id === code);
  if (!found) return res.status(404).json({ error: 'ไม่พบคนขับ' });

  found.pin = String(pin).trim();
  found.updatedAt = new Date().toISOString();
  writeDriversDb(drivers);

  res.json({ success: true, message: `รีเซ็ต PIN สำหรับ ${found.name} เป็น ${found.pin} สำเร็จ` });
});

// GET /api/drivers/pending-check — เช็คงานค้างวันนี้ก่อนปิดใช้งาน
app.get('/api/drivers/pending-check', authMiddleware, async (req, res) => {
  try {
    const { driverCode } = req.query;
    if (!driverCode) return res.status(400).json({ error: 'Missing driverCode' });

    const assignmentMap = await assignReadMap();
    const pendingOrders = [];

    for (const [orderId, record] of Object.entries(assignmentMap)) {
      if (record.assigned_driver === driverCode && record.status === 'mine') {
        pendingOrders.push(orderId);
      }
    }

    res.json({ success: true, count: pendingOrders.length, orderIds: pendingOrders });
  } catch (err) {
    console.error('[drivers/pending-check]', err);
    res.status(500).json({ error: 'Internal Server Error', details: err.message });
  }
});

// POST /api/drivers/toggle-status — สลับสถานะ เปิด/ปิด ใช้งาน
app.post('/api/drivers/toggle-status', authMiddleware, async (req, res) => {
  const isSup = ['supervisor','admin','administrator'].includes(req.user.role);
  if (!isSup) return res.status(403).json({ error: 'Forbidden' });

  try {
    const { code, status } = req.body || {};
    if (!code || !status) return res.status(400).json({ error: 'Missing code or status' });

    const drivers = readDriversDb();
    const found = drivers.find(d => d.code === code || d.id === code);
    if (!found) return res.status(404).json({ error: 'ไม่พบคนขับ' });

    found.status = status;
    found.updatedAt = new Date().toISOString();

    let releasedCount = 0;
    // ถ้าปิดใช้งาน ให้ปล่อยงานที่จองไว้คืนสู่รายการต้องเคลียร์
    if (status === 'inactive') {
      const assignmentMap = await assignReadMap();
      const updates = [];

      for (const [orderId, record] of Object.entries(assignmentMap)) {
        if (record.assigned_driver === code && record.status === 'mine') {
          updates.push({
            order_id: orderId,
            status: 'released',
            assigned_driver: '',
            completed_at: '',
            lat: record.lat || '',
            lng: record.lng || '',
            driver_note: `ระบบปล่อยงานเนื่องจากปิดใช้งานคนขับ ${found.name}`,
            priority: record.priority || '',
            hold: record.hold || ''
          });
          releasedCount++;
        }
      }

      if (updates.length > 0) {
        await assignAppend(updates);
        console.log(`[drivers/toggle-status] Released ${releasedCount} orders for inactive driver ${code}`);
      }
    }

    writeDriversDb(drivers);
    res.json({
      success: true,
      status: found.status,
      releasedCount,
      message: status === 'active' ? `เปิดใช้งานคนขับ ${found.name} แล้ว` : `ปิดใช้งานคนขับ ${found.name} เรียบร้อยแล้ว (ปล่อยงานค้าง ${releasedCount} จุด)`
    });
  } catch (err) {
    console.error('[drivers/toggle-status]', err);
    res.status(500).json({ error: 'Internal Server Error', details: err.message });
  }
});

// =========================================
// Weekly Roster & Schedule (_SCHEDULE)
// =========================================

const SCHEDULE_DB = path.join(__dirname, 'local_schedule.json');
const SCHEDULE_HEADERS = ['driver_id', 'date', 'status', 'note', 'updated_by', 'updated_at'];

function readScheduleDb() {
  try {
    if (fs.existsSync(SCHEDULE_DB)) {
      const data = JSON.parse(fs.readFileSync(SCHEDULE_DB, 'utf8'));
      if (Array.isArray(data.schedule)) return data.schedule;
    }
  } catch (e) {
    console.warn('[readScheduleDb] Warning:', e.message);
  }
  return [];
}

function writeScheduleDb(list) {
  try {
    fs.writeFileSync(SCHEDULE_DB, JSON.stringify({ schedule: list }, null, 2), 'utf8');
    return true;
  } catch (e) {
    console.error('[writeScheduleDb] Failed:', e.message);
    return false;
  }
}

async function syncScheduleToSheets(item) {
  try {
    const sheets = getSheetsClient();
    await ensureSheetExists(sheets, SHEET_ID_ORDERS, '_SCHEDULE', SCHEDULE_HEADERS);

    // Read existing rows
    const rows = await getSheetRows(sheets, SHEET_ID_ORDERS, '_SCHEDULE!A1:F5000').catch(() => []);
    const rowIndex = rows.findIndex(r => r.driver_id === item.driver_id && r.date === item.date);

    const values = [[
      item.driver_id,
      item.date,
      item.status || 'working',
      item.note || '',
      item.updated_by || 'supervisor',
      item.updated_at || new Date().toISOString()
    ]];

    if (rowIndex !== -1) {
      // Row 1 is header, so row in sheets is rowIndex + 2
      const targetRow = rowIndex + 2;
      await sheets.spreadsheets.values.update({
        spreadsheetId: SHEET_ID_ORDERS,
        range: `_SCHEDULE!A${targetRow}:F${targetRow}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values }
      });
    } else {
      await sheets.spreadsheets.values.append({
        spreadsheetId: SHEET_ID_ORDERS,
        range: '_SCHEDULE!A1',
        valueInputOption: 'USER_ENTERED',
        requestBody: { values }
      });
    }
  } catch (err) {
    console.warn('[syncScheduleToSheets] Warning sync to sheets:', err.message);
  }
}

// GET /api/schedule — ดึงตารางงานตามช่วงวันที่
app.get('/api/schedule', authMiddleware, async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    let list = readScheduleDb();

    // กรองตามช่วงวันที่หากระบุ
    if (startDate && endDate) {
      list = list.filter(s => s.date >= startDate && s.date <= endDate);
    }

    res.json({ success: true, schedule: list });
  } catch (err) {
    console.error('[GET /api/schedule]', err);
    res.status(500).json({ error: 'Internal Server Error', details: err.message });
  }
});

// POST /api/schedule/update — อัปเดตสถานะตารางงาน (ทำงาน / หยุด / ลา)
app.post('/api/schedule/update', authMiddleware, async (req, res) => {
  const isSup = ['supervisor','admin','administrator'].includes(req.user.role);
  if (!isSup) return res.status(403).json({ error: 'Forbidden' });

  try {
    const { driverId, date, status, note } = req.body || {};
    if (!driverId || !date) {
      return res.status(400).json({ error: 'Missing driverId or date' });
    }

    const validStatus = ['working', 'off', 'leave'].includes(status) ? status : 'working';
    const scheduleList = readScheduleDb();

    const idx = scheduleList.findIndex(s => s.driver_id === driverId && s.date === date);
    const updatedRecord = {
      driver_id: driverId,
      date,
      status: validStatus,
      note: note ? note.trim() : '',
      updated_by: req.user.username || 'admin',
      updated_at: new Date().toISOString()
    };

    if (idx !== -1) {
      scheduleList[idx] = updatedRecord;
    } else {
      scheduleList.push(updatedRecord);
    }

    writeScheduleDb(scheduleList);

    // Sync to Sheets in background
    syncScheduleToSheets(updatedRecord).catch(e => console.warn('[Schedule Sync Sheet]', e.message));

    res.json({ success: true, item: updatedRecord, message: 'อัปเดตตารางงานสำเร็จ' });
  } catch (err) {
    console.error('[POST /api/schedule/update]', err);
    res.status(500).json({ error: 'Internal Server Error', details: err.message });
  }
});

// =========================================
// Store Registry & Requirements (_STORE_REQ)
// =========================================

const STORES_DB = path.join(__dirname, 'local_stores.json');
const STORE_REQ_HEADERS = [
  'phone', 'name', 'open_time', 'close_time', 'break_time', 'closed_days',
  'narrow_alley', 'parking_spot', 'entrance', 'stairs',
  'call_before_minutes', 'signee', 'backup_phone', 'payment_type',
  'tax_invoices_count', 'check_day', 'heavy_help', 'custom_notes',
  'updated_by', 'updated_at'
];

function readStoresDb() {
  try {
    if (fs.existsSync(STORES_DB)) {
      const data = JSON.parse(fs.readFileSync(STORES_DB, 'utf8'));
      if (data && typeof data.stores === 'object') return data.stores;
    }
  } catch (e) {
    console.warn('[readStoresDb] Warning:', e.message);
  }
  return {};
}

function writeStoresDb(storesData) {
  try {
    fs.writeFileSync(STORES_DB, JSON.stringify({ stores: storesData }, null, 2), 'utf8');
    return true;
  } catch (e) {
    console.error('[writeStoresDb] Failed:', e.message);
    return false;
  }
}

async function syncStoreReqToSheets(storeReq) {
  try {
    const sheets = getSheetsClient();
    await ensureSheetExists(sheets, SHEET_ID_ORDERS, '_STORE_REQ', STORE_REQ_HEADERS);

    const rows = await getSheetRows(sheets, SHEET_ID_ORDERS, '_STORE_REQ!A1:T5000').catch(() => []);
    const rowIndex = rows.findIndex(r => r.phone === storeReq.phone);

    const values = [[
      storeReq.phone || '',
      storeReq.name || '',
      storeReq.openTime || '',
      storeReq.closeTime || '',
      storeReq.breakTime || '',
      Array.isArray(storeReq.closedDays) ? storeReq.closedDays.join(',') : (storeReq.closedDays || ''),
      storeReq.narrowAlley ? 'TRUE' : 'FALSE',
      storeReq.parkingSpot || '',
      storeReq.entrance || '',
      storeReq.stairs ? 'TRUE' : 'FALSE',
      storeReq.callBeforeMinutes || '',
      storeReq.signee || '',
      storeReq.backupPhone || '',
      storeReq.paymentType || '',
      storeReq.taxInvoicesCount || '',
      storeReq.checkCollectionDay || '',
      storeReq.heavyHelpNeeded ? 'TRUE' : 'FALSE',
      storeReq.customNotes || '',
      storeReq.updatedBy || 'supervisor',
      storeReq.updatedAt || new Date().toISOString()
    ]];

    if (rowIndex !== -1) {
      const targetRow = rowIndex + 2;
      await sheets.spreadsheets.values.update({
        spreadsheetId: SHEET_ID_ORDERS,
        range: `_STORE_REQ!A${targetRow}:T${targetRow}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values }
      });
    } else {
      await sheets.spreadsheets.values.append({
        spreadsheetId: SHEET_ID_ORDERS,
        range: '_STORE_REQ!A1',
        valueInputOption: 'USER_ENTERED',
        requestBody: { values }
      });
    }
  } catch (err) {
    console.warn('[syncStoreReqToSheets] Warning sync to sheets:', err.message);
  }
}

// In-memory cache for aggregated stores
let _cachedStoresList = null;
let _cachedStoresTimestamp = 0;

// GET /api/stores — รายการร้านค้าทั้งหมด + สถานะข้อกำหนด
app.get('/api/stores', authMiddleware, async (req, res) => {
  try {
    const now = Date.now();
    const reqDb = readStoresDb();

    // Cache aggregation for 60 seconds unless ?force=true
    if (!_cachedStoresList || (now - _cachedStoresTimestamp > 60000) || req.query.force === 'true') {
      const sheets = getSheetsClient();
      const orderRows = await getSheetRows(sheets, SHEET_ID_ORDERS, 'คำสั่งซื้อ!A1:AD5000').catch(() => []);

      const storesMap = {};
      for (const r of orderRows) {
        const rawPhone = r['Phone'] || r['เบอร์โทร'] || r['เบอร์โทรศัพท์'] || '';
        const phone = normalizePhone(rawPhone);
        if (!phone || phone.length < 9) continue;

        const name = (r['ชื่อลูกค้า'] || r['ชื่อผู้รับ'] || '').trim();
        const lat = parseFloat(r['CS_Lat'] || '');
        const lng = parseFloat(r['CS_Long'] || '');
        const address = (r['ที่อยู่'] || '').trim();
        const date = (r['วันที่จะจัดส่ง'] || r['วันเวลาที่สั่ง'] || '').trim();
        const uid = (r['เลขคำสั่งซื้อ'] || '').trim();
        const totalSales = (r['ยอดขายรวม'] || '').trim();
        const status = (r['Status'] || '').trim();

        if (!storesMap[phone]) {
          storesMap[phone] = {
            phone,
            rawPhone,
            name: name || 'ร้านค้า',
            lat: isNaN(lat) ? null : lat,
            lng: isNaN(lng) ? null : lng,
            address: address || '',
            orderCount: 0,
            lastOrderDate: date,
            orders: []
          };
        }

        storesMap[phone].orderCount++;
        if (name && (!storesMap[phone].name || storesMap[phone].name === 'ร้านค้า')) {
          storesMap[phone].name = name;
        }
        if (lat && !storesMap[phone].lat) storesMap[phone].lat = lat;
        if (lng && !storesMap[phone].lng) storesMap[phone].lng = lng;
        const currentKey = rcParseDate(date) ? `${rcParseDate(date).dateKey} ${date.includes(':') ? date.split(' ')[1] || '' : ''}` : '';
        const existingKey = storesMap[phone].lastOrderDate && rcParseDate(storesMap[phone].lastOrderDate)
          ? `${rcParseDate(storesMap[phone].lastOrderDate).dateKey} ${storesMap[phone].lastOrderDate.includes(':') ? storesMap[phone].lastOrderDate.split(' ')[1] || '' : ''}`
          : '';

        if (currentKey && (!existingKey || currentKey > existingKey)) {
          storesMap[phone].lastOrderDate = date;
        }

        if (storesMap[phone].orders.length < 10) {
          storesMap[phone].orders.push({ uid, date, totalSales, status });
        }
      }

      _cachedStoresList = Object.values(storesMap);
      _cachedStoresTimestamp = now;
    }

    // Merge with requirements data and compute chips
    const enhanced = _cachedStoresList.map(store => {
      const reqData = reqDb[store.phone] || {};
      const zone = (store.lat && store.lng) ? classifyOrderZone(store.lat, store.lng) : 'UNASSIGNED';

      // Check completeness
      const hasReq = !!(
        reqData.openTime ||
        reqData.closeTime ||
        reqData.callBeforeMinutes ||
        reqData.narrowAlley ||
        reqData.customNotes ||
        (Array.isArray(reqData.closedDays) && reqData.closedDays.length > 0)
      );

      // Generate preview chips
      const chips = [];
      if (reqData.callBeforeMinutes) chips.push(`โทรก่อน ${reqData.callBeforeMinutes} น.`);
      if (reqData.openTime && reqData.closeTime) chips.push(`เปิด ${reqData.openTime}-${reqData.closeTime}`);
      if (reqData.breakTime) chips.push(`พัก ${reqData.breakTime}`);
      if (reqData.narrowAlley) chips.push('ซอยแคบ');
      if (reqData.stairs) chips.push('ขึ้นบันได');
      if (reqData.heavyHelpNeeded) chips.push('ต้องช่วยยก');

      return {
        ...store,
        zone,
        requirements: reqData,
        hasRequirements: hasReq,
        chips: chips.slice(0, 3)
      };
    });

    res.json({
      success: true,
      count: enhanced.length,
      completeCount: enhanced.filter(s => s.hasRequirements).length,
      incompleteCount: enhanced.filter(s => !s.hasRequirements).length,
      stores: enhanced
    });
  } catch (err) {
    console.error('[GET /api/stores]', err);
    res.status(500).json({ error: 'Internal Server Error', details: err.message });
  }
});

// GET /api/stores/:phone — ข้อมูลร้านค้ารายละเอียด + ประวัติ
app.get('/api/stores/:phone', authMiddleware, (req, res) => {
  try {
    const phone = normalizePhone(req.params.phone);
    const reqDb = readStoresDb();
    const reqData = reqDb[phone] || {};

    const store = (_cachedStoresList || []).find(s => s.phone === phone) || {
      phone,
      name: reqData.name || 'ร้านค้า',
      address: '',
      orderCount: 0,
      orders: []
    };

    const zone = (store.lat && store.lng) ? classifyOrderZone(store.lat, store.lng) : 'UNASSIGNED';

    res.json({
      success: true,
      store: {
        ...store,
        zone,
        requirements: reqData
      }
    });
  } catch (err) {
    console.error('[GET /api/stores/:phone]', err);
    res.status(500).json({ error: 'Internal Server Error', details: err.message });
  }
});

// POST /api/stores/save — บันทึกข้อกำหนดร้านค้า
app.post('/api/stores/save', authMiddleware, async (req, res) => {
  const isSup = ['supervisor','admin','administrator'].includes(req.user.role);
  if (!isSup) return res.status(403).json({ error: 'Forbidden' });

  try {
    const body = req.body || {};
    const phone = normalizePhone(body.phone);
    if (!phone) return res.status(400).json({ error: 'Missing store phone number' });

    const reqDb = readStoresDb();
    const existing = reqDb[phone] || {};

    const updated = {
      phone,
      name: (body.name || existing.name || '').trim(),
      openTime: body.openTime || '',
      closeTime: body.closeTime || '',
      breakTime: body.breakTime || '',
      closedDays: Array.isArray(body.closedDays) ? body.closedDays : (body.closedDays ? [body.closedDays] : []),
      narrowAlley: !!body.narrowAlley,
      parkingSpot: (body.parkingSpot || '').trim(),
      entrance: (body.entrance || '').trim(),
      stairs: !!body.stairs,
      callBeforeMinutes: parseInt(body.callBeforeMinutes, 10) || 0,
      signee: (body.signee || '').trim(),
      backupPhone: (body.backupPhone || '').trim(),
      paymentType: body.paymentType || 'สดเท่านั้น',
      taxInvoicesCount: parseInt(body.taxInvoicesCount, 10) || 1,
      checkCollectionDay: (body.checkCollectionDay || '').trim(),
      heavyHelpNeeded: !!body.heavyHelpNeeded,
      customNotes: (body.customNotes || '').trim(),
      updatedAt: new Date().toISOString(),
      updatedBy: req.user.username || 'admin'
    };

    reqDb[phone] = updated;
    writeStoresDb(reqDb);

    // Sync to Sheets in background
    syncStoreReqToSheets(updated).catch(e => console.warn('[StoreReq Sync Sheet]', e.message));

    console.log(`[stores/save] Saved requirements for store ${phone} (${updated.name})`);
    res.json({ success: true, message: 'บันทึกข้อมูลร้านค้าสำเร็จ', store: updated });
  } catch (err) {
    console.error('[POST /api/stores/save]', err);
    res.status(500).json({ error: 'Internal Server Error', details: err.message });
  }
});
