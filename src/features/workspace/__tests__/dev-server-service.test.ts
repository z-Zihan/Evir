import { describe, expect, it } from "vitest";
import { detectDevScriptFromPackageJson } from "../dev-server-service";

describe("detectDevScriptFromPackageJson", () => {
  it("prefers a browser-specific dev script over an app runtime", () => {
    expect(
      detectDevScriptFromPackageJson(
        JSON.stringify({ scripts: { dev: "tauri dev", "dev:web": "vite --mode web" } }),
      ),
    ).toMatchObject({
      scriptName: "dev:web",
      command: "vite --mode web",
    });
  });

  it("falls back to the conventional dev script", () => {
    expect(
      detectDevScriptFromPackageJson(JSON.stringify({ scripts: { dev: "next dev" } })),
    ).toMatchObject({ scriptName: "dev", command: "next dev" });
  });
});
