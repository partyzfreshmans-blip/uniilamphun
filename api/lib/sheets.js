const { google } = require('googleapis');

let sheetsClient = null;

function getSheetsClient() {
  if (sheetsClient) return sheetsClient;

  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  let privateKey = process.env.GOOGLE_PRIVATE_KEY;

  if (!email || !privateKey) {
    throw new Error("Missing GOOGLE_SERVICE_ACCOUNT_EMAIL or GOOGLE_PRIVATE_KEY env variables");
  }

  // Handle newlines in Vercel private key
  privateKey = privateKey.replace(/\\n/g, '\n');

  const auth = new google.auth.JWT(
    email,
    null,
    privateKey,
    ['https://www.googleapis.com/auth/spreadsheets']
  );

  sheetsClient = google.sheets({ version: 'v4', auth });
  return sheetsClient;
}

/**
 * Self-healing sheet helper: verifies if a tab exists, and if not, creates it with headers.
 */
async function ensureSheetExists(sheets, spreadsheetId, title, headers) {
  try {
    let client = sheets;
    if (!client) {
      try { client = getSheetsClient(); } catch(e) { return; }
    }
    if (!client || !client.spreadsheets) return;

    const meta = await client.spreadsheets.get({ spreadsheetId });
    const sheetsList = meta.data.sheets || [];
    const exists = sheetsList.some(s => s.properties.title === title);

    if (!exists) {
      console.log(`Sheet "${title}" not found. Creating it...`);
      // Add sheet
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        resource: {
          requests: [
            {
              addSheet: {
                properties: {
                  title
                }
              }
            }
          ]
        }
      });

      // Write header row
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${title}!A1`,
        valueInputOption: 'USER_ENTERED',
        resource: {
          values: [headers]
        }
      });
      console.log(`Sheet "${title}" created successfully with headers:`, headers);
    }
  } catch (err) {
    console.error(`Failed to ensure sheet "${title}" exists:`, err);
  }
}

async function getSheetRows(sheets, spreadsheetId, range) {
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range
  });
  const rows = response.data.values;
  if (!rows || rows.length === 0) return [];
  
  const headers = rows[0].map(h => h.trim());
  const dataRows = rows.slice(1);
  
  return dataRows.map(row => {
    const obj = {};
    headers.forEach((header, idx) => {
      obj[header] = row[idx] !== undefined ? row[idx].trim() : '';
    });
    return obj;
  });
}

async function appendSheetRow(sheets, spreadsheetId, range, rowValues) {
  try {
    const client = sheets || getSheetsClient();
    return await client.spreadsheets.values.append({
      spreadsheetId,
      range,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      resource: {
        values: [rowValues]
      }
    });
  } catch (err) {
    // If running in local mock environment without credentials, fail silently
    return null;
  }
}

/**
 * getSheetRowsById — อ่านชีตด้วย numeric gid แทนการใช้ชื่อแท็บ
 * ป้องกันปัญหา encoding ของชื่อแท็บภาษาไทย (เช่น "คำสั่งซื้อ")
 *
 * @param {object} sheets         — Sheets API client
 * @param {string} spreadsheetId  — Spreadsheet ID
 * @param {number|string} gid     — Sheet gid (numeric)
 * @param {string} [a1Range]      — A1 notation ของ range เช่น "A1:Z5000" (ไม่รวมชื่อแท็บ)
 * @returns {Promise<Object[]>}
 */
async function getSheetRowsById(sheets, spreadsheetId, gid, a1Range = 'A1:ZZ5000') {
  // ดึง metadata เพื่อหาชื่อแท็บจาก gid
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const sheetsList = meta.data.sheets || [];
  const found = sheetsList.find(s => String(s.properties.sheetId) === String(gid));

  if (!found) {
    throw new Error(`ไม่พบแท็บที่มี gid=${gid} ใน spreadsheet ${spreadsheetId}`);
  }

  const title = found.properties.title;
  const fullRange = `${title}!${a1Range}`;
  return getSheetRows(sheets, spreadsheetId, fullRange);
}

module.exports = { getSheetsClient, ensureSheetExists, getSheetRows, getSheetRowsById, appendSheetRow };

