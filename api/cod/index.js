/**
 * api/cod/index.js
 * ================
 * Cash On Delivery (COD) Reconciliation System
 * 4-tier Financial Accounting:
 *   1. Expected (ควรเก็บ): Cash orders only with status 'done'/'delivered'
 *   2. Reported (คนขับแจ้ง): Driver reported amount on completion
 *   3. Verified (หัวหน้านับได้): Supervisor cash counted input
 *   4. Difference (ส่วนต่าง): Verified - Expected
 *
 * Append-only ledger storage in local_cod.json + Google Sheets _COD & _DAYCLOSE
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { fetchUnifiedOrdersFromSheets } = require('../supervisor/day');
const { getSheetsClient, ensureSheetExists } = require('../lib/sheets');

const COD_DB_PATH = path.join(__dirname, '../../local_cod.json');
const DRIVERS_PATH = path.join(__dirname, '../../local_drivers.json');
const DAYCLOSE_PATH = path.join(__dirname, '../../local_dayclose.json');

const COD_SHEET_NAME = '_COD';
const COD_HEADERS = [
  'entry_id',
  'date',
  'driver_id',
  'driver_name',
  'expected_amount',
  'reported_amount',
  'verified_amount',
  'difference',
  'reason',
  'note',
  'entry_type',
  'created_by',
  'created_at'
];

const DAYCLOSE_SHEET_NAME = '_DAYCLOSE';
const DAYCLOSE_HEADERS = [
  'dayclose_id',
  'date',
  'total_expected',
  'total_reported',
  'total_verified',
  'net_difference',
  'total_drivers',
  'total_delivered_points',
  'closed_by',
  'closed_at',
  'status'
];

function getCodLedger() {
  try {
    if (fs.existsSync(COD_DB_PATH)) {
      return JSON.parse(fs.readFileSync(COD_DB_PATH, 'utf8')) || [];
    }
  } catch (e) {
    console.warn('[cod] Warning reading local_cod.json:', e.message);
  }
  return [];
}

function appendCodLedger(entry) {
  const ledger = getCodLedger();
  const newEntry = {
    entry_id: entry.entry_id || `COD-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    date: entry.date,
    driver_id: entry.driver_id,
    driver_name: entry.driver_name || '',
    order_no: entry.order_no || '',
    expected: parseFloat(entry.expected) || 0,
    collected: parseFloat(entry.collected !== undefined ? entry.collected : entry.expected) || 0,
    verified: parseFloat(entry.verified) || 0,
    diff: (parseFloat(entry.verified) || 0) - (parseFloat(entry.expected) || 0),
    reason: entry.reason || '',
    custom_reason: entry.custom_reason || entry.note || '',
    entry_type: entry.entry_type || 'handover', // 'collect' | 'handover' | 'adjust' | 'dayclose'
    created_by: entry.created_by || 'supervisor',
    created_at: entry.created_at || new Date().toISOString()
  };
  ledger.push(newEntry);
  fs.writeFileSync(COD_DB_PATH, JSON.stringify(ledger, null, 2), 'utf8');
  return newEntry;
}

function getDaycloseStatus(date) {
  try {
    if (fs.existsSync(DAYCLOSE_PATH)) {
      const list = JSON.parse(fs.readFileSync(DAYCLOSE_PATH, 'utf8')) || [];
      return list.find(d => d.date === date) || null;
    }
  } catch (e) {}
  return null;
}

function saveDaycloseRecord(record) {
  try {
    let list = [];
    if (fs.existsSync(DAYCLOSE_PATH)) {
      list = JSON.parse(fs.readFileSync(DAYCLOSE_PATH, 'utf8')) || [];
    }
    const idx = list.findIndex(d => d.date === record.date);
    if (idx >= 0) {
      list[idx] = record;
    } else {
      list.push(record);
    }
    fs.writeFileSync(DAYCLOSE_PATH, JSON.stringify(list, null, 2), 'utf8');
    return true;
  } catch (e) {
    console.error('[saveDaycloseRecord] Error:', e.message);
    return false;
  }
}

/**
 * Append row to Google Sheets _COD tab
 */
