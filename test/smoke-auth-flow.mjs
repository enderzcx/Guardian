import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const extensionPath = path.join(root, 'dist');
const screenshotDir = path.join(root, 'output', 'playwright');
const userDataDir = path.join(root, '.tmp', 'guardian-auth-flow-profile');
const baseUrl = 'http://127.0.0.1:4173/test/test-dapp.html';

await fs.mkdir(screenshotDir, { recursive: true });
await fs.rm(userDataDir, { recursive: true, force: true });

const timestamp = Date.now();
const email = `guardian-e2e-${timestamp}@example.com`;
const password = 'password123';

const context = await chromium.launchPersistentContext(userDataDir, {
  headless: false,
  channel: 'chromium',
  viewport: { width: 1280, height: 900 },
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

  await popup.screenshot({ path: path.join(screenshotDir, 'guardian-auth-register.png'), fullPage: true });

  await popup.getByRole('button', { name: 'Log Out' }).click();
  await popup.waitForFunction(() => {
    const body = document.body.textContent ?? '';
    return body.includes('AI account not connected') && body.includes('Sign In');
  }, { timeout: 15000 });

  await popup.getByRole('button', { name: 'Sign In' }).click();
  await popup.getByPlaceholder('you@example.com').fill(email);
  await popup.getByPlaceholder('At least 8 characters').fill(password);
  await popup.getByRole('button', { name: 'Sign In' }).last().click();

  await popup.waitForFunction((expectedEmail) => {
    const body = document.body.textContent ?? '';
    return body.includes(expectedEmail) && body.includes('100 of 100 AI analyses left this month.');
  }, email, { timeout: 15000 });

  await popup.screenshot({ path: path.join(screenshotDir, 'guardian-auth-login.png'), fullPage: true });

  const page = context.pages().find((item) => item !== popup) ?? await context.newPage();
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);

  const logBefore = await page.locator('#log').innerText();
  await page.getByRole('button', { name: 'Permit2 Signature' }).click();
  await page.waitForTimeout(1800);
  await page.screenshot({ path: path.join(screenshotDir, 'guardian-auth-permit-before.png'), fullPage: true });

  const size = page.viewportSize();
  if (!size) throw new Error('Missing viewport size');
  await page.mouse.click(size.width - 316, size.height - 61);

  await page.waitForFunction(
    ({ previous }) => {
      const log = document.querySelector('#log')?.textContent ?? '';
      return log !== previous && log.includes('Result: 0xmocksignature');
    },
    { previous: logBefore },
    { timeout: 15000 },
  );

  await popup.reload({ waitUntil: 'domcontentloaded' });
  let state = null;
  for (let attempt = 0; attempt < 25; attempt += 1) {
    state = await popup.evaluate(async () => {
      const auth = await chrome.storage.local.get('guardian_auth');
      const history = await chrome.storage.local.get('guardian_tx_history');
      return {
        auth: auth.guardian_auth,
        history: history.guardian_tx_history,
      };
    });

    const permitRecord = Array.isArray(state?.history)
      ? state.history.find((item) => typeof item?.summary === 'string' && item.summary.toLowerCase().includes('permit2'))
      : null;

    if (
      state?.auth?.user?.email === email
      && state?.auth?.usage?.remaining === 99
      && typeof permitRecord?.aiExplanation === 'string'
      && permitRecord.aiExplanation.length > 0
    ) {
      break;
    }

    await popup.waitForTimeout(2000);
  }

  if (!state) {
    state = await popup.evaluate(async () => {
      const auth = await chrome.storage.local.get('guardian_auth');
      const history = await chrome.storage.local.get('guardian_tx_history');
      return {
        auth: auth.guardian_auth,
        history: history.guardian_tx_history,
      };
    });
  }

  const permitRecord = Array.isArray(state.history)
    ? state.history.find((item) => typeof item?.summary === 'string' && item.summary.toLowerCase().includes('permit2'))
    : null;

  const flowPassed =
    state?.auth?.user?.email === email
    && state?.auth?.usage?.remaining === 99
    && typeof permitRecord?.aiExplanation === 'string'
    && permitRecord.aiExplanation.length > 0;

  await popup.screenshot({ path: path.join(screenshotDir, 'guardian-auth-after-ai.png'), fullPage: true });

  console.log(JSON.stringify({
    ok: flowPassed,
    extensionId,
    email,
    usageRemaining: state.auth?.usage?.remaining ?? null,
    plan: state.auth?.user?.plan ?? null,
    lastError: state.auth?.lastError ?? null,
    permitRecord,
    screenshots: {
      register: path.join(screenshotDir, 'guardian-auth-register.png'),
      login: path.join(screenshotDir, 'guardian-auth-login.png'),
      beforeApprove: path.join(screenshotDir, 'guardian-auth-permit-before.png'),
      afterAi: path.join(screenshotDir, 'guardian-auth-after-ai.png'),
    },
  }, null, 2));
} finally {
  await context.close();
}
