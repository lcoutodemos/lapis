import { cssVarV2 } from '@toeverything/theme/v2';
import { style } from '@vanilla-extract/css';

export const root = style({
  width: '100%',
  height: '100%',
});

export const dragPreview = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '8px 16px 8px 12px',
  background: cssVarV2.layer.background.primary,
  borderRadius: 'var(--affine-radius-xs)',
  border: `1px solid ${cssVarV2.layer.insideBorder.border}`,
  fontSize: 14,
});
export const dragPreviewIcon = style({
  fontSize: 24,
});

// --- multi-doc drag preview (stacked cards) ---
// NOTE: the native drag preview is a static bitmap snapshot captured by the
// browser — CSS animations are NOT visible. Cards must render at their final
// positions immediately so the snapshot shows the full stack.

export const multiDragPreviewContainer = style({
  position: 'relative',
  width: 250,
  height: 62,
});

const multiDragCard = style({
  position: 'absolute',
  top: 11,
  left: 16,
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '8px 16px 8px 12px',
  maxWidth: 218,
  overflow: 'hidden',
  whiteSpace: 'nowrap',
  background: cssVarV2.layer.background.primary,
  borderRadius: 'var(--affine-radius-xs)',
  border: `1px solid ${cssVarV2.layer.insideBorder.border}`,
  fontSize: 14,
  transformOrigin: 'top left',
  boxShadow: '0 2px 10px rgba(0,0,0,0.13)',
});

/** back card — offset and rotated the most */
export const multiDragPreviewCard0 = style([
  multiDragCard,
  {
    zIndex: 0,
    transform: 'translate(-10px, 8px) rotate(-5deg)',
    opacity: 0.75,
  },
]);

/** middle card */
export const multiDragPreviewCard1 = style([
  multiDragCard,
  {
    zIndex: 1,
    transform: 'translate(-5px, 4px) rotate(-2.5deg)',
    opacity: 0.88,
  },
]);

/** front card — straight, full opacity */
export const multiDragPreviewCard2 = style([
  multiDragCard,
  {
    zIndex: 2,
    opacity: 1,
  },
]);

export const listViewRoot = style({
  padding: '0px 4px',
  width: '100%',
  height: '100%',
  display: 'flex',
  flexDirection: 'row',
  alignItems: 'center',
  gap: 8,
  borderRadius: 'var(--affine-radius-xs)',
  overflow: 'hidden',
  containerName: 'list-view-root',
  containerType: 'size',
  selectors: {
    '&:hover': {
      backgroundColor: cssVarV2.layer.background.hoverOverlay,
    },
  },
});

export const dragHandle = style({
  position: 'absolute',
  padding: '5px 2px',
  color: cssVarV2.icon.secondary,
});
export const listDragHandle = style({
  flexShrink: 0,
  padding: '5px 2px',
  color: cssVarV2.icon.secondary,
  cursor: 'grab',
  opacity: 0,
  selectors: {
    [`${listViewRoot}:hover &`]: {
      opacity: 1,
    },
  },
});
export const listSelect = style({
  width: 20,
  height: 24,
  fontSize: 20,
  padding: 2,
  flexShrink: 0,
  display: 'flex',
  color: cssVarV2.icon.primary,
  alignItems: 'center',
  justifyContent: 'center',
  cursor: 'pointer',
});

export const listIcon = style({
  width: 24,
  height: 24,
  fontSize: 24,
  color: cssVarV2.icon.primary,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
});
export const listContent = style({
  width: 0,
  height: '100%',
  flex: 1,
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  justifyContent: 'space-between',
});
export const listBrief = style({
  height: '100%',
  flexShrink: 10,
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'center',
  marginLeft: 4,
  minWidth: 200,
});
export const listSpace = style({
  width: 0,
  flex: 1,
});
// export const listDetails = style({
//   display: 'flex',
//   gap: 8,
//   alignItems: 'center',
//   flexShrink: 1,
//   minWidth: 0,
//   justifyContent: 'flex-end',
// });
const ellipsis = style({
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});
export const listTitle = style([
  ellipsis,
  {
    fontSize: 14,
    lineHeight: '22px',
    fontWeight: 500,
    color: cssVarV2.text.primary,
  },
]);
export const listPreview = style([
  ellipsis,
  {
    fontSize: 12,
    lineHeight: '20px',
    fontWeight: 400,
    color: cssVarV2.text.secondary,
  },
]);

