#[cfg(test)]
mod tests {
    use crate::browser_workbench::normalize_input_url;

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
