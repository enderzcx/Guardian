import { createHash, createHmac, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { existsSync, promises as fs, readFileSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadEnvFile(path.join(__dirname, '..', '.env'));

const PORT = Number(process.env.GUARDIAN_API_PORT ?? 3300);
const HOST = process.env.GUARDIAN_API_HOST ?? '127.0.0.1';
const configuredJwtSecret = process.env.GUARDIAN_JWT_SECRET?.trim();
const JWT_SECRET = configuredJwtSecret || randomBytes(32).toString('hex');
const ADMIN_SECRET = process.env.GUARDIAN_ADMIN_SECRET ?? '';
const DATA_DIR = process.env.GUARDIAN_DATA_DIR ?? path.join(__dirname, '..', 'server-data');
const DATA_FILE = path.join(DATA_DIR, 'users.json');
const CODEX_PROXY_URL = process.env.CODEX_PROXY_URL ?? 'http://127.0.0.1:8080/v1/chat/completions';
const CODEX_PROXY_API_KEY = process.env.CODEX_PROXY_API_KEY ?? '';
const AI_MODEL = process.env.GUARDIAN_AI_MODEL ?? 'gpt-5.4-mini';
const BILLING_TIMEZONE = process.env.GUARDIAN_BILLING_TZ ?? 'UTC';
const TOKEN_TTL_SECONDS = Number(process.env.GUARDIAN_TOKEN_TTL_SECONDS ?? 60 * 60 * 24 * 30);
const ANALYSIS_TIMEOUT_MS = Number(process.env.GUARDIAN_AI_TIMEOUT_MS ?? 15_000);
const CACHE_TTL_MS = Number(process.env.GUARDIAN_CACHE_TTL_MS ?? 30 * 60 * 1000);
const inferredInfiniBaseUrl = process.env.infini_test_publickey || process.env.infini_test_privitekey
  ? 'https://openapi-sandbox.infini.money'
  : 'https://openapi.infini.money';
const INFINI_BASE_URL = process.env.INFINI_BASE_URL ?? inferredInfiniBaseUrl;
const INFINI_KEY_ID = process.env.INFINI_KEY_ID ?? process.env.infini_test_publickey ?? '';
const INFINI_SECRET_KEY = process.env.INFINI_SECRET_KEY ?? process.env.infini_test_privitekey ?? '';
const INFINI_WEBHOOK_SECRET = process.env.INFINI_WEBHOOK_SECRET ?? INFINI_SECRET_KEY;
const GUARDIAN_PUBLIC_BASE_URL = (process.env.GUARDIAN_PUBLIC_BASE_URL ?? 'https://enderzcxai.duckdns.org/guardian').replace(/\/+$/, '');

const PLAN_LIMITS = {
  free: Number(process.env.GUARDIAN_FREE_MONTHLY_LIMIT ?? 100),
  pro: Number(process.env.GUARDIAN_PRO_MONTHLY_LIMIT ?? 5000),
  max: Number(process.env.GUARDIAN_MAX_MONTHLY_LIMIT ?? 20000),
};

const PLAN_BILLING = {
  pro: {
    amount: '2.9',
    currency: 'USD',
    displayName: 'Guardian Pro',
    description: 'Guardian Pro monthly AI plan',
  },
  max: {
    amount: '9.9',
    currency: 'USD',
    displayName: 'Guardian Max',
    description: 'Guardian Max monthly AI plan',
  },
};

const responseCache = new Map();
const inFlightAnalyses = new Map();

let store = { users: [], checkoutSessions: [], billingEvents: [] };
let saveChain = Promise.resolve();

function loadEnvFile(filePath) {
  if (!existsSync(filePath)) return;
  const raw = readFileSync(filePath, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separator = trimmed.indexOf('=');
    if (separator <= 0) continue;
    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith('\'') && value.endsWith('\''))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

async function ensureDataFile() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    await fs.access(DATA_FILE);
  } catch {
    await fs.writeFile(DATA_FILE, JSON.stringify(store, null, 2));
  }
}

async function loadStore() {
  await ensureDataFile();
  const raw = await fs.readFile(DATA_FILE, 'utf8');
  try {
    const parsed = JSON.parse(raw);
    store = {
      users: Array.isArray(parsed.users)
        ? parsed.users.map((user) => ({
          ...user,
          plan: normalizePlan(user.plan),
          monthlyUsage: user.monthlyUsage ?? {
            month: getMonthKey(),
            count: 0,
            keys: [],
          },
        }))
        : [],
      checkoutSessions: Array.isArray(parsed.checkoutSessions) ? parsed.checkoutSessions : [],
      billingEvents: Array.isArray(parsed.billingEvents) ? parsed.billingEvents : [],
    };
  } catch {
    store = { users: [], checkoutSessions: [], billingEvents: [] };
  }
}

async function saveStore() {
  const snapshot = JSON.stringify(store, null, 2);
  saveChain = saveChain.then(async () => {
    await fs.mkdir(DATA_DIR, { recursive: true });
    const tempFile = `${DATA_FILE}.tmp`;
    await fs.writeFile(tempFile, snapshot);
    await fs.rename(tempFile, DATA_FILE);
  });
  await saveChain;
}

function json(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Guardian-Admin-Secret',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  });
  res.end(JSON.stringify(body));
}

function normalizeEmail(email) {
  return String(email ?? '').trim().toLowerCase();
}

function nowIso() {
  return new Date().toISOString();
}

function normalizePlan(plan) {
  if (plan === 'max') return 'max';
  if (plan === 'pro' || plan === 'paid') return 'pro';
  return 'free';
}

function createRequestId(prefix) {
  return `${prefix}_${randomBytes(12).toString('hex')}`;
}

function createUuid() {
  return randomUUID();
}

function inferPlanFromBilling(planName, amount) {
  const normalizedName = String(planName ?? '').toLowerCase();
  const normalizedAmount = String(amount ?? '').trim();
  if (normalizedName.includes('max') || normalizedAmount === PLAN_BILLING.max.amount) return 'max';
  if (normalizedName.includes('pro') || normalizedAmount === PLAN_BILLING.pro.amount) return 'pro';
  return 'free';
}

function createUserId() {
  return `usr_${randomBytes(8).toString('hex')}`;
}

function toBase64Url(value) {
  return Buffer.from(value).toString('base64url');
}

function fromBase64Url(value) {
  return Buffer.from(value, 'base64url').toString('utf8');
}

function signToken(payload) {
  const encoded = toBase64Url(JSON.stringify(payload));
  const signature = createHmac('sha256', JWT_SECRET).update(encoded).digest('base64url');
  return `${encoded}.${signature}`;
}

function verifyToken(token) {
  if (!token || !token.includes('.')) return null;
  const [encoded, signature] = token.split('.');
  if (!encoded || !signature) return null;
  const expected = createHmac('sha256', JWT_SECRET).update(encoded).digest('base64url');
  if (signature.length !== expected.length) return null;
  const valid = timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  if (!valid) return null;

  try {
    const payload = JSON.parse(fromBase64Url(encoded));
    if (!payload?.sub || !payload?.exp) return null;
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

function passwordHash(password, salt = randomBytes(16).toString('hex')) {
  const digest = scryptSync(password, salt, 64).toString('hex');
  return { salt, hash: digest };
}

function verifyPassword(password, salt, hash) {
  const digest = scryptSync(password, salt, 64).toString('hex');
  return timingSafeEqual(Buffer.from(digest), Buffer.from(hash));
}

function getMonthKey(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: BILLING_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
  }).format(date);
}

function getNextResetAt() {
  const currentKey = getMonthKey();
  let probe = new Date(Date.now() + 60 * 60 * 1000);
  for (let i = 0; i < 24 * 40; i += 1) {
    if (getMonthKey(probe) !== currentKey) {
      return probe.toISOString();
    }
    probe = new Date(probe.getTime() + 60 * 60 * 1000);
  }
  return new Date(Date.now() + 31 * 24 * 60 * 60 * 1000).toISOString();
}

function getCurrentMonthlyUsage(user) {
  const month = getMonthKey();
  const usage = user.monthlyUsage?.month === month
    ? user.monthlyUsage
    : { month, count: 0, keys: [] };

  return {
    month,
    count: Number(usage.count ?? 0),
    keys: Array.isArray(usage.keys) ? usage.keys.map(String) : [],
  };
}

function getUsageView(user) {
  const plan = getEffectivePlan(user);
  const usage = getCurrentMonthlyUsage(user);
  const limit = PLAN_LIMITS[plan] ?? PLAN_LIMITS.free;
  const remaining = Math.max(limit - usage.count, 0);
  return {
    limit,
    used: usage.count,
    remaining,
    resetAt: getNextResetAt(),
    timezone: BILLING_TIMEZONE,
    period: 'month',
  };
}

function sanitizeUser(user) {
  return {
    id: user.id,
    email: user.email,
    plan: getEffectivePlan(user),
    createdAt: user.createdAt,
  };
}

function getBearerToken(req) {
  const header = req.headers.authorization ?? '';
  if (!header.startsWith('Bearer ')) return null;
  return header.slice('Bearer '.length).trim();
}

async function parseJsonBody(req) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 1_000_000) {
      throw new Error('Request body too large');
    }
  }
  return body ? JSON.parse(body) : {};
}

