export interface P2pSpaceSetupDependencies {
  activate(): Promise<void>;
}

export class P2pSpaceSetupCoordinator {
  constructor(private readonly dependencies: P2pSpaceSetupDependencies) {}

  async run<T>(operation: () => Promise<T>): Promise<T> {
    await this.dependencies.activate();
    return operation();
  }
}

let sharedCoordinator: P2pSpaceSetupCoordinator | null = null;

export function getP2pSpaceSetupCoordinator(): P2pSpaceSetupCoordinator {
  if (!sharedCoordinator) {
    sharedCoordinator = new P2pSpaceSetupCoordinator({
      activate: () => {
        const { getBackgroundServiceManager } = require('./BackgroundServiceManager');
        return getBackgroundServiceManager().activateP2p();
      },
    });
  }
  return sharedCoordinator;
}
