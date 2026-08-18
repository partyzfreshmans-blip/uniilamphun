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
    const { orderId, status, lat, lng, note, driverToken } = req.body || {};
    const authHeader = req.headers.authorization;
    const token = driverToken || (authHeader && authHeader.split(' ')[1]);

    if (!token) {
      res.status(401).json({ error: 'Unauthorized: Missing token' });
      return;
    }

    const decoded = verifyToken(token);
    if (!decoded || (decoded.role !== 'driver' && decoded.role !== 'supervisor' && decoded.role !== 'admin' && decoded.role !== 'administrator')) {
      res.status(401).json({ error: 'Unauthorized: Invalid token' });
      return;
    }

    if (!orderId || !status) {
      res.status(400).json({ error: 'Missing orderId or status' });
      return;
    }

    if (status !== 'done' && status !== 'failed') {
      res.status(400).json({ error: 'Status must be "done" or "failed"' });
      return;
    }

    const driverProfile = getDriverProfile(decoded.username);
    const sheets = getSheetsClient();
    const spreadsheetId = process.env.SHEET_ID_ORDERS;

    // Self-healing: ensure _ASSIGN sheet exists
    await ensureSheetExists(sheets, spreadsheetId, '_ASSIGN', [
      'order_id', 'status', 'assigned_driver', 'completed_at', 'lat', 'lng', 'driver_note', 'priority', 'hold'
    ]);

    // OPTIMISTIC CONCURRENCY CHECK
    // Fetch all current assignments to verify ownership
    const assignments = await getSheetRows(sheets, spreadsheetId, '_ASSIGN!A1:C2000');
    const assignmentMap = {};
    assignments.forEach(row => {
      if (row.order_id) {
        assignmentMap[row.order_id] = row;
      }
    });

    const isSupervisor = (decoded.role === 'supervisor' || decoded.role === 'admin' || decoded.role === 'administrator');
    const current = assignmentMap[orderId];

    // Verify ownership prior to complete
    if (current && current.status !== 'released' && current.assigned_driver !== driverProfile.code && !isSupervisor) {
      res.status(403).json({
        success: false,
        error: `Cannot modify order ${orderId} as it is claimed by ${current.assigned_driver}`
      });
      return;
    }

    // Append complete row
    const completedAt = new Date().toISOString();
    const rowToAppend = [
      orderId,
      status,
      current ? current.assigned_driver : driverProfile.code, // Keep original driver or fallback to caller
      completedAt,
      lat || '',
      lng || '',
      note || '',
      '', // priority
      ''  // hold
    ];

    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: '_ASSIGN!A1',
      valueInputOption: 'USER_ENTERED',
      resource: {
        values: [rowToAppend]
      }
    });

    res.status(200).json({
      success: true,
      message: `Successfully completed order ${orderId} with status ${status}`
    });

  } catch (err) {
    console.error('Error completing stop:', err);
    res.status(500).json({ error: 'Internal Server Error', details: err.message });
  }
};
