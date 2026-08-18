const crypto = require('crypto');
const { getSheetsClient, getSheetRows } = require('../lib/sheets');
const { signToken } = require('../lib/jwt');

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
    const { username, pin } = req.body || {};
    const inputPassword = pin || req.body?.password;

    if (!inputPassword) {
      res.status(400).json({ error: 'Password/PIN is required' });
      return;
    }

    const sheets = getSheetsClient();
    const spreadsheetId = process.env.SHEET_ID_ORDERS;
    
    // Read Users tab
    const users = await getSheetRows(sheets, spreadsheetId, 'Users!A1:F100');

    let matchedUser = null;

    if (username) {
      // Find matching user by username (case-insensitive)
      const targetUser = users.find(
        u => u.username.toLowerCase() === username.toLowerCase()
      );
      if (targetUser) {
        const [saltHex, hashHex] = targetUser.password_hash.split(':');
        if (saltHex && hashHex) {
          const salt = Buffer.from(saltHex, 'hex');
          const derived = crypto.pbkdf2Sync(inputPassword, salt, 100000, 64, 'sha512');
          if (derived.toString('hex') === hashHex) {
            matchedUser = targetUser;
          }
        }
      }
    } else {
      // PIN-only check (for admin/supervisor login)
      for (const u of users) {
        if (!u.password_hash) continue;
        const [saltHex, hashHex] = u.password_hash.split(':');
        if (saltHex && hashHex) {
          const salt = Buffer.from(saltHex, 'hex');
          const derived = crypto.pbkdf2Sync(inputPassword, salt, 100000, 64, 'sha512');
          if (derived.toString('hex') === hashHex) {
            matchedUser = u;
            break;
          }
        }
      }
    }

    if (!matchedUser) {
      res.status(401).json({ error: 'Invalid credentials or PIN' });
      return;
    }

    // Verify user is active
    if (matchedUser.active && matchedUser.active.toUpperCase() !== 'TRUE') {
      res.status(403).json({ error: 'User is suspended' });
      return;
    }

    // Generate JWT token
    const token = signToken({
      username: matchedUser.username,
      role: matchedUser.role,
      driver_vehicle_id: matchedUser.driver_vehicle_id || null
    });

    res.status(200).json({
      success: true,
      token,
      user: {
        username: matchedUser.username,
        role: matchedUser.role,
        driver_vehicle_id: matchedUser.driver_vehicle_id || null
      }
    });

  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Internal Server Error', details: err.message });
  }
};
