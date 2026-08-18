/**
 * api/lib/orders.js
 * =================
 * ฟังก์ชันกลางสำหรับจัดการข้อมูลออเดอร์จากหลายแหล่ง
 *
 * ลำดับแหล่งข้อมูล:
 *   1. API Import  → หลัก (สถานะ, พิกัด, ยอดขาย, วันที่บันทึก)
 *   2. คำสั่งซื้อ  → เสริม (Picker, หมายเหตุ, วันที่จะจัดส่ง=คอลัมน์ B)
 *   3. CS Master   → พิกัด/เบอร์ที่ยืนยันแล้ว (สูงกว่า API Import)
 */

'use strict';

// ---------------------------------------------------------------------------
// normalizePhone — แปลงรูปแบบเบอร์ให้เป็น 0xxxxxxxxx เสมอ
//
// รองรับรูปแบบทั้งหมดที่พบจริงในระบบ:
//   คำสั่งซื้อ   : "082-384-8337"    → 0823848337  (10 หลัก มี dash)
//   CS Master    : "66 823848337"    → 0823848337  (11 หลัก มี space)
//   API Import   : 832033707         → 0832033707  (9 หลัก! Google Sheets ตัด 0 ออก)
//   รูปแบบอื่น   : 66823848337       → 0823848337  (11 หลัก ไม่มี space)
//                 +66823848337       → 0823848337  (มี +)
//                 0082-384-8337      → 0823848337  (มี 00 นำหน้า)
// ---------------------------------------------------------------------------
function normalizePhone(raw) {
  if (!raw && raw !== 0) return '';

  // รองรับ Number type (Google Sheets ส่ง numeric cells มาเป็น number)
  let str = String(raw).trim();
  if (!str) return '';

  // ลบทุกอย่างที่ไม่ใช่ตัวเลข
  let digits = str.replace(/\D/g, '');

  if (!digits) return '';

  // 66 XXXXXXXXX หรือ 66XXXXXXXXX → 0xxxxxxxxx (11 หลัก ขึ้นต้น 66 ไม่ใช่ 660)
  if (digits.startsWith('66') && !digits.startsWith('660') && digits.length === 11) {
    digits = '0' + digits.slice(2);
  }

  // 00XXXXXXXXX → 0xxxxxxxxx (11 หลัก ขึ้นต้น 00 เช่น 0082-384-8337 → 00823848337)
  if (digits.startsWith('00') && digits.length === 11) {
    digits = '0' + digits.slice(2);
  }
  // 00XXXXXXXXXX → 0xxxxxxxxx (12 หลัก กรณีพิเศษ)
  if (digits.startsWith('00') && digits.length === 12) {
    digits = digits.slice(2);
    if (!digits.startsWith('0')) digits = '0' + digits;
  }

  // 🔑 แก้ปัญหา Google Sheets ตัด 0 นำหน้าออก:
  // เบอร์มือถือไทยทั้งหมดขึ้นต้น 06x / 08x / 09x
  // ถ้า digits เป็น 9 หลักและขึ้นต้นด้วย 6, 8 หรือ 9 → เติม 0 นำหน้า
  if (digits.length === 9 && /^[689]/.test(digits)) {
    digits = '0' + digits;
  }

  // ผลลัพธ์ควรเป็น 10 หลักขึ้นต้น 0
  return digits;
}


// ---------------------------------------------------------------------------
// ACTIVE_STATUSES — สถานะที่ "ยังต้องส่ง"
// กรองออก: ยกเลิก / ส่งสำเร็จ / ได้รับแล้ว (ค่าจาก API Import)
// ---------------------------------------------------------------------------
const CANCELLED_STATUSES = new Set([
  'ยกเลิก',
  'ส่งสำเร็จ',
  'ได้รับแล้ว',
  'cancelled',
  'delivered',
  'received'
]);

function isActiveOrder(apiStatus) {
  if (!apiStatus) return true; // ถ้าไม่มีสถานะถือว่า active
  return !CANCELLED_STATUSES.has(apiStatus.trim());
}

