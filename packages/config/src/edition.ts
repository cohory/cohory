export const editions = ["community", "cloud"] as const;

export type Edition = (typeof editions)[number];
