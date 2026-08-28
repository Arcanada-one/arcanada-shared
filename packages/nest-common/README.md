# @arcanada/nest-common

Shared NestJS building blocks for the Arcanada ecosystem, extracted from real
duplication across the ecosystem's backends. Three groups of primitives:

- **`ZodValidationPipe`** — validates a payload against a Zod schema and throws
  the canonical validation-error shape.
- **RFC 7807 problem-details** — `Rfc7807ExceptionFilter`, `ProblemException`,
  `ProblemDetails`, `PROBLEM_TITLES`, `problemTypeUri`.
- **Bearer-token guard primitives** — `extractBearer` and `AbstractApiKeyGuard`.

Framework deps (`@nestjs/common`, `zod`) are **peer** dependencies, never
bundled.

## Install

```bash
pnpm add @arcanada/nest-common
```

### pnpm `injected: true` is required

NestJS resolves dependency-injection tokens by reference identity. Under pnpm's
default symlinked layout, a shared NestJS package can pull in a **second copy**
of `@nestjs/core`, so the consumer's DI container and the package see different
`@nestjs/*` instances — NestJS then fails to wire providers. Declare the package
as injected so pnpm hard-links it into the consumer's own dependency tree:

```yaml
# pnpm-workspace.yaml (or the consumer's package.json "pnpm" field)
dependenciesMeta:
  "@arcanada/nest-common":
    injected: true
```

## Usage

### ZodValidationPipe

```ts
import { ZodValidationPipe } from "@arcanada/nest-common";
import { z } from "zod";

const schema = z.object({ email: z.string().email() });

@Post()
create(@Body(new ZodValidationPipe(schema)) body: z.infer<typeof schema>) { ... }
```

### Rfc7807ExceptionFilter

The base URI and any framework-specific exception mapping are supplied by the
consumer — the package carries no project domain and no `oidc-provider`
dependency:

```ts
import { Rfc7807ExceptionFilter } from "@arcanada/nest-common";

app.useGlobalFilters(
  new Rfc7807ExceptionFilter({
    baseUri: "https://auth.arcanada.one/errors",
    // optional: map library-specific errors (e.g. panva oidc-provider) first
    mapException: (e) => mapOidcProviderError(e),
  }),
);
```

Server-class (`5xx`) responses omit `detail` to avoid information disclosure;
log the original error in the consumer's logger.

### AbstractApiKeyGuard

```ts
import { AbstractApiKeyGuard } from "@arcanada/nest-common";

@Injectable()
export class MyGuard extends AbstractApiKeyGuard {
  constructor(private readonly keys: KeyService) {
    super();
  }
  // resolve a principal id, or null to reject with 401
  protected verifyKey(token: string): Promise<string | null> {
    return this.keys.resolve(token);
  }
}
```

## Migration — canonical validation-error shape

`ZodValidationPipe` emits one canonical shape:

```json
{
  "message": "Validation failed",
  "issues": [
    {
      "path": "user.email",
      "message": "Invalid email address",
      "code": "invalid_format"
    }
  ]
}
```

Before extraction the ecosystem carried three divergent shapes. Adopting this
package is a **breaking change** for the response body of consumers that relied
on the older shapes:

| Source shape (before)                                         | Now                     |
| ------------------------------------------------------------- | ----------------------- |
| `{ message, errors: string[] }`                               | `{ message, issues[] }` |
| `{ error: "validation_error", details: [{ path, message }] }` | `{ message, issues[] }` |

Clients parsing the validation error body must be updated to read
`issues[].{path,message,code}`. Services fronted by `Rfc7807ExceptionFilter`
already re-render the `BadRequestException` as `application/problem+json`, so the
filter path is unaffected.

### `code` values track the Zod major

`issues[].code` is Zod's own issue code, so it is only stable within a Zod
major. This package requires `zod >= 4`; the peer range is deliberately not
`>= 3`, because the same published version would otherwise emit two different
contracts depending on which Zod a consumer resolved. Zod 4 renamed several
codes relative to Zod 3:

| Validation                         | Zod 3 (`code`)       | Zod 4 (`code`)   |
| ---------------------------------- | -------------------- | ---------------- |
| `email` / `url` / `uuid` / `regex` | `invalid_string`     | `invalid_format` |
| `enum`                             | `invalid_enum_value` | `invalid_value`  |
| `literal`                          | `invalid_literal`    | `invalid_value`  |

`invalid_type`, `unrecognized_keys`, `too_small`, `too_big` and `invalid_union`
are unchanged. The human-readable `message` strings were also reworded in Zod 4
and are not a stable interface — branch on `code`, never on `message`. The codes
above are pinned by `test/zod-validation.pipe.test.ts`, so a future Zod rename
fails the suite instead of silently changing the contract.

## License

MIT
