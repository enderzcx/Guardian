import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const extensionPath = path.join(root, 'dist');
const screenshotDir = path.join(root, 'test-artifacts');
const userDataDir = path.join(root, '.tmp', 'guardian-smoke-profile');
const baseUrl = 'http://127.0.0.1:4173/test/test-dapp.html';

await fs.mkdir(screenshotDir, { recursive: true });
await fs.rm(userDataDir, { recursive: true, force: true });

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
  const page = context.pages()[0] ?? await context.newPage();

  const results = [];

  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);

  async function readLog() {
    return page.locator('#log').innerText();
  }

  async function clickOverlayButton(kind) {
    const size = page.viewportSize();
    if (!size) throw new Error('Missing viewport size');
    const x = kind === 'approve' ? size.width - 316 : size.width - 132;
    const y = size.height - 61;
    await page.mouse.click(x, y);
  }

  async function runScenario({ buttonText, decision, expectText, screenshotName }) {
    const before = await readLog();
    await page.getByRole('button', { name: buttonText }).click();
    await page.waitForTimeout(1800);
    await page.screenshot({ path: path.join(screenshotDir, screenshotName), fullPage: true });
    await clickOverlayButton(decision);
    await page.waitForFunction(
      ({ previous, expected }) => {
        const log = document.querySelector('#log')?.textContent ?? '';
        return log !== previous && log.includes(expected);
      },
      { previous: before, expected: expectText },
      { timeout: 15000 },
    );
    const after = await readLog();
    results.push({ buttonText, decision, expectText, logTail: after.split('\n').slice(-5) });
  }

  await runScenario({
    buttonText: 'Unlimited USDC Approve',
    decision: 'reject',
    expectText: 'Rejected: Guardian: Transaction rejected by user',
    screenshotName: 'approve-reject-flow.png',
  });

  await runScenario({
    buttonText: 'ETH Transfer (0.1 ETH)',
    decision: 'approve',
    expectText: 'Result: 0xmocktxhash',
    screenshotName: 'transfer-approve-flow.png',
  });

  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/src/popup/index.html`, { waitUntil: 'domcontentloaded' });
  await popup.waitForTimeout(1200);
  await popup.screenshot({ path: path.join(screenshotDir, 'popup-history.png'), fullPage: true });
  const popupText = await popup.locator('body').innerText();

  console.log(JSON.stringify({
    ok: true,
    extensionId,
    screenshots: {
      approveReject: path.join(screenshotDir, 'approve-reject-flow.png'),
      transferApprove: path.join(screenshotDir, 'transfer-approve-flow.png'),
      popup: path.join(screenshotDir, 'popup-history.png'),
    },
    results,
    popupSummary: popupText.split('\n').slice(0, 30),
  }, null, 2));
} finally {
  await context.close();
}
