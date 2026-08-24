import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { HomeGlobeScreen } from '../components/HomeGlobeScreen';

const received: unknown[] = [];
vi.mock('../components/three/Scenes', () => ({
  HomeGlobeView: (props: { data: unknown }) => {
    received.push(props.data);
    return <div data-testid="home-globe" />;
  },
}));

const renderScreen = () => render(<HomeGlobeScreen />);

describe('HomeGlobeScreen', () => {
  beforeEach(() => {
    received.length = 0;
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
});
