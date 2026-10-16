/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Keyboard bindings. Held keys are recorded into the runtime's input intent;
 * one-shot keys call the supplied actions.
 */

import { useEffect, useEffectEvent } from 'react';
import { runtime } from '../game';

export interface KeyboardActions {
  /** Toggle the ignition kill switch. */
  onKill: () => void;
  /** Fire a one-off spark. */
  onSpark: () => void;
  /** Toggle the cold-start choke. */
  onChoke: () => void;
  /** Start (or abort) a dyno pull. */
  onDyno: () => void;
  /** Escape: back out of whatever is running. */
  onEscape: () => void;
  /** Switch workspace tab by index (0-based). */
  onSelectTab: (index: number) => void;
}

/** Human-readable binding list, rendered in the help overlay. */
export const KEY_BINDINGS: { keys: string; label: string }[] = [
  { keys: '空格 / W / ↑', label: '油门（按住）' },
  { keys: 'Shift + 油门', label: '轰油门（瞬间全开）' },
  { keys: 'S', label: '起动机（按住）' },
  { keys: 'K', label: '点火开关（切断 / 恢复）' },
  { keys: 'X', label: '强制跳火一次' },
  { keys: 'C', label: '阻风门（冷车加浓）' },
  { keys: 'N', label: '笑气（按住）' },
  { keys: 'D', label: '开始 / 中止测功机拉力' },
  { keys: '1 – 5', label: '切换右侧工作台页签' },
  { keys: 'Esc', label: '中止当前拉力 / 放弃合约' },
];

/** True when the user is typing, so we must not steal their keystrokes. */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

const THROTTLE_KEYS = new Set(['Space', 'KeyW', 'ArrowUp']);

export function useKeyboardControls(actions: KeyboardActions): void {
  const dispatch = useEffectEvent((event: KeyboardEvent) => {
    if (isTypingTarget(event.target)) return;
    const { input } = runtime;

    if (THROTTLE_KEYS.has(event.code)) {
      // Stop Space from scrolling the page or re-triggering a focused button.
      event.preventDefault();
      input.set('keyboard', { throttle: true, stab: event.shiftKey });
      return;
    }
    if (event.code === 'KeyS') {
      event.preventDefault();
      input.set('keyboard', { starter: true });
      return;
    }
    if (event.code === 'KeyN') {
      event.preventDefault();
      input.set('keyboard', { nitrous: true });
      return;
    }

    // Everything below is a one-shot action: ignore auto-repeat.
    if (event.repeat) return;

    switch (event.code) {
      case 'KeyK':
        event.preventDefault();
        actions.onKill();
        break;
      case 'KeyX':
        event.preventDefault();
        actions.onSpark();
        break;
      case 'KeyC':
        event.preventDefault();
        actions.onChoke();
        break;
      case 'KeyD':
        event.preventDefault();
        actions.onDyno();
        break;
      case 'Escape':
        actions.onEscape();
        break;
      case 'Digit1':
      case 'Digit2':
      case 'Digit3':
      case 'Digit4':
      case 'Digit5':
        actions.onSelectTab(Number(event.code.slice(-1)) - 1);
        break;
    }
  });

  const release = useEffectEvent((event: KeyboardEvent) => {
    const { input } = runtime;
    if (THROTTLE_KEYS.has(event.code)) input.set('keyboard', { throttle: false, stab: false });
    else if (event.code === 'KeyS') input.set('keyboard', { starter: false });
    else if (event.code === 'KeyN') input.set('keyboard', { nitrous: false });
    else if (event.key === 'Shift') input.set('keyboard', { stab: false });
  });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => dispatch(event);
    const onKeyUp = (event: KeyboardEvent) => release(event);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, []);
}
