import { useEffect, useCallback, useRef } from 'react';
import { Capacitor } from '@capacitor/core';
import { App as CapApp } from '@capacitor/app';
import { scheduleNotifications, scheduleJumuahNotifications, scheduleSurahKahfNotifications, setupNotificationListeners } from '../services/notificationService';
import { AthanPlugin } from '../plugins/athanPlugin';
import { useSettings } from '../context/SettingsContext';
import { useLocation } from '../context/LocationContext';

function localDayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

export function useNotifications(enabled = true) {
  const { settings, isLoading: settingsLoading } = useSettings();
  const { location, isLoading: locationLoading } = useLocation();
  // Nothing is scheduled until both contexts have hydrated. App gates on
  // onboarding but read neither loading flag, so if the onboarding read
  // resolved first the 300ms debounce could build a whole schedule from the
  // defaults and the Mecca seed coordinates. Transient and self-healing — the
  // real settings then cancel it — but it wastes a full schedule/cancel cycle
  // and can flash the OS permission dialog at a user who opted out.
  const hydrated = !settingsLoading && !locationLoading;
  const ready = enabled && hydrated;
  const masterEnabled = ready && settings.notifications.enabled;

  // Schedule prayer notifications whenever location or the settings that
  // actually shape the schedule change.
  //
  // This used to depend on the whole `settings` object, and SettingsContext
  // hands back a fresh object on every update — so changing the theme, the
  // distance unit, the design style, the home view, or adding a previous
  // location each tore down and rebuilt all ~80 prayer alarms and re-ran a
  // permission check. Toggling two unrelated switches in a second cost two
  // full cancel/rebuild cycles. scheduleNotifications reads exactly these four
  // fields; keep this list in step with it.
  const {
    notifications: notificationSettings,
    athan: athanSettings,
    calculationMethod,
    asrCalculation,
  } = settings;
  // The local day the prayer schedule was last built. It is armed a fixed
  // number of days ahead, so each new day it goes unrebuilt costs a day at
  // the far end of the window.
  const lastScheduledDay = useRef<string | null>(null);
  const reschedule = useCallback(async () => {
    lastScheduledDay.current = localDayKey(new Date());
    await scheduleNotifications(location.coordinates, {
      notifications: notificationSettings,
      athan: athanSettings,
      calculationMethod,
      asrCalculation,
    });
  }, [location.coordinates, notificationSettings, athanSettings, calculationMethod, asrCalculation]);

  // The latest reschedule, without making the exact-alarm watcher below depend
  // on it: `reschedule` changes identity on every settings edit, and re-running
  // that watcher would re-register a native listener each time.
  const rescheduleRef = useRef(reschedule);
  useEffect(() => {
    rescheduleRef.current = reschedule;
  });

  // Schedule Jumuah notifications when settings change
  const rescheduleJumuah = useCallback(async () => {
    await scheduleJumuahNotifications(settings.jumuah);
  }, [settings.jumuah]);

  // Schedule Surah Kahf notifications when location or settings change
  const rescheduleSurahKahf = useCallback(async () => {
    await scheduleSurahKahfNotifications(
      location.coordinates,
      settings.surahKahf,
      settings.calculationMethod,
      settings.asrCalculation,
    );
  }, [location.coordinates, settings.surahKahf, settings.calculationMethod, settings.asrCalculation]);

  // Debounce rescheduling to prevent race conditions when settings change rapidly.
  // Not gated on the master switch: with notifications disabled, reschedule is
  // exactly what cancels everything.
  useEffect(() => {
    if (!ready) return;
    const timer = setTimeout(() => { reschedule(); }, 300);
    return () => clearTimeout(timer);
  }, [reschedule, ready]);

  // Gated on the master switch: disabling cancels these via reschedule's
  // cancel-all, and re-enabling must bring them back — their own settings
  // objects don't change identity when the master toggle flips, so without
  // this dependency they would silently stay dead until app restart.
  useEffect(() => {
    if (!masterEnabled) return;
    const timer = setTimeout(() => { rescheduleJumuah(); }, 300);
    return () => clearTimeout(timer);
  }, [rescheduleJumuah, masterEnabled]);

  useEffect(() => {
    if (!masterEnabled) return;
    const timer = setTimeout(() => { rescheduleSurahKahf(); }, 300);
    return () => clearTimeout(timer);
  }, [rescheduleSurahKahf, masterEnabled]);

  // Top the week up when the app comes back on a later day. Without this the
  // window only moved on launch or a settings change, so someone who kept the
  // app in the background for a week stopped getting prayer notifications on
  // day 8 (#51). Same-day resumes leave it alone so an ordinary foreground
  // doesn't rebuild ~80 alarms. Someone who never opens the app at all still
  // runs out; covering that needs a native periodic job.
  useEffect(() => {
    if (!masterEnabled) return;

    let cancelled = false;
    let handle: { remove: () => void } | undefined;
    CapApp.addListener('appStateChange', ({ isActive }) => {
      if (!isActive) return;
      const last = lastScheduledDay.current;
      if (!last || last === localDayKey(new Date())) return;
      void rescheduleRef.current();
    }).then((h) => {
      if (cancelled) { h.remove(); return; }
      handle = h;
    });

    return () => {
      cancelled = true;
      handle?.remove();
    };
  }, [masterEnabled]);

  // Android 12+ can deny SCHEDULE_EXACT_ALARM (denied by default on 14+ for a
  // fresh install), so the alarms already armed are inexact and may land
  // minutes late. Granting the permission afterwards does not upgrade them —
  // they have to be rebuilt. Watch for the transition on resume instead of
  // rescheduling on every foreground, which would churn the whole schedule.
  const exactAlarmsMissing = useRef<boolean | null>(null);
  useEffect(() => {
    if (!ready || Capacitor.getPlatform() !== 'android') return;

    let handle: { remove: () => void } | undefined;
    let cancelled = false;

    const recheck = async () => {
      try {
        const { value } = await AthanPlugin.canScheduleExactAlarms();
        if (cancelled) return;
        const missing = !value;
        const wasMissing = exactAlarmsMissing.current;
        exactAlarmsMissing.current = missing;
        if (wasMissing === true && !missing) await rescheduleRef.current();
      } catch {
        // Plugin unavailable — nothing to watch.
      }
    };

    void recheck();
    CapApp.addListener('appStateChange', ({ isActive }) => {
      if (isActive) void recheck();
    }).then((h) => {
      // Torn down before registration resolved: drop the handle we were handed
      // rather than leaking a listener into a hook that no longer exists.
      if (cancelled) { h.remove(); return; }
      handle = h;
    });

    return () => {
      cancelled = true;
      handle?.remove();
    };
  }, [ready]);

  // Set up notification click listener
  useEffect(() => {
    const cleanup = setupNotificationListeners((prayerName) => {
      console.log(`Notification clicked for: ${prayerName}`);
    });

    return cleanup;
  }, []);

  return { reschedule, rescheduleJumuah, rescheduleSurahKahf };
}
