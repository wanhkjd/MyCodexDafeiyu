import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
export const artifactName = 'Codex-dafeiyu-v' + pkg.version + '-windows-x64';
if (!/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(pkg.version)) throw new Error('Invalid package version');
export function requireWindows() {
  if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('运行/打包仅支持 Windows x64；其他平台可运行 npm test。');
  if (process.versions.node !== '24.19.0') throw new Error('为保证运行时与许可证一致，请使用 Node.js 24.19.0（见 .nvmrc）。');
}
export async function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, windowsHide: true, stdio: 'inherit', ...options });
    child.once('error', reject);
    child.once('exit', (code, signal) => code === 0 ? resolve() : reject(new Error(command + ' exited: ' + (signal || code))));
  });
}
// Recursive removal is restricted to one verified generated artifact, never a caller-supplied path.
export async function outputDirectory(base) {
  if (!['.runtime', 'dist'].includes(base)) throw new Error('Invalid output base');
  const parent = path.join(root, base);
  await fs.mkdir(parent, { recursive: true });
  if ((await fs.realpath(parent)).toLowerCase() !== parent.toLowerCase()) throw new Error('Output directory must not be a symlink/junction');
  const target = path.join(parent, artifactName);
  if (path.dirname(target) !== parent) throw new Error('Output escaped workspace');
  try {
    if ((await fs.realpath(target)).toLowerCase() !== target.toLowerCase()) throw new Error('Output target must not be a symlink/junction');
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  return target;
}
