/**
 * Narrowing for ML service responses. The service is internal but still a
 * separate process: everything it returns is validated before use, and a
 * malformed answer is treated like an outage (fallback to heuristics).
 */

import { isRecord, MlError } from './client.ts';

export interface ModelInfo {
  name: string;
  version: string;
  trainedOn: string;
}

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const str = (v: unknown): v is string => typeof v === 'string';
const strings = (v: unknown): string[] =>
  Array.isArray(v)
    ? v
        .filter(str)
        .map((s) => s.slice(0, 300))
        .slice(0, 10)
    : [];

function bad(what: string): never {
  throw new MlError('bad_response', `ML service returned an invalid ${what} payload`);
}

function modelInfo(v: unknown): ModelInfo {
  if (!isRecord(v) || !str(v.name) || !str(v.version) || !str(v.trainedOn)) bad('model');
  return { name: v.name, version: v.version, trainedOn: v.trainedOn };
}

export function parseEta(v: unknown) {
  if (!isRecord(v) || !isRecord(v.etaDays)) bad('task-eta');
  const { p10, p50, p90 } = v.etaDays;
  if (!num(p10) || !num(p50) || !num(p90)) bad('task-eta');
  return { eta: { p10, p50, p90 }, model: modelInfo(v.model) };
}

export function parseOverdue(v: unknown) {
  if (!isRecord(v) || !num(v.probability)) bad('overdue');
  return { probability: v.probability, drivers: strings(v.drivers), model: modelInfo(v.model) };
}

export function parseDeployRisk(v: unknown) {
  if (!isRecord(v) || !num(v.probability) || !num(v.score)) bad('deploy-risk');
  const level =
    v.level === 'high' || v.level === 'medium' || v.level === 'low' ? v.level : bad('deploy-risk');
  return {
    probability: v.probability,
    score: v.score,
    level,
    drivers: strings(v.drivers),
    model: modelInfo(v.model),
  };
}

export function parseSignin(v: unknown) {
  if (!isRecord(v) || !num(v.score)) bad('signin-anomaly');
  const d = v.decision;
  const decision = d === 'allow' || d === 'challenge' || d === 'block' ? d : bad('signin-anomaly');
  return { score: v.score, reasons: strings(v.reasons), decision, model: modelInfo(v.model) };
}

export interface AssistantSource {
  id: string;
  kind: string;
  title: string;
  url?: string;
}

export function parseAssistant(v: unknown) {
  if (!isRecord(v) || !str(v.answer) || !str(v.model) || !Array.isArray(v.sources))
    bad('assistant');
  const sources: AssistantSource[] = v.sources.flatMap((s): AssistantSource[] =>
    isRecord(s) && str(s.id) && str(s.kind) && str(s.title)
      ? [{ id: s.id, kind: s.kind, title: s.title, ...(str(s.url) ? { url: s.url } : {}) }]
      : [],
  );
  return {
    answer: v.answer.slice(0, 4000),
    sources,
    model: v.model,
    grounded: v.grounded === true,
    truncated: v.truncated === true,
  };
}

export function parseTrain(v: unknown) {
  if (!isRecord(v) || !str(v.name) || !str(v.version) || typeof v.passed !== 'boolean')
    bad('train');
  return {
    name: v.name,
    version: v.version,
    passed: v.passed,
    promoted: v.promoted === true,
    metrics: isRecord(v.metrics) ? v.metrics : {},
    reasons: strings(v.reasons),
    trainedOn: str(v.trainedOn) ? v.trainedOn : 'unknown',
  };
}
