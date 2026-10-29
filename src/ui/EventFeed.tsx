import { useLive } from '../state/liveStore';

export function EventFeed(): React.ReactElement {
  const feed = useLive((s) => s.feed);
  return (
    <ol className="feed" aria-live="polite" aria-label="台架记录">
      {feed.length === 0 && <li className="feed-empty">台架安静。</li>}
      {feed.map((f) => (
        <li key={f.id} className={`feed-item feed-item--${f.tone}`}>
          <span>{f.text}</span>
          {f.count > 1 && <b>×{f.count}</b>}
        </li>
      ))}
    </ol>
  );
}
