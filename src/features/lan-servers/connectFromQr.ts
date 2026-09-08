import type { LanConnectIntent } from './connectUri';
import type { LanServerService } from './internal/lanServerService';
import type { probeLanServers } from './probeLanServers';

interface ConnectionDependencies {
  probe: typeof probeLanServers;
  save: LanServerService['save'];
}

export async function connectLanFromQr(
  intent: LanConnectIntent,
  dependencies: ConnectionDependencies
) {
  const results = await dependencies.probe(intent);
  if (!Object.values(results).includes('Success')) {
    throw new Error(Object.values(results).includes('AuthFailed') ? 'AuthFailed' : 'Unreachable');
  }
  return dependencies.save(
    { ...intent, name: intent.name ?? '', allowInsecureTls: false },
    undefined,
    { activate: true }
  );
}
