const ipv4Pattern = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
const hextetPattern = /^[0-9a-f]{1,4}$/;

type Ipv4 = readonly [number, number, number, number];

function parseIpv4(value: string): Ipv4 | undefined {
  const match = ipv4Pattern.exec(value);
  if (!match) {
    return undefined;
  }
  const octets: Ipv4 = [Number(match[1]), Number(match[2]), Number(match[3]), Number(match[4])];
  return octets.every((octet) => octet <= 255) ? octets : undefined;
}

function parseHextets(part: string): number[] | undefined {
  if (part === "") {
    return [];
  }
  const groups = part.split(":");
  const hextets: number[] = [];
  for (const [index, group] of groups.entries()) {
    const ipv4 = index === groups.length - 1 ? parseIpv4(group) : undefined;
    if (ipv4) {
      const [a, b, c, d] = ipv4;
      hextets.push(a * 256 + b, c * 256 + d);
      continue;
    }
    if (!hextetPattern.test(group)) {
      return undefined;
    }
    hextets.push(Number.parseInt(group, 16));
  }
  return hextets;
}

function parseIpv6(value: string): readonly number[] | undefined {
  const [first = "", second, ...rest] = value.split("::");
  if (rest.length > 0) {
    return undefined;
  }
  const head = parseHextets(first);
  const tail = second === undefined ? [] : parseHextets(second);
  if (!head || !tail) {
    return undefined;
  }
  if (second === undefined) {
    return head.length === 8 ? head : undefined;
  }
  const missing = 8 - head.length - tail.length;
  return missing >= 1 ? [...head, ...Array<number>(missing).fill(0), ...tail] : undefined;
}

function isIpv4Mapped(hextets: readonly number[]): boolean {
  return hextets.slice(0, 5).every((hextet) => hextet === 0) && hextets[5] === 0xffff;
}

export function normalizeIp(raw: string): string {
  let value = raw.trim().toLowerCase();
  if (value.startsWith("[") && value.endsWith("]")) {
    value = value.slice(1, -1);
  }
  const ipv4 = parseIpv4(value);
  if (ipv4) {
    return ipv4.join(".");
  }
  const zone = value.indexOf("%");
  const hextets = parseIpv6(zone === -1 ? value : value.slice(0, zone));
  if (!hextets) {
    return value;
  }
  if (isIpv4Mapped(hextets)) {
    const [high = 0, low = 0] = hextets.slice(6);
    return [high >> 8, high & 0xff, low >> 8, low & 0xff].join(".");
  }
  return `${hextets
    .slice(0, 4)
    .map((hextet) => hextet.toString(16))
    .join(":")}::/64`;
}
