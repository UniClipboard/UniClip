'use strict';

const fs = require('node:fs');
const path = require('node:path');

const LEGACY_SOURCE = `    let callbacks = expo.HostObjectCallbacks(
      context, getter, set == nil ? nil : setter, propertyNamesGetter, deallocate)
`;

const PATCHED_SOURCE = `    let callbacks: expo.HostObjectCallbacks
    if set == nil {
      callbacks = expo.HostObjectCallbacks(
        context, getter, nil, propertyNamesGetter, deallocate)
    } else {
      callbacks = expo.HostObjectCallbacks(
        context, getter, setter, propertyNamesGetter, deallocate)
    }
`;

function patchJavaScriptRuntime(source) {
  if (source.includes(PATCHED_SOURCE)) {
    return source;
  }

  const occurrences = source.split(LEGACY_SOURCE).length - 1;
  if (occurrences !== 1) {
    throw new Error(
      `Unsupported expo-modules-jsi JavaScriptRuntime.swift: expected one Xcode 27 patch site, found ${occurrences}`
    );
  }

  return source.replace(LEGACY_SOURCE, PATCHED_SOURCE);
}

function patchInstalledDependency(projectRoot = process.cwd()) {
  const sourcePath = path.join(
    projectRoot,
    'node_modules',
    'expo-modules-jsi',
    'apple',
    'Sources',
    'ExpoModulesJSI',
    'Runtime',
    'JavaScriptRuntime.swift'
  );
  const source = fs.readFileSync(sourcePath, 'utf8');
  const patched = patchJavaScriptRuntime(source);

  if (patched !== source) {
    fs.writeFileSync(sourcePath, patched);
    console.log('[Xcode 27] Patched expo-modules-jsi JavaScriptRuntime.swift');
  } else {
    console.log('[Xcode 27] expo-modules-jsi patch already applied');
  }
}

if (require.main === module) {
  patchInstalledDependency();
}

module.exports = { patchInstalledDependency, patchJavaScriptRuntime };
