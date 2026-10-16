-- ============ CLEANUP LEGACY TABLES & FIELDS ============
REMOVE TABLE IF EXISTS asset;
REMOVE TABLE IF EXISTS media;
REMOVE TABLE IF EXISTS concept;
REMOVE TABLE IF EXISTS mentions;
REMOVE INDEX IF EXISTS post_featured ON post;
REMOVE INDEX IF EXISTS post_title_fts ON post;
REMOVE INDEX IF EXISTS post_summary_fts ON post;
REMOVE INDEX IF EXISTS block_text_fts ON block;
REMOVE INDEX IF EXISTS files_original_name_fts ON files;
REMOVE INDEX IF EXISTS files_comment_fts ON files;
REMOVE FIELD IF EXISTS content_json ON post;
REMOVE FIELD IF EXISTS content_text ON post;
REMOVE FIELD IF EXISTS is_featured ON post;
REMOVE FIELD IF EXISTS featured_at ON post;
REMOVE INDEX IF EXISTS post_content_fts ON post;
REMOVE TABLE IF EXISTS logging_settings;

-- ============ ANALYZER ============
-- Multilingual full-text search (English + CJK: Simplified/Traditional Chinese, Japanese).
-- IMPORTANT: SurrealDB applies the ngram filter ONLY at indexing time, never at query time
-- (see core idx/ft/analyzer/filter.rs is_stage). Queries are matched as whole tokens, so the
-- ngram MAX must be >= the longest exact query token you want to match. ngram(1, 2) breaks all
-- multi-char search (English words and 3+ char CJK phrases). ngram(1, 15) indexes every
-- substring up to 15 chars, enabling whole-word English and multi-char CJK substring matching.
-- The `class` tokenizer separates Han<->Latin runs even without spaces. `ascii` is intentionally
-- dropped: it transliterates/strips CJK and would prevent CJK matches.
DEFINE ANALYZER OVERWRITE blog_analyzer TOKENIZERS blank, class FILTERS lowercase, ngram(1, 15);

-- ============ USERS ============
DEFINE TABLE OVERWRITE users SCHEMAFULL PERMISSIONS NONE;
DEFINE FIELD IF NOT EXISTS username ON users TYPE string;
DEFINE FIELD IF NOT EXISTS password_hash ON users TYPE string;
DEFINE FIELD IF NOT EXISTS auth_epoch ON users TYPE option<string> DEFAULT NONE;
DEFINE FIELD IF NOT EXISTS display_name ON users TYPE option<string> DEFAULT NONE;
DEFINE FIELD IF NOT EXISTS email ON users TYPE option<string> DEFAULT NONE;
DEFINE FIELD IF NOT EXISTS avatar ON users TYPE option<record<files>> DEFAULT NONE;
DEFINE FIELD IF NOT EXISTS active ON users TYPE bool DEFAULT true;
DEFINE FIELD IF NOT EXISTS last_login_at ON users TYPE option<datetime> DEFAULT NONE;
DEFINE FIELD IF NOT EXISTS totp_enabled ON users TYPE bool DEFAULT false;
DEFINE FIELD IF NOT EXISTS totp_secret ON users TYPE option<string> DEFAULT NONE;
DEFINE FIELD IF NOT EXISTS totp_backup_codes ON users TYPE option<array<string>> DEFAULT NONE;
DEFINE FIELD IF NOT EXISTS totp_enabled_at ON users TYPE option<datetime> DEFAULT NONE;
DEFINE FIELD IF NOT EXISTS totp_last_step ON users TYPE option<int> DEFAULT NONE;
DEFINE FIELD IF NOT EXISTS created_at ON users TYPE datetime DEFAULT time::now();
DEFINE FIELD IF NOT EXISTS updated_at ON users TYPE datetime DEFAULT time::now();
DEFINE INDEX IF NOT EXISTS users_username_unique ON TABLE users COLUMNS username UNIQUE;

