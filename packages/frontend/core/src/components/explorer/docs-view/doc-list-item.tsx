import {
  Checkbox,
  ContextMenu,
  DragHandle as DragHandleIcon,
  Tooltip,
  useDraggable,
} from '@affine/component';
import { DocsService } from '@affine/core/modules/doc';
import { DocDisplayMetaService } from '@affine/core/modules/doc-display-meta';
import { WorkbenchLink } from '@affine/core/modules/workbench';
import type { AffineDNDData } from '@affine/core/types/dnd';
import { useI18n } from '@affine/i18n';
import track from '@affine/track';
import {
  AutoTidyUpIcon,
  MindmapNodeIcon,
  PropertyIcon,
  ResizeTidyUpIcon,
} from '@blocksuite/icons/rc';
import { useLiveData, useService } from '@toeverything/infra';
import {
  type HTMLProps,
  memo,
  type ReactNode,
  type SVGProps,
  useCallback,
  useContext,
  useEffect,
  useRef,
} from 'react';

import { PagePreview } from '../../page-list/page-content-preview';
import { DocExplorerContext, type DocExplorerContextType } from '../context';
import { quickActions } from '../quick-actions.constants';
import * as styles from './doc-list-item.css';
import { MoreMenuButton, MoreMenuContent } from './more-menu';
import { CardViewProperties, ListViewProperties } from './properties';

export type DocListItemView = 'list' | 'grid' | 'masonry' | 'graph';

export const DocListViewIcon = ({
  view,
  ...props
}: { view: DocListItemView } & SVGProps<SVGSVGElement>) => {
  const Component = {
    list: PropertyIcon,
    grid: ResizeTidyUpIcon,
    masonry: AutoTidyUpIcon,
    graph: MindmapNodeIcon,
  }[view];

  return <Component {...props} />;
};

export interface DocListItemProps {
  docId: string;
  groupId: string;
}

