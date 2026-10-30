import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { root, pkg, requireWindows, outputDirectory, run } from './common.mjs';
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
  await run(process.execPath, [path.join(root, 'scripts/check.mjs')]);
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
      filter: source => path.basename(source) !== 'node_modules' || source === path.join(root, relative) });
  }
  await fs.copyFile(process.execPath, path.join(dest, 'node.exe'));
  await fs.cp(path.join(root, 'licenses'), path.join(out, 'licenses'), { recursive: true });
  await fs.cp(path.join(root, 'docs'), path.join(out, 'docs'), { recursive: true });
  for (const file of ['README.md', 'THIRD_PARTY_NOTICES.md', 'SECURITY.md']) await fs.copyFile(path.join(root, file), path.join(out, file));
  await fs.copyFile(path.join(root, 'LICENSE'), path.join(out, 'PROJECT-LICENSE.txt'));
  const releaseReadme = (await fs.readFile(path.join(out, 'README.md'), 'utf8')).replaceAll('](LICENSE)', '](PROJECT-LICENSE.txt)');
  await fs.writeFile(path.join(out, 'README.md'), releaseReadme);
  await fs.writeFile(path.join(out, 'build-info.json'), JSON.stringify({ version: pkg.version, platform: process.platform, arch: process.arch, node: process.versions.node, electron: actualElectron, source: 'recovered-distribution' }, null, 2) + '\n');
  const { checkPackage } = require(path.join(dest, 'runtime-utils.cjs'));
  checkPackage(dest);
  console.log('构建完成：' + out);
  return out;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  build().catch(error => { console.error(error.message); process.exitCode = 1; });
}