async function syncCodEntryToSheet(entry) {
  const spreadsheetId = (process.env.SHEET_ID_ORDERS && process.env.SHEET_ID_ORDERS.length > 20 && !process.env.SHEET_ID_ORDERS.includes('BEWpjZ'))
    ? process.env.SHEET_ID_ORDERS
    : '1m1Cb_BEwPjqF3CgXNssGgjyewIgPNw_BU4EkduuV59U';
  if (!spreadsheetId) return;

  try {
    const sheets = getSheetsClient();
    await ensureSheetExists(sheets, spreadsheetId, COD_SHEET_NAME, COD_HEADERS);

    const values = [[
      entry.entry_id || '',
      entry.date || '',
      entry.driver_id || '',
      entry.driver_name || '',
      Number(entry.expected || 0).toFixed(2),
      Number(entry.collected || 0).toFixed(2),
      Number(entry.verified || 0).toFixed(2),
      Number(entry.diff || 0).toFixed(2),
      entry.reason || '',
      entry.custom_reason || entry.note || '',
      entry.entry_type || 'handover',
      entry.created_by || 'supervisor',
      entry.created_at || new Date().toISOString()
    ]];

    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `${COD_SHEET_NAME}!A:M`,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      resource: { values }
    });
    console.log(`[cod] Synced entry ${entry.entry_id} to sheet ${COD_SHEET_NAME}`);
  } catch (e) {
    console.warn(`[cod] Failed to sync entry to Google Sheets ${COD_SHEET_NAME}:`, e.message);
  }
}

/**
 * Append row to Google Sheets _DAYCLOSE tab
 */
async function syncDayCloseToSheet(record) {
  const spreadsheetId = (process.env.SHEET_ID_ORDERS && process.env.SHEET_ID_ORDERS.length > 20 && !process.env.SHEET_ID_ORDERS.includes('BEWpjZ'))
    ? process.env.SHEET_ID_ORDERS
    : '1m1Cb_BEwPjqF3CgXNssGgjyewIgPNw_BU4EkduuV59U';
  if (!spreadsheetId) return;

  try {
    const sheets = getSheetsClient();
    await ensureSheetExists(sheets, spreadsheetId, DAYCLOSE_SHEET_NAME, DAYCLOSE_HEADERS);

    const values = [[
      record.dayclose_id || '',
      record.date || '',
      Number(record.total_expected || 0).toFixed(2),
      Number(record.total_reported || 0).toFixed(2),
      Number(record.total_verified || 0).toFixed(2),
      Number(record.net_difference || 0).toFixed(2),
      Number(record.total_drivers || 0),
      Number(record.total_delivered_points || 0),
      record.closed_by || 'supervisor',
      record.closed_at || new Date().toISOString(),
      record.status || 'CLOSED'
    ]];

    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `${DAYCLOSE_SHEET_NAME}!A:K`,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      resource: { values }
    });
    console.log(`[cod] Synced Day Close ${record.dayclose_id} for ${record.date} to sheet ${DAYCLOSE_SHEET_NAME}`);
  } catch (e) {
    console.warn(`[cod] Failed to sync Day Close to Google Sheets ${DAYCLOSE_SHEET_NAME}:`, e.message);
  }
}

/**
 * Save driver verification and sync to _COD
 */
async function saveDriverVerification({ date, driverId, expected, collected, verified, reason, customReason, createdBy }) {
  const dayClose = getDaycloseStatus(date);
  if (dayClose && dayClose.locked) {
    throw new Error(`วันที่ ${date} ถูกปิดยอดประจำวันและล็อกบัญชีแล้ว ไม่สามารถแก้ไขได้`);
  }

  // Find driver name
  let driverName = driverId;
  try {
    if (fs.existsSync(DRIVERS_PATH)) {
      const data = JSON.parse(fs.readFileSync(DRIVERS_PATH, 'utf8'));
      const d = (data.drivers || []).find(x => x.code === driverId || x.id === driverId);
      if (d && d.name) driverName = d.name;
    }
  } catch (e) {}

  const entry = appendCodLedger({
    date,
    driver_id: driverId,
    driver_name: driverName,
    expected,
    collected,
    verified,
    reason,
    custom_reason: customReason,
    entry_type: 'handover',
    created_by: createdBy || 'supervisor'
  });

  // Sync to Google Sheets asynchronously
  syncCodEntryToSheet(entry).catch(err => {
    console.warn('[saveDriverVerification] Background sheet sync error:', err.message);
  });

  return entry;
}

/**
 * Execute Day Close and permanently lock the date
 */
