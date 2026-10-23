import { BlockList, isIPv4, isIPv6 } from "node:net";

const ipv4Blocked = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  ipv4Blocked.addSubnet(network, prefix, "ipv4");
}

const ipv6Blocked = new BlockList();
for (const [network, prefix] of [
  ["::", 96],
  ["64:ff9b:1::", 48],
  ["100::", 64],
  ["2001::", 23],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["fc00::", 7],
  ["fe80::", 10],
  ["fec0::", 10],
  ["ff00::", 8],
] as const) {
  ipv6Blocked.addSubnet(network, prefix, "ipv6");
}

function ipv6Bytes(address: string): Uint8Array | null {
  const zone = address.indexOf("%");
  const plain = zone === -1 ? address : address.slice(0, zone);
  let text = plain;
  const tail: number[] = [];
  const lastColon = plain.lastIndexOf(":");
  const dotted = plain.slice(lastColon + 1);
  if (dotted.includes(".")) {
    if (!isIPv4(dotted)) {
      return null;
    }
    const [a = 0, b = 0, c = 0, d = 0] = dotted.split(".").map(Number);
    tail.push((a << 8) | b, (c << 8) | d);
    text = `${plain.slice(0, lastColon)}:0:0`;
  }
  const halves = text.split("::");
  if (halves.length > 2) {
    return null;
  }
  const parse = (part: string | undefined) =>
    part ? part.split(":").map((group) => Number.parseInt(group, 16)) : [];
  const head = parse(halves[0]);
  const rest = parse(halves[1]);
  const fill = halves.length === 2 ? 8 - head.length - rest.length : 0;
  const groups = [...head, ...Array<number>(Math.max(fill, 0)).fill(0), ...rest];
  if (tail.length === 2) {
    groups.splice(6, 2, ...tail);
  }
  if (groups.length !== 8 || groups.some((group) => Number.isNaN(group) || group > 0xffff)) {
    return null;
  }
  const bytes = new Uint8Array(16);
  groups.forEach((group, index) => {
    bytes[index * 2] = group >> 8;
    bytes[index * 2 + 1] = group & 0xff;
  });
  return bytes;
}

function embeddedIpv4(bytes: Uint8Array): string | null {
  const prefix = Array.from(bytes.slice(0, 12));
  const mapped =
    prefix.slice(0, 10).every((byte) => byte === 0) && prefix[10] === 0xff && prefix[11] === 0xff;
  const nat64 =
    prefix[0] === 0x00 &&
    prefix[1] === 0x64 &&
    prefix[2] === 0xff &&
    prefix[3] === 0x9b &&
    prefix.slice(4).every((byte) => byte === 0);
  return mapped || nat64 ? Array.from(bytes.slice(12)).join(".") : null;
}

export function isBlockedAddress(address: string): boolean {
  if (isIPv4(address)) {
    return ipv4Blocked.check(address, "ipv4");
  }
  if (!isIPv6(address)) {
    return true;
  }
  const bytes = ipv6Bytes(address);
  if (!bytes) {
    return true;
  }
  const v4 = embeddedIpv4(bytes);
  if (v4) {
    return ipv4Blocked.check(v4, "ipv4");
  }
  const zone = address.indexOf("%");
  return ipv6Blocked.check(zone === -1 ? address : address.slice(0, zone), "ipv6");
}
