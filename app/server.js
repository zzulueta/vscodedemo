import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { rateLimit } from 'express-rate-limit';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { configuredStore, ConflictError } from './lib/store.js';
import { InputError, newProfile, publicProfile, verifyPassword, emailAddress, digest, text, newEvent, decision, hashPassword } from './lib/domain.js';

const root = dirname(fileURLToPath(import.meta.url));
const sessionSeconds = 7 * 24 * 60 * 60;

export function createApp(store, { production = process.env.NODE_ENV === 'production', rateLimits = true } = {}) {
  const app = express();
  const sessionCookie = production ? '__Host-session' : 'session';
  const csrfCookie = production ? '__Host-csrf' : 'csrf';
  const cookieOptions = { httpOnly: true, sameSite: 'lax', secure: production, path: '/' };
  app.set('trust proxy', 1);
  app.set('view engine', 'ejs');
  app.set('views', resolve(root, 'views'));
  app.disable('x-powered-by');
  app.use(helmet({ contentSecurityPolicy: { directives: { 'script-src': ["'self'"], 'style-src': ["'self'"], 'img-src': ["'self'", 'data:'], 'font-src': ["'self'"], 'upgrade-insecure-requests': production ? [] : null } } }));
  app.use('/assets', express.static(resolve(root, 'public'), { maxAge: '1h' }));
  app.get('/assets/logo.png', (req, res) => res.sendFile(resolve(root, '../GlobalAIManila.png')));
  app.get('/vendor/lucide.js', (req, res) => res.sendFile(resolve(root, 'public/lucide.js')));
  app.get('/health', async (req, res) => {
    try { await store.health(); res.json({ status: 'ok', storage: store.mode }); }
    catch { res.status(503).json({ status: 'unavailable' }); }
  });
  app.use(express.urlencoded({ extended: false, limit: '32kb' }));
  app.use(cookieParser());
  if (rateLimits) app.use(rateLimit({ windowMs: 60000, limit: 120, standardHeaders: 'draft-8', legacyHeaders: false }));
  const authLimit = rateLimits ? rateLimit({ windowMs: 15 * 60000, limit: 20, standardHeaders: 'draft-8', legacyHeaders: false }) : (req, res, next) => next();
  const contactLimit = rateLimits ? rateLimit({ windowMs: 60 * 60000, limit: 10, standardHeaders: 'draft-8', legacyHeaders: false }) : (req, res, next) => next();
  app.use(async (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    let csrf = req.cookies[csrfCookie];
    if (typeof csrf !== 'string' || !/^[a-f0-9]{64}$/.test(csrf)) {
      csrf = randomBytes(32).toString('hex');
      res.cookie(csrfCookie, csrf, cookieOptions);
    }
    res.locals.csrf = csrf;
    res.locals.path = req.path;
    res.locals.user = null;
    res.locals.notice = { saved: 'Your profile has been saved.', registered: 'Registration submitted. We will review your request soon.', sent: 'Your inquiry has been sent. Thank you for reaching out.', created: 'Your event is published.', reviewed: 'Registration decision saved.', password: 'Your password has been changed.', signup: 'Welcome to Global AI Manila. Your profile is ready.' }[req.query.notice] ?? null;
    res.locals.date = value => new Intl.DateTimeFormat('en-PH', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Manila' }).format(new Date(value));
    const token = req.cookies[sessionCookie];
    if (typeof token === 'string' && /^[a-f0-9]{64}$/.test(token)) {
      const session = await store.get('sessions', digest(token));
      if (session && session.expiresAt > Date.now()) {
        const profile = await store.get('profiles', session.userId);
        if (profile && (session.version ?? 0) === (profile.sessionVersion ?? 0)) {
          req.profile = profile;
          res.locals.user = publicProfile(profile);
        }
      }
    }
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      const submitted = req.body?._csrf;
      if (typeof submitted !== 'string' || submitted.length !== csrf.length || !timingSafeEqual(Buffer.from(submitted), Buffer.from(csrf))) {
        return res.status(403).render('error', { title: 'Please refresh this page', message: 'Your form expired or could not be verified. Go back, refresh the page, and try again.' });
      }
    }
    next();
  });

  function member(req, res, next) {
    if (!req.profile) return res.redirect('/login');
    next();
  }
  function admin(req, res, next) {
    if (req.profile?.role !== 'admin') return res.status(403).render('error', { title: 'Administrator access required', message: 'This page is only available to community administrators.' });
    next();
  }
  async function signIn(req, res, profile) {
    if (req.cookies[sessionCookie]) await store.remove('sessions', digest(req.cookies[sessionCookie]));
    const token = randomBytes(32).toString('hex');
    await store.create('sessions', { id: digest(token), userId: profile.id, version: profile.sessionVersion ?? 0, expiresAt: Date.now() + sessionSeconds * 1000, ttl: sessionSeconds });
    res.cookie(sessionCookie, token, { ...cookieOptions, maxAge: sessionSeconds * 1000 });
  }
  const orderedEvents = async () => (await store.list('events')).sort((first, second) => first.startsAt.localeCompare(second.startsAt));
  app.get('/', async (req, res) => res.render('home', { title: 'Global AI Manila', events: (await orderedEvents()).filter(event => Date.parse(event.startsAt) > Date.now()).slice(0, 3) }));
  app.get('/about', (req, res) => res.render('about', { title: 'About Us' }));
  app.get('/events', async (req, res) => {
    const events = await orderedEvents();
    res.render('events', { title: 'Events', events: events.filter(event => Date.parse(event.startsAt) > Date.now()), pastEvents: events.filter(event => Date.parse(event.startsAt) <= Date.now()).reverse() });
  });
  app.get('/events/:id', async (req, res) => {
    const event = await store.get('events', req.params.id);
    if (!event) return res.status(404).render('error', { title: 'Event not found', message: 'This event is no longer available.' });
    const registration = req.profile ? await store.get('registrations', `${event.id}-${req.profile.id}`, event.id) : null;
    res.render('event', { title: event.title, event, registration, isPast: Date.parse(event.startsAt) <= Date.now() });
  });
  app.post('/events/:id/register', member, async (req, res) => {
    const event = await store.get('events', req.params.id);
    if (!event || Date.parse(event.startsAt) <= Date.now()) throw new InputError('Registration is closed for this event.');
    await store.create('registrations', { id: `${event.id}-${req.profile.id}`, eventId: event.id, eventTitle: event.title, userId: req.profile.id, name: req.profile.name, email: req.profile.email, note: text(req.body.note ?? '', 'Note', 0, 1000), status: 'pending', createdAt: new Date().toISOString() }, event.id);
    res.redirect(`/events/${event.id}?notice=registered`);
  });
  app.get('/signup', (req, res) => res.render('auth', { title: 'Join the community', signup: true }));
  app.post('/signup', authLimit, async (req, res) => {
    const profile = await newProfile(req.body);
    await store.create('profiles', profile);
    await signIn(req, res, profile);
    res.redirect('/profile?notice=signup');
  });
  app.get('/login', (req, res) => res.render('auth', { title: 'Welcome back', signup: false }));
  app.post('/login', authLimit, async (req, res) => {
    const profile = await store.get('profiles', digest(emailAddress(req.body.email)));
    const valid = await verifyPassword(req.body.password, profile?.passwordHash ?? `${'0'.repeat(32)}:${'0'.repeat(128)}`);
    if (!profile || !valid) return res.status(401).render('error', { title: 'Unable to sign in', message: 'The email or password was incorrect. Please try again.' });
    await signIn(req, res, profile);
    res.redirect(profile.role === 'admin' ? '/admin' : '/profile');
  });
  app.post('/logout', async (req, res) => {
    if (req.cookies[sessionCookie]) await store.remove('sessions', digest(req.cookies[sessionCookie]));
    res.clearCookie(sessionCookie, cookieOptions);
    res.redirect('/');
  });
  app.get('/profile', member, async (req, res) => res.render('profile', { title: 'Your community profile', registrations: (await store.list('registrations', { userId: req.profile.id })).sort((first, second) => second.createdAt.localeCompare(first.createdAt)) }));
  app.post('/profile', member, async (req, res) => {
    await store.replace('profiles', { ...req.profile, name: text(req.body.name, 'Name', 2, 80), bio: text(req.body.bio ?? '', 'Bio', 0, 500) });
    res.redirect('/profile?notice=saved');
  });
  app.post('/profile/password', member, authLimit, async (req, res) => {
    if (!await verifyPassword(req.body.currentPassword, req.profile.passwordHash)) throw new InputError('Your current password was incorrect.');
    const updated = await store.replace('profiles', { ...req.profile, passwordHash: await hashPassword(req.body.password), sessionVersion: (req.profile.sessionVersion ?? 0) + 1 });
    await signIn(req, res, updated);
    res.redirect('/profile?notice=password');
  });
  app.get('/contact', (req, res) => res.render('contact', { title: 'Contact Us' }));
  app.post('/contact', contactLimit, async (req, res) => {
    if (req.body.website) throw new InputError('Unable to submit this inquiry.');
    await store.create('inquiries', { id: randomUUID(), name: text(req.body.name, 'Name', 2, 80), email: emailAddress(req.body.email), subject: text(req.body.subject, 'Subject', 3, 120), message: text(req.body.message, 'Message', 10, 5000), status: 'new', createdAt: new Date().toISOString() });
    res.redirect('/contact?notice=sent');
  });
  app.get('/admin', admin, async (req, res) => {
    const [events, registrations, inquiries] = await Promise.all([orderedEvents(), store.list('registrations'), store.list('inquiries')]);
    res.render('admin', { title: 'Community administration', events, registrations: registrations.sort((first, second) => second.createdAt.localeCompare(first.createdAt)), inquiries: inquiries.sort((first, second) => second.createdAt.localeCompare(first.createdAt)) });
  });
  app.post('/admin/events', admin, async (req, res) => {
    const event = newEvent(req.body);
    await store.create('events', { ...event, id: randomUUID(), createdBy: req.profile.id, createdAt: new Date().toISOString() });
    res.redirect('/events?notice=created');
  });
  app.post('/admin/registrations/:eventId/:id/decision', admin, async (req, res) => {
    const registration = await store.get('registrations', req.params.id, req.params.eventId);
    if (!registration) throw new InputError('Registration not found.');
    if (registration.status !== 'pending') throw new ConflictError('This registration has already been reviewed.');
    await store.replace('registrations', { ...registration, status: decision(req.body.status), reviewedBy: req.profile.id, reviewedAt: new Date().toISOString() });
    res.redirect('/admin?notice=reviewed');
  });
  app.post('/admin/inquiries/:id/resolve', admin, async (req, res) => {
    const inquiry = await store.get('inquiries', req.params.id);
    if (!inquiry) throw new InputError('Inquiry not found.');
    await store.replace('inquiries', { ...inquiry, status: 'resolved' });
    res.redirect('/admin');
  });
  app.use((req, res) => res.status(404).render('error', { title: 'Page not found', message: 'There is nothing at this address. Let us get you back to the community.' }));
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    const expected = error instanceof InputError || error instanceof ConflictError;
    if (!expected) console.error(JSON.stringify({ type: 'request_error', code: error.code, name: error.name }));
    res.status(error instanceof ConflictError ? 409 : expected ? 400 : 500).render('error', { title: expected ? 'Please check your request' : 'Something went wrong', message: expected ? error.message : 'We could not complete your request. Please try again shortly.' });
  });
  return app;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const store = configuredStore();
  const server = createApp(store).listen(process.env.PORT || 3000, () => console.log(`Global AI Manila listening on port ${process.env.PORT || 3000} (${store.mode} storage)`));
  process.on('SIGTERM', () => server.close(() => process.exit(0)));
}