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
let activateP2p: (() => Promise<void>) | null = null;

export function configureP2pSpaceActivation(activate: () => Promise<void>): void {
  activateP2p = activate;
}

export function getP2pSpaceSetupCoordinator(): P2pSpaceSetupCoordinator {
  if (!sharedCoordinator) {
    sharedCoordinator = new P2pSpaceSetupCoordinator({
      activate: () => {
        if (!activateP2p) throw new Error('P2P runtime is not configured');
        return activateP2p();
      },
    });
  }
  return sharedCoordinator;
}
