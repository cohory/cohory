import { customType, timestamp, uuid } from "drizzle-orm/pg-core";

import { newId } from "../ids";

export const citext = customType<{ data: string }>({
  dataType() {
    return "citext";
  },
});

export const id = () => uuid("id").primaryKey().$defaultFn(newId);

export const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

export const tsvector = customType<{ data: string }>({
  dataType() {
    return "tsvector";
  },
});
