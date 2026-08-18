/**
 * api/supervisor/returns.js
 * ===========================
 * Warehouse Returns Intake Engine (ของกลับเข้าคลัง)
 * Tab: _RETURNS
 * Headers: order_no, driver_id, fail_reason, fail_at, photo_url, received_by, received_at, condition, shortage_note, status
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { getSheetsClient, ensureSheetExists, getSheetRows, appendSheetRow } = require('../lib/sheets');

const RETURNS_DB = path.join(__dirname, '../../local_returns.json');
const SHEET_ID_ORDERS = (process.env.SHEET_ID_ORDERS && process.env.SHEET_ID_ORDERS.length > 20 && !process.env.SHEET_ID_ORDERS.includes('BEWpjZ'))
  ? process.env.SHEET_ID_ORDERS
  : '1m1Cb_BEwPjqF3CgXNssGgjyewIgPNw_BU4EkduuV59U';
const RETURNS_SHEET = '_RETURNS';
const RETURNS_HEADERS = [
  'order_no', 'driver_id', 'fail_reason', 'fail_at', 'photo_url',
  'received_by', 'received_at', 'condition', 'shortage_note', 'status'
];

function readLocalReturns() {
  try {
    if (fs.existsSync(RETURNS_DB)) {
      const data = JSON.parse(fs.readFileSync(RETURNS_DB, 'utf8'));
      if (Array.isArray(data)) return data;
    }
  } catch (e) {
    console.warn('[returns.js] Read local returns error:', e.message);
  }
  return [];
}

function writeLocalReturns(data) {
  try {
    fs.writeFileSync(RETURNS_DB, JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {
    console.error('[returns.js] Write local returns error:', e.message);
  }
}

/**
 * Record a failed delivery into _RETURNS automatically from Driver App (M4b)
 */
async function recordFailedDelivery({
  orderNo,
  driverId,
  failReason,
  failAt,
  photoUrl,
  customerName,
  itemCount,
  price
}) {
  if (!orderNo) throw new Error('Missing orderNo');

  const now = failAt || new Date().toISOString();
  const entry = {
    order_no: String(orderNo).trim(),
    driver_id: String(driverId || 'DRV-UNKNOWN').trim(),
    fail_reason: String(failReason || 'ส่งไม่สำเร็จ').trim(),
    fail_at: now,
    photo_url: photoUrl || '',
    received_by: '',
    received_at: '',
    condition: '',
    shortage_note: '',
    status: 'รอรับคืน',
    customer_name: customerName || '',
    item_count: itemCount || 1,
    price: price || 0
  };

  // 1. Update Local DB
  const localList = readLocalReturns();
  const existingIdx = localList.findIndex(r => r.order_no === entry.order_no && r.status === 'รอรับคืน');
  if (existingIdx >= 0) {
    localList[existingIdx] = { ...localList[existingIdx], ...entry };
  } else {
    localList.unshift(entry);
  }
  writeLocalReturns(localList);

  // 2. Append to Google Sheets _RETURNS
  try {
    const auth = null;
    await ensureSheetExists(auth, SHEET_ID_ORDERS, RETURNS_SHEET, RETURNS_HEADERS).catch(() => {});
    await appendSheetRow(auth, SHEET_ID_ORDERS, `${RETURNS_SHEET}!A:J`, [
      entry.order_no,
      entry.driver_id,
      entry.fail_reason,
      entry.fail_at,
      entry.photo_url,
      entry.received_by,
      entry.received_at,
      entry.condition,
      entry.shortage_note,
      entry.status
    ]);
  } catch (err) {
    console.warn('[returns.js] Sheets append warning:', err.message);
  }

  return { success: true, entry };
}

/**
 * Receive Return Item in Warehouse (ตรวจรับสภาพของกลับเข้าคลัง)
 */
async function receiveReturnItem({
  orderNo,
  condition,
  shortageCount,
  shortageNote,
  supervisorName
}) {
  if (!orderNo) throw new Error('Missing orderNo');
  if (!condition) throw new Error('กรุณาระบุสภาพของ (ปกติ / เสียหาย / ไม่ครบ)');

  const condNormalized = condition === 'damaged' || condition === 'เสียหาย'
    ? 'เสียหาย'
    : condition === 'shortage' || condition === 'ไม่ครบ'
      ? 'ไม่ครบ'
      : 'ปกติ';

  if (condNormalized !== 'ปกติ') {
    if (!shortageNote || !shortageNote.trim()) {
      throw new Error('กรณีสินค้าเสียหายหรือไม่ครบ บังคับระบุจำนวนและหมายเหตุ');
    }
  }

  const now = new Date().toISOString();
  const fullNote = shortageCount ? `[ขาด/ชำรุด ${shortageCount} ชิ้น] ${shortageNote || ''}` : (shortageNote || '');

  // 1. Update Local DB
  const localList = readLocalReturns();
  const target = localList.find(r => r.order_no === orderNo);
  if (target) {
    target.status = 'รับคืนแล้ว';
    target.condition = condNormalized;
    target.received_by = supervisorName || 'supervisor';
    target.received_at = now;
    target.shortage_note = fullNote;
  } else {
    localList.unshift({
      order_no: orderNo,
      driver_id: '',
      fail_reason: '',
      fail_at: now,
      photo_url: '',
      received_by: supervisorName || 'supervisor',
      received_at: now,
      condition: condNormalized,
      shortage_note: fullNote,
      status: 'รับคืนแล้ว'
    });
  }
  writeLocalReturns(localList);

  // 2. Append updated receipt to Google Sheets _RETURNS
  try {
    const auth = null;
    await ensureSheetExists(auth, SHEET_ID_ORDERS, RETURNS_SHEET, RETURNS_HEADERS).catch(() => {});
    await appendSheetRow(auth, SHEET_ID_ORDERS, `${RETURNS_SHEET}!A:J`, [
      orderNo,
      target ? target.driver_id : '',
      target ? target.fail_reason : '',
      target ? target.fail_at : '',
      target ? target.photo_url : '',
      supervisorName || 'supervisor',
      now,
      condNormalized,
      fullNote,
      'รับคืนแล้ว'
    ]);
  } catch (err) {
    console.warn('[returns.js] Sheets append receipt warning:', err.message);
  }

  return {
    success: true,
    message: `รับของคืนออเดอร์ ${orderNo} สภาพ: ${condNormalized} เรียบร้อยแล้ว`,
    entry: target
  };
}

