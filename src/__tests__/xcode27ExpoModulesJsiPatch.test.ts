const { patchJavaScriptRuntime } = require('../../scripts/patch-expo-modules-jsi-xcode27.cjs');

const legacySource = `    let callbacks = expo.HostObjectCallbacks(
      context, getter, set == nil ? nil : setter, propertyNamesGetter, deallocate)
`;

describe('Xcode 27 ExpoModulesJSI compatibility patch', () => {
  it('replaces the rejected conditional function pointer with explicit branches', () => {
    const patched = patchJavaScriptRuntime(legacySource);

    expect(patched).toContain('if set == nil {');
    expect(patched).toContain('context, getter, nil, propertyNamesGetter, deallocate)');
    expect(patched).toContain('context, getter, setter, propertyNamesGetter, deallocate)');
    expect(patched).not.toContain('set == nil ? nil : setter');
  });

  it('is stable when dependencies are installed again', () => {
    const once = patchJavaScriptRuntime(legacySource);

    expect(patchJavaScriptRuntime(once)).toBe(once);
  });

  it('rejects an unknown upstream source instead of silently skipping the fix', () => {
    expect(() => patchJavaScriptRuntime('unexpected source')).toThrow(
      'Unsupported expo-modules-jsi JavaScriptRuntime.swift'
    );
  });
});
