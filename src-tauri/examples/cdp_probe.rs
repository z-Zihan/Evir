// Manual probe: connect tokio-tungstenite to the running agent browser and
// round-trip Target.getTargets, printing handshake/result/timeout stages.
#[tokio::main]
async fn main() {
    let home = std::env::var("HOME").unwrap();
    let pf = std::path::Path::new(&home).join(
        "Library/Application Support/com.zihan.evir/browser-agent-profile/DevToolsActivePort",
    );
    let content = std::fs::read_to_string(pf).unwrap();
    let port: u16 = content.lines().next().unwrap().trim().parse().unwrap();
    let path = content.lines().nth(1).unwrap().trim().to_string();
    let url = format!("ws://127.0.0.1:{port}{path}");
    println!("connecting {url}");

    use futures_util::{SinkExt, StreamExt};
    use tokio_tungstenite::tungstenite::Message;
    let (ws, resp) = tokio_tungstenite::connect_async(&url)
        .await
        .expect("handshake");
    println!("handshake status: {:?}", resp.status());
    println!(
        "resp headers: {:?}",
        resp.headers().iter().take(6).collect::<Vec<_>>()
    );
    let (mut sink, mut stream) = ws.split();

    sink.send(Message::text(
        serde_json::json!({"id": 1, "method": "Target.getTargets"}).to_string(),
    ))
    .await
    .unwrap();
    println!("sent getTargets; waiting…");

    let wait = tokio::time::timeout(std::time::Duration::from_secs(6), async {
        while let Some(msg) = stream.next().await {
            match msg {
                Ok(Message::Text(t)) => {
                    let v: serde_json::Value = serde_json::from_str(&t).unwrap_or_default();
                    if v.get("id") == Some(&serde_json::Value::from(1)) {
                        println!(
                            "got response id=1 targets={}",
                            v["result"]["targetInfos"]
                                .as_array()
                                .map(|a| a.len())
                                .unwrap_or(0)
                        );
                        return;
                    }
                }
                Ok(other) => println!("other frame: {other:?}"),
                Err(e) => println!("ws err: {e}"),
            }
        }
    })
    .await;
    match wait {
        Ok(_) => println!("ROUND TRIP OK"),
        Err(_) => println!("TIMEOUT — tungstenite client reproduced the hang"),
    }
}
