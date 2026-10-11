import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const packageName = 'scanline-virtual-screen';
const readJSON = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url)));
const lockfile = readJSON('../package-lock.json');
const lockEntry = lockfile.packages?.[`node_modules/${packageName}`];
const requiredVersion = lockEntry?.version;
const requiredCommit = lockEntry?.resolved?.match(/#([0-9a-f]+)$/i)?.[1];
const installedVersion = (() => {
  try { return readJSON(`../node_modules/${packageName}/package.json`).version; } catch { return undefined; }
})();
const installedCommit = (() => {
  try {
    const marker = readFileSync(new URL('../node_modules/.scanline-virtual-screen-commit', import.meta.url), 'utf8').trim();
    if (marker) return marker;
  } catch { /* npm ci does not create the marker; inspect its hidden lockfile below. */ }
  try { return readJSON('../node_modules/.package-lock.json').packages?.[`node_modules/${packageName}`]?.resolved?.match(/#([0-9a-f]+)$/i)?.[1]; } catch { return undefined; }
})();

if (!requiredVersion || !requiredCommit) throw new Error(`Could not read the pinned ${packageName} version and commit from package-lock.json.`);

if (installedVersion !== requiredVersion || installedCommit !== requiredCommit) {
  const dependency = readJSON('../package.json').dependencies?.[packageName];
  const npm = process.platform === 'win32' ? process.env.ComSpec ?? 'cmd.exe' : 'npm';
  const run = (args) => execFileSync(npm, process.platform === 'win32' ? ['/d', '/s', '/c', 'npm.cmd', ...args] : args, { stdio: 'inherit' });
  console.log(`Updating SVS ${installedVersion ?? 'missing'}@${installedCommit ?? 'unknown'} → ${requiredVersion}@${requiredCommit}...`);
  const [source] = dependency.split('#');
  const updateRoot = mkdtempSync(join(tmpdir(), 'svs-update-'));
  const checkout = join(updateRoot, 'checkout');
  const artifactDir = join(updateRoot, 'artifact');
  mkdirSync(artifactDir);
  try {
    execFileSync('git', ['clone', '--quiet', '--no-checkout', source.replace('github:', 'https://github.com/').concat('.git'), checkout], { stdio: 'inherit' });
    execFileSync('git', ['-C', checkout, 'fetch', '--quiet', 'origin', requiredCommit], { stdio: 'inherit' });
    execFileSync('git', ['-C', checkout, 'checkout', '--quiet', '--detach', 'FETCH_HEAD'], { stdio: 'inherit' });
    const checkoutCommit = execFileSync('git', ['-C', checkout, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    if (checkoutCommit !== requiredCommit) throw new Error('SVS checkout did not match package-lock.json.');
    run(['pack', '--ignore-scripts', '--pack-destination', artifactDir, checkout]);
    const artifact = readdirSync(artifactDir).find((name) => name.endsWith('.tgz'));
    if (!artifact) throw new Error('SVS pack did not produce an artifact.');
    run(['install', '--no-save', '--ignore-scripts', '--no-audit', '--no-fund', join(artifactDir, artifact)]);
    writeFileSync(new URL('../node_modules/.scanline-virtual-screen-commit', import.meta.url), `${requiredCommit}\n`);
  } finally {
    rmSync(updateRoot, { recursive: true, force: true });
  }
  if (readJSON(`../node_modules/${packageName}/package.json`).version !== requiredVersion || readFileSync(new URL('../node_modules/.scanline-virtual-screen-commit', import.meta.url), 'utf8').trim() !== requiredCommit) {
    throw new Error('SVS update did not match package-lock.json.');
  }
}
