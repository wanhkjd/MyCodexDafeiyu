const parent = Number(process.env.CODEX_PET_MANAGER_PID);
if (Number.isSafeInteger(parent) && parent > 0) setInterval(() => {
  try { process.kill(parent, 0); } catch { process.exit(0); }
}, 2000).unref();
// The manager hands over decrypted third-party API keys on stdin, so they never sit in the data folder.
let keyInput = '', keyUpdate = Promise.resolve();
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  keyInput += chunk;
  for (let end; (end = keyInput.indexOf('\n')) >= 0;) {
    const line = keyInput.slice(0, end);
    keyInput = keyInput.slice(end + 1);
    let message;
    try { message = JSON.parse(line); } catch { continue; }
    if (message?.type === 'llm-keys') keyUpdate = keyUpdate.then(() => import('./backend/runtime/third-party-llm.mjs')).then(llm => llm.setKeys(message.keys)).catch(() => {});
    // System idle time from the manager, so the pet's mood knows whether you are at the computer.
    if (message?.type === 'presence') import('./backend/runtime/mood.mjs').then(mood => mood.reportPresence(message)).catch(() => {});
  }
});
process.stdin.on('error', () => {});
process.argv = [process.execPath, fileURLToPath(new URL('./backend/lib/standalone.js', import.meta.url)), '--port', '0'];
await import('./backend/lib/standalone.js');
import { fileURLToPath } from 'node:url';
