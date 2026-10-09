import type { InArgs, InStatement, Transaction } from "@libsql/client";

/** Remote transactions accept one statement object, unlike Client.execute(sql, args). */
export function executeTransactionStatement(
  transaction: Pick<Transaction, "execute">,
  statement: InStatement,
  args?: InArgs
) {
  return transaction.execute(
    typeof statement === "string" ? { sql: statement, args: args ?? [] } : statement
  );
}
