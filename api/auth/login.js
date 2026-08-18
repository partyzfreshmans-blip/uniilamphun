const { signToken } = require('../lib/jwt');
const { getDriverProfile } = require('../lib/drivers');
const fs = require('fs');
const path = require('path');

const DRIVERS_DB_PATH = path.join(__dirname, '../../local_drivers.json');

function readDrivers() {
  try {
    if (fs.existsSync(DRIVERS_DB_PATH)) {
      return JSON.parse(fs.readFileSync(DRIVERS_DB_PATH, 'utf8'));
    }
  } catch (e) {}
  return [];
}

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
    const inputPin = pin || req.body?.password;

    if (!inputPin) {
      return res.status(400).json({ error: 'Password/PIN is required' });
    }

    const allDrivers = readDrivers();
    const driverUsers = allDrivers.map(d => ({
      username: d.code || d.id,
      pin: d.pin,
      role: 'driver',
      driver_vehicle_id: d.code || d.id,
      status: d.status || 'active',
      name: d.name
    }));
    const adminUser = { username: 'admin', pin: '9999', role: 'supervisor', driver_vehicle_id: null, status: 'active', name: 'หัวหน้าคลัง' };
    const supUser = { username: 'SUP-01', pin: '0000', role: 'supervisor', driver_vehicle_id: null, status: 'active', name: 'หัวหน้าคลัง 1' };
    const allUsers = [...driverUsers, adminUser, supUser];

    let matchedUser = null;
    if (username) {
      matchedUser = allUsers.find(
        u => u.username.toLowerCase() === username.toLowerCase() && u.pin === inputPin
      );
    } else {
      matchedUser = allUsers.find(u => u.pin === inputPin);
    }

    if (!matchedUser) {
      return res.status(401).json({ error: 'รหัสผ่านหรือ PIN ไม่ถูกต้อง' });
    }

    if (matchedUser.status === 'inactive') {
      return res.status(403).json({ error: `คนขับ "${matchedUser.name || matchedUser.username}" ถูกปิดใช้งาน` });
    }

    const token = signToken({
      username: matchedUser.username,
      role: matchedUser.role,
      driver_vehicle_id: matchedUser.driver_vehicle_id
    });

    res.status(200).json({
      success: true,
      token,
      user: {
        username: matchedUser.username,
        name: matchedUser.name,
        role: matchedUser.role,
        driver_vehicle_id: matchedUser.driver_vehicle_id
      }
    });

  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Internal Server Error', details: err.message });
  }
};
