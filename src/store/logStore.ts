/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { create } from 'zustand';
import type { LogLevel, LogMessage } from '../types';

const LOG_LIMIT = 40;

interface LogStore {
  logs: LogMessage[];
  add: (level: LogLevel, message: string) => void;
  clear: () => void;
}

let sequence = 0;

export const useLogStore = create<LogStore>()((set) => ({
  logs: [],
  add: (type, message) =>
    set((s) => ({
      logs: [
        { id: `log-${++sequence}`, time: new Date().toLocaleTimeString('zh-CN', { hour12: false }), type, message },
        ...s.logs,
      ].slice(0, LOG_LIMIT),
    })),
  clear: () => set({ logs: [] }),
}));
