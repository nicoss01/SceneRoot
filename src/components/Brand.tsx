export function Brand({ compact = false, vertical = false }: { compact?: boolean; vertical?: boolean }) {
  const source = vertical ? '/assets/logo-vertical.png' : '/assets/logo-horizontal.png';
  return <div className={`brand ${compact ? 'brand--compact' : ''} ${vertical ? 'brand--vertical' : ''}`} aria-label="SceneRoot">
    <img src={source} alt="SceneRoot" draggable={false} />
  </div>;
}
