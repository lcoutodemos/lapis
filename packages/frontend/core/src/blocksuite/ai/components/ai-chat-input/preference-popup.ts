import type { AIToolsConfigService } from '@affine/core/modules/ai-button';
import type { AIModelService } from '@affine/core/modules/ai-button/services/models';
import type {
  ServerService,
  SubscriptionService,
} from '@affine/core/modules/cloud';
import {
  type CopilotChatHistoryFragment,
  ServerDeploymentType,
  SubscriptionStatus,
} from '@affine/graphql';
import {
  menu,
  popMenu,
  popupTargetFromElement,
} from '@blocksuite/affine/components/context-menu';
import { SignalWatcher, WithDisposable } from '@blocksuite/affine/global/lit';
import { unsafeCSSVarV2 } from '@blocksuite/affine/shared/theme';
import type { NotificationService } from '@blocksuite/affine-shared/services';
import {
  AiOutlineIcon,
  ArrowDownSmallIcon,
  CloudWorkspaceIcon,
  DoneIcon,
  LockIcon,
  ThinkingIcon,
} from '@blocksuite/icons/lit';
import { ShadowlessElement } from '@blocksuite/std';
import { autoPlacement, offset, shift } from '@floating-ui/dom';
import { computed } from '@preact/signals-core';
import { css, html } from 'lit';
import { property, state } from 'lit/decorators.js';

type PermissionMode = 'default' | 'ask' | 'allow-all';

const PERMISSION_MODE_LABELS: Record<PermissionMode, string> = {
  default: 'Default',
  ask: 'Ask each time',
  'allow-all': 'Allow all',
};

const modelSubMenuMiddleware = [
  autoPlacement({ allowedPlacements: ['right-start', 'left-start'] }),
  offset({ mainAxis: 4, crossAxis: 0 }),
  shift({ crossAxis: true, padding: 8 }),
];

