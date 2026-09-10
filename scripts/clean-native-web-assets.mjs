#!/usr/bin/env node
/**
 * Empty the native projects' copy of the web build before Capacitor refills it.
 *
 * `cap sync` copies `dist/` into the native asset folders; it does not mirror
 * them. So anything that used to be in `public/` and is not any more just sits
 * there, and gets packed into the next AAB. This was found holding
 * earth-base-4k.jpg and earth-base-8k.jpg — five megabytes of imagery that had
 * been replaced by a single smaller file — which would have shipped.
 *
 * The folders are gitignored build output, so emptying them costs nothing: the
 * next `cap sync` rebuilds them from `dist/`.
 */

import { rmSync, existsSync } from 'fs';

const TARGETS = ['android/app/src/main/assets/public', 'ios/App/App/public'];

for (const dir of TARGETS) {
  if (!existsSync(dir)) continue;
  rmSync(dir, { recursive: true, force: true });
  console.log(`cleaned ${dir}`);
}
