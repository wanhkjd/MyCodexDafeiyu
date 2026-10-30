import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { build } from './build.mjs';
import { root, artifactName, run } from './common.mjs';
try {
  const out = await build('dist');
  // Use literal paths and environment parameters instead of interpolated shell commands.
  const zip = path.join(root, 'dist', artifactName + '.zip');
  await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(root, 'scripts/zip.ps1')],
    { env: { ...process.env, PET_ZIP_SOURCE: out, PET_ZIP_TARGET: zip } });
  const hash = createHash('sha256');
  for await (const chunk of (await import('node:fs')).createReadStream(zip)) hash.update(chunk);
  await fs.writeFile(zip + '.sha256', hash.digest('hex') + '  ' + path.basename(zip) + '\n');
  console.log('发布包：' + zip);
} catch (error) { console.error(error.message); process.exitCode = 1; }
