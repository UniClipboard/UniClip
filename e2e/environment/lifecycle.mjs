/** Device ownership stays with the caller even when prepare only partially succeeds. */
export async function runScenario(device, execute) {
  const errors = [];
  let stage = "prepare";
  try {
    await device.prepare();
    stage = "execute";
    await execute();
  } catch (error) {
    errors.push({ stage, message: error.message });
  } finally {
    for (const stage of ["capture", "dispose"]) {
      try {
        await device[stage]();
      } catch (error) {
        errors.push({ stage, message: error.message });
      }
    }
  }
  return { ok: errors.length === 0, errors };
}
