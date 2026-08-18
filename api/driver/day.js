/**
 * api/driver/day.js
 * ==================
 * GET /api/driver/day?date=YYYY-MM-DD
 *
 * แหล่งข้อมูล (ตามลำดับความสำคัญ):
 *   1. API Import  (gid 665542805) — หลัก: สถานะ, พิกัด, ยอดขาย, วันที่บันทึก
 *   2. คำสั่งซื้อ  (gid 0)          — เสริม: Picker, หมายเหตุ, วันที่จะจัดส่ง (col B)
 *   3. CS Master                   — พิกัด/เบอร์ที่ยืนยันแล้ว (สูงกว่า API Import)
 *
 * ตัวกรองวันที่: ใช้คอลัมน์ B "วันที่จะจัดส่ง" ของ คำสั่งซื้อ เท่านั้น
 *   - ถ้าว่าง → noDeliveryDate:true (ไม่ fallback ไปวันที่อื่น)
 *   - ห้ามใช้ AutoR หรือคอลัมน์ที่อยู่จัดโซน
 */

'use strict';

const { verifyToken } = require('../lib/jwt');
const { getSheetsClient, getSheetRowsById, getSheetRows, ensureSheetExists } = require('../lib/sheets');
const { classifyOrderZone } = require('../lib/zones');
const { getDriverProfile } = require('../lib/drivers');
const {
  normalizePhone,
  mergeOrderSources,
  filterActiveOrders,
  filterByDeliveryDate,
} = require('../lib/orders');

// Sheet IDs และ gids
const SHEET_ID_ORDERS = process.env.SHEET_ID_ORDERS;
const GID_API_IMPORT  = 665542805; // API Import
const GID_ORDERS      = 0;         // คำสั่งซื้อ

