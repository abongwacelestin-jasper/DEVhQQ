import '../setup.ts';
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { seed } from '../../store/db.ts';
import { canReceiveEvent, eventProduct } from '../../security/eventPolicy.ts';
import type { BusEvent } from '../../lib/events.ts';
import type { Principal, ProductId, RoleName } from '../../types.ts';

const ev = (type: string, data: Record<string, unknown> = {}, product?: string): BusEvent => ({
  type,
  at: new Date(0).toISOString(),
  data,
  ...(product ? { product } : {}),
});

function who(role: RoleName, products: ProductId[]): Principal {
  return { memberId: `x-${role}`, role, products, sessionId: 's', verifiedAt: 0, elevations: [] };
}

const owner = who('Owner', []);
const ops = who('Operations', ['renewberry']);
const dev = who('Developer', ['renewberry']);
const designer = who('Designer', ['mirror']);
const pm = who('Project manager', ['blog']);

before(async () => {
  await seed();
});

describe('security/eventPolicy — security events', () => {
  const types = [
    'audit',
    'signin',
    'team',
    'member.deactivated',
    'auth.locked',
    'security.alert',
    'token.revoked',
    'jit.approved',
  ];
  for (const type of types) {
    it(`${type} reaches Administration:view only`, () => {
      assert.equal(canReceiveEvent(owner, ev(type)), true);
      assert.equal(canReceiveEvent(ops, ev(type)), true);
      for (const p of [dev, designer, pm])
        assert.equal(canReceiveEvent(p, ev(type)), false, p.role);
    });
  }

  it('a product tag does not downgrade a security event to product visibility', () => {
    assert.equal(canReceiveEvent(dev, ev('audit', { product: 'renewberry' }, 'renewberry')), false);
  });
});

describe('security/eventPolicy — product events', () => {
  it('direct product (envelope or payload) decides visibility', () => {
    for (const type of [
      'task',
      'deployment',
      'incident',
      'monitor',
      'repo',
      'pull_request',
      'ci',
      'code_finding',
      'integration',
      'monitor.check',
    ]) {
      assert.equal(canReceiveEvent(dev, ev(type, {}, 'renewberry')), true, type);
      assert.equal(canReceiveEvent(dev, ev(type, { product: 'renewberry' })), true, type);
      assert.equal(canReceiveEvent(dev, ev(type, {}, 'blog')), false, type);
      assert.equal(canReceiveEvent(owner, ev(type, {}, 'blog')), true, type);
    }
  });

  it('the envelope product wins over the payload', () => {
    assert.equal(eventProduct(ev('task', { product: 'renewberry' }, 'blog')), 'blog');
  });

  it('unknown product names are not delivered to anyone', () => {
    assert.equal(eventProduct(ev('task', {}, 'evil')), undefined);
    assert.equal(canReceiveEvent(owner, ev('task', {}, 'evil')), false);
  });

  it('resolves the product from the referenced record', () => {
    assert.equal(eventProduct(ev('task', { key: 'BL-17' })), 'blog');
    assert.equal(eventProduct(ev('task', { taskKey: 'RB-212' })), 'renewberry');
    assert.equal(eventProduct(ev('deployment', { id: 'd-1045' })), 'mirror');
    assert.equal(eventProduct(ev('incident', { id: 'INC-31' })), 'renewberry');
    assert.equal(canReceiveEvent(pm, ev('task', { key: 'BL-17' })), true);
    assert.equal(canReceiveEvent(dev, ev('task', { key: 'BL-17' })), false);
    assert.equal(canReceiveEvent(designer, ev('deployment', { id: 'd-1045' })), true);
  });

  it('undeterminable products are denied (fail closed)', () => {
    for (const e of [
      ev('task', {}),
      ev('task', { key: 'NOPE-1' }),
      ev('task', { key: 42 }),
      ev('deployment', { id: '' }),
      ev('monitor', { id: 'm-1' }),
      ev('repo', {}),
    ])
      assert.equal(canReceiveEvent(owner, e), false, JSON.stringify(e));
  });
});

describe('security/eventPolicy — default deny', () => {
  it('any other event type is delivered to nobody', () => {
    for (const type of [
      'message.created',
      'notification.created',
      'backup',
      'system',
      'auditx',
      'tasks',
      'members.x',
      '',
    ])
      for (const p of [owner, ops, dev])
        assert.equal(canReceiveEvent(p, ev(type, {}, 'renewberry')), false, `${type} → ${p.role}`);
  });
});
