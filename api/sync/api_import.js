const { getSheetsClient } = require('../lib/sheets');

const SHEET_ID_ORDERS = (process.env.SHEET_ID_ORDERS && process.env.SHEET_ID_ORDERS.length > 20 && !process.env.SHEET_ID_ORDERS.includes('BEWpjZ'))
  ? process.env.SHEET_ID_ORDERS
  : '1m1Cb_BEwPjqF3CgXNssGgjyewIgPNw_BU4EkduuV59U';

const CODE_ALPHABET = "23456789CFGHJMPQRVWX";

/**
 * Decode 10-char Open Location Code (Plus Code) into { lat, lng }
 */
function decodeOLC(code) {
  let clean = String(code).toUpperCase().replace(/\+/g, "");
  let lat = -90, lng = -180;
  let latRes = 20, lngRes = 20;

  for (let i = 0; i < clean.length; i += 2) {
    if (i < 10) {
      const row = CODE_ALPHABET.indexOf(clean[i]);
      const col = CODE_ALPHABET.indexOf(clean[i + 1]);
      if (row === -1 || col === -1) return null;
      lat += row * latRes;
      lng += col * lngRes;
      latRes /= 20;
      lngRes /= 20;
    }
  }
  return {
    lat: Number((lat + latRes * 10).toFixed(6)),
    lng: Number((lng + lngRes * 10).toFixed(6))
  };
}

/**
 * Recover full Plus Code from short code using reference location in Chiang Mai/Lamphun (18.57, 99.00)
 */
function decodePlusCode(addressStr, refLat = 18.57, refLng = 99.00) {
  if (!addressStr) return { lat: '', lng: '' };
  
  // Look for Plus code e.g. "V372+3R8", "H3HV+XF4", "7P52V372+3R8"
  const match = addressStr.match(/([23456789CFGHJMPQRVWX]{4,8}\+[23456789CFGHJMPQRVWX]{2,4})/i);
  if (!match) return { lat: '', lng: '' };

  let raw = match[1].toUpperCase();
  if (raw.replace('+', '').length >= 10) {
    const res = decodeOLC(raw);
    return res ? { lat: String(res.lat), lng: String(res.lng) } : { lat: '', lng: '' };
  }

  // Generate 4-character prefix for Chiang Mai/Lamphun region
  const latVal = Math.floor((refLat + 90) / 20);
  const lngVal = Math.floor((refLng + 180) / 20);
  const latVal2 = Math.floor(((refLat + 90) % 20));
  const lngVal2 = Math.floor(((refLng + 180) % 20));
  const prefix = CODE_ALPHABET[latVal] + CODE_ALPHABET[lngVal] + CODE_ALPHABET[latVal2] + CODE_ALPHABET[lngVal2];

  const fullCode = prefix + raw.replace('+', '');
  const res = decodeOLC(fullCode);
  return res ? { lat: String(res.lat), lng: String(res.lng) } : { lat: '', lng: '' };
}

const https = require('https');

/**
 * Geocode text address via Nominatim (OpenStreetMap) as fallback when Plus Code is not present
 */