-- ============ TRUSTED DEVICES (MFA) ============
DEFINE TABLE OVERWRITE trusted_devices SCHEMAFULL PERMISSIONS NONE;
DEFINE FIELD IF NOT EXISTS user ON trusted_devices TYPE record<users>;
DEFINE FIELD IF NOT EXISTS auth_epoch ON trusted_devices TYPE option<string> DEFAULT NONE;
DEFINE FIELD IF NOT EXISTS token_hash ON trusted_devices TYPE string;
DEFINE FIELD IF NOT EXISTS label ON trusted_devices TYPE string;
DEFINE FIELD IF NOT EXISTS user_agent ON trusted_devices TYPE option<string> DEFAULT NONE;
DEFINE FIELD IF NOT EXISTS ua_hash ON trusted_devices TYPE string;
DEFINE FIELD IF NOT EXISTS ip ON trusted_devices TYPE option<string> DEFAULT NONE;
DEFINE FIELD IF NOT EXISTS ip_prefix ON trusted_devices TYPE option<string> DEFAULT NONE;
DEFINE FIELD IF NOT EXISTS country ON trusted_devices TYPE option<string> DEFAULT NONE;
DEFINE FIELD IF NOT EXISTS created_at ON trusted_devices TYPE datetime DEFAULT time::now();
DEFINE FIELD IF NOT EXISTS last_used_at ON trusted_devices TYPE datetime DEFAULT time::now();
DEFINE FIELD IF NOT EXISTS expires_at ON trusted_devices TYPE datetime;
DEFINE INDEX IF NOT EXISTS trusted_devices_user ON TABLE trusted_devices FIELDS user;

-- ============ POST (metadata only — block content lives in `block` table) ============
DEFINE TABLE OVERWRITE post SCHEMAFULL PERMISSIONS NONE;
DEFINE FIELD IF NOT EXISTS title ON post TYPE string;
DEFINE FIELD IF NOT EXISTS slug ON post TYPE string;
DEFINE FIELD IF NOT EXISTS summary ON post TYPE option<string>;
DEFINE FIELD IF NOT EXISTS status ON post TYPE string DEFAULT 'draft' ASSERT $value IN ['draft', 'published', 'archived'];
DEFINE FIELD IF NOT EXISTS cover_image ON post TYPE option<string>;
DEFINE FIELD IF NOT EXISTS published_at ON post TYPE option<datetime>;
DEFINE FIELD IF NOT EXISTS created_at ON post TYPE datetime DEFAULT time::now();
DEFINE FIELD IF NOT EXISTS updated_at ON post TYPE datetime DEFAULT time::now();
DEFINE FIELD IF NOT EXISTS view_count ON post TYPE int DEFAULT 0;
UPDATE post SET view_count = 0 WHERE view_count IS NONE;
DEFINE FIELD IF NOT EXISTS word_count ON post TYPE option<int> DEFAULT 0;
DEFINE FIELD IF NOT EXISTS cjk_char_count ON post TYPE option<int> DEFAULT 0;
DEFINE FIELD IF NOT EXISTS has_versioning ON post TYPE bool DEFAULT false;
UPDATE post SET word_count = 0 WHERE word_count IS NONE;
UPDATE post SET cjk_char_count = 0 WHERE cjk_char_count IS NONE;
DEFINE INDEX IF NOT EXISTS post_slug_unique ON TABLE post COLUMNS slug UNIQUE;
DEFINE INDEX IF NOT EXISTS post_status ON TABLE post COLUMNS status;
DEFINE INDEX IF NOT EXISTS post_published_at ON TABLE post COLUMNS published_at;
DEFINE INDEX IF NOT EXISTS post_created_at ON TABLE post FIELDS created_at;
DEFINE INDEX IF NOT EXISTS post_updated_at ON TABLE post FIELDS updated_at;
DEFINE INDEX IF NOT EXISTS post_view_count ON TABLE post FIELDS view_count;
DEFINE INDEX IF NOT EXISTS post_word_count ON TABLE post FIELDS word_count;
DEFINE INDEX IF NOT EXISTS post_cjk_char_count ON TABLE post FIELDS cjk_char_count;
DEFINE INDEX IF NOT EXISTS post_title_fts ON TABLE post COLUMNS title FULLTEXT ANALYZER blog_analyzer BM25 HIGHLIGHTS;
DEFINE INDEX IF NOT EXISTS post_summary_fts ON TABLE post COLUMNS summary FULLTEXT ANALYZER blog_analyzer BM25 HIGHLIGHTS;

DEFINE TABLE OVERWRITE tag SCHEMAFULL PERMISSIONS NONE;
DEFINE FIELD IF NOT EXISTS name ON tag TYPE string;
DEFINE FIELD IF NOT EXISTS slug ON tag TYPE string;
DEFINE INDEX IF NOT EXISTS tag_slug_unique ON TABLE tag COLUMNS slug UNIQUE;

