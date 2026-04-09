import { createHmac } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const extensionPath = path.join(root, 'dist');
const screenshotDir = path.join(root, 'output', 'playwright');
const userDataDir = path.join(root, '.tmp', 'guardian-billing-refresh-profile');
const envPath = path.join(root, '.env');
const rawEnv = await fs.readFile(envPath, 'utf8').catch(() => '');
const env = Object.fromEntries(
  rawEnv
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#') && line.includes('='))
    .map((line) => {
      const idx = line.indexOf('=');
      return [line.slice(0, idx), line.slice(idx + 1)];
    }),
);

const apiBase = process.env.GUARDIAN_API_URL ?? 'https://enderzcxai.duckdns.org/guardian';
const webhookBase = process.env.GUARDIAN_WEBHOOK_BASE_URL ?? apiBase;
const webhookSecret = process.env.INFINI_WEBHOOK_SECRET ?? env.INFINI_WEBHOOK_SECRET;
if (!webhookSecret) {
  throw new Error('Missing INFINI_WEBHOOK_SECRET');
}

await fs.mkdir(screenshotDir, { recursive: true });
await fs.rm(userDataDir, { recursive: true, force: true });

const timestamp = Date.now();
const email = `guardian-billing-refresh-${timestamp}@example.com`;
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

async function postWebhook(merchantSubId) {
  const now = new Date();
  const inThirtyDays = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  const eventId = `evt_${Date.now()}`;
  const timestampSec = `${Math.floor(Date.now() / 1000)}`;
  const body = JSON.stringify({
    event: 'subscription.updated',
    data: {
      subscription: {
        merchant_sub_id: merchantSubId,
        plan_name: 'Guardian Pro',
        amount: '2.9',
        currency: 'USD',
        status: 'active',
        subscription_id: `sub_${Date.now()}`,
        payer_email: email,
        current_period_start: now.toISOString(),
        current_period_end: inThirtyDays.toISOString(),
      },
    },
  });
  const signature = createHmac('sha256', webhookSecret)
    .update(`${timestampSec}.${eventId}.${body}`)
    .digest('hex');

  const response = await fetch(`${webhookBase}/billing/webhook/infini`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Webhook-Timestamp': timestampSec,
      'X-Webhook-Event-Id': eventId,
      'X-Webhook-Signature': signature,
    },
    body,
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`webhook failed: ${response.status} ${text}`);
  }
}

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

  const checkoutPagePromise = context.waitForEvent('page', { timeout: 15000 });
  await popup.getByRole('button', { name: 'Choose PRO' }).click();
  const checkoutPage = await checkoutPagePromise;
  await checkoutPage.waitForLoadState('domcontentloaded');
  await checkoutPage.waitForTimeout(2000);
  await checkoutPage.screenshot({ path: path.join(screenshotDir, 'guardian-billing-refresh-checkout.png'), fullPage: true });

  const stateBefore = await popup.evaluate(async () => {
    const auth = await chrome.storage.local.get('guardian_auth');
    return auth.guardian_auth;
  });

  const merchantSubId = stateBefore?.billing?.pendingCheckout?.merchantSubId;
  if (!merchantSubId) {
    throw new Error(`Missing merchantSubId in auth state: ${JSON.stringify(stateBefore)}`);
  }

  await postWebhook(merchantSubId);

  await popup.getByRole('button', { name: 'Refresh' }).click();

  let stateAfter = null;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    stateAfter = await popup.evaluate(async () => {
      const auth = await chrome.storage.local.get('guardian_auth');
      return auth.guardian_auth;
    });

    if (stateAfter?.billing?.currentPlan === 'pro' && stateAfter?.user?.plan === 'pro') {
      break;
    }
    await popup.waitForTimeout(1500);
    await popup.getByRole('button', { name: 'Refresh' }).click();
  }

  await popup.screenshot({ path: path.join(screenshotDir, 'guardian-billing-refresh-after.png'), fullPage: true });

  console.log(JSON.stringify({
    ok: stateAfter?.billing?.currentPlan === 'pro' && stateAfter?.user?.plan === 'pro',
    extensionId,
    email,
    merchantSubId,
    currentPlan: stateAfter?.billing?.currentPlan ?? null,
    userPlan: stateAfter?.user?.plan ?? null,
    subscriptionStatus: stateAfter?.billing?.subscription?.status ?? null,
    screenshots: {
      checkout: path.join(screenshotDir, 'guardian-billing-refresh-checkout.png'),
      after: path.join(screenshotDir, 'guardian-billing-refresh-after.png'),
    },
  }, null, 2));
} finally {
  await context.close();
}
