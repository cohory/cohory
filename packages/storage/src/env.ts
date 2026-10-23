import { z } from "zod";

export const defaultMaxUploadBytes = 25 * 1024 * 1024;
export const defaultUploadsRoute = "/api/uploads";

const booleanString = z
  .enum(["true", "false", "1", "0"])
  .default("false")
  .transform((value) => value === "true" || value === "1");

const emptyAsUndefined = (value: unknown) => (value === "" ? undefined : value);

const shared = {
  STORAGE_MAX_UPLOAD_BYTES: z.coerce.number().int().positive().default(defaultMaxUploadBytes),
  STORAGE_PUBLIC_BASE_URL: z.preprocess(emptyAsUndefined, z.string().min(1).optional()),
};

const localEnvSchema = z.object({
  STORAGE_DRIVER: z.literal("local"),
  STORAGE_LOCAL_PATH: z.preprocess(emptyAsUndefined, z.string().min(1).default("./data/uploads")),
  ...shared,
});

const s3EnvSchema = z
  .object({
    STORAGE_DRIVER: z.literal("s3"),
    S3_BUCKET: z.string().min(1),
    S3_REGION: z.preprocess(emptyAsUndefined, z.string().min(1).default("us-east-1")),
    S3_ENDPOINT: z.preprocess(emptyAsUndefined, z.url().optional()),
    S3_ACCESS_KEY_ID: z.preprocess(emptyAsUndefined, z.string().min(1).optional()),
    S3_SECRET_ACCESS_KEY: z.preprocess(emptyAsUndefined, z.string().min(1).optional()),
    S3_FORCE_PATH_STYLE: z.preprocess(emptyAsUndefined, booleanString),
    S3_PUBLIC_URL: z.preprocess(emptyAsUndefined, z.url().optional()),
    ...shared,
  })
  .refine(
    (env) => (env.S3_ACCESS_KEY_ID === undefined) === (env.S3_SECRET_ACCESS_KEY === undefined),
    { message: "Set both S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY, or neither." },
  );

const storageEnvSchema = z.preprocess(
  (env) =>
    typeof env === "object" && env !== null && !("STORAGE_DRIVER" in env && env.STORAGE_DRIVER)
      ? { ...env, STORAGE_DRIVER: "local" }
      : env,
  z.discriminatedUnion("STORAGE_DRIVER", [localEnvSchema, s3EnvSchema]),
);

export type StorageEnv = z.infer<typeof storageEnvSchema>;
export type LocalStorageEnv = z.infer<typeof localEnvSchema>;
export type S3StorageEnv = z.infer<typeof s3EnvSchema>;

export function parseStorageEnv(env: NodeJS.ProcessEnv = process.env): StorageEnv {
  return storageEnvSchema.parse(env);
}
