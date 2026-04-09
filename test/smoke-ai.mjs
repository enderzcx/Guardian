import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const extensionPath = path.join(root, 'dist');
const screenshotDir = path.join(root, 'test-artifacts');
const userDataDir = path.join(root, '.tmp', 'guardian-ai-profile');
const baseUrl = 'http://127.0.0.1:4173/test/test-dapp.html';

await fs.mkdir(screenshotDir, { recursive: true });
await fs.rm(userDataDir, { recursive: true, force: true });
const envText = await fs.readFile(path.join(root, '.env.local'), 'utf8');
const env = Object.fromEntries(
  envText
    .split(/\r?\n/)
    .filter((line) => line.includes('='))
    .map((line) => {
      const [key, ...rest] = line.split('=');
      return [key, rest.join('=')];
    }),
);

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
  const setup = await context.newPage();
  await setup.goto(`chrome-extension://${extensionId}/src/popup/index.html`, { waitUntil: 'domcontentloaded' });
  await setup.evaluate(async ({ apiKey, apiUrl }) => {
    await chrome.storage.local.set({
      openai_api_key: apiKey,
      openai_api_url: apiUrl,
    });
  }, {
    apiKey: env.VITE_OPENAI_API_KEY ?? '',
    apiUrl: env.VITE_OPENAI_API_URL ?? 'https://api.openai.com/v1/chat/completions',
  });
  await setup.close();

  const page = context.pages()[0] ?? await context.newPage();

  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);

  const logBefore = await page.locator('#log').innerText();
  await page.getByRole('button', { name: 'Permit2 Signature' }).click();
  await page.waitForTimeout(1800);
  await page.screenshot({ path: path.join(screenshotDir, 'permit2-before-ai.png'), fullPage: true });

  const size = page.viewportSize();
  if (!size) throw new Error('Missing viewport size');
  await page.mouse.click(size.width - 316, size.height - 61);

  await page.waitForFunction(
    (previous) => {
      const log = document.querySelector('#log')?.textContent ?? '';
      return log !== previous && log.includes('Result: 0xmocksignature');
    },
    logBefore,
    { timeout: 15000 },
  );

  // callLLM waits up to 8s and retries once after 1s backoff,
  // so give Tier 2 enough time to finish end-to-end.
  await page.waitForTimeout(20000);

  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/src/popup/index.html`, { waitUntil: 'domcontentloaded' });
  await popup.waitForTimeout(1200);

  const storage = await popup.evaluate(async () => chrome.storage.local.get(['guardian_tx_history']));
  const history = Array.isArray(storage.guardian_tx_history) ? storage.guardian_tx_history : [];
  const permitRecord = history.find((item) => typeof item?.summary === 'string' && item.summary.toLowerCase().includes('permit2'));

  await popup.screenshot({ path: path.join(screenshotDir, 'popup-ai-history.png'), fullPage: true });

  console.log(JSON.stringify({
    ok: Boolean(permitRecord?.aiExplanation),
    extensionId,
    permitRecord,
    screenshots: {
      permitCard: path.join(screenshotDir, 'permit2-before-ai.png'),
      popup: path.join(screenshotDir, 'popup-ai-history.png'),
    },
  }, null, 2));
} finally {
  await context.close();
}
