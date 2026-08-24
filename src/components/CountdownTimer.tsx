import { useState, useEffect } from 'react';
import type { PrayerName, TravelState, DisplaySettings } from '../types';

interface CountdownTimerProps {
  currentPrayer: PrayerName | null;
  currentPrayerTime: Date | null;
  nextPrayer: string | null;
  nextPrayerTime: Date | null;
  hours: number;
  minutes: number;
  seconds: number;
  isTraveling?: boolean;
  travelState?: TravelState;
  display: DisplaySettings;
  /** Boxless style for the Home Globe view: no card chrome, text floats with a drop shadow. */
  glow?: boolean;
}

// Sunnah prayers associated with each fard prayer
const SUNNAH_PRAYERS: Record<PrayerName, { before?: string; after?: string; notes?: string }> = {
  fajr: { before: '2 rak\'at Sunnah' },
  sunrise: {},
  dhuhr: { before: '4 rak\'at Sunnah', after: '2 rak\'at Sunnah' },
  asr: { before: '4 rak\'at (optional)' },
  maghrib: { after: '2 rak\'at Sunnah' },
  isha: { after: '2 rak\'at Sunnah + Witr', notes: 'Tahajjud available until Fajr' },
};

// When traveling, drop most rawatib — keep Fajr sunnah + Witr
const SUNNAH_PRAYERS_TRAVEL: Record<PrayerName, { before?: string; after?: string; notes?: string }> = {
  fajr: { before: '2 rak\'at Sunnah' },
  sunrise: {},
  dhuhr: {},
  asr: {},
  maghrib: {},
  isha: { after: 'Witr' },
};

const GLOW_TEXT_SHADOW = '0 2px 20px rgba(0,0,0,0.75), 0 1px 3px rgba(0,0,0,0.9)';
const GLOW_TEXT = 'rgba(245,246,248,0.96)';
const GLOW_MUTED = 'rgba(245,246,248,0.6)';
const GLOW_URGENT = '#ff8a75';

