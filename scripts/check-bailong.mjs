import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { loadBailongPack } from '../app/backend/runtime/characters.mjs';

// The same pinned hashes check the source tree and the copied build, never user data.
export async function checkBundledBailong(appRoot) {
  const prefix = 'app/';
  const hashes = JSON.parse(await fs.readFile(new URL('./bailong-integrity.json', import.meta.url), 'utf8'));
  const pack = loadBailongPack(path.join(appRoot, 'backend/assets/characters/bailong'), { fresh: true });
  const required = ['backend/assets/characters/bailong/ASSETS.md',
    'backend/assets/characters/bailong/outputs/白龙桌宠素材/素材清单.json',
    ...Object.keys(pack.clips).map(id => 'backend/assets/characters/bailong/outputs/白龙桌宠素材/透明WebM/' + id + '.webm')];
  if (Object.keys(hashes).length !== required.length || required.some(name => !Object.hasOwn(hashes, prefix + name))) throw new Error('Bundled Bailong integrity inventory is incomplete');
  for (const name of required) {
    const data = await fs.readFile(path.join(appRoot, name));
    if (data.length >= 100 * 1024 * 1024) throw new Error(name + ': oversized bundled asset');
    if (createHash('sha256').update(data).digest('hex') !== hashes[prefix + name]) throw new Error(name + ': bundled Bailong checksum mismatch');
  }
  return { assets: Object.keys(pack.clips).length, bytes: pack.bytes };
}
