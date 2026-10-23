import { getManageService } from "@cohory/communities";
import { getPlatformConfig } from "@cohory/config/platform";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CommunityMark,
} from "@cohory/ui";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { cache } from "react";

import { CommunityMeta } from "../../../components/community-top/community-meta";
import { PlatformBar } from "../../../components/platform-bar";
import {
  loadJoinCommunityCard,
  type JoinCommunityCard,
} from "../../../lib/communities/join-context";
import {
  autoAcceptInvite,
  inviteAcceptPath,
  joinIntentCookie,
  signUpOfferedFor,
} from "../../../lib/communities/join-intent";
import { inviteShareMetadata, unlistedInvite } from "../../../lib/communities/share-metadata";
import { inviteMessages, invitePreviewMessage } from "../../../lib/manage/invite";
import { currentSession } from "../../../lib/session";
import { startInviteJoinAction } from "./actions";
import { JoinInviteForm } from "./join-invite-form";
import { StoredImage } from "../../../components/stored-image";

const loadInvite = cache(async (token: string) => {
  const preview = await getManageService().previewInvite(token);
  const problem = invitePreviewMessage(preview);
  const card = preview && !problem ? await loadJoinCommunityCard(preview.community.slug) : null;
  return card ? { problem: null, card } : { problem: problem ?? inviteMessages.unavailable, card };
});

export async function generateMetadata({ params }: PageProps<"/join/[token]">): Promise<Metadata> {
  const invite = await loadInvite((await params).token);
  if (!invite.card) {
    return { title: "Join with an invite", robots: unlistedInvite };
  }
  const { appUrl, instance } = getPlatformConfig();
  return inviteShareMetadata(invite.card, appUrl, instance.name);
}

const linkClassName =
  "self-start rounded-sm text-sm font-medium text-accent underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring";

function InvitedCommunity({ card }: { card: JoinCommunityCard }) {
  return (
    <>
      {card.coverUrl ? (
        <StoredImage
          src={card.coverUrl}
          alt=""
          decoding="async"
          className="aspect-[4/1] w-full rounded-t-lg object-cover"
        />
      ) : null}
      <CardHeader className="gap-2">
        <CommunityMark
          name={card.name}
          logoUrl={card.logoUrl}
          className="size-12 rounded-lg text-lg"
        />
        <CardTitle as="h1">You&apos;re invited to {card.name}</CardTitle>
        <CommunityMeta privacy={card.privacy} memberCount={card.memberCount}>
          <span>{card.price ?? "Free"}</span>
        </CommunityMeta>
        {card.owner ? <p className="text-sm text-text">By {card.owner}</p> : null}
        {card.description ? <CardDescription>{card.description}</CardDescription> : null}
      </CardHeader>
    </>
  );
}

function SignedOutChoices({ token, signUp }: { token: string; signUp: boolean }) {
  return (
    <form action={startInviteJoinAction.bind(null, token)} className="flex flex-col gap-3">
      {signUp ? (
        <Button type="submit" name="via" value="sign-up" className="min-h-11">
          Create account and join
        </Button>
      ) : null}
      <Button
        type="submit"
        name="via"
        value="sign-in"
        variant={signUp ? "secondary" : "primary"}
        className="min-h-11"
      >
        {signUp ? "I already have an account" : "Sign in to join"}
      </Button>
    </form>
  );
}

export default async function JoinInvitePage({ params, searchParams }: PageProps<"/join/[token]">) {
  const [{ token }, query, session, invite, jar] = await Promise.all([
    params,
    searchParams,
    currentSession(),
    params.then(({ token: value }) => loadInvite(value)),
    cookies(),
  ]);
  const autoSubmit = autoAcceptInvite({
    accept: query["accept"],
    signedIn: session !== null,
    cookie: jar.get(joinIntentCookie)?.value,
    token,
  });

  return (
    <div className="min-h-screen bg-bg">
      <PlatformBar />
      <main id="content" className="mx-auto flex max-w-md flex-col px-4 py-12">
        <Card className="overflow-hidden">
          {invite.card ? (
            <InvitedCommunity card={invite.card} />
          ) : (
            <CardHeader>
              <CardTitle as="h1">This invite link doesn&apos;t work</CardTitle>
              <CardDescription>{invite.problem}</CardDescription>
            </CardHeader>
          )}
          <CardContent>
            {!invite.card ? (
              <Link href="/" className={linkClassName}>
                Go to my communities
              </Link>
            ) : session ? (
              <JoinInviteForm token={token} autoSubmit={autoSubmit} />
            ) : (
              <SignedOutChoices
                token={token}
                signUp={signUpOfferedFor(getPlatformConfig().signUpMode, inviteAcceptPath(token))}
              />
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
