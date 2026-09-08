import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);

export class InputError extends Error {}

export function text(value, label, minimum, maximum) {
  if (typeof value !== 'string') throw new InputError(`${label} is required.`);
  const clean = value.trim();
  if (clean.length < minimum || clean.length > maximum) {
    throw new InputError(`${label} must be between ${minimum} and ${maximum} characters.`);
  }
  return clean;
}

export function emailAddress(value) {
  const email = text(value, 'Email', 3, 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new InputError('Enter a valid email address.');
  return email;
}

export function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

export async function hashPassword(password) {
  if (typeof password !== 'string' || password.length < 12 || password.length > 128) {
    throw new InputError('Use a password between 12 and 128 characters.');
  }
  const salt = randomBytes(16).toString('hex');
  const derived = await scrypt(password, salt, 64);
  return `${salt}:${derived.toString('hex')}`;
}

export async function verifyPassword(password, encoded) {
  if (typeof password !== 'string' || password.length > 128 || !encoded) return false;
  const [salt, stored] = encoded.split(':');
  const expected = Buffer.from(stored, 'hex');
  const actual = await scrypt(password, salt, 64);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export async function newProfile(input) {
  const email = emailAddress(input.email);
  return {
    id: digest(email),
    email,
    name: text(input.name, 'Name', 2, 80),
    bio: text(input.bio ?? '', 'Bio', 0, 500),
    passwordHash: await hashPassword(input.password),
    role: 'member',
    createdAt: new Date().toISOString(),
  };
}

export function publicProfile(profile) {
  return { id: profile.id, name: profile.name, email: profile.email, bio: profile.bio, role: profile.role };
}

export function newEvent(input, now = Date.now()) {
  const startsAt = new Date(input.startsAt);
  if (!Number.isFinite(startsAt.getTime()) || startsAt.getTime() <= now) {
    throw new InputError('Choose a future event date and time.');
  }
  if (!['In person', 'Online', 'Hybrid'].includes(input.format)) throw new InputError('Choose an event format.');
  return {
    title: text(input.title, 'Title', 3, 120),
    description: text(input.description, 'Description', 10, 5000),
    location: text(input.location, 'Location', 3, 200),
    startsAt: startsAt.toISOString(),
    format: input.format,
  };
}

export function decision(value) {
  if (!['approved', 'rejected'].includes(value)) throw new InputError('Choose approve or reject.');
  return value;
}