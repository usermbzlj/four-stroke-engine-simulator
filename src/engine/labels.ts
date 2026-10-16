/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ComponentWear } from '../types';

export const COMPONENT_LABELS: Record<keyof ComponentWear, string> = {
  pistonRings: '活塞压缩环',
  cylinderWall: '气缸内壁',
  conrodBearings: '连杆大头轴瓦',
  crankshaftJournal: '曲轴主轴颈',
  sparkPlug: '火花塞',
  valves: '气门与密封',
};
