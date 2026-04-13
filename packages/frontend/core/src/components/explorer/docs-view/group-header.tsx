import { Checkbox, IconButton } from '@affine/component';
import { ToggleRightIcon } from '@blocksuite/icons/rc';
import { useLiveData } from '@toeverything/infra';
import clsx from 'clsx';
import {
  type HTMLAttributes,
  type ReactNode,
  useCallback,
  useContext,
} from 'react';

import { DocExplorerContext } from '../context';
import * as styles from './group-header.css';

export const DocGroupHeader = ({
  className,
  groupId,
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  groupId: string;
}) => {
  const contextValue = useContext(DocExplorerContext);

  const groups = useLiveData(contextValue.groups$);
  const selectedDocIds = useLiveData(contextValue.selectedDocIds$);
  const collapsedGroups = useLiveData(contextValue.collapsedGroups$);

  const group = groups.find(
    (g: { key: string; items: string[] }) => g.key === groupId
  );
  const groupItems: string[] = group?.items ?? [];
  const isGroupAllSelected =
    groupItems.length > 0 &&
    groupItems.every((id: string) => selectedDocIds.includes(id));
  const isGroupSomeSelected =
    groupItems.some((id: string) => selectedDocIds.includes(id)) &&
    !isGroupAllSelected;

  const handleToggleCollapse = useCallback(() => {
    const prev = contextValue.collapsedGroups$.value;
    contextValue.collapsedGroups$.next(
      prev.includes(groupId)
        ? prev.filter((id: string) => id !== groupId)
        : [...prev, groupId]
    );
  }, [groupId, contextValue]);

  const handleGroupCheckbox = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      const items: string[] =
        groups.find((g: { key: string; items: string[] }) => g.key === groupId)
          ?.items ?? [];
      if (!contextValue.selectMode$?.value) {
        contextValue.selectMode$?.next(true);
      }
      const prev = contextValue.selectedDocIds$.value;
      const allSelected =
        items.length > 0 && items.every((id: string) => prev.includes(id));
      if (allSelected) {
        contextValue.selectedDocIds$.next(
          prev.filter((id: string) => !items.includes(id))
        );
      } else {
        const newSelected = [...prev];
        items.forEach((id: string) => {
          if (!newSelected.includes(id)) newSelected.push(id);
        });
        contextValue.selectedDocIds$.next(newSelected);
      }
    },
    [contextValue, groupId, groups]
  );

  return (
    <div
      className={styles.groupHeader}
      data-collapsed={collapsedGroups.includes(groupId)}
    >
      <div className={styles.groupCheckbox} onClick={handleGroupCheckbox}>
        <Checkbox
          checked={isGroupAllSelected}
          indeterminate={isGroupSomeSelected}
          onChange={() => {}}
        />
      </div>
      <div className={clsx(styles.content, className)} {...props} />
      <IconButton
        className={styles.collapseButton}
        icon={<ToggleRightIcon className={styles.collapseButtonIcon} />}
        onClick={handleToggleCollapse}
      />
      <div className={styles.space} />
    </div>
  );
};

export const PlainTextDocGroupHeader = ({
  groupId,
  docCount,
  className,
  children,
  icon,
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  groupId: string;
  docCount: number;
  icon?: ReactNode;
}) => {
  return (
    <DocGroupHeader
      className={clsx(styles.plainTextGroupHeader, className)}
      groupId={groupId}
      {...props}
    >
      {icon ? (
        <div className={styles.plainTextGroupHeaderIcon}>{icon}</div>
      ) : null}
      <div>{children ?? groupId}</div>
      <div>·</div>
      <div>{docCount}</div>
    </DocGroupHeader>
  );
};