DEFINE TABLE OVERWRITE category SCHEMAFULL PERMISSIONS NONE;
DEFINE FIELD IF NOT EXISTS name ON category TYPE string;
DEFINE FIELD IF NOT EXISTS slug ON category TYPE string;
DEFINE FIELD IF NOT EXISTS description ON category TYPE option<string>;
DEFINE FIELD IF NOT EXISTS parent ON category TYPE option<record<category>> DEFAULT NONE;
DEFINE INDEX IF NOT EXISTS category_slug_unique ON TABLE category COLUMNS slug UNIQUE;
DEFINE INDEX IF NOT EXISTS category_parent ON TABLE category FIELDS parent;

DEFINE TABLE OVERWRITE tagged TYPE RELATION FROM post TO tag PERMISSIONS NONE;
DEFINE INDEX IF NOT EXISTS tagged_in ON TABLE tagged FIELDS in;
DEFINE INDEX IF NOT EXISTS tagged_out ON TABLE tagged FIELDS out;
DEFINE TABLE OVERWRITE categorized_as TYPE RELATION FROM post TO category PERMISSIONS NONE;
DEFINE INDEX IF NOT EXISTS categorized_as_in ON TABLE categorized_as FIELDS in;
DEFINE INDEX IF NOT EXISTS categorized_as_out ON TABLE categorized_as FIELDS out;

-- ============ BLOCK (top-level Tiptap node, one row per block) ============
DEFINE TABLE OVERWRITE block SCHEMAFULL PERMISSIONS NONE;
DEFINE FIELD IF NOT EXISTS type ON block TYPE string;
DEFINE FIELD IF NOT EXISTS node ON block TYPE object FLEXIBLE;
DEFINE FIELD IF NOT EXISTS text ON block TYPE string DEFAULT '';
DEFINE FIELD IF NOT EXISTS content_hash ON block TYPE string DEFAULT '';
DEFINE FIELD IF NOT EXISTS created_at ON block TYPE datetime DEFAULT time::now();
DEFINE FIELD IF NOT EXISTS updated_at ON block TYPE datetime DEFAULT time::now();
DEFINE INDEX IF NOT EXISTS block_type ON block FIELDS type;
DEFINE INDEX IF NOT EXISTS block_text_fts ON TABLE block COLUMNS text FULLTEXT ANALYZER blog_analyzer BM25 HIGHLIGHTS;

-- ============ SEARCH TERMS (fuzzy-search word list) ============
-- One row per (scope, word); record id is [scope, term]. `df` counts the source
-- records containing the word. Only Latin/Greek/Cyrillic words of 4-30 chars.
-- Maintained by server/utils/searchTerms.ts (diff per source + full rebuild).
DEFINE TABLE OVERWRITE search_term SCHEMAFULL PERMISSIONS NONE;
DEFINE FIELD IF NOT EXISTS scope ON search_term TYPE string;
DEFINE FIELD IF NOT EXISTS term ON search_term TYPE string;
DEFINE FIELD IF NOT EXISTS first_char ON search_term TYPE string;
DEFINE FIELD IF NOT EXISTS term_len ON search_term TYPE int;
DEFINE FIELD IF NOT EXISTS df ON search_term TYPE int DEFAULT 0;
DEFINE INDEX IF NOT EXISTS search_term_lookup ON TABLE search_term FIELDS scope, first_char, term_len;

-- Words contributed by each source record; record id is [scope, source].
DEFINE TABLE OVERWRITE search_term_source SCHEMAFULL PERMISSIONS NONE;
DEFINE FIELD IF NOT EXISTS scope ON search_term_source TYPE string;
DEFINE FIELD IF NOT EXISTS source ON search_term_source TYPE string;
DEFINE FIELD IF NOT EXISTS terms ON search_term_source TYPE array<string> DEFAULT [];
DEFINE FIELD IF NOT EXISTS updated_at ON search_term_source TYPE datetime DEFAULT time::now();
DEFINE INDEX IF NOT EXISTS search_term_source_source ON TABLE search_term_source FIELDS source;
DEFINE INDEX IF NOT EXISTS search_term_source_scope ON TABLE search_term_source FIELDS scope;

