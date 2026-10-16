import { queryDb, type useDb } from './db'

// Idempotent; also runs after restore because older backups can carry multi-user data.
const COLLAPSE_SQL = `
UPDATE post SET password_hash = users:admin.password_hash WHERE password_source = 'user';
DELETE trusted_devices WHERE user != users:admin;
DELETE users WHERE id != users:admin;
REMOVE TABLE IF EXISTS edit_lock;
REMOVE INDEX IF EXISTS users_role ON users;
REMOVE FIELD IF EXISTS role ON users;
REMOVE INDEX IF EXISTS post_author ON post;
REMOVE FIELD IF EXISTS author ON post;
REMOVE FIELD IF EXISTS author_username ON post;
REMOVE FIELD IF EXISTS password_source ON post;
REMOVE FIELD IF EXISTS password_owner ON post;
REMOVE INDEX IF EXISTS tag_created_by ON tag;
REMOVE FIELD IF EXISTS created_by ON tag;
REMOVE INDEX IF EXISTS category_created_by ON category;
REMOVE FIELD IF EXISTS created_by ON category;
REMOVE FIELD IF EXISTS created_by ON versions;
REMOVE INDEX IF EXISTS files_created_by ON files;
REMOVE FIELD IF EXISTS created_by ON files;
REMOVE FIELD IF EXISTS uploaded_by ON files;
UPDATE users UNSET role;
UPDATE post UNSET author, author_username, password_source, password_owner;
UPDATE tag UNSET created_by;
UPDATE category UNSET created_by;
UPDATE versions UNSET created_by;
UPDATE files UNSET created_by, uploaded_by;
`

export async function collapseToSingleOwner(db: Awaited<ReturnType<typeof useDb>>): Promise<void> {
  await queryDb(db, COLLAPSE_SQL, undefined, {label: 'single owner migration', timeoutMs: 120_000, retry: 'never'})
}
