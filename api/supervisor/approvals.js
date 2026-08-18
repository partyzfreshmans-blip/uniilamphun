/**
 * api/supervisor/approvals.js
 * =============================
 * Cross-Zone Approval Queue & Product Pending Requests Engine
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { getSheetRows, appendSheetRow } = require('../lib/sheets');
const { classifyOrderZone, getActiveZones } = require('../lib/zones');
const { assignOrderToDriver } = require('../dispatch');

const REQUESTS_FILE = path.join(__dirname, '../../local_crosszone_requests.json');
const DRIVERS_FILE = path.join(__dirname, '../../local_drivers.json');
const SHEET_ID_ORDERS = (process.env.SHEET_ID_ORDERS && process.env.SHEET_ID_ORDERS.length > 20 && !process.env.SHEET_ID_ORDERS.includes('BEWpjZ'))
  ? process.env.SHEET_ID_ORDERS
  : '1m1Cb_BEwPjqF3CgXNssGgjyewIgPNw_BU4EkduuV59U';

function getLocalCrossZoneRequests() {
  try {
    if (fs.existsSync(REQUESTS_FILE)) {
      const data = JSON.parse(fs.readFileSync(REQUESTS_FILE, 'utf8'));
      if (Array.isArray(data)) return data;
    }
  } catch (e) {
    console.warn('[approvals.js] Read error:', e.message);
  }
  return [];
}

function saveLocalCrossZoneRequests(requests) {
  try {
    fs.writeFileSync(REQUESTS_FILE, JSON.stringify(requests, null, 2), 'utf8');
  } catch (e) {
    console.error('[approvals.js] Save error:', e.message);
  }
}

// Initial sample requests if file does not exist
function seedSampleRequestsIfEmpty() {
  const existing = getLocalCrossZoneRequests();
  if (existing.length === 0) {
    const now = Date.now();
    const sample = [
      {
        id: 'REQ-CZ-101',
        orderId: 'UM-260814-6222994409',
        orderNumber: 'UM-260814-6222994409',
        customer: 'ลาวัลย์ กุนาเรือน (ตำบลเหล่ายาว)',
        address: '98 บ้านห้วยสร้อย 1 ตำบล เหล่ายาว อำเภอ บ้านโฮ่ง ลำพูน',
        orderZone: 'Zone C — ป่าซาง',
        price: 2373.00,
        cod: true,
        driverId: 'DRV-A01',
        driverName: 'ตู่2',
        driverZones: ['Zone A — เมืองลำพูน', 'Zone AB'],
        reason: 'กำลังส่งของแถวรอยต่อพอดี ทางผ่านขากลับช่วยเก็บยอดให้ครับ',
        requestedAt: new Date(now - 3 * 60 * 1000).toISOString(), // 3 mins ago (Normal)
        status: 'pending'
      },
      {
        id: 'REQ-CZ-102',
        orderId: 'UM-260816-3136841409',
        orderNumber: 'UM-260816-3136841409',
        customer: 'ปิ่นทอง หางดง',
        address: '40/1 หมู่ 1 ต.หนองตอง อ.หางดง จ.เชียงใหม่',
        orderZone: 'Zone AB - สารภี/บ้านธิ',
        price: 1488.00,
        cod: true,
        driverId: 'DRV-C03',
        driverName: 'หมี',
        driverZones: ['Zone C — ป่าซาง', 'Zone D - ทาปลาดุก'],
        reason: 'ลูกค้าร้านปิ่นทองโทรตามด่วน คนขับหลักยังไม่เข้าระบบ ขอช่วยเคลียร์ก่อน',
        requestedAt: new Date(now - 16 * 60 * 1000).toISOString(), // 16 mins ago (Urgent Red)
        status: 'pending'
      }
    ];
    saveLocalCrossZoneRequests(sample);
    return sample;
  }
  return existing;
}

/**
 * Get Cross-Zone Approval Summary with enriched zone owner status
 */