-- ============ VERSIONS (post content snapshots; block content lives in `block`) ============
DEFINE TABLE OVERWRITE versions SCHEMAFULL PERMISSIONS NONE;
DEFINE FIELD IF NOT EXISTS version ON versions TYPE string;
DEFINE FIELD IF NOT EXISTS datetime ON versions TYPE datetime DEFAULT time::now();
DEFINE FIELD OVERWRITE diff ON versions TYPE option<array<object>> DEFAULT NONE;
DEFINE FIELD OVERWRITE diff.*.status ON versions TYPE string ASSERT $value IN ['added', 'removed', 'changed', 'moved', 'unchanged'];
DEFINE FIELD OVERWRITE diff.*.blockId ON versions TYPE option<string> DEFAULT NONE;
DEFINE FIELD OVERWRITE diff.*.oldHash ON versions TYPE option<string> DEFAULT NONE;
DEFINE FIELD OVERWRITE diff.*.newHash ON versions TYPE option<string> DEFAULT NONE;
DEFINE FIELD OVERWRITE diff.*.oldIndex ON versions TYPE option<int> DEFAULT NONE;
DEFINE FIELD OVERWRITE diff.*.newIndex ON versions TYPE option<int> DEFAULT NONE;
DEFINE FIELD IF NOT EXISTS created_at ON versions TYPE datetime DEFAULT time::now();
DEFINE INDEX IF NOT EXISTS versions_version ON TABLE versions FIELDS version;
DEFINE INDEX IF NOT EXISTS versions_datetime ON TABLE versions FIELDS datetime;

DEFINE TABLE OVERWRITE has_version TYPE RELATION FROM post TO versions SCHEMAFULL PERMISSIONS NONE;
DEFINE INDEX IF NOT EXISTS has_version_in ON TABLE has_version FIELDS in;
DEFINE INDEX IF NOT EXISTS has_version_out ON TABLE has_version FIELDS out;
-- NOTE: the UNIQUE (in, out) guard `has_version_unique` is created by the
-- ensureVersionEdgeDedupMigration migration in server/plugins/db-init.ts, AFTER
-- it collapses any pre-existing duplicate edges. It cannot live here because the
-- schema runs before migrations and would fail on databases that still hold
-- duplicate has_version edges.

-- ============ HAS_BLOCKS (version -> block edge with sequence) ============
DEFINE TABLE OVERWRITE has_blocks TYPE RELATION FROM versions TO block SCHEMAFULL PERMISSIONS NONE;
DEFINE FIELD IF NOT EXISTS seq ON has_blocks TYPE int;
DEFINE INDEX IF NOT EXISTS has_blocks_in_seq ON TABLE has_blocks FIELDS in, seq;
DEFINE INDEX IF NOT EXISTS has_blocks_out ON TABLE has_blocks FIELDS out;

-- ============ LINKS (post -> post bidirectional relation) ============
DEFINE TABLE OVERWRITE links TYPE RELATION FROM post TO post SCHEMAFULL PERMISSIONS NONE;
DEFINE FIELD IF NOT EXISTS created_at ON links TYPE datetime DEFAULT time::now();
DEFINE INDEX IF NOT EXISTS links_in ON TABLE links FIELDS in;
DEFINE INDEX IF NOT EXISTS links_out ON TABLE links FIELDS out;

-- ============ POST VISIBILITY (additions to existing post table) ============
DEFINE FIELD IF NOT EXISTS visibility ON post TYPE string DEFAULT 'public' ASSERT $value IN ['public', 'private', 'password'];
DEFINE FIELD IF NOT EXISTS password_hash ON post TYPE option<string> DEFAULT NONE;
DEFINE FIELD IF NOT EXISTS password_hint ON post TYPE option<string> DEFAULT NONE;
DEFINE INDEX IF NOT EXISTS post_visibility ON TABLE post FIELDS visibility;

-- ============ APP SETTING for site-wide mode ============
-- Active key: 'site_visibility' with value 'public' | 'private'. Default: 'public'.

-- ============ APP SETTINGS (key-value store) ============
DEFINE TABLE OVERWRITE app_settings SCHEMALESS PERMISSIONS NONE;
DEFINE INDEX IF NOT EXISTS app_settings_key ON app_settings FIELDS key UNIQUE;

-- ============ HASH-BASED FILE LIBRARY ============
DEFINE TABLE OVERWRITE folder SCHEMAFULL PERMISSIONS NONE;
DEFINE FIELD IF NOT EXISTS name ON folder TYPE string;
DEFINE FIELD IF NOT EXISTS slug ON folder TYPE string;
DEFINE FIELD IF NOT EXISTS parent ON folder TYPE option<record<folder>> DEFAULT NONE;
DEFINE FIELD IF NOT EXISTS created_at ON folder TYPE datetime DEFAULT time::now();
DEFINE FIELD IF NOT EXISTS updated_at ON folder TYPE datetime DEFAULT time::now();
DEFINE INDEX IF NOT EXISTS folder_slug_unique ON TABLE folder FIELDS slug UNIQUE;
DEFINE INDEX IF NOT EXISTS folder_parent ON TABLE folder FIELDS parent;

