/**
 * API Key Guardrail Tests (Vitest)
 *
 * 「Claude にキーを入れても無効と言われる」の原因になる、貼り付けの紛れ込みと
 * キーの種類の取り違えを、保存前に見つけられることを固定する。
 */

import { describe, it, expect } from "vitest";
import { sanitizeApiKey, claudeKeyIssue } from "../src/adapters/apiKeyCheck";

describe("sanitizeApiKey", () => {
  it("should remove characters that trim() leaves behind", () => {
    const pasted = " sk-ant-api03-abc​def\nghi　 ";
    expect(sanitizeApiKey(pasted)).toBe("sk-ant-api03-abcdefghi");
  });
});

describe("claudeKeyIssue", () => {
  it("should accept a Console API key", () => {
    expect(claudeKeyIssue("sk-ant-api03-xxxx")).toBeNull();
  });

  it.each([
    ["sk-ant-oat01-xxxx", "ログイン用トークン"],
    ["sk-ant-admin01-xxxx", "Admin API キー"],
    ["AIzaSyXXXX", "sk-ant-api で始まります"],
  ])("should explain why %s cannot be used", (key, expected) => {
    expect(claudeKeyIssue(key)).toContain(expected);
  });
});
