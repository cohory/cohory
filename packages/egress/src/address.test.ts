import { describe, expect, it } from "vitest";

import { isBlockedAddress } from "./address";

describe("isBlockedAddress", () => {
  it.each([
    "127.0.0.1",
    "127.10.0.1",
    "10.0.0.5",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "169.254.169.254",
    "100.100.100.200",
    "0.0.0.0",
    "224.0.0.1",
    "255.255.255.255",
    "198.18.0.1",
    "::",
    "::1",
    "fe80::1",
    "fd00:ec2::254",
    "fc00::1",
    "ff02::1",
    "::ffff:127.0.0.1",
    "::ffff:7f00:1",
    "::ffff:169.254.169.254",
    "64:ff9b::a9fe:a9fe",
    "64:ff9b::10.0.0.1",
    "2001:db8::1",
    "2002:7f00:1::1",
    "0:0:0:0:0:0:0:1",
  ])("blocks %s", (address) => {
    expect(isBlockedAddress(address)).toBe(true);
  });

  it.each([
    "93.184.215.14",
    "1.1.1.1",
    "8.8.8.8",
    "172.32.0.1",
    "100.128.0.1",
    "2606:4700:4700::1111",
    "2a00:1450:4001:80b::200e",
    "::ffff:93.184.215.14",
    "64:ff9b::808:808",
  ])("allows %s", (address) => {
    expect(isBlockedAddress(address)).toBe(false);
  });

  it("blocks anything that is not an IP address", () => {
    expect(isBlockedAddress("localhost")).toBe(true);
    expect(isBlockedAddress("")).toBe(true);
    expect(isBlockedAddress("1.2.3")).toBe(true);
  });
});
