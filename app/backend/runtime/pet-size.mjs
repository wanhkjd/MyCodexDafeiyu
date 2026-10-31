export const SIZE_LIMITS = Object.freeze({ min: 100, max: 500, defaultSize: 400 });

export function petSizeState(config) {
  const pet = config?.main?.pets?.find(p => p.id === 'main');
  if (!pet || !Number.isFinite(pet.size) || pet.size <= 0) throw new Error('未找到主桌宠的大小配置');
  return { ok: true, id: 'main', size: pet.size, ...SIZE_LIMITS };
}

// Patch only the raw user's size. Never persist derived skin geometry or reset other preferences.
export function resizePetConfig(existing, defaults, input) {
  const size = input?.size;
  if (typeof size !== 'number' || !Number.isInteger(size) || size < SIZE_LIMITS.min || size > SIZE_LIMITS.max) {
    throw new Error('大小请输入 100–500 之间的整数（px）');
  }
  const pets = existing?.pets ?? defaults?.pets;
  if (!Array.isArray(pets) || !pets.some(p => p?.id === 'main')) throw new Error('未找到主桌宠，请检查大小、位置与功能配置');
  return { ...existing, pets: pets.map(p => p?.id === 'main' ? { ...p, size } : p) };
}
