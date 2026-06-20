/**
 * FieldOS Dashboard — Database client
 *
 * The dashboard communicates with the FastAPI backend via HTTP API.
 * No direct database connection is needed for pilot phase.
 */

export const db = {
  /** Placeholder for future Prisma integration */
  $queryRaw: async <T extends unknown[]>(_query: TemplateStringsArray, ..._params: unknown[]): Promise<T> => {
    throw new Error('Direct DB queries not available. Use API endpoints instead.');
  },
} as unknown as never;