// ---------------------------------------------------------------------------
// mergeOrderSources
// รับ rows จาก 3 แหล่ง → คืน array ของออเดอร์ที่ merge แล้ว
//
// @param {Object[]} apiImportRows   — rows จาก API Import (gid 665542805)
// @param {Object[]} orderRows       — rows จาก คำสั่งซื้อ (gid 0)
// @param {Object[]} csMasterRows    — rows จาก CS Master
// @returns {Object[]}
// ---------------------------------------------------------------------------
function mergeOrderSources(apiImportRows, orderRows, csMasterRows) {
  // --- Build lookup: Order UID → คำสั่งซื้อ row ---
  const orderMap = {};
  for (const row of orderRows) {
    // ลอง keys ที่เป็นไปได้สำหรับ Order UID
    const uid = (
      row['Order UID'] ||
      row['เลขคำสั่งซื้อ'] ||
      row['order_uid'] ||
      ''
    ).trim();
    if (uid) orderMap[uid] = row;
  }

  // --- Build lookup: normalizedPhone → CS Master row ---
  const csMasterPhoneMap = {};
  const csMasterDuplicates = []; // เบอร์ซ้ำใน CS Master

  for (const row of csMasterRows) {
    // หาคอลัมน์เบอร์โทร — ลองหลายชื่อ
    const rawPhone = (
      row['เบอร์โทร'] ||
      row['Phone'] ||
      row['phone'] ||
      row['เบอร์'] ||
      row['เบอร์โทรศัพท์'] ||
      ''
    ).trim();

    const normalized = normalizePhone(rawPhone);
    if (!normalized) continue;

    if (csMasterPhoneMap[normalized]) {
      csMasterDuplicates.push({ phone: normalized, raw: rawPhone });
    }
    csMasterPhoneMap[normalized] = row;
  }

  if (csMasterDuplicates.length > 0) {
    console.warn(`[orders.js] พบเบอร์ซ้ำใน CS Master: ${csMasterDuplicates.length} รายการ`);
  }

  // --- Merge API Import (primary) + คำสั่งซื้อ (supplemental) + CS Master ---
  const merged = [];

  for (const apiRow of apiImportRows) {
    // Order UID — ลองหลาย key
    const uid = (
      apiRow['Order UID'] ||
      apiRow['เลขคำสั่งซื้อ'] ||
      apiRow['order_uid'] ||
      apiRow['UID'] ||
      ''
    ).trim();

    if (!uid) continue;

    // สถานะจาก API Import เป็นหลัก
    const apiStatus = (
      apiRow['สถานะ'] ||
      apiRow['Status'] ||
      apiRow['status'] ||
      ''
    ).trim();

    // เบอร์โทรจาก API Import (ใช้ normalize แล้วค้นหาใน CS Master)
    const rawPhoneApi = (
      apiRow['เบอร์โทร'] ||
      apiRow['Phone Number'] ||
      apiRow['Phone'] ||
      apiRow['phone'] ||
      ''
    ).trim();
    const normalizedPhone = normalizePhone(rawPhoneApi);

    // Supplement จาก คำสั่งซื้อ
    const supRow = orderMap[uid] || {};

    // วันที่จะจัดส่ง — ต้องมาจากคอลัมน์ B ของ คำสั่งซื้อ เท่านั้น
    const deliveryDate = (supRow['วันที่จะจัดส่ง'] || '').trim();
    const noDeliveryDate = !deliveryDate; // ห้าม fallback

    // พิกัด: เริ่มจาก API Import → ถ้ามีใน CS Master ให้ใช้แทน
    let lat = parseFloat(apiRow['Latitude'] || apiRow['latitude'] || apiRow['CS_Lat'] || '') || 0;
    let lng = parseFloat(apiRow['Longitude'] || apiRow['longitude'] || apiRow['CS_Long'] || '') || 0;
    let coordSource = 'api_import';

    // CS Master lookup
    const csRow = normalizedPhone ? csMasterPhoneMap[normalizedPhone] : null;
    let inCsMaster = false;

    if (csRow) {
      inCsMaster = true;
      // พิกัดจาก CS Master — ลองหลายชื่อคอลัมน์
      const csLat = parseFloat(
        csRow['ละ'] || csRow['Lat'] || csRow['lat'] || csRow['Latitude'] || csRow['latitude'] || ''
      );
      const csLng = parseFloat(
        csRow['ลอง'] || csRow['Lng'] || csRow['lng'] || csRow['Longitude'] || csRow['longitude'] || ''
      );
      if (!isNaN(csLat) && !isNaN(csLng) && csLat !== 0 && csLng !== 0) {
        lat = csLat;
        lng = csLng;
        coordSource = 'cs_master';
      }
    }

    // ราคา
    const priceStr = (apiRow['ยอดขายรวม'] || apiRow['Total'] || '').replace(/,/g, '');
    const price = parseFloat(priceStr) || 0;

    // การจ่ายเงิน
    const paymentType = (apiRow['การจ่ายเงิน'] || apiRow['Payment'] || '').trim();
    const cod = paymentType.toLowerCase().includes('cash on delivery') ||
                paymentType.toLowerCase().includes('cod');

    // วันที่จาก API Import (สำหรับรายงาน/audit เท่านั้น)
    const orderPlacedAt  = (apiRow['วันที่สั่ง']        || apiRow['Order Date']    || '').trim();
    const syncDeliveryAt = (apiRow['วันที่จัดส่ง']      || apiRow['Delivery Date'] || '').trim();
    const deliveredAt    = (apiRow['วันที่ส่งสำเร็จ']   || '').trim();
    const updatedAt      = (apiRow['วันที่อัปเดต']      || apiRow['Updated At']    || '').trim();

    merged.push({
      // --- Identity ---
      uid,
      id: uid, // alias ที่ app.js ใช้อยู่

      // --- Customer ---
      customer: (
        apiRow['ชื่อลูกค้า'] || apiRow['Customer Name'] || apiRow['Customer'] || ''
      ).trim(),
      phone: rawPhoneApi,
      normalizedPhone,
      inCsMaster,
      address: (apiRow['ที่อยู่'] || apiRow['Address'] || apiRow['ที่อยู่จาก Unii'] || '').trim(),
      district: (apiRow['อำเภอ, จังหวัด'] || apiRow['District'] || '').trim(),

      // --- Location ---
      lat: parseFloat(lat.toFixed ? lat.toFixed(5) : lat),
      lng: parseFloat(lng.toFixed ? lng.toFixed(5) : lng),
      coordSource,
      isPinModified: coordSource === 'cs_master' || coordSource === 'pinfix',

      // --- Financial ---
      price,
      cod,
      paymentType,

      // --- Status (API Import = หลัก) ---
      apiStatus,
      rawStatus: apiStatus,

      // --- Delivery Date (คำสั่งซื้อ col B = ตัวกรองหน้าคนขับ) ---
      deliveryDate,     // วันที่จะจัดส่ง (ว่าง = noDeliveryDate)
      timeWindow: deliveryDate, // alias ที่ app.js ใช้
      noDeliveryDate,

      // --- Dates from API Import (สำหรับรายงาน/audit) ---
      orderPlacedAt,
      syncDeliveryAt,
      deliveredAt,
      updatedAt,

      // --- Supplement from คำสั่งซื้อ ---
      picker:  (supRow['Picker']    || '').trim(),
      remark:  (supRow['หมายเหตุ']  || '').trim(),
      taxNote: (supRow['ใบกำกับภาษี/หมายเหตุเดิม'] || '').trim(),
      driver:  (supRow['คนส่ง']     || '').trim(), // อ่านเท่านั้น (เขียนใน Phase 3)

      // --- Metadata ---
      isUrgent: false,
    });
  }

  return merged;
}

