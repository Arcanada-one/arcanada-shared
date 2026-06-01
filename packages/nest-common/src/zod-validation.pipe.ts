import { BadRequestException, PipeTransform } from "@nestjs/common";
import type { ZodTypeAny, infer as ZodInfer } from "zod";

/**
 * Canonical NestJS pipe that validates a payload against a Zod schema.
 *
 * On failure it throws `BadRequestException` carrying the ecosystem-canonical
 * error shape:
 *
 * ```json
 * {
 *   "message": "Validation failed",
 *   "issues": [{ "path": "user.email", "message": "Expected string", "code": "invalid_type" }]
 * }
 * ```
 *
 * Nested paths are dot-joined; a root-level issue is labelled `(root)`. Every
 * issue carries the Zod `code`. This unifies three previously divergent shapes
 * across the ecosystem — see the package README § Migration.
 */
export class ZodValidationPipe<T extends ZodTypeAny> implements PipeTransform<
  unknown,
  ZodInfer<T>
> {
  constructor(private readonly schema: T) {}

  transform(value: unknown): ZodInfer<T> {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException({
        message: "Validation failed",
        issues: result.error.issues.map((issue) => ({
          path: issue.path.join(".") || "(root)",
          message: issue.message,
          code: issue.code,
        })),
      });
    }
    return result.data;
  }
}
