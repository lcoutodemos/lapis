import { cssVarV2 } from '@toeverything/theme/v2';
import { style } from '@vanilla-extract/css';

// ── Layout ────────────────────────────────────────────────────────────────────

export const root = style({
  display: 'flex',
  flexDirection: 'row',
  height: '100%',
  width: '100%',
  overflow: 'hidden',
  background: cssVarV2.layer.background.primary,
});

// ── Left Rail ─────────────────────────────────────────────────────────────────

export const rail = style({
  width: 280,
  minWidth: 220,
  maxWidth: 320,
  flexShrink: 0,
  display: 'flex',
  flexDirection: 'column',
  borderRight: `1px solid ${cssVarV2.layer.insideBorder.border}`,
  background: cssVarV2.layer.background.secondary,
  overflow: 'hidden',
});

export const railHeader = style({
  display: 'flex',
  flexDirection: 'row',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '20px 16px 12px 20px',
  flexShrink: 0,
});

export const railTitle = style({
  fontSize: 13,
  fontWeight: 600,
  letterSpacing: '0.02em',
  textTransform: 'uppercase',
  color: cssVarV2.text.secondary,
});

export const createButton = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 28,
  height: 28,
  borderRadius: 6,
  border: 'none',
  background: 'transparent',
  color: cssVarV2.icon.primary,
  cursor: 'pointer',
  transition: 'background 0.15s ease',
  selectors: {
    '&:hover': {
      background: cssVarV2.layer.background.hoverOverlay,
    },
  },
});

export const railList = style({
  flex: 1,
  overflowY: 'auto',
  padding: '0 8px 8px 8px',
});

export const railEmpty = style({
  padding: '16px 12px',
  fontSize: 13,
  color: cssVarV2.text.tertiary,
  textAlign: 'center',
  lineHeight: '1.5',
});

// ── Rail Task Item ─────────────────────────────────────────────────────────────

export const railItem = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 3,
  padding: '8px 10px',
  borderRadius: 8,
  cursor: 'pointer',
  transition: 'background 0.12s ease',
  selectors: {
    '&:hover': {
      background: cssVarV2.layer.background.hoverOverlay,
    },
    '&[data-active="true"]': {
      background: cssVarV2.layer.background.hoverOverlay,
    },
  },
});

export const railItemName = style({
  fontSize: 13,
  fontWeight: 500,
  color: cssVarV2.text.primary,
  overflow: 'hidden',
  whiteSpace: 'nowrap',
  textOverflow: 'ellipsis',
});

export const railItemMeta = style({
  display: 'flex',
  flexDirection: 'row',
  alignItems: 'center',
  gap: 6,
});

export const railItemStatus = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  fontSize: 11,
  fontWeight: 500,
  lineHeight: '16px',
});

export const statusDot = style({
  width: 5,
  height: 5,
  borderRadius: '50%',
  flexShrink: 0,
});

export const statusDotActive = style([statusDot, { background: '#34A853' }]);
export const statusDotPaused = style([
  statusDot,
  { background: cssVarV2.icon.secondary },
]);
export const statusDotFailed = style([statusDot, { background: '#EA4335' }]);
export const statusDotSetup = style([statusDot, { background: '#FBBC04' }]);

export const railItemNextRun = style({
  fontSize: 11,
  color: cssVarV2.text.tertiary,
  marginLeft: 'auto',
});

// ── Main Panel ────────────────────────────────────────────────────────────────

export const main = style({
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
});

// ── Empty State ───────────────────────────────────────────────────────────────

export const emptyState = style({
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 48,
  gap: 0,
  textAlign: 'center',
  maxWidth: 480,
  margin: '0 auto',
  width: '100%',
});

export const emptyIcon = style({
  fontSize: 48,
  color: cssVarV2.icon.secondary,
  marginBottom: 20,
  opacity: 0.7,
});

export const emptyTitle = style({
  fontSize: 20,
  fontWeight: 600,
  color: cssVarV2.text.primary,
  letterSpacing: '-0.3px',
  marginBottom: 10,
});

export const emptyDescription = style({
  fontSize: 14,
  color: cssVarV2.text.secondary,
  lineHeight: '1.6',
  marginBottom: 28,
});

export const emptyExamples = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  alignSelf: 'stretch',
  marginBottom: 32,
});

export const emptyExample = style({
  display: 'flex',
  alignItems: 'flex-start',
  gap: 10,
  padding: '10px 14px',
  borderRadius: 8,
  background: cssVarV2.layer.background.secondary,
  border: `1px solid ${cssVarV2.layer.insideBorder.border}`,
  textAlign: 'left',
});

