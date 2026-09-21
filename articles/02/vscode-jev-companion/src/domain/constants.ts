/**
 * Domain Constants & Configuration Defaults
 */

export const DEFAULT_JEV_BASE_URL = "https://api.typesafe.ai";
export const DEFAULT_JEV_MODEL = "jev-latest";
export const DEFAULT_CONFIDENCE_THRESHOLD = 0.85;
export const DEFAULT_REQUEST_TIMEOUT_MS = 3000;

export const PROMPT_TEMPLATES: Record<string, string> = {
  test_generation:
    "You are an expert test engineer. Generate comprehensive, production-grade unit tests for the following code including edge cases and negative assertions.",
  refactoring:
    "You are a clean code specialist. Refactor the following code to improve readability, performance, and immutability according to Clean Architecture.",
  documentation:
    "You are a technical documentation specialist. Write complete TSDoc / JSDoc documentation with parameter types, return types, and usage examples.",
  bug_fixing:
    "You are a principal debugging engineer. Identify root causes for potential bugs, race conditions, or unhandled exceptions in this snippet, and provide a fixed version.",
  security_hardening:
    "You are an application security specialist. Review this code for injection risks, secret exposures, or unsafe operations, and apply zero-trust security hardening.",
};
