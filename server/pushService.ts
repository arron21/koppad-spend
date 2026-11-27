import * as webpush from 'web-push';
import { db, getSettings, logSync } from './db.ts';

interface VapidKeys {
  publicKey: string;
  privateKey: string;
}

let cachedVapidKeys: VapidKeys | null = null;

export async function getOrCreateVapidKeys(): Promise<VapidKeys> {
  if (cachedVapidKeys) return cachedVapidKeys;

  const envPub = process.env.VAPID_PUBLIC_KEY?.trim();
  const envPriv = process.env.VAPID_PRIVATE_KEY?.trim();
  if (envPub && envPriv) {
    cachedVapidKeys = { publicKey: envPub, privateKey: envPriv };
    return cachedVapidKeys;
  }

  const rows = await db.all<{ key: string; value: string }>('SELECT key, value FROM settings');
  const map = new Map(rows.map((r) => [r.key, r.value]));
  const storedPub = map.get('vapid_public_key');
  const storedPriv = map.get('vapid_private_key');

  if (storedPub && storedPriv) {
    cachedVapidKeys = { publicKey: storedPub, privateKey: storedPriv };
    return cachedVapidKeys;
  }

  // Auto-generate persistent VAPID keys and save directly in the database so zero manual env setup is needed!
  const generated = webpush.generateVAPIDKeys();
  const upsertSql =
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value';
  await db.run(upsertSql, ['vapid_public_key', generated.publicKey]);
  await db.run(upsertSql, ['vapid_private_key', generated.privateKey]);

  cachedVapidKeys = generated;
  return generated;
}

async function configureWebPush(): Promise<string> {
  const keys = await getOrCreateVapidKeys();
  const subject = process.env.VAPID_SUBJECT?.trim() || 'mailto:alerts@koppad-spend.vercel.app';
  webpush.setVapidDetails(subject, keys.publicKey, keys.privateKey);
  return keys.publicKey;
}

export interface PushSubscriptionInput {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
}

export async function savePushSubscription(
  sub: PushSubscriptionInput,
  timezone?: string,
  userAgent?: string
): Promise<{ subscriptionCount: number }> {
  if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) {
    throw new Error('Invalid Web Push subscription payload.');
  }
  const safeTz = timezone?.trim() || 'America/Los_Angeles';
  const safeUa = (userAgent || '').slice(0, 180);
  const now = new Date().toISOString();

  await db.run(
    `INSERT INTO push_subscriptions (endpoint, p256dh, auth, timezone, user_agent, created_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (endpoint) DO UPDATE SET
       p256dh = EXCLUDED.p256dh,
       auth = EXCLUDED.auth,
       timezone = EXCLUDED.timezone,
       user_agent = EXCLUDED.user_agent,
       created_at = EXCLUDED.created_at`,
    [sub.endpoint, sub.keys.p256dh, sub.keys.auth, safeTz, safeUa, now]
  );

  const countRow = await db.get<{ c: number | string }>(
    'SELECT COUNT(*) as c FROM push_subscriptions'
  );
  return { subscriptionCount: Number(countRow?.c ?? 1) };
}

export async function removePushSubscription(endpoint: string): Promise<void> {
  if (!endpoint) return;
  await db.run('DELETE FROM push_subscriptions WHERE endpoint = ?', [endpoint]);
}

export async function getPushStatus(): Promise<{
  publicKey: string;
  subscriptionCount: number;
}> {
  const publicKey = await configureWebPush();
  const countRow = await db.get<{ c: number | string }>(
    'SELECT COUNT(*) as c FROM push_subscriptions'
  );
  return {
    publicKey,
    subscriptionCount: Number(countRow?.c ?? 0),
  };
}

function getDateInTimezone(tz: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date());
    const y = parts.find((p) => p.type === 'year')?.value;
    const m = parts.find((p) => p.type === 'month')?.value;
    const d = parts.find((p) => p.type === 'day')?.value;
    if (y && m && d) return `${y}-${m}-${d}`;
  } catch {
    // Fallback to UTC/server local date
  }
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export async function sendSunsetSpendingNotification(options?: {
  isTest?: boolean;
}): Promise<{
  sentCount: number;
  removedExpired: number;
  title: string;
  body: string;
}> {
  await configureWebPush();

  const subs = await db.all<{
    endpoint: string;
    p256dh: string;
    auth: string;
    timezone: string;
  }>('SELECT * FROM push_subscriptions');

  if (subs.length === 0) {
    return {
      sentCount: 0,
      removedExpired: 0,
      title: 'No subscribed devices',
      body: 'Enable Daily Sunset Alerts on your phone or desktop first.',
    };
  }

  const primaryTz = subs[0]?.timezone || 'America/Los_Angeles';
  const targetDate = getDateInTimezone(primaryTz);
  const [year, month] = targetDate.split('-').map(Number);
  const daysInMonth = new Date(year, month, 0).getDate();
  const monthStart = `${targetDate.slice(0, 7)}-01`;

  const dayTxs = await db.all<{ amount: number | string; is_excluded: number | string }>(
    'SELECT * FROM transactions WHERE date = ? ORDER BY created_at ASC, id ASC',
    [targetDate]
  );
  const counted = dayTxs.filter((t) => Number(t.is_excluded) === 0);
  const dayTotal =
    Math.round(counted.reduce((sum, t) => sum + Number(t.amount), 0) * 100) / 100;

  const monthSumRow = await db.get<{ total: number | string }>(
    `SELECT COALESCE(SUM(amount), 0) as total
     FROM transactions
     WHERE date >= ? AND date <= ? AND is_excluded = 0`,
    [monthStart, targetDate]
  );
  const monthSpent = Number(monthSumRow?.total ?? 0);
  const settings = await getSettings();
  const dailyTarget = settings.dailyTargetOverride ?? settings.monthlyBudget / daysInMonth;
  const remainingJuiceDays =
    dailyTarget > 0
      ? Math.max(0, (settings.monthlyBudget - monthSpent) / dailyTarget).toFixed(1)
      : '0.0';

  const dayNum = Number(targetDate.slice(8, 10));
  const title = options?.isTest
    ? `S.S. Drake — Day ${dayNum} KopPad Check-In!`
    : `Sundown Reached — Day ${dayNum} Results Ready!`;

  const body =
    counted.length === 0
      ? `Zero purchases logged today ($0.00)! ${remainingJuiceDays} days of budget juice remaining. Tap to open your Day-End Report.`
      : `You made ${counted.length} purchase${counted.length === 1 ? '' : 's'} totaling $${dayTotal.toFixed(2)} today (${remainingJuiceDays}d of juice left). Tap to watch your Day-End tally!`;

  const payload = JSON.stringify({
    title,
    body,
    url: `/?date=${targetDate}`,
    tag: `koppad-sunset-${targetDate}`,
  });

  let sentCount = 0;
  let removedExpired = 0;

  for (const sub of subs) {
    try {
      await webpush.sendNotification(
        {
          endpoint: sub.endpoint,
          keys: {
            p256dh: sub.p256dh,
            auth: sub.auth,
          },
        },
        payload
      );
      sentCount++;
    } catch (err) {
      const statusCode = (err as { statusCode?: number })?.statusCode;
      if (statusCode === 404 || statusCode === 410) {
        await removePushSubscription(sub.endpoint);
        removedExpired++;
      }
    }
  }

  await logSync(
    options?.isTest ? 'push_test' : 'sunset_push',
    'success',
    sentCount,
    0,
    `Sent Day ${dayNum} Sunset Push notification to ${sentCount} device(s).`
  );

  return { sentCount, removedExpired, title, body };
}
