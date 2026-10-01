import { Filesystem, Directory } from '@capacitor/filesystem';
import { CapacitorHttp } from '@capacitor/core';
import { AthanPlugin } from '../plugins/athanPlugin';
import type { AthanCatalogEntry, AthanFile } from '../types';

const ATHAN_SUBDIR = 'athans';

/**
 * CapacitorHttp does not throw on 4xx/5xx, so an error page arrives looking
 * exactly like a success. These reject the shapes a failed fetch actually
 * takes, without an allowlist strict enough to break a server that serves
 * audio as `application/octet-stream`.
 */
const NON_AUDIO_CONTENT = /text\/html|text\/plain|application\/json|application\/xml|xhtml/i;

// A real adhan is 150-250 KB, which is ~200-340K characters once base64'd.
// Anything this small is an error page or a truncated response, never audio.
const MIN_AUDIO_BASE64_LENGTH = 20_000;

function isOkStatus(status: number): boolean {
  return status >= 200 && status < 300;
}

/** Header lookup that survives either casing from the native HTTP stack. */
function headerValue(headers: unknown, name: string): string {
  if (!headers || typeof headers !== 'object') return '';
  const entry = Object.entries(headers as Record<string, unknown>).find(
    ([key]) => key.toLowerCase() === name.toLowerCase(),
  );
  return entry ? String(entry[1] ?? '') : '';
}

export class AthanDownloadError extends Error {
  readonly cause?: unknown;
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'AthanDownloadError';
    this.cause = cause;
  }
}

export async function fetchAthanCatalog(): Promise<AthanCatalogEntry[]> {
  const response = await CapacitorHttp.get({ url: 'https://www.assabile.com/adhan-call-prayer' });

  if (!isOkStatus(response.status)) {
    throw new AthanDownloadError(
      `Could not load the athan list (the server returned ${response.status}).`,
    );
  }

  const html = response.data as string;

  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const items = doc.querySelectorAll('#ul-play-list li');

  const entries: AthanCatalogEntry[] = [];

  items.forEach((li) => {
    const linkEl = li.querySelector('a.link-media');

    if (!linkEl) return;

    const href = linkEl.getAttribute('href') || '';
    const text = (linkEl.textContent || '').trim();
    // The length is on the link itself. The row's first span is the name
    // inside the link, which used to be read as the length, so every row
    // repeated its own name where "03:07" should have been.
    const duration = (linkEl.getAttribute('data-duration') || li.querySelector('.timer')?.textContent || '').trim();

    // Text format: "Muezzin Name - Title"
    const dashIndex = text.indexOf(' - ');
    const muezzinName = dashIndex >= 0 ? text.substring(0, dashIndex).trim() : text;
    const title = dashIndex >= 0 ? text.substring(dashIndex + 3).trim() : '';

    // Build absolute URL if relative
    const sourceUrl = href.startsWith('http')
      ? href
      : `https://www.assabile.com${href.startsWith('/') ? '' : '/'}${href}`;

    entries.push({ muezzinName, title, duration, sourceUrl });
  });

  // A 200 with nothing in it means the page structure changed, not that the
  // site has no adhans. Saying so beats rendering "No athans found" over a
  // scrape that silently stopped matching.
  if (entries.length === 0) {
    throw new AthanDownloadError(
      'The athan list came back empty — the site layout may have changed.',
    );
  }

  return entries;
}

