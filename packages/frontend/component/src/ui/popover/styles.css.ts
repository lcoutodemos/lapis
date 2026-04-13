import { cssVar } from '@toeverything/theme';
import { style } from '@vanilla-extract/css';
export const popoverContent = style({
  minWidth: '180px',
  color: cssVar('textPrimaryColor'),
  borderRadius: 'var(--affine-radius-sm)',
  padding: '8px',
  fontSize: cssVar('fontSm'),
  fontWeight: '400',
  backgroundColor: cssVar('backgroundOverlayPanelColor'),
  boxShadow: cssVar('menuShadow'),
  userSelect: 'none',
});
