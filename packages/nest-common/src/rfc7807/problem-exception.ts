import { HttpException } from "@nestjs/common";
import {
  PROBLEM_TITLES,
  problemTypeUri,
  type ProblemCode,
} from "./problem-details.types.js";

/**
 * Throwable RFC 7807 error.
 *
 * Throw this (instead of a bare `HttpException`) when an endpoint participates
 * in the problem-details contract; {@link Rfc7807ExceptionFilter} recognises it
 * and passes it through. The base URI is supplied per throw so the package
 * stays domain-agnostic — consumers typically wrap this in a project-local
 * factory that closes over their own base URI.
 */
export class ProblemException extends HttpException {
  readonly code: ProblemCode;
  readonly detail: string | undefined;

  constructor(baseUri: string, code: ProblemCode, detail?: string) {
    const entry = PROBLEM_TITLES[code];
    super(
      {
        type: problemTypeUri(baseUri, code),
        title: entry.title,
        status: entry.status,
        code,
        ...(detail !== undefined ? { detail } : {}),
      },
      entry.status,
    );
    this.code = code;
    this.detail = detail;
  }
}
