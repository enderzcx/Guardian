import { createHmac } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
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

const apiBase = process.env.GUARDIAN_API_URL ?? 'http://127.0.0.1:3300';
const webhookSecret = process.env.INFINI_WEBHOOK_SECRET ?? env.INFINI_WEBHOOK_SECRET ?? env.INFINI_SECRET_KEY ?? env.infini_test_privitekey;
if (!webhookSecret) {
  throw new Error('Missing INFINI webhook secret in environment');
}

const email = `guardian-billing-${Date.now()}@example.com`;
const password = 'password123';

async function request(pathname, init = {}) {
  const response = await fetch(`${apiBase}${pathname}`, init);
  const text = await response.text();
  return {
    ok: response.ok,
    status: response.status,
    data: text ? JSON.parse(text) : null,
  };
}

const register = await request('/auth/register', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password }),
});
if (!register.ok || !register.data?.token) {
  throw new Error(`register failed: ${register.status} ${JSON.stringify(register.data)}`);
}

const token = register.data.token;

const checkout = await request('/billing/checkout', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  },
  body: JSON.stringify({ plan: 'pro' }),
});
if (!checkout.ok || typeof checkout.data?.checkoutUrl !== 'string') {
  throw new Error(`checkout failed: ${checkout.status} ${JSON.stringify(checkout.data)}`);
}

const meBefore = await request('/me', {
  headers: { Authorization: `Bearer ${token}` },
});
const merchantSubId = meBefore.data?.billing?.pendingCheckout?.merchantSubId;
if (!merchantSubId) {
  throw new Error(`merchantSubId missing: ${JSON.stringify(meBefore.data)}`);
}

const now = new Date();
const inThirtyDays = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
const eventBody = JSON.stringify({
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
const timestamp = `${Math.floor(Date.now() / 1000)}`;
const eventId = `evt_${Date.now()}`;
const signature = createHmac('sha256', webhookSecret)
  .update(`${timestamp}.${eventId}.${eventBody}`)
  .digest('hex');

const webhook = await request('/billing/webhook/infini', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-Webhook-Timestamp': timestamp,
    'X-Webhook-Event-Id': eventId,
    'X-Webhook-Signature': signature,
  },
  body: eventBody,
});
if (!webhook.ok) {
  throw new Error(`webhook failed: ${webhook.status} ${JSON.stringify(webhook.data)}`);
}

const meAfter = await request('/me', {
  headers: { Authorization: `Bearer ${token}` },
});

console.log(JSON.stringify({
  ok: meAfter.ok && meAfter.data?.billing?.currentPlan === 'pro',
  email,
  checkoutUrl: checkout.data.checkoutUrl,
  currentPlan: meAfter.data?.billing?.currentPlan ?? null,
  subscriptionStatus: meAfter.data?.billing?.subscription?.status ?? null,
  pendingCheckout: meAfter.data?.billing?.pendingCheckout ?? null,
}, null, 2));
