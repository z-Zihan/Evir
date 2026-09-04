//! SQLite-backed structured entity storage: the `db_*` and `entity_*`
//! commands over the `app_entities` table, plus the SQL allowlist validators
//! (`has_statement_tail`, `validate_query_sql`, `validate_update_sql`) that
//! keep queries read-only and single-statement and updates single-DML.

use serde::Deserialize;
use serde_json::Value;
use tauri::{AppHandle, Manager};

use crate::storage::{self, DatabaseState};

use super::infra::{app_data_dir, system_time_now_ms, validate_entity, with_connection};

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub(crate) enum EntityMutation {
    Write {
        entity: String,
        id: String,
        data: Value,
    },
    Delete {
        entity: String,
        id: String,
    },
    Clear {
        entity: String,
    },
}

#[tauri::command(async)]
pub(crate) fn db_init(app: AppHandle) -> Result<String, String> {
    let data_dir = app_data_dir(&app)?;
    let registry =
        crate::profiles::ensure_registry(&data_dir).map_err(|error| error.to_string())?;
    let active = crate::profiles::active_profile(&registry).map_err(|error| error.to_string())?;
    let db_path = crate::profiles::profile_db_path(&data_dir, &active.id);
    let new_conn = storage::init_db_at(&db_path).map_err(|error| error.to_string())?;
    let state = app.state::<DatabaseState>();
    let mut conn = state
        .conn
        .lock()
        .map_err(|_| "database lock is poisoned".to_owned())?;
    *conn = new_conn;
    Ok(db_path.to_string_lossy().into_owned())
}

#[tauri::command(async)]
pub(crate) fn db_query(
    app: AppHandle,
    sql: String,
    params: Vec<Value>,
) -> Result<Vec<Value>, String> {
    validate_query_sql(&sql)?;
    with_connection(&app, |conn| storage::execute_query(conn, &sql, &params))
}

#[tauri::command(async)]
pub(crate) fn db_update(app: AppHandle, sql: String, params: Vec<Value>) -> Result<usize, String> {
    validate_update_sql(&sql)?;
    with_connection(&app, |conn| storage::execute_update(conn, &sql, &params))
}

#[tauri::command(async)]
pub(crate) fn entity_get(
    app: AppHandle,
    entity: String,
    id: String,
) -> Result<Option<Value>, String> {
    validate_entity(&entity)?;
    with_connection(&app, |conn| {
        let mut statement =
            conn.prepare("SELECT data FROM app_entities WHERE entity = ?1 AND id = ?2")?;
        let mut rows = statement.query(rusqlite::params![entity, id])?;
        let Some(row) = rows.next()? else {
            return Ok(None);
        };
        let data: String = row.get(0)?;
        serde_json::from_str(&data).map(Some).map_err(|error| {
            rusqlite::Error::FromSqlConversionFailure(
                0,
                rusqlite::types::Type::Text,
                Box::new(error),
            )
        })
    })
}

#[tauri::command(async)]
pub(crate) fn entity_list(app: AppHandle, entity: String) -> Result<Vec<Value>, String> {
    validate_entity(&entity)?;
    with_connection(&app, |conn| {
        let mut statement = conn.prepare(
            "SELECT data FROM app_entities WHERE entity = ?1 ORDER BY updated_at DESC, id ASC",
        )?;
        let rows = statement.query_map(rusqlite::params![entity], |row| {
            let data: String = row.get(0)?;
            serde_json::from_str(&data).map_err(|error| {
                rusqlite::Error::FromSqlConversionFailure(
                    0,
                    rusqlite::types::Type::Text,
                    Box::new(error),
                )
            })
        })?;
        rows.collect()
    })
}

#[tauri::command(async)]
pub(crate) fn entity_put(
    app: AppHandle,
    entity: String,
    id: String,
    data: Value,
) -> Result<(), String> {
    validate_entity(&entity)?;
    let encoded = serde_json::to_string(&data).map_err(|error| error.to_string())?;
    with_connection(&app, |conn| {
        conn.execute(
            "INSERT INTO app_entities(entity, id, data, updated_at) VALUES (?1, ?2, ?3, ?4) \
             ON CONFLICT(entity, id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at",
            rusqlite::params![entity, id, encoded, system_time_now_ms()],
        )?;
        Ok(())
    })
}

#[tauri::command(async)]
pub(crate) fn entity_put_many(
    app: AppHandle,
    entity: String,
    records: Vec<Value>,
) -> Result<(), String> {
    validate_entity(&entity)?;
    with_connection(&app, |conn| {
        let transaction = conn.unchecked_transaction()?;
        for record in records {
            let id = record
                .get(if entity == "settings" { "name" } else { "id" })
                .and_then(Value::as_str)
                .ok_or_else(|| rusqlite::Error::InvalidParameterName("record id".to_owned()))?;
            let encoded = serde_json::to_string(&record)
                .map_err(|error| rusqlite::Error::ToSqlConversionFailure(Box::new(error)))?;
            transaction.execute(
                "INSERT INTO app_entities(entity, id, data, updated_at) VALUES (?1, ?2, ?3, ?4) \
                 ON CONFLICT(entity, id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at",
                rusqlite::params![entity, id, encoded, system_time_now_ms()],
            )?;
        }
        transaction.commit()
    })
}

