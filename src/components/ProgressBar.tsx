'use client';

import { useEffect, useState } from 'react';

export interface ProgressStage {
  label: string;
  detail?: string;
  /** Percentage this stage starts at. */
  from: number;
  /** Percentage it creeps towards while the step runs. */
  to: number;
  /** Roughly how long the step takes, used to pace the creep. */
  seconds: number;
}

/**
 * Progress for steps whose real duration is unknown — reading a photo takes
 * anywhere from ten seconds to a minute. The bar advances towards the stage's
 * ceiling over the expected time and stops there until the stage actually
 * changes, so it keeps moving without ever claiming to be finished early.
 */
export default function ProgressBar({ stage }: { stage: ProgressStage }) {
  const [percent, setPercent] = useState(stage.from);

  useEffect(() => {
    setPercent(stage.from);
    const tickMs = 200;
    const step = (stage.to - stage.from) / Math.max(1, (stage.seconds * 1000) / tickMs);
    const timer = setInterval(() => {
      setPercent(current => Math.min(stage.to, current + step));
    }, tickMs);
    return () => clearInterval(timer);
  }, [stage.from, stage.to, stage.seconds]);

  return (
    <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 space-y-2">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-sm font-medium text-blue-900">{stage.label}</p>
        <span className="text-xs tabular-nums text-blue-700">{Math.round(percent)}%</span>
      </div>
      <div className="h-2 w-full rounded-full bg-blue-100 overflow-hidden">
        <div
          className="h-full rounded-full bg-blue-600 transition-[width] duration-200 ease-linear"
          style={{ width: `${percent}%` }}
        />
      </div>
      {stage.detail && <p className="text-xs text-blue-700">{stage.detail}</p>}
    </div>
  );
}