export async function downloadAthan(entry: AthanCatalogEntry): Promise<AthanFile> {
  const id = crypto.randomUUID();
  const filename = `${id}.mp3`;

  // Download via native HTTP to avoid CORS, get base64 data
  let response: Awaited<ReturnType<typeof CapacitorHttp.get>>;
  try {
    response = await CapacitorHttp.get({
      url: entry.sourceUrl,
      responseType: 'blob',
    });
  } catch (err) {
    throw new AthanDownloadError(
      'Could not download athan sound. Please check your internet connection.',
      err,
    );
  }

  // Everything from here to the write is validation. CapacitorHttp resolves
  // happily on a 404, so without it an HTML error page gets base64-written as
  // `<uuid>.mp3`: the entry shows as Downloaded and is deduped by sourceUrl so
  // it can never be retried, preview fails silently, and selecting it builds a
  // channel whose sound file is a web page.
  if (!isOkStatus(response.status)) {
    throw new AthanDownloadError(
      `Could not download athan sound (the server returned ${response.status}).`,
    );
  }

  const contentType = headerValue(response.headers, 'Content-Type');
  if (NON_AUDIO_CONTENT.test(contentType)) {
    throw new AthanDownloadError(
      'The server sent a web page instead of audio. The download link may have moved.',
    );
  }

  const responseData = response.data as string;
  if (typeof responseData !== 'string' || responseData.length < MIN_AUDIO_BASE64_LENGTH) {
    throw new AthanDownloadError(
      'The download was empty or far too short to be an athan. Please try again.',
    );
  }

  // Ensure athans directory exists
  try {
    await Filesystem.mkdir({
      path: ATHAN_SUBDIR,
      directory: Directory.External,
      recursive: true,
    });
  } catch {
    // Directory may already exist
  }

  // Write the downloaded data
  try {
    await Filesystem.writeFile({
      path: `${ATHAN_SUBDIR}/${filename}`,
      data: responseData,
      directory: Directory.External,
    });
  } catch (err) {
    throw new AthanDownloadError(
      'Could not save athan sound. Your device may be out of storage.',
      err,
    );
  }

  return {
    id,
    muezzinName: entry.muezzinName,
    title: entry.title,
    filename,
    duration: entry.duration,
    sourceUrl: entry.sourceUrl,
    downloadedAt: new Date().toISOString(),
  };
}

export async function deleteAthanFile(filename: string): Promise<void> {
  await Filesystem.deleteFile({
    path: `${ATHAN_SUBDIR}/${filename}`,
    directory: Directory.External,
  });
}

export async function getAthanFilePath(filename: string): Promise<string> {
  const { path } = await AthanPlugin.getExternalFilesDir();
  return `${path}/${ATHAN_SUBDIR}/${filename}`;
}

export async function selectAthan(
  athanFile: AthanFile,
  currentChannelId: string | null,
  suffix: string, // 'main' or 'fajr'
): Promise<string> {
  const filePath = await getAthanFilePath(athanFile.filename);
  const channelId = `athan_${suffix}_${athanFile.id}`;
  const channelName = suffix === 'fajr'
    ? `Fajr Athan - ${athanFile.muezzinName}`
    : `Athan - ${athanFile.muezzinName}`;

  // Build the replacement BEFORE retiring the channel that currently works.
  // The old order deleted first, so any failure after that — a missing audio
  // file, or external storage unmounted so getExternalFilesDir() rejects — left
  // the caller holding the id of a channel that no longer existed. Android
  // silently drops notifications posted to a nonexistent channel, so every
  // prayer notification stopped with nothing in the UI to explain it, and
  // re-tapping could not recover because the stored id was only ever replaced
  // on success.
  await AthanPlugin.createAthanChannel({
    channelId,
    channelName,
    soundFilePath: filePath,
  });

  // Re-selecting the athan already in use recreates its own channel above, so
  // "old" and "new" are the same id — deleting it would undo the work just done.
  if (currentChannelId && currentChannelId !== channelId) {
    // A leftover channel is cosmetic; failing the selection over it is not.
    await AthanPlugin.deleteChannel({ channelId: currentChannelId }).catch(() => {});
  }

  return channelId;
}

export async function playAthanPreview(filename: string): Promise<void> {
  const filePath = await getAthanFilePath(filename);
  await AthanPlugin.playPreview({ filePath });
}

export async function stopAthanPreview(): Promise<void> {
  await AthanPlugin.stopPreview();
}