function geocodeAddressFallback(query) {
  return new Promise((resolve) => {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1&countrycodes=th`;
    const req = https.get(url, {
      headers: { 'User-Agent': 'UniiMart-DeliveryRouter/1.0' }
    }, res => {
      let b = '';
      res.on('data', c => b += c);
      res.on('end', () => {
        try {
          const d = JSON.parse(b);
          if (d && d.length > 0) resolve({ lat: String(d[0].lat), lng: String(d[0].lon) });
          else resolve({ lat: '', lng: '' });
        } catch (e) { resolve({ lat: '', lng: '' }); }
      });
    });
    req.on('error', () => resolve({ lat: '', lng: '' }));
    req.setTimeout(4000, () => { req.destroy(); resolve({ lat: '', lng: '' }); });
  });
}

/**
 * Resolve coordinates: 1st by Plus Code, 2nd by Address Text Geocoding
 */
async function resolveCoordinates(address, district, province) {
  const plusRes = decodePlusCode(address);
  if (plusRes.lat && plusRes.lng) return plusRes;

  // Try text geocode
  const query = [address.replace(/^[0-9\/\-\s]+/, ''), district, province, 'ประเทศไทย'].filter(Boolean).join(' ');
  const textRes = await geocodeAddressFallback(query);
  if (textRes.lat && textRes.lng) return textRes;

  // Fallback to district + province
  const distQuery = [district, province, 'ประเทศไทย'].filter(Boolean).join(' ');
  return await geocodeAddressFallback(distQuery);
}

/**
 * Normalize phone number for robust comparison (e.g. 0814732461 -> 814732461)
 */
function normalizePhone(phoneStr) {
  let clean = String(phoneStr || '').trim().replace(/[^0-9]/g, '');
  if (clean.startsWith('0')) clean = clean.substring(1);
  if (clean.startsWith('66')) clean = clean.substring(2);
  return clean;
}

/**
 * Format phone number to standard format with "66 " or clean digits
 */
function formatPhone(phoneStr) {
  const norm = normalizePhone(phoneStr);
  return norm ? `66 ${norm}` : '';
}

/**
 * Sync new unique customers from API Import to CS Master tab
 * CRITICAL RULE: Dedup is strictly performed by Normalized Phone Number (Column B)
 * Existing rows in CS Master and records in _PINFIX are NEVER overwritten.
 */
async function syncApiImportToCsMaster(sheets, apiRows) {
  const csRes = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID_ORDERS,
    range: 'CS Master!A1:I3000',
  });

  const csRows = csRes.data.values || [];

  // 1. Build existing phone Set from CS Master Column B (index 1)
  const existingPhones = new Set();
  let lastCsRow = 1;

  csRows.slice(1).forEach((r, idx) => {
    const rawPhone = (r[1] || '').trim();
    const normPhone = normalizePhone(rawPhone);
    if (normPhone) {
      existingPhones.add(normPhone);
      lastCsRow = idx + 2; // 1-indexed row number
    }
  });

  // 2. Also check _PINFIX records to ensure pinfixed customers are strictly protected
  try {
    const pinRes = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID_ORDERS,
      range: '_PINFIX!A2:D500',
    }).catch(() => null);
    if (pinRes && pinRes.data.values) {
      pinRes.data.values.forEach(pr => {
        const pNorm = normalizePhone(pr[0]);
        if (pNorm) existingPhones.add(pNorm);
      });
    }
  } catch (e) {}

  // 3. Find unique new customers from API Import by Phone Number
  const newCustomerList = [];
  const seenInBatch = new Set();

  apiRows.slice(1).forEach(row => {
    const customer = (row[7] || '').trim();
    const rawPhone = (row[8] || '').trim();
    const normPhone = normalizePhone(rawPhone);

    // Dedup condition: Must have valid customer name AND phone not already in CS Master or _PINFIX
    if (!customer || !normPhone || existingPhones.has(normPhone) || seenInBatch.has(normPhone)) return;

    seenInBatch.add(normPhone);

    const phone = formatPhone(rawPhone);
    const address = (row[9] || '').trim();
    const district = (row[10] || '').trim();
    const province = (row[11] || '').trim();
    const districtProvince = [district, province].filter(Boolean).join(', ');
    const apiLat = (row[17] || '').trim(); // Col R: Latitude
    const apiLng = (row[18] || '').trim(); // Col S: Longitude

    newCustomerList.push({
      customer,
      phone,
      normPhone,
      districtProvince,
      address,
      district,
      province,
      apiLat,
      apiLng
    });
  });

  if (newCustomerList.length === 0) {
    return { count: 0, message: 'ไม่มีลูกค้าใหม่ใน CS Master (ตรวจสอบด้วยเบอร์โทรศัพท์)' };
  }

  // Resolve coordinates for each new customer (1st: Col R/S from API Import, 2nd: Plus Code, 3rd: Geocoding Fallback)
  const newCustomers = [];
  for (const item of newCustomerList) {
    let lat = item.apiLat;
    let lng = item.apiLng;

    if (!lat || !lng) {
      const geo = await resolveCoordinates(item.address, item.district, item.province);
      lat = geo.lat || '';
      lng = geo.lng || '';
    }

    const mapLink = (lat && lng) ? `https://www.google.com/maps?q=${lat},${lng}` : '';

    newCustomers.push([
      item.customer,         // Col A: ชื่อลูกค้า
      item.phone || '',      // Col B: เบอร์โทร
      item.districtProvince || '', // Col C: อำเภอ, จังหวัด
      item.address || '',    // Col D: ที่อยู่
      '',                    // Col E: ที่อยู่ใบกำกับภาษี
      '',                    // Col F: เลขใบกำกับภาษี
      lat || '',             // Col G: ละติจูด
      lng || '',             // Col H: ลองติจูด
      mapLink || ''          // Col I: ลิ้ง
    ]);
  }

  const startRow = lastCsRow + 1;
  const endRow = startRow + newCustomers.length - 1;

  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID_ORDERS,
    range: `CS Master!A${startRow}:I${endRow}`,
    valueInputOption: 'USER_ENTERED',
    resource: {
      values: newCustomers
    }
  });

  console.log(`[CS Master Sync] เพิ่มลูกค้าใหม่ ${newCustomers.length} รายการลงใน CS Master!A${startRow}:I${endRow} เรียบร้อยแล้ว`);

  return {
    count: newCustomers.length,
    startRow,
    endRow,
    customers: newCustomers.map(r => ({ name: r[0], phone: r[1], district: r[2], lat: r[6], lng: r[7] }))
  };
}

