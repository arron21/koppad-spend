import { useEffect, useState } from 'react';
import { api } from '../api';
import { soundEngine } from '../audio/soundEngine';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export function PushNotificationControls({
  onNotify,
}: {
  onNotify: (msg: string, isError?: boolean) => void;
}) {
  const [supported, setSupported] = useState(false);
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [deviceCount, setDeviceCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isStandalone, setIsStandalone] = useState(false);
  const [isIos, setIsIos] = useState(false);

  useEffect(() => {
    const standalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      Boolean((window.navigator as unknown as { standalone?: boolean }).standalone);
    setIsStandalone(standalone);

    const ua = window.navigator.userAgent.toLowerCase();
    setIsIos(/iphone|ipad|ipod/.test(ua));

    const hasPush =
      'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
    setSupported(hasPush);

    const onBeforeInstall = (e: Event) => {
      e.preventDefault();
      setInstallPrompt(e as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', onBeforeInstall);

    (async () => {
      try {
        const status = await api.getPushStatus();
        setDeviceCount(status.subscriptionCount);
        if (hasPush) {
          const reg = await navigator.serviceWorker.ready;
          const existing = await reg.pushManager.getSubscription();
          setIsSubscribed(Boolean(existing));
        }
      } catch {
        // Ignore initial status errors
      }
    })();

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
    };
  }, []);

  const handleInstallApp = async () => {
    if (!installPrompt) return;
    soundEngine.playTap();
    await installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    if (choice.outcome === 'accepted') {
      setInstallPrompt(null);
      onNotify('KopPad Ledger installed to your Home Screen!');
    }
  };

  const handleEnableNotifications = async () => {
    if (!supported) {
      onNotify(
        isIos && !isStandalone
          ? 'On iPhone/iPad, tap Share → "Add to Home Screen" first, then open KopPad from your Home Screen to enable push notifications!'
          : 'Web Push notifications are not supported in this browser.',
        true
      );
      return;
    }

    setBusy(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        onNotify('Notification permission was denied in browser settings.', true);
        return;
      }

      const { publicKey } = await api.getPushStatus();
      const reg = await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey) as unknown as BufferSource,
        });
      }

      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Los_Angeles';
      const res = await api.subscribePush(sub.toJSON(), tz);
      setIsSubscribed(true);
      setDeviceCount(res.subscriptionCount);
      soundEngine.playSyncPulse();
      onNotify('Daily Sunset Spending Alerts enabled on this device!');
    } catch (err) {
      onNotify(
        err instanceof Error ? err.message : 'Failed to subscribe to push notifications',
        true
      );
    } finally {
      setBusy(false);
    }
  };

  const handleDisableNotifications = async () => {
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await api.unsubscribePush(sub.endpoint);
        await sub.unsubscribe();
      }
      setIsSubscribed(false);
      setDeviceCount((c) => Math.max(0, c - 1));
      soundEngine.playTap();
      onNotify('Daily Sunset Alerts disabled on this device.');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Failed to unsubscribe', true);
    } finally {
      setBusy(false);
    }
  };

  const handleSendTest = async () => {
    setBusy(true);
    try {
      const res = await api.sendTestPush();
      soundEngine.playSunsetChime();
      onNotify(
        res.sentCount > 0
          ? `Sent Day-End test notification to ${res.sentCount} device(s)!`
          : res.body
      );
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Test push failed', true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      style={{
        padding: '12px 14px',
        borderRadius: 14,
        background: 'rgba(6, 20, 29, 0.62)',
        border: '1px solid var(--border-glass)',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <div>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: '0.94rem', color: 'var(--sunset-gold)' }}>
            PWA & Daily Sunset Push Notifications
          </div>
          <div style={{ fontSize: '0.76rem', color: 'var(--text-secondary)' }}>
            Get a daily end-of-day push alert summarizing how much you spent ({deviceCount} device{deviceCount === 1 ? '' : 's'} active)
          </div>
        </div>
        <span className={`status-badge ${isSubscribed ? 'abundant' : 'healthy'}`}>
          {isSubscribed ? 'Alerts On' : 'Alerts Off'}
        </span>
      </div>

      {isIos && !isStandalone && (
        <div style={{ fontSize: '0.76rem', color: 'var(--koppad-cyan)', lineHeight: 1.45 }}>
          iPhone tip: Tap Safari’s <strong>Share</strong> button → <strong>Add to Home Screen</strong>, then open KopPad from your Home Screen to unlock iOS push notifications.
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {installPrompt && !isStandalone && (
          <button
            type="button"
            className="k-btn k-btn-primary"
            onClick={handleInstallApp}
          >
            ⬇ Install KopPad App
          </button>
        )}

        {!isSubscribed ? (
          <button
            type="button"
            id="btn-enable-push"
            className="k-btn k-btn-cyan"
            disabled={busy}
            onClick={handleEnableNotifications}
          >
            {busy ? 'Enabling...' : '🔔 Enable Daily Sunset Alerts'}
          </button>
        ) : (
          <>
            <button
              type="button"
              id="btn-test-push"
              className="k-btn k-btn-primary"
              disabled={busy}
              onClick={handleSendTest}
            >
              {busy ? 'Sending...' : '🚀 Send Test Day-End Alert Now'}
            </button>
            <button
              type="button"
              className="k-btn k-btn-ghost"
              disabled={busy}
              onClick={handleDisableNotifications}
            >
              Turn Off
            </button>
          </>
        )}
      </div>
    </div>
  );
}
