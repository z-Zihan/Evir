use std::time::{SystemTime, UNIX_EPOCH};

use serde_json::{json, Value};

use crate::storage::{execute_query, execute_update, init_db};

#[test]
fn initializes_schema_and_round_trips_values() {
    let suffix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system time must be valid")
        .as_nanos();
    let directory =
        std::env::temp_dir().join(format!("evir-storage-{}-{suffix}", std::process::id()));
    std::fs::create_dir_all(&directory).expect("temporary directory must be created");

    let conn = init_db(&directory).expect("database must initialize");
    let tables = execute_query(
        &conn,
        "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
        &[],
    )
    .expect("schema must be queryable");
    for table in [
        "attachments",
        "conversations",
        "messages",
        "providers",
        "schema_migrations",
        "settings",
        "usage_records",
    ] {
        assert!(tables.iter().any(|row| row["name"] == table));
    }

    let params = [json!("theme"), json!({ "mode": "dark" })];
    assert_eq!(
        execute_update(
            &conn,
            "INSERT INTO settings(name, value) VALUES (?1, ?2)",
            &params,
        )
        .expect("setting must be inserted"),
        1
    );
    let rows = execute_query(
        &conn,
        "SELECT name, value FROM settings WHERE name = ?1",
        &[Value::String("theme".to_owned())],
    )
    .expect("setting must be read");
    assert_eq!(
        rows,
        vec![json!({ "name": "theme", "value": "{\"mode\":\"dark\"}" })]
    );

    drop(conn);
    std::fs::remove_dir_all(directory).expect("temporary directory must be removed");
}
