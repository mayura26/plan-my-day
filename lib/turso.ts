import { AsyncLocalStorage } from "node:async_hooks";
import { createClient, type InArgs, type InStatement, type Transaction } from "@libsql/client";
import { executeTransactionStatement } from "@/lib/transaction-execute";

const url = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;

if (!url) {
  throw new Error("TURSO_DATABASE_URL environment variable is required");
}

if (!authToken) {
  throw new Error("TURSO_AUTH_TOKEN environment variable is required");
}

const turso = createClient({
  url,
  authToken,
});

const transactionContext = new AsyncLocalStorage<Transaction>();

// Route handlers and their helpers share the same atomic scheduling operation.
export const db = new Proxy(turso, {
  get(target, property) {
    const transaction = transactionContext.getStore();
    if (property === "execute" && transaction) {
      return (statement: InStatement, args?: InArgs) =>
        executeTransactionStatement(transaction, statement, args);
    }
    const owner = property === "execute" || property === "batch" ? (transaction ?? target) : target;
    const value = Reflect.get(owner, property);
    return typeof value === "function" ? value.bind(owner) : value;
  },
});

export async function withTaskTransaction<T>(work: () => Promise<T>): Promise<T> {
  const transaction = await turso.transaction("write");
  try {
    const result = await transactionContext.run(transaction, work);
    await transaction.commit();
    return result;
  } catch (error) {
    await transaction.rollback();
    throw error;
  } finally {
    transaction.close();
  }
}
