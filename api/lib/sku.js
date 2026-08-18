/**
 * api/lib/sku.js
 * ==============
 * ดึงข้อมูลรายการสินค้าจากแท็บ 'SKU Detail' (gid: 772187603) บน Google Sheets
 */

'use strict';

const { getSheetsClient, getSheetRowsById, getSheetRows } = require('./sheets');

const SHEET_ID_ORDERS = (process.env.SHEET_ID_ORDERS && process.env.SHEET_ID_ORDERS.length > 20 && !process.env.SHEET_ID_ORDERS.includes('BEWpjZ'))
  ? process.env.SHEET_ID_ORDERS
  : '1m1Cb_BEwPjqF3CgXNssGgjyewIgPNw_BU4EkduuV59U';
const SHEET_ID_PRODUCTS = process.env.SHEET_ID_PRODUCTS || '1_qE1NtIfLfa2Vn0AXFxfGoD9daZB34OtLnv08Tc-o54';
const GID_SKU_DETAIL = 772187603;

let skuCache = null;
let skuCacheTime = 0;
const CACHE_TTL_MS = 60 * 1000; // 60 วินาที

async function fetchSkuDetailsFromSheets() {
  const now = Date.now();
  if (skuCache && (now - skuCacheTime < CACHE_TTL_MS)) {
    return skuCache;
  }

  const sheets = getSheetsClient();
  let rows = [];

  try {
    rows = await getSheetRowsById(sheets, SHEET_ID_ORDERS, GID_SKU_DETAIL, 'A1:K10000');
  } catch (err) {
    try {
      rows = await getSheetRows(sheets, SHEET_ID_ORDERS, 'SKU Detail!A1:K10000');
    } catch (e2) {
      console.warn('[fetchSkuDetailsFromSheets] Error loading SKU Detail sheet:', e2.message);
      return skuCache || {};
    }
  }

  const skuMap = {};

  rows.forEach(row => {
    const orderId = (row['เลขคำสั่งซื้อ'] || row['order_id'] || row['Order UID'] || '').trim();
    if (!orderId) return;

    const sku = (row['SKU'] || row['sku'] || '').trim();
    const name = (row['ชื่อสินค้า'] || row['product_name'] || row['name'] || '').trim();
    const unit = (row['หน่วย'] || row['unit'] || '').trim();
    const qty = parseFloat((row['จำนวน'] || row['qty'] || '1').replace(/,/g, '')) || 1;
    const pricePerUnit = parseFloat((row['ราคา/หน่วย'] || row['price'] || '0').replace(/,/g, '')) || 0;
    const discount = parseFloat((row['ส่วนลด'] || row['discount'] || '0').replace(/,/g, '')) || 0;
    const total = parseFloat((row['ยอดรวมรายการ'] || row['total'] || '0').replace(/,/g, '')) || (qty * pricePerUnit - discount);

    if (!skuMap[orderId]) {
      skuMap[orderId] = [];
    }

    skuMap[orderId].push({
      sku,
      name,
      unit,
      qty,
      pricePerUnit,
      discount,
      total,
      orderedAt: (row['วันที่สั่ง'] || '').trim(),
      customer: (row['ชื่อลูกค้า'] || '').trim()
    });
  });

  skuCache = skuMap;
  skuCacheTime = now;
  console.log(`[fetchSkuDetailsFromSheets] Cached SKU details for ${Object.keys(skuMap).length} orders`);
  return skuMap;
}

module.exports = {
  fetchSkuDetailsFromSheets
};
