import type { Workspace } from '@affine/core/modules/workspace';
import type { Store } from '@blocksuite/affine/store';

import { ShareMenu } from './share-menu';

export { ShareMenuContent } from './share-menu';

type SharePageModalProps = {
  workspace: Workspace;
  page: Store;
};

export const SharePageButton = ({ workspace, page }: SharePageModalProps) => {
  return <ShareMenu workspaceMetadata={workspace.meta} currentPage={page} />;
};
