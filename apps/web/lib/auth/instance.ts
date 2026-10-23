import { createInstanceAuth, type Auth } from "@cohory/auth";

import { communitySignUpLookups } from "./sign-up-lookups";

let appAuth: Auth | undefined;

export function getAppAuth(): Auth {
  appAuth ??= createInstanceAuth({ signUpLookups: communitySignUpLookups });
  return appAuth;
}
