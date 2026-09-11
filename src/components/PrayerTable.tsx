import React, { useState, useEffect } from 'react';
import { formatTime, getTimeUntil, isValidPrayerTime } from '../services/prayerService';
import { useSettings } from '../context/SettingsContext';
import { useTravel } from '../context/TravelContext';
import type { PrayerTime, PrayerName, AllPrayerNames, TravelState } from '../types';

interface PrayerTableProps {
  prayers: PrayerTime[];
  currentPrayer: PrayerName | null;
  nextPrayerTime: Date | null;
}

// Core 5 prayers (always shown)
const CORE_PRAYERS: PrayerName[] = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'];

// Stripe-style gradients matching sky colors for each prayer time
const PRAYER_GRADIENTS: Record<AllPrayerNames, string> = {
  fajr: 'linear-gradient(135deg, #1e1b4b 0%, #312e81 35%, #4c1d95 70%, #7c3aed 100%)',
  sunrise: 'linear-gradient(135deg, #fef3c7 0%, #fcd34d 50%, #f59e0b 100%)',
  dhuhr: 'linear-gradient(135deg, #0ea5e9 0%, #2563eb 40%, #7c3aed 100%)',
  asr: 'linear-gradient(135deg, #06b6d4 0%, #8b5cf6 50%, #ec4899 100%)',
  maghrib: 'linear-gradient(135deg, #f43f5e 0%, #f97316 40%, #fbbf24 100%)',
  isha: 'linear-gradient(135deg, #020617 0%, #1e1b4b 40%, #312e81 100%)',
  middleOfNight: 'linear-gradient(135deg, #0f172a 0%, #1e1b4b 50%, #312e81 100%)',
  lastThirdOfNight: 'linear-gradient(135deg, #020617 0%, #0f172a 40%, #1e1b4b 100%)',
  tahajjud: 'linear-gradient(135deg, #0f172a 0%, #1e1b4b 50%, #312e81 100%)',
};

// Sunnah Rawatib - the regular sunnah prayers before/after each fard prayer
// Based on authentic hadith (12 rak'ahs that build a house in Jannah)
const SUNNAH_PRAYERS_DEFAULT: Partial<Record<AllPrayerNames, string>> = {
  fajr: '2 before',
  dhuhr: '4 before · 2 after',
  asr: '4 before',
  maghrib: '2 after',
  isha: '2 after · Witr',
};

// When traveling, drop most sunnah (keep Fajr 2 before + Witr for Isha)
const SUNNAH_PRAYERS_TRAVEL: Partial<Record<AllPrayerNames, string>> = {
  fajr: '2 before',
  isha: 'Witr',
};

function getSunnahPrayers(isTraveling: boolean): Partial<Record<AllPrayerNames, string>> {
  return isTraveling ? SUNNAH_PRAYERS_TRAVEL : SUNNAH_PRAYERS_DEFAULT;
}

/** Rak'ah in this prayer right now: shortened while travelling, except Maghrib. */
function rakatFor(name: AllPrayerNames, travelState: TravelState): string {
  if (travelState.qasr[name as keyof typeof travelState.qasr]) return '2';
  return name === 'maghrib' ? '3' : '4';
}