class MixId {
  static connector = '||';
  static create(groupId: string, docId: string) {
    return `${groupId}${this.connector}${docId}`;
  }
  static parse(mixId: string) {
    if (!mixId) {
      return { groupId: null, docId: null };
    }
    const [groupId, docId] = mixId.split(this.connector);
    return { groupId, docId };
  }
}
export const DocListItem = ({ ...props }: DocListItemProps) => {
  const contextValue = useContext(DocExplorerContext);
  const view = useLiveData(contextValue.view$) ?? 'list';
  const groups = useLiveData(contextValue.groups$);
  const selectMode = useLiveData(contextValue.selectMode$);
  const selectedDocIds = useLiveData(contextValue.selectedDocIds$);
  const prevCheckAnchorId = useLiveData(contextValue.prevCheckAnchorId$);

  const handleMultiSelect = useCallback(
    (prevCursor: string, currCursor: string) => {
      const flattenList = groups.flatMap(group =>
        group.items.map(docId => MixId.create(group.key, docId))
      );

      const prev = contextValue.selectedDocIds$?.value ?? [];
      const prevIndex = flattenList.indexOf(prevCursor);
      const currIndex = flattenList.indexOf(currCursor);

      const lowerIndex = Math.min(prevIndex, currIndex);
      const upperIndex = Math.max(prevIndex, currIndex);

      const resSet = new Set(prev);
      const handledSet = new Set<string>();
      for (let i = lowerIndex; i <= upperIndex; i++) {
        const mixId = flattenList[i];
        const { groupId, docId } = MixId.parse(mixId);
        if (groupId === null || docId === null) {
          continue;
        }
        if (handledSet.has(docId) || mixId === prevCursor) {
          continue;
        }
        if (resSet.has(docId)) {
          resSet.delete(docId);
        } else {
          resSet.add(docId);
        }
        handledSet.add(docId);
      }

      contextValue.selectedDocIds$?.next(Array.from(resSet));
      contextValue.prevCheckAnchorId$?.next(currCursor);
    },
    [contextValue, groups]
  );

  const handleClick = useCallback(
    (e: React.MouseEvent<Element>) => {
      const { docId, groupId } = props;
      const currCursor = MixId.create(groupId, docId);
      if (selectMode || e.shiftKey) {
        e.preventDefault();
      }

      if (selectMode) {
        if (e.shiftKey && prevCheckAnchorId) {
          // do multi select
          handleMultiSelect(prevCheckAnchorId, currCursor);
        } else {
          contextValue.selectedDocIds$?.next(
            contextValue.selectedDocIds$.value.includes(docId)
              ? contextValue.selectedDocIds$.value.filter(id => id !== docId)
              : [...contextValue.selectedDocIds$.value, docId]
          );
          contextValue.prevCheckAnchorId$?.next(currCursor);
        }
      } else {
        if (e.shiftKey) {
          contextValue.selectMode$?.next(true);
          contextValue.selectedDocIds$?.next([docId]);
          contextValue.prevCheckAnchorId$?.next(currCursor);
          return;
        } else {
          // as link
          track.allDocs.list.doc.openDoc();
          return;
        }
      }
    },
    [contextValue, handleMultiSelect, prevCheckAnchorId, props, selectMode]
  );

  const isPartOfMultiSelect =
    !!selectMode && selectedDocIds.includes(props.docId);

  const { dragRef, CustomDragPreview } = useDraggable<AffineDNDData>(
    () => ({
      canDrag: true,
      data: {
        entity: {
          type: 'doc',
          id: props.docId as string,
        },
        from: {
          at: 'all-docs:list',
        },
        ...(isPartOfMultiSelect ? { docIds: selectedDocIds } : {}),
      },
    }),
    [props.docId, isPartOfMultiSelect, selectedDocIds]
  );

  // Ref to the always-rendered, off-screen multi-drag preview element.
  // We override the native drag image in a dragstart listener (registered
  // AFTER atlaskit's listener so our setDragImage wins).
  const multiDragPreviewRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = dragRef.current;
    if (!element) return;
    const onDragStart = (e: DragEvent) => {
      // Read BehaviorSubject values synchronously — guaranteed current
      const currentSelectMode = contextValue.selectMode$?.value;
      const currentSelectedDocIds = contextValue.selectedDocIds$.value;
      const isMulti =
        !!currentSelectMode &&
        currentSelectedDocIds.includes(props.docId) &&
        currentSelectedDocIds.length > 1;
      if (isMulti && multiDragPreviewRef.current && e.dataTransfer) {
        // Override atlaskit's single-card preview with our stacked preview
        e.dataTransfer.setDragImage(multiDragPreviewRef.current, 30, 25);
      }
    };
    element.addEventListener('dragstart', onDragStart);
    return () => element.removeEventListener('dragstart', onDragStart);
  }, [contextValue, dragRef, props.docId]);

  return (
    <>
      <WorkbenchLink
        ref={dragRef}
        draggable={false}
        to={`/${props.docId}`}
        onClick={handleClick}
        data-selected={selectedDocIds.includes(props.docId)}
        className={styles.root}
        data-testid={`doc-list-item`}
        data-doc-id={props.docId}
      >
        {view === 'list' ? (
          <ListViewDoc {...props} />
        ) : (
          <CardViewDoc {...props} />
        )}
      </WorkbenchLink>
      <CustomDragPreview>
        <DocDragPreview docId={props.docId} contextValue={contextValue} />
      </CustomDragPreview>
      {/* Off-screen live preview used as the native drag image for multi-drag.
          Rendered by React so it's always up-to-date with selectedDocIds. */}
      <div
        ref={multiDragPreviewRef}
        style={{
          position: 'fixed',
          top: -9999,
          left: -9999,
          pointerEvents: 'none',
          zIndex: -1,
        }}
      >
        {selectedDocIds.length > 1 && (
          <MultiDocDragPreview
            docIds={selectedDocIds}
            primaryDocId={props.docId}
          />
        )}
      </div>
    </>
  );
};

/**
 * Reads the select-mode state directly from BehaviorSubject `.value` at
 * render time. This is intentional: during the flushSync inside
 * onGenerateDragPreview, useSyncExternalStore (which backs useLiveData) may
 * return a stale snapshot, while `.value` on a BehaviorSubject is always
 * synchronously current.
 */
