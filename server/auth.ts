import crypto from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';

const COOKIE_NAME = 'koppad_session';
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days

// Simple in-memory brute-force rate limiter per IP
const failedAttempts = new Map<string, { count: number; resetAt: number }>();

function getConfiguredPassword(): string {
  return (
    process.env.APP_PASSWORD ||
    process.env.KOPPAD_PASSWORD ||
    process.env.PASSWORD ||
    ''
  ).trim();
}

export function isAuthEnabled(): boolean {
  return getConfiguredPassword().length > 0;
}

function getSigningSecret(): string {
  const explicit = (process.env.AUTH_SECRET || process.env.SESSION_SECRET || '').trim();
  if (explicit) return explicit;
  // Derive a strong deterministic signing key from APP_PASSWORD + Plaid secret so
  // sessions survive serverless cold starts even if AUTH_SECRET wasn't set separately.
  return crypto
    .createHash('sha256')
    .update(`koppad-signing-v1:${getConfiguredPassword()}:${process.env.PLAID_SECRET || ''}`)
    .digest('hex');
}

function getTokenEncryptionKey(): Buffer | null {
  const raw = (
    process.env.TOKEN_ENCRYPTION_KEY ||
    process.env.AUTH_SECRET ||
    getConfiguredPassword()
  ).trim();
  if (!raw) return null;
  return crypto.createHash('sha256').update(`koppad-vault-v1:${raw}`).digest();
}

export function encryptSensitiveToken(plainText: string | null | undefined): string | null {
  if (!plainText) return null;
  if (plainText.startsWith('enc:v1:')) return plainText;
  const key = getTokenEncryptionKey();
  if (!key) return plainText;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `enc:v1:${iv.toString('base64url')}.${tag.toString('base64url')}.${encrypted.toString('base64url')}`;
}

export function decryptSensitiveToken(stored: string | null | undefined): string | null {
  if (!stored) return null;
  if (!stored.startsWith('enc:v1:')) return stored;
  const key = getTokenEncryptionKey();
  if (!key) {
    throw new Error('Cannot decrypt stored Plaid token: APP_PASSWORD or TOKEN_ENCRYPTION_KEY is missing.');
  }
  const parts = stored.slice('enc:v1:'.length).split('.');
  if (parts.length !== 3) {
    throw new Error('Malformed encrypted Plaid token.');
  }
  const iv = Buffer.from(parts[0], 'base64url');
  const tag = Buffer.from(parts[1], 'base64url');
  const ciphertext = Buffer.from(parts[2], 'base64url');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return decrypted.toString('utf8');
}

export function verifyPassword(candidate: string): boolean {
  const expected = getConfiguredPassword();
  if (!expected) return true;
  const hashA = crypto.createHash('sha256').update(candidate).digest();
  const hashB = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(hashA, hashB);
}

function passwordFingerprint(): string {
  return crypto
    .createHash('sha256')
    .update(`pw-fp:${getConfiguredPassword()}`)
    .digest('base64url')
    .slice(0, 16);
}

export function createSessionToken(): string {
  const exp = Math.floor(Date.now() / 1000) + SESSION_MAX_AGE_SECONDS;
  const payload = Buffer.from(
    JSON.stringify({ exp, fp: passwordFingerprint() }),
    'utf8'
  ).toString('base64url');
  const sig = crypto
    .createHmac('sha256', getSigningSecret())
    .update(payload)
    .digest('base64url');
  return `${payload}.${sig}`;
}

export function verifySessionToken(token: string | undefined): boolean {
  if (!isAuthEnabled()) return true;
  if (!token || !token.includes('.')) return false;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return false;

  const expectedSig = crypto
    .createHmac('sha256', getSigningSecret())
    .update(payload)
    .digest('base64url');

  const bufA = Buffer.from(sig);
  const bufB = Buffer.from(expectedSig);
  if (bufA.length !== bufB.length || !crypto.timingSafeEqual(bufA, bufB)) {
    return false;
  }

  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      exp?: number;
      fp?: string;
    };
    if (!parsed.exp || parsed.exp < Math.floor(Date.now() / 1000)) return false;
    // Immediately invalidate sessions if APP_PASSWORD was changed
    if (parsed.fp !== passwordFingerprint()) return false;
    return true;
  } catch {
    return false;
  }
}

export function parseCookies(cookieHeader?: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!cookieHeader) return out;
  for (const part of cookieHeader.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

export function isRequestAuthenticated(req: Request): boolean {
  if (!isAuthEnabled()) return true;
  const cookies = parseCookies(req.headers.cookie);
  return verifySessionToken(cookies[COOKIE_NAME]);
}

export function setSessionCookie(res: Response, token: string): void {
  const secure = Boolean(process.env.VERCEL || process.env.NODE_ENV === 'production');
  const parts = [
    `${COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${SESSION_MAX_AGE_SECONDS}`,
  ];
  if (secure) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

export function clearSessionCookie(res: Response): void {
  const secure = Boolean(process.env.VERCEL || process.env.NODE_ENV === 'production');
  const parts = [`${COOKIE_NAME}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
  if (secure) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

export function checkLoginRateLimit(ip: string): { allowed: boolean; retryAfterSec: number } {
  const now = Date.now();
  const entry = failedAttempts.get(ip);
  if (!entry || entry.resetAt <= now) {
    return { allowed: true, retryAfterSec: 0 };
  }
  if (entry.count >= 8) {
    return { allowed: false, retryAfterSec: Math.ceil((entry.resetAt - now) / 1000) };
  }
  return { allowed: true, retryAfterSec: 0 };
}

export function recordFailedLogin(ip: string): void {
  const now = Date.now();
  const windowMs = 5 * 60 * 1000;
  const entry = failedAttempts.get(ip);
  if (!entry || entry.resetAt <= now) {
    failedAttempts.set(ip, { count: 1, resetAt: now + windowMs });
  } else {
    entry.count += 1;
  }
}

export function clearFailedLogin(ip: string): void {
  failedAttempts.delete(ip);
}

export function requireAuthMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (isRequestAuthenticated(req)) {
    next();
    return;
  }
  res.status(401).json({ error: 'KopPad locked. Please enter your password.', locked: true });
}