async function getCrossZoneApprovalSummary(date) {
  let requests = getLocalCrossZoneRequests();
  if (requests.length === 0) {
    requests = seedSampleRequestsIfEmpty();
  }

  // Filter only pending requests
  const pendingRequests = requests.filter(r => r.status === 'pending');

  // Load Drivers to enrich zone owner info & requester workload
  let drivers = [];
  try {
    if (fs.existsSync(DRIVERS_FILE)) {
      const data = JSON.parse(fs.readFileSync(DRIVERS_FILE, 'utf8'));
      drivers = Array.isArray(data) ? data : (data.drivers || []);
    }
  } catch (e) {
    console.warn('[approvals.js] Read drivers error:', e.message);
  }

  // Load active zones
  const { zones, overlapZones } = getActiveZones();

  // Read _ASSIGN from Google Sheets to compute actual workload today
  const assignRows = await getSheetRows(null, SHEET_ID_ORDERS, '_ASSIGN!A1:N5000').catch(() => []);
  const latestAssignMap = {};
  assignRows.slice(1).forEach(row => {
    const oid = (row['order_id'] || '').trim();
    if (oid) latestAssignMap[oid] = row;
  });

  const driverWorkloadMap = {};
  drivers.forEach(d => {
    driverWorkloadMap[d.id] = {
      assignedCount: 0,
      totalCod: 0
    };
  });

  Object.values(latestAssignMap).forEach(row => {
    const dId = (row['assigned_driver'] || '').trim();
    const st = (row['status'] || '').trim();
    if (dId && driverWorkloadMap[dId] && (st === 'mine' || st === 'assigned' || st === 'done')) {
      driverWorkloadMap[dId].assignedCount += 1;
      const codVal = parseFloat((row['cod_amount'] || '0').replace(/,/g, '')) || 0;
      driverWorkloadMap[dId].totalCod += codVal;
    }
  });

  // Load Schedule to enrich real-time leave / off status
  const SCHEDULE_FILE = path.join(__dirname, '../../local_schedule.json');
  let scheduleEntries = [];
  try {
    if (fs.existsSync(SCHEDULE_FILE)) {
      const data = JSON.parse(fs.readFileSync(SCHEDULE_FILE, 'utf8'));
      scheduleEntries = Array.isArray(data) ? data : (data.schedule || []);
    }
  } catch (e) {
    console.warn('[approvals.js] Read schedule error:', e.message);
  }

  const todayIso = new Date().toISOString().split('T')[0];
  const activeDate = date || todayIso;

  // Enrich each request
  const enrichedRequests = pendingRequests.map(req => {
    // 1. Requester Driver Workload
    const requester = drivers.find(d => d.id === req.driverId) || {};
    const requesterWorkload = driverWorkloadMap[req.driverId] || { assignedCount: 0, totalCod: 0 };

    // 2. Zone Owner(s)
    const targetZoneName = req.orderZone || '';
    const zoneLetter = targetZoneName.match(/Zone ([A-Z]+)/i)?.[1] || '';

    // Find drivers assigned to this zone
    const zoneOwners = drivers.filter(d => {
      if (d.id === req.driverId) return false;
      const dZones = Array.isArray(d.zones) ? d.zones : [d.zone || ''];
      return dZones.some(z => {
        if (!z) return false;
        if (z === targetZoneName) return true;
        if (zoneLetter && z.includes(`Zone ${zoneLetter}`)) return true;
        return false;
      });
    }).map(d => {
      const w = driverWorkloadMap[d.id] || { assignedCount: 0, totalCod: 0 };
      const sched = scheduleEntries.find(s => (s.driver_id === d.id || s.driver_id === d.code) && (s.date === activeDate || s.date === todayIso));
      const isLeave = (sched && sched.status === 'leave') || d.schedule === 'leave';
      const isOff = (sched && sched.status === 'off') || d.schedule === 'off';

      const statusText = isLeave
        ? (sched && sched.note ? `ลา (${sched.note})` : 'ลาหยุด')
        : isOff
          ? 'วันหยุด'
          : w.assignedCount > 0
            ? `จองแล้ว ${w.assignedCount} จุด`
            : 'ยังไม่เข้าระบบวันนี้';
      const statusCls = isLeave ? 'leave' : isOff ? 'off' : w.assignedCount > 0 ? 'busy' : 'inactive';

      return {
        id: d.id,
        name: d.name,
        code: d.code,
        statusText,
        statusCls,
        assignedCount: w.assignedCount
      };
    });

    return {
      ...req,
      requesterWorkload: {
        assignedCount: requesterWorkload.assignedCount,
        cardLimit: requester.cardLimit || 30
      },
      zoneOwners
    };
  });

  // Sort: longest waiting (oldest requestedAt) first
  enrichedRequests.sort((a, b) => new Date(a.requestedAt).getTime() - new Date(b.requestedAt).getTime());

  return {
    pendingCount: enrichedRequests.length,
    requests: enrichedRequests
  };
}

/**
 * Approve Cross-Zone Request
 */