/**
 * Main Sync function: reads API Import and syncs to both คำสั่งซื้อ (Col F) and CS Master (Cols A-I)
 */
async function syncApiImportToOrders() {
  const sheets = getSheetsClient();

  // 1. Read API Import tab (A to T) & คำสั่งซื้อ tab in parallel
  const [apiRes, ordersRes] = await Promise.all([
    sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID_ORDERS,
      range: 'API Import!A1:T5000',
    }),
    sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID_ORDERS,
      range: 'คำสั่งซื้อ!F1:F5000',
    })
  ]);

  const apiRows = apiRes.data.values || [];
  const orderColFRows = ordersRes.data.values || [];

  if (apiRows.length <= 1) {
    return { success: true, importedCount: 0, csMasterCount: 0, message: 'API Import is empty' };
  }

  // 2. Sync unique customers to CS Master
  let csSyncResult = { count: 0 };
  try {
    csSyncResult = await syncApiImportToCsMaster(sheets, apiRows);
  } catch (csErr) {
    console.error('[CS Master Sync Error]', csErr);
  }

  // 3. Build existing UID Set from คำสั่งซื้อ (Column F)
  const existingUIDs = new Set();
  let lastOrderRow = 1;
  orderColFRows.slice(1).forEach((row, idx) => {
    const uid = (row[0] || '').trim();
    if (uid) {
      existingUIDs.add(uid);
      lastOrderRow = idx + 2;
    }
  });

  // 4. Filter new unique orders from API Import
  const newOrders = [];
  apiRows.slice(1).forEach(row => {
    const uid = (row[1] || '').trim();
    if (!uid || existingUIDs.has(uid)) return;

    const customer = (row[7] || '').trim();
    const orderTimeStr = (row[12] || '').trim();
    const parsedOrder = new Date(orderTimeStr);
    const orderTimeMs = !isNaN(parsedOrder.getTime()) ? parsedOrder.getTime() : 0;

    newOrders.push({
      uid,
      customer,
      orderTimeStr,
      orderTimeMs
    });
  });

  if (newOrders.length === 0) {
    return {
      success: true,
      importedCount: 0,
      csMasterCount: csSyncResult.count || 0,
      message: csSyncResult.count > 0
        ? `เพิ่มลูกค้าใหม่ ${csSyncResult.count} รายการลงใน CS Master เรียบร้อยแล้ว (ไม่มีออเดอร์ใหม่ในคำสั่งซื้อ)`
        : 'ไม่มีออเดอร์และลูกค้าใหม่ ข้อมูลเป็นปัจจุบันแล้ว'
    };
  }

  // 5. Sort new orders chronologically ascending (older to newest order time)
  // so the latest ordered items are appended down continuously in Column F
  newOrders.sort((a, b) => a.orderTimeMs - b.orderTimeMs);

  const startRow = lastOrderRow + 1;
  const endRow = startRow + newOrders.length - 1;

  // 6. Construct single-column values for Column F only (เลขคำสั่งซื้อ)
  const uidsToFill = newOrders.map(o => [o.uid]);

  // 7. Update ONLY Column F range (e.g. คำสั่งซื้อ!F2705:F2709)
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID_ORDERS,
    range: `คำสั่งซื้อ!F${startRow}:F${endRow}`,
    valueInputOption: 'USER_ENTERED',
    resource: {
      values: uidsToFill
    }
  });

  console.log(`[API Import Sync] เติมเฉพาะเลขคำสั่งซื้อ ${newOrders.length} รายการลงในคำสั่งซื้อ!F${startRow}:F${endRow} เรียบร้อยแล้ว`);

  return {
    success: true,
    importedCount: newOrders.length,
    csMasterCount: csSyncResult.count || 0,
    startRow,
    endRow,
    importedOrders: newOrders.map(o => ({ id: o.uid, customer: o.customer, orderTime: o.orderTimeStr })),
    message: `เติมเลขคำสั่งซื้อ ${newOrders.length} รายการลงแถว F${startRow}:F${endRow} และเพิ่มลูกค้าใหม่ ${csSyncResult.count || 0} รายการลงใน CS Master เรียบร้อยแล้ว`
  };
}

module.exports = {
  syncApiImportToOrders,
  syncApiImportToCsMaster
};
