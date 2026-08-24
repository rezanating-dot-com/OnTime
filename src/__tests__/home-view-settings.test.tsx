import { Preferences } from '@capacitor/preferences';
import { render, act } from '@testing-library/react';
import { SettingsProvider, useSettings } from '../context/SettingsContext';
import type { Settings } from '../types';

const settingsRef = { current: null as Settings | null };
const updateRef = { current: null as ((v: 'globe' | 'list') => void) | null };

function SettingsInspector() {
  const { settings, updateHomeView } = useSettings();
  settingsRef.current = settings;
  updateRef.current = updateHomeView;
  return null;
}

function renderInspector() {
  settingsRef.current = null;
  updateRef.current = null;
  return render(
    <SettingsProvider>
      <SettingsInspector />
    </SettingsProvider>,
  );
}

describe('Settings: homeView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('defaults to "list" on first launch (no saved data)', async () => {
    vi.mocked(Preferences.get).mockResolvedValue({ value: null });

    await act(async () => {
      renderInspector();
    });

    expect(settingsRef.current!.homeView).toBe('list');
  });

  it('restores a saved "globe" value', async () => {
    vi.mocked(Preferences.get).mockResolvedValue({ value: JSON.stringify({ homeView: 'globe' }) });

    await act(async () => {
      renderInspector();
    });

    expect(settingsRef.current!.homeView).toBe('globe');
  });

  it('fills in the default when loading settings saved before this field existed', async () => {
    vi.mocked(Preferences.get).mockResolvedValue({
      value: JSON.stringify({ calculationMethod: 'Karachi' }),
    });

    await act(async () => {
      renderInspector();
    });

    expect(settingsRef.current!.homeView).toBe('list');
  });

  it('updateHomeView persists the new value', async () => {
    vi.mocked(Preferences.get).mockResolvedValue({ value: null });

    await act(async () => {
      renderInspector();
    });

    await act(async () => {
      updateRef.current!('globe');
    });

    expect(settingsRef.current!.homeView).toBe('globe');
  });
});
