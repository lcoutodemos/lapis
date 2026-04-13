import { cssVarV2 } from '@toeverything/theme/v2';
import { keyframes, style } from '@vanilla-extract/css';

export const container = style({
  position: 'relative',
  width: '100%',
  height: '100%',
  minHeight: '400px',
  overflow: 'hidden',
  background: cssVarV2('layer/background/primary'),
  cursor: 'grab',
  selectors: {
    '&:active': {
      cursor: 'grabbing',
    },
  },
});

export const canvas = style({
  display: 'block',
  width: '100%',
  height: '100%',
});

export const emptyState = style({
  position: 'absolute',
  inset: 0,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '8px',
  color: cssVarV2('text/secondary'),
  fontSize: '14px',
  pointerEvents: 'none',
});

// --- node preview card ---

const previewEnter = keyframes({
  from: {
    opacity: 0,
    transform: 'translateY(7px) scale(0.94)',
  },
  to: {
    opacity: 1,
    transform: 'translateY(0) scale(1)',
  },
});

const previewExit = keyframes({
  from: {
    opacity: 1,
    transform: 'translateY(0) scale(1)',
  },
  to: {
    opacity: 0,
    transform: 'translateY(5px) scale(0.96)',
  },
});

// Shared base for both card states — fixed height so every card is
// the same size and always the same distance from the node
const previewCardBase = {
  position: 'absolute' as const,
  pointerEvents: 'none' as const,
  width: '220px',
  height: '164px',
  borderRadius: 'var(--affine-radius-md)',
  background: cssVarV2('layer/background/overlayPanel'),
  border: `0.5px solid ${cssVarV2('layer/insideBorder/border')}`,
  boxShadow:
    '0px 8px 28px rgba(0, 0, 0, 0.10), 0px 2px 8px rgba(0, 0, 0, 0.06)',
  overflow: 'hidden',
  zIndex: 20,
  display: 'flex' as const,
  flexDirection: 'column' as const,
};

export const previewCard = style({
  ...previewCardBase,
  animation: `${previewEnter} 200ms cubic-bezier(0.16, 1, 0.3, 1) forwards`,
});

export const previewCardExiting = style({
  ...previewCardBase,
  animation: `${previewExit} 140ms cubic-bezier(0.4, 0, 1, 1) forwards`,
});

export const previewHeader = style({
  display: 'flex',
  alignItems: 'center',
  gap: '7px',
  padding: '12px 12px 8px',
});

export const previewIcon = style({
  fontSize: '18px',
  flexShrink: 0,
  color: cssVarV2('icon/primary'),
  lineHeight: 0,
  display: 'flex',
  alignItems: 'center',
});

export const previewTitle = style({
  fontSize: '13px',
  fontWeight: 600,
  lineHeight: '20px',
  color: cssVarV2('text/primary'),
  letterSpacing: '-0.1px',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  flex: 1,
  minWidth: 0,
});

export const previewBody = style({
  padding: '8px 12px 10px',
  fontSize: '11.5px',
  lineHeight: '18px',
  color: cssVarV2('text/secondary'),
  flex: 1,
  overflow: 'hidden',
  // clamp overflow text with a fade rather than hard ellipsis
  maskImage: 'linear-gradient(to bottom, black 60%, transparent 100%)',
  WebkitMaskImage: 'linear-gradient(to bottom, black 60%, transparent 100%)',
});

export const previewBodyEmpty = style({
  padding: '8px 12px 10px',
  fontSize: '11.5px',
  lineHeight: '18px',
  color: cssVarV2('text/disable'),
  fontStyle: 'italic',
  flex: 1,
});

export const previewDivider = style({
  height: '0.5px',
  background: cssVarV2('layer/insideBorder/border'),
  margin: '0 12px',
});

export const previewMeta = style({
  padding: '7px 12px 9px',
  display: 'flex',
  alignItems: 'center',
  gap: '12px',
});

export const previewMetaItem = style({
  fontSize: '10.5px',
  lineHeight: '16px',
  color: cssVarV2('text/disable'),
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});