#[tauri::command(async)]
pub(crate) fn entity_delete(app: AppHandle, entity: String, id: String) -> Result<(), String> {
    validate_entity(&entity)?;
    with_connection(&app, |conn| {
        conn.execute(
            "DELETE FROM app_entities WHERE entity = ?1 AND id = ?2",
            rusqlite::params![entity, id],
        )?;
        Ok(())
    })
}

#[tauri::command(async)]
pub(crate) fn entity_delete_many(
    app: AppHandle,
    entity: String,
    ids: Vec<String>,
) -> Result<(), String> {
    validate_entity(&entity)?;
    with_connection(&app, |conn| {
        let transaction = conn.unchecked_transaction()?;
        for id in ids {
            transaction.execute(
                "DELETE FROM app_entities WHERE entity = ?1 AND id = ?2",
                rusqlite::params![entity, id],
            )?;
        }
        transaction.commit()
    })
}

#[tauri::command(async)]
pub(crate) fn entity_clear(app: AppHandle, entity: String) -> Result<(), String> {
    validate_entity(&entity)?;
    with_connection(&app, |conn| {
        conn.execute(
            "DELETE FROM app_entities WHERE entity = ?1",
            rusqlite::params![entity],
        )?;
        Ok(())
    })
}

#[tauri::command(async)]
pub(crate) fn entity_apply(app: AppHandle, mutations: Vec<EntityMutation>) -> Result<(), String> {
    for mutation in &mutations {
        let entity = match mutation {
            EntityMutation::Write { entity, .. }
            | EntityMutation::Delete { entity, .. }
            | EntityMutation::Clear { entity } => entity,
        };
        validate_entity(entity)?;
    }
    with_connection(&app, |conn| {
        let transaction = conn.unchecked_transaction()?;
        for mutation in mutations {
            match mutation {
                EntityMutation::Write { entity, id, data } => {
                    let encoded = serde_json::to_string(&data).map_err(|error| {
                        rusqlite::Error::ToSqlConversionFailure(Box::new(error))
                    })?;
                    transaction.execute(
                        "INSERT INTO app_entities(entity, id, data, updated_at) VALUES (?1, ?2, ?3, ?4) \
                         ON CONFLICT(entity, id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at",
                        rusqlite::params![entity, id, encoded, system_time_now_ms()],
                    )?;
                }
                EntityMutation::Delete { entity, id } => {
                    transaction.execute(
                        "DELETE FROM app_entities WHERE entity = ?1 AND id = ?2",
                        rusqlite::params![entity, id],
                    )?;
                }
                EntityMutation::Clear { entity } => {
                    transaction.execute(
                        "DELETE FROM app_entities WHERE entity = ?1",
                        rusqlite::params![entity],
                    )?;
                }
            }
        }
        transaction.commit()
    })
}

/// True when a semicolon inside SQL text separates real statements (a second
/// statement would be silently dropped by prepare/execute without the
/// `extra_check` feature, so reject it here). String/blob literals and
/// comments are skipped; identifiers cannot contain raw semicolons.
fn has_statement_tail(sql: &str) -> bool {
    let bytes = sql.as_bytes();
    let mut index = 0;
    while index < bytes.len() {
        let byte = bytes[index];
        match byte {
            b'\'' | b'"' => {
                let quote = byte;
                index += 1;
                while index < bytes.len() {
                    if bytes[index] == quote {
                        if index + 1 < bytes.len() && bytes[index + 1] == quote {
                            index += 2; // escaped quote
                            continue;
                        }
                        break;
                    }
                    index += 1;
                }
            }
            b'-' if index + 1 < bytes.len() && bytes[index + 1] == b'-' => {
                while index < bytes.len() && bytes[index] != b'\n' {
                    index += 1;
                }
            }
            b'/' if index + 1 < bytes.len() && bytes[index + 1] == b'*' => {
                index += 2;
                while index + 1 < bytes.len() && !(bytes[index] == b'*' && bytes[index + 1] == b'/')
                {
                    index += 1;
                }
            }
            b';' => {
                // Skip whitespace and comments after the separator: a trailing
                // comment is not a second statement.
                let mut rest = &sql[index + 1..];
                loop {
                    rest = rest.trim_start();
                    if let Some(stripped) = rest.strip_prefix("--") {
                        let consumed = stripped.len();
                        let after = &rest[consumed..];
                        let newline = after.find('\n').unwrap_or(after.len());
                        rest = &after[newline..];
                    } else if rest.starts_with("/*") {
                        let end = rest.find("*/").map(|at| at + 2).unwrap_or(rest.len());
                        rest = &rest[end..];
                    } else {
                        break;
                    }
                }
                if !rest.is_empty() {
                    return true;
                }
            }
            _ => {}
        }
        index += 1;
    }
    false
}

