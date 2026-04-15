import { cssVarV2 } from '@toeverything/theme/v2';
import { style } from '@vanilla-extract/css';

// ── Page shell ────────────────────────────────────────────────────────────────

export const root = style({
  display: 'flex',
  flexDirection: 'column',
  height: '100%',
  width: '100%',
  overflow: 'hidden',
  background: cssVarV2.layer.background.primary,
});

export const header = style({
  display: 'flex',
  flexDirection: 'row',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '28px 40px 0 40px',
  flexShrink: 0,
});

export const pageTitle = style({
  fontSize: 22,
  fontWeight: 700,
  color: cssVarV2.text.primary,
  letterSpacing: '-0.4px',
});

export const newTaskButton = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '7px 16px',
  borderRadius: 8,
  fontSize: 13,
  fontWeight: 500,
  border: 'none',
  background: cssVarV2.button.primary,
  color: cssVarV2.button.pureWhiteText,
  cursor: 'pointer',
  transition: 'opacity 0.15s ease',
  selectors: {
    '&:hover': { opacity: 0.88 },
  },
});

export const scrollArea = style({
  flex: 1,
  overflowY: 'auto',
  padding: '24px 40px 40px 40px',
});

// ── Card grid ─────────────────────────────────────────────────────────────────

export const grid = style({
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
  gap: 16,
});

// ── Task card ─────────────────────────────────────────────────────────────────

export const card = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
  padding: '18px 20px',
  borderRadius: 12,
  background: cssVarV2.layer.background.secondary,
  border: `1px solid ${cssVarV2.layer.insideBorder.border}`,
  cursor: 'pointer',
  transition: 'border-color 0.15s ease, box-shadow 0.15s ease',
  selectors: {
    '&:hover': {
      borderColor: cssVarV2.layer.insideBorder.primaryBorder,
      boxShadow: '0 2px 12px rgba(0,0,0,0.07)',
    },
  },
});

export const cardTop = style({
  display: 'flex',
  flexDirection: 'row',
  alignItems: 'flex-start',
  justifyContent: 'space-between',
  gap: 8,
});

export const cardName = style({
  fontSize: 15,
  fontWeight: 600,
  color: cssVarV2.text.primary,
  letterSpacing: '-0.2px',
  lineHeight: '1.3',
});

export const statusChip = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  padding: '2px 8px',
  borderRadius: 20,
  fontSize: 11,
  fontWeight: 500,
  flexShrink: 0,
  background: cssVarV2.layer.background.primary,
  border: `1px solid ${cssVarV2.layer.insideBorder.border}`,
  color: cssVarV2.text.secondary,
});

export const statusDot = style({
  width: 5,
  height: 5,
  borderRadius: '50%',
  flexShrink: 0,
});

export const cardSchedule = style({
  fontSize: 12,
  color: cssVarV2.text.secondary,
  fontWeight: 500,
});

export const cardPrompt = style({
  fontSize: 13,
  color: cssVarV2.text.secondary,
  lineHeight: '1.55',
  overflow: 'hidden',
  display: '-webkit-box',
  WebkitLineClamp: 3,
  WebkitBoxOrient: 'vertical',
});

export const cardFooter = style({
  display: 'flex',
  flexDirection: 'row',
  alignItems: 'center',
  justifyContent: 'space-between',
  paddingTop: 10,
  borderTop: `1px solid ${cssVarV2.layer.insideBorder.border}`,
  marginTop: 2,
});

export const cardMeta = style({
  fontSize: 11,
  color: cssVarV2.text.tertiary,
});

// ── Empty state ───────────────────────────────────────────────────────────────

export const emptyState = style({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '80px 40px',
  textAlign: 'center',
  maxWidth: 440,
  margin: '0 auto',
});

export const emptyIcon = style({
  fontSize: 40,
  color: cssVarV2.icon.secondary,
  marginBottom: 16,
  opacity: 0.55,
});

export const emptyTitle = style({
  fontSize: 18,
  fontWeight: 600,
  color: cssVarV2.text.primary,
  letterSpacing: '-0.3px',
  marginBottom: 8,
});

export const emptyDescription = style({
  fontSize: 14,
  color: cssVarV2.text.secondary,
  lineHeight: '1.6',
  marginBottom: 24,
});

export const emptyCta = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '8px 20px',
  borderRadius: 8,
  fontSize: 14,
  fontWeight: 500,
  border: 'none',
  background: cssVarV2.button.primary,
  color: cssVarV2.button.pureWhiteText,
  cursor: 'pointer',
  transition: 'opacity 0.15s ease',
  selectors: {
    '&:hover': { opacity: 0.88 },
  },
});

// ── Detail / form overlay ─────────────────────────────────────────────────────

