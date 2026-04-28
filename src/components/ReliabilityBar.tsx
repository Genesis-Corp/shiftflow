interface Props { score: number; showLabel?: boolean; }

export default function ReliabilityBar({ score, showLabel = true }: Props) {
  const color =
    score >= 75 ? 'bg-green-500' :
    score >= 50 ? 'bg-amber-400' :
    score >= 25 ? 'bg-orange-500' : 'bg-red-500';

  const label =
    score >= 75 ? 'Reliable' :
    score >= 50 ? 'Average' :
    score >= 25 ? 'Unreliable' : 'Poor';

  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 bg-slate-200 rounded-full h-2 min-w-[60px]">
        <div className={`h-2 rounded-full transition-all ${color}`} style={{ width: `${score}%` }} />
      </div>
      {showLabel && (
        <span className="text-xs text-slate-500 w-16">{score} — {label}</span>
      )}
    </div>
  );
}
