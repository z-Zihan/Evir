//! Snapshot formatting for the browser agent: turns Chrome's accessibility
//! tree into the compact `@eN role "name"` ref language the model acts on.
//!
//! Context economy: only interactive nodes are emitted (no full DOM), field
//! values are never included (password safety), and the output is capped.

use std::collections::HashMap;

/// Interactive AX roles worth exposing to the model.
const INTERACTIVE_ROLES: [&str; 22] = [
    "button",
    "link",
    "textBox",
    "textField",
    "searchBox",
    "spinButton",
    "checkBox",
    "radioButton",
    "comboBox",
    "menuListPopup",
    "listBox",
    "option",
    "menu",
    "menuItem",
    "menuItemCheckBox",
    "menuItemRadio",
    "tab",
    "switch",
    "slider",
    "treeItem",
    "popUpButton",
    "WebArea",
];

pub const MAX_SNAPSHOT_NODES: usize = 400;
pub const MAX_SNAPSHOT_LABEL_LEN: usize = 120;

pub struct SnapshotBuild {
    pub lines: Vec<String>,
    pub refs: HashMap<String, (String, i64)>,
}

fn normalize_role(raw: &str) -> String {
    let first = raw.chars().next().unwrap_or('b').to_ascii_lowercase();
    format!("{first}{}", &raw[1.min(raw.len())..])
}

fn truncate_label(label: &str) -> String {
    let single_line: String = label.split_whitespace().collect::<Vec<_>>().join(" ");
    if single_line.chars().count() > MAX_SNAPSHOT_LABEL_LEN {
        format!(
            "{}…",
            single_line
                .chars()
                .take(MAX_SNAPSHOT_LABEL_LEN)
                .collect::<String>()
        )
    } else {
        single_line
    }
}

/// Builds the snapshot. `target_id` scopes generated refs; values from the AX
/// tree are deliberately dropped (never echo typed secrets back to the model).
pub fn build_snapshot(target_id: &str, ax_nodes: &serde_json::Value) -> SnapshotBuild {
    let mut lines = Vec::new();
    let mut refs = HashMap::new();
    let Some(nodes) = ax_nodes.as_array() else {
        return SnapshotBuild { lines, refs };
    };
    let mut counter = 0usize;
    for node in nodes {
        if lines.len() >= MAX_SNAPSHOT_NODES {
            lines.push("… node limit reached, use scroll or get_text for more".into());
            break;
        }
        let backend = node.get("backendDOMNodeId").and_then(|id| id.as_i64());
        let role = node
            .get("role")
            .and_then(|role| role.get("value"))
            .and_then(|value| value.as_str())
            .unwrap_or("");
        if role.is_empty() || backend.is_none() {
            continue;
        }
        let role = normalize_role(role);
        if !INTERACTIVE_ROLES.contains(&role.as_str()) {
            continue;
        }
        let name = node
            .get("name")
            .and_then(|name| name.get("value"))
            .and_then(|value| value.as_str())
            .unwrap_or("")
            .to_string();
        let name = truncate_label(&name);
        counter += 1;
        let ref_id = format!("@e{counter}");
        // Role shown compactly; name omitted when blank.
        let line = if name.is_empty() {
            format!("{ref_id} {role}")
        } else {
            format!("{ref_id} {role} \"{name}\"")
        };
        lines.push(line);
        refs.insert(
            ref_id.clone(),
            (target_id.to_string(), backend.unwrap_or(0)),
        );
    }
    if lines.is_empty() {
        lines.push("(no interactive elements found)".into());
    }
    SnapshotBuild { lines, refs }
}

/// Truncates page text for tool results, keeping the budget bounded.
pub fn truncate_page_text(text: &str, limit: usize) -> String {
    let mut out = String::new();
    for line in text.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        if out.len() + trimmed.len() + 1 > limit {
            out.push('…');
            break;
        }
        if !out.is_empty() {
            out.push('\n');
        }
        out.push_str(trimmed);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn snapshot_lists_interactive_nodes_with_refs() {
        let ax = json!([
            { "backendDOMNodeId": 11, "role": { "value": "button" }, "name": { "value": "Login" } },
            { "backendDOMNodeId": 12, "role": { "value": "textField" }, "name": { "value": "Email" } },
            { "backendDOMNodeId": 13, "role": { "value": "staticText" }, "name": { "value": "filler" } }
        ]);
        let build = build_snapshot("t1", &ax);
        assert_eq!(
            build.lines,
            vec!["@e1 button \"Login\"", "@e2 textField \"Email\""]
        );
        assert_eq!(build.refs.get("@e1"), Some(&("t1".to_string(), 11)));
    }

    #[test]
    fn snapshot_drops_values_not_names() {
        // Even if the AX tree carries values (typed text), they never surface.
        let ax = json!([
            { "backendDOMNodeId": 1, "role": { "value": "textField" }, "name": { "value": "Password" }, "value": { "value": "hunter2" } }
        ]);
        let build = build_snapshot("t1", &ax);
        let joined = build.lines.join(" ");
        assert!(joined.contains("Password"));
        assert!(!joined.contains("hunter2"));
    }

    #[test]
    fn snapshot_caps_node_count() {
        let nodes: Vec<serde_json::Value> = (0..500)
            .map(|index| {
                json!({ "backendDOMNodeId": index, "role": { "value": "link" }, "name": { "value": format!("n{index}") } })
            })
            .collect();
        let build = build_snapshot("t1", &json!(nodes));
        assert!(build.lines.len() <= MAX_SNAPSHOT_NODES + 1);
    }

    #[test]
    fn page_text_truncates_by_budget() {
        let text = "line1\n\nline2\n   \nline3";
        assert_eq!(truncate_page_text(text, 100), "line1\nline2\nline3");
        assert!(truncate_page_text(&"word ".repeat(5000), 200).ends_with('…'));
    }
}
