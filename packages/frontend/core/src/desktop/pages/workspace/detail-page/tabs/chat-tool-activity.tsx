import {
  cliActivity,
  type ToolActivityEvent,
} from '@affine/core/blocksuite/ai/provider/cli-provider';
import { useEffect, useRef, useState } from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ActivityState =
  | { status: 'idle' }
  | { status: 'active'; label: string }
  | { status: 'done'; toolCount: number };

// ---------------------------------------------------------------------------
// Inline styles
// All colours use AFFiNE CSS variables so they adapt to light/dark themes.
// ---------------------------------------------------------------------------

const chipBase: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '6px',
  padding: '4px 10px',
  borderRadius: '999px',
  fontSize: '12px',
  fontWeight: 500,
  lineHeight: '18px',
  userSelect: 'none',
  transition: 'opacity 0.2s ease',
  border: '1px solid var(--affine-border-color)',
  background: 'var(--affine-background-secondary-color)',
  color: 'var(--affine-text-secondary-color)',
  width: 'fit-content',
  maxWidth: '100%',
  overflow: 'hidden',
  whiteSpace: 'nowrap',
  textOverflow: 'ellipsis',
};

const dotStyle: React.CSSProperties = {
  width: '7px',
  height: '7px',
  borderRadius: '50%',
  background: 'var(--affine-brand-color)',
  flexShrink: 0,
  // CSS animation is defined in the <style> block below
  animation: 'cliActivityPulse 1.4s ease-in-out infinite',
};

const checkStyle: React.CSSProperties = {
  width: '12px',
  height: '12px',
  flexShrink: 0,
  color: 'var(--affine-brand-color)',
};

const wrapperStyle: React.CSSProperties = {
  padding: '4px 16px 4px',
  display: 'flex',
  justifyContent: 'flex-start',
};

// ---------------------------------------------------------------------------
// Keyframe injection (once per page)
// ---------------------------------------------------------------------------

let keyframesInjected = false;
function ensureKeyframes() {
  if (keyframesInjected) return;
  keyframesInjected = true;
  const style = document.createElement('style');
  style.textContent = `
    @keyframes cliActivityPulse {
      0%, 100% { opacity: 1; transform: scale(1); }
      50%       { opacity: 0.35; transform: scale(0.75); }
    }
  `;
  document.head.append(style);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function CLIToolActivity() {
  const [state, setState] = useState<ActivityState>({ status: 'idle' });
  const clearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    ensureKeyframes();

    const unsub = cliActivity.subscribe((event: ToolActivityEvent) => {
      // Cancel any pending auto-clear when a new event arrives
      if (clearTimerRef.current !== null) {
        clearTimeout(clearTimerRef.current);
        clearTimerRef.current = null;
      }

      if (event.status === 'done') {
        setState({ status: 'done', toolCount: event.toolCount });
        // The provider already schedules an 'idle' event after 1800 ms,
        // but we also set a local fallback in case the tab is unmounted/remounted.
        clearTimerRef.current = setTimeout(() => {
          setState({ status: 'idle' });
          clearTimerRef.current = null;
        }, 2200);
      } else if (event.status === 'active') {
        setState({ status: 'active', label: event.label });
      } else {
        setState({ status: 'idle' });
      }
    });

    return () => {
      unsub();
      if (clearTimerRef.current !== null) {
        clearTimeout(clearTimerRef.current);
      }
    };
  }, []);

  if (state.status === 'idle') return null;

  if (state.status === 'active') {
    return (
      <div style={wrapperStyle}>
        <div style={chipBase}>
          <span style={dotStyle} />
          <span>{state.label}...</span>
        </div>
      </div>
    );
  }

  // status === 'done'
  const toolWord = state.toolCount === 1 ? 'tool' : 'tools';
  return (
    <div style={wrapperStyle}>
      <div
        style={{
          ...chipBase,
          color: 'var(--affine-brand-color)',
          borderColor: 'var(--affine-brand-color)',
        }}
      >
        <svg
          style={checkStyle}
          viewBox="0 0 12 12"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M2 6.5L4.5 9L10 3.5"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <span>
          {state.toolCount > 0 ? `${state.toolCount} ${toolWord} used` : 'Done'}
        </span>
      </div>
    </div>
  );
}
