const { verifyToken } = require('../lib/jwt');
const { getSheetsClient, ensureSheetExists } = require('../lib/sheets');

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
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
      res.status(401).json({ error: 'Unauthorized: Missing token' });
      return;
    }

    const decoded = verifyToken(token);
    if (!decoded || (decoded.role !== 'supervisor' && decoded.role !== 'admin' && decoded.role !== 'administrator')) {
      res.status(401).json({ error: 'Unauthorized: Invalid token' });
      return;
    }

    const {
      orderId,
      deliveryDateOverride,
      zoneOverride,
      driverNote,
      priority,
      hold,
      driverId,
      reason
    } = req.body || {};

    if (!orderId) {
      res.status(400).json({ error: 'Missing orderId' });
      return;
    }

    const sheets = getSheetsClient();
    const spreadsheetId = process.env.SHEET_ID_ORDERS;

    // Self-healing: ensure _ASSIGN sheet exists
    await ensureSheetExists(sheets, spreadsheetId, '_ASSIGN', [
      'order_id', 'status', 'assigned_driver', 'completed_at', 'lat', 'lng', 'driver_note', 'priority', 'hold', 'delivery_date_override'
    ]);

    // Self-healing: ensure _ZONES sheet exists
    await ensureSheetExists(sheets, spreadsheetId, '_ZONES', [
      'order_id', 'zone_override', 'updated_at', 'reason'
    ]);

    // Append to _ASSIGN override row
    const assignRow = [
      orderId,
      driverId ? 'mine' : 'available',
      driverId || '',
      '', // completed_at
      '', // lat
      '', // lng
      driverNote || '',
      priority || 'normal',
      hold ? 'TRUE' : 'FALSE',
      deliveryDateOverride || ''
    ];

    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: '_ASSIGN!A1',
      valueInputOption: 'USER_ENTERED',
      resource: {
        values: [assignRow]
      }
    });

    // If there is a zone override, append to _ZONES
    if (zoneOverride) {
      const zoneRow = [
        orderId,
        zoneOverride,
        new Date().toISOString(),
        reason || ''
      ];

      await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: '_ZONES!A1',
        valueInputOption: 'USER_ENTERED',
        resource: {
          values: [zoneRow]
        }
      });
    }

    res.status(200).json({
      success: true,
      message: `Successfully saved overrides for order ${orderId}`
    });

  } catch (err) {
    console.error('Error saving stop overrides:', err);
    res.status(500).json({ error: 'Internal Server Error', details: err.message });
  }
};
