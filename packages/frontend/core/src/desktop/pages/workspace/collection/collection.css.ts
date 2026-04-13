import { cssVar } from '@toeverything/theme';
import { style } from '@vanilla-extract/css';
export const placeholderButton = style({
  padding: '8px 18px',
  border: `1px solid ${cssVar('borderColor')}`,
  borderRadius: 'var(--affine-radius-sm)',
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  fontWeight: 600,
  cursor: 'pointer',
  fontSize: 15,
  lineHeight: '24px',
  ':hover': {
    backgroundColor: cssVar('hoverColor'),
  },
});
export const button = style({
  userSelect: 'none',
  borderRadius: 'var(--affine-radius-xs)',
  cursor: 'pointer',
  ':hover': {
    backgroundColor: cssVar('hoverColor'),
  },
});
export const headerCreateNewButton = style({
  transition: 'opacity 0.1s ease-in-out',
});
export const headerCreateNewCollectionIconButton = style({
  width: '30px',
  height: '30px',
  borderRadius: 'var(--affine-radius-sm)',
});
export const headerCreateNewButtonHidden = style({
  opacity: 0,
  pointerEvents: 'none',
});
