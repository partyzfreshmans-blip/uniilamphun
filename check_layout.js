const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  try {
    console.log('Navigating to http://localhost:3000...');
    await page.goto('http://localhost:3000');
    await page.waitForLoadState('networkidle');

    // Get position of buttons in driver profile header
    const supervisorBtn = page.locator('#btn-open-supervisor-portal');
    const driverAuthDiv = page.locator('#btn-open-driver-auth');

    const sBox = await supervisorBtn.boundingBox();
    const dBox = await driverAuthDiv.boundingBox();

    console.log('Supervisor Button Bounding Box:', sBox);
    console.log('Driver Auth Div Bounding Box:', dBox);

    // Let's click the supervisor button
    console.log('Clicking Supervisor button...');
    await supervisorBtn.click();
    await page.waitForTimeout(1000);

    // Check which modals are open (have 'is-open' class)
    const openModals = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('.modal-overlay.is-open')).map(el => ({
        id: el.id,
        title: el.querySelector('h3') ? el.querySelector('h3').innerText : 'No title'
      }));
    });

    console.log('Open Modals after clicking Supervisor button:', openModals);

    // Let's take a screenshot and save it to the artifacts directory
    await page.screenshot({ path: '/Users/natee.e/.gemini/antigravity-ide/brain/3209b54a-85f6-4640-a276-75670c769098/after_click_supervisor.png' });
    console.log('Screenshot saved to after_click_supervisor.png');

  } catch (err) {
    console.error('Error during test:', err);
  } finally {
    await browser.close();
  }
})();
