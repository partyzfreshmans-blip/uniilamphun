/**
 * api/supervisor/day.js
 * ======================
 * GET /api/supervisor/day?date=YYYY-MM-DD|DD-MM-YYYY|all
 *
 * แหล่งข้อมูล (เปลี่ยนจาก API Import → คำสั่งซื้อ โดยตรง):
 *   - คำสั่งซื้อ (GID 0)  → หลัก (ข้อมูลทุกอย่าง รวม lat/lng จาก CS_Lat/CS_Long)
 *   - CS Master           → พิกัดที่ยืนยันแล้ว (override ถ้ามี)
 *   - _ASSIGN             → สถานะการจอง/ปิดงาน
 *   - local_stores.json   → ข้อกำหนดร้านค้า (Store Requirements & Chips)
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { verifyToken }                                       = require('../lib/jwt');
const { getSheetsClient, getSheetRows, ensureSheetExists }  = require('../lib/sheets');
const { classifyOrderZone }                                 = require('../lib/zones');
const { normalizePhone, splitByDeliveryDate }               = require('../lib/orders');
const { getDriverProfile }                                 = require('../lib/drivers');

const SHEET_ID_ORDERS = (process.env.SHEET_ID_ORDERS && process.env.SHEET_ID_ORDERS.length > 20 && !process.env.SHEET_ID_ORDERS.includes('BEWpjZ'))
  ? process.env.SHEET_ID_ORDERS
  : '1m1Cb_BEwPjqF3CgXNssGgjyewIgPNw_BU4EkduuV59U';
const INACTIVE = new Set(['ยกเลิก','ส่งสำเร็จ','ได้รับแล้ว','cancelled','delivered','received']);
const STORES_DB_PATH = path.join(__dirname, '../../local_stores.json');
const OVERRIDES_DB_PATH = path.join(__dirname, '../../local_order_overrides.json');

function readStoresDb() {
  try {
    if (fs.existsSync(STORES_DB_PATH)) {
      return JSON.parse(fs.readFileSync(STORES_DB_PATH, 'utf8'));
    }
  } catch (e) {
    console.warn('[readStoresDb] Error:', e.message);
  }
  return {};
}

function readOrderOverrides() {
  try {
    if (fs.existsSync(OVERRIDES_DB_PATH)) {
      return JSON.parse(fs.readFileSync(OVERRIDES_DB_PATH, 'utf8'));
    }
  } catch (e) {
    console.warn('[readOrderOverrides] Error:', e.message);
  }
  return {};
}

function writeOrderOverrides(data) {
  try {
    fs.writeFileSync(OVERRIDES_DB_PATH, JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {
    console.error('[writeOrderOverrides] Error:', e.message);
  }
}

async function fetchUnifiedOrdersFromSheets({ date, role, username } = {}) {
  const sheets = getSheetsClient();

  await ensureSheetExists(sheets, SHEET_ID_ORDERS, '_ASSIGN', [
    'order_id','status','assigned_driver','completed_at','lat','lng','driver_note','priority','hold'
  ]);

  const [orderRows, csMasterRows, assignments] = await Promise.all([
    getSheetRows(sheets, SHEET_ID_ORDERS, 'คำสั่งซื้อ!A1:AD5000')
      .catch(e => { console.warn('[fetchUnifiedOrders] คำสั่งซื้อ:', e.message); return []; }),
    getSheetRows(sheets, SHEET_ID_ORDERS, 'CS Master!A1:ZZ5000')
      .catch(e => { console.warn('[fetchUnifiedOrders] CS Master:', e.message); return []; }),
    getSheetRows(sheets, SHEET_ID_ORDERS, '_ASSIGN!A1:I5000')
      .catch(() => []),
  ]);

  const storesDb = readStoresDb();
  const orderOverrides = readOrderOverrides();

  // Build CS Master phone lookup
  const csMasterPhoneMap = {};
  for (const row of csMasterRows) {
    const rawPhone = (row['เบอร์โทร'] || row['Phone'] || row['phone'] || row['เบอร์'] || '').trim();
    const normalized = normalizePhone(rawPhone);
    if (normalized) csMasterPhoneMap[normalized] = row;
  }

  // Build assignment map (last-wins per order_id)
  const assignmentMap = {};
  assignments.forEach(row => { if (row.order_id) assignmentMap[row.order_id] = row; });

  const driverProfile = (role === 'driver' && username) ? getDriverProfile(username) : null;
  const assignedZones = driverProfile
    ? (driverProfile.assignedZones || driverProfile.zones || [driverProfile.zone])
    : [];

  // Map คำสั่งซื้อ rows
  const allOrders = orderRows
    .filter(row => {
      const uid = (row['เลขคำสั่งซื้อ'] || '').trim();
      return !!uid;
    })
    .map(row => {
      const uid       = (row['เลขคำสั่งซื้อ'] || '').trim();
      const ovr       = orderOverrides[uid] || {};
      const apiStatus = (row['Status'] || '').trim();
      const rawPhone  = (row['Phone'] || '').trim();
      const normalizedPhone = normalizePhone(rawPhone);

      let lat         = parseFloat(row['CS_Lat'] || '') || 0;
      let lng         = parseFloat(row['CS_Long'] || '') || 0;
      let coordSource = lat && lng ? 'cs_master' : 'unknown';
      let isPinModified = false;
      let inCsMaster    = false;

      const csRow = normalizedPhone ? csMasterPhoneMap[normalizedPhone] : null;
      if (csRow) {
        inCsMaster = true;
        const csLat = parseFloat(csRow['ละ'] || csRow['Lat'] || csRow['lat'] || '');
        const csLng = parseFloat(csRow['ลอง'] || csRow['Lng'] || csRow['lng'] || '');
        if (!isNaN(csLat) && !isNaN(csLng) && csLat !== 0 && csLng !== 0) {
          lat = csLat; lng = csLng;
          coordSource = 'cs_master';
          isPinModified = true;
        }
      }

      // Check Archive status directly from Google Sheet Column AC (Archived)
      const rawArchived = (row['Archived'] || '').trim().toLowerCase();
      const isArchived = rawArchived === 'true' || rawArchived === 'ใช่' || rawArchived === 'yes' || Boolean(ovr.is_archived);
      const archiveReason = (row['หมายเหตุ'] || '').includes('[พักรอ]')
        ? (row['หมายเหตุ'] || '').split('[พักรอ]')[1].trim()
        : (ovr.archive_reason || '');
      const archivedAt = ovr.archived_at || '';

      // Delivery Date directly from Google Sheet Column C (วันที่จะจัดส่ง)
      const deliveryDate   = (row['วันที่จะจัดส่ง'] || ovr.delivery_date || '').trim();
      const price          = parseFloat((row['ยอดขายรวม'] || '').replace(/,/g, '')) || 0;
      const paymentType    = (row['การจ่ายเงิน'] || '').trim();
      const cod            = paymentType.toLowerCase().includes('cash on delivery') ||
                             paymentType.toLowerCase().includes('cod');

      const geojsonZone    = ovr.zone_override || classifyOrderZone(lat, lng);

      const override = assignmentMap[uid];
      let status = 'available', assignedDriverId = '', driverNote = '';
      let priority = 'normal', hold = false;

      // Status from Sheets
      if (apiStatus === 'ได้รับแล้ว' || apiStatus === 'ส่งสำเร็จ' || apiStatus === 'delivered' || apiStatus === 'received') {
        status = 'done';
      } else if (apiStatus === 'ยกเลิก' || apiStatus === 'cancelled') {
        status = 'failed';
      }

      if (override) {
        assignedDriverId = override.assigned_driver || '';
        driverNote       = override.driver_note || '';
        priority         = override.priority || 'normal';
        hold             = override.hold === 'TRUE';

        if (override.status === 'done' || override.status === 'failed') {
          status = override.status;
        } else if (override.status === 'mine') {
          if (role === 'driver' && driverProfile) {
            status = override.assigned_driver === driverProfile.code ? 'mine' : 'other_mine';
          } else {
            status = 'mine';
          }
        } else if (override.status === 'released') {
          status = 'available';
          assignedDriverId = '';
        }
      }

      if (role === 'driver' && driverProfile && status === 'available') {
        const isMyZone = driverProfile.isSpecial || assignedZones.includes(geojsonZone) || geojsonZone === driverProfile.zone;
        if (!isMyZone) {
          status = 'out';
        }
      }

      // Store requirements & chips
      const phoneKey = normalizedPhone || rawPhone;
      const storeReq = (phoneKey && storesDb[phoneKey]) ? storesDb[phoneKey] : null;
      const storeChips = [];
      if (storeReq) {
        if (storeReq.callBeforeMinutes) storeChips.push(`โทรก่อน ${storeReq.callBeforeMinutes} น.`);
        if (storeReq.openTime && storeReq.closeTime) storeChips.push(`เปิด ${storeReq.openTime}-${storeReq.closeTime}`);
        if (storeReq.breakTime) storeChips.push(`พัก ${storeReq.breakTime}`);
        if (storeReq.narrowAlley) storeChips.push('ซอยแคบ');
        if (storeReq.heavyHelpNeeded) storeChips.push('ต้องช่วยยก');
        if (storeReq.stairs) storeChips.push('ขึ้นบันได');
      }

      return {
        id: uid, uid,
        customer:     (row['ชื่อลูกค้า'] || '').trim(),
        phone:        normalizedPhone || rawPhone,
        address:      (row['ที่อยู่'] || '').trim(),
        district:     (row['อำเภอ, จังหวัด'] || '').trim(),
        lat:          parseFloat((lat || 0).toFixed(5)),
        lng:          parseFloat((lng || 0).toFixed(5)),
        isPinModified, coordSource, inCsMaster,
        geojsonZone,
        price, cod, paymentType,
        deliveryDate, timeWindow: deliveryDate, noDeliveryDate: !deliveryDate,
        isArchived, archiveReason, archivedAt,
        orderPlacedAt:  (row['วันเวลาที่สั่ง'] || row['วันที่สั่ง'] || '').trim(),
        syncDeliveryAt: (row['วันที่จัดส่ง']   || '').trim(),
        deliveredAt:    (row['วันที่ส่งสำเร็จ'] || '').trim(),
        updatedAt:      (row['วันที่อัปเดต']    || '').trim(),
        status, apiStatus, rawStatus: apiStatus,
        assignedDriverId, driverNote, priority, hold,
        picker:   (row['Picker']  || '').trim(),
        remark:   (row['หมายเหตุ'] || '').trim(),
        taxNote:  (row['ใบกำกับภาษี/หมายเหตุเดิม'] || '').trim(),
        driver:   (row['คนส่ง']   || '').trim(),
        isUrgent: false,
        storeRequirements: storeReq,
        storeChips: storeChips.slice(0, 2)
      };
    });

  // If driver view, filter out archived orders
  const visibleOrders = (role === 'driver') ? allOrders.filter(o => !o.isArchived) : allOrders;
  const { orders: ordersWithDate, pendingSchedule } = splitByDeliveryDate(visibleOrders, date);

  return {
    allOrders,
    active: allOrders.filter(o => !o.isArchived),
    ordersWithDate,
    pendingSchedule
  };
}

const supervisorDayHandler = async (req, res) => {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Content-Type, Authorization');

  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'GET')     { res.status(405).json({ error: 'Method Not Allowed' }); return; }

  try {
    const { date, supervisorToken } = req.query;
    const authHeader = req.headers.authorization;
    const token = supervisorToken || (authHeader && authHeader.split(' ')[1]);

    if (!token) { res.status(401).json({ error: 'Unauthorized: Missing token' }); return; }
    const decoded = verifyToken(token);
    if (!decoded) { res.status(401).json({ error: 'Unauthorized: Invalid token' }); return; }

    const { ordersWithDate, pendingSchedule } = await fetchUnifiedOrdersFromSheets({
      date,
      role: decoded.role,
      username: decoded.username
    });

    const orders = (date === 'all' || !date) ? [...ordersWithDate, ...pendingSchedule] : ordersWithDate;

    res.status(200).json({
      success: true,
      orders,
      pendingSchedule,
      summary: {
        total:           ordersWithDate.length,
        pendingSchedule: pendingSchedule.length,
        available:       ordersWithDate.filter(o => o.status === 'available').length,
        assigned:        ordersWithDate.filter(o => o.status === 'mine').length,
        done:            ordersWithDate.filter(o => o.status === 'done').length,
        failed:          ordersWithDate.filter(o => o.status === 'failed').length,
      },
    });

  } catch (err) {
    console.error('[supervisor/day] Error:', err);
    res.status(500).json({ error: 'Internal Server Error', details: err.message });
  }
};

module.exports = supervisorDayHandler;
module.exports.fetchUnifiedOrdersFromSheets = fetchUnifiedOrdersFromSheets;
module.exports.readOrderOverrides = readOrderOverrides;
module.exports.writeOrderOverrides = writeOrderOverrides;