export const listQuickActions = style({
  display: 'flex',
  gap: 8,
  flexShrink: 0,
});

export const listHide750 = style({
  '@container': {
    'list-view-root (width <= 750px)': {
      display: 'none',
    },
  },
});

export const listHide560 = style({
  '@container': {
    'list-view-root (width <= 560px)': {
      display: 'none',
    },
  },
});

// --- card view ---
export const cardViewRoot = style({
  vars: {
    '--ring-color': 'transparent',
    '--light-shadow':
      '0px 0px 0px 1px var(--ring-color), 0px 2px 3px rgba(0,0,0,.05)',
    '--dark-shadow':
      '0px 0px 0px 1px var(--ring-color), 0px 2px 3px rgba(0,0,0,.05)',
    '--light-shadow-hover':
      '0px 0px 0px 1px var(--ring-color), 0px 4px 6px rgba(0,0,0,.1)',
    '--dark-shadow-hover':
      '0px 0px 0px 1px var(--ring-color), 0px 4px 6px rgba(0,0,0,.1)',
  },
  width: '100%',
  height: '100%',
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  padding: 16,
  borderRadius: 'var(--affine-radius-md)',
  backgroundColor: cssVarV2.layer.background.mobile.secondary,
  border: `0.5px solid ${cssVarV2.layer.insideBorder.border}`,
  // TODO: use variable
  boxShadow: '0px 0px 0px 1px var(--ring-color), 0px 0px 3px rgba(0,0,0,.05)',
  overflow: 'hidden',
  transition: 'box-shadow 0.23s ease, border-color 0.23s ease',
  selectors: {
    [`${root}[data-selected="true"] &`]: {
      vars: {
        '--ring-color': cssVarV2.layer.insideBorder.primaryBorder,
      },
    },
    '&:hover': {
      borderColor: cssVarV2.pagelist.hoverBorder,
    },
    '[data-theme="light"] &': {
      boxShadow: 'var(--light-shadow)',
    },
    '[data-theme="light"] &:hover': {
      boxShadow: 'var(--light-shadow-hover)',
    },
    '[data-theme="dark"] &': {
      boxShadow: 'var(--dark-shadow)',
    },
    '[data-theme="dark"] &:hover': {
      boxShadow: 'var(--dark-shadow-hover)',
    },
  },
});
export const cardViewHeader = style({
  display: 'flex',
  flexDirection: 'row',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
});
export const cardViewIcon = style({
  fontSize: 24,
  color: cssVarV2.icon.primary,
  lineHeight: 0,
});
export const cardViewTitle = style({
  fontSize: 18,
  lineHeight: '26px',
  fontWeight: 600,
  color: cssVarV2.text.primary,
  letterSpacing: '-0.24px',
  width: 0,
  flexGrow: 1,
  flexShrink: 1,
  textOverflow: 'ellipsis',
  overflow: 'hidden',
  whiteSpace: 'nowrap',
});
export const cardPreviewContainer = style({
  width: '100%',
  fontSize: 12,
  lineHeight: '20px',
  fontWeight: 400,
  color: cssVarV2.text.primary,
  minHeight: 20,
  flexGrow: 1,
  flexShrink: 1,
  overflow: 'hidden',
});
export const cardViewCheckbox = style({
  width: 20,
  height: 20,
  fontSize: 16,
  padding: 2,
  color: cssVarV2.icon.primary,
  pointerEvents: 'none',
});
export const cardDragHandle = style([
  dragHandle,
  {
    left: -4,
    top: 0,
    transform: 'translateX(-100%)',
    opacity: 0,
    selectors: {
      [`${cardViewRoot}:hover &`]: {
        opacity: 1,
      },
    },
  },
]);
