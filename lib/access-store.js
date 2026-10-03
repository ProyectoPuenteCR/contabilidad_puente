import { Redis } from '@upstash/redis';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { getAdminEmail } from './auth-config';

const USERS_SET = 'contabilidad:auth:allowed-emails';
const USER_PREFIX = 'contabilidad:auth:user:';
const EMERGENCY_SET = 'contabilidad:auth:emergency-codes';
const RATE_PREFIX = 'contabilidad:auth:emergency-rate:';

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
