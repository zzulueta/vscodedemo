import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../server.js';
import { localStore, ConflictError } from '../lib/store.js';
import { digest, newProfile } from '../lib/domain.js';

async function csrf(agent, path = '/signup') {
  const response = await agent.get(path).expect(200);
  return response.text.match(/name="_csrf" value="([a-f0-9]+)"/)[1];
}

async function signup(agent, email = 'member@example.com') {
  const token = await csrf(agent);
  await agent.post('/signup').type('form').send({ _csrf: token, name: 'Test Member', email, bio: '<script>alert(1)</script>', password: 'a-strong-test-password', role: 'admin' }).expect(302);
  return token;
}

test('public pages render and missing paths are handled', async () => {
  const app = createApp(localStore(), { rateLimits: false });
  for (const path of ['/', '/about', '/events', '/contact', '/signup', '/login']) {
    const response = await request(app).get(path).expect(200);
    assert.match(response.text, /Global AI/);
    assert.equal(response.headers['cache-control'], 'no-store');
    assert.match(response.headers['content-security-policy'], /script-src 'self'/);
  }
  await request(app).get('/not-found').expect(404);
  await request(app).get('/health').expect(200, { status: 'ok', storage: 'local' });
});

test('membership, authorization, event approval, duplicate prevention, and inquiry workflow', async () => {
  const store = localStore();
  const app = createApp(store, { rateLimits: false });
  const member = request.agent(app);
  const token = await signup(member);
  await member.get('/admin').expect(403);
  await member.post('/admin/events').type('form').send({ _csrf: token }).expect(403);
  assert.equal((await store.get('profiles', digest('member@example.com'))).role, 'member');
  const profilePage = await member.get('/profile').expect(200);
  assert.match(profilePage.text, /&lt;script&gt;/);
  assert.doesNotMatch(profilePage.text, /passwordHash/);
  await member.post('/profile').type('form').send({ name: 'No CSRF', bio: '' }).expect(403);
  await member.post('/profile').type('form').send({ _csrf: token, name: 'Updated Member', bio: 'Hello Manila', role: 'admin' }).expect(302);

  const organizerProfile = await newProfile({ name: 'Organizer', email: 'organizer@example.com', bio: '', password: 'another-strong-password' });
  await store.create('profiles', { ...organizerProfile, role: 'admin' });
  const organizer = request.agent(app);
  const adminToken = await csrf(organizer, '/login');
  await organizer.post('/login').type('form').send({ _csrf: adminToken, email: 'organizer@example.com', password: 'another-strong-password' }).expect(302);
  await organizer.get('/admin').expect(200);
  const future = new Date(Date.now() + 86400000).toISOString();
  await organizer.post('/admin/events').type('form').send({ _csrf: adminToken, title: 'Manila AI Workshop', description: 'A practical hands-on workshop for the community.', startsAt: future, format: 'In person', location: 'Manila' }).expect(302);
  const [event] = await store.list('events');
  await member.get(`/events/${event.id}`).expect(200);
  await member.post(`/events/${event.id}/register`).type('form').send({ _csrf: token, note: 'Excited to join!', status: 'approved' }).expect(302);
  await member.post(`/events/${event.id}/register`).type('form').send({ _csrf: token }).expect(409);
  const [registration] = await store.list('registrations');
  assert.equal(registration.status, 'pending');
  const decisionPath = `/admin/registrations/${event.id}/${registration.id}/decision`;
  await member.post(decisionPath).type('form').send({ _csrf: token, status: 'approved' }).expect(403);
  await organizer.post(decisionPath).type('form').send({ _csrf: adminToken, status: 'approved' }).expect(302);
  await organizer.post(decisionPath).type('form').send({ _csrf: adminToken, status: 'rejected' }).expect(409);
  assert.equal((await store.get('registrations', registration.id, event.id)).status, 'approved');
  assert.match((await member.get('/profile')).text, /approved/);
  await member.post('/contact').type('form').send({ _csrf: token, name: 'Member', email: 'member@example.com', subject: 'Workshop question', message: 'Can I bring my own laptop?' }).expect(302);
  const [inquiry] = await store.list('inquiries');
  await organizer.post(`/admin/inquiries/${inquiry.id}/resolve`).type('form').send({ _csrf: adminToken }).expect(302);
  assert.equal((await store.get('inquiries', inquiry.id)).status, 'resolved');
  await member.post('/logout').type('form').send({ _csrf: token }).expect(302);
  await member.get('/profile').expect(302);
});

test('rejection is visible only to the affected member and registrations close for past events', async () => {
  const store = localStore();
  const app = createApp(store, { rateLimits: false });
  const member = request.agent(app);
  const token = await signup(member);
  const outsider = request.agent(app);
  await signup(outsider, 'other@example.com');
  await store.create('events', { id: 'past', title: 'Past workshop', startsAt: '2020-01-01T00:00:00Z', description: 'A past event', location: 'Manila', format: 'Online' });
  await member.post('/events/past/register').type('form').send({ _csrf: token }).expect(400);
  await store.create('registrations', { id: 'private', userId: digest('member@example.com'), eventId: 'past', eventTitle: 'Private registration title', status: 'rejected', createdAt: new Date().toISOString() }, 'past');
  assert.match((await member.get('/profile')).text, /rejected/);
  assert.doesNotMatch((await outsider.get('/profile')).text, /Private registration title/);
});

test('password changes invalidate existing sessions', async () => {
  const app = createApp(localStore(), { rateLimits: false });
  const first = request.agent(app);
  const token = await signup(first);
  const second = request.agent(app);
  const secondToken = await csrf(second, '/login');
  await second.post('/login').type('form').send({ _csrf: secondToken, email: 'member@example.com', password: 'a-strong-test-password' }).expect(302);
  await first.post('/profile/password').type('form').send({ _csrf: token, currentPassword: 'a-strong-test-password', password: 'new-strong-test-password' }).expect(302);
  await first.get('/profile').expect(200);
  await second.get('/profile').expect(302);
});

test('optimistic concurrency rejects stale writes', async () => {
  const store = localStore();
  const original = await store.create('events', { id: 'concurrent', title: 'Original' });
  await store.replace('events', { ...original, title: 'First update' });
  await assert.rejects(store.replace('events', { ...original, title: 'Stale update' }), ConflictError);
});

test('production cookies are secure and expired sessions do not authenticate', async () => {
  const store = localStore();
  const app = createApp(store, { production: true, rateLimits: false });
  const response = await request(app).get('/signup').expect(200);
  assert.match(response.headers['set-cookie'][0], /__Host-csrf=.*HttpOnly; Secure; SameSite=Lax/);
  const token = 'a'.repeat(64);
  await store.create('sessions', { id: digest(token), userId: 'nobody', expiresAt: 0 });
  await request(app).get('/profile').set('Cookie', `__Host-session=${token}`).expect(302);
});