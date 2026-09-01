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

#[cfg(test)]
mod annotation_tests {
    use crate::browser_workbench::annotation_payload_from_title;

    fn sample_payload() -> String {
        // {"url":"http://localhost:5173/login","tag":"button","id":"login",
        //  "text":"登录","selector":"button#login"}
        let json = r#","url":"http://localhost:5173/login","tag":"button","id":"login","text":"登录","selector":"button#login"}"#;
        let mut encoded = String::new();
        // Percent-encode the non-ASCII and structural characters the way
        // encodeURIComponent would for the JSON body.
        for ch in json.chars() {
            match ch {
                'A'..='Z' | 'a'..='z' | '0'..='9' => encoded.push(ch),
                _ => {
                    let mut buf = [0u8; 4];
                    for byte in ch.encode_utf8(&mut buf).as_bytes() {
                        encoded.push_str(&format!("%{:02X}", byte));
                    }
                }
            }
        }
        format!("EVIR_ANNOTATE:{{%22tag%22:%22button%22{}", encoded)
    }

    #[test]
    fn decodes_annotation_titles_and_ignores_ordinary_titles() {
        let payload = annotation_payload_from_title(&sample_payload())
            .expect("annotation title should decode");
        assert_eq!(payload["tag"], "button");
        assert_eq!(payload["id"], "login");
        assert_eq!(payload["text"], "登录");
        assert_eq!(payload["url"], "http://localhost:5173/login");
        assert!(annotation_payload_from_title("Regular tab title").is_none());
        assert!(annotation_payload_from_title("EVIR_ANNOTATE:not-json").is_none());
    }
}
