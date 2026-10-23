import { randomInt, randomUUID } from "node:crypto";

export const password = "correct-horse-battery-staple";

export interface Person {
  readonly name: string;
  readonly email: string;
}

export function uniqueSuffix(): string {
  return randomUUID().slice(0, 8);
}

export function person(firstName: string): Person {
  const suffix = uniqueSuffix();
  return {
    name: firstName,
    email: `${firstName.toLowerCase().replace(/\W+/g, "-")}-${suffix}@example.test`,
  };
}

export function clientAddress(): string {
  return `10.${randomInt(0, 256)}.${randomInt(0, 256)}.${randomInt(1, 255)}`;
}
