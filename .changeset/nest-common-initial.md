---
"@arcanada/nest-common": minor
---

Initial release of `@arcanada/nest-common`: a canonical `ZodValidationPipe`
(unified `issues[]` error shape), an RFC 7807 problem-details stack
(`Rfc7807ExceptionFilter` with a parameterised base URI and an optional
exception-mapping hook, `ProblemException`, `PROBLEM_TITLES`), and Bearer-token
guard primitives (`extractBearer`, `AbstractApiKeyGuard`). Framework
dependencies are peer-only.