export const emptyExampleIcon = style({
  fontSize: 16,
  flexShrink: 0,
  marginTop: 1,
});

export const emptyExampleText = style({
  fontSize: 13,
  color: cssVarV2.text.secondary,
  lineHeight: '1.5',
});

export const emptyPrimaryCta = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '9px 20px',
  borderRadius: 8,
  background: cssVarV2.button.primary,
  color: cssVarV2.button.pureWhiteText,
  fontSize: 14,
  fontWeight: 500,
  border: 'none',
  cursor: 'pointer',
  transition: 'opacity 0.15s ease',
  selectors: {
    '&:hover': {
      opacity: 0.88,
    },
  },
});

// ── Task Detail ───────────────────────────────────────────────────────────────

export const detail = style({
  flex: 1,
  overflowY: 'auto',
  padding: '32px 40px',
  display: 'flex',
  flexDirection: 'column',
  gap: 28,
});

export const detailHeader = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
});

export const detailActions = style({
  display: 'flex',
  flexDirection: 'row',
  alignItems: 'center',
  gap: 8,
  marginBottom: 4,
});

export const detailTitle = style({
  fontSize: 24,
  fontWeight: 700,
  color: cssVarV2.text.primary,
  letterSpacing: '-0.4px',
  lineHeight: '1.3',
});

export const detailStatusRow = style({
  display: 'flex',
  flexDirection: 'row',
  alignItems: 'center',
  gap: 10,
});

export const detailStatusChip = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 5,
  padding: '2px 8px',
  borderRadius: 20,
  fontSize: 12,
  fontWeight: 500,
  background: cssVarV2.layer.background.secondary,
  color: cssVarV2.text.secondary,
  border: `1px solid ${cssVarV2.layer.insideBorder.border}`,
});

export const detailScheduleLine = style({
  fontSize: 13,
  color: cssVarV2.text.secondary,
});

// ── Section ───────────────────────────────────────────────────────────────────

export const section = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
});

export const sectionLabel = style({
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: cssVarV2.text.tertiary,
});

export const sectionContent = style({
  fontSize: 14,
  color: cssVarV2.text.primary,
  lineHeight: '1.6',
  padding: '12px 14px',
  background: cssVarV2.layer.background.secondary,
  borderRadius: 8,
  border: `1px solid ${cssVarV2.layer.insideBorder.border}`,
  whiteSpace: 'pre-wrap',
});

export const destinationLink = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  fontSize: 14,
  color: cssVarV2.text.link,
  cursor: 'pointer',
  textDecoration: 'none',
  selectors: {
    '&:hover': {
      textDecoration: 'underline',
    },
  },
});

// ── Runs list ─────────────────────────────────────────────────────────────────

export const runsList = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
});

export const runItem = style({
  display: 'flex',
  flexDirection: 'row',
  alignItems: 'center',
  gap: 10,
  padding: '8px 12px',
  borderRadius: 8,
  background: cssVarV2.layer.background.secondary,
  border: `1px solid ${cssVarV2.layer.insideBorder.border}`,
});

export const runStatusDot = style({
  width: 7,
  height: 7,
  borderRadius: '50%',
  flexShrink: 0,
});

export const runItemDate = style({
  fontSize: 13,
  fontWeight: 500,
  color: cssVarV2.text.primary,
  minWidth: 0,
  flex: 1,
});

export const runItemStatus = style({
  fontSize: 12,
  color: cssVarV2.text.secondary,
  flexShrink: 0,
});

export const runItemSummary = style({
  fontSize: 12,
  color: cssVarV2.text.tertiary,
  overflow: 'hidden',
  whiteSpace: 'nowrap',
  textOverflow: 'ellipsis',
  maxWidth: 300,
});

export const noRuns = style({
  fontSize: 13,
  color: cssVarV2.text.tertiary,
  padding: '10px 0',
});

// ── Action buttons ────────────────────────────────────────────────────────────

export const actionButton = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '6px 14px',
  borderRadius: 7,
  fontSize: 13,
  fontWeight: 500,
  border: `1px solid ${cssVarV2.layer.insideBorder.border}`,
  background: cssVarV2.layer.background.primary,
  color: cssVarV2.text.primary,
  cursor: 'pointer',
  transition: 'background 0.12s ease',
  selectors: {
    '&:hover': {
      background: cssVarV2.layer.background.hoverOverlay,
    },
  },
});