DEFINE TABLE OVERWRITE files SCHEMAFULL PERMISSIONS NONE;
DEFINE FIELD IF NOT EXISTS hash ON files TYPE string;
DEFINE FIELD IF NOT EXISTS original_name ON files TYPE string;
DEFINE FIELD IF NOT EXISTS stored_name ON files TYPE string;
DEFINE FIELD IF NOT EXISTS mime_type ON files TYPE string;
DEFINE FIELD IF NOT EXISTS size ON files TYPE int;
DEFINE FIELD IF NOT EXISTS extension ON files TYPE string;
DEFINE FIELD IF NOT EXISTS uploaded_at ON files TYPE datetime DEFAULT time::now();
DEFINE FIELD IF NOT EXISTS updated_at ON files TYPE datetime DEFAULT time::now();
DEFINE FIELD IF NOT EXISTS comment ON files TYPE option<string> DEFAULT NONE;
DEFINE FIELD IF NOT EXISTS is_image ON files TYPE bool DEFAULT false;
DEFINE FIELD IF NOT EXISTS image_meta ON files TYPE option<object> FLEXIBLE DEFAULT NONE;
DEFINE FIELD IF NOT EXISTS folders ON files TYPE array<record<folder>> DEFAULT [];
DEFINE FIELD IF NOT EXISTS tags ON files TYPE array<string> DEFAULT [];
DEFINE FIELD IF NOT EXISTS storage_state ON files TYPE option<string> ASSERT $value = NONE OR $value IN ['publishing', 'ready', 'deleting'];
DEFINE FIELD IF NOT EXISTS storage_claim ON files TYPE option<string>;
-- Legacy/version/avatar reference completeness is not inferred from zero counts.
DEFINE FIELD IF NOT EXISTS reference_safe ON files TYPE bool DEFAULT false;
DEFINE FIELD IF NOT EXISTS reference_count ON files TYPE int DEFAULT 0;
DEFINE FIELD IF NOT EXISTS referenced_by ON files TYPE array<record> DEFAULT [];
DEFINE FIELD IF NOT EXISTS visibility ON files TYPE string DEFAULT 'public' ASSERT $value IN ['public', 'private'];
DEFINE FIELD IF NOT EXISTS original_path ON files TYPE string;
DEFINE FIELD IF NOT EXISTS variants ON files TYPE option<object> FLEXIBLE DEFAULT NONE;
DEFINE FIELD IF NOT EXISTS perceptual_hash ON files TYPE option<string> DEFAULT NONE;
DEFINE FIELD OVERWRITE storage_path ON files TYPE option<string> DEFAULT NONE;
DEFINE FIELD OVERWRITE thumbnail_path ON files TYPE option<string> DEFAULT NONE;
DEFINE INDEX IF NOT EXISTS files_hash_unique ON TABLE files FIELDS hash UNIQUE;
DEFINE INDEX IF NOT EXISTS files_original_name_fts ON TABLE files COLUMNS original_name FULLTEXT ANALYZER blog_analyzer BM25 HIGHLIGHTS;
DEFINE INDEX IF NOT EXISTS files_comment_fts ON TABLE files COLUMNS comment FULLTEXT ANALYZER blog_analyzer BM25 HIGHLIGHTS;
DEFINE INDEX IF NOT EXISTS files_uploaded_at ON TABLE files FIELDS uploaded_at;
DEFINE INDEX IF NOT EXISTS files_mime_type ON TABLE files FIELDS mime_type;
DEFINE INDEX IF NOT EXISTS files_is_image ON TABLE files FIELDS is_image;
DEFINE INDEX IF NOT EXISTS files_reference_count ON TABLE files FIELDS reference_count;
DEFINE INDEX IF NOT EXISTS files_visibility ON TABLE files FIELDS visibility;

-- ============ MEDIA TAGS ============
-- File tags are stored independently in files.tags and are not shared with post tags.