export class ChatInputPreference extends SignalWatcher(
  WithDisposable(ShadowlessElement)
) {
  static override styles = css`
    .chat-input-preference-trigger {
      display: flex;
      align-items: center;
      padding: 0px 4px;
      color: var(--affine-v2-icon-primary);
      transition: all 0.23s ease;
      border-radius: 4px;
      background: transparent;
      border: none;
      cursor: pointer;
    }
    .chat-input-preference-trigger:hover {
      background-color: var(--affine-v2-layer-background-hoverOverlay);
    }
    .chat-input-preference-trigger-label {
      font-size: 14px;
      line-height: 22px;
      font-weight: 500;
      padding: 0px 4px;
    }
    .chat-input-preference-trigger-icon {
      font-size: 20px;
      line-height: 0;
    }
    .preference-action {
      white-space: nowrap;
      min-width: 220px;
    }
    .ai-active-model-name {
      font-size: 14px;
      color: ${unsafeCSSVarV2('text/secondary')};
      line-height: 22px;
      margin-left: 40px;
    }
    .ai-model-prefix {
      width: 20px;
      height: 20px;
    }
    .ai-model-prefix svg {
      color: ${unsafeCSSVarV2('icon/activated')};
    }
    .ai-model-postfix svg:hover {
      color: ${unsafeCSSVarV2('icon/activated')};
    }
    .ai-model-version {
      font-size: 12px;
      color: ${unsafeCSSVarV2('text/tertiary')};
      line-height: 20px;
      margin-right: 40px;
    }
  `;

  @property({ attribute: false })
  accessor session!: CopilotChatHistoryFragment | null | undefined;
  // --------- model props end ---------

  // --------- extended thinking props start ---------
  @property({ attribute: false })
  accessor extendedThinking: boolean = false;

  @property({ attribute: false })
  accessor onExtendedThinkingChange:
    | ((extendedThinking: boolean) => void)
    | undefined;
  // --------- extended thinking props end ---------

  @property({ attribute: false })
  accessor serverService!: ServerService;

  @property({ attribute: false })
  accessor toolsConfigService!: AIToolsConfigService;

  @property({ attribute: false })
  accessor notificationService!: NotificationService;

  @property({ attribute: false })
  accessor subscriptionService!: SubscriptionService;

  @property({ attribute: false })
  accessor aiModelService!: AIModelService;

  @property({ attribute: false })
  accessor onAISubscribe!: () => Promise<void>;

  @state()
  accessor _permissionMode: PermissionMode = 'default';

  @state()
  accessor _isElectron: boolean = false;

  connectedCallback() {
    super.connectedCallback();
    this._detectElectronAndLoadOptions();
  }

  private _detectElectronAndLoadOptions() {
    const cliApis = (window as any).__apis?.aiCli as
      | {
          getRuntimeOptions?: () => Promise<{ permissionMode: PermissionMode }>;
        }
      | undefined;
    if (!cliApis?.getRuntimeOptions) return;
    this._isElectron = true;
    cliApis
      .getRuntimeOptions()
      .then(opts => {
        this._permissionMode = opts.permissionMode ?? 'default';
      })
      .catch(() => {});
  }

  private _setPermissionMode(mode: PermissionMode) {
    this._permissionMode = mode;
    const cliApis = (window as any).__apis?.aiCli as
      | {
          updateRuntimeOptions?: (opts: {
            permissionMode: PermissionMode;
          }) => Promise<unknown>;
        }
      | undefined;
    cliApis?.updateRuntimeOptions?.({ permissionMode: mode })?.catch(() => {});
  }

  model = computed(() => {
    const modelId = this.aiModelService.modelId.value;
    const activeModel = this.aiModelService.models.value.find(
      model => model.id === modelId
    );
    const defaultModel = this.aiModelService.models.value.find(
      model => model.isDefault
    );
    return activeModel || defaultModel;
  });

  openPreference(e: Event) {
    const element = e.currentTarget;
    if (!(element instanceof HTMLElement)) return;
    const modelItems = [];
    const searchItems = [];
    const approvalItems = [];

    // model switch
    modelItems.push(
      menu.subMenu({
        name: 'Model',
        prefix: AiOutlineIcon(),
        middleware: modelSubMenuMiddleware,
        postfix: html`
          <span class="ai-active-model-name"> ${this.model.value?.name} </span>
        `,
        options: {
          items: this.aiModelService.models.value.map(model => {
            const isSelected = model.id === this.model.value?.id;
            const isSelfHosted =
              this.serverService.server.config$.value?.type ===
              ServerDeploymentType.Selfhosted;
            const status =
              this.subscriptionService.subscription.ai$.value?.status;
            const isSubscribed = status === SubscriptionStatus.Active;
            return menu.action({
              name: model.category,
              info: html`
                <span class="ai-model-version">${model.version}</span>
              `,
              prefix: html`
                <div class="ai-model-prefix">
                  ${isSelected ? DoneIcon() : undefined}
                </div>
              `,
              postfix: html`
                <div class="ai-model-postfix" @click=${this.onAISubscribe}>
                  ${model.isPro && !isSubscribed ? LockIcon() : undefined}
                </div>
              `,
              select: () => {
                if (model.isPro && !isSelfHosted && !isSubscribed) {
                  this.notificationService.toast(
                    `Pro models require an AFFiNE AI subscription.`
                  );
                  return;
                }
                this.aiModelService.setModel(model.id);
              },
            });
          }),
        },
      })
    );

    modelItems.push(
      menu.toggleSwitch({
        name: 'Extended Thinking',
        prefix: ThinkingIcon(),
        on: this.extendedThinking,
        onChange: (value: boolean) => this.onExtendedThinkingChange?.(value),
        class: { 'preference-action': true },
      })
    );

    searchItems.push(
      menu.toggleSwitch({
        name: 'Workspace All Docs',
        prefix: CloudWorkspaceIcon(),
        on:
          !!this.toolsConfigService.config.value.searchWorkspace &&
          !!this.toolsConfigService.config.value.readingDocs,
        onChange: (value: boolean) =>
          this.toolsConfigService.setConfig({
            searchWorkspace: value,
            readingDocs: value,
          }),
        class: { 'preference-action': true },
      })
    );

    // Approval mode section — only shown in Electron/CLI mode
    if (this._isElectron) {
      const modes: PermissionMode[] = ['default', 'ask', 'allow-all'];
      approvalItems.push(
        menu.subMenu({
          name: 'Approval',
          prefix: LockIcon(),
          middleware: modelSubMenuMiddleware,
          postfix: html`
            <span class="ai-active-model-name">
              ${PERMISSION_MODE_LABELS[this._permissionMode]}
            </span>
          `,
          options: {
            items: modes.map(mode =>
              menu.action({
                name: PERMISSION_MODE_LABELS[mode],
                prefix: html`
                  <div class="ai-model-prefix">
                    ${this._permissionMode === mode ? DoneIcon() : undefined}
                  </div>
                `,
                select: () => this._setPermissionMode(mode),
                class: { 'preference-action': true },
              })
            ),
          },
        })
      );
    }

    popMenu(popupTargetFromElement(element), {
      options: {
        items: [
          menu.group({
            items: [...modelItems],
          }),
          menu.group({
            items: [...searchItems],
          }),
          ...(approvalItems.length
            ? [menu.group({ items: approvalItems })]
            : []),
        ],
        testId: 'chat-input-preference',
      },
    });
  }

  override render() {
    return html`<button
      @click=${this.openPreference}
      data-testid="chat-input-preference-trigger"
      class="chat-input-preference-trigger"
    >
      <span class="chat-input-preference-trigger-label">
        ${this.model.value?.category}
      </span>
      <span class="chat-input-preference-trigger-icon">
        ${ArrowDownSmallIcon()}
      </span>
    </button>`;
  }
}