export function CountdownTimer({ currentPrayer, currentPrayerTime, nextPrayer, nextPrayerTime, hours, minutes, seconds, isTraveling = false, travelState, display, glow = false }: CountdownTimerProps) {
  const formatNumber = (n: number) => n.toString().padStart(2, '0');

  const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  const currentLabel = currentPrayer ? capitalize(currentPrayer) : null;

  // Compute next prayer label for Jama' travel mode
  let nextLabel = nextPrayer ? capitalize(nextPrayer) : null;
  if (travelState?.isTraveling && nextPrayer) {
    if (nextPrayer === 'dhuhr' && travelState.jamaDhuhrAsr) {
      nextLabel = 'Dhuhr + Asr';
    }
    if (nextPrayer === 'maghrib' && travelState.jamaMaghribIsha) {
      nextLabel = 'Maghrib + Isha';
    }
  }

  // Elapsed time since current prayer started + progress through prayer window
  const [elapsed, setElapsed] = useState({ h: 0, m: 0, s: 0 });
  const [progress, setProgress] = useState(0); // 0 to 1 representing how far through the prayer window
  useEffect(() => {
    if (!currentPrayer || !currentPrayerTime || !display.showCurrentPrayer) return;

    const update = () => {
      const now = new Date();
      const diff = Math.max(0, Math.floor((now.getTime() - currentPrayerTime.getTime()) / 1000));
      setElapsed({
        h: Math.floor(diff / 3600),
        m: Math.floor((diff % 3600) / 60),
        s: diff % 60,
      });

      // Compute progress through prayer window (0 at start, 1 at end)
      if (nextPrayerTime) {
        const totalDuration = nextPrayerTime.getTime() - currentPrayerTime.getTime();
        const elapsedDuration = now.getTime() - currentPrayerTime.getTime();
        setProgress(totalDuration > 0 ? Math.min(1, Math.max(0, elapsedDuration / totalDuration)) : 0);
      }
    };

    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [currentPrayer, currentPrayerTime, nextPrayerTime, display.showCurrentPrayer]);

  // Red urgency only kicks in past 60% of the prayer window
  const isUrgent = progress >= 0.6;
  // Border width scales from 1px to 2px only during urgent phase (card mode only)
  const borderWidth = isUrgent ? 1 + ((progress - 0.6) / 0.4) : 1;

  const sunnahSource = isTraveling ? SUNNAH_PRAYERS_TRAVEL : SUNNAH_PRAYERS;
  const sunnahInfo = currentPrayer ? sunnahSource[currentPrayer] : null;

  // Build list of prayable prayers
  const prayablePrayers: { name: string; type: 'fard' | 'sunnah' | 'nafl'; detail?: string }[] = [];

  if (currentPrayer && currentPrayer !== 'sunrise') {
    // Add sunnah before
    if (sunnahInfo?.before) {
      prayablePrayers.push({ name: `${currentLabel} Sunnah`, type: 'sunnah', detail: sunnahInfo.before });
    }
    // Add sunnah after
    if (sunnahInfo?.after) {
      prayablePrayers.push({ name: `${currentLabel} Sunnah`, type: 'sunnah', detail: sunnahInfo.after });
    }
  }

  // During sunrise, only Duha/Ishraq is available (after sun rises ~15min)
  if (currentPrayer === 'sunrise') {
    prayablePrayers.push({ name: 'Ishraq/Duha', type: 'nafl', detail: '2-8 rak\'at (after sunrise)' });
  }

  const naflPrayer = prayablePrayers.find(p => p.type === 'nafl');
  const regularPrayers = prayablePrayers.filter(p => p.type !== 'nafl');

  const cardClass = glow ? '' : 'bg-[var(--color-card)] rounded-lg p-3 border';
  const labelColor = glow ? GLOW_MUTED : 'var(--color-muted)';
  const textColor = glow ? GLOW_TEXT : 'var(--color-text)';
  const shadow = glow ? GLOW_TEXT_SHADOW : 'none';

  return (
    <div className="space-y-3">
      {/* Current Prayer Card */}
      {display.showCurrentPrayer && currentPrayer && currentPrayer !== 'sunrise' && (
        <div
          className={`${cardClass} relative z-[45] ${
            !glow && isUrgent ? 'border-red-500/50 current-prayer-glow' : !glow ? 'border-[var(--color-border)]' : ''
          }`}
          style={!glow && isUrgent ? { borderWidth: `${borderWidth}px` } : undefined}
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs uppercase tracking-wide mb-0.5" style={{ color: labelColor, textShadow: shadow }}>
                Current Prayer
              </p>
              <p className="text-lg font-semibold" style={{ color: textColor, textShadow: shadow }}>
                {currentLabel}
              </p>
            </div>
            {currentPrayerTime ? (
              <div className="flex items-baseline gap-0.5">
                <span className="text-2xl font-bold tabular-nums" style={{ color: glow && isUrgent ? GLOW_URGENT : textColor, textShadow: shadow }}>
                  {formatNumber(elapsed.h)}
                </span>
                <span className="text-lg" style={{ color: labelColor, textShadow: shadow }}>:</span>
                <span className="text-2xl font-bold tabular-nums" style={{ color: glow && isUrgent ? GLOW_URGENT : textColor, textShadow: shadow }}>
                  {formatNumber(elapsed.m)}
                </span>
                <span className="text-lg" style={{ color: labelColor, textShadow: shadow }}>:</span>
                <span className="text-2xl font-bold tabular-nums" style={{ color: labelColor, textShadow: shadow }}>
                  {formatNumber(elapsed.s)}
                </span>
                <span className="text-xs ml-1 self-center" style={{ color: labelColor, textShadow: shadow }}>ago</span>
              </div>
            ) : (
              <span className="text-sm font-medium text-[var(--color-primary)]">Active</span>
            )}
          </div>
        </div>
      )}

      {/* Sunnah Prayers Card */}
      {display.showSunnahCard && regularPrayers.length > 0 && (
        <div className={`${cardClass} ${glow ? '' : 'border-[var(--color-border)]'}`}>
          <div className="space-y-1.5">
            {regularPrayers.map((prayer, idx) => (
              <div key={idx} className="flex items-center justify-between">
                <span className={`text-sm ${prayer.type === 'fard' ? 'font-semibold' : ''}`} style={{ color: prayer.type === 'fard' ? textColor : labelColor, textShadow: shadow }}>
                  {prayer.name}
                </span>
                {prayer.detail && (
                  <span className="text-xs" style={{ color: labelColor, textShadow: shadow }}>{prayer.detail}</span>
                )}
              </div>
            ))}
          </div>
          {sunnahInfo?.notes && (
            <p className="text-xs mt-2 italic" style={{ color: labelColor, textShadow: shadow }}>{sunnahInfo.notes}</p>
          )}
        </div>
      )}

      {/* Next Prayer Countdown Card */}
      {display.showNextPrayer && nextPrayer && (
        <div className={`${cardClass} ${glow ? '' : 'border-[var(--color-border)]'}`}>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs uppercase tracking-wide mb-0.5" style={{ color: labelColor, textShadow: shadow }}>
                Next Prayer
              </p>
              <p className="text-lg font-semibold" style={{ color: textColor, textShadow: shadow }}>
                {nextLabel}
              </p>
            </div>
            <div className="flex items-baseline gap-0.5">
              <span className="text-2xl font-bold tabular-nums" style={{ color: textColor, textShadow: shadow }}>
                {formatNumber(hours)}
              </span>
              <span className="text-lg" style={{ color: labelColor, textShadow: shadow }}>:</span>
              <span className="text-2xl font-bold tabular-nums" style={{ color: textColor, textShadow: shadow }}>
                {formatNumber(minutes)}
              </span>
              <span className="text-lg" style={{ color: labelColor, textShadow: shadow }}>:</span>
              <span className="text-2xl font-bold tabular-nums text-[var(--color-primary)]" style={{ textShadow: shadow }}>
                {formatNumber(seconds)}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Ishraq/Duha Card */}
      {display.showSunnahCard && naflPrayer && (
        <div className={`${cardClass} ${glow ? '' : 'border-[var(--color-border)]'}`}>
          <p className="text-xs uppercase tracking-wide mb-2" style={{ color: labelColor, textShadow: shadow }}>
            Optional Prayer
          </p>
          <div className="flex items-center justify-between">
            <p className="text-lg font-semibold" style={{ color: textColor, textShadow: shadow }}>
              {naflPrayer.name}
            </p>
            <p className="text-sm" style={{ color: labelColor, textShadow: shadow }}>
              {naflPrayer.detail}
            </p>
          </div>
        </div>
      )}

      {/* If no next prayer and no prayable prayers, show current time label */}
      {!nextPrayer && prayablePrayers.length === 0 && currentPrayer && (
        <div className={`${cardClass} ${glow ? '' : 'border-[var(--color-border)]'} text-center`}>
          <p className="text-sm" style={{ color: labelColor, textShadow: shadow }}>
            {currentLabel} time
          </p>
        </div>
      )}

      <style>{`
        @keyframes prayer-glow {
          0%, 100% { box-shadow: 0 0 8px rgba(239, 68, 68, 0.15), 0 0 20px rgba(239, 68, 68, 0.08); }
          50% { box-shadow: 0 0 14px rgba(239, 68, 68, 0.3), 0 0 32px rgba(239, 68, 68, 0.12); }
        }
        .current-prayer-glow {
          animation: prayer-glow 3s ease-in-out infinite;
        }
      `}</style>
    </div>
  );
}
