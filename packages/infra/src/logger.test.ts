import { describe, expect, it } from "vitest";

import { createLogger, parseLogLevel, type LogLevel } from "./logger";

function capture(level: LogLevel | "silent" = "debug") {
  const lines: { level: string; line: Record<string, unknown> }[] = [];
  const logger = createLogger({
    service: "test",
    level,
    now: () => new Date("2026-10-23T08:00:00.000Z"),
    write: (line, lineLevel) => lines.push({ level: lineLevel, line: JSON.parse(line) }),
  });
  return { logger, lines };
}

describe("createLogger", () => {
  it("writes one JSON line with level, time, service, message, and fields", () => {
    const { logger, lines } = capture();
    logger.info({ communityId: "c1", count: 2 }, "points recorded");
    expect(lines).toEqual([
      {
        level: "info",
        line: {
          level: "info",
          time: "2026-10-23T08:00:00.000Z",
          service: "test",
          msg: "points recorded",
          communityId: "c1",
          count: 2,
        },
      },
    ]);
  });

  it("accepts a message without fields", () => {
    const { logger, lines } = capture();
    logger.warn("worker stopping");
    expect(lines[0]?.line).toMatchObject({ level: "warn", msg: "worker stopping" });
  });

  it("drops lines below the configured level and writes nothing when silent", () => {
    const quiet = capture("warn");
    quiet.logger.info("hidden");
    quiet.logger.error("shown");
    expect(quiet.lines.map((entry) => entry.line.msg)).toEqual(["shown"]);
    const silent = capture("silent");
    silent.logger.fatal("hidden");
    expect(silent.lines).toEqual([]);
  });

  it("redacts secrets at any depth", () => {
    const { logger, lines } = capture();
    logger.info(
      { user: { password: "p", apiToken: "t" }, headers: { Authorization: "a", cookie: "c" } },
      "request",
    );
    expect(lines[0]?.line).toMatchObject({
      user: { password: "[redacted]", apiToken: "[redacted]" },
      headers: { Authorization: "[redacted]", cookie: "[redacted]" },
    });
  });

  it("serializes errors by name and message", () => {
    const { logger, lines } = capture();
    logger.error({ err: new TypeError("bad input") }, "failed");
    expect(lines[0]?.line.err).toMatchObject({ name: "TypeError", message: "bad input" });
  });

  it("adds child bindings to every line", () => {
    const { logger, lines } = capture();
    logger.child({ jobId: "j1" }).info("done");
    expect(lines[0]?.line).toMatchObject({ service: "test", jobId: "j1", msg: "done" });
  });

  it("passes each line's level to the writer", () => {
    const { logger, lines } = capture();
    logger.debug("a");
    logger.info("b");
    logger.warn("c");
    logger.error("d");
    logger.fatal("e");
    expect(lines.map((entry) => entry.level)).toEqual(["debug", "info", "warn", "error", "fatal"]);
  });

  it("serializes an error with its code, its cause chain, and its stack", () => {
    const { logger, lines } = capture();
    const root = Object.assign(new Error("connection reset"), { code: "ECONNRESET" });
    const error = new Error("query failed", { cause: root });
    logger.error({ err: error }, "failed");
    expect(lines[0]?.line.err).toMatchObject({
      name: "Error",
      message: "query failed",
      cause: { name: "Error", message: "connection reset", code: "ECONNRESET" },
    });
    expect(String((lines[0]?.line.err as { stack?: unknown }).stack)).toContain("query failed");
  });

  it("stops following a cause chain after a few levels", () => {
    const { logger, lines } = capture();
    let error = new Error("level 0");
    for (let level = 1; level < 20; level += 1) {
      error = new Error(`level ${level}`, { cause: error });
    }
    logger.error({ err: error }, "deep");
    expect(JSON.stringify(lines[0]?.line).length).toBeLessThan(20_000);
  });

  it("writes dates as ISO strings", () => {
    const { logger, lines } = capture();
    logger.info({ at: new Date("2026-10-23T09:30:00.000Z"), nested: { on: new Date(0) } }, "dated");
    expect(lines[0]?.line).toMatchObject({
      at: "2026-10-23T09:30:00.000Z",
      nested: { on: "1970-01-01T00:00:00.000Z" },
    });
  });

  it("never lets caller fields replace level, time, service, or msg", () => {
    const { logger, lines } = capture();
    logger
      .child({ service: "other" })
      .warn({ level: "debug", time: "yesterday", msg: "spoofed", kept: 1 }, "real message");
    expect(lines[0]?.line).toMatchObject({
      level: "warn",
      time: "2026-10-23T08:00:00.000Z",
      service: "test",
      msg: "real message",
      kept: 1,
      "field.level": "debug",
      "field.time": "yesterday",
      "field.msg": "spoofed",
      "field.service": "other",
    });
  });

  it("redacts emails, API keys, and hashes as well as secrets", () => {
    const { logger, lines } = capture();
    logger.info(
      {
        email: "a@example.test",
        account: { userEmail: "b@example.test", apiKey: "k", api_key: "k2", tokenHash: "h" },
        list: [{ secret: "s" }],
      },
      "account",
    );
    expect(lines[0]?.line).toMatchObject({
      email: "[redacted]",
      account: {
        userEmail: "[redacted]",
        apiKey: "[redacted]",
        api_key: "[redacted]",
        tokenHash: "[redacted]",
      },
      list: [{ secret: "[redacted]" }],
    });
  });
});

describe("parseLogLevel", () => {
  it("accepts the known levels, maps trace to debug, and defaults to info", () => {
    expect(parseLogLevel(undefined)).toBe("info");
    expect(parseLogLevel("")).toBe("info");
    expect(parseLogLevel("warn")).toBe("warn");
    expect(parseLogLevel("trace")).toBe("debug");
    expect(parseLogLevel("silent")).toBe("silent");
  });

  it("fails fast with a clear message on an unknown level", () => {
    expect(() => parseLogLevel("verbose")).toThrow(
      'LOG_LEVEL must be one of trace, debug, info, warn, error, fatal, or silent; got "verbose".',
    );
  });
});
