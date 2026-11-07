import { expect, request as pwRequest, type APIRequestContext } from '@playwright/test';
import type { ProductId, RoleKey } from './personas';

/**
 * A separate, cookie-isolated API session for arranging data as another person
 * (e.g. Operations requests a deploy so the Owner can approve it). Requests carry no
 * Origin header, exactly like curl, which the backend's origin guard allows.
 */
export async function apiSession(baseURL: string, role: RoleKey): Promise<APIRequestContext> {
  const ctx = await pwRequest.newContext({ baseURL });
  const res = await ctx.post('/api/auth/demo', { data: { role } });
  expect(res.status(), `demo sign-in ${role}`).toBe(200);
  return ctx;
}

export interface ApiDeployment {
  id: string;
  product: ProductId;
  env: string;
  status: string;
  sha: string;
  version: string;
  requestedBy: string;
  approvedBy?: string;
}

/** Operations (Deployment: manage) requests a production deploy; it waits for a second person. */
export async function requestProductionDeploy(
  baseURL: string,
  role: RoleKey,
  product: ProductId,
  tag: string,
): Promise<ApiDeployment> {
  const api = await apiSession(baseURL, role);
  const sha = Array.from({ length: 7 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
  const res = await api.post('/api/deployments', {
    data: { product, env: 'production', version: tag, sha },
  });
  const body = await res.text();
  expect(res.status(), `request deploy: ${body}`).toBe(201);
  await api.dispose();
  return JSON.parse(body) as ApiDeployment;
}

export async function getJson<T>(api: APIRequestContext, path: string): Promise<T> {
  const res = await api.get(path);
  expect(res.ok(), `${path} → ${res.status()}`).toBeTruthy();
  const body = (await res.json()) as T | { items: T };
  return body as T;
}
