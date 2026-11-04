/**
 * Where the books meet the bench: prize runs pay medals, accepted jobs pay
 * stars. Prize money only counts on a bike that is fully paid for.
 */

import { say } from '../mentor/store';
import { RACE_EVENTS } from '../sim/race';
import { changedVehicleParts } from '../sim/vehicle';
import { baseVehicle, useBench } from '../state/benchStore';
import { onRaceResult } from '../state/engineLink';
import { scoreText } from '../state/raceStore';
import { awardRun, awardStars, MEDAL_TEXT, unpaidParts, unpaidVehicleParts } from './career';
import { JOBS } from './jobs';
import { changedParts, money } from './parts';
import { useGame } from './store';

let started = false;

export function startCareerHooks(): void {
  if (started) return;
  started = true;
  // Stars earned before the garage kept books are paid once.
  const g = useGame.getState();
  for (const job of JOBS) {
    const stars = g.progress[job.id]?.stars ?? 0;
    if (stars > 0) awardStars(job.id, job.title, stars);
  }
  onRaceResult((rec, isBest) => {
    const r = rec.result;
    const ev = RACE_EVENTS[r.event];
    if (useGame.getState().mode !== 'sandbox' || r.dnf) return;
    const b = useBench.getState();
    const unpaid = unpaidParts(changedParts(b.baseline.config, b.config).map((p) => p.id)).length + unpaidVehicleParts(changedVehicleParts(baseVehicle(b.baseline, b.vehicle), b.vehicle).map((p) => p.id)).length;
    if (unpaid > 0) {
      say('prize', 'say', `${ev.name} ${scoreText(r)}${isBest ? '，新纪录' : ''}。车上还有 ${unpaid} 件零件没结账，这趟只算试骑，不发奖。`, { cooldown: 30 });
      return;
    }
    const won = awardRun(b.vehicle.chassis, r);
    if (won.prize > 0) say('prize', 'good', `${ev.name} ${scoreText(r)}，拿下${MEDAL_TEXT[won.medal]}牌！奖金 ${money(won.prize)}，声望 +${won.rep}。`, { head: '领奖：' });
  });
}