-- ============ SMART FOLDERS ============
DEFINE TABLE OVERWRITE media_smart_folder SCHEMAFULL PERMISSIONS NONE;
DEFINE FIELD IF NOT EXISTS name ON media_smart_folder TYPE string;
DEFINE FIELD IF NOT EXISTS filters ON media_smart_folder TYPE object FLEXIBLE;
DEFINE FIELD IF NOT EXISTS created_at ON media_smart_folder TYPE datetime DEFAULT time::now();
DEFINE FIELD IF NOT EXISTS updated_at ON media_smart_folder TYPE datetime DEFAULT time::now();

-- #module analytics start
-- ============ ANALYTICS ============
DEFINE TABLE OVERWRITE analytics_session SCHEMAFULL PERMISSIONS NONE;
DEFINE FIELD IF NOT EXISTS visitor_hash ON analytics_session TYPE string;
DEFINE FIELD IF NOT EXISTS country ON analytics_session TYPE option<string> DEFAULT NONE;
DEFINE FIELD IF NOT EXISTS region ON analytics_session TYPE option<string> DEFAULT NONE;
DEFINE FIELD IF NOT EXISTS city ON analytics_session TYPE option<string> DEFAULT NONE;
DEFINE FIELD IF NOT EXISTS pageview_count ON analytics_session TYPE int DEFAULT 0;
DEFINE FIELD IF NOT EXISTS started_at ON analytics_session TYPE datetime DEFAULT time::now();
DEFINE FIELD IF NOT EXISTS last_seen_at ON analytics_session TYPE datetime DEFAULT time::now();
DEFINE INDEX IF NOT EXISTS analytics_session_visitor_hash ON analytics_session FIELDS visitor_hash;
DEFINE INDEX IF NOT EXISTS analytics_session_started_at ON analytics_session FIELDS started_at;
DEFINE INDEX IF NOT EXISTS analytics_session_last_seen_at ON analytics_session FIELDS last_seen_at;
DEFINE INDEX IF NOT EXISTS analytics_session_visitor_seen ON analytics_session FIELDS visitor_hash, last_seen_at;

-- Conflict point for simultaneous first hits. Old sessions remain usable;
-- heads are created lazily in the event transaction and expire when idle.
DEFINE TABLE IF NOT EXISTS analytics_visitor SCHEMAFULL PERMISSIONS NONE;
DEFINE FIELD IF NOT EXISTS last_seen_at ON analytics_visitor TYPE datetime;
DEFINE INDEX IF NOT EXISTS analytics_visitor_seen ON analytics_visitor FIELDS last_seen_at;
DEFINE TABLE IF NOT EXISTS analytics_checkpoint SCHEMAFULL PERMISSIONS NONE;
DEFINE FIELD IF NOT EXISTS next_day ON analytics_checkpoint TYPE datetime;
DEFINE TABLE IF NOT EXISTS analytics_publication SCHEMAFULL PERMISSIONS NONE;
DEFINE FIELD IF NOT EXISTS epoch ON analytics_publication TYPE string;

DEFINE TABLE OVERWRITE pageview SCHEMAFULL PERMISSIONS NONE;
DEFINE FIELD IF NOT EXISTS path ON pageview TYPE string;
DEFINE FIELD IF NOT EXISTS referrer ON pageview TYPE option<string> DEFAULT NONE;
DEFINE FIELD IF NOT EXISTS visitor_hash ON pageview TYPE string;
DEFINE FIELD IF NOT EXISTS session ON pageview TYPE option<record<analytics_session>> DEFAULT NONE;
DEFINE FIELD IF NOT EXISTS country ON pageview TYPE option<string> DEFAULT NONE;
DEFINE FIELD IF NOT EXISTS region ON pageview TYPE option<string> DEFAULT NONE;
DEFINE FIELD IF NOT EXISTS city ON pageview TYPE option<string> DEFAULT NONE;
DEFINE FIELD IF NOT EXISTS created_at ON pageview TYPE datetime DEFAULT time::now();
DEFINE INDEX IF NOT EXISTS pageview_created_at ON pageview FIELDS created_at;
DEFINE INDEX IF NOT EXISTS pageview_path ON pageview FIELDS path;
DEFINE INDEX IF NOT EXISTS pageview_country ON pageview FIELDS country;
DEFINE INDEX IF NOT EXISTS pageview_visitor_hash ON pageview FIELDS visitor_hash;
DEFINE INDEX IF NOT EXISTS pageview_session ON pageview FIELDS session;

