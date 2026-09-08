import { CosmosClient } from '@azure/cosmos';
import { DefaultAzureCredential } from '@azure/identity';
import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';

export const containers = ['events', 'registrations', 'profiles', 'inquiries', 'sessions'];

export class ConflictError extends Error {}

export function localStore(file) {
  const records = file && existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
  for (const name of containers) records[name] ??= {};
  function persist() {
    if (!file) return;
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(`${file}.tmp`, JSON.stringify(records), { mode: 0o600 });
    renameSync(`${file}.tmp`, file);
  }
  return {
    mode: 'local',
    async get(name, id, partitionKey = id) {
      const item = records[name][`${partitionKey}:${id}`];
      return item ? structuredClone(item) : null;
    },
    async create(name, item, partitionKey = item.id) {
      const key = `${partitionKey}:${item.id}`;
      if (records[name][key]) throw new ConflictError('This record already exists.');
      records[name][key] = { ...item, partitionKey, _etag: crypto.randomUUID() };
      persist();
      return structuredClone(records[name][key]);
    },
    async replace(name, item) {
      const key = `${item.partitionKey}:${item.id}`;
      if (!records[name][key] || records[name][key]._etag !== item._etag) throw new ConflictError('This record changed. Refresh and try again.');
      records[name][key] = { ...item, _etag: crypto.randomUUID() };
      persist();
      return structuredClone(records[name][key]);
    },
    async remove(name, id, partitionKey = id) {
      delete records[name][`${partitionKey}:${id}`];
      persist();
    },
    async list(name, filters = {}) {
      return Object.values(records[name]).filter(item => Object.entries(filters).every(([key, value]) => item[key] === value)).map(item => structuredClone(item));
    },
    async health() { return true; },
  };
}

export function cosmosStore(endpoint, databaseName) {
  const client = new CosmosClient({ endpoint, aadCredentials: new DefaultAzureCredential(), connectionPolicy: { requestTimeout: 10000, retryOptions: { maxRetryAttemptCount: 5 } } });
  const database = client.database(databaseName);
  async function translate(action) {
    try { return await action(); } catch (error) {
      if (error.code === 409 || error.code === 412) throw new ConflictError('This record already exists or changed. Refresh and try again.');
      throw error;
    }
  }
  return {
    mode: 'cosmos',
    async get(name, id, partitionKey = id) {
      try {
        const { resource } = await database.container(name).item(id, partitionKey).read();
        return resource ?? null;
      } catch (error) {
        if (error.code === 404) return null;
        throw error;
      }
    },
    async create(name, item, partitionKey = item.id) {
      return translate(async () => (await database.container(name).items.create({ ...item, partitionKey })).resource);
    },
    async replace(name, item) {
      return translate(async () => (await database.container(name).item(item.id, item.partitionKey).replace(item, { accessCondition: { type: 'IfMatch', condition: item._etag } })).resource);
    },
    async remove(name, id, partitionKey = id) {
      try { await database.container(name).item(id, partitionKey).delete(); } catch (error) { if (error.code !== 404) throw error; }
    },
    async list(name, filters = {}) {
      const allowed = ['userId', 'eventId', 'status'];
      const entries = Object.entries(filters);
      if (entries.some(([key]) => !allowed.includes(key))) throw new Error('Unsupported query filter.');
      const clauses = entries.map(([key], index) => `c.${key} = @value${index}`);
      const query = { query: `SELECT * FROM c${clauses.length ? ` WHERE ${clauses.join(' AND ')}` : ''}`, parameters: entries.map(([, value], index) => ({ name: `@value${index}`, value })) };
      return (await database.container(name).items.query(query).fetchAll()).resources;
    },
    async health() { await database.container('events').items.query('SELECT TOP 1 c.id FROM c').fetchAll(); return true; },
  };
}

export function configuredStore() {
  if (process.env.COSMOS_ENDPOINT) return cosmosStore(process.env.COSMOS_ENDPOINT, process.env.COSMOS_DATABASE || 'GlobalAIManilaDB');
  if (process.env.NODE_ENV === 'production') throw new Error('COSMOS_ENDPOINT is required in production.');
  return localStore(new URL('../.data/store.json', import.meta.url).pathname.replace(/^\/(\w:)/, '$1'));
}