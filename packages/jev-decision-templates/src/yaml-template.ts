import { TextDecoder } from "node:util";
import { isAlias, isMap, isScalar, isSeq, parseAllDocuments } from "yaml";

const MAX_BYTES = 65532;
const MAX_DEPTH = 16;
const byteLength = Object.getOwnPropertyDescriptor(
  Object.getPrototypeOf(Uint8Array.prototype),
  "byteLength",
)!.get!;

/** A bounded YAML 1.2 subset. Native diagnostics never escape this boundary. */
export function parseTemplateYaml(raw: Uint8Array): unknown {
  try {
    if (!(raw instanceof Uint8Array)) throw new Error();
    const size = byteLength.call(raw) as number;
    if (size < 1 || size > MAX_BYTES) throw new Error();
    const text = new TextDecoder("utf-8", {
      fatal: true,
      ignoreBOM: true,
    }).decode(new Uint8Array(raw));
    if (text.startsWith("\uFEFF") || /^%/m.test(text)) throw new Error();
    const documents = parseAllDocuments(text, {
      version: "1.2",
      schema: "core",
      uniqueKeys: true,
      // Preserve scalar types; stringKeys:true coerces numeric keys to strings.
      // The AST check below requires genuinely string-valued keys.
      stringKeys: false,
      strict: true,
      prettyErrors: false,
    });
    if (documents.length !== 1) throw new Error();
    const document = documents[0]!;
    if (document.errors.length || document.warnings.length) throw new Error();
    checkNode(document.contents, 0);
    return document.toJS({ maxAliasCount: 0 });
  } catch {
    throw new SyntaxError("Invalid bounded template YAML");
  }
}

function checkNode(node: unknown, depth: number): void {
  if (depth > MAX_DEPTH || isAlias(node) || node === null) throw new Error();
  if (isMap(node)) {
    if (node.tag || node.anchor) throw new Error();
    const keys = new Set<string>();
    for (const pair of node.items) {
      if (
        !isScalar(pair.key) ||
        pair.key.tag ||
        pair.key.anchor ||
        typeof pair.key.value !== "string"
      )
        throw new Error();
      if (pair.key.value === "<<" || keys.has(pair.key.value))
        throw new Error();
      keys.add(pair.key.value);
      checkNode(pair.value, depth + 1);
    }
    return;
  }
  if (isSeq(node)) {
    if (node.tag || node.anchor) throw new Error();
    for (const item of node.items) checkNode(item, depth + 1);
    return;
  }
  if (!isScalar(node) || node.tag || node.anchor) throw new Error();
  const value: unknown = node.value;
  if (typeof value === "number" && !Number.isFinite(value)) throw new Error();
  if (
    typeof value === "string" &&
    /[\uD800-\uDFFF]/u.test(
      value.replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, ""),
    )
  )
    throw new Error();
}
