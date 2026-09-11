/** otool prints arm64 simulator section bytes as little-endian 32-bit words. */
export function decodeSimulatorEntitlements(dump) {
  const words = dump
    .split("\n")
    .filter((line) => /^\s*[0-9a-f]{16}\s/i.test(line))
    .flatMap((line) => line.trim().split(/\s+/).slice(1));
  if (!words.length || words.some((word) => !/^[0-9a-f]{2,8}$/i.test(word))) {
    throw new Error(
      "Simulator App has no readable embedded entitlements; enable ad-hoc signing"
    );
  }
  return Buffer.concat(words.map((word) => Buffer.from(word, "hex").reverse()))
    .toString("utf8")
    .replace(/\0+$/, "");
}
