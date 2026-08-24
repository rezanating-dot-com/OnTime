import { useState, useEffect } from 'react';
import type { PrayerName, TravelState, DisplaySettings } from '../types';
import { GirihBackground, CornerOrnament, CrescentStar } from './IslamicPatterns';

interface IslamicCountdownTimerProps {
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

const ARABIC_NAMES: Record<string, string> = {
  fajr: '\u0627\u0644\u0641\u062C\u0631',
  dhuhr: '\u0627\u0644\u0638\u0647\u0631',
  asr: '\u0627\u0644\u0639\u0635\u0631',
  maghrib: '\u0627\u0644\u0645\u063A\u0631\u0628',
  isha: '\u0627\u0644\u0639\u0634\u0627\u0621',
};

const SUNNAH_COUNTS: Record<PrayerName, { before: number; after: number }> = {
  fajr: { before: 2, after: 2 },
  sunrise: { before: 0, after: 0 },
  dhuhr: { before: 4, after: 2 },
  asr: { before: 4, after: 0 },
  maghrib: { before: 0, after: 2 },
  isha: { before: 4, after: 2 },
};

const SUNNAH_COUNTS_TRAVEL: Record<PrayerName, { before: number; after: number }> = {
  fajr: { before: 2, after: 0 },
  sunrise: { before: 0, after: 0 },
  dhuhr: { before: 0, after: 0 },
  asr: { before: 0, after: 0 },
  maghrib: { before: 0, after: 0 },
  isha: { before: 0, after: 0 },
};

export function IslamicCountdownTimer({ currentPrayer, currentPrayerTime, nextPrayer, nextPrayerTime, hours, minutes, seconds, isTraveling = false, travelState, display, glow = false }: IslamicCountdownTimerProps) {
  const formatNumber = (n: number) => n.toString().padStart(2, '0');
  const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  const currentLabel = currentPrayer ? capitalize(currentPrayer) : null;

  let nextLabel = nextPrayer ? capitalize(nextPrayer) : null;
  if (travelState?.isTraveling && nextPrayer) {
    if (nextPrayer === 'dhuhr' && travelState.jamaDhuhrAsr) nextLabel = 'Dhuhr + Asr';
    if (nextPrayer === 'maghrib' && travelState.jamaMaghribIsha) nextLabel = 'Maghrib + Isha';
  }

  const [elapsed, setElapsed] = useState({ h: 0, m: 0, s: 0 });
  const [progress, setProgress] = useState(0);
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

  const isUrgent = progress >= 0.6;
  const sunnahSource = isTraveling ? SUNNAH_COUNTS_TRAVEL : SUNNAH_COUNTS;
  const sunnah = currentPrayer ? sunnahSource[currentPrayer] : null;
  const currentArabic = currentPrayer ? ARABIC_NAMES[currentPrayer] : null;
  const nextArabic = nextPrayer ? ARABIC_NAMES[nextPrayer] : null;
  const isIshraqTime = currentPrayer === 'sunrise';
  const hasSunnah = display.showSunnahCard && sunnah && (sunnah.before > 0 || sunnah.after > 0) && currentPrayer !== 'sunrise';

  const showCurrentTier = display.showCurrentPrayer && currentPrayer && currentPrayer !== 'sunrise';
  const showNextTier = display.showNextPrayer && nextPrayer;

  const GLOW_TEXT_SHADOW = '0 2px 20px rgba(0,0,0,0.75), 0 1px 3px rgba(0,0,0,0.9)';
  const glowText = glow ? 'rgba(245,246,248,0.96)' : 'var(--color-text)';
  const glowMuted = glow ? 'rgba(245,246,248,0.6)' : 'var(--color-muted)';
  const glowShadow = glow ? GLOW_TEXT_SHADOW : 'none';

  return (
    <div className="space-y-3.5">
      {/* ─── Unified Two-Tier Card ─── */}
      {(showCurrentTier || showNextTier) && (
        <div
          className="relative rounded-[20px] overflow-hidden"
          style={glow ? undefined : {
            background: 'linear-gradient(135deg, color-mix(in srgb, var(--color-primary) 12%, transparent), color-mix(in srgb, var(--color-background) 70%, transparent))',
            border: `1px solid ${isUrgent && showCurrentTier ? 'rgba(220, 90, 70, 0.45)' : 'color-mix(in srgb, var(--color-primary) 28%, transparent)'}`,
            boxShadow: isUrgent && showCurrentTier
              ? '0 0 0 1px rgba(220, 90, 70, 0.2)'
              : 'none',
          }}
        >
          {/* Girih pattern background (card mode only — reads as noise floating over the globe) */}
          {!glow && (
            <div className="absolute inset-0 opacity-35">
              <GirihBackground opacity={0.08} id="current-bg"/>
            </div>
          )}

          {/* Corner ornaments (card mode only) */}
          {!glow && (
            <>
              <div className="absolute top-2.5 left-2.5"><CornerOrnament rotate={0}/></div>
              <div className="absolute top-2.5 right-2.5"><CornerOrnament rotate={90}/></div>
              <div className="absolute bottom-2.5 left-2.5"><CornerOrnament rotate={270}/></div>
              <div className="absolute bottom-2.5 right-2.5"><CornerOrnament rotate={180}/></div>
            </>
          )}

          {/* ── Top tier: Current prayer (compact) ── */}
          {showCurrentTier && (
            <div className="relative" style={{ padding: '16px 22px 12px' }}>
              {/* Row 1: NOW label + name + Arabic + urgency badge */}
              <div className="flex justify-between items-center">
                <div className="flex items-baseline gap-2.5">
                  <div className="text-[11px] tracking-[2.5px] uppercase font-medium" style={{ fontFamily: 'Inter, system-ui', color: glowMuted, textShadow: glowShadow }}>
                    Now
                  </div>
                  <div className="text-2xl leading-none tracking-wide" style={{ fontFamily: '"Cormorant Garamond", serif', fontWeight: 500, color: glowText, textShadow: glowShadow }}>
                    {currentLabel}
                  </div>
                  {currentArabic && (
                    <div className="text-base leading-none opacity-70" style={{ fontFamily: '"Amiri", serif', color: 'var(--color-primary)', textShadow: glowShadow }}>
                      {currentArabic}
                    </div>
                  )}
                </div>
                {isUrgent && (
                  <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-[10px] shrink-0 ml-2"
                    style={glow ? { textShadow: glowShadow } : { background: 'rgba(220, 90, 70, 0.15)', border: '1px solid rgba(220, 90, 70, 0.35)' }}>
                    {!glow && <div className="w-1.5 h-1.5 rounded-full bg-[#dc5a46] islamic-pulse"/>}
                    <span className="text-[10px] font-semibold tracking-wide" style={{ fontFamily: 'Inter', color: glow ? '#ff8a75' : '#e88a76' }}>
                      ENDING SOON
                    </span>
                  </div>
                )}
              </div>

              {/* Row 2: Elapsed time + Sunnah info */}
              <div className="relative flex justify-between items-center mt-2">
                {currentPrayerTime ? (
                  <div className="flex items-baseline gap-1.5">
                    <div
                      className="leading-none"
                      style={{
                        fontFamily: '"JetBrains Mono", ui-monospace, monospace',
                        fontSize: 18, fontWeight: 500, letterSpacing: 0.5,
                        fontVariantNumeric: 'tabular-nums',
                        color: isUrgent ? (glow ? '#ff8a75' : '#e88a76') : glowText,
                        textShadow: glowShadow,
                      }}
                    >
                      {formatNumber(elapsed.h)}:{formatNumber(elapsed.m)}:{formatNumber(elapsed.s)}
                    </div>
                    <div className="text-[11px]" style={{ color: glowMuted, textShadow: glowShadow }}>ago</div>
                  </div>
                ) : (
                  <span className="text-sm font-medium" style={{ color: 'var(--color-primary)', textShadow: glowShadow }}>Active</span>
                )}

                {hasSunnah && (
                  <div className="flex items-center gap-1.5" style={{ fontSize: 11, color: glowMuted, textShadow: glowShadow }}>
                    {!glow && <CrescentStar size={12}/>}
                    {sunnah!.before > 0 && (
                      <span style={{ color: glowText }}>
                        <span className="text-sm font-semibold" style={{ fontFamily: '"Cormorant Garamond", serif' }}>{sunnah!.before}</span>
                        <span className="opacity-70 ml-1">before</span>
                      </span>
                    )}
                    {sunnah!.before > 0 && sunnah!.after > 0 && (
                      <span className="opacity-40">&middot;</span>
                    )}
                    {sunnah!.after > 0 && (
                      <span style={{ color: glowText }}>
                        <span className="text-sm font-semibold" style={{ fontFamily: '"Cormorant Garamond", serif' }}>{sunnah!.after}</span>
                        <span className="opacity-70 ml-1">after</span>
                      </span>
                    )}
                  </div>
                )}
              </div>

              {/* Progress bar (card mode only — a bare bar reads oddly floating on the globe) */}
              {!glow && (
                <div className="relative mt-2.5 h-[3px] rounded-sm" style={{ background: 'color-mix(in srgb, var(--color-text) 8%, transparent)' }}>
                  <div
                    className="absolute inset-0 rounded-sm transition-all duration-1000"
                    style={{
                      width: `${Math.min(100, progress * 100)}%`,
                      background: isUrgent
                        ? 'linear-gradient(90deg, var(--color-primary), #dc5a46)'
                        : 'linear-gradient(90deg, var(--color-primary), var(--color-text))',
                      boxShadow: isUrgent ? '0 0 10px rgba(220, 90, 70, 0.4)' : 'none',
                    }}
                  />
                </div>
              )}
            </div>
          )}

          {/* ── Separator ── */}
          {showCurrentTier && showNextTier && !glow && (
            <div className="relative h-px" style={{ background: 'linear-gradient(90deg, transparent, color-mix(in srgb, var(--color-primary) 25%, transparent), transparent)' }}/>
          )}

          {/* ── Bottom tier: Next prayer hero countdown ── */}
          {showNextTier && (
            <div className="relative text-center" style={{ padding: '14px 22px 18px' }}>
              <div className="text-[10px] tracking-[2.5px] uppercase font-medium mb-1.5" style={{ fontFamily: 'Inter, system-ui', color: glowMuted, textShadow: glowShadow }}>
                Next &middot; {nextLabel}
                {nextArabic && (
                  <span className="ml-1.5 opacity-60" style={{ fontFamily: '"Amiri", serif', fontSize: 13, color: 'var(--color-primary)', letterSpacing: 0 }}>
                    {nextArabic}
                  </span>
                )}
              </div>
              <div style={{
                fontFamily: '"JetBrains Mono", ui-monospace, monospace',
                fontSize: 44, letterSpacing: 2, fontWeight: 300,
                fontVariantNumeric: 'tabular-nums',
                color: glowText,
                textShadow: glowShadow,
                lineHeight: 1,
              }}>
                {formatNumber(hours)}:{formatNumber(minutes)}:{formatNumber(seconds)}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ─── Ishraq/Duha Card (standalone, only during sunrise) ─── */}
      {display.showSunnahCard && isIshraqTime && (
        <div
          className="rounded-[14px] p-3"
          style={glow ? undefined : {
            background: 'color-mix(in srgb, var(--color-primary) 4%, transparent)',
            border: '1px solid color-mix(in srgb, var(--color-primary) 12%, transparent)',
          }}
        >
          <p className="text-xs uppercase tracking-wide mb-2" style={{ fontFamily: 'Inter', color: glowMuted, textShadow: glowShadow }}>
            Optional Prayer
          </p>
          <div className="flex items-center justify-between">
            <p className="text-lg" style={{ fontFamily: '"Cormorant Garamond", serif', fontWeight: 500, color: glowText, textShadow: glowShadow }}>
              Ishraq / Duha
            </p>
            <p className="text-sm" style={{ color: glowMuted, textShadow: glowShadow }}>
              2-8 rak'at (after sunrise)
            </p>
          </div>
        </div>
      )}

      {/* Fallback */}
      {!nextPrayer && !isIshraqTime && currentPrayer && !showCurrentTier && (
        <div className="rounded-[14px] p-3 text-center" style={glow ? undefined : {
          background: 'color-mix(in srgb, var(--color-primary) 4%, transparent)',
          border: '1px solid color-mix(in srgb, var(--color-primary) 12%, transparent)',
        }}>
          <p className="text-sm" style={{ color: glowMuted, textShadow: glowShadow }}>{currentLabel} time</p>
        </div>
      )}

      <style>{`
        @keyframes islamic-pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.4; transform: scale(1.3); }
        }
        .islamic-pulse { animation: islamic-pulse 1.2s ease-in-out infinite; }
      `}</style>
    </div>
  );
}
