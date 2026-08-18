/**
 * api/dispatch/index.js
 * =====================
 * Dispatch Board & Workload Balancing Engine (จัดการรูทส่ง / กระดานเกลี่ยงาน)
 * 
 * Rules:
 *   1. Stat Header: Total stops, Claimed, Working Drivers, Need Clear
 *   2. Left Pool: Unassigned Orders with zone chips, COD info, and store chips
 *   3. Right Grid: Driver Cards with progress, pending stops, COD cash, real computed status badges,
 *      and transparent high-workload warning boxes (based strictly on mathematical averages).
 *   4. Collision & Conflict Prevention: Read-before-write to prevent concurrent booking conflicts.
 *   5. Cross-zone Wall: Requires reason when assigning outside a driver's designated zone.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { fetchUnifiedOrdersFromSheets } = require('../supervisor/day');
const { getSheetsClient, getSheetRows, ensureSheetExists } = require('../lib/sheets');
const { classifyOrderZone } = require('../lib/zones');

const DRIVERS_DB = path.join(__dirname, '../../local_drivers.json');
const SCHEDULE_DB = path.join(__dirname, '../../local_schedule.json');
const ZONES_DB = path.join(__dirname, '../../local_zones.json');

const SHEET_ID_ORDERS = process.env.SHEET_ID_ORDERS;
const ASSIGN_SHEET = '_ASSIGN';
const ASSIGN_HEADERS = [
  'order_id','status','assigned_driver','completed_at',
  'lat','lng','driver_note','priority','hold'
];

function readDriversDb() {
  try {
    if (fs.existsSync(DRIVERS_DB)) {
      const data = JSON.parse(fs.readFileSync(DRIVERS_DB, 'utf8'));
      return data.drivers || [];
    }
  } catch (e) {
    console.warn('[dispatch] Warning reading drivers db:', e.message);
  }
  return [];
}

function readScheduleDb() {
  try {
    if (fs.existsSync(SCHEDULE_DB)) {
      const data = JSON.parse(fs.readFileSync(SCHEDULE_DB, 'utf8'));
      return data.schedule || [];
    }
  } catch (e) {
    console.warn('[dispatch] Warning reading schedule db:', e.message);
  }
  return [];
}

function readZonesDb() {
  try {
    if (fs.existsSync(ZONES_DB)) {
      return JSON.parse(fs.readFileSync(ZONES_DB, 'utf8')) || {};
    }
  } catch (e) {
    console.warn('[dispatch] Warning reading zones db:', e.message);
  }
  return {};
}

async function getDispatchSummary(date) {
  const rawDate = date || '17-08-2026';

  // 1. Fetch unified orders
  const ordersData = await fetchUnifiedOrdersFromSheets({ date: rawDate, role: 'supervisor' });
  const dayOrders = ordersData.ordersWithDate || [];

  // 2. Load drivers & schedule
  const allDrivers = readDriversDb();
  const allSchedules = readScheduleDb();
  const zonesData = readZonesDb();

  // Find schedule status per driver for this date
  const driverScheduleMap = {};
  allSchedules.forEach(s => {
    if (s.date === rawDate) {
      driverScheduleMap[s.driver_id] = s.status; // 'working' | 'off' | 'leave'
    }
  });

  // 3. Separate Unassigned vs Assigned
  const unassignedList = [];
  const driverOrdersMap = {};
  allDrivers.forEach(d => {
    driverOrdersMap[d.code] = [];
  });

  let totalDeliveredPoints = 0;
  let totalClaimedPoints = 0;
  let needClearCount = 0;

  dayOrders.forEach(o => {
    const isUnassigned = !o.assignedDriverId || o.status === 'unassigned' || o.status === 'available';
    const isDelivered = o.status === 'done' || o.apiStatus === 'ได้รับแล้ว' || o.apiStatus === 'ส่งสำเร็จ';
    const isFailed = o.status === 'failed' || o.apiStatus === 'ยกเลิก';
    const payment = (o.paymentType || '').toLowerCase();
    const isCash = o.cod === true || payment.includes('cash') || payment.includes('cod') || (!payment.includes('transfer') && !payment.includes('โอน') && !payment.includes('credit'));

    const orderCard = {
      id: o.uid || o.id,
      uid: o.uid || o.id,
      customer: o.customer || 'ลูกค้าไม่ระบุชื่อ',
      phone: o.phone || '',
      address: o.address || '',
      district: o.district || '',
      price: parseFloat(o.price) || 0,
      isCash,
      paymentType: isCash ? 'Cash On Delivery' : 'Bank Transfer',
      status: o.status,
      apiStatus: o.apiStatus,
      isDelivered,
      isFailed,
      geojsonZone: o.geojsonZone || 'ไม่มีโซน',
      assignedDriverId: o.assignedDriverId || null,
      flagTag: o.flagTag || null,
      storeChips: o.storeChips || [],
      deliveredAt: o.deliveredAt || o.updatedAt || '',
      lat: o.lat,
      lng: o.lng
    };

    if (isUnassigned) {
      unassignedList.push(orderCard);
      needClearCount++;
    } else {
      totalClaimedPoints++;
      if (isDelivered) totalDeliveredPoints++;
      if (!driverOrdersMap[o.assignedDriverId]) {
        driverOrdersMap[o.assignedDriverId] = [];
      }
      driverOrdersMap[o.assignedDriverId].push(orderCard);
    }

    // Also count if order has problematic flag
    if (!isUnassigned && (orderCard.flagTag || orderCard.geojsonZone === 'ไม่มีโซน')) {
      needClearCount++;
    }
  });

  // 4. Calculate working drivers (must be active and on working schedule)
  const workingDrivers = allDrivers.filter(d => {
    if (d.status === 'inactive') return false;
    const sched = driverScheduleMap[d.code];
    return sched !== 'off' && sched !== 'leave';
  });

  // 5. Driver stats and workload calculation
  const driverCards = [];
  let sumPending = 0;
  let activeDriverCount = 0;

  allDrivers.forEach(d => {
    const isInactive = d.status === 'inactive';
    const orders = driverOrdersMap[d.code] || [];
    const totalCount = orders.length;
    const deliveredCount = orders.filter(o => o.isDelivered).length;
    const pendingCount = totalCount - deliveredCount;
    const codAmount = orders
      .filter(o => !o.isDelivered && o.isCash)
      .reduce((acc, o) => acc + o.price, 0);

    // If inactive and has 0 orders, do not show on daily dispatch board
    if (isInactive && totalCount === 0) {
      return;
    }

    if (!isInactive && (totalCount > 0 || (driverScheduleMap[d.code] !== 'off' && driverScheduleMap[d.code] !== 'leave'))) {
      sumPending += pendingCount;
      activeDriverCount++;
    }

    // Check cross-zone helper orders
    const driverZones = d.zones || [d.zone] || [];
    const helperOrders = orders.filter(o => {
      if (!o.geojsonZone || o.geojsonZone === 'ไม่มีโซน') return false;
      return !driverZones.some(z => o.geojsonZone.includes(z) || z.includes(o.geojsonZone));
    });

    let statusBadge = {
      code: 'normal',
      label: 'ปกติ',
      variant: 'done',
      color: 'var(--st-available)'
    };
    let workloadWarning = null;

    if (isInactive) {
      statusBadge = {
        code: 'inactive',
        label: 'ปิดรับงาน',
        variant: 'failed',
        color: 'var(--st-failed)'
      };
      workloadWarning = {
        pendingStops: pendingCount,
        averageStops: 0,
        ratio: '1.0',
        message: `คนขับถูกปิดรับงานในระบบ แต่ยังมีงานค้างอยู่ ${pendingCount} จุด — กรุณาย้ายงานให้คนขับอื่น`
      };
    }

    driverCards.push({
      id: d.code,
      code: d.code,
      name: d.name,
      avatar: d.avatar || d.code.replace('DRV-', ''),
      phone: d.phone || '',
      zone: d.zone || (d.zones && d.zones[0]) || 'Zone A',
      zones: d.zones || [d.zone],
      color: d.color || 'var(--st-available)',
      scheduleStatus: isInactive ? 'off' : (driverScheduleMap[d.code] || 'working'),
      isInactive,
      totalCount,
      deliveredCount,
      pendingCount,
      codAmount,
      progressPercent: totalCount > 0 ? Math.round((deliveredCount / totalCount) * 100) : 0,
      orders,
      hasHelperOrders: helperOrders.length > 0,
      helperOrderCount: helperOrders.length,
      statusBadge,
      workloadWarning
    });
  });

  // Calculate Average Pending
  const averagePending = activeDriverCount > 0 ? (sumPending / activeDriverCount) : 0;

  // Apply Mathematical Status Rules for active drivers
  driverCards.forEach(d => {
    if (d.isInactive) return; // Inactive status already set above

    const isWorking = d.scheduleStatus === 'working';

    if (d.scheduleStatus === 'off' || d.scheduleStatus === 'leave') {
      d.statusBadge = {
        code: 'off',
        label: d.scheduleStatus === 'off' ? 'วันหยุด' : 'ลางาน',
        variant: 'neutral',
        color: 'var(--ink-3)'
      };
    } else if (isWorking && d.totalCount === 0) {
      d.statusBadge = {
        code: 'not_logged_in',
        label: 'ยังไม่เข้าระบบวันนี้',
        variant: 'neutral',
        color: 'var(--ink-3)'
      };
    } else if (d.pendingCount > 0 && d.deliveredCount === 0 && d.totalCount > 10) {
      d.statusBadge = {
        code: 'no_movement',
        label: 'ไม่มีความเคลื่อนไหว',
        variant: 'failed',
        color: 'var(--st-failed)'
      };
    } else if (averagePending > 0 && d.pendingCount > (averagePending * 1.5) && d.pendingCount >= 5) {
      d.statusBadge = {
        code: 'high_workload',
        label: 'ภาระงานสูง',
        variant: 'attention',
        color: 'var(--st-attention)'
      };
    } else {
      d.statusBadge = {
        code: 'normal',
        label: 'ปกติ',
        variant: 'done',
        color: 'var(--st-available)'
      };
    }

    // High Workload Warning Box (Strictly when pending > average * 2)
    if (averagePending > 0 && d.pendingCount > (averagePending * 2) && d.pendingCount >= 6) {
      const ratio = (d.pendingCount / averagePending).toFixed(1);
      d.workloadWarning = {
        pendingStops: d.pendingCount,
        averageStops: Math.round(averagePending),
        ratio,
        message: `จุดค้าง ${d.pendingCount} จุด — มากกว่าค่าเฉลี่ยคนขับอื่น (${Math.round(averagePending)} จุด) ${ratio} เท่า`
      };
    }
  });

  return {
    date: rawDate,
    totals: {
      totalStops: dayOrders.length,
      claimedCount: totalClaimedPoints,
      unassignedCount: unassignedList.length,
      deliveredCount: totalDeliveredPoints,
      workingDriversCount: workingDrivers.length,
      needClearCount: needClearCount
    },
    averagePending: Math.round(averagePending * 10) / 10,
    unassignedOrders: unassignedList,
    drivers: driverCards
  };
}

/**
 * Assign an order to a driver with collision detection and cross-zone verification
 */
