import { useEffect } from 'react';
import { Preferences } from '@capacitor/preferences';
import { render, act } from '@testing-library/react';
import { SettingsProvider, useSettings } from '../context/SettingsContext';
import type { Settings } from '../types';

// Helper component that exposes settings for assertions
function SettingsInspector({ onSettings }: { onSettings: (s: Settings) => void }) {
  const { settings, isLoading } = useSettings();
  if (!isLoading) onSettings(settings);
  return null;
}

function renderSettingsInspector(onSettings: (s: Settings) => void) {
  return render(
    <SettingsProvider>
      <SettingsInspector onSettings={onSettings} />
    </SettingsProvider>,
  );
}

describe('User story: My settings persist across app restarts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('starts with sensible defaults on first launch (no saved data)', async () => {
    vi.mocked(Preferences.get).mockResolvedValue({ value: null });

    let captured: Settings | null = null;
    await act(async () => {
      renderSettingsInspector((s) => { captured = s; });
    });

    expect(captured).not.toBeNull();
    expect(captured!.calculationMethod).toBe('NorthAmerica');
    expect(captured!.asrCalculation).toBe('Standard');
    expect(captured!.designStyle).toBe('classic');
    expect(captured!.distanceUnit).toBe('miles');
    expect(captured!.notifications.enabled).toBe(true);
    expect(captured!.display.showCurrentPrayer).toBe(true);
    expect(captured!.display.showNextPrayer).toBe(true);
  });

  it('restores saved settings from storage', async () => {
    const saved = {
      calculationMethod: 'Egyptian',
      designStyle: 'islamic',
      distanceUnit: 'km',
    };
    vi.mocked(Preferences.get).mockResolvedValue({ value: JSON.stringify(saved) });

    let captured: Settings | null = null;
    await act(async () => {
      renderSettingsInspector((s) => { captured = s; });
    });

    expect(captured!.calculationMethod).toBe('Egyptian');
    expect(captured!.designStyle).toBe('islamic');
    expect(captured!.distanceUnit).toBe('km');
  });

  it('fills in missing keys with defaults when loading partial settings', async () => {
    // Simulate old save that doesn't have designStyle or surahKahf
    const partialSave = {
      calculationMethod: 'Karachi',
      asrCalculation: 'Hanafi',
    };
    vi.mocked(Preferences.get).mockResolvedValue({ value: JSON.stringify(partialSave) });

    let captured: Settings | null = null;
    await act(async () => {
      renderSettingsInspector((s) => { captured = s; });
    });

    // Saved values preserved
    expect(captured!.calculationMethod).toBe('Karachi');
    expect(captured!.asrCalculation).toBe('Hanafi');
    // Missing values get defaults
    expect(captured!.designStyle).toBe('classic');
    expect(captured!.distanceUnit).toBe('miles');
    expect(captured!.display.showCurrentPrayer).toBe(true);
    expect(captured!.travel.distanceThresholdKm).toBe(88.7);
  });

  it('migrates old boolean notification format to new object format', async () => {
    const oldFormat = {
      notifications: {
        enabled: true,
        prayers: {
          fajr: true,
          sunrise: false,
          dhuhr: true,
          asr: true,
          maghrib: true,
          isha: true,
        },
      },
    };
    vi.mocked(Preferences.get).mockResolvedValue({ value: JSON.stringify(oldFormat) });

    let captured: Settings | null = null;
    await act(async () => {
      renderSettingsInspector((s) => { captured = s; });
    });

    // Booleans should be migrated to objects with enabled field
    expect(captured!.notifications.prayers.fajr.enabled).toBe(true);
    expect(captured!.notifications.prayers.sunrise.enabled).toBe(false);
    expect(captured!.notifications.prayers.fajr.reminderMinutes).toBeDefined();
    expect(captured!.notifications.prayers.fajr.sound).toBeDefined();
  });

  it('gives prayers saved before "before it ends" reminders existed an empty list', async () => {
    const saved = {
      notifications: {
        enabled: true,
        prayers: {
          dhuhr: { enabled: true, reminderMinutes: 10, atPrayerTime: true, sound: 'adhan' },
        },
      },
    };
    vi.mocked(Preferences.get).mockResolvedValue({ value: JSON.stringify(saved) });

    let captured: Settings | null = null;
    await act(async () => {
      renderSettingsInspector((s) => { captured = s; });
    });

    expect(captured!.notifications.prayers.dhuhr.reminderMinutes).toBe(10);
    expect(captured!.notifications.prayers.dhuhr.endReminderMinutes).toEqual([]);
    expect(captured!.notifications.prayers.fajr.endReminderMinutes).toEqual([]);
  });

  it('handles corrupted saved data gracefully (falls back to defaults)', async () => {
    vi.mocked(Preferences.get).mockResolvedValue({ value: 'not-valid-json{{{' });

    let captured: Settings | null = null;
    await act(async () => {
      renderSettingsInspector((s) => { captured = s; });
    });

    // Should fall back to defaults, not crash
    expect(captured).not.toBeNull();
    expect(captured!.calculationMethod).toBe('NorthAmerica');
  });

  it('does not overwrite stored settings when the read itself fails', async () => {
    vi.useFakeTimers();
    try {
      // A transient bridge failure means we have no idea what is on disk, so
      // writing the defaults we are holding would erase the user's real
      // profile — calculation method, saved locations, downloaded athans, all
      // of it. Stay read-only instead.
      vi.mocked(Preferences.get).mockRejectedValue(new Error('bridge not ready'));
      vi.mocked(Preferences.set).mockClear();

      await act(async () => {
        renderSettingsInspector(() => {});
      });
      // Drain the bounded retry loop.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000);
      });

      expect(Preferences.set).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('retries a failed read and keeps the profile when a retry succeeds', async () => {
    vi.useFakeTimers();
    try {
      const stored = JSON.stringify({ calculationMethod: 'Karachi', designStyle: 'islamic' });
      vi.mocked(Preferences.get)
        .mockRejectedValueOnce(new Error('bridge not ready'))
        .mockResolvedValue({ value: stored });
      vi.mocked(Preferences.set).mockClear();

      let captured: Settings | null = null;
      await act(async () => {
        renderSettingsInspector((s) => { captured = s; });
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000);
      });

      expect(captured!.calculationMethod).toBe('Karachi');
      const lastWrite = vi.mocked(Preferences.set).mock.calls.at(-1)?.[0].value;
      expect(lastWrite ? JSON.parse(lastWrite).calculationMethod : null).toBe('Karachi');
    } finally {
      vi.useRealTimers();
    }
  });

  it('still seeds defaults on a genuine fresh install', async () => {
    vi.mocked(Preferences.get).mockResolvedValue({ value: null });
    vi.mocked(Preferences.set).mockClear();

    await act(async () => {
      renderSettingsInspector(() => {});
    });

    // Nothing on disk to protect, so persisting the defaults is correct.
    expect(Preferences.set).toHaveBeenCalled();
  });

  it('persists defaults over data that is present but unparseable', async () => {
    vi.mocked(Preferences.get).mockResolvedValue({ value: 'not-valid-json{{{' });
    vi.mocked(Preferences.set).mockClear();

    await act(async () => {
      renderSettingsInspector(() => {});
    });

    // The read succeeded, so there is no intact profile left to protect.
    expect(Preferences.set).toHaveBeenCalled();
  });
});

