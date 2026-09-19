type Branch = { genre: string; total: number; months: number[] };

const COLORS = ['#22d3ee', '#a78bfa', '#f472b6', '#34d399', '#fbbf24'];

/**
 * A stylised "taste tree": one branch per favourite genre, its length and
 * thickness growing with how much the profile watched it, and leaves placed
 * from the base (older months) to the tip (recent months) to show how tastes
 * have evolved over the last six months.
 */
export function TasteTree({ branches }: { branches: Branch[] }) {
  const active = branches.filter(branch => branch.total > 0);
  if (!active.length) return null;
  const W = 640, H = 440, baseX = W / 2, baseY = H - 28, topY = 120;
  const maxTotal = Math.max(1, ...active.map(branch => branch.total));
  const maxMonth = Math.max(1, ...active.flatMap(branch => branch.months));
  const span = baseY - 55 - topY;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="taste-tree" role="img" aria-label="Arbre d'évolution de vos goûts">
      <line x1={40} y1={baseY} x2={W - 40} y2={baseY} stroke="#1b3350" strokeWidth={2} />
      <path d={`M${baseX} ${baseY} L${baseX} ${topY}`} stroke="#3a5675" strokeWidth={14} strokeLinecap="round" fill="none" />
      <circle cx={baseX} cy={topY} r={9} fill="#3a5675" />
      {active.map((branch, index) => {
        const side = index % 2 === 0 ? -1 : 1;
        const attachY = baseY - 55 - (index * span) / Math.max(1, active.length);
        const dx = side * (72 + (branch.total / maxTotal) * 150);
        const dy = -(62 + index * 8);
        const endX = baseX + dx, endY = attachY + dy;
        const cx = baseX + dx * 0.45, cy = attachY + dy * 0.35 - 14;
        const width = 5 + (branch.total / maxTotal) * 9;
        const color = COLORS[index % COLORS.length];
        const point = (t: number) => ({ x: (1 - t) * (1 - t) * baseX + 2 * (1 - t) * t * cx + t * t * endX, y: (1 - t) * (1 - t) * attachY + 2 * (1 - t) * t * cy + t * t * endY });
        return (
          <g key={branch.genre}>
            <path d={`M${baseX} ${attachY} Q${cx} ${cy} ${endX} ${endY}`} stroke={color} strokeWidth={width} strokeLinecap="round" fill="none" opacity={0.85} />
            {branch.months.map((count, month) => {
              if (!count) return null;
              const { x, y } = point((month + 0.5) / branch.months.length);
              return <circle key={month} cx={x} cy={y} r={4 + (count / maxMonth) * 9} fill={color} opacity={0.55 + 0.45 * (month / (branch.months.length - 1))} />;
            })}
            <text x={endX + side * 10} y={endY - 2} fill={color} fontSize={14} fontWeight={600} textAnchor={side < 0 ? 'end' : 'start'}>{branch.genre}</text>
            <text x={endX + side * 10} y={endY + 14} fill="#8fa6c0" fontSize={11} textAnchor={side < 0 ? 'end' : 'start'}>{branch.total} vu{branch.total > 1 ? 's' : ''}</text>
          </g>
        );
      })}
    </svg>
  );
}
