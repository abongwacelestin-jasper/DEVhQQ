import '../setup.ts';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import {
  JOB_NAMES,
  enabledJobs,
  jobEnabled,
  parseJobList,
  setEnabledJobs,
} from '../../lib/jobs.ts';
import { parseWormMode } from '../../storage/index.ts';

const BACKEND = join(import.meta.dirname, '..', '..');

describe('JOBS_IN_PROCESS', () => {
  it('defaults to every job (one process does everything)', () => {
    for (const raw of [undefined, '', '1', 'all', 'ALL', 'true'])
      assert.deepEqual([...parseJobList(raw)].sort(), [...JOB_NAMES].sort(), String(raw));
  });

  it('0 / none turns every job off', () => {
    for (const raw of ['0', 'none', 'false', ' NONE '])
      assert.equal(parseJobList(raw).size, 0, raw);
  });

  it('accepts a comma list', () => {
    assert.deepEqual([...parseJobList('monitors, digest')].sort(), ['digest', 'monitors']);
    assert.deepEqual([...parseJobList('backup')], ['backup']);
  });

  it('refuses unknown names instead of silently dropping a job', () => {
    assert.throws(() => parseJobList('monitors,backups'), /unknown job\(s\) backups/);
    assert.throws(() => parseJobList('yes', 'WORKER_JOBS'), /WORKER_JOBS/);
  });

  it('jobEnabled follows the override, and resets to the environment', () => {
    setEnabledJobs(['digest']);
    assert.equal(jobEnabled('digest'), true);
    assert.equal(jobEnabled('backup'), false);
    setEnabledJobs([]);
    assert.equal(enabledJobs().size, 0);
    setEnabledJobs(undefined);
    // setup.ts leaves JOBS_IN_PROCESS unset: the default is every job.
    assert.equal(jobEnabled('monitors'), true);
  });

  it('the API refuses to boot with a typo in JOBS_IN_PROCESS', () => {
    const res = spawnSync(
      process.execPath,
      ['--experimental-strip-types', '--disable-warning=ExperimentalWarning', 'server.ts'],
      {
        cwd: BACKEND,
        env: { ...process.env, JOBS_IN_PROCESS: 'monitor', PORT: '18999' },
        encoding: 'utf8',
        timeout: 30_000,
      },
    );
    assert.equal(res.status, 1, res.stderr);
    assert.match(res.stderr, /JOBS_IN_PROCESS has unknown job\(s\) monitor/);
  });
});

describe('STORAGE_LOCK_MODE (reported WORM mode)', () => {
  it('falls back to the Object Lock mode', () => {
    assert.equal(parseWormMode(undefined, 'COMPLIANCE'), 'COMPLIANCE');
    assert.equal(parseWormMode('', 'GOVERNANCE'), 'GOVERNANCE');
  });

  it('reports R2 bucket locks as such', () => {
    assert.equal(parseWormMode('r2_bucket_lock', 'COMPLIANCE'), 'R2_BUCKET_LOCK');
  });

  it('refuses anything else', () => {
    assert.throws(() => parseWormMode('WORM', 'COMPLIANCE'), /STORAGE_LOCK_MODE/);
  });
});
