import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Preferences } from '@capacitor/preferences';
import { removeRetiredData } from '../services/retiredData';

/**
 * User story: I update the app, the tracker is gone, and so is what it kept.
 *
 * The records were written to device storage and nothing reads them any more.
 * Without this they would outlive the feature, and the privacy policy's
 * account of what the app stores would be wrong for every existing install.
 */
describe('User story: retired storage after an upgrade', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('clears the prayer tracking records', async () => {
    await removeRetiredData();
    expect(Preferences.remove).toHaveBeenCalledWith({ key: 'ontime_prayer_tracking' });
  });

  it('does not reject when storage refuses', async () => {
    vi.mocked(Preferences.remove).mockRejectedValueOnce(new Error('no storage'));
    await expect(removeRetiredData()).resolves.toBeUndefined();
  });
});
