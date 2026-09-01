#[cfg(test)]
mod tests {
    use crate::browser_workbench::{normalize_input_url, Surface};

    #[test]
    fn surfaces_use_distinct_labels_and_windows() {
        assert_eq!(Surface::Workbench.prefix(), "browser-content-");
        assert_eq!(Surface::Panel.prefix(), "browser-panel-content-");
        assert_eq!(Surface::Workbench.window_label(), "browser-workbench");
        assert_eq!(Surface::Panel.window_label(), "main");
        assert_ne!(
            format!("{}1", Surface::Workbench.prefix()),
            format!("{}1", Surface::Panel.prefix())
        );
    }

    #[test]
    fn normalizes_bare_hosts_to_https() {
        assert_eq!(
            normalize_input_url("example.com/x").unwrap(),
            "https://example.com/x"
        );
    }

    #[test]
    fn normalizes_localhost_to_http() {
        assert_eq!(
            normalize_input_url("localhost:5173").unwrap(),
            "http://localhost:5173"
        );
        assert_eq!(
            normalize_input_url("127.0.0.1:3000").unwrap(),
            "http://127.0.0.1:3000"
        );
    }

    #[test]
    fn keeps_explicit_schemes() {
        assert_eq!(normalize_input_url("http://a.b").unwrap(), "http://a.b");
        assert_eq!(normalize_input_url("https://a.b").unwrap(), "https://a.b");
    }

    #[test]
    fn rejects_empty_urls() {
        assert!(normalize_input_url("   ").is_err());
    }
}