async function parseRawBody(req) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 1_000_000) {
      throw new Error('Request body too large');
    }
  }
  return body;
}

function findUserByEmail(email) {
  return store.users.find((user) => user.email === email) ?? null;
}

function findUserById(id) {
  return store.users.find((user) => user.id === id) ?? null;
}

function getEffectivePlan(user) {
  const basePlan = normalizePlan(user.plan);
  if (!user.subscription) return basePlan;

  const subscriptionPlan = normalizePlan(user.subscription.plan ?? basePlan);
  const status = String(user.subscription.status ?? '').toLowerCase();
  const currentPeriodEnd = user.subscription.currentPeriodEnd ? Date.parse(user.subscription.currentPeriodEnd) : Number.NaN;

  if (status === 'active' || status === 'trialing') return subscriptionPlan;
  if (status === 'canceled' || status === 'cancelled') {
    if (Number.isFinite(currentPeriodEnd) && currentPeriodEnd > Date.now()) {
      return subscriptionPlan;
    }
    return 'free';
  }

  return basePlan;
}

function sanitizeSubscription(user) {
  if (!user.subscription) return null;
  return {
    provider: 'infini',
    status: user.subscription.status ?? 'pending',
    plan: normalizePlan(user.subscription.plan ?? user.plan),
    amount: user.subscription.amount ?? null,
    currency: user.subscription.currency ?? null,
    merchantSubId: user.subscription.merchantSubId ?? null,
    subscriptionId: user.subscription.subscriptionId ?? null,
    payerEmail: user.subscription.payerEmail ?? user.email,
    currentPeriodStart: user.subscription.currentPeriodStart ?? null,
    currentPeriodEnd: user.subscription.currentPeriodEnd ?? null,
    cancelAtPeriodEnd: Boolean(user.subscription.cancelAtPeriodEnd),
    canceledAt: user.subscription.canceledAt ?? null,
    updatedAt: user.subscription.updatedAt ?? null,
  };
}

