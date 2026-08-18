/**
 * api/driver/day.js
 * ==================
 * GET /api/driver/day?date=YYYY-MM-DD|all
 *
 * Reads unified orders directly from Google Sheets (คำสั่งซื้อ, CS Master, _ASSIGN)
 */

'use strict';

const { verifyToken } = require('../lib/jwt');
const { fetchUnifiedOrdersFromSheets } = require('../supervisor/day');

module.exports = async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization'
  );

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method Not Allowed' });
    return;
  }

  try {
    const { date, driverToken } = req.query;
    const authHeader = req.headers.authorization;
    const token = driverToken || (authHeader && authHeader.split(' ')[1]);

    if (!token) {
      res.status(401).json({ error: 'Unauthorized: Missing token' });
      return;
    }
    const decoded = verifyToken(token);
    if (!decoded || !['driver', 'supervisor', 'admin', 'administrator'].includes(decoded.role)) {
      res.status(401).json({ error: 'Unauthorized: Invalid token' });
      return;
    }

    const { ordersWithDate, pendingSchedule } = await fetchUnifiedOrdersFromSheets({
      date,
      role: decoded.role,
      username: decoded.username
    });

    const orders = (date === 'all' || !date) ? [...ordersWithDate, ...pendingSchedule] : ordersWithDate;

    res.status(200).json({
      success: true,
      orders,
      pendingSchedule,
      summary: {
        total: orders.length,
        available: orders.filter(o => o.status === 'available').length,
        claimed: orders.filter(o => o.status === 'mine').length,
        done: orders.filter(o => o.status === 'done').length,
        failed: orders.filter(o => o.status === 'failed').length
      }
    });

  } catch (err) {
    console.error('[driver/day] Error:', err);
    res.status(500).json({ error: 'Internal Server Error', details: err.message });
  }
};
