import { describe, expect, it } from "vitest";
import {
  describeAnnotationElement,
  formatAnnotationDraft,
  parseAnnotationPayload,
} from "../annotation";

const SAMPLE = {
  url: "http://localhost:5173/login",
  tag: "button",
  id: "login",
  classes: "btn primary",
  role: null,
  ariaLabel: null,
  name: null,
  text: "登录",
  box: { x: 120, y: 40, width: 180, height: 44 },
  selector: "button#login",
};

describe("browser annotation payload", () => {
  it("parses valid payloads and rejects malformed ones", () => {
    expect(parseAnnotationPayload(SAMPLE)?.tag).toBe("button");
    expect(parseAnnotationPayload({ tag: "button" })).toBeNull();
    expect(parseAnnotationPayload("nope")).toBeNull();
    // selector is mandatory: a bare CSS selector is too fragile (§38)
    expect(parseAnnotationPayload({ ...SAMPLE, selector: undefined })).toBeNull();
  });

  it("describes elements with accessible-ish identity", () => {
    expect(describeAnnotationElement(parseAnnotationPayload(SAMPLE)!)).toBe('button "登录"#login');
    const unlabeled = parseAnnotationPayload({
      ...SAMPLE,
      id: null,
      text: "",
      classes: "menu item",
    });
    expect(describeAnnotationElement(unlabeled!)).toBe("button.menu.item");
    const ariaOnly = parseAnnotationPayload({ ...SAMPLE, id: null, text: "", ariaLabel: "提交" });
    expect(describeAnnotationElement(ariaOnly!)).toBe('button "提交".btn.primary');
  });

  it("formats a browser-feedback draft with facts pinned and a blank comment", () => {
    const draft = formatAnnotationDraft(parseAnnotationPayload(SAMPLE)!, {
      header: "【浏览器反馈】",
      url: "URL",
      element: "元素",
      box: "位置",
      comment: "请修改",
    });
    expect(draft).toContain("URL: http://localhost:5173/login");
    expect(draft).toContain('元素: button "登录"#login');
    expect(draft).toContain("位置: 180×44 @ (120, 40)");
    expect(draft.split("\n").at(-1)).toBe("请修改: ");
  });
});
