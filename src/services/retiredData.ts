import { Preferences } from '@capacitor/preferences';

/**
 * Storage the app used to write and no longer reads.
 *
 * Left alone, a removed feature's data sits on the device for the life of the
 * install: nothing would read it, nothing would delete it, and the privacy
 * policy would go on describing storage the app does not use. Clearing it on
 * launch is the only way to make "we do not keep this" true of an upgrade as
 * well as of a fresh install.
 *
 * This is deliberately destructive. Anything listed here is gone the next time
 * the app starts, so a key only belongs here once the decision to drop the
 * feature is settled.
 */
const RETIRED_KEYS = [
  // The salah tracker, removed 2026-09-10.
  'ontime_prayer_tracking',
];

/** Clear retired storage. Safe to call on every launch; absent keys are a no-op. */
export async function removeRetiredData(): Promise<void> {
  await Promise.all(
    RETIRED_KEYS.map((key) =>
      // A storage failure here is not worth blocking a launch over.
      Preferences.remove({ key }).catch(() => {}),
    ),
  );
}
