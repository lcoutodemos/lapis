import { cssVar } from '@toeverything/theme';
import { style } from '@vanilla-extract/css';

export const draggedOverHighlight = style({
  selectors: {
    '&[data-dragged-over="true"]': {
      background: cssVar('--affine-hover-color'),
      borderRadius: 'var(--affine-radius-xs)',
    },
  },
});
