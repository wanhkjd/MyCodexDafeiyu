import path from 'node:path';
import { build } from './build.mjs';
import { run } from './common.mjs';
try {
  const out = await build();
  const env = { ...process.env };
  for (const key of ['ELECTRON_RUN_AS_NODE', 'CODEX_PET_HELPER']) delete env[key];
  await run(path.join(out, 'Codex-dafeiyu.exe'), [], { cwd: out, env });
} catch (error) { console.error(error.message); process.exitCode = 1; }