function sanitizePendingCheckout(user) {
  if (!user.pendingCheckout) return null;
  return {
    plan: normalizePlan(user.pendingCheckout.plan ?? 'free'),
    checkoutUrl: user.pendingCheckout.checkoutUrl ?? null,
    merchantSubId: user.pendingCheckout.merchantSubId ?? null,
    createdAt: user.pendingCheckout.createdAt ?? null,
    status: user.pendingCheckout.status ?? 'pending',
  };
}

function sanitizeBilling(user) {
  return {
    currentPlan: getEffectivePlan(user),
    subscription: sanitizeSubscription(user),
    pendingCheckout: sanitizePendingCheckout(user),
    plans: {
      free: { quota: PLAN_LIMITS.free, price: '0' },
      pro: { quota: PLAN_LIMITS.pro, price: PLAN_BILLING.pro.amount },
      max: { quota: PLAN_LIMITS.max, price: PLAN_BILLING.max.amount },
    },
  };
}

function createAuthToken(user) {
  return signToken({
    sub: user.id,
    email: user.email,
    plan: normalizePlan(user.plan),
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS,
  });
}

function requireAdmin(req) {
  if (!ADMIN_SECRET) return false;
  const provided = req.headers['x-guardian-admin-secret'];
  return typeof provided === 'string' && provided === ADMIN_SECRET;
}

function getCachedAnalysis(cacheKey) {
  if (!cacheKey) return null;
  const entry = responseCache.get(cacheKey);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
    responseCache.delete(cacheKey);
    return null;
  }
  return entry.result;
}

function setCachedAnalysis(cacheKey, result) {
  if (!cacheKey) return;
  responseCache.set(cacheKey, {
    result,
    timestamp: Date.now(),
  });
}

function isInfiniConfigured() {
  return Boolean(INFINI_KEY_ID && INFINI_SECRET_KEY);
}

function getInfiniSecretCandidates() {
  const raw = INFINI_SECRET_KEY.trim();
  const candidates = [raw];

  if (/^[A-Za-z0-9\-_]+=*$/.test(raw)) {
    try {
      const decoded = Buffer.from(raw, 'base64url');
      if (decoded.length > 0) candidates.push(decoded);
    } catch {}
  }

  return candidates;
}