DEFINE TABLE OVERWRITE analytics_daily SCHEMAFULL PERMISSIONS NONE;
DEFINE FIELD IF NOT EXISTS date ON analytics_daily TYPE string;
DEFINE FIELD IF NOT EXISTS page_views ON analytics_daily TYPE int DEFAULT 0;
DEFINE FIELD IF NOT EXISTS unique_visitors ON analytics_daily TYPE int DEFAULT 0;
DEFINE FIELD IF NOT EXISTS sessions ON analytics_daily TYPE int DEFAULT 0;
DEFINE FIELD IF NOT EXISTS bounce_sessions ON analytics_daily TYPE int DEFAULT 0;
DEFINE FIELD IF NOT EXISTS total_visit_seconds ON analytics_daily TYPE int DEFAULT 0;
DEFINE FIELD IF NOT EXISTS rolled_up_at ON analytics_daily TYPE datetime DEFAULT time::now();
-- Legacy summaries stay readable but never authorize raw retention until the
-- atomic v2 publisher verifies/replaces them. No destructive startup reset.
DEFINE FIELD IF NOT EXISTS published ON analytics_daily TYPE bool DEFAULT false;
DEFINE FIELD IF NOT EXISTS finalized ON analytics_daily TYPE bool DEFAULT false;
DEFINE FIELD IF NOT EXISTS publication_epoch ON analytics_daily TYPE option<string> DEFAULT NONE;
DEFINE FIELD IF NOT EXISTS pages_truncated ON analytics_daily TYPE bool DEFAULT false;
DEFINE FIELD IF NOT EXISTS geo_truncated ON analytics_daily TYPE bool DEFAULT false;
DEFINE INDEX IF NOT EXISTS analytics_daily_date_unique ON TABLE analytics_daily COLUMNS date UNIQUE;

DEFINE TABLE OVERWRITE analytics_daily_page SCHEMAFULL PERMISSIONS NONE;
DEFINE FIELD IF NOT EXISTS date ON analytics_daily_page TYPE string;
DEFINE FIELD IF NOT EXISTS path ON analytics_daily_page TYPE string;
DEFINE FIELD IF NOT EXISTS views ON analytics_daily_page TYPE int DEFAULT 0;
DEFINE FIELD IF NOT EXISTS rolled_up_at ON analytics_daily_page TYPE datetime DEFAULT time::now();
DEFINE INDEX IF NOT EXISTS analytics_daily_page_date ON analytics_daily_page FIELDS date;
DEFINE INDEX IF NOT EXISTS analytics_daily_page_path ON analytics_daily_page FIELDS path;
DEFINE INDEX IF NOT EXISTS analytics_daily_page_unique ON TABLE analytics_daily_page COLUMNS date, path UNIQUE;

DEFINE TABLE OVERWRITE analytics_daily_geo SCHEMAFULL PERMISSIONS NONE;
DEFINE FIELD IF NOT EXISTS date ON analytics_daily_geo TYPE string;
DEFINE FIELD IF NOT EXISTS country ON analytics_daily_geo TYPE option<string> DEFAULT NONE;
DEFINE FIELD IF NOT EXISTS region ON analytics_daily_geo TYPE option<string> DEFAULT NONE;
DEFINE FIELD IF NOT EXISTS city ON analytics_daily_geo TYPE option<string> DEFAULT NONE;
DEFINE FIELD IF NOT EXISTS views ON analytics_daily_geo TYPE int DEFAULT 0;
DEFINE FIELD IF NOT EXISTS rolled_up_at ON analytics_daily_geo TYPE datetime DEFAULT time::now();
DEFINE INDEX IF NOT EXISTS analytics_daily_geo_date ON analytics_daily_geo FIELDS date;
DEFINE INDEX IF NOT EXISTS analytics_daily_geo_country ON analytics_daily_geo FIELDS country;
-- #module analytics end

