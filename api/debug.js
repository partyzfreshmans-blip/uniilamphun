const { getSheetsClient } = require('./lib/sheets');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = process.env.GOOGLE_PRIVATE_KEY;
  const sheetId = process.env.SHEET_ID_ORDERS || '1m1Cb_BEwPjqF3CgXNssGgjyewIgPNw_BU4EkduuV59U';

  const diagnostics = {
    hasEmail: Boolean(email),
    emailValue: email ? email.replace(/(.{4}).*(@.*)/, '$1...$2') : null,
    hasPrivateKey: Boolean(privateKey),
    privateKeyLength: privateKey ? privateKey.length : 0,
    privateKeyHasBegin: privateKey ? privateKey.includes('-----BEGIN PRIVATE KEY-----') : false,
    privateKeyHasEscapedNewlines: privateKey ? privateKey.includes('\\n') : false,
    sheetIdValue: sheetId,
    sheetsApiError: null,
    sheetTabsFound: []
  };

  try {
    const sheets = getSheetsClient();
    const meta = await sheets.spreadsheets.get({ spreadsheetId: sheetId });
    diagnostics.sheetTitle = meta.data.properties.title;
    diagnostics.sheetTabsFound = (meta.data.sheets || []).map(s => ({
      title: s.properties.title,
      sheetId: s.properties.sheetId
    }));
  } catch (err) {
    diagnostics.sheetsApiError = {
      message: err.message,
      code: err.code,
      stack: err.stack
    };
  }

  res.status(200).json(diagnostics);
};
