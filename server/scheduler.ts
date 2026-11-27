import cron from 'node-cron';
import type { ScheduledTask } from 'node-cron';
import { getSettings } from './db.ts';
import { syncAllAccounts } from './plaidService.ts';
import { sendSunsetSpendingNotification } from './pushService.ts';

let currentTask: ScheduledTask | null = null;
let currentScheduleDescription = process.env.VERCEL
  ? 'Vercel Daily Sunset Sync & Push'
  : 'Manual only';
let lastRunAt: string | null = null;

export async function rescheduleAutoSync(): Promise<{
  mode: string;
  description: string;
  sunsetSyncTime: string;
  lastRunAt: string | null;
}> {
  if (currentTask) {
    currentTask.stop();
    currentTask = null;
  }

  const settings = await getSettings();

  if (process.env.VERCEL) {
    currentScheduleDescription =
      settings.syncMode === 'manual'
        ? 'Manual sync only'
        : `Daily Sunset Sync & Push Alert`;
    return getSchedulerStatus();
  }

  if (settings.syncMode === 'hourly') {
    currentScheduleDescription = 'Every hour on the hour';
    currentTask = cron.schedule('0 * * * *', async () => {
      lastRunAt = new Date().toISOString();
      await syncAllAccounts({ simulateMockPurchase: false, triggerSource: 'scheduler' });
    });
  } else if (settings.syncMode === 'sunset') {
    const [hh, mm] = settings.sunsetSyncTime.split(':').map(Number);
    const safeHour = Number.isFinite(hh) && hh >= 0 && hh <= 23 ? hh : 21;
    const safeMin = Number.isFinite(mm) && mm >= 0 && mm <= 59 ? mm : 0;
    const expr = `${safeMin} ${safeHour} * * *`;
    currentScheduleDescription = `Daily Sunset Sync & Push at ${String(safeHour).padStart(2, '0')}:${String(safeMin).padStart(2, '0')}`;
    currentTask = cron.schedule(expr, async () => {
      lastRunAt = new Date().toISOString();
      await syncAllAccounts({ simulateMockPurchase: false, triggerSource: 'scheduler' });
      await sendSunsetSpendingNotification({ isTest: false }).catch(() => {});
    });
  } else {
    currentScheduleDescription = 'Manual sync only';
  }

  return getSchedulerStatus();
}

export async function getSchedulerStatus() {
  const settings = await getSettings();
  return {
    mode: settings.syncMode,
    description: currentScheduleDescription,
    sunsetSyncTime: settings.sunsetSyncTime,
    lastRunAt,
  };
}
