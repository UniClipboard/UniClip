const GENERIC_APPLE_DEVICE_NAMES = new Set(['iphone', 'ipad', 'ipod touch']);

function normalized(value: string | null | undefined): string {
  return value?.trim() ?? '';
}

export function resolveDefaultDeviceName(
  userAssignedName: string | null | undefined,
  modelName: string | null | undefined,
  fallback: string
): string {
  const preferredName = normalized(userAssignedName);
  if (preferredName && !GENERIC_APPLE_DEVICE_NAMES.has(preferredName.toLowerCase())) {
    return preferredName;
  }

  return normalized(modelName) || normalized(fallback);
}
