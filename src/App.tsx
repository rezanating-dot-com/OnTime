import { useState, useEffect, useRef, useCallback, lazy, Suspense } from 'react';
import { StatusBar, Style } from '@capacitor/status-bar';
import { App as CapApp } from '@capacitor/app';
import { Preferences } from '@capacitor/preferences';
import { LocalNotifications } from '@capacitor/local-notifications';
import { usePrayerTimes } from './hooks/usePrayerTimes';
import { useNotifications } from './hooks/useNotifications';
import { useTheme } from './context/ThemeContext';
import { useTravel } from './context/TravelContext';
import { useSettings } from './context/SettingsContext';
import { formatDistance } from './utils/distance';
import { PrayerTable } from './components/PrayerTable';
import { CountdownTimer } from './components/CountdownTimer';
import { IslamicPrayerTable } from './components/IslamicPrayerTable';
import { IslamicCountdownTimer } from './components/IslamicCountdownTimer';
import { GirihBackground } from './components/IslamicPatterns';
import { LocationDisplay } from './components/LocationDisplay';
import { SunDomeCard } from './components/SunDomeCard';
import { HomeGlobeScreen } from './components/HomeGlobeScreen';
import { OnboardingScreen } from './components/OnboardingScreen';
import { TravelPromptDialog } from './components/TravelPromptDialog';
import { NotificationPermissionDialog } from './components/NotificationPermissionDialog';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faKaaba } from '@fortawesome/free-solid-svg-icons';

const QiblaCompass = lazy(() => import('./components/QiblaCompass').then(m => ({ default: m.QiblaCompass })));
const SettingsModal = lazy(() => import('./components/SettingsModal').then(m => ({ default: m.SettingsModal })));
const Dashboard = lazy(() => import('./components/Dashboard').then(m => ({ default: m.Dashboard })));

const ONBOARDING_KEY = 'ontime_onboarding_complete';

