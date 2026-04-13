import {
  Masonry,
  type MasonryGroup,
  type MasonryItem,
  Menu,
  MenuItem,
  useConfirmModal,
} from '@affine/component';
import { DocsService } from '@affine/core/modules/doc';
import { CompatibleFavoriteItemsAdapter } from '@affine/core/modules/favorite';
import type { FolderNode } from '@affine/core/modules/organize';
import { OrganizeService } from '@affine/core/modules/organize';
import { WorkspacePropertyService } from '@affine/core/modules/workspace-property';
import { Trans, useI18n } from '@affine/i18n';
import { FolderIcon } from '@blocksuite/icons/rc';
import { useLiveData, useService } from '@toeverything/infra';
import { cssVarV2 } from '@toeverything/theme/v2';
import { memo, useCallback, useContext, useEffect, useMemo } from 'react';

import { EmptyDocs } from '../../affine/empty';
import { ListFloatingToolbar } from '../../page-list/components/list-floating-toolbar';
import { SystemPropertyTypes } from '../../system-property-types';
import { WorkspacePropertyTypes } from '../../workspace-property-types';
import { DocExplorerContext } from '../context';
import { DocListItem } from './doc-list-item';
import { DocsGraph } from './docs-graph';
import * as styles from './docs-list.css';

const GroupHeader = memo(function GroupHeader({
  groupId,
  collapsed,
  itemCount,
}: {
  groupId: string;
  collapsed?: boolean;
  itemCount: number;
}) {
  const contextValue = useContext(DocExplorerContext);
  const propertyService = useService(WorkspacePropertyService);
  const allProperties = useLiveData(propertyService.sortedProperties$);
  const groupBy = useLiveData(contextValue.groupBy$);

  const groupType = groupBy?.type;
  const groupKey = groupBy?.key;

  const header = useMemo(() => {
    if (groupType === 'system') {
      const property = groupKey && SystemPropertyTypes[groupKey];
      if (!property) return null;
      const GroupHeader = property.groupHeader;
      if (!GroupHeader) return null;
      return (
        <GroupHeader
          groupId={groupId}
          docCount={itemCount}
          collapsed={!!collapsed}
        />
      );
    } else if (groupType === 'property') {
      const property = allProperties.find(p => p.id === groupKey);
      if (!property) return null;

      const config = WorkspacePropertyTypes[property.type];
      if (!config?.groupHeader) return null;
      return (
        <config.groupHeader
          groupId={groupId}
          docCount={itemCount}
          collapsed={!!collapsed}
        />
      );
    } else {
      console.warn('unsupported group type', groupType);
      return null;
    }
  }, [allProperties, collapsed, groupId, groupKey, groupType, itemCount]);

  if (!groupType) {
    return null;
  }

  return header;
});

const ratios = [1.26, 1.304, 1.13, 1.391, 1.521];
const calcCardRatioById = (id: string) => {
  if (!id) {
    return ratios[0];
  }
  const code = id.charCodeAt(0);
  return ratios[code % ratios.length];
};

export const DocListItemComponent = memo(function DocListItemComponent({
  itemId,
  groupId,
}: {
  groupId: string;
  itemId: string;
}) {
  return <DocListItem docId={itemId} groupId={groupId} />;
});

// Trigger button for the folder picker — matches FloatingToolbar.Button style
const FolderPickerMenuTrigger = () => {
  return (
    <button
      data-testid="list-toolbar-move-to-folder"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: 32,
        padding: '0 6px',
        borderRadius: 'var(--affine-radius-sm)',
        border: 'none',
        background: 'transparent',
        cursor: 'pointer',
        color: 'inherit',
        fontSize: 20,
      }}
      onMouseEnter={e =>
        ((e.currentTarget as HTMLElement).style.background =
          'var(--affine-hover-color)')
      }
      onMouseLeave={e =>
        ((e.currentTarget as HTMLElement).style.background = 'transparent')
      }
    >
      <FolderIcon />
    </button>
  );
};