fn validate_query_sql(sql: &str) -> Result<(), String> {
    let trimmed = sql.trim().to_uppercase();
    if !trimmed.starts_with("SELECT")
        && !trimmed.starts_with("WITH")
        && !trimmed.starts_with("PRAGMA")
    {
        return Err("only SELECT, WITH, and PRAGMA queries are allowed".to_owned());
    }
    if trimmed.starts_with("PRAGMA") {
        // sqlite3_stmt_readonly() reports TRUE for some writing pragmas
        // (writable_schema), so pragmas get their own read-only allowlist;
        // an '=' argument makes even an allowlisted pragma a write.
        const READ_ONLY_PRAGMAS: &[&str] = &[
            "table_info",
            "index_list",
            "index_xinfo",
            "table_list",
            "pragma_list",
            "foreign_keys",
            "journal_mode",
            "page_count",
            "page_size",
            "encoding",
            "user_version",
            "integrity_check",
            "quick_check",
        ];
        let lowered = sql.trim_start().to_lowercase();
        let rest = lowered
            .strip_prefix("pragma")
            .unwrap_or(&lowered)
            .trim_start();
        let name = rest
            .split(|c: char| c.is_whitespace() || c == '(' || c == '=' || c == ';')
            .next()
            .unwrap_or("");
        if !READ_ONLY_PRAGMAS.contains(&name) {
            return Err("only read-only PRAGMA queries are allowed".to_owned());
        }
        if rest.contains('=') {
            return Err("PRAGMA arguments are not allowed".to_owned());
        }
    }
    if has_statement_tail(sql) {
        return Err("only a single statement is allowed".to_owned());
    }
    Ok(())
}

fn validate_update_sql(sql: &str) -> Result<(), String> {
    let trimmed = sql.trim().to_uppercase();
    if !trimmed.starts_with("INSERT")
        && !trimmed.starts_with("UPDATE")
        && !trimmed.starts_with("DELETE")
    {
        return Err("only INSERT, UPDATE, and DELETE are allowed".to_owned());
    }
    if has_statement_tail(sql) {
        return Err("only a single statement is allowed".to_owned());
    }
    // No keyword substring scan: it false-positives on identifiers like a
    // "drop_reason" column, and the single-statement + prefix rules above are
    // the actual boundary.
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{validate_query_sql, validate_update_sql};

    #[test]
    fn query_validation_allows_read_statements_only() {
        for sql in [
            "SELECT * FROM messages",
            " with recent AS (SELECT 1) SELECT * FROM recent",
            "pragma table_info(messages)",
            "SELECT ';' AS sep",
            "SELECT 1; -- trailing comment only",
        ] {
            assert!(
                validate_query_sql(sql).is_ok(),
                "expected query to pass: {sql}"
            );
        }
        assert_eq!(
            validate_query_sql("DELETE FROM messages"),
            Err("only SELECT, WITH, and PRAGMA queries are allowed".to_owned())
        );
        // A second statement must error instead of being silently dropped.
        assert_eq!(
            validate_query_sql("SELECT 1; DROP TABLE messages"),
            Err("only a single statement is allowed".to_owned())
        );
        assert!(validate_query_sql("SELECT 1; INSERT INTO settings VALUES (1, 'x')").is_err());
        // sqlite reports some writing pragmas as readonly; the allowlist is the guard.
        assert!(validate_query_sql("PRAGMA writable_schema = 1").is_err());
        assert!(validate_query_sql("pragma journal_mode = WAL").is_err());
        assert!(validate_query_sql("PRAGMA table_info(messages)").is_ok());
    }

    #[test]
    fn update_validation_allows_single_dml_statements() {
        for sql in [
            "INSERT INTO settings VALUES (?1, ?2)",
            " update settings SET value = ?1",
            "DELETE FROM settings WHERE name = ?1",
            "UPDATE settings SET value = 'contains; semicolon' WHERE name = ?1",
        ] {
            assert!(
                validate_update_sql(sql).is_ok(),
                "expected update to pass: {sql}"
            );
        }
        assert!(validate_update_sql("DROP TABLE settings").is_err());
        assert_eq!(
            validate_update_sql("DELETE FROM settings; VACUUM"),
            Err("only a single statement is allowed".to_owned())
        );
        // Identifiers that merely contain a scary substring must not be rejected.
        assert!(validate_update_sql("UPDATE tickets SET drop_reason = ?1 WHERE id = ?2").is_ok());
    }
}