const DocDragPreview = memo(function DocDragPreview({
  docId,
  contextValue,
}: {
  docId: string;
  contextValue: DocExplorerContextType;
}) {
  const selectMode = contextValue.selectMode$?.value;
  const selectedDocIds = contextValue.selectedDocIds$.value;
  const isMulti =
    !!selectMode && selectedDocIds.includes(docId) && selectedDocIds.length > 1;

  if (isMulti) {
    return <MultiDocDragPreview docIds={selectedDocIds} primaryDocId={docId} />;
  }
  return (
    <div className={styles.dragPreview}>
      <RawDocIcon id={docId} className={styles.dragPreviewIcon} />
      <RawDocTitle id={docId} />
    </div>
  );
});

const CARD_STYLES = [
  styles.multiDragPreviewCard0,
  styles.multiDragPreviewCard1,
  styles.multiDragPreviewCard2,
] as const;

const MultiDocDragPreview = memo(function MultiDocDragPreview({
  docIds,
  primaryDocId,
}: {
  docIds: string[];
  primaryDocId: string;
}) {
  // Primary doc is always on top (front). Show up to 2 others behind it.
  const others = docIds.filter(id => id !== primaryDocId).slice(0, 2);
  const stack = [...others, primaryDocId]; // last = highest z-index (front)
  const startStyleIndex = 3 - stack.length; // align to card0/1/2

  return (
    <div className={styles.multiDragPreviewContainer}>
      {stack.map((id, i) => (
        <div key={id} className={CARD_STYLES[startStyleIndex + i]}>
          <RawDocIcon id={id} className={styles.dragPreviewIcon} />
          <RawDocTitle id={id} />
        </div>
      ))}
    </div>
  );
});

const RawDocIcon = memo(function RawDocIcon({
  id,
  ...props
}: HTMLProps<SVGSVGElement>) {
  const docDisplayMetaService = useService(DocDisplayMetaService);
  const Icon = useLiveData(id ? docDisplayMetaService.icon$(id) : null);
  return <Icon {...props} />;
});
const RawDocTitle = memo(function RawDocTitle({ id }: { id: string }) {
  const docDisplayMetaService = useService(DocDisplayMetaService);
  const title = useLiveData(docDisplayMetaService.title$(id));
  return title;
});
const RawDocPreview = memo(function RawDocPreview({
  id,
  loading,
}: {
  id: string;
  loading?: ReactNode;
}) {
  return <PagePreview pageId={id} fallback={loading} />;
});
const DragHandle = memo(function DragHandle({
  id,
  ...props
}: HTMLProps<HTMLDivElement>) {
  const contextValue = useContext(DocExplorerContext);
  const showDragHandle = useLiveData(contextValue.showDragHandle$);

  if (!id || !showDragHandle) {
    return null;
  }

  return (
    <div {...props}>
      <DragHandleIcon />
    </div>
  );
});
const Select = memo(function Select({
  id,
  groupId,
  ...props
}: HTMLProps<HTMLDivElement> & { groupId?: string }) {
  const contextValue = useContext(DocExplorerContext);
  const selectMode = useLiveData(contextValue.selectMode$);
  const selectedDocIds = useLiveData(contextValue.selectedDocIds$);

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (!id) return;

      if (!selectMode) {
        // Enter select mode and select this doc
        contextValue.selectMode$?.next(true);
        contextValue.selectedDocIds$?.next([id]);
        if (groupId) {
          contextValue.prevCheckAnchorId$?.next(MixId.create(groupId, id));
        }
      } else {
        // Toggle selection
        contextValue.selectedDocIds$?.next(
          selectedDocIds.includes(id)
            ? selectedDocIds.filter((x: string) => x !== id)
            : [...selectedDocIds, id]
        );
        if (groupId) {
          contextValue.prevCheckAnchorId$?.next(MixId.create(groupId, id));
        }
      }
    },
    [id, groupId, selectMode, contextValue, selectedDocIds]
  );

  if (!id) {
    return null;
  }

  return (
    <div
      data-select-mode={selectMode}
      data-testid={`doc-list-item-select`}
      onClick={handleClick}
      {...props}
    >
      <Checkbox checked={selectedDocIds.includes(id)} onChange={() => {}} />
    </div>
  );
});
// Different with RawDocIcon, refer to `ExplorerDisplayPreference.showDocIcon`
const DocIcon = memo(function DocIcon({
  id,
  ...props
}: HTMLProps<HTMLDivElement>) {
  const contextValue = useContext(DocExplorerContext);
  const showDocIcon = useLiveData(contextValue.showDocIcon$);
  if (!showDocIcon) {
    return null;
  }
  return (
    <div {...props}>
      <RawDocIcon id={id} />
    </div>
  );
});
const DocTitle = memo(function DocTitle({
  id,
  ...props
}: HTMLProps<HTMLDivElement>) {
  if (!id) return null;
  return (
    <div {...props}>
      <RawDocTitle id={id} />
    </div>
  );
});
const DocPreview = memo(function DocPreview({
  id,
  loading,
  ...props
}: HTMLProps<HTMLDivElement> & { loading?: ReactNode }) {
  const contextValue = useContext(DocExplorerContext);
  const showDocPreview = useLiveData(contextValue.showDocPreview$);

  if (!id || !showDocPreview) return null;

  return (
    <div {...props}>
      <RawDocPreview id={id} loading={loading} />
    </div>
  );
});