async function executeDayClose({ date, closedBy }) {
  if (!date) throw new Error('Missing date parameter');

  const existing = getDaycloseStatus(date);
  if (existing && existing.locked) {
    throw new Error(`วันที่ ${date} ได้ทำการปิดยอดไปแล้ว`);
  }

  const summary = await getCodSummary(date);
  if (!summary.totals.allDriversVerified) {
    throw new Error('ไม่สามารถปิดยอดได้ เนื่องจากยังมีคนขับที่ยังไม่ได้รับการตรวจนับและยืนยันยอดเงิน');
  }

  const dayCloseRecord = {
    dayclose_id: `DC-${date.replace(/[^0-9]/g, '')}-${Date.now()}`,
    date,
    total_expected: summary.totals.totalExpectedCash,
    total_reported: summary.totals.totalDriverReported,
    total_verified: summary.totals.totalVerifiedCash,
    net_difference: summary.totals.netDifference,
    total_drivers: summary.drivers.length,
    total_delivered_points: summary.totals.deliveredPointsCount,
    closed_by: closedBy || 'supervisor',
    closed_at: new Date().toISOString(),
    status: 'CLOSED',
    locked: true
  };

  // 1. Save local record
  saveDaycloseRecord(dayCloseRecord);

  // 2. Append to _DAYCLOSE Google Sheet
  await syncDayCloseToSheet(dayCloseRecord);

  // 3. Append day close summary to _COD ledger
  const auditEntry = appendCodLedger({
    date,
    driver_id: 'SYSTEM_DAYCLOSE',
    driver_name: 'ปิดยอดประจำวัน',
    expected: summary.totals.totalExpectedCash,
    collected: summary.totals.totalDriverReported,
    verified: summary.totals.totalVerifiedCash,
    reason: 'ปิดยอดประจำวัน',
    custom_reason: `ปิดยอดและล็อกวันเรียบร้อย (ส่วนต่างสุทธิ: ฿${summary.totals.netDifference.toFixed(2)})`,
    entry_type: 'dayclose',
    created_by: closedBy || 'supervisor'
  });

  await syncCodEntryToSheet(auditEntry);

  return {
    success: true,
    message: `ปิดยอดประจำวันที่ ${date} สำเร็จและล็อกบัญชีเรียบร้อยแล้ว`,
    dayClose: dayCloseRecord
  };
}

