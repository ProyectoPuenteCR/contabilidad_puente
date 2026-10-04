import { Redis } from '@upstash/redis';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { getAdminEmail } from './auth-config';

const USERS_SET = 'contabilidad:auth:allowed-emails';
const USER_PREFIX = 'contabilidad:auth:user:';
const EMERGENCY_SET = 'contabilidad:auth:emergency-codes';
const RATE_PREFIX = 'contabilidad:auth:emergency-rate:';
const USAGE_EVENTS_KEY = 'contabilidad:usage:events';
const USAGE_CAPACITY_KEY = 'contabilidad:usage:capacity-mb';
const DEFAULT_USAGE_CAPACITY_MB = Number(process.env.PLATFORM_STORAGE_CAPACITY_MB || 256) || 256;

let redisClient;

export function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function configuredEmails() {
  return new Set(
    String(process.env.AUTH_ALLOWED_EMAILS || '')
      .split(',')
      .map(normalizeEmail)
      .filter(Boolean)
  );
}

export function getRedisClient() {
  if (redisClient !== undefined) return redisClient;

  const url =
    process.env.UPSTASH_REDIS_REST_URL ||
    process.env.KV_REST_API_URL;

  const token =
    process.env.UPSTASH_REDIS_REST_TOKEN ||
    process.env.KV_REST_API_TOKEN;

  redisClient = url && token ? new Redis({ url, token }) : null;
  return redisClient;
}

export function isAccessStorageConfigured() {
  return Boolean(getRedisClient());
}

export async function isAllowedGoogleEmail(email) {
  const normalized = normalizeEmail(email);
  if (!normalized) return false;

  const admin = getAdminEmail();
  if (normalized === admin) return true;
  if (configuredEmails().has(normalized)) return true;

  const redis = getRedisClient();
  if (!redis) return false;

  return Boolean(await redis.sismember(USERS_SET, normalized));
}

export async function listAllowedUsers() {
  const admin = getAdminEmail();
  const result = new Map();

  result.set(admin, {
    email: admin,
    name: 'Administrador principal',
    role: 'admin',
    source: 'principal',
    removable: false,
  });

  for (const email of configuredEmails()) {
    if (!result.has(email)) {
      result.set(email, {
        email,
        name: '',
        role: 'user',
        source: 'variable de entorno',
        removable: false,
      });
    }
  }

  const redis = getRedisClient();
  if (redis) {
    const emails = await redis.smembers(USERS_SET);

    const metadata = await Promise.all(
      emails.map(async (email) => {
        const data = await redis.get(`${USER_PREFIX}${email}`);
        return [email, data];
      })
    );

    for (const [email, data] of metadata) {
      if (email === admin) continue;

      result.set(email, {
        email,
        name: data?.name || '',
        role: 'user',
        source: 'administrado',
        addedAt: data?.addedAt || null,
        addedBy: data?.addedBy || null,
        removable: true,
      });
    }
  }

  return [...result.values()].sort((a, b) => {
    if (a.role !== b.role) return a.role === 'admin' ? -1 : 1;
    return a.email.localeCompare(b.email);
  });
}

export async function addAllowedUser({ email, name, addedBy }) {
  const normalized = normalizeEmail(email);

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    throw new Error('INVALID_EMAIL');
  }

  if (normalized === getAdminEmail()) {
    return { email: normalized, alreadyAdmin: true };
  }

  const redis = getRedisClient();
  if (!redis) throw new Error('STORAGE_NOT_CONFIGURED');

  const metadata = {
    name: String(name || '').trim(),
    addedAt: new Date().toISOString(),
    addedBy: normalizeEmail(addedBy),
  };

  await redis.set(`${USER_PREFIX}${normalized}`, metadata);
  await redis.sadd(USERS_SET, normalized);

  return { email: normalized, ...metadata };
}

export async function removeAllowedUser(email) {
  const normalized = normalizeEmail(email);

  if (!normalized || normalized === getAdminEmail()) {
    throw new Error('PROTECTED_USER');
  }

  if (configuredEmails().has(normalized)) {
    throw new Error('ENV_USER');
  }

  const redis = getRedisClient();
  if (!redis) throw new Error('STORAGE_NOT_CONFIGURED');

  await redis.srem(USERS_SET, normalized);
  await redis.del(`${USER_PREFIX}${normalized}`);

  return true;
}

function normalizeEmergencyCode(value) {
  return String(value || '').trim().toUpperCase();
}

function hashEmergencyCode(value) {
  return createHash('sha256')
    .update(normalizeEmergencyCode(value), 'utf8')
    .digest('hex');
}

function safeHexEqual(a, b) {
  if (!a || !b || a.length !== b.length) return false;

  try {
    return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
  } catch {
    return false;
  }
}

