import { grade, jobById, JOBS, type Grade, type Job } from '../../game/jobs';
import { buildCost } from '../../game/parts';
import { useGame, type LastResult } from '../../game/store';
import { buildSig, useBench } from '../../state/benchStore';

export interface JobView {
  job: Job;
  index: number;
  cost: number;
  /** Grade against the last acceptance, if it was run on exactly this build. */
  grade: Grade;
  /** Last acceptance, possibly on an older build. */
  last: LastResult | null;
  fresh: boolean;
  stars: number;
}

export function useJob(): JobView | null {
  const mode = useGame((s) => s.mode);
  const jobId = useGame((s) => s.jobId);
  const results = useGame((s) => s.results);
  const progress = useGame((s) => s.progress);
  const config = useBench((s) => s.config);
  const ecu = useBench((s) => s.ecu);
  const baseline = useBench((s) => s.baseline);
  const job = mode === 'job' ? jobById(jobId) : undefined;
  if (!job) return null;
  const cost = buildCost(baseline.config, config);
  const last = results[job.id] ?? null;
  const fresh = last !== null && last.sig === buildSig(config, ecu);
  return {
    job,
    index: JOBS.indexOf(job),
    cost,
    grade: grade(job, { config, ecu, cost, result: fresh ? last.result : null }),
    last,
    fresh,
    stars: progress[job.id]?.stars ?? 0,
  };
}
