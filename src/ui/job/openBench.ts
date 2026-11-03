import { startBench, useLink } from '../../state/engineLink';
import { useUi } from '../../state/uiStore';

/** Switch builds and show the bench, bringing audio up on first use (needs a user gesture). */
export async function openBench(action: () => void): Promise<void> {
  action();
  useUi.getState().setView('bench');
  if (!useLink.getState().started) await startBench();
}
