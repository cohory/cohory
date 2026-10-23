import { z } from "zod";

export const passwordMinLength = 8;
export const passwordMaxLength = 128;

const email = z
  .string()
  .trim()
  .pipe(z.email({ error: "Enter an email address, like name@example.com" }));

const newPassword = z
  .string()
  .min(passwordMinLength, { error: `Use at least ${passwordMinLength} characters.` })
  .max(passwordMaxLength, { error: `Use ${passwordMaxLength} characters or fewer.` });

export const profileNameMaxLength = 80;

export const profileNameSchema = z
  .string()
  .trim()
  .min(1, { error: "Enter your name." })
  .max(profileNameMaxLength, {
    error: `Use ${profileNameMaxLength} characters or fewer for your name.`,
  });

export const signInSchema = z.object({
  email,
  password: z.string().min(1, { error: "Enter your password." }),
});

export const signUpSchema = z.object({
  name: profileNameSchema,
  email,
  password: newPassword,
});

export const forgotPasswordSchema = z.object({ email });

export const resetPasswordSchema = z
  .object({
    password: newPassword,
    confirmPassword: z.string(),
  })
  .refine((values) => values.password === values.confirmPassword, {
    path: ["confirmPassword"],
    error: "The passwords do not match.",
  });

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, { error: "Enter your current password." }),
    password: newPassword,
    confirmPassword: z.string(),
  })
  .refine((values) => values.password === values.confirmPassword, {
    path: ["confirmPassword"],
    error: "The passwords do not match.",
  });

export type FieldErrors = Partial<Record<string, string>>;

export type FormResult<T> =
  { success: true; data: T } | { success: false; fieldErrors: FieldErrors };

export function parseForm<Schema extends z.ZodType<Record<string, unknown>>>(
  schema: Schema,
  formData: FormData,
): FormResult<z.output<Schema>> {
  const raw: Record<string, string> = {};
  for (const key of formKeys(schema)) {
    const value = formData.get(key);
    raw[key] = typeof value === "string" ? value : "";
  }

  const result = schema.safeParse(raw);
  if (result.success) {
    return { success: true, data: result.data };
  }

  const fieldErrors: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const key = issue.path[0];
    if (typeof key === "string" && fieldErrors[key] === undefined) {
      fieldErrors[key] = issue.message;
    }
  }
  return { success: false, fieldErrors };
}

function formKeys(schema: z.core.$ZodType): string[] {
  if (schema instanceof z.ZodObject) {
    return Object.keys(schema.shape);
  }
  if (schema instanceof z.ZodPipe) {
    return formKeys(schema.in);
  }
  return [];
}
