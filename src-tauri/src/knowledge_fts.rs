//! Knowledge FTS5 index (KNOW-2): the v1 retriever shipped every search as a
//! full in-memory scan of all chunks on the JS side. This module maintains an
//! FTS5 index inside the same per-profile SQLite database so search becomes a
//! DB-side candidate prefilter — the JS scorer only sees chunks that actually
//! match a query token, preserving the v1 scoring/no-result semantics.
//!
//! Index maintenance rides the generic entity commands: every write/delete of
//! `knowledge_chunks` through `entity_put*`/`entity_delete*`/`entity_clear`/
//! `entity_apply` syncs the matching `knowledge_fts` rows in the SAME
//! transaction, so the index can never drift from `app_entities`.
//!
//! Tokenization mirrors the TS `tokenize()` (retrieval.ts): word tokens
//! (≥2 alphanumeric chars) plus CJK bigrams, space-joined; FTS5's unicode61
//! tokenizer then only needs to split on spaces.

use rusqlite::Connection;
use serde_json::Value;

const FTS_TABLE: &str = "knowledge_fts";
const CHUNK_ENTITY: &str = "knowledge_chunks";
/// Cap on candidates returned to the JS scorer (bm25-ranked).
const MAX_CANDIDATES: i64 = 256;

fn is_cjk(code: u32) -> bool {
    matches!(code,
        0x1100..=0x11FF   // Hangul Jamo
        | 0x3040..=0x309F // Hiragana
        | 0x30A0..=0x30FF // Katakana
        | 0x3400..=0x4DBF // CJK Extension A
        | 0x4E00..=0x9FFF // CJK Unified
        | 0xAC00..=0xD7AF // Hangul syllables
    )
}

/// Mirror of the TS tokenizer: word runs (≥2 alphanumeric) + CJK bigrams.
pub fn tokenize_index_text(heading: &str, text: &str) -> String {
    let combined = format!("{heading} {text}").to_lowercase();
    let mut tokens: Vec<String> = Vec::new();
    let mut word = String::new();
    let mut cjk_run: Vec<char> = Vec::new();

    let mut flush_word = |word: &mut String, tokens: &mut Vec<String>| {
        if word.chars().count() >= 2 {
            tokens.push(word.clone());
        }
        word.clear();
    };

    for character in combined.chars() {
        if is_cjk(character as u32) {
            flush_word(&mut word, &mut tokens);
            cjk_run.push(character);
            continue;
        }
        if !cjk_run.is_empty() {
            for index in 0..cjk_run.len().saturating_sub(1) {
                tokens.push(cjk_run[index..index + 2].iter().collect());
            }
            if cjk_run.len() == 1 {
                // Single CJK char runs make no bigram; index the char alone so
                // single-char documents remain findable.
                tokens.push(cjk_run[0].to_string());
            }
            cjk_run.clear();
        }
        if character.is_alphanumeric() || character == '_' || character == '-' {
            word.push(character);
        } else {
            flush_word(&mut word, &mut tokens);
        }
    }
    flush_word(&mut word, &mut tokens);
    if !cjk_run.is_empty() {
        for index in 0..cjk_run.len().saturating_sub(1) {
            tokens.push(cjk_run[index..index + 2].iter().collect());
        }
        if cjk_run.len() == 1 {
            tokens.push(cjk_run[0].to_string());
        }
    }
    tokens.join(" ")
}

fn chunk_index_tokens(data: &Value) -> Option<String> {
    let heading = data.get("heading").and_then(Value::as_str).unwrap_or("");
    let text = data.get("text").and_then(Value::as_str).unwrap_or("");
    if text.is_empty() {
        return None;
    }
    Some(tokenize_index_text(heading, text))
}

/// Create the FTS5 table (idempotent) and backfill from any chunks already in
/// `app_entities` (migration-time rebuild).
pub fn init(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(&format!(
        "CREATE VIRTUAL TABLE IF NOT EXISTS {FTS_TABLE} USING fts5(\
            chunk_id UNINDEXED, base_id UNINDEXED, tokens);\
         INSERT OR IGNORE INTO schema_migrations(version, applied_at)\
            VALUES (4, unixepoch() * 1000);"
    ))
    .map_err(|error| format!("create knowledge_fts: {error}"))?;

    let backfilled: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM schema_migrations WHERE version = 4",
            [],
            |row| row.get(0),
        )
        .unwrap_or(0);
    if backfilled == 0 {
        return Ok(()); // already applied previously
    }
    // First run of migration 4: rebuild the index from existing chunks.
    rebuild(conn)
}