// Single folder item in the picker
const FolderPickerItem = ({
  node,
  depth,
  onSelect,
}: {
  node: FolderNode;
  depth: number;
  onSelect: (folderId: string) => void;
}) => {
  const name = useLiveData(node.name$);
  const type = useLiveData(node.type$);
  const children = useLiveData(node.sortedChildren$);
  const t = useI18n();

  if (type !== 'folder' || !node.id) return null;

  return (
    <>
      <MenuItem
        prefixIcon={<FolderIcon />}
        style={{ paddingLeft: 12 + depth * 16 }}
        onClick={() => node.id && onSelect(node.id)}
      >
        {name || t['Untitled']()}
      </MenuItem>
      {(children as FolderNode[]).map(child => (
        <FolderPickerItem
          key={child.id}
          node={child}
          depth={depth + 1}
          onSelect={onSelect}
        />
      ))}
    </>
  );
};

const FolderPickerMenu = ({
  onSelect,
}: {
  onSelect: (folderId: string) => void;
}) => {
  const t = useI18n();
  const organizeService = useService(OrganizeService);
  const rootFolder = organizeService.folderTree.rootFolder;
  const children = useLiveData(rootFolder.sortedChildren$);

  if (children.length === 0) {
    return (
      <MenuItem disabled>
        {t['com.affine.rootAppSidebar.organize.empty']?.() ?? 'No folders yet'}
      </MenuItem>
    );
  }

  return (
    <>
      {(children as FolderNode[]).map(node => (
        <FolderPickerItem
          key={node.id}
          node={node}
          depth={0}
          onSelect={onSelect}
        />
      ))}
    </>
  );
};

