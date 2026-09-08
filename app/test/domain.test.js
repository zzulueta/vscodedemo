import test from 'node:test';
import assert from 'node:assert/strict';
import { newProfile, verifyPassword, publicProfile, newEvent, decision, InputError } from '../lib/domain.js';

test('signup normalizes identity and never accepts an administrator role', async () => {
  const profile = await newProfile({ name: 'Manila Member', email: ' MEMBER@Example.com ', bio: 'Learning AI', password: 'a-long-test-password', role: 'admin' });
  assert.equal(profile.email, 'member@example.com');
  assert.equal(profile.role, 'member');
  assert.equal(await verifyPassword('a-long-test-password', profile.passwordHash), true);
  assert.equal(await verifyPassword('wrong-password', profile.passwordHash), false);
  assert.equal('passwordHash' in publicProfile(profile), false);
});

test('signup rejects invalid email and short passwords', async () => {
  await assert.rejects(newProfile({ name: 'Member', email: 'bad', password: 'a-long-test-password' }), InputError);
  await assert.rejects(newProfile({ name: 'Member', email: 'member@example.com', password: 'short' }), InputError);
});

test('event dates must be future and decisions are allowlisted', () => {
  const input = { title: 'Community workshop', description: 'Build something together', location: 'Manila', format: 'In person', startsAt: '2030-01-01T10:00:00+08:00' };
  assert.equal(newEvent(input, 0).startsAt, '2030-01-01T02:00:00.000Z');
  assert.throws(() => newEvent(input, Date.parse('2031-01-01')), InputError);
  assert.throws(() => decision('admin'), InputError);
  assert.equal(decision('approved'), 'approved');
});