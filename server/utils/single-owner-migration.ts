import { queryDb, type useDb } from './db'
import { queryRows } from './surrealResult'

// Idempotent and atomic; also runs after restore because older backups can carry multi-user data.
// Data rewrites must precede the REMOVE FIELD statements because they read the legacy fields.
const COLLAPSE_SQL = `
BEGIN TRANSACTION;
UPDATE post SET password_hash = password_owner.password_hash WHERE password_source = 'user';
UPDATE post SET visibility = 'private', password_hash = NONE, password_hint = NONE
  WHERE password_source = 'user' AND visibility = 'password' AND (password_hash IS NONE OR password_hash = '');
UPDATE files SET
    referenced_by = referenced_by.filter(|$ref| record::tb($ref) != 'users' OR $ref = users:admin),
    reference_count = array::len(referenced_by.filter(|$ref| record::tb($ref) != 'users' OR $ref = users:admin)),
    updated_at = time::now()
  WHERE referenced_by.any(|$ref| record::tb($ref) = 'users' AND $ref != users:admin) RETURN NONE;
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
UPDATE users UNSET role RETURN NONE;
UPDATE post UNSET author, author_username, password_source, password_owner RETURN NONE;
UPDATE tag UNSET created_by RETURN NONE;
UPDATE category UNSET created_by RETURN NONE;
UPDATE versions UNSET created_by RETURN NONE;
UPDATE files UNSET created_by, uploaded_by RETURN NONE;
COMMIT TRANSACTION;
`

export async function collapseToSingleOwner(db: Awaited<ReturnType<typeof useDb>>): Promise<{removedUsers: string[]}> {
  const accounts = await queryDb(db,
    'SELECT VALUE id FROM users:admin; SELECT VALUE username FROM users WHERE id != users:admin;',
    undefined, {label: 'single owner migration preflight', retry: 'never'})
  const removedUsers = queryRows<string>(accounts, 1)
  if (!queryRows(accounts, 0).length && removedUsers.length) {
    throw new Error('Single-owner migration requires users:admin; refusing to remove the remaining accounts')
  }
  await queryDb(db, COLLAPSE_SQL, undefined, {label: 'single owner migration', timeoutMs: 120_000, retry: 'never'})
  if (removedUsers.length) console.warn(`[single-owner] removed ${removedUsers.length} non-owner account(s): ${removedUsers.join(', ')}`)
  return {removedUsers}
}
