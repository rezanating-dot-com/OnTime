import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import pkg from '../../package.json';

/**
 * User story: the version I quote in a review is the version I am running.
 *
 * The app takes what it shows on its About screen from package.json, and the
 * Play listing takes what it shows from android/app/build.gradle. Nothing
 * connects the two, so a release that bumps one and forgets the other ships an
 * app that disagrees with its own store page — and the person writing to say
 * "2.0.0 is broken" is describing a build that never existed under that name.
 *
 * This has already happened once in a smaller way: the About screen carried a
 * hand-written "1.0.0" for several releases. Reading both files and comparing
 * them is the only check that catches the next one, because a test that
 * hard-codes the number is the same mistake one file further along.
 */
describe('User story: one version, everywhere', () => {
  const gradle = readFileSync(
    join(__dirname, '..', '..', 'android', 'app', 'build.gradle'),
    'utf8',
  );

  it('gives Android the same versionName that package.json carries', () => {
    const name = gradle.match(/versionName\s+"([^"]+)"/)?.[1];
    expect(name).toBeDefined();
    expect(name).toBe(pkg.version);
  });

  it('gives Android a versionCode at all, since Play refuses a repeat', () => {
    const code = gradle.match(/versionCode\s+(\d+)/)?.[1];
    expect(code).toBeDefined();
    expect(Number(code)).toBeGreaterThan(0);
  });
});
