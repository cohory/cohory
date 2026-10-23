import { z } from "zod";

const credentialsSchema = z.object({ email: z.string(), password: z.string() });

type Handler = (request: Request) => Promise<Response>;

export async function signUpWithSession(handler: Handler, request: Request): Promise<Response> {
  const credentials = credentialsSchema.parse(await request.clone().json());
  const signUp = await handler(request);
  if (signUp.status !== 200) {
    return signUp;
  }
  const url = new URL(request.url);
  url.pathname = url.pathname.replace(/\/sign-up\/email$/, "/sign-in/email");
  return handler(
    new Request(url, {
      method: "POST",
      headers: request.headers,
      body: JSON.stringify(credentials),
    }),
  );
}
