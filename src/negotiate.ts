// Content negotiation for the Vocab API. JSON-LD is the default RDF form;
// plain JSON is the fallback when the client sends */* or nothing.
export type Format = "jsonld" | "turtle" | "tbx" | "csv" | "json";

const MIME: Record<Format, string> = {
  jsonld: "application/ld+json",
  turtle: "text/turtle",
  tbx: "application/xml",
  csv: "text/csv",
  json: "application/json",
};

export function contentTypeFor(format: Format): string {
  return MIME[format];
}

/** Pick a format from an Accept header. JSON-LD wins over plain JSON. */
export function pickFormat(accept: string | null | undefined): Format {
  const header = accept ?? "";
  if (header.length === 0 || header.includes("*/*")) return "jsonld";
  const wants = (mime: string) => header.includes(mime);
  if (wants("application/ld+json")) return "jsonld";
  if (wants("text/turtle")) return "turtle";
  if (wants("application/xml") || wants("text/xml")) return "tbx";
  if (wants("text/csv")) return "csv";
  if (wants("application/json")) return "json";
  return "jsonld";
}
