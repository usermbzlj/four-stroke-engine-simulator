export const INK = '#e8e2d6';
export const STEEL = '#5b646b';
export const HEAT = '#ff7a1a';
export const INTAKE = '#6fa8dc';
export const KNOCK = '#ff3d7f';

/** Colour of hot steel by temperature, °C, with how strongly it should glow. */
export function blackbody(tempC: number): { color: string; glow: number } {
  const stops: [number, [number, number, number]][] = [
    [20, [58, 63, 68]],
    [350, [70, 52, 48]],
    [480, [120, 28, 14]],
    [600, [190, 45, 12]],
    [720, [235, 92, 18]],
    [850, [255, 150, 50]],
    [1000, [255, 210, 130]],
  ];
  let a = stops[0]!;
  let b = stops[stops.length - 1]!;
  for (let i = 0; i < stops.length - 1; i++) {
    if (tempC >= stops[i]![0] && tempC <= stops[i + 1]![0]) {
      a = stops[i]!;
      b = stops[i + 1]!;
      break;
    }
  }
  const t = tempC <= a[0] ? 0 : tempC >= b[0] ? 1 : (tempC - a[0]) / (b[0] - a[0]);
  const mix = (i: 0 | 1 | 2): number => Math.round(a[1][i] + (b[1][i] - a[1][i]) * t);
  return {
    color: `rgb(${mix(0)},${mix(1)},${mix(2)})`,
    glow: Math.min(1, Math.max(0, (tempC - 450) / 450)),
  };
}
