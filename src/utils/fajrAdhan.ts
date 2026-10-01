/**
 * Whether an athan in the Assabile catalog is a Fajr adhan: the one with
 * "as-salatu khayrun minan-nawm" in it. Assabile names these in the title
 * ("Mishary Rashid Alafasy - Adhan Al Fajr Al Kuwait") or, for recordings with
 * no muezzin given, in the whole line ("Adhan Al Fajr, Umm Al Quwain"), which
 * the catalog parser puts in the muezzin field.
 */
export function isFajrAdhan(entry: { muezzinName: string; title: string }): boolean {
  return /\bfajr\b/i.test(`${entry.muezzinName} ${entry.title}`);
}