function requestAddress(request) {
  const forwarded = request?.headers?.get?.('x-forwarded-for');
  const direct = forwarded?.split(',')?.[0]?.trim();
  return direct || 'unknown';
}

async function emergencyRateAllowed(request) {
  const redis = getRedisClient();
  if (!redis) return true;

  const addressHash = createHash('sha256')
    .update(requestAddress(request))
    .digest('hex')
    .slice(0, 20);

  const key = `${RATE_PREFIX}${addressHash}`;
  const attempts = await redis.incr(key);

  if (attempts === 1) {
    await redis.expire(key, 600);
  }

  return attempts <= 6;
}

export async function verifyEmergencyCode(code, request) {
  const normalized = normalizeEmergencyCode(code);
  if (!normalized || normalized.length < 12) return false;

  if (!(await emergencyRateAllowed(request))) {
    return false;
  }

  const hash = hashEmergencyCode(normalized);

  const masterHash = String(process.env.AUTH_EMERGENCY_CODE_HASH || '')
    .trim()
    .toLowerCase();

  if (
    /^[0-9a-f]{64}$/.test(masterHash) &&
    safeHexEqual(hash, masterHash)
  ) {
    return true;
  }

  const redis = getRedisClient();
  if (!redis) return false;

  const exists = await redis.sismember(EMERGENCY_SET, hash);
  if (!exists) return false;

  // Los códigos creados desde la aplicación son de un solo uso.
  await redis.srem(EMERGENCY_SET, hash);
  return true;
}

export async function generateEmergencyCode() {
  const redis = getRedisClient();
  if (!redis) throw new Error('STORAGE_NOT_CONFIGURED');

  const raw = randomBytes(12).toString('hex').toUpperCase();
  const groups = raw.match(/.{1,4}/g) || [raw];
  const code = `PP-${groups.join('-')}`;
  const hash = hashEmergencyCode(code);

  await redis.sadd(EMERGENCY_SET, hash);

  return code;
}

export async function emergencyCodeCount() {
  const redis = getRedisClient();
  if (!redis) return 0;
  return Number(await redis.scard(EMERGENCY_SET)) || 0;
}

export async function revokeEmergencyCodes() {
  const redis = getRedisClient();
  if (!redis) throw new Error('STORAGE_NOT_CONFIGURED');
  await redis.del(EMERGENCY_SET);
}


function safeJsonSize(value) {
  try {
    return Buffer.byteLength(JSON.stringify(value ?? null), 'utf8');
  } catch {
    return 0;
  }
}

export async function logUsageEvent({
  email,
  type = 'activity',
  module = 'app',
  success = true,
  details = null,
}) {
  const redis = getRedisClient();
  if (!redis) return false;

  const event = {
    id: randomBytes(8).toString('hex'),
    at: new Date().toISOString(),
    email: normalizeEmail(email) || 'unknown',
    type: String(type || 'activity'),
    module: String(module || 'app'),
    success: Boolean(success),
    details: details || null,
  };

  await redis.lpush(USAGE_EVENTS_KEY, event);
  await redis.ltrim(USAGE_EVENTS_KEY, 0, 4999);
  return true;
}