async function approveCrossZoneRequest({ requestId, supervisorName }) {
  const requests = getLocalCrossZoneRequests();
  const reqIndex = requests.findIndex(r => r.id === requestId);
  if (reqIndex === -1) {
    throw new Error('ไม่พบคำขอข้ามโซนนี้ หรือถูกดำเนินการไปแล้ว');
  }

  const req = requests[reqIndex];
  if (req.status !== 'pending') {
    throw new Error(`คำขอนี้ถูก${req.status === 'approved' ? 'อนุมัติ' : 'ปฏิเสธ'}ไปแล้ว`);
  }

  // 1. Perform assignment write to _ASSIGN
  const assignReason = `[อนุมัติข้ามโซนโดย ${supervisorName || 'หัวหน้างาน'}] ${req.reason || ''}`;
  const assignResult = await assignOrderToDriver({
    orderId: req.orderId,
    driverId: req.driverId,
    reason: assignReason,
    username: supervisorName || 'supervisor'
  });

  // 2. Mark request as approved
  req.status = 'approved';
  req.approvedBy = supervisorName || 'supervisor';
  req.approvedAt = new Date().toISOString();
  saveLocalCrossZoneRequests(requests);

  return {
    success: true,
    message: `อนุมัติคำขอข้ามโซนออเดอร์ ${req.orderNumber} ให้ ${req.driverName} เรียบร้อยแล้ว`,
    request: req,
    assignResult
  };
}

/**
 * Reject Cross-Zone Request
 */
async function rejectCrossZoneRequest({ requestId, reason, supervisorName }) {
  if (!reason || !reason.trim()) {
    throw new Error('กรุณาระบุเหตุผลการไม่อนุมัติ');
  }

  const requests = getLocalCrossZoneRequests();
  const reqIndex = requests.findIndex(r => r.id === requestId);
  if (reqIndex === -1) {
    throw new Error('ไม่พบคำขอข้ามโซนนี้ หรือถูกดำเนินการไปแล้ว');
  }

  const req = requests[reqIndex];
  if (req.status !== 'pending') {
    throw new Error(`คำขอนี้ถูก${req.status === 'approved' ? 'อนุมัติ' : 'ปฏิเสธ'}ไปแล้ว`);
  }

  req.status = 'rejected';
  req.rejectedReason = reason.trim();
  req.rejectedBy = supervisorName || 'supervisor';
  req.rejectedAt = new Date().toISOString();
  saveLocalCrossZoneRequests(requests);

  return {
    success: true,
    message: `ปฏิเสธคำขอข้ามโซน ${req.orderNumber} เรียบร้อยแล้ว`,
    request: req
  };
}

/**
 * Driver Submits Cross-Zone Request
 */
async function createCrossZoneRequest({
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
}) {
  if (!orderId) throw new Error('กรุณาระบุเลขออเดอร์');
  if (!reason || !reason.trim()) throw new Error('กรุณาระบุเหตุผลการขอข้ามโซน');

  const requests = getLocalCrossZoneRequests();

  const existingPending = requests.find(r => r.orderId === orderId && r.status === 'pending');
  if (existingPending) {
    if (existingPending.driverId === driverId) {
      throw new Error(`คุณได้ส่งคำขอข้ามโซนสำหรับออเดอร์นี้ไปแล้ว (สถานะ: รออนุมัติ)`);
    } else {
      throw new Error(`ออเดอร์นี้มีคำขอข้ามโซนรออนุมัติอยู่แล้วโดย ${existingPending.driverName}`);
    }
  }

  const reqId = `REQ-CZ-${Date.now().toString().slice(-6)}`;
  const newReq = {
    id: reqId,
    orderId: String(orderId).trim(),
    orderNumber: String(orderNumber || orderId).trim(),
    customer: customer || 'ลูกค้า/ร้านค้า',
    address: address || '',
    orderZone: orderZone || 'ไม่ระบุโซน',
    price: typeof price === 'number' ? price : (parseFloat(price) || 0),
    cod: cod !== undefined ? Boolean(cod) : true,
    driverId: String(driverId || 'DRV-UNKNOWN').trim(),
    driverName: String(driverName || 'คนขับ').trim(),
    driverZones: Array.isArray(driverZones) ? driverZones : (driverZones ? [driverZones] : []),
    reason: String(reason).trim(),
    requestedAt: new Date().toISOString(),
    status: 'pending'
  };

  requests.unshift(newReq);
  saveLocalCrossZoneRequests(requests);

  return {
    success: true,
    message: 'ส่งคำขอข้ามโซนเรียบร้อยแล้ว รอหัวหน้าคลังอนุมัติ',
    request: newReq
  };
}

module.exports = {
  getCrossZoneApprovalSummary,
  approveCrossZoneRequest,
  rejectCrossZoneRequest,
  createCrossZoneRequest,
  seedSampleRequestsIfEmpty
};

