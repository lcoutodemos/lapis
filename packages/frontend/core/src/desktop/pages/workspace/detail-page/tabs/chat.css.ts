import { cssVarV2 } from '@toeverything/theme/v2';
import { globalStyle, style } from '@vanilla-extract/css';

export const root = style({
  display: 'flex',
  flexDirection: 'column',
  height: '100%',
  width: '100%',
  userSelect: 'text',
});

export const container = style({
  display: 'flex',
  flexDirection: 'column',
  height: '100%',
});

export const header = style({
  background: 'var(--affine-background-primary-color)',
  position: 'relative',
  padding: '8px var(--h-padding, 16px)',
  width: '100%',
  height: '36px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  zIndex: 1,
});

export const title = style({
  fontSize: '14px',
  fontWeight: 500,
  color: 'var(--affine-text-secondary-color)',
  display: 'flex',
  alignItems: 'center',
});

export const providerButton = style({
  display: 'flex',
  alignItems: 'center',
  gap: '4px',
  cursor: 'pointer',
  borderRadius: 'var(--affine-radius-xs)',
  padding: '2px 4px',
  margin: '-2px -4px',
  fontSize: '14px',
  fontWeight: 500,
  color: 'var(--affine-text-secondary-color)',
  userSelect: 'none',
  ':hover': {
    background: 'var(--affine-hover-color)',
    color: 'var(--affine-text-primary-color)',
  },
});

export const modelBadge = style({
  fontSize: '11px',
  fontWeight: 400,
  color: 'var(--affine-text-disable-color)',
  background: 'var(--affine-hover-color)',
  borderRadius: 'var(--affine-radius-xs)',
  padding: '1px 5px',
  lineHeight: '16px',
});

export const providerChevron = style({
  width: '14px',
  height: '14px',
  flexShrink: 0,
  color: 'var(--affine-text-disable-color)',
});

export const playground = style({
  cursor: 'pointer',
  padding: '2px',
  marginLeft: '8px',
  marginRight: 'auto',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
});

export const content = style({
  flexGrow: 1,
  height: 0,
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
  width: '100%',
});

export const loadingContainer = style({
  position: 'relative',
  padding: '44px 0 166px 0',
  height: '100%',
  display: 'flex',
  alignItems: 'center',
});

export const loading = style({
  width: '100%',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: '12px',
});

export const loadingTitle = style({
  fontWeight: 600,
  fontSize: 'var(--affine-font-sm)',
  color: 'var(--affine-text-secondary-color)',
});

export const loadingIcon = style({
  width: '44px',
  height: '44px',
  color: 'var(--affine-icon-secondary)',
});

globalStyle(`${playground} svg`, {
  width: '18px',
  height: '18px',
  color: 'var(--affine-text-secondary-color)',
});

globalStyle(`${playground}:hover svg`, {
  color: cssVarV2('icon/activated'),
});

globalStyle(`${content} > ai-chat-content`, {
  flexGrow: 1,
  height: 0,
  minHeight: 0,
  width: '100%',
});
