import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { root, pkg, run } from './common.mjs';
const require = createRequire(import.meta.url);
const failures = [];
const files = [];
async function walk(relative) {
  for (const item of await fs.readdir(path.join(root, relative), { withFileTypes: true })) {
    const name = path.posix.join(relative, item.name);
    if (item.isSymbolicLink()) { failures.push(name + ': symlink is not allowed'); continue; }
    if (item.isDirectory()) {
      if (['node_modules', 'data', 'profile', '.git'].includes(item.name)) failures.push(name + ': generated/private directory in source');
      else await walk(name);
    } else files.push(name);
  }
}
for (const dir of ['app', 'scripts', 'tests', 'docs', 'licenses', '.github']) await walk(dir);
files.push('README.md', 'THIRD_PARTY_NOTICES.md', 'SECURITY.md', 'LICENSE', 'package.json', 'package-lock.json');
const integrity = JSON.parse(await fs.readFile(path.join(root, 'scripts/vendor-integrity.json'), 'utf8'));
for (const [name, hash] of Object.entries(integrity)) {
  if (createHash('sha256').update(await fs.readFile(path.join(root, name))).digest('hex') !== hash) failures.push(name + ': vendored binary checksum mismatch');
}
require(path.join(root, 'app/runtime-utils.cjs')).checkPackage(path.join(root, 'app'), { source: true });
for (const dep of ['qrcode/lib/core/qrcode.js', 'dijkstrajs', '@electron/get', '@electron-internal/extract-zip']) require.resolve(dep);
const lock = JSON.parse(await fs.readFile(path.join(root, 'package-lock.json'), 'utf8'));
if (lock.version !== pkg.version || JSON.stringify(lock.packages[''].dependencies) !== JSON.stringify(pkg.dependencies) || JSON.stringify(lock.packages[''].devDependencies) !== JSON.stringify(pkg.devDependencies)) failures.push('package-lock.json is out of sync');
for (const name of ['app/package.json', 'app/backend/package.json']) {
  if (JSON.parse(await fs.readFile(path.join(root, name), 'utf8')).version !== pkg.version) failures.push(name + ': version mismatch');
}
for (const name of files) {
  const full = path.join(root, name);
  if ((await fs.stat(full)).size >= 100 * 1024 * 1024) failures.push(name + ': exceeds GitHub 100 MiB limit');
  if (/^(?:auth\.json|cookies\.(?:json|txt)|.*credentials\.(?:json|bin)|llm-keys\.bin|bili-cred\.bin)$/.test(path.basename(name))) failures.push(name + ': private filename');
  if (!/\.(?:js|cjs|mjs|json|jsonc|md|yml|ps1|txt)$/.test(name)) continue;
  const text = await fs.readFile(full, 'utf8');
  if (/(?:sk-[a-zA-Z0-9_-]{24,}|gh[pousr]_[a-zA-Z0-9]{30,}|github_pat_[a-zA-Z0-9_]{30,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)/.test(text)) failures.push(name + ': possible embedded secret (inspect locally)');
  if (/[a-z]:[\\/]Users[\\/][^\s]+/i.test(text) && name.startsWith('app/')) failures.push(name + ': possible machine-specific path');
  if (/\.(?:js|cjs|mjs)$/.test(name)) await run(process.execPath, ['--check', full], { stdio: 'pipe' });
}
if (failures.length) { console.error(failures.join('\n')); process.exitCode = 1; }
else console.log('Repository check passed: ' + files.length + ' files; syntax, dependencies, versions, binary hash and basic secret/size checks.');
