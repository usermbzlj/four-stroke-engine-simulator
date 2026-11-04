import { useGame } from '../game/store';
import { CHASSIS_UNLOCK, ENGINE_UNLOCK, MEDAL_TEXT, MEDALS, buyUnlock, garageTitle, useCareer } from '../game/career';
import { money } from '../game/parts';
import { PRESETS } from '../sim/config';
import { RACE_EVENTS, RACE_ORDER } from '../sim/race';
import { CHASSIS, type ChassisId } from '../sim/vehicle';
import { say } from '../mentor/store';

export function GarageSheet(): React.ReactElement {
  const c = useCareer();
  const mode = useGame((s) => s.mode);
  const g = garageTitle(c.rep);
  const buy = (kind: 'chassis' | 'engine', id: string, name: string): void => {
    if (buyUnlock(kind, id, name)) say('garage', 'good', `${name}归你了。${kind === 'chassis' ? '在「整车」里换上它。' : '在「改装单」里换上它。'}`);
  };
  const fmtTarget = (id: (typeof RACE_ORDER)[number], v: number): string => (RACE_EVENTS[id].measure === 'topSpeed' ? `${v}` : v.toFixed(1));
  return (
    <div className="sheet garage">
      <div className="bill">
        <div className="bill-total">
          <span>现金</span>
          <b>{money(c.money)}</b>
          <span className="bill-budget">
            {g.title} · 声望 {c.rep}
            {g.next ? `（${g.next} 升级）` : ''}
          </span>
        </div>
        <p className="bill-parts">
          接工单拿星赚钱（每颗星 ¥600、声望 10）；在赛道上用自己付过钱的车跑出铜、银、金牌也有奖金。买过的零件以后随便调，不再收钱。
          {mode === 'job' ? ' 现在在做工单，零件是客户出钱。' : ''}
        </p>
      </div>

      <section className="sheet-group">
        <h3>车型</h3>
        <ul className="unlocks">
          {(Object.keys(CHASSIS) as ChassisId[]).map((id) => {
            const u = CHASSIS_UNLOCK[id];
            const own = c.ownedChassis.includes(id);
            return (
              <li key={id} className={own ? 'is-own' : ''}>
                <b>{CHASSIS[id].name}</b>
                <span>{CHASSIS[id].blurb}</span>
                {own ? (
                  <em>已有</em>
                ) : (
                  <button type="button" className="btn btn--small" disabled={c.rep < u.rep || c.money < u.price} onClick={() => buy('chassis', id, CHASSIS[id].name)}>
                    {c.rep < u.rep ? `声望 ${u.rep} 解锁` : `买 ${money(u.price)}`}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      <section className="sheet-group">
        <h3>发动机</h3>
        <ul className="unlocks">
          {PRESETS.map((p) => {
            const u = ENGINE_UNLOCK[p.id] ?? { rep: 0, price: 0 };
            const own = c.ownedEngines.includes(p.id);
            return (
              <li key={p.id} className={own ? 'is-own' : ''}>
                <b>{p.name}</b>
                <span>{p.blurb}</span>
                {own ? (
                  <em>已有</em>
                ) : (
                  <button type="button" className="btn btn--small" disabled={c.rep < u.rep || c.money < u.price} onClick={() => buy('engine', p.id, p.name)}>
                    {c.rep < u.rep ? `声望 ${u.rep} 解锁` : `买 ${money(u.price)}`}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      <section className="sheet-group">
        <h3>奖牌（铜 / 银 / 金）</h3>
        <table className="medal-table">
          <thead>
            <tr>
              <th />
              {RACE_ORDER.map((id) => (
                <th key={id}>{RACE_EVENTS[id].name}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(Object.keys(CHASSIS) as ChassisId[]).map((ch) => (
              <tr key={ch}>
                <th>{CHASSIS[ch].name}</th>
                {RACE_ORDER.map((id) => {
                  const m = c.medals[`${ch}:${id}`] ?? 0;
                  return (
                    <td key={id} className={`medal medal--${m}`} title={MEDALS[ch][id].map((v) => fmtTarget(id, v)).join(' / ') + (RACE_EVENTS[id].measure === 'topSpeed' ? ' km/h' : ' 秒')}>
                      {m ? MEDAL_TEXT[m] : '—'}
                      <small>{MEDALS[ch][id].map((v) => fmtTarget(id, v)).join('/')}</small>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="sheet-group">
        <h3>账本</h3>
        <ol className="ledger">
          {c.ledger.length === 0 && <li>还没有进出账。</li>}
          {c.ledger.map((l, i) => (
            <li key={i}>
              <span>{l.text}</span>
              <b className={l.amount >= 0 ? 'is-in' : 'is-out'}>
                {l.amount >= 0 ? '+' : '−'}
                {money(Math.abs(l.amount))}
              </b>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
