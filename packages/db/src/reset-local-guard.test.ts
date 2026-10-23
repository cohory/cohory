import { describe, expect, it } from "vitest";

import { resetLocalRefusal } from "./reset-local-guard";

const local = "postgres://cohory:cohory@127.0.0.1:5433/cohory";

describe("resetLocalRefusal", () => {
  it("allows a database on localhost or 127.0.0.1 with --yes", () => {
    expect(resetLocalRefusal({ DATABASE_URL: local }, ["--yes"])).toBeNull();
    expect(
      resetLocalRefusal(
        {
          DATABASE_URL: "postgres://cohory_app:x@localhost:5433/cohory",
          DATABASE_ADMIN_URL: local,
          NODE_ENV: "development",
        },
        ["--yes"],
      ),
    ).toBeNull();
  });

  it("refuses without --yes", () => {
    expect(resetLocalRefusal({ DATABASE_URL: local }, [])).toEqual({ reason: "not_confirmed" });
  });

  it("refuses when NODE_ENV is production, even with --yes", () => {
    expect(resetLocalRefusal({ DATABASE_URL: local, NODE_ENV: "production" }, ["--yes"])).toEqual({
      reason: "production",
    });
  });

  it.each([
    "postgres://cohory:cohory@db.example.com:5432/cohory",
    "postgres://cohory:cohory@postgres:5432/cohory",
    "postgres://cohory:cohory@10.0.0.5:5432/cohory",
  ])("refuses the database at %s", (url) => {
    expect(resetLocalRefusal({ DATABASE_URL: url }, ["--yes"])).toMatchObject({
      reason: "remote_host",
    });
  });

  it("refuses when the admin URL points at another host than a local DATABASE_URL", () => {
    expect(
      resetLocalRefusal(
        { DATABASE_URL: local, DATABASE_ADMIN_URL: "postgres://a:b@prod.example.com/cohory" },
        ["--yes"],
      ),
    ).toEqual({ reason: "remote_host", host: "prod.example.com" });
  });

  it("refuses when no database URL is set", () => {
    expect(resetLocalRefusal({}, ["--yes"])).toEqual({ reason: "invalid_url" });
  });
});
