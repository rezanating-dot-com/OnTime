import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest';
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HomeGlobeScreen } from '../components/HomeGlobeScreen';
import { GLOBE_LOADER_FADE_MS } from '../components/GlobeLoader';
import { renderWithProviders } from '../test/helpers';

const received: unknown[] = [];
const receivedProps: Array<{ data: unknown; fallback?: unknown }> = [];
// Stand-in for the mounted HomeGlobe instance: the screen assigns its
// callbacks onto this and drives it through setCovered().
const fakeView = {
  onGroundModeChange: undefined as ((v: boolean) => void) | undefined,
  onMoonLockedChange: undefined as ((v: boolean) => void) | undefined,
  onSurfaceReady: undefined as (() => void) | undefined,
  setCovered: vi.fn(),
  focusOnLocation: vi.fn(),
  resetView: vi.fn(),
  resetMoonView: vi.fn(),
};
vi.mock('../components/three/Scenes', async () => {
  const { useEffect } = await import('react');
  return {
    HomeGlobeView: (props: { data: unknown; fallback?: unknown; onView?: (v: unknown) => void }) => {
      received.push(props.data);
      receivedProps.push(props);
      useEffect(() => {
        props.onView?.(fakeView);
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, []);
      return <div data-testid="home-globe" />;
    },
  };
});

const renderScreen = (covered?: boolean) =>
  renderWithProviders(<HomeGlobeScreen prayers={[]} covered={covered} />);

beforeAll(() => {
  // ThemeProvider (pulled in by renderWithProviders) listens for the system
  // scheme; jsdom has no matchMedia implementation of its own.
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
});

describe('HomeGlobeScreen', () => {
  beforeEach(() => {
    received.length = 0;
    receivedProps.length = 0;
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('mounts the globe once the lazy chunk resolves', async () => {
    renderScreen();
    await waitFor(() => expect(received.length).toBeGreaterThan(0));
  });

  it('passes a live Date to the scene', async () => {
    renderScreen();
    await waitFor(() => expect(received.length).toBeGreaterThan(0));
    const data = received[received.length - 1] as { now: Date };
    expect(data.now).toBeInstanceOf(Date);
  });

  it('passes the user\'s real coordinates from LocationContext to the scene', async () => {
    renderScreen();
    await waitFor(() => expect(received.length).toBeGreaterThan(0));
    const data = received[received.length - 1] as { latitude: number; longitude: number };
    expect(typeof data.latitude).toBe('number');
    expect(typeof data.longitude).toBe('number');
  });

  it('paints a dark backdrop behind the globe so the view is never blank', async () => {
    const { container } = renderScreen();
    await waitFor(() => expect(received.length).toBeGreaterThan(0));
    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.style.background).toContain('radial-gradient');
  });

  it('passes an intentional dark fallback for when WebGL is unavailable', async () => {
    renderScreen();
    await waitFor(() => expect(receivedProps.length).toBeGreaterThan(0));
    const { fallback } = receivedProps[receivedProps.length - 1];
    expect(fallback).toBeTruthy();
  });

  it('shows the Esri imagery attribution required by the tile source', async () => {
    const { container } = renderScreen();
    await waitFor(() => expect(received.length).toBeGreaterThan(0));
    expect(container.textContent).toContain('Imagery © Esri');
  });

  describe('User story: I see something while the globe is still loading', () => {
    it('shows the Basmala loader until the globe reports its surface is up, then fades and removes it', async () => {
      renderScreen();
      // Visible from the very first paint, before the lazy chunk resolves.
      expect(screen.getByTestId('globe-loader')).toHaveAttribute('data-state', 'visible');
      expect(screen.getByTestId('globe-loader').textContent).toContain('بِسْمِ');

      await waitFor(() => expect(fakeView.onSurfaceReady).toBeTypeOf('function'));
      vi.useFakeTimers();
      act(() => fakeView.onSurfaceReady!());
      expect(screen.getByTestId('globe-loader')).toHaveAttribute('data-state', 'fading');

      act(() => { vi.advanceTimersByTime(GLOBE_LOADER_FADE_MS + 50); });
      expect(screen.queryByTestId('globe-loader')).not.toBeInTheDocument();
    });
  });

  describe('User story: opening Settings or Qibla does not rebuild the globe', () => {
    it('hides the layer and puts the view to sleep while covered, and wakes it when uncovered', async () => {
      const { container, rerender } = renderScreen(true);
      await waitFor(() => expect(fakeView.setCovered).toHaveBeenCalledWith(true));
      const wrapper = container.firstElementChild as HTMLElement;
      expect(wrapper.style.visibility).toBe('hidden');

      rerender(<HomeGlobeScreen prayers={[]} covered={false} />);
      await waitFor(() => expect(fakeView.setCovered).toHaveBeenLastCalledWith(false));
      expect(wrapper.style.visibility).not.toBe('hidden');
    });
  });

  describe('User story: I zoom into the moon and want to undo my spin without losing my place', () => {
    beforeEach(() => {
      fakeView.resetMoonView.mockClear();
    });

    it('shows My location and Reset view before the moon is ever touched', async () => {
      renderScreen();
      await waitFor(() => expect(received.length).toBeGreaterThan(0));
      expect(screen.getByText('My location')).toBeInTheDocument();
      expect(screen.getByText('Reset view')).toBeInTheDocument();
      expect(screen.queryByText('Reset moon')).not.toBeInTheDocument();
    });

    it('swaps My location for Reset moon once the moon is locked, and taps it through', async () => {
      const user = userEvent.setup();
      renderScreen();
      await waitFor(() => expect(fakeView.onMoonLockedChange).toBeTypeOf('function'));

      act(() => fakeView.onMoonLockedChange!(true));
      expect(screen.queryByText('My location')).not.toBeInTheDocument();
      expect(screen.getByText('Reset view')).toBeInTheDocument();
      const resetMoon = screen.getByText('Reset moon');

      await user.click(resetMoon);
      expect(fakeView.resetMoonView).toHaveBeenCalledTimes(1);
      // Tapping it does not exit the moon — the row does not revert on its
      // own, only the lock-state notification does that.
      expect(screen.getByText('Reset moon')).toBeInTheDocument();
    });

    it('goes back to My location once the moon is unlocked', async () => {
      renderScreen();
      await waitFor(() => expect(fakeView.onMoonLockedChange).toBeTypeOf('function'));

      act(() => fakeView.onMoonLockedChange!(true));
      act(() => fakeView.onMoonLockedChange!(false));

      expect(screen.getByText('My location')).toBeInTheDocument();
      expect(screen.queryByText('Reset moon')).not.toBeInTheDocument();
    });
  });
});