function App() {
  const [isQiblaOpen, setIsQiblaOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isDashboardOpen, setIsDashboardOpen] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState<boolean | null>(null);

  const settingsBackRef = useRef<(() => void) | null>(null);

  const { prayers, currentPrayer, nextPrayer, nextPrayerTime, countdown } = usePrayerTimes();
  const { effectiveTheme, updatePrayerTimes } = useTheme();
  const { travelState } = useTravel();
  const { settings, updateHomeView } = useSettings();

  // Check if onboarding is needed
  useEffect(() => {
    Preferences.get({ key: ONBOARDING_KEY }).then(({ value }) => {
      setShowOnboarding(value !== 'true');
    });
  }, []);

  // Set up push notifications
  useNotifications();

  // Handle Android back button / swipe gesture
  const handleBackButton = useCallback(() => {
    if (settingsBackRef.current) {
      settingsBackRef.current();
    } else if (isQiblaOpen) {
      setIsQiblaOpen(false);
    } else if (isDashboardOpen) {
      setIsDashboardOpen(false);
    } else {
      CapApp.minimizeApp();
    }
  }, [isQiblaOpen, isDashboardOpen]);

  useEffect(() => {
    const listener = CapApp.addListener('backButton', handleBackButton);
    return () => { listener.then(h => h.remove()); };
  }, [handleBackButton]);

  // Configure status bar to match theme
  useEffect(() => {
    StatusBar.setStyle({ style: effectiveTheme === 'light' ? Style.Light : Style.Dark }).catch(() => {});
    const statusBarColors: Record<string, string> = { light: '#FAFAFA', dark: '#0F0F0F', desert: '#1C1510', rose: '#160D14', forest: '#0C1510', ocean: '#0A1018' };
    StatusBar.setBackgroundColor({ color: statusBarColors[effectiveTheme] }).catch(() => {});
    StatusBar.setOverlaysWebView({ overlay: false }).catch(() => {});
  }, [effectiveTheme]);

  // Update theme context with prayer times for auto dark mode
  useEffect(() => {
    const fajr = prayers.find(p => p.name === 'fajr')?.time || null;
    const maghrib = prayers.find(p => p.name === 'maghrib')?.time || null;
    updatePrayerTimes(fajr, maghrib);
  }, [prayers, updatePrayerTimes]);

  // Fire notification when travel is detected and pending confirmation
  const prevTravelPendingRef = useRef(false);
  useEffect(() => {
    const wasPending = prevTravelPendingRef.current;
    prevTravelPendingRef.current = travelState.travelPending;

    if (travelState.travelPending && !wasPending && travelState.distanceFromHomeKm !== null) {
      const distanceText = formatDistance(travelState.distanceFromHomeKm, settings.distanceUnit);
      LocalNotifications.schedule({
        notifications: [{
          id: 900,
          title: 'Are you traveling?',
          body: `You're about ${distanceText} from home \u2014 tap to enable shortened prayers.`,
          schedule: { at: new Date(Date.now() + 500) },
        }],
      }).catch(() => {});
    }
  }, [travelState.travelPending, travelState.distanceFromHomeKm, settings.distanceUnit]);

  // Show nothing while checking onboarding status
  if (showOnboarding === null) return null;

  // Show onboarding on first launch
  if (showOnboarding) {
    return (
      <OnboardingScreen
        onComplete={async () => {
          await Preferences.set({ key: ONBOARDING_KEY, value: 'true' });
          setShowOnboarding(false);
        }}
      />
    );
  }

  const isIslamic = settings.designStyle === 'islamic';
  const isGlobeHome = settings.homeView === 'globe';
  const showGlobeLayer = isGlobeHome && !isQiblaOpen && !isDashboardOpen && !isSettingsOpen;
  const headerGlowVars = isGlobeHome
    ? ({ '--color-muted': 'rgba(245,246,248,0.6)', '--color-text': 'rgba(245,246,248,0.95)' } as React.CSSProperties)
    : undefined;
  const headerGlowBg: React.CSSProperties | undefined = isGlobeHome
    ? { background: 'linear-gradient(to bottom, rgba(3,5,10,0.5), transparent)', backdropFilter: 'blur(6px)' }
    : undefined;

  return (
    <div className="min-h-screen bg-[var(--color-background)] safe-area-bottom flex flex-col relative">
      {/* Islamic design: full-screen girih pattern + vignette */}
      {isIslamic && (
        <>
          <div className="absolute inset-0 z-0">
            <GirihBackground opacity={0.04} id="screen-bg"/>
          </div>
          <div className="absolute inset-0 z-0 pointer-events-none" style={{
            background: 'radial-gradient(ellipse at center, transparent 60%, rgba(0,0,0,0.08) 100%)',
          }}/>
        </>
      )}

      {showGlobeLayer && <HomeGlobeScreen />}

      <div className="max-w-lg mx-auto w-full flex-1 overflow-y-auto relative z-10">
{/* Top Bar - sticky below status bar */}
        {isIslamic ? (
          <header className="sticky top-0 z-40 safe-area-top px-5 pt-2 pb-3.5 flex items-center justify-between" style={{ ...headerGlowVars, ...(headerGlowBg ?? { background: 'var(--color-background)' }) }}>
            {/* Settings */}
            <button
              onClick={() => setIsSettingsOpen(true)}
              className="flex items-center justify-center"
              style={{
                width: 40, height: 40, borderRadius: 12,
                background: 'color-mix(in srgb, var(--color-primary) 6%, transparent)',
                border: '1px solid color-mix(in srgb, var(--color-primary) 15%, transparent)',
              }}
              aria-label="Open settings"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="3" stroke="var(--color-primary)" strokeWidth="1.5"/>
                <path d="M12 2v3M12 19v3M4.22 4.22l2.12 2.12M17.66 17.66l2.12 2.12M2 12h3M19 12h3M4.22 19.78l2.12-2.12M17.66 6.34l2.12-2.12" stroke="var(--color-primary)" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
            </button>

            {/* City name */}
            <LocationDisplay />

            {/* Qibla + Dashboard */}
            <div className="flex gap-2">
              <button
                onClick={() => setIsQiblaOpen(true)}
                className="flex items-center justify-center"
                style={{
                  width: 40, height: 40, borderRadius: 12,
                  background: 'color-mix(in srgb, var(--color-primary) 6%, transparent)',
                  border: '1px solid color-mix(in srgb, var(--color-primary) 15%, transparent)',
                }}
                aria-label="Open qibla compass"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                  <rect x="4" y="7" width="16" height="13" stroke="var(--color-primary)" strokeWidth="1.5"/>
                  <rect x="4" y="10" width="16" height="2" fill="var(--color-primary)" opacity="0.4"/>
                  <path d="M8 7V5h8v2" stroke="var(--color-primary)" strokeWidth="1.5"/>
                </svg>
              </button>
              <button
                onClick={() => updateHomeView(isGlobeHome ? 'list' : 'globe')}
                className="flex items-center justify-center"
                style={{
                  width: 40, height: 40, borderRadius: 12,
                  background: 'color-mix(in srgb, var(--color-primary) 6%, transparent)',
                  border: '1px solid color-mix(in srgb, var(--color-primary) 15%, transparent)',
                }}
                aria-label={isGlobeHome ? 'Switch to list view' : 'Switch to globe view'}
                aria-pressed={isGlobeHome}
              >
                {isGlobeHome ? (
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="var(--color-primary)" strokeWidth="1.6">
                    <path strokeLinecap="round" d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>
                  </svg>
                ) : (
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="var(--color-primary)" strokeWidth="1.6">
                    <circle cx="12" cy="12" r="9"/>
                    <path d="M3 12h18M12 3c2.5 2.5 4 5.5 4 9s-1.5 6.5-4 9c-2.5-2.5-4-5.5-4-9s1.5-6.5 4-9z"/>
                  </svg>
                )}
              </button>
              <button
                onClick={() => setIsDashboardOpen(true)}
                className="flex items-center justify-center"
                style={{
                  width: 40, height: 40, borderRadius: 12,
                  background: 'color-mix(in srgb, var(--color-primary) 6%, transparent)',
                  border: '1px solid color-mix(in srgb, var(--color-primary) 15%, transparent)',
                }}
                aria-label="Open dashboard"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                  <rect x="4" y="12" width="3.5" height="8" stroke="var(--color-primary)" strokeWidth="1.5"/>
                  <rect x="10.25" y="7" width="3.5" height="13" stroke="var(--color-primary)" strokeWidth="1.5"/>
                  <rect x="16.5" y="14" width="3.5" height="6" stroke="var(--color-primary)" strokeWidth="1.5"/>
                </svg>
              </button>
            </div>
          </header>
        ) : (
          <header className={`sticky top-0 z-40 safe-area-top px-4 pt-2 pb-3 flex items-center justify-between ${isGlobeHome ? '' : 'bg-[var(--color-background)]'}`} style={{ ...headerGlowVars, ...headerGlowBg }}>
            <button
              onClick={() => setIsSettingsOpen(true)}
              className="p-2 -ml-2 rounded-full hover:bg-[var(--color-card)] transition-colors"
              aria-label="Open settings"
            >
              <svg className="w-6 h-6 text-[var(--color-muted)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M10.343 3.94c.09-.542.56-.94 1.11-.94h1.093c.55 0 1.02.398 1.11.94l.149.894c.07.424.384.764.78.93.398.164.855.142 1.205-.108l.737-.527a1.125 1.125 0 011.45.12l.773.774c.39.389.44 1.002.12 1.45l-.527.737c-.25.35-.272.806-.107 1.204.165.397.505.71.93.78l.893.15c.543.09.94.56.94 1.109v1.094c0 .55-.397 1.02-.94 1.11l-.893.149c-.425.07-.765.383-.93.78-.165.398-.143.854.107 1.204l.527.738c.32.447.269 1.06-.12 1.45l-.774.773a1.125 1.125 0 01-1.449.12l-.738-.527c-.35-.25-.806-.272-1.204-.107-.397.165-.71.505-.78.929l-.15.894c-.09.542-.56.94-1.11.94h-1.094c-.55 0-1.019-.398-1.11-.94l-.148-.894c-.071-.424-.384-.764-.781-.93-.398-.164-.854-.142-1.204.108l-.738.527c-.447.32-1.06.269-1.45-.12l-.773-.774a1.125 1.125 0 01-.12-1.45l.527-.737c.25-.35.273-.806.108-1.204-.165-.397-.505-.71-.93-.78l-.894-.15c-.542-.09-.94-.56-.94-1.109v-1.094c0-.55.398-1.02.94-1.11l.894-.149c.424-.07.765-.383.93-.78.165-.398.143-.854-.108-1.204l-.526-.738a1.125 1.125 0 01.12-1.45l.773-.773a1.125 1.125 0 011.45-.12l.737.527c.35.25.807.272 1.204.107.397-.165.71-.505.78-.929l.15-.894z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </button>

            <LocationDisplay />

            <div className="flex items-center gap-1">
              <button
                onClick={() => setIsQiblaOpen(true)}
                className="p-2 rounded-full hover:bg-[var(--color-card)] transition-colors"
                aria-label="Open qibla compass"
              >
                <FontAwesomeIcon icon={faKaaba} className="w-5 h-5 text-[var(--color-muted)]" />
              </button>
              <button
                onClick={() => updateHomeView(isGlobeHome ? 'list' : 'globe')}
                className="p-2 rounded-full hover:bg-[var(--color-card)] transition-colors"
                aria-label={isGlobeHome ? 'Switch to list view' : 'Switch to globe view'}
                aria-pressed={isGlobeHome}
              >
                {isGlobeHome ? (
                  <svg className="w-5 h-5 text-[var(--color-muted)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.6}>
                    <path strokeLinecap="round" d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>
                  </svg>
                ) : (
                  <svg className="w-5 h-5 text-[var(--color-muted)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.6}>
                    <circle cx="12" cy="12" r="9"/>
                    <path d="M3 12h18M12 3c2.5 2.5 4 5.5 4 9s-1.5 6.5-4 9c-2.5-2.5-4-5.5-4-9s1.5-6.5 4-9z"/>
                  </svg>
                )}
              </button>
              <button
                onClick={() => setIsDashboardOpen(true)}
                className="p-2 -mr-2 rounded-full hover:bg-[var(--color-card)] transition-colors"
                aria-label="Open dashboard"
              >
                <svg className="w-6 h-6 text-[var(--color-muted)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
                </svg>
              </button>
            </div>
          </header>
        )}

        {/* Content */}
        <div className={isIslamic ? 'px-5 pb-6' : 'px-4 pb-6'}>

        {/* Today's Sky — dropped while a full-screen overlay covers it, so we
            aren't running a hidden WebGL context alongside the qibla globe. */}
        {!isGlobeHome && !isQiblaOpen && !isDashboardOpen && !isSettingsOpen && <SunDomeCard prayers={prayers} />}

        {/* Current Prayer & Countdown */}
        {(currentPrayer || nextPrayer) && (
          <div className="mb-5">
            {isIslamic ? (
              <IslamicCountdownTimer
                currentPrayer={currentPrayer}
                currentPrayerTime={currentPrayer ? prayers.find(p => p.name === currentPrayer)?.time ?? null : null}
                nextPrayer={nextPrayer}
                nextPrayerTime={nextPrayerTime}
                hours={countdown.hours}
                minutes={countdown.minutes}
                seconds={countdown.seconds}
                isTraveling={travelState.isTraveling}
                travelState={travelState}
                display={settings.display}
                glow={isGlobeHome}
              />
            ) : (
              <CountdownTimer
                currentPrayer={currentPrayer}
                currentPrayerTime={currentPrayer ? prayers.find(p => p.name === currentPrayer)?.time ?? null : null}
                nextPrayer={nextPrayer}
                nextPrayerTime={nextPrayerTime}
                hours={countdown.hours}
                minutes={countdown.minutes}
                seconds={countdown.seconds}
                isTraveling={travelState.isTraveling}
                travelState={travelState}
                display={settings.display}
                glow={isGlobeHome}
              />
            )}
          </div>
        )}

        {/* Travel Banner + Prayer Table */}
        {!isGlobeHome && (
          <div className={`mb-5 ${travelState.isTraveling ? 'rounded-lg border-2 border-amber-500/30 overflow-hidden bg-[var(--color-card)]' : ''}`}>
            {travelState.isTraveling && (
              <div className="px-4 py-3 bg-amber-500/10">
                <div className="flex items-center gap-2">
                  <span className="text-amber-600 text-sm font-semibold">Travel Mode</span>
                  {travelState.distanceFromHomeKm !== null && (
                    <span className="text-amber-600/70 text-xs">
                      {formatDistance(travelState.distanceFromHomeKm, settings.distanceUnit)} from home
                    </span>
                  )}
                </div>
                <p className="text-amber-600/60 text-xs mt-0.5">Qasr prayers active — shortened to 2 rak'ah</p>
              </div>
            )}
            {isIslamic ? (
              <IslamicPrayerTable
                prayers={prayers}
                currentPrayer={currentPrayer}
                nextPrayerTime={nextPrayerTime}
              />
            ) : (
              <PrayerTable
                prayers={prayers}
                currentPrayer={currentPrayer}
                nextPrayerTime={nextPrayerTime}
              />
            )}
          </div>
        )}

        </div>
      </div>

      {/* Modals */}
      <Suspense fallback={<div className="fixed inset-0 flex items-center justify-center bg-[var(--color-bg)]"><span className="text-[var(--color-muted)]">Loading…</span></div>}>
        <QiblaCompass isOpen={isQiblaOpen} onClose={() => setIsQiblaOpen(false)} />
      </Suspense>
      <Suspense fallback={<div className="fixed inset-0 flex items-center justify-center bg-[var(--color-bg)]"><span className="text-[var(--color-muted)]">Loading…</span></div>}>
        <SettingsModal isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} onBackRef={settingsBackRef} />
      </Suspense>
      <Suspense fallback={<div className="fixed inset-0 flex items-center justify-center bg-[var(--color-bg)]"><span className="text-[var(--color-muted)]">Loading…</span></div>}>
        <Dashboard isOpen={isDashboardOpen} onClose={() => setIsDashboardOpen(false)} />
      </Suspense>
      <TravelPromptDialog />
      <NotificationPermissionDialog />
    </div>
  );
}

export default App;