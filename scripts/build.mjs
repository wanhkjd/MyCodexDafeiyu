import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { root, pkg, requireWindows, outputDirectory, run } from './common.mjs';
import { checkBundledBailong } from './check-bailong.mjs';
const require = createRequire(import.meta.url);
export async function build(base = '.runtime') {
  requireWindows();
  const installedElectron = JSON.parse(await fs.readFile(path.join(root, 'node_modules/electron/package.json'), 'utf8'));
  if (installedElectron.version !== pkg.devDependencies.electron) throw new Error('Electron 版本不符，请先 npm ci。');
  const electronDist = path.join(root, 'node_modules/electron/dist');
  try { await fs.access(path.join(electronDist, 'electron.exe')); }
  catch { await run(process.execPath, [path.join(root, 'node_modules/electron/install.js')]); }
  const actualElectron = (await fs.readFile(path.join(electronDist, 'version'), 'utf8')).trim();
  if (actualElectron !== pkg.devDependencies.electron) throw new Error('Electron 二进制版本不符，请重新 npm ci。');
  const integrity = JSON.parse(await fs.readFile(path.join(root, 'scripts/vendor-integrity.json'), 'utf8'));
  for (const [name, hash] of Object.entries(integrity)) {
    if (createHash('sha256').update(await fs.readFile(path.join(root, name))).digest('hex') !== hash) throw new Error(name + ': vendored binary checksum mismatch');
  }
  const out = await outputDirectory(base);
  await fs.rm(out, { recursive: true, force: true });
  await fs.cp(electronDist, out, { recursive: true });
  await fs.rename(path.join(out, 'electron.exe'), path.join(out, 'Codex-dafeiyu.exe'));
  const dest = path.join(out, 'resources/app');
  await fs.cp(path.join(root, 'app'), dest, { recursive: true });
  // Copy only lockfile production dependencies; Electron is already the outer runtime.
  const lock = JSON.parse(await fs.readFile(path.join(root, 'package-lock.json'), 'utf8'));
  for (const [relative, entry] of Object.entries(lock.packages)) {
    if (!relative || entry.dev || entry.link) continue;
    if (!relative.startsWith('node_modules/') || relative.split('/').includes('..')) throw new Error('Invalid dependency path');
    await fs.cp(path.join(root, relative), path.join(dest, relative), { recursive: true,
      filter: source => {
        const name = path.basename(source);
        if (/^(?:test|tests|__tests__|coverage)$/i.test(name) || /\.(?:test|spec)(?:-d)?\.[cm]?[jt]sx?$/i.test(name)) return false;
        return name !== 'node_modules' || source === path.join(root, relative);
      } });
  }
  await fs.copyFile(process.execPath, path.join(dest, 'node.exe'));
  await fs.cp(path.join(root, 'licenses'), path.join(out, 'licenses'), { recursive: true });
  await fs.copyFile(path.join(root, 'THIRD_PARTY_NOTICES.md'), path.join(out, 'THIRD_PARTY_NOTICES.md'));
  await fs.copyFile(path.join(root, 'LICENSE'), path.join(out, 'PROJECT-LICENSE.txt'));
  await fs.writeFile(path.join(out, 'build-info.json'), JSON.stringify({ version: pkg.version, platform: process.platform, arch: process.arch, node: process.versions.node, electron: actualElectron, source: 'recovered-distribution' }, null, 2) + '\n');
  const { checkPackage } = require(path.join(dest, 'runtime-utils.cjs'));
  checkPackage(dest);
  await checkBundledBailong(dest);
  console.log('构建完成：' + out);
  return out;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  build().catch(error => { console.error(error.message); process.exitCode = 1; });
}
