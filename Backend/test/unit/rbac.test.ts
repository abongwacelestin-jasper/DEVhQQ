import '../setup.ts';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  assertProduct,
  can,
  canSeeProduct,
  permissionMatrix,
  requireArea,
  requireElevation,
  requireStepUp,
} from '../../auth/rbac.ts';
import type { Ctx, Middleware } from '../../lib/http.ts';
import {
  HttpError,
  type PermissionArea,
  type PermissionLevel,
  type Principal,
  type ProductId,
  type RoleName,
} from '../../types.ts';

const ROLES: RoleName[] = [
  'Owner',
  'Project manager',
  'Developer',
  'Designer',
  'Tester',
  'Operations',
];
const AREAS: PermissionArea[] = [
  'Organization',
  'Product',
  'Project',
  'Repository',
  'Deployment',
  'Infrastructure',
  'Administration',
];
const LEVELS: PermissionLevel[] = ['none', 'view', 'contribute', 'manage', 'admin'];
const PRODUCTS: ProductId[] = ['renewberry', 'blog', 'mirror'];

/**
 * The policy as specified (BOARD / WAVE4: "Developer keeps Deployment: view").
 * Columns: Owner, PM, Developer, Designer, Tester, Operations. Any change to
 * the live matrix must be a deliberate change here too.
 */
const SPEC: Record<PermissionArea, PermissionLevel[]> = {
  Organization: ['admin', 'view', 'view', 'view', 'view', 'view'],
  Product: ['admin', 'manage', 'contribute', 'contribute', 'contribute', 'view'],
  Project: ['admin', 'manage', 'contribute', 'contribute', 'contribute', 'view'],
  Repository: ['admin', 'view', 'contribute', 'view', 'view', 'view'],
  Deployment: ['admin', 'view', 'view', 'none', 'view', 'manage'],
  Infrastructure: ['admin', 'none', 'view', 'none', 'none', 'manage'],
  Administration: ['admin', 'none', 'none', 'none', 'none', 'view'],
};

function principal(role: RoleName, over: Partial<Principal> = {}): Principal {
  return {
    memberId: `m-${role}`,
    role,
    products: role === 'Owner' ? [] : ['renewberry'],
    sessionId: 's',
    verifiedAt: Date.now(),
    elevations: [],
    ...over,
  };
}

/** Runs a middleware against a minimal ctx; resolves to 'next' or the thrown HttpError. */
async function runGuard(mw: Middleware, p?: Principal, params: Record<string, string> = {}) {
  const ctx = { principal: p, params } as unknown as Ctx;
  try {
    const r = await mw(ctx, async () => 'next');
    return r as string;
  } catch (e) {
    assert.ok(e instanceof HttpError, `expected HttpError, got ${String(e)}`);
    return e;
  }
}

describe('auth/rbac — permission matrix', () => {
  it('matches the specified policy cell by cell', () => {
    for (const area of AREAS)
      ROLES.forEach((role, i) =>
        assert.equal(permissionMatrix[area][role], SPEC[area][i], `${area} × ${role}`),
      );
    assert.deepEqual(Object.keys(permissionMatrix).sort(), [...AREAS].sort());
  });

  it('can() grants exactly the levels at or below the role level (full table)', () => {
    for (const area of AREAS)
      for (const role of ROLES)
        for (const level of LEVELS) {
          const granted = LEVELS.indexOf(permissionMatrix[area][role]);
          assert.equal(
            can(principal(role), area, level),
            LEVELS.indexOf(level) <= granted,
            `${role} ${level} on ${area}`,
          );
        }
  });

  it('only the Owner holds admin anywhere', () => {
    for (const area of AREAS)
      for (const role of ROLES)
        assert.equal(
          permissionMatrix[area][role] === 'admin',
          role === 'Owner',
          `${area} × ${role}`,
        );
  });

  it('least privilege: Developer keeps Deployment:view and nothing more', () => {
    assert.equal(can(principal('Developer'), 'Deployment', 'view'), true);
    assert.equal(can(principal('Developer'), 'Deployment', 'contribute'), false);
    assert.equal(can(principal('Designer'), 'Deployment', 'view'), false);
  });

  it('can() depends only on role, never on products or elevations', () => {
    for (const role of ROLES) {
      const a = principal(role, { products: [] });
      const b = principal(role, { products: PRODUCTS, elevations: ['production:renewberry'] });
      for (const area of AREAS)
        for (const level of LEVELS) assert.equal(can(a, area, level), can(b, area, level));
    }
  });
});