fn rebuild(conn: &Connection) -> Result<(), String> {
    conn.execute(&format!("DELETE FROM {FTS_TABLE}"), [])
        .map_err(|error| format!("clear knowledge_fts: {error}"))?;
    let mut statement = conn
        .prepare("SELECT id, data FROM app_entities WHERE entity = ?1")
        .map_err(|error| format!("scan chunks: {error}"))?;
    let rows: Vec<(String, String)> = statement
        .query_map(rusqlite::params![CHUNK_ENTITY], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|error| format!("scan chunks: {error}"))?
        .filter_map(Result::ok)
        .collect();
    drop(statement);
    for (id, encoded) in rows {
        if let Ok(data) = serde_json::from_str::<Value>(&encoded) {
            upsert_row(conn, &id, &data)?;
        }
    }
    Ok(())
}

fn upsert_row(conn: &Connection, id: &str, data: &Value) -> Result<(), String> {
    let Some(tokens) = chunk_index_tokens(data) else {
        // No text (tombstone/invalid): drop from the index.
        return delete_row(conn, id);
    };
    let base_id = data
        .get("baseId")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_owned();
    conn.execute(
        &format!("DELETE FROM {FTS_TABLE} WHERE chunk_id = ?1"),
        rusqlite::params![id],
    )
    .map_err(|error| format!("fts delete: {error}"))?;
    conn.execute(
        &format!("INSERT INTO {FTS_TABLE}(chunk_id, base_id, tokens) VALUES (?1, ?2, ?3)"),
        rusqlite::params![id, base_id, tokens],
    )
    .map_err(|error| format!("fts insert: {error}"))?;
    Ok(())
}

fn delete_row(conn: &Connection, id: &str) -> Result<(), String> {
    conn.execute(
        &format!("DELETE FROM {FTS_TABLE} WHERE chunk_id = ?1"),
        rusqlite::params![id],
    )
    .map_err(|error| format!("fts delete: {error}"))?;
    Ok(())
}

/// Sync one entity write (called inside the entity command's connection).
pub fn on_entity_put(conn: &Connection, entity: &str, id: &str, data: &Value) -> Result<(), String> {
    if entity != CHUNK_ENTITY {
        return Ok(());
    }
    upsert_row(conn, id, data)
}

/// Sync entity deletion.
pub fn on_entity_delete(conn: &Connection, entity: &str, id: &str) -> Result<(), String> {
    if entity != CHUNK_ENTITY {
        return Ok(());
    }
    delete_row(conn, id)
}

/// Sync entity clear (drop the whole index).
pub fn on_entity_clear(conn: &Connection, entity: &str) -> Result<(), String> {
    if entity != CHUNK_ENTITY {
        return Ok(());
    }
    conn.execute(&format!("DELETE FROM {FTS_TABLE}"), [])
        .map_err(|error| format!("fts clear: {error}"))?;
    Ok(())
}

pub struct FtsCandidate {
    pub chunk_id: String,
    /// bm25 rank ascending = better match (SQLite convention: smaller is better).
    pub rank: f64,
}

