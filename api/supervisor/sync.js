/**
 * api/supervisor/sync.js
 * =======================
 * POST /api/supervisor/sync
 *
 * Sync ออเดอร์ใหม่จาก Unii API → append เข้า Google Sheets คำสั่งซื้อ
 *
 * Flow:
 *   1. ดึงออเดอร์จาก Unii API (ทีละหน้า จนถึงหน้าสุดท้าย)
 *   2. อ่าน เลขคำสั่งซื้อ ที่มีอยู่แล้วในชีต (column F) — dedup
 *   3. Append เฉพาะออเดอร์ใหม่
 *   4. รายงาน: จำนวนที่ sync ได้, ใหม่, ซ้ำ
 *
 * Body params (optional):
 *   { "fullSync": true }  — ดึงทุกหน้า (ช้า แต่ครบ)
 *   { "pages": 3 }        — จำกัดจำนวนหน้า (default 5 หน้าล่าสุด)
 */

'use strict';

const https = require('https');
const { verifyToken }                                       = require('../lib/jwt');
const { getSheetsClient, getSheetRows, ensureSheetExists }  = require('../lib/sheets');

const SHEET_ID_ORDERS = process.env.SHEET_ID_ORDERS;
const UNII_BASE       = 'https://mart.iinuhcet.com';
const BRANCH_ID       = '584';
const PAGE_SIZE       = 100;

// คอลัมน์ header ของ sheet คำสั่งซื้อ (ต้องตรงกับที่มีอยู่จริง)
const ORDER_SHEET_HEADERS = [
  'Route','AutoR','วันที่จะจัดส่ง','วันเวลาที่สั่ง','ชื่อลูกค้า','เลขคำสั่งซื้อ','',
  'ยอดขายรวม','การจ่ายเงิน','Status','Picker','หมายเหตุ','ใบกำกับภาษี/หมายเหตุเดิม',
  'คนส่ง','new customer','วันที่สั่ง','วันที่จัดส่ง','วันที่ส่งสำเร็จ','วันที่อัปเดต',
  'อำเภอ, จังหวัด','ที่อยู่','ลิงค์แผนที่','CS_Lat','CS_Long','Phone',
  'Far from WH','WH_LAT','WH_LONG','Archived'
];

// ดึง Unii API token จาก App Settings sheet
async function getUniiToken(sheets) {
  const rows = await getSheetRows(sheets, SHEET_ID_ORDERS, 'App Settings!A1:B10');
  const row  = rows.find(r => r['setting_key'] === 'unii_api_key');
  if (!row) throw new Error('ไม่พบ unii_api_key ใน App Settings sheet');
  return row['setting_value'];
}

// HTTP GET helper (Node https)
function httpGet(url, token) {
  return new Promise((resolve, reject) => {
    const opts = {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type':  'application/json',
      },
    };
    https.get(url, opts, res => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(body) }); }
        catch (e) { reject(new Error(`JSON parse error: ${body.slice(0,200)}`)); }
      });
    }).on('error', reject);
  });
}

