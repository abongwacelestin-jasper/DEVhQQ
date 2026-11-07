/**
 * Profile fields edited on the Settings page: the onboarding profile API now
 * stores title, pronouns, bio, working days and email delivery server-side.
 */
import '../setup.ts';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { errorCode, startApp, type Client, type TestServer } from '../helpers/server.ts';
import { signInAs } from '../helpers/auth.ts';

interface Profile {
  displayName: string;
  title?: string;
  pronouns?: string;
  bio?: string;
  days?: string[];
  emailDelivery?: string;
  skills: string[];
  notify: string[];
}

const base = {
  displayName: 'Amara Okafor',
  timezone: 'Africa/Lagos (WAT)',
  hoursFrom: '09:00',
  hoursTo: '17:00',
  skills: ['React'],
  notify: ['assigned'],
};

let app: TestServer;
let owner: Client;
before(async () => {
  app = await startApp();
  owner = await signInAs(app, 'admin');
});
after(() => app.close());

describe('profile settings — server-backed details', () => {
  it('an Owner (no onboarding) can create a profile with the extra details', async () => {
    const res = await owner.post<{ profile: Profile }>('/api/onboarding/profile', {
      ...base,
      title: 'Founder',
      pronouns: 'she/her',
      bio: 'Runs the place.',
      days: ['Mon', 'Tue', 'Tue'],
      emailDelivery: 'daily',
    });
    assert.equal(res.status, 200, res.text);
    assert.equal(res.json.profile.title, 'Founder');
    assert.deepEqual(res.json.profile.days, ['Mon', 'Tue'], 'de-duplicated');
    const got = await owner.get<{ profile: Profile }>('/api/onboarding');
    assert.equal(got.json.profile.emailDelivery, 'daily');
    assert.equal(got.json.profile.bio, 'Runs the place.');
  });

  it('PATCH updates only the given fields and persists them', async () => {
    const res = await owner.patch<{ profile: Profile }>('/api/onboarding/profile', {
      title: 'CEO',
      days: ['Wed'],
      emailDelivery: 'off',
    });
    assert.equal(res.status, 200, res.text);
    const got = await owner.get<{ profile: Profile }>('/api/onboarding');
    assert.equal(got.json.profile.title, 'CEO');
    assert.deepEqual(got.json.profile.days, ['Wed']);
    assert.equal(got.json.profile.emailDelivery, 'off');
    assert.equal(got.json.profile.pronouns, 'she/her', 'untouched field kept');
    assert.deepEqual(got.json.profile.skills, ['React']);
  });

  it('validates the new fields', async () => {
    for (const body of [
      { days: [] },
      { days: ['Funday'] },
      { emailDelivery: 'weekly' },
      { bio: 'x'.repeat(161) },
      { title: 'x'.repeat(81) },
      { pronouns: 'x'.repeat(31) },
      { favouriteColour: 'blue' },
    ]) {
      const res = await owner.patch('/api/onboarding/profile', body);
      assert.equal(res.status, 422, `${JSON.stringify(body)}: ${res.text}`);
    }
  });

  it('a member who has not completed onboarding cannot PATCH (409)', async () => {
    const dev = await signInAs(app, 'developer');
    const res = await dev.patch('/api/onboarding/profile', { title: 'Engineer' });
    assert.equal(res.status, 409, res.text);
    assert.equal(errorCode(res), 'profile_required');
  });
});