-- #module logs start
-- ============ ACTIVITY LOGS ============
DEFINE TABLE OVERWRITE activity_logs SCHEMAFULL PERMISSIONS NONE;
DEFINE FIELD IF NOT EXISTS timestamp ON activity_logs TYPE datetime DEFAULT time::now();
DEFINE FIELD IF NOT EXISTS action ON activity_logs TYPE string;
DEFINE FIELD IF NOT EXISTS resource_type ON activity_logs TYPE string;
DEFINE FIELD IF NOT EXISTS resource_id ON activity_logs TYPE option<string>;
DEFINE FIELD OVERWRITE metadata ON activity_logs TYPE option<object> FLEXIBLE;
DEFINE FIELD IF NOT EXISTS ip ON activity_logs TYPE option<string>;
DEFINE FIELD IF NOT EXISTS request_id ON activity_logs TYPE option<string>;
DEFINE FIELD IF NOT EXISTS description ON activity_logs TYPE option<string>;
DEFINE INDEX IF NOT EXISTS activity_logs_timestamp_desc ON activity_logs FIELDS timestamp;
DEFINE INDEX IF NOT EXISTS activity_logs_action ON activity_logs FIELDS action;
-- #module logs end

-- #module logs start
-- ============ ERROR LOGS ============
DEFINE TABLE OVERWRITE error_logs SCHEMAFULL PERMISSIONS NONE;
DEFINE FIELD IF NOT EXISTS timestamp ON error_logs TYPE datetime DEFAULT time::now();
DEFINE FIELD IF NOT EXISTS level ON error_logs TYPE string ASSERT $value IN ['debug', 'info', 'warn', 'error'];
DEFINE FIELD IF NOT EXISTS message ON error_logs TYPE string;
DEFINE FIELD IF NOT EXISTS stack ON error_logs TYPE option<string>;
DEFINE FIELD IF NOT EXISTS status_code ON error_logs TYPE option<int>;
DEFINE FIELD OVERWRITE context ON error_logs TYPE option<object> FLEXIBLE;
DEFINE FIELD IF NOT EXISTS request_id ON error_logs TYPE option<string>;
DEFINE FIELD IF NOT EXISTS path ON error_logs TYPE option<string>;
DEFINE FIELD IF NOT EXISTS method ON error_logs TYPE option<string>;
DEFINE FIELD IF NOT EXISTS read_at ON error_logs TYPE option<datetime>;
DEFINE INDEX IF NOT EXISTS error_logs_timestamp_desc ON error_logs FIELDS timestamp;
DEFINE INDEX IF NOT EXISTS error_logs_level ON error_logs FIELDS level;
DEFINE FIELD IF NOT EXISTS fingerprint ON error_logs TYPE option<string>;
DEFINE FIELD IF NOT EXISTS name ON error_logs TYPE option<string>;
DEFINE INDEX IF NOT EXISTS error_logs_fingerprint ON error_logs FIELDS fingerprint;

DEFINE TABLE OVERWRITE error_groups SCHEMAFULL PERMISSIONS NONE;
DEFINE FIELD IF NOT EXISTS fingerprint ON error_groups TYPE string;
DEFINE FIELD IF NOT EXISTS fingerprint_version ON error_groups TYPE int DEFAULT 1;
DEFINE FIELD IF NOT EXISTS name ON error_groups TYPE option<string>;
DEFINE FIELD IF NOT EXISTS message ON error_groups TYPE string;
DEFINE FIELD IF NOT EXISTS route ON error_groups TYPE option<string>;
DEFINE FIELD IF NOT EXISTS status_code ON error_groups TYPE option<int>;
DEFINE FIELD IF NOT EXISTS level ON error_groups TYPE string;
DEFINE FIELD IF NOT EXISTS count ON error_groups TYPE int DEFAULT 0;
DEFINE FIELD IF NOT EXISTS first_seen ON error_groups TYPE datetime;
DEFINE FIELD IF NOT EXISTS last_seen ON error_groups TYPE datetime;
DEFINE FIELD IF NOT EXISTS last_stack ON error_groups TYPE option<string>;
DEFINE FIELD IF NOT EXISTS read_at ON error_groups TYPE option<datetime>;
DEFINE FIELD IF NOT EXISTS resolved_at ON error_groups TYPE option<datetime>;
DEFINE FIELD IF NOT EXISTS regressed ON error_groups TYPE bool DEFAULT false;
DEFINE INDEX IF NOT EXISTS error_groups_last_seen ON error_groups FIELDS last_seen;
DEFINE INDEX IF NOT EXISTS error_groups_read ON error_groups FIELDS read_at;
-- #module logs end

-- #module backups start
-- ============ BACKUP SNAPSHOTS ============
DEFINE TABLE OVERWRITE backups SCHEMALESS PERMISSIONS NONE;
DEFINE INDEX IF NOT EXISTS backups_created_at ON backups FIELDS created_at;
DEFINE INDEX IF NOT EXISTS backups_parent ON backups FIELDS parent;
-- #module backups end