export const PrayerTable = React.memo(function PrayerTable({ prayers, currentPrayer }: PrayerTableProps) {
  const { settings } = useSettings();
  const { travelState } = useTravel();
  const [selectedPrayer, setSelectedPrayer] = useState<AllPrayerNames | null>(null);
  const sunnahPrayers = getSunnahPrayers(travelState.isTraveling);
  const isFriday = new Date().getDay() === 5;
  const jumuahEnabled = isFriday && settings.jumuah.enabled && settings.jumuah.times.length > 0;
  // Today's khutbah as an instant. Both Friday branches below need it: the
  // Jama' one substituted only the *label*, keeping prayer.time, so a
  // travelling user on a Friday saw "Jumuah + Asr - 12:24" against a 13:00
  // khutbah, contradicting the same screen's non-travelling rendering.
  const khutbahTime = (() => {
    if (!jumuahEnabled) return null;
    const [hh, mm] = settings.jumuah.times[0].khutbah.split(':').map(Number);
    if (Number.isNaN(hh) || Number.isNaN(mm)) return null;
    const d = new Date();
    d.setHours(hh, mm, 0, 0);
    return d;
  })();

  // Filter prayers based on settings
  const displayPrayers = prayers.filter((p) => {
    if (CORE_PRAYERS.includes(p.name as PrayerName)) {
      return true;
    }
    if (p.name === 'sunrise') {
      return settings.optionalPrayers.showSunrise;
    }
    if (p.name === 'middleOfNight') {
      return settings.optionalPrayers.showMiddleOfNight;
    }
    if (p.name === 'lastThirdOfNight') {
      return settings.optionalPrayers.showLastThirdOfNight;
    }
    return false;
  });

  // Sort prayers by time
  const sortedPrayers = [...displayPrayers].sort((a, b) => a.time.getTime() - b.time.getTime());
  
  // Highlight the current prayer
  const highlightedPrayer = currentPrayer;

  const handleRowTap = (prayerName: AllPrayerNames) => {
    setSelectedPrayer(selectedPrayer === prayerName ? null : prayerName);
  };

  // Build grouped prayer list for Jama' display
  const renderPrayers = () => {
    const rendered: React.ReactNode[] = [];
    const skip = new Set<string>();

    for (let i = 0; i < sortedPrayers.length; i++) {
      const prayer = sortedPrayers[i];
      if (skip.has(prayer.name)) continue;

      // Check if this prayer starts a Jama' pair
      const isJamaDhuhr = travelState.isTraveling && travelState.jamaDhuhrAsr && prayer.name === 'dhuhr';
      const isJamaMaghrib = travelState.isTraveling && travelState.jamaMaghribIsha && prayer.name === 'maghrib';

      if (isJamaDhuhr || isJamaMaghrib) {
        const pairName = isJamaDhuhr ? 'asr' : 'isha';
        const pairPrayer = sortedPrayers.find((p) => p.name === pairName);

        if (pairPrayer) {
          skip.add(pairName);

          // On Friday with Jumuah, override the Dhuhr label in Jama' pair
          const displayPrayer = (jumuahEnabled && khutbahTime && prayer.name === 'dhuhr')
            ? { ...prayer, label: 'Jumuah', time: khutbahTime }
            : prayer;

          // Format combined time range
          const startFmt = formatTime(displayPrayer.time);
          const endFmt = formatTime(pairPrayer.time);
          const startParts = startFmt.match(/(\d+:\d+)\s*(AM|PM)/i);
          const endParts = endFmt.match(/(\d+:\d+)\s*(AM|PM)/i);

          // Use the gradient of whichever prayer in the pair is currently highlighted
          const isEitherHighlighted = prayer.name === highlightedPrayer || pairPrayer.name === highlightedPrayer;
          const highlightGradient = prayer.name === highlightedPrayer
            ? PRAYER_GRADIENTS[prayer.name]
            : pairPrayer.name === highlightedPrayer
              ? PRAYER_GRADIENTS[pairPrayer.name]
              : undefined;

          rendered.push(
            <JamaPrayerRow
              key={`jama-${prayer.name}`}
              prayer={displayPrayer}
              pairPrayer={pairPrayer}
              isHighlighted={isEitherHighlighted}
              highlightGradient={highlightGradient}
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

      // On Friday, replace Dhuhr with Jumuah row
      if (jumuahEnabled && khutbahTime && prayer.name === 'dhuhr') {
        const jumuahPrayer: PrayerTime = {
          ...prayer,
          label: 'Jumuah',
          time: khutbahTime,
        };

        rendered.push(
          <PrayerRow
            key={prayer.name}
            prayer={jumuahPrayer}
            isHighlighted={prayer.name === highlightedPrayer}
            isSelected={prayer.name === selectedPrayer}
            onTap={() => handleRowTap(prayer.name)}
            travelState={travelState}
            sunnahPrayers={sunnahPrayers}
          />
        );
        continue;
      }

      // Regular (ungrouped) prayer row
      rendered.push(
        <PrayerRow
          key={prayer.name}
          prayer={prayer}
          isHighlighted={prayer.name === highlightedPrayer}
          isSelected={prayer.name === selectedPrayer}
          onTap={() => handleRowTap(prayer.name)}
          travelState={travelState}
          sunnahPrayers={sunnahPrayers}
        />
      );
    }

    return rendered;
  };

  return (
    <div className={`bg-[var(--color-card)] p-3 border border-[var(--color-border)] ${travelState.isTraveling ? 'rounded-b-lg' : 'rounded-lg'}`}>
      {/* Prayer Rows */}
      <div className="flex flex-col gap-1.5">
        {renderPrayers()}
      </div>
    </div>
  );
});

interface JamaPrayerRowProps {
  prayer: PrayerTime;
  pairPrayer: PrayerTime;
  isHighlighted: boolean;
  highlightGradient: string | undefined;
  travelState: TravelState;
  startParts: RegExpMatchArray | null;
  startFmt: string;
  endParts: RegExpMatchArray | null;
  endFmt: string;
}

function JamaPrayerRow({ prayer, pairPrayer, isHighlighted, highlightGradient, travelState, startParts, startFmt, endParts, endFmt }: JamaPrayerRowProps) {
  // Render "1:53 — 5:29 PM" rather than printing PM twice: a jama pair almost
  // always shares a half of the day, and this row is tight enough that the
  // second meridiem pushed the rak'ah badge onto a line of its own.
  const sharesMeridiem = !!startParts && !!endParts && startParts[2].toUpperCase() === endParts[2].toUpperCase();

  return (
    <div
      className={`
        relative flex items-center justify-between px-3 py-3 rounded-lg transition-all duration-300
        ${isHighlighted ? 'scale-[1.02]' : ''}
      `}
      style={isHighlighted ? { background: highlightGradient } : undefined}
    >
      {isHighlighted && (
        <div
          className="absolute inset-0 rounded-lg opacity-20 pointer-events-none"
          style={{
            background: 'linear-gradient(135deg, rgba(255,255,255,0.4) 0%, transparent 50%, rgba(255,255,255,0.1) 100%)',
          }}
        />
      )}
      {/* Prayer names with rak'ah badges */}
      <div className="flex items-center gap-1.5 relative z-10 flex-wrap py-1 pr-2 -ml-1 pl-1">
        {/* One name and one badge for the pair. Two names each with their own
            rak'ah badge overflowed the row, orphaning the last badge onto a
            line of its own. */}
        <span className={`font-semibold text-xl ${isHighlighted ? 'text-white' : 'text-[var(--color-text)]'}`}>
          {prayer.label} + {pairPrayer.label}
        </span>
        <span className="text-xs font-medium px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-600 whitespace-nowrap">
          {rakatFor(prayer.name, travelState)} + {rakatFor(pairPrayer.name, travelState)} rak'ah
        </span>
      </div>
      {/* Time range */}
      <div className="relative z-10">
        <span className={`font-semibold text-xl whitespace-nowrap ${isHighlighted ? 'text-white/90' : 'text-[var(--color-muted)]'}`}>
          {startParts ? startParts[1] : startFmt}
          {!sharesMeridiem && (
            <span className={`text-sm ml-0.5 uppercase ${isHighlighted ? 'text-white/70' : ''}`}>{startParts ? startParts[2] : ''}</span>
          )}
          <span className={`text-sm mx-1 ${isHighlighted ? 'text-white/50' : 'text-[var(--color-muted)]'}`}>—</span>
          {endParts ? endParts[1] : endFmt}
          <span className={`text-sm ml-0.5 uppercase ${isHighlighted ? 'text-white/70' : ''}`}>{endParts ? endParts[2] : ''}</span>
        </span>
      </div>
    </div>
  );
}

interface PrayerRowProps {
  prayer: PrayerTime;
  isHighlighted: boolean;
  isSelected: boolean;
  onTap: () => void;
  travelState: TravelState;
  sunnahPrayers: Partial<Record<AllPrayerNames, string>>;
}

function PrayerRow({ prayer, isHighlighted, isSelected, onTap, travelState, sunnahPrayers }: PrayerRowProps) {
  const [countdown, setCountdown] = useState<string>('');

  const formattedTime = formatTime(prayer.time);
  const timeParts = formattedTime.match(/(\d+:\d+)\s*(AM|PM)/i);
  const time = timeParts ? timeParts[1] : formattedTime;
  const period = timeParts ? timeParts[2] : '';

  const gradient = PRAYER_GRADIENTS[prayer.name];

  // Travel mode badges
  const prayerKey = prayer.name as PrayerName;
  const showQasr = travelState.isTraveling && travelState.qasr[prayerKey as keyof typeof travelState.qasr];

  // Update countdown when selected
  useEffect(() => {
    // A prayer that doesn't occur at this latitude — midnight sun or polar
    // night — arrives as Invalid Date. Every comparison against NaN is false,
    // so it slips past `prayerTime <= now` and every branch below and lands on
    // "< 1 min", re-set every second forever. The time column already renders an
    // em dash for it, so there is nothing here to count down to.
    if (!isSelected || !isValidPrayerTime(prayer.time)) {
      setCountdown('');
      return;
    }

    const updateCountdown = () => {
      const now = new Date();
      const prayerTime = prayer.time;

      if (prayerTime <= now) {
        setCountdown('Passed');
        return;
      }

      const { hours, minutes } = getTimeUntil(prayerTime);
      
      if (hours > 0) {
        setCountdown(`${hours}h ${minutes}m left`);
      } else if (minutes > 0) {
        setCountdown(`${minutes} min left`);
      } else {
        setCountdown('< 1 min');
      }
    };

    updateCountdown();
    const interval = setInterval(updateCountdown, 1000);

    return () => clearInterval(interval);
  }, [isSelected, prayer.time]);

  // Either half of the row toggles the countdown. A passed row reads "Passed"
  // rather than going dead to the tap.
  const handleRowTap = (e: React.MouseEvent) => {
    e.stopPropagation();
    onTap();
  };

  return (
    <div
      className={`
        relative flex items-center justify-between px-3 py-3 rounded-lg transition-all duration-300
        ${isHighlighted ? 'scale-[1.02]' : ''}
      `}
      style={isHighlighted ? { background: gradient } : undefined}
    >
      {/* Subtle shine overlay for highlighted row */}
      {isHighlighted && (
        <div
          className="absolute inset-0 rounded-lg opacity-20 pointer-events-none"
          style={{
            background: 'linear-gradient(135deg, rgba(255,255,255,0.4) 0%, transparent 50%, rgba(255,255,255,0.1) 100%)',
          }}
        />
      )}

      {/* Prayer Name */}
      <div 
        onClick={handleRowTap}
        className={`
          flex items-center gap-2 relative z-10 cursor-pointer py-1 pr-2 -ml-1 pl-1 rounded-lg transition-colors
          ${!isHighlighted ? 'hover:bg-[var(--color-background)] active:scale-[0.98]' : 'hover:bg-white/10'}
        `}
      >
        <span
          className={`
            font-semibold text-xl
            ${isHighlighted ? 'text-white' : 'text-[var(--color-text)]'}
          `}
        >
          {prayer.label}
        </span>
        {sunnahPrayers[prayer.name] && (
          <span
            className={`
              text-sm
              ${isHighlighted ? 'text-white/50' : 'text-[var(--color-muted)]'}
            `}
          >
            {sunnahPrayers[prayer.name]}
          </span>
        )}
        {showQasr && (
          <span className="text-xs font-medium px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-600">
            2 rak'ah
          </span>
        )}
      </div>

      {/* Time / Countdown */}
      <div className="relative z-10">
        <div
          onClick={handleRowTap}
          className={`
            cursor-pointer py-1 px-2 -mr-1 rounded-lg transition-colors
            ${!isHighlighted ? 'hover:bg-[var(--color-background)] active:scale-[0.98]' : 'hover:bg-white/10'}
          `}
        >
          {isSelected && countdown ? (
            <span
              className={`
                text-base font-medium animate-fade-in
                ${isHighlighted ? 'text-white' : countdown === 'Passed' ? 'text-orange-500' : 'text-[var(--color-primary)]'}
              `}
            >
              {countdown}
            </span>
          ) : (
            <span
              className={`
                font-semibold text-xl whitespace-nowrap
                ${isHighlighted ? 'text-white/90' : 'text-[var(--color-muted)]'}
              `}
            >
              {time}
              <span className={`text-sm ml-0.5 uppercase ${isHighlighted ? 'text-white/70' : ''}`}>
                {period}
              </span>
            </span>
          )}
        </div>
      </div>

      <style>{`
        @keyframes fade-in {
          from { opacity: 0; transform: translateX(10px); }
          to { opacity: 1; transform: translateX(0); }
        }
        .animate-fade-in {
          animation: fade-in 0.2s ease-out;
        }
      `}</style>
    </div>
  );
}