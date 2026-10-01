import { describe, it, expect, vi } from 'vitest';

/**
 * fetchAthanCatalog scrapes Assabile's adhan page. These rows are trimmed from
 * the live markup (2026-10-01): one with a muezzin and a title, one Fajr adhan
 * with no muezzin given.
 */
const PAGE = vi.hoisted(() => `
<ul id="ul-play-list">
  <li class="bulle-top adane">
    <div class="name">
      <a rel="nofollow" class="link-media never" href="https://media.assabile.com/assabile/adhan_3435370/ddb21f7363eb.mp3" data-rbug="132" data-duration="03:07">
        <span class="sorting">Mishary Rashid Alafasy - Adhan Al Fajr Al Kuwait</span>
      </a>
    </div>
    <div class="timer">03:07</div>
  </li>
  <li class="bulle-top adane">
    <div class="name">
      <a rel="nofollow" class="link-media never" href="https://media.assabile.com/assabile/adhan_3435370/bb596a0f509b.mp3" data-rbug="259" data-duration="03:10">
        <span class="sorting">Adhan Al Fajr, Umm Al Quwain</span>
      </a>
    </div>
    <div class="timer">03:10</div>
  </li>
</ul>`);

vi.mock('@capacitor/core', () => ({
  CapacitorHttp: { get: vi.fn().mockResolvedValue({ status: 200, data: PAGE }) },
  registerPlugin: () => ({}),
}));
vi.mock('@capacitor/filesystem', () => ({ Filesystem: {}, Directory: {} }));
vi.mock('../plugins/athanPlugin', () => ({ AthanPlugin: {} }));

import { fetchAthanCatalog } from '../services/athanService';

describe('reading the Assabile adhan list', () => {
  it('takes the length from the link, not the name a second time', async () => {
    const entries = await fetchAthanCatalog();
    expect(entries).toEqual([
      {
        muezzinName: 'Mishary Rashid Alafasy',
        title: 'Adhan Al Fajr Al Kuwait',
        duration: '03:07',
        sourceUrl: 'https://media.assabile.com/assabile/adhan_3435370/ddb21f7363eb.mp3',
      },
      {
        muezzinName: 'Adhan Al Fajr, Umm Al Quwain',
        title: '',
        duration: '03:10',
        sourceUrl: 'https://media.assabile.com/assabile/adhan_3435370/bb596a0f509b.mp3',
      },
    ]);
  });
});
