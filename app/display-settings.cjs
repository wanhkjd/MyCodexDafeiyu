'use strict';
const fs = require('node:fs');
const path = require('node:path');
const DISPLAY_DEFAULTS = Object.freeze({ alwaysOnTop: true, autoHideFullscreen: true, cursorHidePassThrough: true, edgePeek: false });
function validateDisplaySettings(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('无效的显示设置');
  for (const [key, value] of Object.entries(input)) {
    if (!Object.hasOwn(DISPLAY_DEFAULTS, key) || typeof value !== 'boolean') throw new Error('显示设置的值无效');
  }
  return input;
}
function readDisplaySettings(file) {
  if (!fs.existsSync(file)) return { ...DISPLAY_DEFAULTS };
  try { return { ...DISPLAY_DEFAULTS, ...validateDisplaySettings(JSON.parse(fs.readFileSync(file, 'utf8'))) }; }
  catch { throw new Error('显示配置无法解析，未覆盖原配置；请检查 display-settings.json'); }
}
function saveDisplaySettings(file, input) {
  validateDisplaySettings(input);
  const settings = { ...readDisplaySettings(file), ...input };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = file + '.tmp';
  try { fs.writeFileSync(temp, JSON.stringify(settings, null, 2) + '\n', 'utf8'); fs.renameSync(temp, file); }
  finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
  return settings;
}
function normalizeDisplaySettings(input) {
  return Object.fromEntries(Object.entries(DISPLAY_DEFAULTS).map(([key, fallback]) => [key, typeof input?.[key] === 'boolean' ? input[key] : fallback]));
}
function displayPolicy({ visible = true, settings, native = {} }) {
  const options = normalizeDisplaySettings(settings);
  const autoHidden = options.autoHideFullscreen && native.fullscreen === true;
  return { visible: visible !== false && !autoHidden,
    autoHidden, passThrough: options.cursorHidePassThrough && native.cursorHidden === true,
    alwaysOnTop: options.alwaysOnTop };
}
module.exports = { DISPLAY_DEFAULTS, validateDisplaySettings, readDisplaySettings, saveDisplaySettings, normalizeDisplaySettings, displayPolicy };