async function assignOrderToDriver({ orderId, driverId, reason, username }) {
  if (!orderId || !driverId) {
    throw new Error('Missing orderId or driverId');
  }

  const sheets = getSheetsClient();
  await ensureSheetExists(sheets, SHEET_ID_ORDERS, ASSIGN_SHEET, ASSIGN_HEADERS);

  // 1. Read latest _ASSIGN (Read-before-write to prevent collision)
  const rows = await getSheetRows(sheets, SHEET_ID_ORDERS, `${ASSIGN_SHEET}!A1:J5000`);
  const assignmentMap = {};
  rows.forEach(row => { if (row.order_id) assignmentMap[row.order_id] = row; });

  const current = assignmentMap[orderId];
  if (current && current.status !== 'released' && current.status !== 'available' && current.assigned_driver && current.assigned_driver !== driverId) {
    const err = new Error(`ออเดอร์ ${orderId} ถูกจองไปแล้วโดย ${current.assigned_driver}`);
    err.status = 409;
    throw err;
  }

  // 2. Check Driver Status & Cross-Zone
  const allDrivers = readDriversDb();
  const targetDriver = allDrivers.find(d => d.code === driverId || d.id === driverId);
  if (!targetDriver) {
    const err = new Error(`ไม่พบคนขับรหัส ${driverId} ในระบบ`);
    err.status = 404;
    throw err;
  }
  if (targetDriver.status === 'inactive') {
    const err = new Error(`คนขับ ${targetDriver.name} (${targetDriver.code}) ถูกปิดรับงานอยู่ ไม่สามารถรับมอบหมายงานได้`);
    err.status = 400;
    throw err;
  }
  const isSpecial = targetDriver?.isSpecial || targetDriver?.code === 'DRV-S04';

  // Find order zone
  const orderRows = await getSheetRows(sheets, SHEET_ID_ORDERS, 'คำสั่งซื้อ!A1:AD5000').catch(() => []);
  const orderRow = orderRows.find(r => (r['เลขคำสั่งซื้อ'] || '').trim() === orderId);

  let isCrossZone = false;
  let detectedZone = 'ไม่มีโซน';

  if (orderRow && targetDriver && !isSpecial) {
    const lat = parseFloat(orderRow['CS_Lat'] || orderRow['ละติจูด'] || 0);
    const lng = parseFloat(orderRow['CS_Long'] || orderRow['ลองจิจูด'] || 0);
    const classified = classifyOrderZone(lat, lng);
    detectedZone = (classified && classified !== 'UNASSIGNED') ? classified : 'ไม่มีโซน';
    const driverZones = (targetDriver.zones || [targetDriver.zone] || []).filter(Boolean);

    const isMatch = driverZones.some(z => String(detectedZone).includes(String(z)) || String(z).includes(String(detectedZone)));
    if (!isMatch && detectedZone !== 'ไม่มีโซน') {
      isCrossZone = true;
      if (!reason) {
        const err = new Error(`ออเดอร์อยู่ใน ${detectedZone} แต่มอบหมายให้คนขับ ${targetDriver.name} (${driverZones.join(', ')}) จำเป็นต้องระบุเหตุผลการปล่อยข้ามโซน`);
        err.requiresReason = true;
        err.status = 400;
        err.orderZone = detectedZone;
        err.driverZones = driverZones;
        throw err;
      }
    }
  }

  // 3. Append to _ASSIGN
  const driverNote = reason ? `[ข้ามโซน] ${reason}` : '';
  const newRow = {
    order_id: orderId,
    status: 'mine',
    assigned_driver: driverId,
    completed_at: '',
    lat: '',
    lng: '',
    driver_note: driverNote,
    priority: 'normal',
    hold: 'FALSE'
  };

  const values = [ASSIGN_HEADERS.map(h => String(newRow[h] || ''))];
  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID_ORDERS,
    range: `${ASSIGN_SHEET}!A1`,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    resource: { values }
  });

  return {
    success: true,
    message: `มอบหมายออเดอร์ ${orderId} ให้ ${targetDriver ? targetDriver.name : driverId} สำเร็จ`,
    orderId,
    driverId,
    isCrossZone
  };
}

module.exports = {
  getDispatchSummary,
  assignOrderToDriver
};
