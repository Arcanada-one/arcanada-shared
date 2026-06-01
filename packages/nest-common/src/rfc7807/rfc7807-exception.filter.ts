import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
} from "@nestjs/common";
import { ZodError } from "zod";
import { ProblemException } from "./problem-exception.js";
import {
  PROBLEM_TITLES,
  problemTypeUri,
  type ProblemCode,
  type ProblemDetails,
} from "./problem-details.types.js";

/**
 * Configuration for {@link Rfc7807ExceptionFilter}.
 *
 * `baseUri` is the consumer's problem `type` namespace (no trailing slash).
 * `mapException` is an optional first-match hook: it lets a consumer map
 * library-specific exceptions (e.g. an OIDC provider's error classes) without
 * the package depending on those libraries. Return a `ProblemDetails` to handle
 * the exception, or `null` to fall through to the built-in chain.
 */
export interface Rfc7807Config {
  baseUri: string;
  mapException?: (exception: unknown) => ProblemDetails | null;
}

/**
 * Global exception filter that renders every error as RFC 7807
 * `application/problem+json`. Server-class (`5xx`) responses omit `detail` to
 * avoid information disclosure; the original error is left for the consumer's
 * logger. Assumes a Fastify reply (`code`/`header`/`send`).
 */
@Catch()
export class Rfc7807ExceptionFilter implements ExceptionFilter {
  constructor(private readonly cfg: Rfc7807Config) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<{ id?: string; url?: string }>();
    const reply = ctx.getResponse<FastifyReplyLike>();

    const traceId = typeof request.id === "string" ? request.id : undefined;
    const instance = request.url?.split("?")[0] ?? "/";
    const problem =
      this.cfg.mapException?.(exception) ??
      this.toProblem(exception, instance, traceId);

    void reply
      .code(problem.status)
      .header("Content-Type", "application/problem+json")
      .send(problem);
  }

  private toProblem(
    exception: unknown,
    instance: string,
    traceId: string | undefined,
  ): ProblemDetails {
    if (exception instanceof ProblemException) {
      const body = exception.getResponse() as Record<string, unknown>;
      return this.build(
        body["code"] as ProblemCode,
        exception.getStatus(),
        instance,
        traceId,
        body["detail"] as string | undefined,
      );
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const code: ProblemCode =
        status === 429 ? "rate_limited" : "invalid_request";
      return this.build(code, status, instance, traceId, httpDetail(exception));
    }
    if (exception instanceof ZodError) {
      return this.build(
        "invalid_request",
        400,
        instance,
        traceId,
        exception.issues[0]?.message,
      );
    }
    return this.build("internal_error", 500, instance, traceId, undefined);
  }

  private build(
    code: ProblemCode,
    status: number,
    instance: string,
    traceId: string | undefined,
    detail: string | undefined,
  ): ProblemDetails {
    const title = PROBLEM_TITLES[code]?.title ?? code;
    return {
      type: problemTypeUri(this.cfg.baseUri, code),
      title,
      status,
      code,
      ...(detail !== undefined && status < 500 ? { detail } : {}),
      instance,
      ...(traceId !== undefined ? { trace_id: traceId } : {}),
    };
  }
}

interface FastifyReplyLike {
  code(status: number): FastifyReplyLike;
  header(name: string, value: string): FastifyReplyLike;
  send(body: unknown): FastifyReplyLike;
}

function httpDetail(exception: HttpException): string | undefined {
  const body = exception.getResponse();
  if (typeof body === "string") return body;
  const message = (body as Record<string, unknown>)["message"];
  return typeof message === "string" ? message : undefined;
}