export async function listUsageEvents({ limit = 5000 } = {}) {
  const redis = getRedisClient();
  if (!redis) return [];

  const max = Math.max(1, Math.min(Number(limit) || 5000, 5000));
  const rows = await redis.lrange(USAGE_EVENTS_KEY, 0, max - 1);

  return (rows || [])
    .map((row) => {
      if (row && typeof row === 'object') return row;
      try {
        return JSON.parse(String(row || ''));
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

export async function getUsageCapacityMb() {
  const redis = getRedisClient();
  if (!redis) return DEFAULT_USAGE_CAPACITY_MB;

  const stored = Number(await redis.get(USAGE_CAPACITY_KEY));
  return Number.isFinite(stored) && stored > 0
    ? stored
    : DEFAULT_USAGE_CAPACITY_MB;
}

export async function setUsageCapacityMb(value) {
  const redis = getRedisClient();
  if (!redis) throw new Error('STORAGE_NOT_CONFIGURED');

  const capacity = Number(value);
  if (!Number.isFinite(capacity) || capacity <= 0 || capacity > 102400) {
    throw new Error('INVALID_CAPACITY');
  }

  await redis.set(USAGE_CAPACITY_KEY, capacity);
  return capacity;
}

export async function estimateRedisUsage() {
  const redis = getRedisClient();
  if (!redis) {
    return {
      configured: false,
      keyCount: 0,
      usedBytes: 0,
    };
  }

  const keys = await redis.keys('contabilidad:*');
  let usedBytes = 0;

  for (const key of keys || []) {
    usedBytes += Buffer.byteLength(String(key), 'utf8');

    try {
      const type = await redis.type(key);
      let value = null;

      if (type === 'string') {
        value = await redis.get(key);
      } else if (type === 'set') {
        value = await redis.smembers(key);
      } else if (type === 'list') {
        value = await redis.lrange(key, 0, -1);
      } else if (type === 'hash') {
        value = await redis.hgetall(key);
      } else {
        // For unsupported/rare Redis types, keep the key-size estimate only.
        value = null;
      }

      usedBytes += safeJsonSize(value);
    } catch {
      // A single key should never make the whole usage dashboard fail.
    }
  }

  return {
    configured: true,
    keyCount: (keys || []).length,
    usedBytes,
  };
}

export async function buildPlatformUsageSummary({
  from,
  to,
} = {}) {
  const now = new Date();
  const end = to ? new Date(to + 'T23:59:59.999Z') : now;
  const start = from
    ? new Date(from + 'T00:00:00.000Z')
    : new Date(now.getTime() - 29 * 86400000);

  const [events, users, storage, capacityMb] = await Promise.all([
    listUsageEvents(),
    listAllowedUsers(),
    estimateRedisUsage(),
    getUsageCapacityMb(),
  ]);

  const inRange = events.filter((event) => {
    const at = new Date(event.at);
    return Number.isFinite(at.getTime()) && at >= start && at <= end;
  });

  const last30Start = new Date(now.getTime() - 29 * 86400000);
  const active30 = new Set(
    events
      .filter((event) => new Date(event.at) >= last30Start && event.success)
      .map((event) => event.email)
      .filter(Boolean)
  );

  const todayKey = now.toISOString().slice(0, 10);
  const monthKey = now.toISOString().slice(0, 7);

  const successfulLogins = inRange.filter(
    (event) => event.type === 'login' && event.success
  );
  const failedLogins = inRange.filter(
    (event) => event.type === 'login' && !event.success
  );

  const byDayMap = new Map();
  for (const event of inRange.filter((row) => row.type === 'login')) {
    const day = String(event.at || '').slice(0, 10);
    if (!day) continue;
    const current = byDayMap.get(day) || { date: day, success: 0, failed: 0 };
    if (event.success) current.success += 1;
    else current.failed += 1;
    byDayMap.set(day, current);
  }

  const moduleMap = new Map();
  for (const event of inRange.filter((row) => row.type === 'module' && row.success)) {
    const key = event.module || 'app';
    moduleMap.set(key, Number(moduleMap.get(key) || 0) + 1);
  }

  const accessThisMonth = events.filter(
    (event) =>
      event.type === 'login' &&
      event.success &&
      String(event.at || '').startsWith(monthKey)
  ).length;

  const accessToday = events.filter(
    (event) =>
      event.type === 'login' &&
      event.success &&
      String(event.at || '').startsWith(todayKey)
  ).length;

  const usedMb = storage.usedBytes / 1024 / 1024;
  const remainingMb = Math.max(0, capacityMb - usedMb);
  const usagePct = capacityMb > 0 ? (usedMb / capacityMb) * 100 : 0;

  return {
    storageConfigured: storage.configured,
    range: {
      from: start.toISOString().slice(0, 10),
      to: end.toISOString().slice(0, 10),
    },
    totals: {
      usersRegistered: users.length,
      activeLast30Days: active30.size,
      accessesPeriod: successfulLogins.length,
      accessesThisMonth: accessThisMonth,
      accessesToday: accessToday,
      failedAccesses: failedLogins.length,
    },
    storage: {
      keyCount: storage.keyCount,
      usedBytes: storage.usedBytes,
      usedKb: storage.usedBytes / 1024,
      usedMb,
      capacityMb,
      remainingMb,
      usagePct,
    },
    accessesByDay: [...byDayMap.values()].sort((a, b) =>
      a.date.localeCompare(b.date)
    ),
    modules: [...moduleMap.entries()]
      .map(([module, count]) => ({ module, count }))
      .sort((a, b) => b.count - a.count),
    recentEvents: inRange.slice(0, 100),
  };
}


export async function compactUsageEvents(retentionDays = 180) {
  const redis = getRedisClient();
  if (!redis) throw new Error('STORAGE_NOT_CONFIGURED');

  const days = Math.max(1, Math.min(Number(retentionDays) || 180, 3650));
  const threshold = new Date(Date.now() - days * 86400000);
  const events = await listUsageEvents();

  const kept = events.filter((event) => {
    const at = new Date(event.at);
    return Number.isFinite(at.getTime()) && at >= threshold;
  });

  await redis.del(USAGE_EVENTS_KEY);

  for (let index = kept.length - 1; index >= 0; index -= 1) {
    await redis.lpush(USAGE_EVENTS_KEY, kept[index]);
  }

  return {
    removed: Math.max(0, events.length - kept.length),
    remaining: kept.length,
    retentionDays: days,
  };
}