function getInfiniAuthHeaderVariants(method, requestPath, body = '', secretKey = INFINI_SECRET_KEY) {
  const date = new Date().toUTCString();
  const digest = body
    ? `SHA-256=${createHash('sha256').update(body).digest('base64')}`
    : '';
  const variants = [
    {
      signingString: `${INFINI_KEY_ID}\n${method.toUpperCase()} ${requestPath}\ndate: ${date}\n`,
      headersLabel: '@request-target date',
      includeDigestInSignature: false,
      requestTargetLabel: null,
    },
    {
      signingString: `${INFINI_KEY_ID}\n${method.toUpperCase()} ${requestPath}\n date: ${date}\n`,
      headersLabel: '@request-target date',
      includeDigestInSignature: false,
      requestTargetLabel: null,
    },
    {
      signingString: `(request-target): ${method.toLowerCase()} ${requestPath}\ndate: ${date}`,
      headersLabel: '(request-target) date',
      includeDigestInSignature: false,
      requestTargetLabel: '(request-target)',
    },
    {
      signingString: digest
        ? `(request-target): ${method.toLowerCase()} ${requestPath}\ndate: ${date}\ndigest: ${digest}`
        : `(request-target): ${method.toLowerCase()} ${requestPath}\ndate: ${date}`,
      headersLabel: digest ? '(request-target) date digest' : '(request-target) date',
      includeDigestInSignature: Boolean(digest),
      requestTargetLabel: '(request-target)',
    },
  ];

  return variants.map((variant) => {
    const signature = createHmac('sha256', secretKey)
      .update(variant.signingString)
      .digest('base64');

    const headers = {
      Date: date,
      Authorization: `Signature keyId="${INFINI_KEY_ID}",algorithm="hmac-sha256",headers="${variant.headersLabel}",signature="${signature}"`,
    };

    if (!digest) return headers;
    return {
      ...headers,
      Digest: digest,
    };
  });
}

async function callInfini(method, requestPath, payload = null) {
  if (!isInfiniConfigured()) {
    throw new Error('Infini API credentials are not configured');
  }

  const body = payload ? JSON.stringify(payload) : '';
  const secretCandidates = getInfiniSecretCandidates();
  let lastError = null;

  for (const secretKey of secretCandidates) {
    for (const headers of getInfiniAuthHeaderVariants(method, requestPath, body, secretKey)) {
      const response = await fetch(`${INFINI_BASE_URL}${requestPath}`, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...headers,
        },
        body: body || undefined,
        signal: AbortSignal.timeout(20_000),
      });

      const text = await response.text();
      let data = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        data = null;
      }
      if (response.ok) {
        return data?.data ?? data;
      }

      const message = data?.msg ?? data?.message ?? text ?? 'Infini request failed';
      lastError = new Error(`Infini ${response.status}: ${message}`);
      if (response.status !== 401) break;
    }
  }

  throw lastError ?? new Error('Infini request failed');
}

function getPublicUrl(pathname) {
  return `${GUARDIAN_PUBLIC_BASE_URL}${pathname.startsWith('/') ? pathname : `/${pathname}`}`;
}

function createSubscriptionPayload(user, plan) {
  const config = PLAN_BILLING[plan];
  const requestId = createUuid();
  const merchantSubId = `guardian_${plan}_${user.id}_${Date.now()}`;

  return {
    requestId,
    merchantSubId,
    payload: {
      request_id: requestId,
      amount: config.amount,
      currency: config.currency,
      client_reference: `${user.id}:${plan}:${Date.now()}`,
      order_desc: config.description,
      success_url: getPublicUrl(`/checkout/success?plan=${plan}`),
      failure_url: getPublicUrl(`/checkout/failure?plan=${plan}`),
      subscription: {
        merchant_sub_id: merchantSubId,
        plan_name: config.displayName,
        amount: config.amount,
        interval_unit: 'MONTH',
        interval_count: 1,
        invoice_lead_days: 0,
        invoice_due_days: 1,
        payer_email: user.email,
        canceled_url: getPublicUrl(`/checkout/cancel?plan=${plan}`),
      },
    },
  };
}

function findCheckoutByMerchantSubId(merchantSubId) {
  return store.checkoutSessions.find((session) => session.merchantSubId === merchantSubId) ?? null;
}

function findProcessedEvent(eventId) {
  return store.billingEvents.find((event) => event.eventId === eventId) ?? null;
}

function parseWebhookSignature(headers, rawBody) {
  const timestamp = String(headers['x-webhook-timestamp'] ?? '');
  const eventId = String(headers['x-webhook-event-id'] ?? '');
  const signature = String(headers['x-webhook-signature'] ?? '');
  if (!timestamp || !eventId || !signature) return { ok: false, reason: 'Missing webhook signature headers' };

  const payload = `${timestamp}.${eventId}.${rawBody}`;
  const expected = createHmac('sha256', INFINI_WEBHOOK_SECRET).update(payload).digest('hex');
  if (expected !== signature) return { ok: false, reason: 'Invalid webhook signature' };

  return { ok: true, timestamp, eventId };
}

function resolveWebhookPlan(payload, fallbackUser = null) {
  const subscriptionLike = payload?.data?.subscription ?? payload?.subscription ?? payload?.data ?? payload;
  const fallbackPlan = fallbackUser ? normalizePlan(fallbackUser.subscription?.plan ?? fallbackUser.plan) : 'free';
  return normalizePlan(
    inferPlanFromBilling(subscriptionLike?.plan_name, subscriptionLike?.amount) || fallbackPlan,
  );
}

