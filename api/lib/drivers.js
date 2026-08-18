const fs = require('fs');
const path = require('path');

const DRIVERS_DB_PATH = path.join(__dirname, '../../local_drivers.json');
const ZONES_DB_PATH = path.join(__dirname, '../../local_zones.json');

const DEFAULT_PROFILES = {
  "DRV-A01": { id: "DRV-A01", code: "DRV-A01", name: "สมชาย จัดส่ง", phone: "081-234-5678", role: "driver", zone: "Zone A — เมืองลำพูน", zones: ["Zone A — เมืองลำพูน"], avatar: "A01", color: "var(--st-available)", pin: "1111", status: "active" },
  "DRV-B02": { id: "DRV-B02", code: "DRV-B02", name: "วิชัย ขับเร็ว", phone: "082-345-6789", role: "driver", zone: "Zone B — สารภี/เชียงใหม่", zones: ["Zone B — สารภี/เชียงใหม่"], avatar: "B02", color: "#8b5cf6", pin: "2222", status: "active" },
  "DRV-C03": { id: "DRV-C03", code: "DRV-C03", name: "สมศักดิ์ สุขใจ", phone: "083-456-7890", role: "driver", zone: "Zone C — ป่าซาง", zones: ["Zone C — ป่าซาง", "Zone D"], avatar: "C03", color: "#f59e0b", pin: "3333", status: "active" },
  "DRV-S04": { id: "DRV-S04", code: "DRV-S04", name: "สุรชัย สายด่วน (ทีมพิเศษ)", phone: "084-567-8901", role: "driver", zone: "ทุกโซน (ลอตใหญ่ / เก็บตก / VVIP)", zones: ["ทุกโซน"], avatar: "VIP", color: "#06b6d4", pin: "4444", status: "active", isSpecial: true }
};

function readDriversDb() {
  try {
    if (fs.existsSync(DRIVERS_DB_PATH)) {
      const data = JSON.parse(fs.readFileSync(DRIVERS_DB_PATH, 'utf8'));
      if (Array.isArray(data.drivers) && data.drivers.length > 0) {
        return data.drivers;
      }
    }
  } catch (e) {
    console.warn('[drivers.js] Error reading local_drivers.json:', e.message);
  }
  return Object.values(DEFAULT_PROFILES);
}

function writeDriversDb(driversList) {
  try {
    fs.writeFileSync(DRIVERS_DB_PATH, JSON.stringify({ drivers: driversList }, null, 2), 'utf8');
    return true;
  } catch (e) {
    console.error('[drivers.js] Error writing local_drivers.json:', e.message);
    return false;
  }
}

function getDriverAssignedZones(driverCode) {
  try {
    if (fs.existsSync(ZONES_DB_PATH)) {
      const data = JSON.parse(fs.readFileSync(ZONES_DB_PATH, 'utf8'));
      const all = [...(data.zones || []), ...(data.overlapZones || [])];
      return all.filter(z => {
        if (Array.isArray(z.driverCodes)) return z.driverCodes.includes(driverCode);
        return z.driverCode === driverCode;
      }).map(z => z.name || `Zone ${z.letter || z.letters}`);
    }
  } catch (e) {}
  return [];
}

function getDriverProfile(username) {
  const allDrivers = readDriversDb();
  let found = allDrivers.find(d => d.code === username || d.id === username);

  if (!found && username === "driver1") {
    found = allDrivers.find(d => d.code === "DRV-A01") || DEFAULT_PROFILES["DRV-A01"];
  }

  if (!found) {
    found = DEFAULT_PROFILES[username] || {
      id: username,
      code: username,
      name: username,
      role: "driver",
      zone: "Zone A — เมืองลำพูน",
      zones: ["Zone A — เมืองลำพูน"],
      avatar: "DRV",
      color: "var(--st-available)",
      pin: "1111",
      status: "active"
    };
  }

  const dynamicZones = getDriverAssignedZones(found.code);
  const combinedZones = Array.from(new Set([...(found.zones || []), ...dynamicZones]));

  return {
    ...found,
    role: "driver",
    zone: found.zone || (combinedZones[0] || "Zone A — เมืองลำพูน"),
    assignedZones: combinedZones.length > 0 ? combinedZones : [found.zone || "Zone A — เมืองลำพูน"]
  };
}

module.exports = {
  DRIVER_PROFILES: DEFAULT_PROFILES,
  readDriversDb,
  writeDriversDb,
  getDriverProfile,
  getDriverAssignedZones
};
