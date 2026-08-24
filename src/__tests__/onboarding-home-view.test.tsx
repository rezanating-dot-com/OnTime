import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { OnboardingScreen } from '../components/OnboardingScreen';
import { SettingsProvider, useSettings } from '../context/SettingsContext';
import { LocationProvider } from '../context/LocationContext';
import { TravelProvider } from '../context/TravelContext';
import type { Settings } from '../types';

const settingsRef = { current: null as Settings | null };

function SettingsCapture() {
  const { settings } = useSettings();
  settingsRef.current = settings;
  return null;
}

function renderOnboarding(onComplete: () => void) {
  settingsRef.current = null;
  return render(
    <SettingsProvider>
      <LocationProvider>
        <TravelProvider>
          <SettingsCapture />
          <OnboardingScreen onComplete={onComplete} />
        </TravelProvider>
      </LocationProvider>
    </SettingsProvider>,
  );
}

async function skipToHomeViewStep(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByText('Get Started'));
  await user.click(screen.getByText('Skip for now'));
  await user.click(screen.getByText("Skip — I'll set it manually"));
}

describe('OnboardingScreen home view step', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows the homeView step after skipping notifications and location', async () => {
    const user = userEvent.setup();
    const onComplete = vi.fn();

    await act(async () => {
      renderOnboarding(onComplete);
    });
    await skipToHomeViewStep(user);

    expect(await screen.findByText('Choose Your Home Screen')).toBeInTheDocument();
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('choosing Globe saves homeView and completes onboarding', async () => {
    const user = userEvent.setup();
    const onComplete = vi.fn();

    await act(async () => {
      renderOnboarding(onComplete);
    });
    await skipToHomeViewStep(user);
    await screen.findByText('Choose Your Home Screen');

    await user.click(screen.getByText('Globe'));

    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(settingsRef.current?.homeView).toBe('globe');
  });

  it('choosing List saves homeView and completes onboarding', async () => {
    const user = userEvent.setup();
    const onComplete = vi.fn();

    await act(async () => {
      renderOnboarding(onComplete);
    });
    await skipToHomeViewStep(user);
    await screen.findByText('Choose Your Home Screen');

    await user.click(screen.getByText('List'));

    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(settingsRef.current?.homeView).toBe('list');
  });
});
