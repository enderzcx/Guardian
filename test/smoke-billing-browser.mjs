import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const extensionPath = path.join(root, 'dist');
const screenshotDir = path.join(root, 'output', 'playwright');
const userDataDir = path.join(root, '.tmp', 'guardian-billing-browser-profile');

await fs.mkdir(screenshotDir, { recursive: true });
await fs.rm(userDataDir, { recursive: true, force: true });

const timestamp = Date.now();
const email = `guardian-browser-billing-${timestamp}@example.com`;
const password = 'password123';

const context = await chromium.launchPersistentContext(userDataDir, {
  headless: false,
  channel: 'chromium',
  viewport: { width: 1366, height: 900 },
  ignoreDefaultArgs: ['--disable-extensions'],
  args: [
    `--disable-extensions-except=${extensionPath}`,
    `--load-extension=${extensionPath}`,
  ],
});

try {
  const sw = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker', { timeout: 15000 });
  const extensionId = new URL(sw.url()).host;

  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/src/popup/index.html`, { waitUntil: 'domcontentloaded' });
  await popup.waitForTimeout(1200);

  await popup.getByTitle('Settings').click();
  await popup.waitForTimeout(300);

  await popup.getByRole('button', { name: 'Create Account' }).click();
  await popup.getByPlaceholder('you@example.com').fill(email);
  await popup.getByPlaceholder('At least 8 characters').fill(password);
  await popup.getByRole('button', { name: 'Create Account' }).last().click();

  await popup.waitForFunction((expectedEmail) => {
    const body = document.body.textContent ?? '';
    return body.includes(expectedEmail) && body.includes('100 of 100 AI analyses left this month.');
  }, email, { timeout: 15000 });

  await popup.screenshot({ path: path.join(screenshotDir, 'guardian-billing-popup-before-checkout.png'), fullPage: true });

  const checkoutPagePromise = context.waitForEvent('page', { timeout: 15000 });
  await popup.getByRole('button', { name: 'Choose PRO' }).click();
  const checkoutPage = await checkoutPagePromise;
  await checkoutPage.waitForLoadState('domcontentloaded');
  await checkoutPage.waitForTimeout(2500);

  const checkoutUrl = checkoutPage.url();
  await checkoutPage.screenshot({ path: path.join(screenshotDir, 'guardian-billing-checkout-page.png'), fullPage: true });

  console.log(JSON.stringify({
    ok: checkoutUrl.startsWith('https://checkout-sandbox.infini.money/'),
    extensionId,
    email,
    checkoutUrl,
    screenshots: {
      popup: path.join(screenshotDir, 'guardian-billing-popup-before-checkout.png'),
      checkout: path.join(screenshotDir, 'guardian-billing-checkout-page.png'),
    },
  }, null, 2));
} finally {
  await context.close();
}
