/**
 * sync-from-csv.js
 * ==================
 * แปลง orders.csv (export จาก Google Sheets) → orders_data.json
 *
 * วิธีใช้:
 *   1. Export sheet แท็บ "คำสั่งซื้อ" เป็น CSV → บันทึกทับ orders.csv ในโฟลเดอร์นี้
 *   2. รัน:  node sync-from-csv.js
 *   3. Refresh หน้าเว็บ — ข้อมูลอัปเดตทันที (ไม่ต้อง restart server)
 */

const fs = require('fs');
const path = require('path');

const CSV_PATH   = path.join(__dirname, 'orders.csv');
const OUT_PATH   = path.join(__dirname, 'orders_data.json');

// --- Zones (copied from app.js / zones.js) ---
const GEOJSON_ZONES = {
  "Zone A  —  เมืองลำพูน":     [[18.48,98.95],[18.66,98.95],[18.66,99.12],[18.48,99.12]],
  "Zone B  —  สารภี/เชียงใหม่": [[18.66,98.90],[18.85,98.90],[18.85,99.12],[18.66,99.12]],
  "Zone C  —  ป่าซาง":          [[18.35,98.75],[18.48,98.75],[18.48,98.95],[18.35,98.95]]
};

function pointInPolygon(point, vs) {
  const x = point[0], y = point[1];
  let inside = false;
  for (let i = 0, j = vs.length - 1; i < vs.length; j = i++) {
    const xi = vs[i][0], yi = vs[i][1];
    const xj = vs[j][0], yj = vs[j][1];
    const intersect = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

function classifyZone(lat, lng) {
  if (!lat || !lng || lat < 17.9 || lat > 19.3 || lng < 98.4 || lng > 99.6) {
    return 'UNASSIGNED';
  }
  for (const [zoneName, polygon] of Object.entries(GEOJSON_ZONES)) {
    if (pointInPolygon([lat, lng], polygon)) return zoneName;
  }
  return 'UNASSIGNED';
}

// --- CSV Parser (RFC 4180 compliant) ---
function parseCSV(text) {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  
  function parseLine(line) {
    const result = [];
    let inQuote = false, cur = '';
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuote && line[i+1] === '"') { cur += '"'; i++; }
        else { inQuote = !inQuote; }
      } else if (ch === ',' && !inQuote) {
        result.push(cur.trim());
        cur = '';
      } else {
        cur += ch;
      }
    }
    result.push(cur.trim());
    return result;
  }

  const headers = parseLine(lines[0]).map(h => h.trim());
  const rows = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const vals = parseLine(line);
    const obj = {};
    headers.forEach((h, idx) => {
      obj[h] = vals[idx] !== undefined ? vals[idx] : '';
    });
    rows.push(obj);
  }
  return rows;
}

// --- Main ---
function main() {
  if (!fs.existsSync(CSV_PATH)) {
    console.error('❌ ไม่พบไฟล์ orders.csv');
    console.error('   → Export Google Sheets แท็บ "คำสั่งซื้อ" เป็น CSV แล้ววางในโฟลเดอร์นี้');
    process.exit(1);
  }

  const csvText = fs.readFileSync(CSV_PATH, 'utf8');
  const rawRows = parseCSV(csvText);

  console.log(`📄 อ่าน CSV: ${rawRows.length} แถว`);

  // --- Build output orders ---
  const orders = [];
  let skipped = 0;

  for (const row of rawRows) {
    const id = (row['เลขคำสั่งซื้อ'] || '').trim();
    if (!id || !id.startsWith('UM-')) { skipped++; continue; }

    const lat = parseFloat(row['CS_Lat']) || 0;
    const lng = parseFloat(row['CS_Long']) || 0;

    let price = 0;
    const priceStr = (row['ยอดขายรวม'] || '').replace(/,/g, '');
    if (priceStr) price = parseFloat(priceStr) || 0;

    const paymentType = row['การจ่ายเงิน'] || '';
    const cod = paymentType.toLowerCase().includes('cash on delivery');

    const geojsonZone = classifyZone(lat, lng);
    const isOutOfBounds = geojsonZone === 'UNASSIGNED';

    const roundedLat = parseFloat(lat.toFixed(5));
    const roundedLng = parseFloat(lng.toFixed(5));

    orders.push({
      id,
      customer:          row['ชื่อลูกค้า'] || '',
      customerName:      row['ชื่อลูกค้า'] || '',   // alias for supervisor.js
      name:              row['ชื่อลูกค้า'] || '',   // alias
      phone:             row['Phone Number'] || '',
      address:           row['ที่อยู่จาก Unii'] || '',
      district:          row['อำเภอ, จังหวัด'] || '',
      lat:               roundedLat,
      lng:               roundedLng,
      origLat:           lat,
      origLng:           lng,
      isPinModified:     false,
      price,
      cod,
      paymentType,
      timeWindow:        row['วันที่จะจัดส่ง'] || '',
      orderDate:         row['วันเวลาที่สั่ง'] || '',
      status:            'available',
      rawStatus:         row['Status'] || '',
      assignedDriverId:  '',
      driverNote:        '',
      geojsonZone,
      isOutOfBounds,
      distance_wh:       parseFloat(row['far_from_wh']) || 0,
      isUrgent:          false,
      autoR:             row['AutoR'] || '',
      picker:            row['Picker'] || '',
      remark:            row['หมายเหตุ'] || ''
    });
  }

  // --- Date summary ---
  const dateCounts = {};
  orders.forEach(o => {
    if (o.timeWindow) dateCounts[o.timeWindow] = (dateCounts[o.timeWindow] || 0) + 1;
  });
  const sortedDates = Object.keys(dateCounts).sort((a, b) => {
    const pa = a.split('/').map(Number);
    const pb = b.split('/').map(Number);
    if (pa.length < 3 || pb.length < 3) return 0;
    return new Date(pa[2], pa[0]-1, pa[1]) - new Date(pb[2], pb[0]-1, pb[1]);
  });

  console.log(`✅ แปลงสำเร็จ: ${orders.length} ออเดอร์ (ข้าม ${skipped} แถว)`);
  console.log(`📅 วันที่มีข้อมูล (${sortedDates.length} วัน):`);
  sortedDates.slice(-10).forEach(d => {
    console.log(`   ${d}: ${dateCounts[d]} จุด`);
  });

  fs.writeFileSync(OUT_PATH, JSON.stringify(orders, null, 2), 'utf8');
  console.log(`\n💾 เขียน orders_data.json เรียบร้อย (${(fs.statSync(OUT_PATH).size / 1024).toFixed(0)} KB)`);
  console.log('🔄 Refresh หน้าเว็บได้เลย — ไม่ต้อง restart server');
}

main();