const listMoreMenuContentOptions = {
  side: 'bottom',
  align: 'end',
  sideOffset: 12,
  alignOffset: -4,
} as const;
export const ListViewDoc = ({ docId, groupId }: DocListItemProps) => {
  const t = useI18n();
  const docsService = useService(DocsService);
  const doc = useLiveData(docsService.list.doc$(docId));
  const contextValue = useContext(DocExplorerContext);
  const showMoreOperation = useLiveData(contextValue.showMoreOperation$);

  if (!doc) {
    return null;
  }

  return (
    <ContextMenu
      asChild
      disabled={!showMoreOperation}
      items={<MoreMenuContent docId={docId} />}
    >
      <li className={styles.listViewRoot}>
        <DragHandle id={docId} className={styles.listDragHandle} />
        <Select id={docId} groupId={groupId} className={styles.listSelect} />
        <DocIcon id={docId} className={styles.listIcon} />
        <div className={styles.listBrief}>
          <DocTitle
            id={docId}
            className={styles.listTitle}
            data-testid="doc-list-item-title"
          />
          <DocPreview id={docId} className={styles.listPreview} />
        </div>
        <div className={styles.listSpace} />
        <ListViewProperties docId={docId} />
        {quickActions.map(action => {
          return (
            <Tooltip key={action.key} content={t.t(action.name)}>
              <action.Component doc={doc} />
            </Tooltip>
          );
        })}
        <MoreMenuButton
          docId={docId}
          contentOptions={listMoreMenuContentOptions}
        />
      </li>
    </ContextMenu>
  );
};

const cardMoreMenuContentOptions = {
  side: 'bottom',
  align: 'end',
  sideOffset: 12,
  alignOffset: -4,
} as const;

export const CardViewDoc = ({ docId }: DocListItemProps) => {
  const t = useI18n();
  const contextValue = useContext(DocExplorerContext);
  const selectMode = useLiveData(contextValue.selectMode$);
  const docsService = useService(DocsService);
  const doc = useLiveData(docsService.list.doc$(docId));
  const showMoreOperation = useLiveData(contextValue.showMoreOperation$);

  if (!doc) {
    return null;
  }

  return (
    <ContextMenu
      asChild
      disabled={!showMoreOperation}
      items={<MoreMenuContent docId={docId} />}
    >
      <li className={styles.cardViewRoot}>
        <DragHandle id={docId} className={styles.cardDragHandle} />
        <header className={styles.cardViewHeader}>
          <DocIcon id={docId} className={styles.cardViewIcon} />
          <DocTitle
            id={docId}
            className={styles.cardViewTitle}
            data-testid="doc-list-item-title"
          />
          {quickActions.map(action => {
            return (
              <Tooltip key={action.key} content={t.t(action.name)}>
                <action.Component size="16" doc={doc} />
              </Tooltip>
            );
          })}
          {selectMode ? (
            <Select id={docId} className={styles.cardViewCheckbox} />
          ) : (
            <MoreMenuButton
              docId={docId}
              contentOptions={cardMoreMenuContentOptions}
              iconProps={{ size: '16' }}
            />
          )}
        </header>
        <DocPreview id={docId} className={styles.cardPreviewContainer} />
        <CardViewProperties docId={docId} />
      </li>
    </ContextMenu>
  );
};
