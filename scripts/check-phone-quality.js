#!/usr/bin/env node
/**
 * scripts/check-phone-quality.js
 * ================================
 * ตรวจสอบคุณภาพเบอร์โทรในระบบก่อนเริ่ม Phase 3
 *
 * รายงาน:
 *   1. รูปแบบเบอร์โทรทั้งหมดที่พบใน API Import และ คำสั่งซื้อ
 *   2. % ที่ normalize แล้วจับคู่กับ CS Master ได้จริง
 *   3. เบอร์ซ้ำภายใน CS Master เอง
 *   4. edge case ที่ normalizePhone() อาจแปลงผิด
 *
 * วิธีรัน:
 *   GOOGLE_SERVICE_ACCOUNT_EMAIL=xxx GOOGLE_PRIVATE_KEY=xxx \
 *   SHEET_ID_ORDERS=1m1Cb_BEwPjqF3CgXNssGgjyewIgPNw_BU4EkduuV59U \
 *   node scripts/check-phone-quality.js
 *
 * (หรือใส่ใน .env แล้วรัน: node -r dotenv/config scripts/check-phone-quality.js)
 */

'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { getSheetsClient, getSheetRows } = require('../api/lib/sheets');
const { normalizePhone } = require('../api/lib/orders');

// ---
const SHEET_ID_ORDERS = process.env.SHEET_ID_ORDERS || '1m1Cb_BEwPjqF3CgXNssGgjyewIgPNw_BU4EkduuV59U';

// gid สำหรับ API Import (กรณีชื่อแท็บมีปัญหา encoding ใช้ชื่อตรงไปก่อน)
const RANGES = {
  apiImport:   'API Import!A1:ZZ5000',
  orders:      'คำสั่งซื้อ!A1:AC5000',
  csMaster:    'CS Master!A1:ZZ5000',
};

// คอลัมน์เบอร์ที่เป็นไปได้ใน CS Master
const CS_PHONE_KEYS = ['เบอร์โทร', 'Phone', 'phone', 'เบอร์', 'เบอร์โทรศัพท์', 'Tel', 'tel'];
// คอลัมน์เบอร์ใน API Import
const API_PHONE_KEYS = ['เบอร์โทร', 'Phone Number', 'Phone', 'phone'];

// ---
function classifyPhonePattern(raw) {
  if (!raw) return 'ว่าง';
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 0) return 'ไม่มีตัวเลข';
  if (/^\d{3}-\d{3}-\d{4}$/.test(raw)) return 'xxx-xxx-xxxx';
  if (/^0\d{9}$/.test(raw)) return '0xxxxxxxxx';
  if (digits.length === 10 && raw === digits) return '0xxxxxxxxx (ไม่มี dash)';
  if (digits.startsWith('66') && digits.length === 11) return '66xxxxxxxxx (รหัสประเทศ)';
  if (raw.startsWith('+66')) return '+66xxxxxxxxx';
  if (digits.length === 9 && digits.startsWith('8')) return '8xxxxxxxx (ขาด 0 นำหน้า)';
  if (digits.length < 9) return `สั้นเกิน (${digits.length} หลัก): ${raw.slice(0,10)}`;
  if (digits.length > 11) return `ยาวเกิน (${digits.length} หลัก)`;
  return `อื่นๆ: ${raw.slice(0,15)}`;
}

function findPhoneKey(row, keys) {
  for (const k of keys) {
    if (row[k] !== undefined && row[k] !== '') return row[k];
  }
  return '';
}

