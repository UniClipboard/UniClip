import { createStore } from 'zustand/vanilla';
import { useStore } from 'zustand';

import type {
  DeviceTrustDecisionChoice,
  DeviceTrustDecisionOutcome,
  DeviceTrustDecisionSession,
} from '@/components/DeviceTrustDecisionSession';

export type DeviceTrustPreviewScenarioId =
  | 'standard'
  | 'singleChoice'
  | 'confirmKeepCurrent'
  | 'confirmLeaveCurrent'
  | 'submitting'
  | 'failedRetry'
  | 'stateChanged'
  | 'longScrollable';

export const DEVICE_TRUST_PREVIEW_SCENARIOS: ReadonlyArray<{
  id: DeviceTrustPreviewScenarioId;
  labelKey: string;
}> = [
  { id: 'standard', labelKey: 'debug.deviceTrustPreview.scenarios.standard' },
  { id: 'singleChoice', labelKey: 'debug.deviceTrustPreview.scenarios.singleChoice' },
  {
    id: 'confirmKeepCurrent',
    labelKey: 'debug.deviceTrustPreview.scenarios.confirmKeepCurrent',
  },
  {
    id: 'confirmLeaveCurrent',
    labelKey: 'debug.deviceTrustPreview.scenarios.confirmLeaveCurrent',
  },
  { id: 'submitting', labelKey: 'debug.deviceTrustPreview.scenarios.submitting' },
  { id: 'failedRetry', labelKey: 'debug.deviceTrustPreview.scenarios.failedRetry' },
  { id: 'stateChanged', labelKey: 'debug.deviceTrustPreview.scenarios.stateChanged' },
  { id: 'longScrollable', labelKey: 'debug.deviceTrustPreview.scenarios.longScrollable' },
];

type ChoiceView = NonNullable<DeviceTrustDecisionSession['view']>['choices'][number];

interface ScenarioState {
  view: NonNullable<DeviceTrustDecisionSession['view']>;
  selectedChoice: DeviceTrustDecisionChoice | null;
  submitting?: boolean;
  error?: string | null;
  outcome?: DeviceTrustDecisionOutcome | null;
}

interface PreviewStoreState {
  session: DeviceTrustDecisionSession | null;
}

function choice(
  value: DeviceTrustDecisionChoice,
  {
    exitsCurrentSpace = false,
    continues = ['Studio desktop'],
    stops = [],
    rejoins = [],
  }: {
    exitsCurrentSpace?: boolean;
    continues?: string[];
    stops?: string[];
    rejoins?: string[];
  } = {}
): ChoiceView {
  return {
    choice: value,
    exitsCurrentSpace,
    continueSyncNames: continues,
    stopSyncNames: stops,
    requiresRejoinNames: rejoins,
  };
}

