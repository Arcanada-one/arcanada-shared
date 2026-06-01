import {
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from "@nestjs/common";
import { extractBearer } from "./extract-bearer.js";

/**
 * Template-method API-key guard.
 *
 * Handles the parts shared across the ecosystem's Bearer-token guards:
 * extracting the token from the `Authorization` header and failing closed with
 * `401` when it is missing or rejected. Subclasses implement {@link verifyKey},
 * which resolves a principal identifier (e.g. agent name, API-key id) on
 * success or `null` to reject. Attaching the principal to the request — the
 * field name is project-specific — is the subclass's responsibility, done
 * inside `verifyKey` or an override.
 *
 * Framework-neutral: it reads only `req.headers.authorization`, so it works
 * under both Fastify and Express request shapes.
 */
export abstract class AbstractApiKeyGuard implements CanActivate {
  protected abstract verifyKey(token: string): Promise<string | null>;

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context
      .switchToHttp()
      .getRequest<{ headers?: { authorization?: string } }>();
    const token = extractBearer(req.headers?.authorization);
    if (!token) {
      throw new UnauthorizedException({ error: "invalid_api_key" });
    }
    const principal = await this.verifyKey(token);
    if (!principal) {
      throw new UnauthorizedException({ error: "invalid_api_key" });
    }
    return true;
  }
}
