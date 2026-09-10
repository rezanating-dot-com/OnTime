import { render, act } from '@testing-library/react';
import { ThemeProvider, useTheme } from '../context/ThemeContext';
import type { Theme } from '../context/ThemeContext';

// jsdom does not implement window.matchMedia — provide a minimal stub
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

function ThemeInspector({ onTheme }: { onTheme: (data: { theme: Theme; effectiveTheme: string }) => void }) {
  const { theme, effectiveTheme } = useTheme();
  onTheme({ theme, effectiveTheme });
  return null;
}

describe('User story: The app respects my chosen color theme', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.documentElement.classList.remove('dark', 'desert', 'rose', 'forest', 'ocean');
  });

  it('defaults to system theme on first launch', async () => {
    let captured: { theme: Theme; effectiveTheme: string } | null = null;

    await act(async () => {
      render(
        <ThemeProvider>
          <ThemeInspector onTheme={(d) => { captured = d; }} />
        </ThemeProvider>,
      );
    });

    expect(captured!.theme).toBe('system');
  });

  it('applies dark class to document when dark theme is active', async () => {
    const { Preferences } = await import('@capacitor/preferences');
    vi.mocked(Preferences.get).mockResolvedValue({ value: 'dark' });

    await act(async () => {
      render(
        <ThemeProvider>
          <ThemeInspector onTheme={() => {}} />
        </ThemeProvider>,
      );
    });

    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('applies desert class for desert theme', async () => {
    const { Preferences } = await import('@capacitor/preferences');
    vi.mocked(Preferences.get).mockResolvedValue({ value: 'desert' });

    await act(async () => {
      render(
        <ThemeProvider>
          <ThemeInspector onTheme={() => {}} />
        </ThemeProvider>,
      );
    });

    expect(document.documentElement.classList.contains('desert')).toBe(true);
  });

  it('does not add any theme class for light theme', async () => {
    const { Preferences } = await import('@capacitor/preferences');
    vi.mocked(Preferences.get).mockResolvedValue({ value: 'light' });

    await act(async () => {
      render(
        <ThemeProvider>
          <ThemeInspector onTheme={() => {}} />
        </ThemeProvider>,
      );
    });

    expect(document.documentElement.classList.contains('dark')).toBe(false);
    expect(document.documentElement.classList.contains('desert')).toBe(false);
    expect(document.documentElement.classList.contains('rose')).toBe(false);
    expect(document.documentElement.classList.contains('forest')).toBe(false);
    expect(document.documentElement.classList.contains('ocean')).toBe(false);
  });

  it('supports all 6 theme options without error', async () => {
    const themes: Theme[] = ['light', 'dark', 'system', 'auto', 'desert', 'rose'];

    for (const themeValue of themes) {
      const { Preferences } = await import('@capacitor/preferences');
      vi.mocked(Preferences.get).mockResolvedValue({ value: themeValue });

      const { unmount } = await act(async () => {
        return render(
          <ThemeProvider>
            <ThemeInspector onTheme={() => {}} />
          </ThemeProvider>,
        );
      });

      // No assertion needed — just verifying it doesn't throw
      unmount();
      document.documentElement.classList.remove('dark', 'desert', 'rose', 'forest', 'ocean');
    }
  });
});

describe('browser chrome colour (ST-9)', () => {
  /** index.html declares two, media-scoped light and dark. */
  function installBothMetas() {
    document.head.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.remove());
    for (const [scheme, content] of [['light', '#FAFAFA'], ['dark', '#0F0F0F']] as const) {
      const meta = document.createElement('meta');
      meta.setAttribute('name', 'theme-color');
      meta.setAttribute('media', `(prefers-color-scheme: ${scheme})`);
      meta.setAttribute('content', content);
      document.head.appendChild(meta);
    }
  }

  const contents = () =>
    [...document.head.querySelectorAll('meta[name="theme-color"]')].map((m) =>
      m.getAttribute('content'),
    );

  it('tints both declared metas, not only the first one querySelector finds', async () => {
    installBothMetas();
    const { Preferences } = await import('@capacitor/preferences');
    vi.mocked(Preferences.get).mockResolvedValue({ value: 'desert' });

    const { unmount } = await act(async () =>
      render(
        <ThemeProvider>
          <ThemeInspector onTheme={() => {}} />
        </ThemeProvider>,
      ),
    );

    // querySelector always returned the light-scoped one, so under a dark OS
    // preference the meta the browser was actually applying never got written:
    // dark chrome over a light app, and Desert/Rose/Forest/Ocean never tinting
    // the chrome at all.
    expect(contents()).toEqual(['#1C1510', '#1C1510']);
    unmount();
    document.documentElement.classList.remove('dark', 'desert', 'rose', 'forest', 'ocean');
  });
});

/**
 * User story: I run the app on Dark (or System, or Desert...). Nothing about
 * the sky affects what I see, so nothing about the sky should be waking the
 * phone up.
 *
 * Auto is the only theme that follows Maghrib and Fajr, but the minute timer
 * that tracked them used to run for every user on every theme, for the whole
 * life of the app.
 */
describe('the Auto theme’s minute timer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    document.documentElement.classList.remove('dark', 'desert', 'rose', 'forest', 'ocean');
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const renderWithTheme = async (stored: string) => {
    const { Preferences } = await import('@capacitor/preferences');
    vi.mocked(Preferences.get).mockResolvedValue({ value: stored });
    const setInterval = vi.spyOn(globalThis, 'setInterval');
    await act(async () => {
      render(
        <ThemeProvider>
          <ThemeInspector onTheme={() => {}} />
        </ThemeProvider>,
      );
    });
    const minuteTimers = setInterval.mock.calls.filter(([, ms]) => ms === 60000);
    setInterval.mockRestore();
    return minuteTimers.length;
  };

  it('does not run on a theme that ignores the sky', async () => {
    expect(await renderWithTheme('dark')).toBe(0);
  });

  it('runs on Auto, which is the theme that needs it', async () => {
    expect(await renderWithTheme('auto')).toBeGreaterThan(0);
  });
});
