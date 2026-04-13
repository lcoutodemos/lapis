import { IconButton, MobileMenu } from '@affine/component';
import { DocService } from '@affine/core/modules/doc';
import { ShareMenuContent } from '@affine/core/modules/share-menu';
import { WorkspaceService } from '@affine/core/modules/workspace';
import { ShareiOsIcon } from '@blocksuite/icons/rc';
import { useServices } from '@toeverything/infra';

import * as styles from './page-header-share-button.css';

export const PageHeaderShareButton = () => {
  const { workspaceService, docService } = useServices({
    WorkspaceService,
    DocService,
  });
  const workspace = workspaceService.workspace;
  const doc = docService.doc.blockSuiteDoc;

  return (
    <MobileMenu
      items={
        <div className={styles.content}>
          <ShareMenuContent
            workspaceMetadata={workspace.meta}
            currentPage={doc}
          />
        </div>
      }
    >
      <IconButton size={24} style={{ padding: 10 }} icon={<ShareiOsIcon />} />
    </MobileMenu>
  );
};
