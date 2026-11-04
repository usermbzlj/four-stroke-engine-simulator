import type { EcuConfig, EngineConfig } from '../sim/config';
import { runAcceptance, type AcceptancePlan, type AcceptanceProgress, type AcceptanceResult } from './acceptance';

export interface AcceptanceRequest {
  id: number;
  config: EngineConfig;
  ecu: EcuConfig;
  plan: AcceptancePlan;
  /** No progress messages: 老周's search only wants the result. */
  quiet?: boolean;
}

export type AcceptanceReply =
  | { id: number; type: 'progress'; progress: AcceptanceProgress }
  | { id: number; type: 'done'; result: AcceptanceResult }
  | { id: number; type: 'error'; message: string };

const post = (msg: AcceptanceReply): void => (self as unknown as Worker).postMessage(msg);

self.onmessage = (e: MessageEvent<AcceptanceRequest>) => {
  const { id, config, ecu, plan, quiet } = e.data;
  try {
    const result = runAcceptance(config, ecu, plan, quiet ? undefined : (progress) => post({ id, type: 'progress', progress }));
    post({ id, type: 'done', result });
  } catch (err) {
    post({ id, type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