/**
 * Get Returns Summary & List for S5
 */
async function getReturnsSummary({ date, driverId, status, condition } = {}) {
  let localList = readLocalReturns();

  // Try reading from Sheets _RETURNS to merge
  try {
    const rows = await getSheetRows(null, SHEET_ID_ORDERS, `${RETURNS_SHEET}!A1:J5000`).catch(() => []);
    if (rows && rows.length > 1) {
      const sheetMap = {};
      rows.slice(1).forEach(row => {
        const oNo = (row['order_no'] || '').trim();
        if (oNo) sheetMap[oNo] = row;
      });

      // Merge sheet state into local
      Object.keys(sheetMap).forEach(oNo => {
        const sRow = sheetMap[oNo];
        const ex = localList.find(l => l.order_no === oNo);
        if (!ex) {
          localList.push({
            order_no: oNo,
            driver_id: sRow['driver_id'] || '',
            fail_reason: sRow['fail_reason'] || '',
            fail_at: sRow['fail_at'] || '',
            photo_url: sRow['photo_url'] || '',
            received_by: sRow['received_by'] || '',
            received_at: sRow['received_at'] || '',
            condition: sRow['condition'] || '',
            shortage_note: sRow['shortage_note'] || '',
            status: sRow['status'] || 'รอรับคืน'
          });
        } else {
          // If sheet has received status, update local
          if (sRow['status'] === 'รับคืนแล้ว') {
            ex.status = 'รับคืนแล้ว';
            ex.condition = sRow['condition'] || ex.condition;
            ex.received_by = sRow['received_by'] || ex.received_by;
            ex.received_at = sRow['received_at'] || ex.received_at;
            ex.shortage_note = sRow['shortage_note'] || ex.shortage_note;
          }
        }
      });
    }
  } catch (err) {
    console.warn('[returns.js] Sheets read warning:', err.message);
  }

  // Load Drivers DB to enrich names
  let drivers = [];
  try {
    const drvPath = path.join(__dirname, '../../local_drivers.json');
    if (fs.existsSync(drvPath)) {
      const dData = JSON.parse(fs.readFileSync(drvPath, 'utf8'));
      drivers = Array.isArray(dData) ? dData : (dData.drivers || []);
    }
  } catch (e) {}

  const nowMs = Date.now();
  const ONE_DAY_MS = 24 * 60 * 60 * 1000;

  // Enrich items with overdue days and driver names
  const enrichedList = localList.map(item => {
    const failMs = item.fail_at ? new Date(item.fail_at).getTime() : nowMs;
    const diffMs = Math.max(0, nowMs - failMs);
    const daysOverdue = Math.floor(diffMs / ONE_DAY_MS);
    const isOverdue = item.status === 'รอรับคืน' && daysOverdue >= 1;

    const drv = drivers.find(d => d.id === item.driver_id || d.code === item.driver_id) || {};

    return {
      ...item,
      driver_name: drv.name || item.driver_id || 'ไม่ระบุ',
      driver_code: drv.code || item.driver_id || '—',
      driver_avatar: drv.avatar || (drv.code ? drv.code.replace('DRV-', '') : '—'),
      days_overdue: daysOverdue,
      is_overdue: isOverdue
    };
  });

  // Calculate high-level stats
  const pendingItems = enrichedList.filter(r => r.status === 'รอรับคืน');
  const overdueItems = pendingItems.filter(r => r.is_overdue);
  const receivedItems = enrichedList.filter(r => r.status === 'รับคืนแล้ว');

  // Filter if query params provided
  let filtered = [...enrichedList];
  if (driverId && driverId !== 'all') {
    filtered = filtered.filter(r => r.driver_id === driverId || r.driver_code === driverId);
  }
  if (status && status !== 'all') {
    filtered = filtered.filter(r => r.status === status);
  }
  if (condition && condition !== 'all') {
    filtered = filtered.filter(r => r.condition === condition);
  }

  // Sort: Overdue (>1 day) first, then pending, then newest fail_at
  filtered.sort((a, b) => {
    if (a.status === 'รอรับคืน' && b.status !== 'รอรับคืน') return -1;
    if (a.status !== 'รอรับคืน' && b.status === 'รอรับคืน') return 1;
    if (a.is_overdue && !b.is_overdue) return -1;
    if (!a.is_overdue && b.is_overdue) return 1;
    return new Date(b.fail_at || 0).getTime() - new Date(a.fail_at || 0).getTime();
  });

  return {
    stats: {
      pendingCount: pendingItems.length,
      overdueCount: overdueItems.length,
      receivedTodayCount: receivedItems.length
    },
    returns: filtered
  };
}

module.exports = {
  recordFailedDelivery,
  receiveReturnItem,
  getReturnsSummary
};