async function getCodSummary(date) {
  const rawDate = date || '17-08-2026';
  
  // 1. Fetch live orders
  const ordersData = await fetchUnifiedOrdersFromSheets({ date: rawDate, role: 'supervisor' });
  const dayOrders = ordersData.ordersWithDate || [];

  // 2. Load drivers
  let drivers = [];
  try {
    if (fs.existsSync(DRIVERS_PATH)) {
      drivers = JSON.parse(fs.readFileSync(DRIVERS_PATH, 'utf8')).drivers || [];
    }
  } catch (e) {}

  // 3. Load ledger
  const ledger = getCodLedger();
  const dateEntries = ledger.filter(e => e.date === rawDate);

  // Group latest handover by driver
  const driverHandovers = {};
  dateEntries.forEach(e => {
    if (e.entry_type === 'handover' || e.entry_type === 'adjust') {
      driverHandovers[e.driver_id] = e; // latest overwrite in memory map
    }
  });

  // Check day close lock
  const dayClose = getDaycloseStatus(rawDate);
  const isLocked = !!(dayClose && dayClose.locked);

  // 4. Calculate per driver
  const driverMap = {};
  drivers.forEach(d => {
    driverMap[d.code] = {
      id: d.code,
      code: d.code,
      name: d.name,
      avatar: d.avatar || d.code.replace('DRV-', ''),
      phone: d.phone || '',
      zone: d.zone || (d.zones && d.zones[0]) || 'Zone A',
      zones: d.zones || [d.zone],
      color: d.color || 'var(--st-available)',
      totalOrders: 0,
      deliveredCount: 0,
      failedCount: 0,
      pendingCount: 0,
      expectedCash: 0,
      transferAmount: 0,
      pendingCash: 0,
      driverReportedCash: 0,
      verifiedCash: null,
      diff: null,
      reason: '',
      customReason: '',
      status: 'pending', // 'pending' | 'matched' | 'discrepancy' | 'closed'
      orders: []
    };
  });

  dayOrders.forEach(o => {
    const isDelivered = o.status === 'done' || o.apiStatus === 'ได้รับแล้ว' || o.apiStatus === 'ส่งสำเร็จ';
    const isFailed = o.status === 'failed' || o.apiStatus === 'ยกเลิก';
    const payment = (o.paymentType || '').toLowerCase();
    const isCash = o.cod === true || payment.includes('cash') || payment.includes('cod') || (!payment.includes('transfer') && !payment.includes('โอน') && !payment.includes('credit'));
    const isTransfer = payment.includes('transfer') || payment.includes('โอน') || payment.includes('credit');

    const dCode = o.assignedDriverId || 'DRV-A01';
    if (!driverMap[dCode]) {
      driverMap[dCode] = {
        id: dCode,
        code: dCode,
        name: dCode,
        avatar: dCode.replace('DRV-', ''),
        phone: '',
        zone: o.geojsonZone || 'Zone A',
        zones: [o.geojsonZone || 'Zone A'],
        color: 'var(--st-available)',
        totalOrders: 0,
        deliveredCount: 0,
        failedCount: 0,
        pendingCount: 0,
        expectedCash: 0,
        transferAmount: 0,
        pendingCash: 0,
        driverReportedCash: 0,
        verifiedCash: null,
        diff: null,
        reason: '',
        customReason: '',
        status: 'pending',
        orders: []
      };
    }

    const dStat = driverMap[dCode];
    dStat.totalOrders++;

    // Order detail item for Level 2
    const orderDetail = {
      id: o.uid || o.id,
      customer: o.customer,
      phone: o.phone,
      address: o.address,
      district: o.district,
      price: o.price,
      paymentType: o.paymentType || (isCash ? 'Cash On Delivery' : 'Bank Transfer'),
      isCash,
      status: o.status,
      apiStatus: o.apiStatus,
      isDelivered,
      isFailed,
      deliveredAt: o.deliveredAt || o.updatedAt || '',
      lat: o.lat,
      lng: o.lng,
      distanceWh: o.distanceWh,
      storeChips: o.storeChips || []
    };
    dStat.orders.push(orderDetail);

    if (isDelivered) {
      dStat.deliveredCount++;
      if (isCash) {
        dStat.expectedCash += o.price;
      } else {
        dStat.transferAmount += o.price;
      }
    } else if (isFailed) {
      dStat.failedCount++;
    } else {
      dStat.pendingCount++;
      if (isCash) {
        dStat.pendingCash += o.price;
      }
    }
  });

  // Apply verification ledger to drivers
  Object.values(driverMap).forEach(d => {
    // Default reported = expected if delivered
    d.driverReportedCash = d.expectedCash;

    const saved = driverHandovers[d.code];
    if (saved) {
      d.verifiedCash = saved.verified;
      d.diff = saved.diff;
      d.reason = saved.reason || '';
      d.customReason = saved.custom_reason || '';
      if (isLocked) {
        d.status = 'closed';
      } else if (saved.diff === 0) {
        d.status = 'matched';
      } else {
        d.status = 'discrepancy';
      }
    } else {
      if (d.deliveredCount === 0 && d.totalOrders === 0) {
        d.status = 'no_orders';
      } else {
        d.status = 'pending';
      }
    }
  });

  // Totals
  const activeDriversList = Object.values(driverMap).filter(d => d.totalOrders > 0 || d.verifiedCash !== null);
  const totalExpectedCash = activeDriversList.reduce((acc, d) => acc + d.expectedCash, 0);
  const totalDriverReported = activeDriversList.reduce((acc, d) => acc + d.driverReportedCash, 0);
  const totalVerifiedCash = activeDriversList.reduce((acc, d) => acc + (d.verifiedCash !== null ? d.verifiedCash : 0), 0);
  const totalTransferDelivered = activeDriversList.reduce((acc, d) => acc + d.transferAmount, 0);
  const allDriversVerified = activeDriversList.length > 0 && activeDriversList.every(d => d.verifiedCash !== null);
  const netDifference = totalVerifiedCash - totalExpectedCash;

  return {
    date: rawDate,
    isLocked,
    dayClose,
    totals: {
      totalExpectedCash,
      totalDriverReported,
      totalVerifiedCash,
      totalTransferDelivered,
      netDifference,
      allDriversVerified,
      totalOrdersCount: dayOrders.length,
      deliveredPointsCount: activeDriversList.reduce((acc, d) => acc + d.deliveredCount, 0)
    },
    drivers: activeDriversList,
    history: dateEntries
  };
}

module.exports = {
  getCodSummary,
  appendCodLedger,
  getDaycloseStatus,
  saveDriverVerification,
  executeDayClose,
  syncCodEntryToSheet,
  syncDayCloseToSheet
};
