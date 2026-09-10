import React, { useState, useEffect } from 'react';
import { formatTime, getTimeUntil, isValidPrayerTime } from '../services/prayerService';
import { trackPrayer, getPrayerStatus, type PrayerStatus } from '../services/prayerTrackingService';
import { useSettings } from '../context/SettingsContext';
import { useTravel } from '../context/TravelContext';
import { KhatamStar, GirihBackground } from './IslamicPatterns';
import type { PrayerTime, PrayerName, AllPrayerNames, TravelState } from '../types';
import { readableInkOn } from '../utils/contrast';

interface IslamicPrayerTableProps {
  prayers: PrayerTime[];
  currentPrayer: PrayerName | null;
  nextPrayerTime: Date | null;
}

const CORE_PRAYERS: PrayerName[] = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'];
const TRACKABLE_PRAYERS: PrayerName[] = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'];

const ARABIC_NAMES: Record<string, string> = {
  fajr: '\u0627\u0644\u0641\u062C\u0631',
  sunrise: '\u0627\u0644\u0634\u0631\u0648\u0642',
  dhuhr: '\u0627\u0644\u0638\u0647\u0631',
  asr: '\u0627\u0644\u0639\u0635\u0631',
  maghrib: '\u0627\u0644\u0645\u063A\u0631\u0628',
  isha: '\u0627\u0644\u0639\u0634\u0627\u0621',
};

// Sky gradients — dawn purples through to deep navy
const SKY_GRADIENTS: Record<AllPrayerNames, [string, string, string]> = {
  fajr: ['#2a1f4a', '#5c3a6e', '#c98b7a'],
  sunrise: ['#fcd34d', '#f59e0b', '#ea580c'],
  dhuhr: ['#4fa8d8', '#86c5e8', '#eaf3fa'],
  asr: ['#d9a86a', '#e8c98a', '#f4e4b8'],
  maghrib: ['#c74a2a', '#e0834a', '#f0c27b'],
  isha: ['#0b1a3a', '#1e3560', '#3a5a8c'],
  middleOfNight: ['#0f172a', '#1e1b4b', '#312e81'],
  lastThirdOfNight: ['#020617', '#0f172a', '#1e1b4b'],
  tahajjud: ['#0f172a', '#1e1b4b', '#312e81'],
};

const SUNNAH_PRAYERS_DEFAULT: Partial<Record<AllPrayerNames, string>> = {
  fajr: '2 before',
  dhuhr: '4 before \u00B7 2 after',
  asr: '4 before',
  maghrib: '2 after',
  isha: '2 after \u00B7 Witr',
};

const SUNNAH_PRAYERS_TRAVEL: Partial<Record<AllPrayerNames, string>> = {
  fajr: '2 before',
  isha: 'Witr',
};

function getSunnahPrayers(isTraveling: boolean) {
  return isTraveling ? SUNNAH_PRAYERS_TRAVEL : SUNNAH_PRAYERS_DEFAULT;
}

/** Rak'ah in this prayer right now: shortened while travelling, except Maghrib. */
function rakatFor(name: AllPrayerNames, travelState: TravelState): string {
  if (travelState.qasr[name as keyof typeof travelState.qasr]) return '2';
  return name === 'maghrib' ? '3' : '4';
}

