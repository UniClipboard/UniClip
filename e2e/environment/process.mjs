import { execFile } from "node:child_process";
import { promisify } from "node:util";
const exec = promisify(execFile);
/** No shell interpolation; every command has a deadline. */
export async function command(file, args, options = {}) {
  const { stdout } = await exec(file, args, {
    timeout: 120_000,
    maxBuffer: 32 * 1024 * 1024,
    ...options,
  });
  return stdout.trim();
}
