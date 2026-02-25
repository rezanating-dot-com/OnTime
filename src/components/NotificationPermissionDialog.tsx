import { useState, useEffect, useCallback } from 'react';
import { Capacitor } from '@capacitor/core';
import { App as CapApp } from '@capacitor/app';
import { Preferences } from '@capacitor/preferences';
import { useSettings } from '../context/SettingsContext';
import { AthanPlugin } from '../plugins/athanPlugin';

const DISMISS_KEY_PREFIX = 'notif_perm_dismissed_v';

export function NotificationPermissionDialog() {
  const { settings } = useSettings();
  const [needsExactAlarm, setNeedsExactAlarm] = useState(false);
  const [needsBatteryExemption, setNeedsBatteryExemption] = useState(false);
  const [dismissed, setDismissed] = useState(true);
  const [ready, setReady] = useState(false);

  const checkPermissions = useCallback(async () => {
    if (Capacitor.getPlatform() !== 'android') return;
    if (!settings.notifications.enabled) return;

    try {
      const [exactAlarm, battery, appInfo] = await Promise.all([
        AthanPlugin.canScheduleExactAlarms(),
        AthanPlugin.isIgnoringBatteryOptimizations(),
        CapApp.getInfo(),
      ]);

      const missingExact = !exactAlarm.value;
      const missingBattery = !battery.value;

      setNeedsExactAlarm(missingExact);
      setNeedsBatteryExemption(missingBattery);

      if (missingExact || missingBattery) {
        const dismissKey = DISMISS_KEY_PREFIX + appInfo.build;
        const { value } = await Preferences.get({ key: dismissKey });
        setDismissed(value === 'true');
      } else {
        setDismissed(true);
      }

      setReady(true);
    } catch {
      // Not on Android or plugin unavailable
    }
  }, [settings.notifications.enabled]);

  // Check on mount
  useEffect(() => {
    checkPermissions();
  }, [checkPermissions]);

  // Re-check when app resumes (user may have toggled permission in system settings)
  useEffect(() => {
    const listener = CapApp.addListener('appStateChange', ({ isActive }) => {
      if (isActive) checkPermissions();
    });
    return () => { listener.then(h => h.remove()); };
  }, [checkPermissions]);

  const handleDismiss = async () => {
    try {
      const appInfo = await CapApp.getInfo();
      await Preferences.set({
        key: DISMISS_KEY_PREFIX + appInfo.build,
        value: 'true',
      });
    } catch {
      // ignore
    }
    setDismissed(true);
  };

  if (!ready || dismissed || (!needsExactAlarm && !needsBatteryExemption)) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-2xl bg-[var(--color-card)] p-6 shadow-xl">
        {/* Icon */}
        <div className="w-14 h-14 mx-auto mb-4 rounded-full bg-blue-500/10 flex items-center justify-center">
          <svg className="w-7 h-7 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />
          </svg>
        </div>

        {/* Title */}
        <h3 className="text-lg font-bold text-[var(--color-text)] text-center mb-2">
          Fix Notification Timing
        </h3>

        {/* Body */}
        <p className="text-sm text-[var(--color-muted)] text-center leading-relaxed mb-5">
          Prayer notifications may be delayed. Please enable the following to ensure they arrive on time.
        </p>

        {/* Permission items */}
        <div className="flex flex-col gap-3 mb-5">
          {needsExactAlarm && (
            <div className="flex items-center justify-between gap-3 p-3 rounded-lg bg-[var(--color-background)]">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-[var(--color-text)]">Exact Alarms</p>
                <p className="text-xs text-[var(--color-muted)]">Required for precise prayer times</p>
              </div>
              <button
                onClick={() => AthanPlugin.openExactAlarmSettings()}
                className="px-4 py-1.5 bg-[var(--color-primary)] text-white text-sm font-semibold rounded-lg shrink-0"
              >
                Fix
              </button>
            </div>
          )}

          {needsBatteryExemption && (
            <div className="flex items-center justify-between gap-3 p-3 rounded-lg bg-[var(--color-background)]">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-[var(--color-text)]">Battery Optimization</p>
                <p className="text-xs text-[var(--color-muted)]">Prevents system from delaying alerts</p>
              </div>
              <button
                onClick={() => AthanPlugin.requestIgnoreBatteryOptimizations()}
                className="px-4 py-1.5 bg-[var(--color-primary)] text-white text-sm font-semibold rounded-lg shrink-0"
              >
                Fix
              </button>
            </div>
          )}
        </div>

        {/* Dismiss */}
        <button
          onClick={handleDismiss}
          className="w-full py-3 text-[var(--color-muted)] font-medium text-sm rounded-lg hover:bg-[var(--color-background)] transition-colors"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
