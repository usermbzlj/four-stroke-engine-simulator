import { useEffect } from 'react';
import { useControls } from '../state/controlStore';
import { restoreEngine } from '../state/engineLink';
import { useLive } from '../state/liveStore';

const isTyping = (t: EventTarget | null): boolean =>
  t instanceof HTMLElement && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA');

export function toggleBrake(): void {
  const c = useControls.getState();
  if (c.brakeMode === 'speed') {
    c.set({ brakeMode: 'off', sweeping: false });
  } else {
    const rpm = useLive.getState().snapshot?.rpm ?? 3000;
    c.set({ brakeMode: 'speed', brakeRpm: Math.max(1000, Math.round(rpm / 100) * 100) });
  }
}

export function nudgeBrake(delta: number): void {
  const c = useControls.getState();
  c.set({ brakeRpm: Math.min(16000, Math.max(1000, c.brakeRpm + delta)) });
}

export function nudgeThrottle(delta: number): void {
  const c = useControls.getState();
  c.set({ hand: Math.min(1, Math.max(0, Math.round((c.hand + delta) * 100) / 100)) });
}

/** Keyboard and gamepad bindings for the bench. */
export function useBenchInput(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    const set = useControls.getState().set;

    const down = (e: KeyboardEvent): void => {
      if (isTyping(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
      const key = e.key.toLowerCase();
      if (key === ' ') {
        e.preventDefault();
        set({ pedal: 1 });
        return;
      }
      if (e.repeat && key !== 'arrowup' && key !== 'arrowdown') return;
      if (key === 's') set({ starter: true });
      else if (key === 'k') set({ ignition: !useControls.getState().ignition });
      else if (key === 'b') toggleBrake();
      else if (key === '[') nudgeBrake(-250);
      else if (key === ']') nudgeBrake(250);
      else if (key === 'arrowup') {
        e.preventDefault();
        nudgeThrottle(0.02);
      } else if (key === 'arrowdown') {
        e.preventDefault();
        nudgeThrottle(-0.02);
      } else if (/^[0-9]$/.test(key)) set({ hand: Number(key) / 10 });
      else if (key === 'r' && useLive.getState().snapshot?.failure) restoreEngine();
    };
    const up = (e: KeyboardEvent): void => {
      const key = e.key.toLowerCase();
      if (key === ' ') set({ pedal: 0 });
      else if (key === 's') set({ starter: false });
    };
    const blur = (): void => set({ pedal: 0, starter: false });

    let raf = 0;
    let padStarter = false;
    let padPedal = 0;
    const poll = (): void => {
      const pad = navigator.getGamepads?.().find((g) => g !== null) ?? null;
      if (pad) {
        const rt = pad.buttons[7]?.value ?? 0;
        const a = pad.buttons[0]?.pressed ?? false;
        if (Math.abs(rt - padPedal) > 0.01) {
          padPedal = rt;
          set({ pedal: rt });
        }
        if (a !== padStarter) {
          padStarter = a;
          set({ starter: a });
        }
      }
      raf = requestAnimationFrame(poll);
    };
    raf = requestAnimationFrame(poll);

    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    };
  }, [enabled]);
}
