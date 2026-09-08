/** Shapes asserted by the release workflow tests, including mutation fixtures. */
export interface Step {
  uses?: string;
  run?: string;
  id?: string;
  name?: string;
  with?: Record<string, unknown>;
  env?: Record<string, unknown>;
  [key: string]: unknown;
}
export interface Job {
  steps: Step[];
  uses?: string;
  permissions?: Record<string, unknown>;
  outputs?: Record<string, unknown>;
  if?: string;
  env?: Record<string, unknown>;
  [key: string]: unknown;
}
export interface Workflow {
  jobs: Record<string, Job>;
  name?: string;
  on?: unknown;
  env?: Record<string, unknown>;
  defaults?: unknown;
  [key: string]: unknown;
}
