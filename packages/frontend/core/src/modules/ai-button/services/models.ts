import { getPromptModelsQuery, SubscriptionStatus } from '@affine/graphql';
import {
  createSignalFromObservable,
  type Signal,
} from '@blocksuite/affine/shared/utils';
import { signal } from '@preact/signals-core';
import { LiveData, Service } from '@toeverything/infra';

import type { GraphQLService, SubscriptionService } from '../../cloud';
import type { GlobalStateService } from '../../storage';

const AI_MODEL_ID_KEY = 'AIModelId';

export interface AIModel {
  name: string;
  id: string;
  version: string;
  category: string;
  isPro: boolean;
  isDefault: boolean;
}

export class AIModelService extends Service {
  modelId: Signal<string | undefined>;

  models: Signal<AIModel[]> = signal([]);

  private readonly modelId$ = LiveData.from(
    this.globalStateService.globalState.watch<string>(AI_MODEL_ID_KEY),
    undefined
  );

  constructor(
    private readonly globalStateService: GlobalStateService,
    private readonly gqlService: GraphQLService,
    private readonly subscriptionService: SubscriptionService
  ) {
    super();

    const { signal: modelId, cleanup } = createSignalFromObservable<
      string | undefined
    >(this.modelId$, undefined);
    this.modelId = modelId;
    this.disposables.push(cleanup);

    this.init().catch(err => {
      console.error(err);
    });
  }

  resetModel = () => {
    this.globalStateService.globalState.set(AI_MODEL_ID_KEY, undefined);
  };

  setModel = (modelId: string) => {
    const model = this.models.value.find(m => m.id === modelId);
    // In CLI/Electron mode all models are marked isPro=false, so no gate needed.
    // In cloud mode, block pro models when not subscribed.
    if (model?.isPro) {
      const isSubscribed =
        this.subscriptionService.subscription.ai$.value?.status ===
        SubscriptionStatus.Active;
      if (!isSubscribed) return;
    }
    this.globalStateService.globalState.set(AI_MODEL_ID_KEY, modelId);

    // Keep the CLI bridge in sync if running in Electron
    const cliApis = (window as any).__apis?.aiCli as
      | { updateRuntimeOptions?: (opts: { model: string }) => Promise<unknown> }
      | undefined;
    cliApis?.updateRuntimeOptions?.({ model: modelId })?.catch(() => {});
  };

  private readonly init = async () => {
    await this.initModels();

    // subscribe to ai purchase status
    const sub = this.subscriptionService.subscription.ai$.subscribe(
      subscription => {
        const isSubscribed = subscription?.status === SubscriptionStatus.Active;
        const model = this.models.value.find(
          model => model.id === this.modelId.value
        );
        if (!isSubscribed && model?.isPro) {
          this.resetModel();
        }
      }
    );
    this.disposables.push(() => sub.unsubscribe());
  };

  private readonly initModels = async (prompt?: string) => {
    // In Electron + CLI mode, populate models from the CLI bridge instead of
    // the cloud GraphQL API (which is unavailable when running offline via CLI).
    const cliApis = (window as any).__apis?.aiCli as
      | {
          getRuntimeOptions?: () => Promise<{
            models: Array<{
              id: string;
              label: string;
              category: string;
              version: string;
            }>;
            selectedModel: string | null;
          }>;
        }
      | undefined;

    if (cliApis?.getRuntimeOptions) {
      try {
        const opts = await cliApis.getRuntimeOptions();
        if (opts?.models?.length) {
          this.models.value = opts.models.map(m => ({
            name: m.label,
            id: m.id,
            version: m.version,
            category: m.category,
            isPro: false,
            isDefault: m.id === (opts.selectedModel ?? 'claude-sonnet-4-6'),
          }));
          // Restore persisted selection if valid
          const currentId = this.modelId.value;
          if (currentId && !this.models.value.some(m => m.id === currentId)) {
            this.resetModel();
          }
          return;
        }
      } catch {
        // Fall through to GraphQL path
      }
    }

    const promptName = prompt || 'Chat With AFFiNE AI';
    const models = await this.getModelsByPrompt(promptName);
    if (models) {
      const { defaultModel, optionalModels, proModels } = models;
      this.models.value = optionalModels.map(model => {
        const [category] = model.name.split(' ');
        const version = model.name.slice(category.length + 1);
        return {
          name: model.name,
          id: model.id,
          version,
          category,
          isPro: proModels.some(proModel => proModel.id === model.id),
          isDefault: model.id === defaultModel,
        };
      });
    }
  };

  private readonly getModelsByPrompt = async (promptName: string) => {
    return this.gqlService
      .gql({
        query: getPromptModelsQuery,
        variables: { promptName },
      })
      .then(res => res.currentUser?.copilot?.models);
  };
}