function extractWebhookSubscription(payload) {
  return payload?.data?.subscription ?? payload?.subscription ?? payload?.data ?? payload;
}

function updateUserSubscriptionFromWebhook(user, payload, eventType) {
  const subscriptionData = extractWebhookSubscription(payload);
  const plan = resolveWebhookPlan(payload, user);
  const status = String(
    subscriptionData?.status
      ?? (eventType === 'subscription.canceled' ? 'canceled' : eventType === 'subscription.updated' ? 'active' : 'pending'),
  ).toLowerCase();
  const cancelAtPeriodEnd = subscriptionData?.cancel_at_period_end ?? user.subscription?.cancelAtPeriodEnd ?? false;

  user.subscription = {
    provider: 'infini',
    plan,
    status,
    amount: String(subscriptionData?.amount ?? PLAN_BILLING[plan]?.amount ?? ''),
    currency: String(subscriptionData?.currency ?? PLAN_BILLING[plan]?.currency ?? 'USD'),
    merchantSubId: String(subscriptionData?.merchant_sub_id ?? subscriptionData?.merchantSubId ?? user.subscription?.merchantSubId ?? ''),
    subscriptionId: String(subscriptionData?.subscription_id ?? subscriptionData?.id ?? user.subscription?.subscriptionId ?? ''),
    payerEmail: String(subscriptionData?.payer_email ?? user.email),
    currentPeriodStart: subscriptionData?.current_period_start ?? user.subscription?.currentPeriodStart ?? null,
    currentPeriodEnd: subscriptionData?.current_period_end ?? user.subscription?.currentPeriodEnd ?? null,
    cancelAtPeriodEnd: Boolean(cancelAtPeriodEnd || status === 'canceled' || status === 'cancelled'),
    canceledAt: subscriptionData?.canceled_at ?? user.subscription?.canceledAt ?? null,
    updatedAt: nowIso(),
  };

  if (status === 'active' || status === 'trialing') {
    user.plan = plan;
    user.pendingCheckout = null;
    return;
  }

  if (status === 'canceled' || status === 'cancelled') {
    user.pendingCheckout = null;
    const currentPeriodEndMs = user.subscription.currentPeriodEnd ? Date.parse(user.subscription.currentPeriodEnd) : Number.NaN;
    user.plan = Number.isFinite(currentPeriodEndMs) && currentPeriodEndMs > Date.now() ? plan : 'free';
    return;
  }

  user.pendingCheckout = {
    plan,
    checkoutUrl: user.pendingCheckout?.checkoutUrl ?? null,
    merchantSubId: user.subscription.merchantSubId,
    createdAt: user.pendingCheckout?.createdAt ?? nowIso(),
    status,
  };
}

