import { useEffect, useState } from 'react';
import type { DemoAccountsResponse } from '../types';
import { getDemoAccounts } from './endpoints';

const DISABLED: DemoAccountsResponse = { enabled: false, accounts: [] };
let cached: Promise<DemoAccountsResponse> | null = null;

/**
 * Demo accounts and hints, exactly as the server publishes them
 * (`GET /api/auth/demo-accounts`). Disabled until the server says otherwise,
 * so production builds never show a demo password or code.
 */
export function useDemoConfig(): DemoAccountsResponse {
  const [demo, setDemo] = useState<DemoAccountsResponse>(DISABLED);
  useEffect(() => {
    let alive = true;
    cached ??= getDemoAccounts().then((r) => {
      if (!r.enabled) cached = null; // re-ask next time: the server may have been down
      return r;
    });
    void cached.then((r) => alive && setDemo(r));
    return () => {
      alive = false;
    };
  }, []);
  return demo;
}
