import { describe, expect, it } from "vitest";
import { fromAnthropic, toAnthropic } from "../src/anthropic";

describe("Anthropic adapter", () => {
  it("maps our messages to the Messages API format", () => {
    expect(toAnthropic([
      { role: "user", text: "Did I take my pills?" },
      { role: "assistant", text: "", calls: [{ id: "t1", name: "get_medication_status", input: {} }] },
      { role: "tool_results", results: [{ id: "t1", content: "{\"say\":[\"Not yet.\"]}" }] },
      { role: "assistant", text: "Not yet." },
    ])).toEqual([
      { role: "user", content: "Did I take my pills?" },
      { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "get_medication_status", input: {} }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "{\"say\":[\"Not yet.\"]}" }] },
      { role: "assistant", content: [{ type: "text", text: "Not yet." }] },
    ]);
  });
  it("reads tool calls and text from a response", () => {
    expect(fromAnthropic({ content: [
      { type: "text", text: "Let me check.", citations: null },
      { type: "tool_use", id: "t2", name: "get_today", input: {} },
    ] } as never)).toEqual({ kind: "tools", text: "Let me check.", calls: [{ id: "t2", name: "get_today", input: {} }] });
    expect(fromAnthropic({ content: [{ type: "text", text: " Hello, Rose. ", citations: null }] } as never))
      .toEqual({ kind: "text", text: "Hello, Rose." });
  });
});
