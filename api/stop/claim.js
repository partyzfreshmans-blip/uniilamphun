const { verifyToken } = require('../lib/jwt');
const { getSheetsClient, getSheetRows, ensureSheetExists } = require('../lib/sheets');
const { getDriverProfile } = require('../lib/drivers');

module.exports = async (req, res) => {
  // CORS Headers
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

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method Not Allowed' });
    return;
  }

  try {
    const { orderId, orderIds, driverToken } = req.body || {};
    const authHeader = req.headers.authorization;
    const token = driverToken || (authHeader && authHeader.split(' ')[1]);

    if (!token) {
      res.status(401).json({ error: 'Unauthorized: Missing token' });
      return;
    }

    const decoded = verifyToken(token);
    if (!decoded || decoded.role !== 'driver') {
      res.status(401).json({ error: 'Unauthorized: Invalid token' });
      return;
    }

    const targetOrderIds = orderIds || (orderId ? [orderId] : []);
    if (targetOrderIds.length === 0) {
      res.status(400).json({ error: 'Missing orderId or orderIds' });
      return;
    }

    const driverProfile = getDriverProfile(decoded.username);
    const sheets = getSheetsClient();
    const spreadsheetId = process.env.SHEET_ID_ORDERS;

    // Self-healing: ensure _ASSIGN sheet exists
    await ensureSheetExists(sheets, spreadsheetId, '_ASSIGN', [
      'order_id', 'status', 'assigned_driver', 'completed_at', 'lat', 'lng', 'driver_note', 'priority', 'hold'
    ]);

    // OPTIMISTIC CONCURRENCY CHECK (Option A)
    // Fetch all current assignments to verify availability
    const assignments = await getSheetRows(sheets, spreadsheetId, '_ASSIGN!A1:C2000');
    const assignmentMap = {};
    assignments.forEach(row => {
      if (row.order_id) {
        assignmentMap[row.order_id] = row;
      }
    });

    // Check if any of the target orders are already claimed by another driver
    for (const id of targetOrderIds) {
      const current = assignmentMap[id];
      if (current && current.status !== 'released' && current.assigned_driver !== driverProfile.code) {
        res.status(409).json({
          success: false,
          error: `Order ${id} is already claimed by ${current.assigned_driver}`
        });
        return;
      }
    }

    // Append new claim rows
    const rowsToAppend = targetOrderIds.map(id => [
      id,
      'mine',
      driverProfile.code,
      '', // completed_at
      '', // lat
      '', // lng
      '', // driver_note
      '', // priority
      ''  // hold
    ]);

    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: '_ASSIGN!A1',
      valueInputOption: 'USER_ENTERED',
      resource: {
        values: rowsToAppend
      }
    });

    res.status(200).json({
      success: true,
      message: `Successfully claimed ${targetOrderIds.length} orders`
    });

  } catch (err) {
    console.error('Error claiming stops:', err);
    res.status(500).json({ error: 'Internal Server Error', details: err.message });
  }
};