function scenarios(): Record<DeviceTrustPreviewScenarioId, ScenarioState> {
  const standardChoices: ChoiceView[] = [
    choice('applyChange', {
      continues: ['Studio desktop', 'Travel tablet'],
    }),
    choice('keepCurrentDeviceGroup', {
      continues: ['Studio desktop'],
      stops: ['Travel tablet'],
      rejoins: ['Travel tablet'],
    }),
  ];
  const standardView = {
    changeId: 'preview-standard',
    sourceName: 'Studio desktop',
    targetNames: ['Travel tablet'],
    choices: standardChoices,
  };

  return {
    standard: {
      view: standardView,
      selectedChoice: null,
    },
    singleChoice: {
      view: {
        ...standardView,
        changeId: 'preview-single-choice',
        choices: [standardChoices[0]],
      },
      selectedChoice: 'applyChange',
    },
    confirmKeepCurrent: {
      view: {
        ...standardView,
        changeId: 'preview-confirm-keep',
      },
      selectedChoice: null,
    },
    confirmLeaveCurrent: {
      view: {
        changeId: 'preview-confirm-leave',
        sourceName: 'Replacement phone',
        targetNames: ['This development phone'],
        choices: [
          choice('applyChange', {
            exitsCurrentSpace: true,
            continues: ['Replacement phone', 'Studio desktop'],
          }),
          choice('keepCurrentDeviceGroup', {
            continues: ['Studio desktop'],
            stops: ['Replacement phone'],
            rejoins: ['Replacement phone'],
          }),
        ],
      },
      selectedChoice: null,
    },
    submitting: {
      view: {
        ...standardView,
        changeId: 'preview-submitting',
      },
      selectedChoice: 'applyChange',
      submitting: true,
    },
    failedRetry: {
      view: {
        ...standardView,
        changeId: 'preview-failed-retry',
      },
      selectedChoice: 'applyChange',
      error: 'preview-failed',
    },
    stateChanged: {
      view: {
        ...standardView,
        changeId: 'preview-state-changed',
      },
      selectedChoice: 'applyChange',
      outcome: 'stateChanged',
    },
    longScrollable: {
      view: {
        changeId: 'preview-long-scrollable',
        sourceName: 'Design studio workstation with an intentionally long device name',
        targetNames: [
          'Living room tablet shared by the whole family',
          'Conference room presentation computer',
          'Travel laptop used while working remotely',
        ],
        choices: [
          choice('applyChange', {
            continues: [
              'Design studio workstation with an intentionally long device name',
              'Living room tablet shared by the whole family',
              'Conference room presentation computer',
              'Travel laptop used while working remotely',
            ],
            stops: ['Old offline phone', 'Retired home computer'],
            rejoins: ['Old offline phone', 'Retired home computer'],
          }),
          choice('keepCurrentDeviceGroup', {
            continues: ['Old offline phone'],
            stops: [
              'Living room tablet shared by the whole family',
              'Conference room presentation computer',
              'Travel laptop used while working remotely',
            ],
            rejoins: [
              'Living room tablet shared by the whole family',
              'Conference room presentation computer',
              'Travel laptop used while working remotely',
            ],
          }),
        ],
      },
      selectedChoice: null,
    },
  };
}

const store = createStore<PreviewStoreState>(() => ({ session: null }));

function updateSession(
  update: (session: DeviceTrustDecisionSession) => DeviceTrustDecisionSession
): void {
  const session = store.getState().session;
  if (!session) return;
  store.setState({ session: update(session) });
}

async function choose(selected: DeviceTrustDecisionChoice): Promise<void> {
  const session = store.getState().session;
  const selectedView = session?.view?.choices.find(({ choice: value }) => value === selected);
  if (!session || !selectedView || session.submitting) return;

  updateSession((current) => ({
    ...current,
    selectedChoice: selected,
    confirmingChoice: null,
  }));
}

async function proceed(): Promise<void> {
  const session = store.getState().session;
  const selected = session?.selectedChoice;
  const selectedView = session?.view?.choices.find(({ choice: value }) => value === selected);
  if (!session || !selected || !selectedView || session.submitting) return;

  if (session.error) {
    updateSession((current) => ({ ...current, error: null }));
    return;
  }

  if (
    selected !== 'keepCurrentDeviceGroup' &&
    !selectedView.exitsCurrentSpace &&
    selectedView.stopSyncNames.length === 0
  ) {
    close();
    return;
  }

  updateSession((current) => ({
    ...current,
    confirmingChoice: selected,
    error: null,
  }));
}

async function confirm(): Promise<void> {
  const session = store.getState().session;
  if (!session?.confirmingChoice || session.submitting) return;
  close();
}

function cancelConfirmation(): void {
  updateSession((current) => ({ ...current, confirmingChoice: null }));
}

function close(): void {
  store.setState({ session: null });
}

function open(id: DeviceTrustPreviewScenarioId): void {
  const scenario = scenarios()[id];
  store.setState({
    session: {
      view: scenario.view,
      changeId: scenario.view.changeId,
      selectedChoice: scenario.selectedChoice,
      confirmingChoice: null,
      submitting: scenario.submitting ?? false,
      error: scenario.error ?? null,
      outcome: scenario.outcome ?? null,
      choose,
      proceed,
      confirm,
      cancelConfirmation,
      dismiss: close,
    },
  });
}

export const deviceTrustPreviewSession = {
  open,
  close,
  getState: store.getState,
};

export function useDeviceTrustPreviewSession(): DeviceTrustDecisionSession | null {
  return useStore(store, (state) => state.session);
}