describe('auth/rbac — product scope', () => {
  it('Owner sees every product, even with no assignments', () => {
    for (const product of PRODUCTS)
      assert.equal(canSeeProduct(principal('Owner', { products: [] }), product), true);
  });

  it('everyone else sees exactly their assigned products', () => {
    for (const role of ROLES.filter((r) => r !== 'Owner'))
      for (let mask = 0; mask < 8; mask++) {
        const assigned = PRODUCTS.filter((_, i) => mask & (1 << i));
        const p = principal(role, { products: assigned });
        for (const product of PRODUCTS)
          assert.equal(canSeeProduct(p, product), assigned.includes(product), `${role} ${product}`);
      }
  });

  it('assertProduct hides out-of-scope resources as 404, not 403', () => {
    assert.doesNotThrow(() => assertProduct(principal('Developer'), 'renewberry'));
    assert.throws(
      () => assertProduct(principal('Developer'), 'blog'),
      (e: unknown) => e instanceof HttpError && e.status === 404 && e.code === 'not_found',
    );
  });
});

describe('auth/rbac — guards', () => {
  it('requireArea: 401 without a principal, 403 below the level, next() otherwise (full table)', async () => {
    for (const area of AREAS)
      for (const level of LEVELS.slice(1)) {
        const guard = requireArea(area, level);
        const anon = await runGuard(guard);
        assert.ok(anon instanceof HttpError && anon.status === 401);
        for (const role of ROLES) {
          const r = await runGuard(guard, principal(role));
          if (can(principal(role), area, level))
            assert.equal(r, 'next', `${role} ${level} ${area}`);
          else
            assert.ok(
              r instanceof HttpError && r.status === 403 && r.code === 'forbidden',
              `${role} ${level} ${area}`,
            );
        }
      }
  });
});

describe('auth/rbac — step-up age', () => {
  it('accepts a verification up to maxAge old and rejects one older', async (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: 1_000_000_000_000 });
    const verifiedAt = Date.now();
    const guard = requireStepUp(5 * 60_000);
    t.mock.timers.tick(5 * 60_000);
    assert.equal(
      await runGuard(guard, principal('Owner', { verifiedAt })),
      'next',
      'exactly maxAge',
    );
    t.mock.timers.tick(1);
    const r = await runGuard(guard, principal('Owner', { verifiedAt }));
    assert.ok(r instanceof HttpError && r.status === 401 && r.code === 'step_up_required');
  });

  it('verifiedAt = 0 (idle / IP change) always demands step-up', async () => {
    const r = await runGuard(requireStepUp(), principal('Owner', { verifiedAt: 0 }));
    assert.ok(r instanceof HttpError && r.code === 'step_up_required');
  });

  it('honours a custom maxAge', async (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: 2_000_000_000_000 });
    const p = principal('Developer', { verifiedAt: Date.now() });
    t.mock.timers.tick(61_000);
    assert.ok((await runGuard(requireStepUp(60_000), p)) instanceof HttpError);
    assert.equal(await runGuard(requireStepUp(120_000), p), 'next');
  });

  it('401 unauthenticated without a principal', async () => {
    const r = await runGuard(requireStepUp());
    assert.ok(r instanceof HttpError && r.code === 'unauthenticated');
  });
});

describe('auth/rbac — JIT elevation', () => {
  const guard = requireElevation((params) => `production:${params.product}`);

  it('Owner never needs an elevation', async () => {
    assert.equal(await runGuard(guard, principal('Owner'), { product: 'blog' }), 'next');
  });

  it('other roles need the exact scope derived from the request', async () => {
    for (const role of ROLES.filter((r) => r !== 'Owner')) {
      const none = await runGuard(guard, principal(role), { product: 'renewberry' });
      assert.ok(
        none instanceof HttpError && none.status === 403 && none.code === 'elevation_required',
      );
      const wrong = await runGuard(guard, principal(role, { elevations: ['production:blog'] }), {
        product: 'renewberry',
      });
      assert.ok(wrong instanceof HttpError && wrong.code === 'elevation_required');
      assert.equal(
        await runGuard(guard, principal(role, { elevations: ['production:renewberry'] }), {
          product: 'renewberry',
        }),
        'next',
      );
    }
  });

  it('401 without a principal', async () => {
    const r = await runGuard(guard, undefined, { product: 'blog' });
    assert.ok(r instanceof HttpError && r.status === 401);
  });
});