// แปลง Unii order object → แถวสำหรับ sheet คำสั่งซื้อ
function uniiOrderToRow(order) {
  const user    = order.user    || {};
  const address = order.address || {};
  const payment = order.paymentMethod || {};
  const status  = order.orderStatus  || {};

  // สถานะ Unii → ภาษาไทยที่ระบบใช้
  const STATUS_MAP = {
    'Pending':    'รอยืนยันออเดอร์',
    'Processing': 'กำลังดำเนินการ',
    'Delivering': 'กำลังจัดส่ง',
    'Delivered':  'ส่งสำเร็จ',
    'Cancelled':  'ยกเลิก',
    'Received':   'ได้รับแล้ว',
  };

  const thaiStatus = STATUS_MAP[status.status] || status.status || '';
  const customerName = `${user.firstName || ''} ${user.lastName || ''}`.trim();
  const phone = (user.countryCode === '+66' && user.phone)
    ? '0' + user.phone
    : (user.phone || '');
  const paymentName = payment.name || '';
  const lat  = address.latitude  || '';
  const lng  = address.longitude || '';
  const addr = address.address   || '';
  const dist = (address.district || {}).nameTh
    ? `${address.district.nameTh}, ${(address.district.province || {}).nameTh || ''}`
    : '';

  // วันที่สั่ง (createdAt ISO → แปลงเป็น M/D/YYYY H:mm:ss เพื่อให้สอดคล้องกับรูปแบบเดิม)
  function fmtDate(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d)) return iso;
    return `${d.getMonth()+1}/${d.getDate()}/${d.getFullYear()} ${d.getHours()}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}`;
  }

  const mapLink = lat && lng
    ? `https://www.google.com/maps?q=${lat},${lng}`
    : '';

  // สร้าง array ตามลำดับ ORDER_SHEET_HEADERS
  return [
    '',                           // Route (A) — ว่าง รอกำหนด
    '',                           // AutoR (B) — ว่าง
    '',                           // วันที่จะจัดส่ง (C) — ว่าง รอหัวหน้าคลังกำหนด
    fmtDate(order.createdAt),     // วันเวลาที่สั่ง (D)
    customerName,                 // ชื่อลูกค้า (E)
    order.uid || '',              // เลขคำสั่งซื้อ (F) ← key หลัก
    '',                           // G — ว่าง
    order.total || '',            // ยอดขายรวม (H)
    paymentName,                  // การจ่ายเงิน (I)
    thaiStatus,                   // Status (J)
    '',                           // Picker (K)
    '',                           // หมายเหตุ (L)
    '',                           // ใบกำกับภาษี/หมายเหตุเดิม (M)
    '',                           // คนส่ง (N)
    '',                           // new customer (O)
    fmtDate(order.createdAt),     // วันที่สั่ง (P)
    fmtDate(order.deliveryDate),  // วันที่จัดส่ง (Q)
    fmtDate(order.deliveredDate), // วันที่ส่งสำเร็จ (R)
    fmtDate(order.updatedAt),     // วันที่อัปเดต (S)
    dist,                         // อำเภอ, จังหวัด (T)
    addr,                         // ที่อยู่ (U)
    mapLink,                      // ลิงค์แผนที่ (V)
    lat,                          // CS_Lat (W)
    lng,                          // CS_Long (X)
    phone,                        // Phone (Y)
    '',                           // Far from WH (Z)
    '',                           // WH_LAT ([)
    '',                           // WH_LONG (\)
    '',                           // Archived (])
  ];
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Content-Type, Authorization');

  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST')    { res.status(405).json({ error: 'Method Not Allowed' }); return; }

  try {
    const authHeader = req.headers.authorization;
    const token = req.body?.supervisorToken || (authHeader && authHeader.split(' ')[1]);

    if (!token) { res.status(401).json({ error: 'Unauthorized: Missing token' }); return; }
    const decoded = verifyToken(token);
    if (!decoded || !['supervisor','admin','administrator'].includes(decoded.role)) {
      res.status(401).json({ error: 'Unauthorized: supervisor only' }); return;
    }

    const { fullSync = false, pages: maxPages = 5 } = req.body || {};
    const sheets = getSheetsClient();

    // 1. อ่าน Unii API token
    const uniiToken = await getUniiToken(sheets);

    // 2. อ่าน UIDs ที่มีอยู่ในชีตแล้ว (column F = เลขคำสั่งซื้อ)
    const existingRows = await getSheetRows(sheets, SHEET_ID_ORDERS, 'คำสั่งซื้อ!F1:F5000')
      .catch(() => []);
    const existingUIDs = new Set(
      existingRows.map(r => (r['เลขคำสั่งซื้อ'] || Object.values(r)[0] || '').trim())
        .filter(Boolean)
    );
    console.log(`[sync] existing UIDs in sheet: ${existingUIDs.size}`);

    // 3. ดึงออเดอร์จาก Unii API (ทีละหน้า, newest first)
    const newOrderRows = [];
    let page = 1;
    let totalPages = 1;
    let fetchedCount = 0;
    let skippedCount = 0;
    let stopEarly = false;

    do {
      const url = `${UNII_BASE}/api/orders/branch/${BRANCH_ID}?page=${page}&limit=${PAGE_SIZE}&sortBy=createdAt:desc`;
      console.log(`[sync] fetching page ${page}/${totalPages}...`);
      const { status: httpStatus, data } = await httpGet(url, uniiToken);

      if (httpStatus !== 200) {
        console.error(`[sync] Unii API error page ${page}:`, httpStatus, data);
        break;
      }

      const orders  = data.data || [];
      const pagination = data.pagination || {};
      totalPages = pagination.totalPages || 1;

      for (const order of orders) {
        const uid = order.uid || '';
        if (!uid) continue;

        if (existingUIDs.has(uid)) {
          skippedCount++;
          // ถ้าเป็น incremental sync (ไม่ใช่ fullSync) และเจอซ้ำแล้ว → หยุด (เดือยในอดีต)
          if (!fullSync && skippedCount >= 10) {
            console.log('[sync] 10 consecutive duplicates — stopping early (incremental mode)');
            stopEarly = true;
            break;
          }
        } else {
          newOrderRows.push(uniiOrderToRow(order));
          fetchedCount++;
        }
      }

      page++;
    } while (page <= totalPages && (fullSync || page <= maxPages) && !stopEarly);

    // 4. Append แถวใหม่เข้า sheet
    if (newOrderRows.length > 0) {
      await sheets.spreadsheets.values.append({
        spreadsheetId: SHEET_ID_ORDERS,
        range: 'คำสั่งซื้อ!A1',
        valueInputOption: 'USER_ENTERED',
        insertDataOption: 'INSERT_ROWS',
        resource: { values: newOrderRows },
      });
      console.log(`[sync] appended ${newOrderRows.length} new orders`);
    }

    res.status(200).json({
      success: true,
      newOrders:    fetchedCount,
      skipped:      skippedCount,
      pagesScanned: page - 1,
      totalPages,
      message: fetchedCount > 0
        ? `Sync สำเร็จ: เพิ่ม ${fetchedCount} ออเดอร์ใหม่ (ข้ามซ้ำ ${skippedCount})`
        : `ไม่มีออเดอร์ใหม่ (สแกน ${page-1} หน้า ข้ามซ้ำ ${skippedCount})`,
    });

  } catch (err) {
    console.error('[supervisor/sync] Error:', err);
    res.status(500).json({ error: 'Internal Server Error', details: err.message });
  }
};
