import { Ajv2020 } from "ajv/dist/2020.js";
import addFormatsModule from "ajv-formats";
import schema from "./observation.schema.json" with { type: "json" };
import {
  LOSSLESS_DECIMAL_EXTENSION,
  PROFILE_ID,
  type ObservationRecord,
  type RecordType,
} from "./types.js";

export type DecodeFailureCode =
  | "MALFORMED_JSON"
  | "NOT_AN_OBJECT"
  | "UNSUPPORTED_PROFILE"
  | "UNSUPPORTED_RECORD_KIND"
  | "UNSUPPORTED_REQUIRED_EXTENSION"
  | "SCHEMA_INVALID";

export type DecodeResult =
  | { readonly ok: true; readonly record: ObservationRecord }
  | {
      readonly ok: false;
      readonly code: DecodeFailureCode;
      readonly detail: string;
    };

export interface DecodeOptions {
  /** Required extensions the consumer has negotiated. Default: the lossless decimal counter extension. */
  readonly supportedExtensions?: readonly string[];
}

const KNOWN_KINDS: readonly RecordType[] = [
  "run",
  "event",
  "snapshot",
  "attempt",
  "artifact",
  "command",
  "deployment",
];

type FormatsPlugin = (ajv: Ajv2020) => Ajv2020;
const addFormats = ((addFormatsModule as unknown as { default?: FormatsPlugin })
  .default ?? (addFormatsModule as unknown as FormatsPlugin)) as FormatsPlugin;

const ajv = new Ajv2020({ strict: false, allErrors: false });
// ajv-formats supplies the RFC3339 date-time checker the package author's environment lacked.
addFormats(ajv);
const validate = ajv.compile(schema);

/**
 * Strictly decode one observation record. Unknown schema versions, unsupported record kinds and unsupported required
 * extensions fail explicitly; nothing is skipped silently and no record is coerced.
 */
export function decodeObservationRecord(
  input: unknown,
  options: DecodeOptions = {},
): DecodeResult {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return {
      ok: false,
      code: "NOT_AN_OBJECT",
      detail: "record must be a JSON object",
    };
  }
  const obj = input as Record<string, unknown>;
  if (typeof obj["profile"] !== "string") {
    return {
      ok: false,
      code: "SCHEMA_INVALID",
      detail: "profile is missing or not a string",
    };
  }
  if (obj["profile"] !== PROFILE_ID) {
    return {
      ok: false,
      code: "UNSUPPORTED_PROFILE",
      detail: `unsupported profile ${JSON.stringify(obj["profile"])}`,
    };
  }
  const supported = options.supportedExtensions ?? [LOSSLESS_DECIMAL_EXTENSION];
  const exts = obj["required_extensions"];
  if (!Array.isArray(exts)) {
    return {
      ok: false,
      code: "SCHEMA_INVALID",
      detail: "required_extensions must be an array",
    };
  }
  for (const ext of exts) {
    if (typeof ext !== "string" || !supported.includes(ext)) {
      return {
        ok: false,
        code: "UNSUPPORTED_REQUIRED_EXTENSION",
        detail: `required extension ${JSON.stringify(ext)} is not negotiated`,
      };
    }
  }
  if (!KNOWN_KINDS.includes(obj["record_type"] as RecordType)) {
    return {
      ok: false,
      code: "UNSUPPORTED_RECORD_KIND",
      detail: "record_type is not a supported kind",
    };
  }
  if (!validate(input)) {
    const first = validate.errors?.[0];
    return {
      ok: false,
      code: "SCHEMA_INVALID",
      detail: first
        ? `${first.instancePath || "/"} ${first.message ?? "invalid"}`
        : "schema validation failed",
    };
  }
  return { ok: true, record: input as unknown as ObservationRecord };
}

/** Decode a JSON text. JSON numbers at decimal-string fields fail schema validation instead of being rounded. */
export function decodeObservationJson(
  text: string,
  options: DecodeOptions = {},
): DecodeResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return {
      ok: false,
      code: "MALFORMED_JSON",
      detail: error instanceof Error ? error.message : "invalid JSON",
    };
  }
  return decodeObservationRecord(parsed, options);
}
