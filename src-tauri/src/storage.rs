use std::{path::Path, sync::Mutex};

use rusqlite::{params_from_iter, types::ValueRef, Connection, Result};
use serde_json::{Map, Number, Value};

pub type Row = Value;

pub struct DatabaseState {
    pub(crate) conn: Mutex<Connection>,
}

impl DatabaseState {
    pub fn new(conn: Connection) -> Self {
        Self {
            conn: Mutex::new(conn),
        }
    }
}

pub fn init_db(app_data_dir: &Path) -> Result<Connection> {
    let conn = Connection::open(app_data_dir.join("evir.db"))?;
    conn.execute_batch(
        r#"
        PRAGMA foreign_keys = ON;
        PRAGMA journal_mode = WAL;
        CREATE TABLE IF NOT EXISTS schema_migrations (
          version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS providers (
          id TEXT PRIMARY KEY, name TEXT NOT NULL, protocol_id TEXT NOT NULL,
          base_url TEXT NOT NULL, api_key TEXT NOT NULL DEFAULT '', model_id TEXT NOT NULL,
          enabled INTEGER NOT NULL DEFAULT 1, is_default INTEGER NOT NULL DEFAULT 0,
          created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS conversations (
          id TEXT PRIMARY KEY, title TEXT NOT NULL DEFAULT '', provider_id TEXT NOT NULL,
          model_id TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS messages (
          id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, role TEXT NOT NULL,
          content TEXT NOT NULL, status TEXT NOT NULL, error_message TEXT,
          created_at INTEGER NOT NULL, input_tokens INTEGER, output_tokens INTEGER,
          total_tokens INTEGER
        );
        CREATE TABLE IF NOT EXISTS attachments (
          id TEXT PRIMARY KEY, message_id TEXT NOT NULL, file_name TEXT NOT NULL,
          mime_type TEXT NOT NULL, size INTEGER NOT NULL, data TEXT NOT NULL,
          type TEXT NOT NULL, created_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS usage_records (
          id TEXT PRIMARY KEY, conversation_id TEXT, provider_id TEXT NOT NULL,
          model_id TEXT NOT NULL, input_tokens INTEGER, output_tokens INTEGER,
          total_tokens INTEGER, evidence TEXT NOT NULL, success INTEGER NOT NULL,
          duration_ms INTEGER NOT NULL, first_token_ms INTEGER, created_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS settings (
          name TEXT PRIMARY KEY, value TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS app_entities (
          entity TEXT NOT NULL,
          id TEXT NOT NULL,
          data TEXT NOT NULL,
          updated_at INTEGER NOT NULL,
          PRIMARY KEY(entity, id)
        );
        CREATE INDEX IF NOT EXISTS idx_messages_conversation
          ON messages(conversation_id, created_at);
        CREATE INDEX IF NOT EXISTS idx_attachments_message ON attachments(message_id);
        CREATE INDEX IF NOT EXISTS idx_conversations_updated
          ON conversations(updated_at DESC);
        INSERT OR IGNORE INTO schema_migrations(version, applied_at)
          VALUES (1, unixepoch() * 1000);
        INSERT OR IGNORE INTO schema_migrations(version, applied_at)
          VALUES (2, unixepoch() * 1000);
        "#,
    )?;
    Ok(conn)
}

fn json_to_sql(value: &Value) -> Result<rusqlite::types::Value> {
    use rusqlite::types::Value as SqlValue;

    match value {
        Value::Null => Ok(SqlValue::Null),
        Value::Bool(value) => Ok(SqlValue::Integer(i64::from(*value))),
        Value::Number(value) if value.is_i64() => {
            Ok(SqlValue::Integer(value.as_i64().unwrap_or(0)))
        }
        Value::Number(value) if value.is_u64() => i64::try_from(value.as_u64().unwrap_or(0))
            .map(SqlValue::Integer)
            .map_err(|error| rusqlite::Error::ToSqlConversionFailure(Box::new(error))),
        Value::Number(value) => Ok(SqlValue::Real(value.as_f64().unwrap_or(0.0))),
        Value::String(value) => Ok(SqlValue::Text(value.clone())),
        value => serde_json::to_string(value)
            .map(SqlValue::Text)
            .map_err(|error| rusqlite::Error::ToSqlConversionFailure(Box::new(error))),
    }
}

fn sql_to_json(value: ValueRef<'_>) -> Value {
    match value {
        ValueRef::Null => Value::Null,
        ValueRef::Integer(value) => Value::Number(Number::from(value)),
        ValueRef::Real(value) => Number::from_f64(value).map_or(Value::Null, Value::Number),
        ValueRef::Text(value) => Value::String(String::from_utf8_lossy(value).into_owned()),
        ValueRef::Blob(value) => Value::Array(
            value
                .iter()
                .map(|byte| Value::Number(Number::from(*byte)))
                .collect(),
        ),
    }
}

pub fn execute_query(conn: &Connection, sql: &str, params: &[Value]) -> Result<Vec<Row>> {
    let values = params.iter().map(json_to_sql).collect::<Result<Vec<_>>>()?;
    let mut statement = conn.prepare(sql)?;
    let names = statement
        .column_names()
        .iter()
        .map(|name| (*name).to_owned())
        .collect::<Vec<_>>();
    let mut rows = statement.query(params_from_iter(values.iter()))?;
    let mut result = Vec::new();
    while let Some(row) = rows.next()? {
        let mut object = Map::new();
        for (index, name) in names.iter().enumerate() {
            object.insert(name.clone(), sql_to_json(row.get_ref(index)?));
        }
        result.push(Value::Object(object));
    }
    Ok(result)
}

pub fn execute_update(conn: &Connection, sql: &str, params: &[Value]) -> Result<usize> {
    let values = params.iter().map(json_to_sql).collect::<Result<Vec<_>>>()?;
    conn.execute(sql, params_from_iter(values.iter()))
}