// ---------------------------------------------------------------------------
// filterActiveOrders — กรองเฉพาะออเดอร์ที่ "ยังต้องส่ง"
// ---------------------------------------------------------------------------
function filterActiveOrders(orders) {
  return orders.filter(o => isActiveOrder(o.apiStatus));
}

// ---------------------------------------------------------------------------
// filterByDeliveryDate — กรองตามวันที่จะจัดส่ง (คอลัมน์ B คำสั่งซื้อ)
// ถ้า date ว่าง = ดึงทั้งหมด (สำหรับ supervisor)
// ห้าม fallback: แถวที่ deliveryDate ว่างต้องอยู่ใน noDeliveryDate เสมอ
// ---------------------------------------------------------------------------
function filterByDeliveryDate(orders, date) {
  if (!date || date === 'all') return orders;
  return orders.filter(o => o.deliveryDate === date);
}

// ---------------------------------------------------------------------------
// splitByDeliveryDate — แยกเป็น 2 กลุ่มสำหรับ supervisor
// ---------------------------------------------------------------------------
function splitByDeliveryDate(orders, date) {
  const withDate = orders.filter(o => !o.noDeliveryDate);
  const withoutDate = orders.filter(o => o.noDeliveryDate); // รายการต้องเคลียร์

  const filtered = date && date !== 'all'
    ? withDate.filter(o => o.deliveryDate === date)
    : withDate;

  return { orders: filtered, pendingSchedule: withoutDate };
}

module.exports = {
  normalizePhone,
  mergeOrderSources,
  filterActiveOrders,
  filterByDeliveryDate,
  splitByDeliveryDate,
  isActiveOrder,
  CANCELLED_STATUSES,
};