export const DocsExplorer = ({
  className,
  disableMultiSelectToolbar,
  disableMultiDelete,
  masonryItemWidthMin,
  onRestore,
  onDelete,
}: {
  className?: string;
  disableMultiSelectToolbar?: boolean;
  disableMultiDelete?: boolean;
  masonryItemWidthMin?: number;
  onRestore?: (ids: string[]) => void;
  /** Override the default delete action */
  onDelete?: (
    ids: string[],
    callbacks?: {
      onFinished?: () => void;
      onAbort?: () => void;
      onError?: (error: Error) => void;
    }
  ) => void;
}) => {
  const t = useI18n();
  const contextValue = useContext(DocExplorerContext);
  const docsService = useService(DocsService);
  const favAdapter = useService(CompatibleFavoriteItemsAdapter);
  const organizeService = useService(OrganizeService);

  const groupBy = useLiveData(contextValue.groupBy$);
  const groups = useLiveData(contextValue.groups$);
  const view = useLiveData(contextValue.view$);
  const selectMode = useLiveData(contextValue.selectMode$);
  const selectedDocIds = useLiveData(contextValue.selectedDocIds$);
  const collapsedGroups = useLiveData(contextValue.collapsedGroups$);

  const { openConfirmModal } = useConfirmModal();

  const masonryItems = useMemo(() => {
    const items = groups.map((group: any) => {
      return {
        id: group.key,
        Component: groupBy ? GroupHeader : undefined,
        height: groupBy ? 24 : 0,
        className: styles.groupHeader,
        items: group.items.map((docId: string) => {
          if (view === 'list') {
            return {
              id: docId,
              Component: DocListItemComponent,
              height: 42,
            } satisfies MasonryItem;
          }
          return {
            id: docId,
            Component: DocListItemComponent,
            ratio: view === 'grid' ? ratios[0] : calcCardRatioById(docId),
          } satisfies MasonryItem;
        }),
      } satisfies MasonryGroup;
    });
    return items;
  }, [groupBy, groups, view]);

  const handleCloseFloatingToolbar = useCallback(() => {
    contextValue.selectMode$?.next(false);
    contextValue.selectedDocIds$.next([]);
  }, [contextValue]);

  const handleFavorite = useCallback(() => {
    const ids = contextValue.selectedDocIds$.value;
    for (const docId of ids) {
      favAdapter.toggle(docId, 'doc');
    }
    handleCloseFloatingToolbar();
  }, [contextValue.selectedDocIds$, favAdapter, handleCloseFloatingToolbar]);

  const handleMoveToFolder = useCallback(
    (folderId: string) => {
      const ids = contextValue.selectedDocIds$.value;
      const folder = organizeService.folderTree.folderNode$(folderId).value;
      if (!folder) return;
      for (const docId of ids) {
        const index = folder.indexAt('after');
        folder.createLink('doc', docId, index);
      }
      handleCloseFloatingToolbar();
    },
    [contextValue.selectedDocIds$, organizeService, handleCloseFloatingToolbar]
  );

  const handleMultiDelete = useCallback(() => {
    if (disableMultiDelete) {
      handleCloseFloatingToolbar();
      return;
    }
    if (selectedDocIds.length === 0) {
      return;
    }
    if (onDelete) {
      onDelete(contextValue.selectedDocIds$.value, {
        onFinished: () => {
          handleCloseFloatingToolbar();
        },
      });
      return;
    }

    openConfirmModal({
      title: t['com.affine.moveToTrash.confirmModal.title.multiple']({
        number: selectedDocIds.length.toString(),
      }),
      description: t[
        'com.affine.moveToTrash.confirmModal.description.multiple'
      ]({
        number: selectedDocIds.length.toString(),
      }),
      cancelText: t['com.affine.confirmModal.button.cancel'](),
      confirmText: t.Delete(),
      confirmButtonOptions: {
        variant: 'error',
      },
      onConfirm: () => {
        const selectedDocIds = contextValue.selectedDocIds$.value;
        for (const docId of selectedDocIds) {
          const doc = docsService.list.doc$(docId).value;
          doc?.moveToTrash();
        }
        handleCloseFloatingToolbar();
      },
    });
  }, [
    contextValue.selectedDocIds$,
    disableMultiDelete,
    docsService.list,
    handleCloseFloatingToolbar,
    onDelete,
    openConfirmModal,
    selectedDocIds.length,
    t,
  ]);
  const handleMultiRestore = useCallback(() => {
    const selectedDocIds = contextValue.selectedDocIds$.value;
    onRestore?.(selectedDocIds);
    handleCloseFloatingToolbar();
  }, [
    contextValue.selectedDocIds$.value,
    handleCloseFloatingToolbar,
    onRestore,
  ]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        contextValue.selectMode$?.next(false);
        contextValue.selectedDocIds$.next([]);
        contextValue.prevCheckAnchorId$?.next(null);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [contextValue]);

  const responsivePaddingX = useCallback(
    (w: number) => (w > 500 ? 24 : w > 393 ? 20 : 16),
    []
  );

  const isEmpty = masonryItems.length === 0;

  if (view === 'graph') {
    return <DocsGraph />;
  }

  if (isEmpty) {
    return <EmptyDocs allowCreate={false} style={{ height: '100%' }} />;
  }

  return (
    <>
      <Masonry
        className={className}
        items={masonryItems}
        gapY={BUILD_CONFIG.isMobileEdition ? 12 : view === 'list' ? 12 : 24}
        gapX={BUILD_CONFIG.isMobileEdition ? 12 : 24}
        groupsGap={12}
        groupHeaderGapWithItems={12}
        columns={view === 'list' ? 1 : undefined}
        itemWidthMin={masonryItemWidthMin ?? 220}
        preloadHeight={100}
        itemWidth={'stretch'}
        virtualScroll
        collapsedGroups={collapsedGroups}
        paddingY={BUILD_CONFIG.isMobileEdition ? 12 : 0}
        paddingX={BUILD_CONFIG.isMobileEdition ? 16 : responsivePaddingX}
      />
      {!disableMultiSelectToolbar || onRestore ? (
        <ListFloatingToolbar
          open={!!selectMode}
          onDelete={disableMultiDelete ? undefined : handleMultiDelete}
          onRestore={onRestore ? handleMultiRestore : undefined}
          onClose={handleCloseFloatingToolbar}
          onFavorite={!onRestore ? handleFavorite : undefined}
          moveToFolderButton={
            !onRestore ? (
              <Menu
                items={<FolderPickerMenu onSelect={handleMoveToFolder} />}
                contentOptions={{ side: 'top', sideOffset: 8 }}
              >
                <FolderPickerMenuTrigger />
              </Menu>
            ) : undefined
          }
          content={
            <Trans
              i18nKey="com.affine.page.toolbar.selected"
              count={selectedDocIds.length}
            >
              <div style={{ color: cssVarV2.text.secondary }}>
                {{ count: selectedDocIds.length } as any}
              </div>
              selected
            </Trans>
          }
        />
      ) : null}
    </>
  );
};