export const overlay = style({
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.3)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 1000,
  backdropFilter: 'blur(2px)',
});

export const panel = style({
  width: 560,
  maxWidth: '92vw',
  maxHeight: '86vh',
  display: 'flex',
  flexDirection: 'column',
  background: cssVarV2.layer.background.primary,
  borderRadius: 14,
  border: `1px solid ${cssVarV2.layer.insideBorder.border}`,
  boxShadow: '0 12px 40px rgba(0,0,0,0.16)',
  overflow: 'hidden',
});

export const panelHeader = style({
  display: 'flex',
  flexDirection: 'row',
  alignItems: 'flex-start',
  justifyContent: 'space-between',
  padding: '22px 24px 16px 24px',
  borderBottom: `1px solid ${cssVarV2.layer.insideBorder.border}`,
  flexShrink: 0,
  gap: 12,
});

export const panelTitleBlock = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  flex: 1,
  minWidth: 0,
});

export const panelTitle = style({
  fontSize: 18,
  fontWeight: 700,
  color: cssVarV2.text.primary,
  letterSpacing: '-0.3px',
});

export const panelMeta = style({
  display: 'flex',
  flexDirection: 'row',
  alignItems: 'center',
  gap: 8,
  flexWrap: 'wrap',
});

export const panelClose = style({
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
  flexShrink: 0,
  transition: 'background 0.12s ease',
  selectors: {
    '&:hover': { background: cssVarV2.layer.background.hoverOverlay },
  },
});

export const panelBody = style({
  flex: 1,
  overflowY: 'auto',
  padding: '20px 24px',
  display: 'flex',
  flexDirection: 'column',
  gap: 20,
});

export const panelActions = style({
  display: 'flex',
  flexDirection: 'row',
  gap: 8,
});

export const sectionLabel = style({
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: cssVarV2.text.tertiary,
  marginBottom: 6,
});

export const sectionText = style({
  fontSize: 14,
  color: cssVarV2.text.primary,
  lineHeight: '1.6',
  padding: '11px 14px',
  background: cssVarV2.layer.background.secondary,
  borderRadius: 8,
  border: `1px solid ${cssVarV2.layer.insideBorder.border}`,
  whiteSpace: 'pre-wrap',
});

export const runsList = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
});

export const runRow = style({
  display: 'flex',
  flexDirection: 'row',
  alignItems: 'center',
  gap: 10,
  padding: '8px 12px',
  borderRadius: 8,
  background: cssVarV2.layer.background.secondary,
  border: `1px solid ${cssVarV2.layer.insideBorder.border}`,
});

export const runDot = style({
  width: 7,
  height: 7,
  borderRadius: '50%',
  flexShrink: 0,
});

export const runDate = style({
  fontSize: 13,
  fontWeight: 500,
  color: cssVarV2.text.primary,
  flex: 1,
});

export const runSummary = style({
  fontSize: 12,
  color: cssVarV2.text.tertiary,
  overflow: 'hidden',
  whiteSpace: 'nowrap',
  textOverflow: 'ellipsis',
  maxWidth: 200,
});

export const runStatusText = style({
  fontSize: 12,
  color: cssVarV2.text.secondary,
  flexShrink: 0,
});

export const runLateTag = style({
  fontSize: 11,
  fontWeight: 500,
  color: '#FBBC04',
  background: 'rgba(251, 188, 4, 0.12)',
  borderRadius: 4,
  padding: '1px 5px',
  flexShrink: 0,
  cursor: 'default',
});

export const noRuns = style({
  fontSize: 13,
  color: cssVarV2.text.tertiary,
  padding: '4px 0',
});

export const actionBtn = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 5,
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
    '&:hover': { background: cssVarV2.layer.background.hoverOverlay },
  },
});

export const actionBtnDanger = style([
  actionBtn,
  {
    color: '#EA4335',
    selectors: {
      '&:hover': { background: 'rgba(234,67,53,0.06)' },
    },
  },
]);

// ── Form (create / edit) ──────────────────────────────────────────────────────

export const formField = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
});

export const formLabel = style({
  fontSize: 12,
  fontWeight: 500,
  color: cssVarV2.text.secondary,
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
    '&:focus': { borderColor: cssVarV2.layer.insideBorder.primaryBorder },
    '&::placeholder': { color: cssVarV2.text.placeholder },
  },
});

export const formTextarea = style([
  formInput,
  {
    resize: 'vertical',
    minHeight: 90,
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
    '&:hover': { color: cssVarV2.text.primary },
  },
});

export const modalFooter = style({
  display: 'flex',
  flexDirection: 'row',
  justifyContent: 'flex-end',
  gap: 8,
  padding: '14px 24px',
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
    '&:disabled': { opacity: 0.45, cursor: 'not-allowed' },
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
