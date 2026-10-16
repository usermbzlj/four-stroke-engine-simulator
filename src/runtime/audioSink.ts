/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface AudioFrame {
  rpm: number;
  throttle: number;
  cranking: boolean;
  running: boolean;
  /** 0-100 mechanical damage, drives metallic tone. */
  damage: number;
  coolantTemp: number;
  /** 0-1 radiator fan / pump level. */
  fanLevel: number;
}

/** What the runtime needs from a sound system. Silent by default. */
export interface AudioSink {
  update(frame: AudioFrame): void;
  spark(): void;
  combustion(rpm: number, throttle: number, knocking: boolean): void;
  backfire(): void;
  explosion(): void;
}

export const NULL_AUDIO: AudioSink = {
  update: () => {},
  spark: () => {},
  combustion: () => {},
  backfire: () => {},
  explosion: () => {},
};
