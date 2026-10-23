import { createOptOutLinker, optOutSecretFromEnv, type OptOutLinks } from "@cohory/email";

import { appUrl } from "../manage/views";

export function communityOptOutLinks(to: string, communityId: string): OptOutLinks {
  return createOptOutLinker({ secret: optOutSecretFromEnv(), appUrl: appUrl() })({
    to,
    communityId,
  });
}