describe('Two athan downloads finishing together (ST-3)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('keeps both, rather than the second write clobbering the first', async () => {
    vi.mocked(Preferences.get).mockResolvedValue({ value: null });

    const apiRef: { current: ReturnType<typeof useSettings> | null } = { current: null };
    function Api() {
      const settings = useSettings();
      useEffect(() => {
        apiRef.current = settings;
      });
      return null;
    }

    await act(async () => {
      render(
        <SettingsProvider>
          <Api />
        </SettingsProvider>,
      );
    });

    const file = (id: string) => ({
      id,
      muezzinName: `Muezzin ${id}`,
      title: `Athan ${id}`,
      filename: `${id}.mp3`,
      url: `https://example.test/${id}.mp3`,
    });

    // Both callbacks land in the same batch, which is exactly what two
    // parallel downloads do — handleDownload only guards re-entry per URL, so
    // two different athans really do run at once. Building the array outside
    // the updater meant the second callback closed over the pre-first
    // snapshot: the persisted blob came out as ['b'], a.mp3 stayed orphaned in
    // external storage, its "Downloaded" badge disappeared, and the user
    // downloaded it again.
    await act(async () => {
      apiRef.current!.updateAthan((prev) => ({ downloadedAthans: [...prev.downloadedAthans, file('a')] }));
      apiRef.current!.updateAthan((prev) => ({ downloadedAthans: [...prev.downloadedAthans, file('b')] }));
    });

    const writes = vi
      .mocked(Preferences.set)
      .mock.calls.map(([arg]) => arg)
      .filter((arg) => arg.key === 'ontime_settings');
    const saved = JSON.parse(writes[writes.length - 1].value).athan.downloadedAthans;
    expect(saved.map((a: { id: string }) => a.id).sort()).toEqual(['a', 'b']);
  });
});
