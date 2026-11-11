import { useEffect } from 'react';
import { useControls } from '../state/controlStore';
import { abortRun, restoreEngine, shiftGear, startRun } from '../state/engineLink';
import { useRace } from '../state/raceStore';
import { useLive } from '../state/liveStore';
import { useUi, type Drawer } from '../state/uiStore';
import { useView } from '../state/viewStore';

const DRAWER_KEYS: Record<string, Drawer> = { q: 'build', w: 'ecu', a: 'car', e: 'dyno', g: 'garage' };

/** A dialog owns the keyboard while it is open. */
const modalOpen = (): boolean => document.querySelector('.modal, .failure') !== null;

const isTyping = (t: EventTarget | null): boolean => {
  if (!(t instanceof HTMLElement)) return false;
  if (t.tagName === 'SELECT' || t.tagName === 'TEXTAREA') return true;
  if (t.tagName !== 'INPUT') return false;
  const type = (t as HTMLInputElement).type;
  return type !== 'range' && type !== 'button' && type !== 'checkbox';
};

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
      // Arrow keys belong to a focused slider or select, not to the bench.
      if (key.startsWith('arrow') && e.target instanceof HTMLElement && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) return;
      if (key === 'r' && !e.repeat && useLive.getState().snapshot?.failure) {
        restoreEngine();
        return;
      }
      if (modalOpen()) return;
      const ui = useUi.getState();
      if (key === '?' || (key === '/' && e.shiftKey)) {
        ui.setHelp(true);
        return;
      }
      const onTrack = ui.stage === 'track';
      const race = useRace.getState();
      if (onTrack && key === 'escape' && race.live) {
        abortRun();
        return;
      }
      if (onTrack && key === 'enter' && !e.repeat && !race.live) {
        e.preventDefault();
        startRun();
        return;
      }
      if (onTrack && race.live && race.rider === 'manual' && (key === 'arrowup' || key === 'arrowdown')) {
        e.preventDefault();
        if (!e.repeat) shiftGear(key === 'arrowup' ? 1 : -1);
        return;
      }
      if (key === 't' && !e.repeat) {
        ui.setStage(onTrack ? 'dyno' : 'track');
        return;
      }
      if (key === 'escape' && ui.drawer) {
        ui.setDrawer(null);
        return;
      }
      if (!e.repeat && DRAWER_KEYS[key]) {
        const d = DRAWER_KEYS[key];
        ui.setDrawer(ui.drawer === d ? null : d);
        return;
      }
      if (key === ' ') {
        e.preventDefault();
        set({ pedal: 1 });
        return;
      }
      if (key === 'arrowleft' || key === 'arrowright') {
        e.preventDefault();
        useView.getState().scrub((key === 'arrowleft' ? -1 : 1) * (e.shiftKey ? 10 : 2));
        return;
      }
      if (e.repeat && key !== 'arrowup' && key !== 'arrowdown') return;
      if (key === 'p') {
        useView.getState().togglePause();
        return;
      }
      if (key === 'l') {
        useView.getState().toggleLabels();
        return;
      }
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