module.exports = async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization'
  );

  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'GET') { res.status(405).json({ error: 'Method Not Allowed' }); return; }

  try {
    const { date, driverToken } = req.query;
    const authHeader = req.headers.authorization;
    const token = driverToken || (authHeader && authHeader.split(' ')[1]);

    if (!token) {
      res.status(401).json({ error: 'Unauthorized: Missing token' }); return;
    }
    const decoded = verifyToken(token);
    if (!decoded || !['driver', 'supervisor', 'admin', 'administrator'].includes(decoded.role)) {
      res.status(401).json({ error: 'Unauthorized: Invalid token' }); return;
    }

    const driverProfile = getDriverProfile(decoded.username);
    const sheets = getSheetsClient();

    // --- Self-healing sheets ---
    await ensureSheetExists(sheets, SHEET_ID_ORDERS, '_ASSIGN', [
      'order_id', 'status', 'assigned_driver', 'completed_at', 'lat', 'lng', 'driver_note', 'priority', 'hold'
    ]);
    await ensureSheetExists(sheets, SHEET_ID_ORDERS, '_PINFIX', [
      'phone_number', 'lat', 'lng', 'updated_at', 'actor', 'source'
    ]);

    // --- อ่านข้อมูลจาก 3 แหล่ง แบบ parallel ---
    const [apiImportRows, orderRows, csMasterRows, assignments, pinfixes] = await Promise.all([
      // 1. API Import (primary)
      getSheetRowsById(sheets, SHEET_ID_ORDERS, GID_API_IMPORT, 'A1:ZZ5000')
        .catch(e => { console.warn('[driver/day] API Import:', e.message); return []; }),

      // 2. คำสั่งซื้อ (supplemental: วันที่จะจัดส่ง, Picker, หมายเหตุ)
      getSheetRowsById(sheets, SHEET_ID_ORDERS, GID_ORDERS, 'A1:AC5000')
        .catch(e => { console.warn('[driver/day] คำสั่งซื้อ:', e.message); return []; }),

      // 3. CS Master (พิกัดที่ยืนยันแล้ว)
      getSheetRows(sheets, SHEET_ID_ORDERS, 'CS Master!A1:ZZ5000')
        .catch(e => { console.warn('[driver/day] CS Master:', e.message); return []; }),

      // 4. _ASSIGN overrides
      getSheetRows(sheets, SHEET_ID_ORDERS, '_ASSIGN!A1:I5000')
        .catch(() => []),

      // 5. _PINFIX log (audit) — ไม่ใช่แหล่งพิกัดหลัก (CS Master คือแหล่งหลัก)
      getSheetRows(sheets, SHEET_ID_ORDERS, '_PINFIX!A1:F2000')
        .catch(() => []),
    ]);

    // --- Merge แหล่งข้อมูล ---
    const merged = mergeOrderSources(apiImportRows, orderRows, csMasterRows);

    // --- กรองเฉพาะออเดอร์ที่ยังต้องส่ง ---
    const active = filterActiveOrders(merged);

    // --- กรองตาม deliveryDate (คอลัมน์ B คำสั่งซื้อ เท่านั้น) ---
    // ถ้าว่าง → noDeliveryDate:true → ไม่แสดงในรายการคนขับ
    const deliveryFiltered = date && date !== 'all'
      ? active.filter(o => !o.noDeliveryDate && o.deliveryDate === date)
      : active.filter(o => !o.noDeliveryDate);

    // --- Build assignment map (last-wins) ---
    const assignmentMap = {};
    assignments.forEach(row => {
      if (row.order_id) assignmentMap[row.order_id] = row;
    });

    // --- Apply assignment overrides + zone filter ---
    const orders = deliveryFiltered.map(order => {
      const uid = order.uid;
      let { lat, lng, coordSource, isPinModified } = order;

      // Classify zone จากพิกัดเท่านั้น (ห้ามใช้ AutoR)
      const geojsonZone = classifyOrderZone(lat, lng);

      // Resolve status จาก _ASSIGN
      const override = assignmentMap[uid];
      let status = 'available';
      let assignedDriverId = '';
      let driverNote = '';

      if (override) {
        assignedDriverId = override.assigned_driver || '';
        driverNote = override.driver_note || '';

        if (override.status === 'done' || override.status === 'failed') {
          status = override.status;
        } else if (override.status === 'mine') {
          status = override.assigned_driver === driverProfile.code ? 'mine' : 'other_mine';
        } else if (override.status === 'released') {
          status = 'available';
          assignedDriverId = '';
        }
      }

      // Zone filter สำหรับ driver (ไม่กรองถ้าเป็น special driver)
      if (status === 'available') {
        const isMyZone = geojsonZone === driverProfile.zone;
        if (!driverProfile.isSpecial && !isMyZone) {
          status = 'out';
        }
      }

      return {
        // Identity
        id:               uid,
        uid,
        // Customer
        customer:         order.customer,
        phone:            order.phone,
        address:          order.address,
        district:         order.district,
        // Location
        lat:              parseFloat(lat.toFixed(5)),
        lng:              parseFloat(lng.toFixed(5)),
        isPinModified,
        coordSource,
        inCsMaster:       order.inCsMaster,
        geojsonZone,
        // Financial
        price:            order.price,
        cod:              order.cod,
        paymentType:      order.paymentType,
        // Dates
        deliveryDate:     order.deliveryDate,   // คอลัมน์ B คำสั่งซื้อ
        timeWindow:       order.deliveryDate,   // alias
        orderPlacedAt:    order.orderPlacedAt,  // จาก API Import (audit)
        syncDeliveryAt:   order.syncDeliveryAt,
        deliveredAt:      order.deliveredAt,
        updatedAt:        order.updatedAt,
        // Status
        status,
        apiStatus:        order.apiStatus,
        rawStatus:        order.apiStatus,
        assignedDriverId,
        driverNote,
        // Supplement จาก คำสั่งซื้อ
        picker:           order.picker,
        remark:           order.remark,
        // Meta
        isUrgent:         false,
      };
    });

    res.status(200).json({ success: true, orders });

  } catch (err) {
    console.error('[driver/day] Error:', err);
    res.status(500).json({ error: 'Internal Server Error', details: err.message });
  }
};
