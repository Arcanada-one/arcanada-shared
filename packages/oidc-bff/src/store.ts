/** Store implementations must be server-only, bounded, durable, and protect tokens at rest. */
export interface LoginTransaction {
  state: string;
  browserHash: string;
  verifier: string;
  nonce: string;
  returnPath: string;
  expiresAt: number;
}
export interface IdentitySession {
  subject: string;
  accessToken: string;
  expiresAt: number;
}
export interface SessionStore {
  putTransaction(transaction: LoginTransaction): Promise<void>;
  /** Atomic one-use consume: wrong browser or expired transaction MUST return null. */
  consumeTransaction(
    state: string,
    browserHash: string,
    now: number,
  ): Promise<LoginTransaction | null>;
  /** Atomic finalization: consumed transaction must remain current, unexpired and not cancelled.
   * Mark it completed, invalidate previousId, and insert newId together; return false on conflict. */
  finishLogin(
    state: string,
    browserHash: string,
    now: number,
    previousId: string | null,
    newId: string,
    session: IdentitySession,
  ): Promise<boolean>;
  /** Fence pending and consumed logins for this browser, including an in-flight exchange. */
  cancelBrowserLogin(browserHash: string): Promise<void>;
  getSession(id: string, now: number): Promise<IdentitySession | null>;
  deleteSession(id: string): Promise<void>;
}
