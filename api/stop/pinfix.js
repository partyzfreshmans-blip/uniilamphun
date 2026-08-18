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
    if (!decoded) {
      res.status(401).json({ error: 'Unauthorized: Invalid token' });
      return;
    }

    const { phone, lat, lng } = req.body || {};

    if (!phone || !lat || !lng) {
      res.status(400).json({ error: 'Missing phone, lat, or lng' });
      return;
    }

    const sheets = getSheetsClient();
    const spreadsheetId = (process.env.SHEET_ID_ORDERS && process.env.SHEET_ID_ORDERS.length > 20 && !process.env.SHEET_ID_ORDERS.includes('BEWpjZ'))
      ? process.env.SHEET_ID_ORDERS
      : '1m1Cb_BEwPjqF3CgXNssGgjyewIgPNw_BU4EkduuV59U';

    // Self-healing: ensure _PINFIX sheet exists
    await ensureSheetExists(sheets, spreadsheetId, '_PINFIX', [
      'phone_number', 'lat', 'lng', 'updated_at'
    ]);

    // Append to _PINFIX
    const pinRow = [
      phone,
      lat,
      lng,
      new Date().toISOString()
    ];

    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: '_PINFIX!A1',
      valueInputOption: 'USER_ENTERED',
      resource: {
        values: [pinRow]
      }
    });

    res.status(200).json({
      success: true,
      message: `Successfully saved M5 pin override for phone ${phone}`
    });

  } catch (err) {
    console.error('Error saving pin override:', err);
    res.status(500).json({ error: 'Internal Server Error', details: err.message });
  }
};