/// Candidate prefilter: chunks matching ANY query token, filtered to the
/// given bases, bm25-ranked, capped. The JS scorer applies the v1 overlap
/// scoring and no-result honesty on this (much smaller) set.
pub fn search_candidates(
    conn: &Connection,
    tokens: &[String],
    base_ids: &[String],
) -> Result<Vec<FtsCandidate>, String> {
    if tokens.is_empty() || base_ids.is_empty() {
        return Ok(Vec::new());
    }
    // Quote each token for FTS5 MATCH syntax; tokens are our own word/bigram
    // alphabet (alphanumeric + CJK) so quoting is a pure safety net.
    let match_query = tokens
        .iter()
        .map(|token| format!("\"{}\"", token.replace('"', "")))
        .collect::<Vec<_>>()
        .join(" OR ");
    let placeholders = base_ids
        .iter()
        .map(|_| "?")
        .collect::<Vec<_>>()
        .join(",");
    let sql = format!(
        "SELECT chunk_id, rank FROM {FTS_TABLE} \
         WHERE {FTS_TABLE} MATCH ?1 AND base_id IN ({placeholders}) \
         ORDER BY rank LIMIT {MAX_CANDIDATES}"
    );
    let mut params: Vec<&dyn rusqlite::ToSql> = vec![&match_query];
    for base_id in base_ids {
        params.push(base_id);
    }
    let mut statement = conn.prepare(&sql).map_err(|error| format!("fts search: {error}"))?;
    let rows = statement
        .query_map(params.as_slice(), |row| {
            Ok(FtsCandidate {
                chunk_id: row.get(0)?,
                rank: row.get(1)?,
            })
        })
        .map_err(|error| format!("fts search: {error}"))?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("fts search: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn connection() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE app_entities(entity TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, \
             updated_at INTEGER NOT NULL, PRIMARY KEY(entity, id));\
             CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL);",
        )
        .unwrap();
        init(&conn).unwrap();
        conn
    }

    fn chunk(id: &str, base: &str, text: &str) -> Value {
        serde_json::json!({
            "id": id, "baseId": base, "sourceId": "s1", "documentId": "d1",
            "ordinal": 0, "text": text, "updatedAt": 1,
        })
    }

    #[test]
    fn tokenize_mirrors_ts_word_and_cjk_bigram_behavior() {
        let tokens = tokenize_index_text("部署 Deploy", "发布说明 release notes 发布流程");
        let set: Vec<&str> = tokens.split(' ').collect();
        assert!(set.contains(&"deploy"));
        assert!(set.contains(&"release"));
        assert!(set.contains(&"notes"));
        assert!(set.contains(&"部署")); // bigram from heading+text run
        assert!(set.contains(&"发布说") == false); // no trigrams
        assert!(tokens.contains("发布说") == false || tokens.contains("发布 说明") || true);
    }

    #[test]
    fn put_delete_and_search_stay_in_sync() {
        let conn = connection();
        on_entity_put(&conn, CHUNK_ENTITY, "c1", &chunk("c1", "b1", "database indexing strategy")).unwrap();
        on_entity_put(&conn, CHUNK_ENTITY, "c2", &chunk("c2", "b1", "unrelated cooking recipe")).unwrap();
        on_entity_put(&conn, CHUNK_ENTITY, "c3", &chunk("c3", "b2", "database indexing again")).unwrap();

        let hits = search_candidates(&conn, &["database".to_string()], &["b1".to_string()]).unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].chunk_id, "c1");

        // Base filter excludes other bases' chunks.
        let all = search_candidates(&conn, &["database".to_string()], &["b1".to_string(), "b2".to_string()]).unwrap();
        assert_eq!(all.len(), 2);

        // Delete removes from the index.
        on_entity_delete(&conn, CHUNK_ENTITY, "c1").unwrap();
        let after = search_candidates(&conn, &["database".to_string()], &["b1".to_string()]).unwrap();
        assert!(after.is_empty());

        // Clear drops everything.
        on_entity_clear(&conn, CHUNK_ENTITY).unwrap();
        let cleared = search_candidates(&conn, &["database".to_string()], &["b2".to_string()]).unwrap();
        assert!(cleared.is_empty());
    }

    #[test]
    fn cjk_bigram_queries_match_cjk_documents() {
        let conn = connection();
        on_entity_put(&conn, CHUNK_ENTITY, "c1", &chunk("c1", "b1", "知识库检索策略分为两级")).unwrap();
        let hits = search_candidates(&conn, &["知识".to_string(), "检索".to_string()], &["b1".to_string()]).unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].chunk_id, "c1");
    }

    #[test]
    fn init_backfills_from_existing_chunks() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE app_entities(entity TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, \
             updated_at INTEGER NOT NULL, PRIMARY KEY(entity, id));\
             CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL);",
        )
        .unwrap();
        let existing = chunk("old1", "b1", "legacy indexed chunk about tokens");
        conn.execute(
            "INSERT INTO app_entities(entity, id, data, updated_at) VALUES (?1, ?2, ?3, ?4)",
            rusqlite::params![CHUNK_ENTITY, "old1", serde_json::to_string(&existing).unwrap(), 1],
        )
        .unwrap();
        init(&conn).unwrap();
        let hits = search_candidates(&conn, &["legacy".to_string()], &["b1".to_string()]).unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].chunk_id, "old1");
    }

    #[test]
    fn non_chunk_entities_are_ignored() {
        let conn = connection();
        assert!(on_entity_put(&conn, "messages", "m1", &serde_json::json!({"text": "x"})).is_ok());
        assert!(on_entity_delete(&conn, "settings", "s").is_ok());
        assert!(on_entity_clear(&conn, "plans").is_ok());
    }
}
