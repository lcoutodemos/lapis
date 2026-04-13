import {
  CloseIcon,
  DeleteIcon,
  DeletePermanentlyIcon,
  FavoriteIcon,
  ResetIcon,
} from '@blocksuite/icons/rc';
import type { ReactNode } from 'react';

import { FloatingToolbar } from './floating-toolbar';
import * as styles from './list-floating-toolbar.css';

export const ListFloatingToolbar = ({
  content,
  onClose,
  open,
  onDelete,
  onRestore,
  onFavorite,
  /** Render a folder-picker menu button as a ReactNode (caller owns the Menu trigger) */
  moveToFolderButton,
}: {
  open: boolean;
  content: ReactNode;
  onClose: () => void;
  onDelete?: () => void;
  onRestore?: () => void;
  onFavorite?: () => void;
  moveToFolderButton?: ReactNode;
}) => {
  return (
    <FloatingToolbar className={styles.floatingToolbar} open={open}>
      <FloatingToolbar.Item>{content}</FloatingToolbar.Item>
      <FloatingToolbar.Button onClick={onClose} icon={<CloseIcon />} />
      {(!!onFavorite || !!moveToFolderButton || !!onRestore || !!onDelete) && (
        <FloatingToolbar.Separator />
      )}
      {!!onFavorite && (
        <FloatingToolbar.Button
          onClick={onFavorite}
          icon={<FavoriteIcon />}
          data-testid="list-toolbar-favorite"
        />
      )}
      {!!moveToFolderButton && (
        <FloatingToolbar.Item>{moveToFolderButton}</FloatingToolbar.Item>
      )}
      {!!onRestore && (
        <FloatingToolbar.Button
          onClick={onRestore}
          icon={<ResetIcon />}
          data-testid="list-toolbar-restore"
        />
      )}
      {!!onDelete && (
        <FloatingToolbar.Button
          onClick={onDelete}
          icon={onRestore ? <DeletePermanentlyIcon /> : <DeleteIcon />}
          type="danger"
          data-testid="list-toolbar-delete"
        />
      )}
    </FloatingToolbar>
  );
};
