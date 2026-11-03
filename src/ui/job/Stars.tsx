export function Stars({ n, of = 3, big }: { n: number; of?: number; big?: boolean }): React.ReactElement {
  return (
    <span className={`stars${big ? ' stars--big' : ''}`} aria-label={`${n} 星`}>
      {Array.from({ length: of }, (_, i) => (
        <i key={i} className={i < n ? 'is-on' : ''} style={{ animationDelay: `${0.25 + i * 0.35}s` }}>
          ★
        </i>
      ))}
    </span>
  );
}
