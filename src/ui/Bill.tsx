import { buyParts, unpaidParts, unpaidVehicleParts, useCareer } from '../game/career';
import { buildCost, changedParts, money, PARTS } from '../game/parts';
import { currentJob } from '../game/session';
import { useGame } from '../game/store';
import { changedVehicleParts, VEHICLE_PARTS, vehicleCost } from '../sim/vehicle';
import { baseVehicle, useBench } from '../state/benchStore';
import { say } from '../mentor/store';

const vprice = (id: string): number => VEHICLE_PARTS.find((p) => p.id === id)?.price ?? 0;

/** What the build costs: the customer's budget on a job, the garage's money in the sandbox. */
export function Bill(): React.ReactElement {
  const config = useBench((s) => s.config);
  const vehicle = useBench((s) => s.vehicle);
  const baseline = useBench((s) => s.baseline);
  const mode = useGame((s) => s.mode);
  useGame((s) => s.jobId);
  const cash = useCareer((s) => s.money);
  useCareer((s) => s.ownedParts);
  useCareer((s) => s.ownedVehicleParts);
  const job = currentJob();
  const eng = changedParts(baseline.config, config);
  const veh = changedVehicleParts(baseVehicle(baseline, vehicle), vehicle);

  if (mode === 'job' && job) {
    const cost = buildCost(baseline.config, config) + vehicleCost(baseVehicle(baseline, vehicle), vehicle);
    return (
      <div className={`bill${cost > job.budget ? ' is-over' : ''}`}>
        <div className="bill-total">
          <span>零件花费（客户出）</span>
          <b>{money(cost)}</b>
          <span className="bill-budget">预算 {money(job.budget)}</span>
        </div>
        <p className="bill-parts">
          {eng.length + veh.length === 0 ? '还是原装的。改任何参数等于买了那个零件；改回原值不收钱。' : [...eng, ...veh].map((p) => `${p.name} ${money(p.price)}`).join('　')}
        </p>
      </div>
    );
  }

  const unpaid = unpaidParts(eng.map((p) => p.id));
  const unpaidV = unpaidVehicleParts(veh.map((p) => p.id));
  const total = unpaid.reduce((s, id) => s + (PARTS.find((p) => p.id === id)?.price ?? 0), 0) + unpaidV.reduce((s, id) => s + vprice(id), 0);
  const names = [...unpaid.map((id) => PARTS.find((p) => p.id === id)!.name), ...unpaidV.map((id) => VEHICLE_PARTS.find((p) => p.id === id)!.name)];
  return (
    <div className={`bill${total > cash ? ' is-over' : ''}`}>
      <div className="bill-total">
        <span>{total > 0 ? '还没付钱' : '车上零件都是自己的'}</span>
        <b>{money(total)}</b>
        <span className="bill-budget">现金 {money(cash)}</span>
      </div>
      <p className="bill-parts">
        {total === 0
          ? '买过的零件可以随便调。新零件先装上试，满意了再结账；没结账的车在赛道上只算试骑，不发奖牌。'
          : `${names.join('、')}。`}
      </p>
      {total > 0 && (
        <button
          type="button"
          className="btn btn--small btn--primary"
          disabled={total > cash}
          onClick={() => {
            if (buyParts(unpaid, unpaidV, total)) say('garage', 'good', `结账 ${money(total)}。${names.join('、')}归你了，以后怎么调都不再收钱。`);
          }}
        >
          {total > cash ? `差 ${money(total - cash)}` : `结账 ${money(total)}`}
        </button>
      )}
    </div>
  );
}
