const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  page.on('console', msg => console.log('PAGE LOG:', msg.text()));
  page.on('pageerror', err => console.error('PAGE ERROR:', err.message));

  try {
    await page.goto('http://localhost:3000');
    await page.waitForLoadState('networkidle');

    console.log('Evaluating closeDriverAuthModal() and switchView("admin") directly...');
    const result = await page.evaluate(() => {
      try {
        closeDriverAuthModal();
        switchView('admin');
        return {
          success: true,
          driverView: !!document.getElementById('view-driver'),
          adminView: !!document.getElementById('view-admin'),
          driverViewDisplay: document.getElementById('view-driver')?.style.display,
          adminViewDisplay: document.getElementById('view-admin')?.style.display
        };
      } catch (err) {
        return { success: false, error: err.stack || err.message };
      }
    });

    console.log('Evaluation result:', result);

  } catch (err) {
    console.error('Error during test:', err);
  } finally {
    await browser.close();
  }
})();
