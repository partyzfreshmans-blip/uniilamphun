const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  // Capture console messages
  page.on('console', msg => console.log('PAGE LOG:', msg.text()));
  
  // Capture page errors
  page.on('pageerror', err => {
    console.error('PAGE ERROR:', err.message);
  });

  try {
    console.log('Navigating to http://localhost:3000...');
    await page.goto('http://localhost:3000');
    await page.waitForLoadState('networkidle');

    // Click on Driver avatar to open the Driver Auth Modal
    console.log('Clicking Driver avatar...');
    await page.click('#btn-open-driver-auth');
    await page.waitForTimeout(500);

    // Verify driver modal is open
    const isDriverModalOpen = await page.locator('#modal-driver-auth').evaluate(el => el.classList.contains('is-open'));
    console.log('Is Driver Auth Modal open:', isDriverModalOpen);

    // Click on Admin Control Center link inside the modal
    console.log('Clicking "เข้าสู่ศูนย์ควบคุมแอดมิน" link...');
    // The button has style background: var(--page); border-color: var(--line-strong); and contains "เข้าสู่ศูนย์ควบคุมแอดมิน"
    await page.click('button:has-text("เข้าสู่ศูนย์ควบคุมแอดมิน")');
    await page.waitForTimeout(1000);

    // Check if view switched to Admin
    const isDriverViewVisible = await page.locator('#view-driver').evaluate(el => el.style.display !== 'none');
    const isAdminViewVisible = await page.locator('#view-admin').evaluate(el => el.style.display === 'flex');
    console.log('Is Driver View visible:', isDriverViewVisible);
    console.log('Is Admin View visible:', isAdminViewVisible);

    // Check open modals
    const openModals = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('.modal-overlay.is-open')).map(el => el.id);
    });
    console.log('Open modals:', openModals);

    // Take screenshot of the result
    await page.screenshot({ path: '/Users/natee.e/.gemini/antigravity-ide/brain/3209b54a-85f6-4640-a276-75670c769098/after_click_nested_link.png' });
    console.log('Screenshot saved to after_click_nested_link.png');

  } catch (err) {
    console.error('Error during test:', err);
  } finally {
    await browser.close();
  }
})();