export const actionButtonDanger = style([
  actionButton,
  {
    color: '#EA4335',
    selectors: {
      '&:hover': {
        background: 'rgba(234,67,53,0.06)',
      },
    },
  },
]);

export const divider = style({
  height: 1,
  background: cssVarV2.layer.insideBorder.border,
  margin: '4px 0',
});

// ── Create / Edit Modal ───────────────────────────────────────────────────────

export const modalOverlay = style({
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.35)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 1000,
});

export const modal = style({
  width: 500,
  maxWidth: '94vw',
  maxHeight: '90vh',
  display: 'flex',
  flexDirection: 'column',
  background: cssVarV2.layer.background.primary,
  borderRadius: 12,
  border: `1px solid ${cssVarV2.layer.insideBorder.border}`,
  boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
  overflow: 'hidden',
});

export const modalHeader = style({
  display: 'flex',
  flexDirection: 'row',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '18px 20px 14px 20px',
  borderBottom: `1px solid ${cssVarV2.layer.insideBorder.border}`,
  flexShrink: 0,
});

export const modalTitle = style({
  fontSize: 16,
  fontWeight: 600,
  color: cssVarV2.text.primary,
  letterSpacing: '-0.2px',
});

export const modalClose = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 28,
  height: 28,
  borderRadius: 6,
  border: 'none',
  background: 'transparent',
  color: cssVarV2.icon.secondary,
  cursor: 'pointer',
  fontSize: 18,
  transition: 'background 0.12s ease',
  selectors: {
    '&:hover': {
      background: cssVarV2.layer.background.hoverOverlay,
    },
  },
});

export const modalBody = style({
  flex: 1,
  overflowY: 'auto',
  padding: '20px',
  display: 'flex',
  flexDirection: 'column',
  gap: 16,
});

export const formField = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
});

export const formLabel = style({
  fontSize: 12,
  fontWeight: 500,
  color: cssVarV2.text.secondary,
  letterSpacing: '0.02em',
});

export const formInput = style({
  width: '100%',
  padding: '8px 12px',
  border: `1px solid ${cssVarV2.layer.insideBorder.border}`,
  borderRadius: 7,
  fontSize: 14,
  color: cssVarV2.text.primary,
  background: cssVarV2.layer.background.primary,
  outline: 'none',
  transition: 'border-color 0.15s ease',
  selectors: {
    '&:focus': {
      borderColor: cssVarV2.layer.insideBorder.primaryBorder,
    },
    '&::placeholder': {
      color: cssVarV2.text.placeholder,
    },
  },
});

export const formTextarea = style([
  formInput,
  {
    resize: 'vertical',
    minHeight: 80,
    fontFamily: 'inherit',
    lineHeight: '1.5',
  },
]);

export const formSelect = style([
  formInput,
  {
    cursor: 'pointer',
    appearance: 'none',
    backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23999' stroke-width='2.5'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E")`,
    backgroundRepeat: 'no-repeat',
    backgroundPosition: 'right 10px center',
    paddingRight: 30,
  },
]);

export const formRow = style({
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
  gap: 12,
});

export const advancedToggle = style({
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  fontSize: 13,
  color: cssVarV2.text.secondary,
  cursor: 'pointer',
  background: 'none',
  border: 'none',
  padding: '2px 0',
  selectors: {
    '&:hover': {
      color: cssVarV2.text.primary,
    },
  },
});

export const modalFooter = style({
  display: 'flex',
  flexDirection: 'row',
  justifyContent: 'flex-end',
  gap: 8,
  padding: '14px 20px',
  borderTop: `1px solid ${cssVarV2.layer.insideBorder.border}`,
  flexShrink: 0,
});

export const btnPrimary = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '7px 18px',
  borderRadius: 7,
  fontSize: 14,
  fontWeight: 500,
  border: 'none',
  background: cssVarV2.button.primary,
  color: cssVarV2.button.pureWhiteText,
  cursor: 'pointer',
  transition: 'opacity 0.15s ease',
  selectors: {
    '&:hover': { opacity: 0.88 },
    '&:disabled': { opacity: 0.5, cursor: 'not-allowed' },
  },
});

export const btnSecondary = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '7px 18px',
  borderRadius: 7,
  fontSize: 14,
  fontWeight: 500,
  border: `1px solid ${cssVarV2.layer.insideBorder.border}`,
  background: cssVarV2.layer.background.primary,
  color: cssVarV2.text.primary,
  cursor: 'pointer',
  transition: 'background 0.12s ease',
  selectors: {
    '&:hover': { background: cssVarV2.layer.background.hoverOverlay },
  },
});
