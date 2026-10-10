import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const packageName = 'scanline-virtual-screen';
const readJSON = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url)));
const requiredVersion = readJSON('../package-lock.json').packages?.[`node_modules/${packageName}`]?.version;
const installedVersion = (() => {
  try { return readJSON(`../node_modules/${packageName}/package.json`).version; } catch { return undefined; }
})();

if (installedVersion !== requiredVersion) {
  const dependency = readJSON('../package.json').dependencies?.[packageName];
  const npm = process.platform === 'win32' ? process.env.ComSpec ?? 'cmd.exe' : 'npm';
  const run = (args) => execFileSync(npm, process.platform === 'win32' ? ['/d', '/s', '/c', 'npm.cmd', ...args] : args, { stdio: 'inherit' });
  console.log(`Updating SVS ${installedVersion ?? 'missing'} → ${requiredVersion}...`);
  const [source, ref] = dependency.split('#');
  const checkout = mkdtempSync(join(tmpdir(), 'svs-update-'));
  try {
    execFileSync('git', ['clone', '--quiet', source.replace('github:', 'https://github.com/').concat('.git'), checkout], { stdio: 'inherit' });
    execFileSync('git', ['-C', checkout, 'checkout', '--quiet', '--detach', ref], { stdio: 'inherit' });
    run(['install', '--no-save', '--ignore-scripts', '--no-audit', '--no-fund', checkout]);
  } finally {
    rmSync(checkout, { recursive: true, force: true });
  }
  if (readJSON(`../node_modules/${packageName}/package.json`).version !== requiredVersion) throw new Error('SVS update did not match package-lock.json.');
}
