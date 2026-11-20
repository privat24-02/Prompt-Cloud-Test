import Dexie, { type EntityTable } from 'dexie';
import type { Category, Prompt, AppMetadata } from '../types';
export const db = new Dexie('PromptCloudDB') as Dexie & { categories: EntityTable<Category,'id'>; prompts: EntityTable<Prompt,'id'>; appMetadata: EntityTable<AppMetadata,'key'> };
db.version(1).stores({ categories: 'id, name, createdAt', prompts: 'id, categoryId, title, createdAt, updatedAt', appMetadata: 'key' });
export const now = () => new Date().toISOString();
export const uid = () => crypto.randomUUID();