async function main() {
  console.log('\n🔍 ตรวจสอบคุณภาพเบอร์โทร — เชื่อมต่อ Google Sheets...\n');

  const sheets = getSheetsClient();

  // --- อ่านข้อมูล ---
  console.log('📥 อ่าน API Import...');
  let apiRows = [];
  try {
    apiRows = await getSheetRows(sheets, SHEET_ID_ORDERS, RANGES.apiImport);
    console.log(`   → ${apiRows.length} แถว`);
  } catch (e) {
    console.warn(`   ⚠️  ไม่สามารถอ่าน API Import: ${e.message}`);
  }

  console.log('📥 อ่าน คำสั่งซื้อ...');
  let orderRows = [];
  try {
    orderRows = await getSheetRows(sheets, SHEET_ID_ORDERS, RANGES.orders);
    console.log(`   → ${orderRows.length} แถว`);
  } catch (e) {
    console.warn(`   ⚠️  ไม่สามารถอ่าน คำสั่งซื้อ: ${e.message}`);
  }

  console.log('📥 อ่าน CS Master...');
  let csRows = [];
  try {
    csRows = await getSheetRows(sheets, SHEET_ID_ORDERS, RANGES.csMaster);
    console.log(`   → ${csRows.length} แถว`);
  } catch (e) {
    console.warn(`   ⚠️  ไม่สามารถอ่าน CS Master: ${e.message}`);
  }

  // -----------------------------------------------------------------------
  // ส่วนที่ 0 — ตรวจ column headers จริงของแต่ละแท็บ
  // -----------------------------------------------------------------------
  console.log('\n' + '═'.repeat(60));
  console.log('0. COLUMN HEADERS ที่พบในแต่ละแท็บ');
  console.log('═'.repeat(60));

  if (apiRows.length > 0) {
    console.log('\n[API Import] คอลัมน์ที่พบ:');
    console.log('  ', Object.keys(apiRows[0]).join(' | '));
  } else {
    console.log('\n[API Import] ไม่มีข้อมูล');
  }

  if (orderRows.length > 0) {
    console.log('\n[คำสั่งซื้อ] คอลัมน์ที่พบ:');
    console.log('  ', Object.keys(orderRows[0]).join(' | '));
  } else {
    console.log('\n[คำสั่งซื้อ] ไม่มีข้อมูล');
  }

  if (csRows.length > 0) {
    console.log('\n[CS Master] คอลัมน์ที่พบ:');
    console.log('  ', Object.keys(csRows[0]).join(' | '));
  } else {
    console.log('\n[CS Master] ไม่มีข้อมูล');
  }

  // -----------------------------------------------------------------------
  // ส่วนที่ 1 — รูปแบบเบอร์โทรใน API Import
  // -----------------------------------------------------------------------
  console.log('\n' + '═'.repeat(60));
  console.log('1. รูปแบบเบอร์โทรใน API Import');
  console.log('═'.repeat(60));

  const apiPhones = apiRows.map(r => findPhoneKey(r, API_PHONE_KEYS)).filter(Boolean);
  const apiPatterns = {};
  apiPhones.forEach(p => {
    const pat = classifyPhonePattern(p);
    apiPatterns[pat] = (apiPatterns[pat] || 0) + 1;
  });
  console.log(`\nพบ ${apiPhones.length} เบอร์จาก ${apiRows.length} แถว:`);
  Object.entries(apiPatterns).sort((a,b) => b[1]-a[1]).forEach(([k,v]) => {
    console.log(`  ${String(v).padStart(5)} แถว  →  ${k}`);
  });

  // -----------------------------------------------------------------------
  // ส่วนที่ 2 — รูปแบบเบอร์โทรใน คำสั่งซื้อ
  // -----------------------------------------------------------------------
  console.log('\n' + '═'.repeat(60));
  console.log('2. รูปแบบเบอร์โทรใน คำสั่งซื้อ');
  console.log('═'.repeat(60));

  const orderPhones = orderRows.map(r => findPhoneKey(r, API_PHONE_KEYS)).filter(Boolean);
  const orderPatterns = {};
  orderPhones.forEach(p => {
    const pat = classifyPhonePattern(p);
    orderPatterns[pat] = (orderPatterns[pat] || 0) + 1;
  });
  console.log(`\nพบ ${orderPhones.length} เบอร์จาก ${orderRows.length} แถว:`);
  Object.entries(orderPatterns).sort((a,b) => b[1]-a[1]).forEach(([k,v]) => {
    console.log(`  ${String(v).padStart(5)} แถว  →  ${k}`);
  });

  // -----------------------------------------------------------------------
  // ส่วนที่ 3 — เบอร์ซ้ำใน CS Master
  // -----------------------------------------------------------------------
  console.log('\n' + '═'.repeat(60));
  console.log('3. เบอร์ซ้ำภายใน CS Master');
  console.log('═'.repeat(60));

  const csPhonesRaw = csRows.map(r => findPhoneKey(r, CS_PHONE_KEYS));
  const csNormalized = csPhonesRaw.map(p => normalizePhone(p));
  const csPhoneCount = {};
  const csPhoneMap = {}; // normalized → raw
  csNormalized.forEach((n, i) => {
    if (!n) return;
    csPhoneCount[n] = (csPhoneCount[n] || 0) + 1;
    csPhoneMap[n] = csPhonesRaw[i];
  });
  const csDupes = Object.entries(csPhoneCount).filter(([,v]) => v > 1);
  if (csDupes.length === 0) {
    console.log('\n✅ ไม่พบเบอร์ซ้ำใน CS Master');
  } else {
    console.log(`\n⚠️  พบเบอร์ซ้ำ ${csDupes.length} รายการ:`);
    csDupes.slice(0, 20).forEach(([n, count]) => {
      console.log(`  ${n}  (${count} แถว)  raw: ${csPhoneMap[n]}`);
    });
    if (csDupes.length > 20) console.log(`  ... และอีก ${csDupes.length - 20} รายการ`);
  }

  // -----------------------------------------------------------------------
  // ส่วนที่ 4 — % ที่จับคู่กับ CS Master ได้
  // -----------------------------------------------------------------------
  console.log('\n' + '═'.repeat(60));
  console.log('4. % การจับคู่ API Import ↔ CS Master');
  console.log('═'.repeat(60));

  const csNormalizedSet = new Set(csNormalized.filter(Boolean));
  const apiNormalized = apiPhones.map(p => normalizePhone(p));

  let matchedCount = 0;
  let unmatchedCount = 0;
  const unmatchedSamples = [];

  apiNormalized.forEach((n, i) => {
    if (!n) { unmatchedCount++; return; }
    if (csNormalizedSet.has(n)) {
      matchedCount++;
    } else {
      unmatchedCount++;
      if (unmatchedSamples.length < 10) {
        unmatchedSamples.push({ raw: apiPhones[i], normalized: n });
      }
    }
  });

  const total = apiNormalized.length;
  const matchPct = total > 0 ? ((matchedCount / total) * 100).toFixed(1) : '0.0';

  console.log(`\nจำนวน unique เบอร์ใน API Import : ${total}`);
  console.log(`จำนวนใน CS Master (normalize แล้ว): ${csNormalizedSet.size}`);
  console.log(`จับคู่ได้ : ${matchedCount} / ${total} (${matchPct}%)`);
  console.log(`จับคู่ไม่ได้ : ${unmatchedCount} / ${total} (${(100 - parseFloat(matchPct)).toFixed(1)}%)`);

  if (unmatchedSamples.length > 0) {
    console.log('\nตัวอย่างเบอร์ที่ไม่มีใน CS Master:');
    unmatchedSamples.forEach(s => {
      console.log(`  raw: ${s.raw.padEnd(15)}  →  normalized: ${s.normalized}`);
    });
  }

  // -----------------------------------------------------------------------
  // ส่วนที่ 5 — ตรวจ edge case ของ normalizePhone
  // -----------------------------------------------------------------------
  console.log('\n' + '═'.repeat(60));
  console.log('5. Edge Cases ที่น่าสงสัย');
  console.log('═'.repeat(60));

  const edgeCases = [
    { raw: '082-384-8337',  expected: '0823848337' },
    { raw: '66823848337',   expected: '0823848337' },
    { raw: '+66823848337',  expected: '0823848337' },
    { raw: '0823848337',    expected: '0823848337' },
    { raw: '0082-384-8337', expected: '0823848337' },
    { raw: '82-384-8337',   expected: '823848337' },  // ขาด 0 — ไม่ควร match
    { raw: '',              expected: '' },
  ];

  let allPass = true;
  console.log('\nทดสอบ normalizePhone():');
  edgeCases.forEach(({ raw, expected }) => {
    const result = normalizePhone(raw);
    const pass = result === expected;
    if (!pass) allPass = false;
    console.log(`  ${pass ? '✅' : '❌'} normalize("${raw}") = "${result}" ${!pass ? `(คาดหวัง "${expected}")` : ''}`);
  });

  if (allPass) {
    console.log('\n✅ normalizePhone() ผ่านทุก edge case');
  } else {
    console.log('\n⚠️  normalizePhone() มี edge case ที่ไม่ผ่าน — ต้องแก้ก่อนไป Phase 3');
  }

  // -----------------------------------------------------------------------
  // ส่วนที่ 6 — สรุป Order UID ตรงกันระหว่าง API Import และ คำสั่งซื้อ
  // -----------------------------------------------------------------------
  console.log('\n' + '═'.repeat(60));
  console.log('6. Order UID — จับคู่ระหว่าง API Import ↔ คำสั่งซื้อ');
  console.log('═'.repeat(60));

  const UID_KEYS = ['Order UID', 'เลขคำสั่งซื้อ', 'order_uid', 'UID'];
  const apiUids = new Set(apiRows.map(r => {
    for (const k of UID_KEYS) if (r[k]) return r[k].trim();
    return '';
  }).filter(Boolean));
  const orderUids = new Set(orderRows.map(r => {
    for (const k of UID_KEYS) if (r[k]) return r[k].trim();
    return '';
  }).filter(Boolean));

  const bothSets = [...apiUids].filter(u => orderUids.has(u));
  const onlyInApi = [...apiUids].filter(u => !orderUids.has(u));
  const onlyInOrders = [...orderUids].filter(u => !apiUids.has(u));

  console.log(`\nUID ใน API Import     : ${apiUids.size}`);
  console.log(`UID ใน คำสั่งซื้อ      : ${orderUids.size}`);
  console.log(`UID ที่อยู่ทั้งสองแท็บ  : ${bothSets.length}`);
  console.log(`มีแค่ใน API Import    : ${onlyInApi.length}`);
  console.log(`มีแค่ใน คำสั่งซื้อ    : ${onlyInOrders.length}`);

  if (onlyInApi.length > 0) {
    console.log('\nตัวอย่าง UID ที่ไม่มีใน คำสั่งซื้อ (จะไม่มี Picker/หมายเหตุ):');
    onlyInApi.slice(0, 5).forEach(u => console.log('  ' + u));
  }

  // -----------------------------------------------------------------------
  // ส่วนที่ 7 — ตรวจ วันที่จะจัดส่ง (คอลัมน์ B ของ คำสั่งซื้อ)
  // -----------------------------------------------------------------------
  console.log('\n' + '═'.repeat(60));
  console.log('7. วันที่จะจัดส่ง (คอลัมน์ B คำสั่งซื้อ) — ตรวจความสมบูรณ์');
  console.log('═'.repeat(60));

  const activeStatuses = new Set(['ยกเลิก', 'ส่งสำเร็จ', 'ได้รับแล้ว']);
  const activeOrders = orderRows.filter(r => {
    const s = (r['Status'] || r['สถานะ'] || '').trim();
    return !activeStatuses.has(s);
  });
  const withDate = activeOrders.filter(r => (r['วันที่จะจัดส่ง'] || '').trim());
  const withoutDate = activeOrders.filter(r => !(r['วันที่จะจัดส่ง'] || '').trim());

  console.log(`\nออเดอร์ที่ยังต้องส่ง (ไม่ใช่ยกเลิก/สำเร็จ): ${activeOrders.length}`);
  console.log(`มีวันที่จะจัดส่ง  : ${withDate.length}`);
  console.log(`ไม่มีวันที่ (ต้องเคลียร์): ${withoutDate.length}`);

  if (withoutDate.length > 0) {
    const dateCounts = {};
    withDate.forEach(r => {
      const d = r['วันที่จะจัดส่ง'];
      dateCounts[d] = (dateCounts[d] || 0) + 1;
    });
    console.log('\nออเดอร์ที่มีวันที่ แยกตามวัน:');
    Object.entries(dateCounts).sort().forEach(([d,v]) => {
      console.log(`  ${d}: ${v} ออเดอร์`);
    });
  }

  console.log('\n' + '═'.repeat(60));
  console.log('✅ ตรวจสอบเสร็จสิ้น');
  console.log('═'.repeat(60));
  console.log('\n📋 สรุป: ดูผลข้างบนแล้วแจ้งทีมพัฒนาก่อนเริ่ม Phase 3\n');
}

main().catch(err => {
  console.error('❌ Error:', err.message);
  if (err.message.includes('Missing GOOGLE_SERVICE_ACCOUNT')) {
    console.error('\n💡 ตั้งค่า environment variables ก่อนรัน:');
    console.error('   GOOGLE_SERVICE_ACCOUNT_EMAIL=your-sa@project.iam.gserviceaccount.com');
    console.error('   GOOGLE_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\\n..."');
    console.error('   SHEET_ID_ORDERS=1m1Cb_BEwPjqF3CgXNssGgjyewIgPNw_BU4EkduuV59U');
    console.error('\n   หรือสร้าง .env ไฟล์แล้วรัน: node -r dotenv/config scripts/check-phone-quality.js');
  }
  process.exit(1);
});
