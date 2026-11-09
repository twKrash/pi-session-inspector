/**
 * The child-file reader asks the kernel where an open descriptor lives
 * (`/proc/self/fd`) and fails closed without it (ADR 0028), so a test that
 * expects a successful read can only pass on Linux.
 */
export const needsProcfs = {
  skip:
    process.platform === "linux"
      ? false
      : "needs Linux procfs for descriptor verification (ADR 0028)",
};
