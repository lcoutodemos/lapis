import { IconButton } from '@affine/component';
import { Menu } from '@affine/component/ui/menu';
import type { WorkspaceMetadata } from '@affine/core/modules/workspace';
import { useI18n } from '@affine/i18n';
import type { Store } from '@blocksuite/affine/store';
import { ExportIcon } from '@blocksuite/icons/rc';
import { forwardRef, type PropsWithChildren, type Ref } from 'react';

import * as styles from './index.css';
import { ShareExport } from './share-export';

export interface ShareMenuProps extends PropsWithChildren {
  workspaceMetadata: WorkspaceMetadata;
  currentPage: Store;
  onEnableAffineCloud?: () => void;
  onOpenShareModal?: (open: boolean) => void;
  openPaywallModal?: () => void;
  hittingPaywall?: boolean;
  disabled?: boolean;
  disabledReason?: string;
}

// Kept for compatibility — tabs are no longer shown but callers may reference
export enum ShareMenuTab {
  Share = 'share',
  Export = 'export',
  Invite = 'invite',
  Members = 'members',
}

export const ShareMenuContent = (_props: ShareMenuProps) => {
  return <ShareExport />;
};

const DefaultShareButton = forwardRef(function DefaultShareButton(
  props: { disabled?: boolean; tooltip?: string },
  ref: Ref<HTMLButtonElement>
) {
  const t = useI18n();
  return (
    <IconButton
      ref={ref}
      size="20"
      disabled={props.disabled}
      tooltip={props.tooltip ?? t['com.affine.share-menu.shareButton']()}
    >
      <ExportIcon />
    </IconButton>
  );
});

export const ShareMenu = (props: ShareMenuProps) => {
  if (props.disabled) {
    return (
      <div>
        <DefaultShareButton disabled tooltip={props.disabledReason} />
      </div>
    );
  }
  return (
    <Menu
      items={<ShareMenuContent {...props} />}
      contentOptions={{
        className: styles.localMenuStyle,
        align: 'end',
      }}
      rootOptions={{
        modal: false,
        onOpenChange: props.onOpenShareModal,
      }}
    >
      <div>{props.children || <DefaultShareButton />}</div>
    </Menu>
  );
};
