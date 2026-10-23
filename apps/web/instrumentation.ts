export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") {
    return;
  }
  const { emailConfigProblem } = await import("@cohory/email");
  const { logger } = await import("@cohory/infra/logger");
  const problem = emailConfigProblem();
  if (problem) {
    logger.error(problem);
  }
}
