import { calculatePrayerTimes } from '../services/prayerService';
import type { AllPrayerNames, PrayerTimesData } from '../types';

// Chicago area, the location from the original report (issue #48).
const CHICAGO = { latitude: 41.79, longitude: -88.32 };
const DAY = new Date(2026, 8, 21, 12, 0, 0); // local noon, 2026-09-21

const timeOf = (data: PrayerTimesData, name: AllPrayerNames): Date =>
  data.prayers.find((p) => p.name === name)!.time;

const at = (instant: Date) =>
  calculatePrayerTimes(CHICAGO, instant, 'NorthAmerica', 'Standard');

describe('User story: before dawn, the night rows describe the night I am in', () => {
  // Build the instants from the computed times rather than fixed clock
  // readings, so the test holds whatever timezone the suite runs in.
  const today = at(DAY);
  const fajr = timeOf(today, 'fajr');
  const localMidnight = new Date(DAY);
  localMidnight.setHours(0, 0, 0, 0);
  const beforeFajr = new Date((localMidnight.getTime() + fajr.getTime()) / 2);

  const yesterday = new Date(DAY);
  yesterday.setDate(yesterday.getDate() - 1);
  const lastNightMaghrib = timeOf(at(yesterday), 'maghrib');

  it('Last Third falls inside the night that ends at this morning’s Fajr', () => {
    const third = timeOf(at(beforeFajr), 'lastThirdOfNight');
    expect(third.getTime()).toBeGreaterThan(lastNightMaghrib.getTime());
    expect(third.getTime()).toBeLessThan(fajr.getTime());
  });

  it('Middle of Night falls inside the night that ends at this morning’s Fajr', () => {
    const middle = timeOf(at(beforeFajr), 'middleOfNight');
    expect(middle.getTime()).toBeGreaterThan(lastNightMaghrib.getTime());
    expect(middle.getTime()).toBeLessThan(fajr.getTime());
  });

  it('the sunnahTimes summary agrees with the rows', () => {
    const data = at(beforeFajr);
    expect(data.sunnahTimes!.lastThirdOfTheNight.getTime()).toBe(timeOf(data, 'lastThirdOfNight').getTime());
    expect(data.sunnahTimes!.middleOfTheNight.getTime()).toBe(timeOf(data, 'middleOfNight').getTime());
  });

  it('after Fajr, the night rows move on to tonight', () => {
    const afterFajr = new Date(fajr.getTime() + 60_000);
    const maghribToday = timeOf(today, 'maghrib');
    const data = at(afterFajr);
    expect(timeOf(data, 'middleOfNight').getTime()).toBeGreaterThan(maghribToday.getTime());
    expect(timeOf(data, 'lastThirdOfNight').getTime()).toBeGreaterThan(maghribToday.getTime());
  });
});
