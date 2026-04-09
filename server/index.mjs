import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { promises as fs } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.GUARDIAN_API_PORT ?? 3300);
const HOST = process.env.GUARDIAN_API_HOST ?? '127.0.0.1';
const JWT_SECRET = process.env.GUARDIAN_JWT_SECRET ?? 'guardian-dev-secret-change-me';
const ADMIN_SECRET = process.env.GUARDIAN_ADMIN_SECRET ?? '';
const DATA_DIR = process.env.GUARDIAN_DATA_DIR ?? path.join(__dirname, '..', 'server-data');
const DATA_FILE = path.join(DATA_DIR, 'users.json');
const CODEX_PROXY_URL = process.env.CODEX_PROXY_URL ?? 'http://127.0.0.1:8080/v1/chat/completions';
const CODEX_PROXY_API_KEY = process.env.CODEX_PROXY_API_KEY ?? '';
const AI_MODEL = process.env.GUARDIAN_AI_MODEL ?? 'gpt-5.4-mini';
const DAILY_FREE_LIMIT = Number(process.env.GUARDIAN_FREE_DAILY_LIMIT ?? 10);
const DAILY_RESET_TIMEZONE = process.env.GUARDIAN_DAILY_RESET_TZ ?? 'UTC';
const TOKEN_TTL_SECONDS = Number(process.env.GUARDIAN_TOKEN_TTL_SECONDS ?? 60 * 60 * 24 * 30);
const ANALYSIS_TIMEOUT_MS = Number(process.env.GUARDIAN_AI_TIMEOUT_MS ?? 15_000);
const CACHE_TTL_MS = Number(process.env.GUARDIAN_CACHE_TTL_MS ?? 30 * 60 * 1000);

const responseCache = new Map();
const inFlightAnalyses = new Map();

let store = { users: [] };

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
      users: Array.isArray(parsed.users) ? parsed.users : [],
    };
  } catch {
    store = { users: [] };
  }
}

async function saveStore() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const tempFile = `${DATA_FILE}.tmp`;
  await fs.writeFile(tempFile, JSON.stringify(store, null, 2));
  await fs.rename(tempFile, DATA_FILE);
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

function getDayKey(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: DAILY_RESET_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function getNextResetAt() {
  const currentKey = getDayKey();
  let probe = new Date(Date.now() + 60_000);
  for (let i = 0; i < 1_500; i += 1) {
    if (getDayKey(probe) !== currentKey) {
      return probe.toISOString();
    }
    probe = new Date(probe.getTime() + 60_000);
  }
  return new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
}

function getUsageView(user) {
  const today = getDayKey();
  const usage = user.dailyUsage?.date === today
    ? user.dailyUsage
    : { date: today, count: 0 };
  const limit = user.plan === 'paid' ? null : DAILY_FREE_LIMIT;
  const remaining = limit === null ? null : Math.max(limit - usage.count, 0);
  return {
    limit,
    used: usage.count,
    remaining,
    resetAt: getNextResetAt(),
    timezone: DAILY_RESET_TIMEZONE,
  };
}

function sanitizeUser(user) {
  return {
    id: user.id,
    email: user.email,
    plan: user.plan,
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

function findUserByEmail(email) {
  return store.users.find((user) => user.email === email) ?? null;
}

function findUserById(id) {
  return store.users.find((user) => user.id === id) ?? null;
}

function createAuthToken(user) {
  return signToken({
    sub: user.id,
    email: user.email,
    plan: user.plan,
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
    dailyUsage: { date: getDayKey(), count: 0 },
    createdAt,
    updatedAt: createdAt,
  };

  store.users.push(user);
  await saveStore();

  json(res, 201, {
    token: createAuthToken(user),
    user: sanitizeUser(user),
    usage: getUsageView(user),
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
  });
}

async function handleMe(req, res) {
  const user = await authenticate(req, res);
  if (!user) return;
  json(res, 200, {
    user: sanitizeUser(user),
    usage: getUsageView(user),
  });
}

async function handleUsage(req, res) {
  const user = await authenticate(req, res);
  if (!user) return;
  json(res, 200, { usage: getUsageView(user) });
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

  const cached = getCachedAnalysis(cacheKey);
  if (cached) {
    return json(res, 200, {
      cached: true,
      analysis: cached,
      usage: getUsageView(user),
    });
  }

  const usage = getUsageView(user);
  if (user.plan !== 'paid' && (usage.remaining ?? 0) <= 0) {
    return json(res, 429, {
      error: 'Daily AI analysis limit reached',
      code: 'quota_exceeded',
      usage,
    });
  }

  let promise = inFlightAnalyses.get(cacheKey);
  if (!promise) {
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
    const freshUsage = getUsageView(user);
    if (user.plan !== 'paid') {
      user.dailyUsage = {
        date: getDayKey(),
        count: freshUsage.used + 1,
      };
      user.updatedAt = nowIso();
      await saveStore();
    }

    json(res, 200, {
      cached: false,
      analysis,
      usage: getUsageView(user),
    });
  } catch (error) {
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
  const plan = body.plan === 'paid' ? 'paid' : body.plan === 'free' ? 'free' : null;
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
        dailyLimit: DAILY_FREE_LIMIT,
        timezone: DAILY_RESET_TIMEZONE,
      });
    }

    if (url.pathname === '/auth/register' && req.method === 'POST') {
      return handleRegister(req, res);
    }

    if (url.pathname === '/auth/login' && req.method === 'POST') {
      return handleLogin(req, res);
    }

    if (url.pathname === '/me' && req.method === 'GET') {
      return handleMe(req, res);
    }

    if (url.pathname === '/usage' && req.method === 'GET') {
      return handleUsage(req, res);
    }

    if (url.pathname === '/analyze' && req.method === 'POST') {
      return handleAnalyze(req, res);
    }

    if (url.pathname === '/admin/users/plan' && req.method === 'POST') {
      return handleAdminPlan(req, res);
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
  console.log(`Guardian API listening on http://${HOST}:${PORT}`);
});