export const IslamicPrayerTable = React.memo(function IslamicPrayerTable({ prayers, currentPrayer }: IslamicPrayerTableProps) {
  const { settings } = useSettings();
  const { travelState } = useTravel();
  const [selectedPrayer, setSelectedPrayer] = useState<AllPrayerNames | null>(null);
  const [trackingStatus, setTrackingStatus] = useState<Record<string, PrayerStatus>>({});
  const sunnahPrayers = getSunnahPrayers(travelState.isTraveling);
  const isFriday = new Date().getDay() === 5;
  const jumuahEnabled = isFriday && settings.jumuah.enabled && settings.jumuah.times.length > 0;
  // Today's khutbah as an instant. Both Friday branches below need it: the
  // Jama' one substituted only the *label*, keeping prayer.time, so a
  // travelling user on a Friday saw "Jumuah + Asr - 12:24" against a 13:00
  // khutbah — contradicting the same screen's non-travelling rendering, and
  // opening the tracking prompt at Asr rather than at the khutbah.
  const khutbahTime = (() => {
    if (!jumuahEnabled) return null;
    const [hh, mm] = settings.jumuah.times[0].khutbah.split(':').map(Number);
    if (Number.isNaN(hh) || Number.isNaN(mm)) return null;
    const d = new Date();
    d.setHours(hh, mm, 0, 0);
    return d;
  })();

  // isPassed is computed from `new Date()` at render time, and the boundaries
  // that re-render this table are the core prayer times — so a row measured
  // against anything else went stale. The Jumu'ah row is the live case: its
  // isPassed derives from the khutbah, which with a 12:00 khutbah and a 12:24
  // Dhuhr left the row untrackable for 77 minutes after the khutbah began.
  // A minute is finer than any boundary this UI distinguishes.
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  // Reload when the displayed day's prayers change — the list rolls over at
  // local midnight, and stale checkmarks from yesterday would otherwise be
  // drawn against today's rows until something else forced a re-render.
  useEffect(() => {
    async function loadStatus() {
      const status: Record<string, PrayerStatus> = {};
      for (const prayer of TRACKABLE_PRAYERS) {
        status[prayer] = await getPrayerStatus(prayer);
      }
      setTrackingStatus(status);
    }
    loadStatus();
  }, [prayers]);

  const displayPrayers = prayers.filter((p) => {
    if (CORE_PRAYERS.includes(p.name as PrayerName)) return true;
    if (p.name === 'sunrise') return settings.optionalPrayers.showSunrise;
    if (p.name === 'middleOfNight') return settings.optionalPrayers.showMiddleOfNight;
    if (p.name === 'lastThirdOfNight') return settings.optionalPrayers.showLastThirdOfNight;
    return false;
  });

  const sortedPrayers = [...displayPrayers].sort((a, b) => a.time.getTime() - b.time.getTime());
  const highlightedPrayer = currentPrayer;

  const handleRowTap = (prayerName: AllPrayerNames) => {
    setSelectedPrayer(selectedPrayer === prayerName ? null : prayerName);
  };

  const handleTrack = async (prayer: PrayerName, status: PrayerStatus) => {
    await trackPrayer(prayer, status);
    setTrackingStatus((prev) => ({ ...prev, [prayer]: status }));
    setSelectedPrayer(null);
  };

  const trackBoth = async (first: PrayerName, second: PrayerName, status: PrayerStatus) => {
    for (const prayer of [first, second]) {
      try {
        await handleTrack(prayer, status);
      } catch (error) {
        console.error(`Failed to track ${prayer}:`, error);
      }
    }
  };

  const renderPrayers = () => {
    const rendered: React.ReactNode[] = [];
    const skip = new Set<string>();

    for (let i = 0; i < sortedPrayers.length; i++) {
      const prayer = sortedPrayers[i];
      if (skip.has(prayer.name)) continue;

      const isJamaDhuhr = travelState.isTraveling && travelState.jamaDhuhrAsr && prayer.name === 'dhuhr';
      const isJamaMaghrib = travelState.isTraveling && travelState.jamaMaghribIsha && prayer.name === 'maghrib';

      if (isJamaDhuhr || isJamaMaghrib) {
        const pairName = isJamaDhuhr ? 'asr' : 'isha';
        const pairPrayer = sortedPrayers.find((p) => p.name === pairName);

        if (pairPrayer) {
          skip.add(pairName);
          const displayPrayer = (jumuahEnabled && khutbahTime && prayer.name === 'dhuhr')
            ? { ...prayer, label: 'Jumuah', time: khutbahTime }
            : prayer;
          const startFmt = formatTime(displayPrayer.time);
          const endFmt = formatTime(pairPrayer.time);
          const startParts = startFmt.match(/(\d+:\d+)\s*(AM|PM)/i);
          const endParts = endFmt.match(/(\d+:\d+)\s*(AM|PM)/i);
          const isEitherHighlighted = prayer.name === highlightedPrayer || pairPrayer.name === highlightedPrayer;
          const highlightKey = prayer.name === highlightedPrayer ? prayer.name : pairPrayer.name;

          rendered.push(
            <IslamicJamaRow
              key={`jama-${prayer.name}`}
              prayer={displayPrayer}
              pairPrayer={pairPrayer}
              isHighlighted={isEitherHighlighted}
              highlightKey={highlightKey as AllPrayerNames}
              trackingStatus1={trackingStatus[prayer.name] || 'untracked'}
              trackingStatus2={trackingStatus[pairPrayer.name] || 'untracked'}
              onTrack={async (status) => {
                // Sequential: each trackPrayer is load→mutate→save, so parallel
                // calls read the same snapshot and one write overwrites the other.
                // Caught per write: onTrack is a void prop nobody awaits, so a
                // rejection would both skip the pair and surface unhandled.
                await trackBoth(prayer.name as PrayerName, pairPrayer.name as PrayerName, status);
              }}
              travelState={travelState}
              startParts={startParts}
              startFmt={startFmt}
              endParts={endParts}
              endFmt={endFmt}
            />
          );
          continue;
        }
      }

      if (jumuahEnabled && khutbahTime && prayer.name === 'dhuhr') {
        const jumuahPrayer: PrayerTime = { ...prayer, label: 'Jumuah', time: khutbahTime };

        rendered.push(
          <IslamicPrayerRow
            key={prayer.name}
            prayer={jumuahPrayer}
            isHighlighted={prayer.name === highlightedPrayer}
            isSelected={prayer.name === selectedPrayer}
            trackingStatus={trackingStatus[prayer.name] || 'untracked'}
            onTap={() => handleRowTap(prayer.name)}
            onTrack={(status) => handleTrack(prayer.name as PrayerName, status)}
            travelState={travelState}
            sunnahPrayers={sunnahPrayers}
          />
        );
        continue;
      }

      rendered.push(
        <IslamicPrayerRow
          key={prayer.name}
          prayer={prayer}
          isHighlighted={prayer.name === highlightedPrayer}
          isSelected={prayer.name === selectedPrayer}
          trackingStatus={trackingStatus[prayer.name] || 'untracked'}
          onTap={() => handleRowTap(prayer.name)}
          onTrack={(status) => handleTrack(prayer.name as PrayerName, status)}
          travelState={travelState}
          sunnahPrayers={sunnahPrayers}
        />
      );
    }

    return rendered;
  };

  return (
    <div className="relative pt-1 overflow-hidden">
      {/* Dome crown ornament */}
      <div className="flex justify-center pb-3 relative">
        <div className="flex items-center gap-2">
          <div className="w-10 h-px opacity-50" style={{ background: 'linear-gradient(to right, transparent, var(--color-primary))' }}/>
          <KhatamStar size={12} strokeWidth={1.4} opacity={0.85}/>
          <div className="w-10 h-px opacity-50" style={{ background: 'linear-gradient(to left, transparent, var(--color-primary))' }}/>
        </div>
      </div>

      {/* Prayer rows */}
      <div className="pb-2 flex flex-col gap-1.5">
        {renderPrayers()}
      </div>

      <style>{`
        @keyframes islamic-slide-down {
          from { opacity: 0; transform: translateY(-4px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
});

// ─── Jama Prayer Row ──────────────────────────────────────
interface IslamicJamaRowProps {
  prayer: PrayerTime;
  pairPrayer: PrayerTime;
  isHighlighted: boolean;
  highlightKey: AllPrayerNames;
  trackingStatus1: PrayerStatus;
  trackingStatus2: PrayerStatus;
  onTrack: (status: PrayerStatus) => void;
  travelState: TravelState;
  startParts: RegExpMatchArray | null;
  startFmt: string;
  endParts: RegExpMatchArray | null;
  endFmt: string;
}

function IslamicJamaRow({ prayer, pairPrayer, isHighlighted, highlightKey, trackingStatus1, trackingStatus2, onTrack, travelState, startParts, startFmt, endParts, endFmt }: IslamicJamaRowProps) {
  const [showTrackingPrompt, setShowTrackingPrompt] = useState(false);
  const isPassed = pairPrayer.time <= new Date();
  const sharesMeridiem = !!startParts && !!endParts && startParts[2].toUpperCase() === endParts[2].toUpperCase();
  const bothOnTime = trackingStatus1 === 'ontime' && trackingStatus2 === 'ontime';
  const anyMissed = trackingStatus1 === 'missed' || trackingStatus2 === 'missed';

  const [g1, g2, g3] = SKY_GRADIENTS[highlightKey] || ['transparent', 'transparent', 'transparent'];
  const gradientBg = `linear-gradient(100deg, ${g1} 0%, ${g2} 55%, ${g3} 100%)`;
  // The name rides the gradient's opening colour and the time its closing one,
  // and the daylight skies end near-white — so a single ink cannot serve both
  // ends of one row, let alone Fajr's night and Dhuhr's noon.
  const nameInk = readableInkOn(g1);
  const timeInk = readableInkOn(g3);

  const statusDotColor = bothOnTime ? '#7ec89b'
    : anyMissed ? 'rgba(220, 90, 70, 0.75)'
    : isHighlighted ? 'var(--color-text)'
    : isPassed ? 'color-mix(in srgb, var(--color-text) 25%, transparent)'
    : 'color-mix(in srgb, var(--color-text) 12%, transparent)';

  const handleTrackResponse = (status: PrayerStatus) => {
    onTrack(status);
    setShowTrackingPrompt(false);
  };

  return (
    <div className="relative">
      <button
        onClick={(e) => { e.stopPropagation(); if (isPassed) setShowTrackingPrompt(v => !v); }}
        disabled={!isPassed}
        className="w-full p-0 border-none bg-transparent text-left block"
        style={{ cursor: isPassed ? 'pointer' : 'default' }}
      >
        <div
          className="relative overflow-hidden rounded-[14px]"
          style={{
            background: isHighlighted ? gradientBg : 'transparent',
            border: isHighlighted ? '1px solid rgba(244, 232, 208, 0.25)' : '1px solid transparent',
            boxShadow: isHighlighted ? '0 6px 20px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.15)' : 'none',
          }}
        >
          {isHighlighted && (
            <div className="absolute inset-0 opacity-30" style={{ mixBlendMode: 'overlay' }}>
              <GirihBackground color="#ffffff" opacity={0.15} id={`row-jama-${prayer.name}`}/>
            </div>
          )}

          <div className="relative grid items-center py-3 px-4" style={{ gridTemplateColumns: '16px 1fr auto', columnGap: 12 }}>
            <div className="w-2 h-2 rounded-full justify-self-start" style={{
              background: statusDotColor,
            }}/>

            <div className="min-w-0 flex items-baseline gap-1.5 flex-wrap" style={{ whiteSpace: 'nowrap', overflow: 'hidden' }}>
              {/* One name and one badge for the pair — two of each overflowed
                  the row and orphaned the last badge onto its own line. */}
              <span className="text-[22px] leading-tight tracking-wide" style={{
                fontFamily: '"Cormorant Garamond", serif', fontWeight: 500,
                color: isHighlighted ? nameInk.strong : 'var(--color-text)',
                textShadow: isHighlighted ? nameInk.shadow : 'none',
                opacity: isPassed && !isHighlighted ? 0.55 : 1,
              }}>{prayer.label} + {pairPrayer.label}</span>
              <span className="text-xs font-medium px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-600 whitespace-nowrap">
                {rakatFor(prayer.name, travelState)} + {rakatFor(pairPrayer.name, travelState)} rak'ah
              </span>
            </div>

            <div className="whitespace-nowrap text-right" style={{
              fontFamily: '"JetBrains Mono", ui-monospace, monospace',
              fontSize: 13, fontWeight: 400, letterSpacing: 0.3,
              fontVariantNumeric: 'tabular-nums', minWidth: 62,
              color: isHighlighted ? timeInk.strong : 'var(--color-text)',
              opacity: isPassed && !isHighlighted ? 0.6 : isHighlighted ? 1 : 0.85,
              textShadow: isHighlighted ? timeInk.shadow : 'none',
            }}>
              {/* One meridiem for the pair — see PrayerTable's jama row. */}
              {startParts ? startParts[1] : startFmt}
              {!sharesMeridiem && (
                <span className="text-[10px] ml-0.5 uppercase">{startParts ? startParts[2] : ''}</span>
              )}
              <span className="mx-0.5 opacity-50">&ndash;</span>
              {endParts ? endParts[1] : endFmt}
              <span className="text-[10px] ml-0.5 uppercase">{endParts ? endParts[2] : ''}</span>
            </div>
          </div>
        </div>
      </button>

      {showTrackingPrompt && (
        <div
          className="rounded-xl flex items-center justify-between"
          style={{
            margin: '-2px 0 8px 0', padding: '10px 14px 12px',
            background: 'color-mix(in srgb, var(--color-primary) 7%, transparent)',
            border: '1px solid color-mix(in srgb, var(--color-primary) 20%, transparent)',
            animation: 'islamic-slide-down 0.22s ease-out',
          }}
        >
          <div className="text-xs tracking-wide cursor-pointer" style={{ fontFamily: 'Inter, system-ui', color: 'var(--color-muted)' }}
            onClick={(e) => { e.stopPropagation(); setShowTrackingPrompt(false); }}>
            Prayed on time?
          </div>
          <div className="flex gap-1.5">
            <button onClick={(e) => { e.stopPropagation(); handleTrackResponse('ontime'); }}
              className="w-[30px] h-[30px] rounded-lg flex items-center justify-center cursor-pointer"
              style={{ background: 'rgba(126, 200, 155, 0.15)', border: '1px solid rgba(126, 200, 155, 0.4)' }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M5 12l5 5 9-10" stroke="#7ec89b" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </button>
            <button onClick={(e) => { e.stopPropagation(); handleTrackResponse('missed'); }}
              className="w-[30px] h-[30px] rounded-lg flex items-center justify-center cursor-pointer"
              style={{ background: 'rgba(220, 90, 70, 0.12)', border: '1px solid rgba(220, 90, 70, 0.4)' }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none"><path d="M6 6l12 12M18 6L6 18" stroke="#dc5a46" strokeWidth="2.5" strokeLinecap="round"/></svg>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Single Prayer Row ────────────────────────────────────
interface IslamicPrayerRowProps {
  prayer: PrayerTime;
  isHighlighted: boolean;
  isSelected: boolean;
  trackingStatus: PrayerStatus;
  onTap: () => void;
  onTrack: (status: PrayerStatus) => void;
  travelState: TravelState;
  sunnahPrayers: Partial<Record<AllPrayerNames, string>>;
}

function IslamicPrayerRow({ prayer, isHighlighted, isSelected, trackingStatus, onTap, onTrack, travelState }: IslamicPrayerRowProps) {
  const [countdown, setCountdown] = useState<string>('');
  const [showTrackingPrompt, setShowTrackingPrompt] = useState(false);

  const formattedTime = formatTime(prayer.time);
  const timeParts = formattedTime.match(/(\d+:\d+)\s*(AM|PM)/i);
  const time = timeParts ? timeParts[1] : formattedTime;
  const period = timeParts ? timeParts[2] : '';

  const [g1, g2, g3] = SKY_GRADIENTS[prayer.name];
  const gradientBg = `linear-gradient(100deg, ${g1} 0%, ${g2} 55%, ${g3} 100%)`;
  // The name rides the gradient's opening colour and the time its closing one,
  // and the daylight skies end near-white — so a single ink cannot serve both
  // ends of one row, let alone Fajr's night and Dhuhr's noon.
  const nameInk = readableInkOn(g1);
  const timeInk = readableInkOn(g3);

  const isTrackable = TRACKABLE_PRAYERS.includes(prayer.name as PrayerName);
  const isPassed = prayer.time <= new Date();
  const showQasr = travelState.isTraveling && travelState.qasr[prayer.name as keyof typeof travelState.qasr];
  const arabic = ARABIC_NAMES[prayer.name];

  useEffect(() => {
    // Invalid Date where the prayer doesn't occur at this latitude: NaN fails
    // every comparison below, so the row would sit on "< 1 min" forever. The
    // time column already renders an em dash. See the PrayerTable equivalent.
    if (!isSelected || showTrackingPrompt || !isValidPrayerTime(prayer.time)) { setCountdown(''); return; }
    const updateCountdown = () => {
      if (prayer.time <= new Date()) { setCountdown('Passed'); return; }
      const { hours, minutes } = getTimeUntil(prayer.time);
      if (hours > 0) setCountdown(`${hours}h ${minutes}m left`);
      else if (minutes > 0) setCountdown(`${minutes} min left`);
      else setCountdown('< 1 min');
    };
    updateCountdown();
    const interval = setInterval(updateCountdown, 1000);
    return () => clearInterval(interval);
  }, [isSelected, prayer.time, showTrackingPrompt]);

  const handleTimeTap = (e: React.MouseEvent) => {
    e.stopPropagation();
    setShowTrackingPrompt(false);
    onTap();
  };

  const handleNameTap = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isPassed && isTrackable) setShowTrackingPrompt(true);
    else { setShowTrackingPrompt(false); onTap(); }
  };

  const handleTrackResponse = (status: PrayerStatus) => {
    onTrack(status);
    setShowTrackingPrompt(false);
  };

  const statusDotColor = trackingStatus === 'ontime' ? '#7ec89b'
    : trackingStatus === 'missed' ? 'rgba(220, 90, 70, 0.75)'
    : isHighlighted ? 'var(--color-text)'
    : isPassed ? 'color-mix(in srgb, var(--color-text) 25%, transparent)'
    : 'color-mix(in srgb, var(--color-text) 12%, transparent)';

  return (
    <div className="relative">
      <div
        className="relative overflow-hidden rounded-[14px]"
        style={{
          background: isHighlighted ? gradientBg : 'transparent',
          border: isHighlighted ? '1px solid rgba(244, 232, 208, 0.25)' : '1px solid transparent',
        }}
      >
        {isHighlighted && (
          <div className="absolute inset-0 opacity-30" style={{ mixBlendMode: 'overlay' }}>
            <GirihBackground color="#ffffff" opacity={0.15} id={`row-${prayer.name}`}/>
          </div>
        )}

        <div className="relative grid items-center py-3 px-4" style={{ gridTemplateColumns: '16px 1fr auto', columnGap: 12 }}>
          {/* Status dot */}
          <div className="w-2 h-2 rounded-full justify-self-start" style={{
            background: statusDotColor,
          }}/>

          {/* Prayer name + Arabic */}
          <div onClick={handleNameTap} className="min-w-0 flex items-baseline gap-2 cursor-pointer" style={{ whiteSpace: 'nowrap', overflow: 'hidden' }}>
            <span className="text-[22px] leading-tight tracking-wide" style={{
              fontFamily: '"Cormorant Garamond", serif', fontWeight: 500,
              color: isHighlighted ? nameInk.strong : 'var(--color-text)',
              textShadow: isHighlighted ? nameInk.shadow : 'none',
              opacity: isPassed && !isHighlighted ? 0.55 : 1,
            }}>
              {prayer.label}
            </span>
            {arabic && (
              <span className="text-[13px]" style={{
                fontFamily: '"Amiri", serif',
                color: isHighlighted ? nameInk.soft : 'var(--color-primary)',
                opacity: isHighlighted ? 0.9 : 0.55,
                textShadow: isHighlighted ? nameInk.shadow : 'none',
              }}>
                {arabic}
              </span>
            )}
            {showQasr && !showTrackingPrompt && (
              <span className="text-xs font-medium px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-600">2 rak'ah</span>
            )}
          </div>

          {/* Time / Countdown / Tracking */}
          <div onClick={handleTimeTap} className="cursor-pointer">
            {showTrackingPrompt ? (
              <div className="flex items-center gap-1.5" style={{ animation: 'islamic-slide-down 0.22s ease-out' }}>
                <span className="text-xs cursor-pointer" style={{ color: isHighlighted ? timeInk.soft : 'var(--color-text)' }}
                  onClick={(e) => { e.stopPropagation(); setShowTrackingPrompt(false); }}>
                  On time?
                </span>
                <button onClick={(e) => { e.stopPropagation(); handleTrackResponse('ontime'); }}
                  className="w-[30px] h-[30px] rounded-lg flex items-center justify-center cursor-pointer"
                  style={{ background: 'rgba(126, 200, 155, 0.15)', border: '1px solid rgba(126, 200, 155, 0.4)' }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M5 12l5 5 9-10" stroke="#7ec89b" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                </button>
                <button onClick={(e) => { e.stopPropagation(); handleTrackResponse('missed'); }}
                  className="w-[30px] h-[30px] rounded-lg flex items-center justify-center cursor-pointer"
                  style={{ background: 'rgba(220, 90, 70, 0.12)', border: '1px solid rgba(220, 90, 70, 0.4)' }}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none"><path d="M6 6l12 12M18 6L6 18" stroke="#dc5a46" strokeWidth="2.5" strokeLinecap="round"/></svg>
                </button>
              </div>
            ) : isSelected && countdown ? (
              <span className="text-[13px] font-medium" style={{
                fontFamily: '"JetBrains Mono", ui-monospace, monospace',
                color: isHighlighted ? timeInk.strong : countdown === 'Passed' ? '#e88a76' : 'var(--color-primary)',
                animation: 'islamic-slide-down 0.22s ease-out',
              }}>
                {countdown}
              </span>
            ) : (
              <div className="whitespace-nowrap text-right" style={{
                fontFamily: '"JetBrains Mono", ui-monospace, monospace',
                fontSize: 13, fontWeight: 400, letterSpacing: 0.3,
                fontVariantNumeric: 'tabular-nums', minWidth: 62,
                color: isHighlighted ? timeInk.strong : 'var(--color-text)',
                opacity: isPassed && !isHighlighted ? 0.6 : isHighlighted ? 1 : 0.85,
                textShadow: isHighlighted ? timeInk.shadow : 'none',
              }}>
                {time}<span className="text-[10px] ml-0.5 uppercase">{period}</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}