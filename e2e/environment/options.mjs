export function parseOptions(args) {
  const options = { repeat: 1 };
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i].replace(/^--/, "");
    if (
      !["platform", "app", "scenario", "repeat"].includes(key) ||
      !args[i + 1] ||
      args[i + 1].startsWith("--")
    )
      throw new Error(`Invalid option: ${args[i]}`);
    options[key] = key === "repeat" ? Number(args[i + 1]) : args[i + 1];
  }
  if (!["ios", "android"].includes(options.platform) || !options.app)
    throw new Error("Required: --platform ios|android --app /path/to/app");
  if (options.scenario && !/^[a-z][a-z0-9-]*$/.test(options.scenario))
    throw new Error("Invalid scenario name");
  if (
    !Number.isInteger(options.repeat) ||
    options.repeat < 1 ||
    options.repeat > 7
  )
    throw new Error("repeat must be 1–7");
  return options;
}
