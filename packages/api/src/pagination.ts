import { z } from "@hono/zod-openapi";

export function cursorQuery({ max = 100, example = 20 }: { max?: number; example?: number } = {}) {
  return {
    cursor: z
      .string()
      .max(512)
      .optional()
      .openapi({
        param: { name: "cursor", in: "query" },
        description: "The nextCursor of the previous page. Leave it out for the first page.",
      }),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(max)
      .optional()
      .openapi({
        param: { name: "limit", in: "query" },
        description: `How many items to return, at most ${max}.`,
        example,
      }),
  };
}

export const pageCursor = {
  nextCursor: z.string().nullable().openapi({
    description:
      "Pass it as cursor to get the next page. null when there are no more items, and always null on lists that fit in one page.",
  }),
};

export function cursorPage<T extends z.ZodType>(schema: T) {
  return z.object({ data: z.array(schema), ...pageCursor });
}