async function callCodexProxy(system, userPrompt) {
  if (!CODEX_PROXY_API_KEY) {
    throw new Error('CODEX_PROXY_API_KEY is not configured');
  }

  const response = await fetch(CODEX_PROXY_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${CODEX_PROXY_API_KEY}`,
    },
    body: JSON.stringify({
      model: AI_MODEL,
      temperature: 0,
      max_tokens: 400,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: userPrompt },
      ],
    }),
    signal: AbortSignal.timeout(ANALYSIS_TIMEOUT_MS),
  });

  if (!response.ok) {
    const message = await response.text().catch(() => 'Unknown upstream error');
    throw new Error(`Proxy returned ${response.status}: ${message}`);
  }

  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) {
    throw new Error('Proxy response missing message content');
  }

  const parsed = JSON.parse(content);
  const score = Number(parsed.score);
  if (Number.isNaN(score) || score < 0 || score > 100) {
    throw new Error('Invalid score from AI response');
  }

  return {
    score: Math.round(score),
    explanation: String(parsed.explanation ?? '').trim(),
    risk_factors: Array.isArray(parsed.risk_factors) ? parsed.risk_factors.map(String).slice(0, 5) : [],
    action_suggestion: ['approve', 'set_exact_amount', 'review_carefully', 'reject'].includes(parsed.action_suggestion)
      ? parsed.action_suggestion
      : 'review_carefully',
  };
}

async function authenticate(req, res) {
  const token = getBearerToken(req);
  const payload = verifyToken(token);
  if (!payload) {
    json(res, 401, { error: 'Unauthorized', code: 'unauthorized' });
    return null;
  }

  const user = findUserById(payload.sub);
  if (!user) {
    json(res, 401, { error: 'Unknown user', code: 'unauthorized' });
    return null;
  }

  if (user.subscription) {
    const effectivePlan = getEffectivePlan(user);
    if (normalizePlan(user.plan) !== effectivePlan) {
      user.plan = effectivePlan;
      user.updatedAt = nowIso();
      await saveStore();
    }
  }

  return user;
}

async function handleRegister(req, res) {
  const body = await parseJsonBody(req);
  const email = normalizeEmail(body.email);
  const password = String(body.password ?? '');

  if (!email || !email.includes('@')) {
    return json(res, 400, { error: 'A valid email is required', code: 'invalid_email' });
  }
  if (password.length < 8) {
    return json(res, 400, { error: 'Password must be at least 8 characters', code: 'weak_password' });
  }
  if (findUserByEmail(email)) {
    return json(res, 409, { error: 'Account already exists', code: 'email_taken' });
  }

  const passwordInfo = passwordHash(password);
  const createdAt = nowIso();
  const user = {
    id: createUserId(),
    email,
    plan: 'free',
    passwordSalt: passwordInfo.salt,
    passwordHash: passwordInfo.hash,
    monthlyUsage: { month: getMonthKey(), count: 0, keys: [] },
    createdAt,
    updatedAt: createdAt,
  };

  store.users.push(user);
  await saveStore();

  json(res, 201, {
    token: createAuthToken(user),
    user: sanitizeUser(user),
    usage: getUsageView(user),
    billing: sanitizeBilling(user),
  });
}

async function handleLogin(req, res) {
  const body = await parseJsonBody(req);
  const email = normalizeEmail(body.email);
  const password = String(body.password ?? '');
  const user = findUserByEmail(email);

  if (!user || !verifyPassword(password, user.passwordSalt, user.passwordHash)) {
    return json(res, 401, { error: 'Invalid credentials', code: 'invalid_credentials' });
  }

  json(res, 200, {
    token: createAuthToken(user),
    user: sanitizeUser(user),
    usage: getUsageView(user),
    billing: sanitizeBilling(user),
  });
}

async function handleMe(req, res) {
  const user = await authenticate(req, res);
  if (!user) return;
  json(res, 200, {
    user: sanitizeUser(user),
    usage: getUsageView(user),
    billing: sanitizeBilling(user),
  });
}

async function handleUsage(req, res) {
  const user = await authenticate(req, res);
  if (!user) return;
  json(res, 200, { usage: getUsageView(user) });
}

async function handleBillingSubscription(req, res) {
  const user = await authenticate(req, res);
  if (!user) return;
  json(res, 200, { billing: sanitizeBilling(user) });
}

async function handleBillingCheckout(req, res) {
  const user = await authenticate(req, res);
  if (!user) return;

  const body = await parseJsonBody(req);
  const plan = body.plan === 'pro' || body.plan === 'max' ? body.plan : null;
  if (!plan) {
    return json(res, 400, { error: 'plan must be pro or max', code: 'invalid_plan' });
  }
  if (!isInfiniConfigured()) {
    return json(res, 503, { error: 'Infini billing is not configured', code: 'billing_unavailable' });
  }

  const activePlan = getEffectivePlan(user);
  if (activePlan !== 'free') {
    return json(res, 409, {
      error: 'Switching plans is not available yet. Cancel the current subscription first.',
      code: 'plan_change_locked',
      billing: sanitizeBilling(user),
    });
  }

  const draft = createSubscriptionPayload(user, plan);
  const response = await callInfini('POST', '/v1/acquiring/subscription', draft.payload);
  const checkoutUrl = response?.checkout_url ?? response?.checkoutUrl ?? response?.url ?? null;
  const subscriptionId = response?.subscription_id ?? response?.subscriptionId ?? null;
  if (!checkoutUrl) {
    throw new Error('Infini response did not include checkout_url');
  }

  const createdAt = nowIso();
  const checkoutSession = {
    id: createRequestId('chk'),
    userId: user.id,
    plan,
    requestId: draft.requestId,
    merchantSubId: draft.merchantSubId,
    subscriptionId,
    checkoutUrl,
    status: 'pending',
    createdAt,
    updatedAt: createdAt,
  };

  store.checkoutSessions.push(checkoutSession);
  user.pendingCheckout = {
    plan,
    checkoutUrl,
    merchantSubId: draft.merchantSubId,
    createdAt,
    status: 'pending',
  };
  user.subscription = {
    provider: 'infini',
    plan,
    status: 'pending',
    amount: PLAN_BILLING[plan].amount,
    currency: PLAN_BILLING[plan].currency,
    merchantSubId: draft.merchantSubId,
    subscriptionId,
    payerEmail: user.email,
    currentPeriodStart: null,
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
    canceledAt: null,
    updatedAt: createdAt,
  };
  user.updatedAt = createdAt;
  await saveStore();

  json(res, 200, {
    checkoutUrl,
    billing: sanitizeBilling(user),
  });
}

async function handleBillingCancel(req, res) {
  const user = await authenticate(req, res);
  if (!user) return;

  const merchantSubId = user.subscription?.merchantSubId;
  if (!merchantSubId) {
    return json(res, 400, { error: 'No active subscription to cancel', code: 'subscription_missing' });
  }
  if (!isInfiniConfigured()) {
    return json(res, 503, { error: 'Infini billing is not configured', code: 'billing_unavailable' });
  }

  await callInfini('POST', '/v1/acquiring/subscription/cancel', {
    request_id: createUuid(),
    merchant_sub_id: merchantSubId,
    cancel_reason: 'by_merchant_api',
  });

  user.subscription = {
    ...user.subscription,
    status: 'canceled',
    cancelAtPeriodEnd: true,
    canceledAt: nowIso(),
    updatedAt: nowIso(),
  };
  user.updatedAt = nowIso();
  await saveStore();

  json(res, 200, { billing: sanitizeBilling(user) });
}

async function handleBillingWebhook(req, res) {
  const rawBody = await parseRawBody(req);
  const verification = parseWebhookSignature(req.headers, rawBody);
  if (!verification.ok) {
    return json(res, 401, { error: verification.reason, code: 'invalid_webhook_signature' });
  }

  if (findProcessedEvent(verification.eventId)) {
    return json(res, 200, { ok: true, duplicate: true });
  }

  const payload = rawBody ? JSON.parse(rawBody) : {};
  const eventType = String(payload?.event ?? payload?.type ?? payload?.event_type ?? payload?.eventType ?? '');
  const subscriptionData = extractWebhookSubscription(payload);
  const merchantSubId = String(subscriptionData?.merchant_sub_id ?? subscriptionData?.merchantSubId ?? '');
  const checkout = merchantSubId ? findCheckoutByMerchantSubId(merchantSubId) : null;
  const user = checkout ? findUserById(checkout.userId) : store.users.find((candidate) => candidate.subscription?.merchantSubId === merchantSubId) ?? null;

  store.billingEvents.push({
    eventId: verification.eventId,
    eventType,
    merchantSubId,
    receivedAt: nowIso(),
    payload,
  });

  if (checkout) {
    checkout.status = eventType || subscriptionData?.status || 'updated';
    checkout.updatedAt = nowIso();
    if (subscriptionData?.id || subscriptionData?.subscription_id) {
      checkout.subscriptionId = subscriptionData?.id ?? subscriptionData?.subscription_id;
    }
  }

  if (user) {
    updateUserSubscriptionFromWebhook(user, payload, eventType);
    user.updatedAt = nowIso();
  }

  await saveStore();
  json(res, 200, { ok: true });
}

function renderCheckoutPage(title, body) {
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title}</title>
    <style>
      body { font-family: Inter, system-ui, sans-serif; background: #0f1220; color: #f6f7fb; padding: 40px; }
      .card { max-width: 560px; margin: 40px auto; padding: 28px; border-radius: 18px; background: linear-gradient(180deg, rgba(255,255,255,0.06), rgba(255,255,255,0.03)); border: 1px solid rgba(255,255,255,0.08); }
      h1 { margin: 0 0 12px; font-size: 26px; }
      p { opacity: 0.78; line-height: 1.6; }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>${title}</h1>
      <p>${body}</p>
    </div>
  </body>
</html>`;
}

async function handleAnalyze(req, res) {
  const user = await authenticate(req, res);
  if (!user) return;

  const body = await parseJsonBody(req);
  const cacheKey = String(body.cacheKey ?? '').trim();
  const system = String(body.system ?? '').trim();
  const userPrompt = String(body.userPrompt ?? '').trim();

  if (!cacheKey || !system || !userPrompt) {
    return json(res, 400, { error: 'cacheKey, system, and userPrompt are required', code: 'invalid_request' });
  }

  const monthlyUsage = getCurrentMonthlyUsage(user);
  const alreadyCounted = monthlyUsage.keys.includes(cacheKey);
  const usage = getUsageView(user);
  if ((usage.remaining ?? 0) <= 0 && !alreadyCounted) {
    return json(res, 429, {
      error: 'Monthly AI analysis limit reached',
      code: 'quota_exceeded',
      usage,
    });
  }

  const cached = getCachedAnalysis(cacheKey);
  if (cached) {
    if (!alreadyCounted) {
      user.monthlyUsage = {
        month: monthlyUsage.month,
        count: monthlyUsage.count + 1,
        keys: [...monthlyUsage.keys, cacheKey],
      };
      user.updatedAt = nowIso();
      await saveStore();
    }

    return json(res, 200, {
      cached: true,
      analysis: cached,
      usage: getUsageView(user),
    });
  }

  let promise = inFlightAnalyses.get(cacheKey);
  let reservedUsageSlot = false;
  if (!promise) {
    if (!alreadyCounted) {
      user.monthlyUsage = {
        month: monthlyUsage.month,
        count: monthlyUsage.count + 1,
        keys: [...monthlyUsage.keys, cacheKey],
      };
      user.updatedAt = nowIso();
      reservedUsageSlot = true;
      await saveStore();
    }

    promise = callCodexProxy(system, userPrompt)
      .then((analysis) => {
        setCachedAnalysis(cacheKey, analysis);
        return analysis;
      })
      .finally(() => {
        inFlightAnalyses.delete(cacheKey);
      });
    inFlightAnalyses.set(cacheKey, promise);
  }

  try {
    const analysis = await promise;
    json(res, 200, {
      cached: false,
      analysis,
      usage: getUsageView(user),
    });
  } catch (error) {
    if (reservedUsageSlot) {
      const currentUsage = getCurrentMonthlyUsage(user);
      user.monthlyUsage = {
        month: currentUsage.month,
        count: Math.max(currentUsage.count - 1, 0),
        keys: currentUsage.keys.filter((key) => key !== cacheKey),
      };
      user.updatedAt = nowIso();
      await saveStore();
    }
    json(res, 502, {
      error: error instanceof Error ? error.message : 'AI proxy failed',
      code: 'proxy_failed',
    });
  }
}

async function handleAdminPlan(req, res) {
  if (!requireAdmin(req)) {
    return json(res, 401, { error: 'Unauthorized', code: 'admin_unauthorized' });
  }

  const body = await parseJsonBody(req);
  const email = normalizeEmail(body.email);
  const plan = ['free', 'pro', 'max', 'paid'].includes(body.plan) ? normalizePlan(body.plan) : null;
  if (!email || !plan) {
    return json(res, 400, { error: 'email and plan are required', code: 'invalid_request' });
  }

  const user = findUserByEmail(email);
  if (!user) {
    return json(res, 404, { error: 'User not found', code: 'user_not_found' });
  }

  user.plan = plan;
  user.updatedAt = nowIso();
  await saveStore();

  json(res, 200, {
    user: sanitizeUser(user),
    usage: getUsageView(user),
    billing: sanitizeBilling(user),
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

    if (req.method === 'OPTIONS') {
      return json(res, 200, { ok: true });
    }

    if (url.pathname === '/health' && req.method === 'GET') {
      return json(res, 200, {
        ok: true,
        model: AI_MODEL,
        proxyUrl: CODEX_PROXY_URL,
        planLimits: PLAN_LIMITS,
        timezone: BILLING_TIMEZONE,
        billingConfigured: isInfiniConfigured(),
      });
    }

    if (url.pathname === '/auth/register' && req.method === 'POST') {
      return await handleRegister(req, res);
    }

    if (url.pathname === '/auth/login' && req.method === 'POST') {
      return await handleLogin(req, res);
    }

    if (url.pathname === '/me' && req.method === 'GET') {
      return await handleMe(req, res);
    }

    if (url.pathname === '/usage' && req.method === 'GET') {
      return await handleUsage(req, res);
    }

    if (url.pathname === '/billing/subscription' && req.method === 'GET') {
      return await handleBillingSubscription(req, res);
    }

    if (url.pathname === '/billing/checkout' && req.method === 'POST') {
      return await handleBillingCheckout(req, res);
    }

    if (url.pathname === '/billing/cancel' && req.method === 'POST') {
      return await handleBillingCancel(req, res);
    }

    if (url.pathname === '/billing/webhook/infini' && req.method === 'POST') {
      return await handleBillingWebhook(req, res);
    }

    if (url.pathname === '/checkout/success' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(renderCheckoutPage('Payment submitted', 'Guardian has received your checkout result. You can return to the extension and tap refresh to see the latest subscription status.'));
      return;
    }

    if (url.pathname === '/checkout/failure' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(renderCheckoutPage('Payment failed', 'Infini reported that this checkout did not complete. You can return to Guardian and try again when ready.'));
      return;
    }

    if (url.pathname === '/checkout/cancel' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(renderCheckoutPage('Checkout canceled', 'The subscription checkout was canceled before payment. No Guardian plan changes were applied.'));
      return;
    }

    if (url.pathname === '/analyze' && req.method === 'POST') {
      return await handleAnalyze(req, res);
    }

    if (url.pathname === '/admin/users/plan' && req.method === 'POST') {
      return await handleAdminPlan(req, res);
    }

    return json(res, 404, { error: 'Not found', code: 'not_found' });
  } catch (error) {
    return json(res, 500, {
      error: error instanceof Error ? error.message : 'Internal server error',
      code: 'internal_error',
    });
  }
});

await loadStore();

server.listen(PORT, HOST, () => {
  if (!configuredJwtSecret) {
    console.warn('[Guardian API] GUARDIAN_JWT_SECRET is not set. Using an ephemeral secret for this process.');
  }
  console.log(`Guardian API listening on http://${HOST}:${PORT}`);
});
