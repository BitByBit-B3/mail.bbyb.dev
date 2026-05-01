import { renderToStaticMarkup } from "react-dom/server";
import { EmailSignature, type SignatureFields } from "./EmailSignature";

export type { SignatureFields };

export function buildSignatureHtml(fields: SignatureFields, _avatarUrl?: string): string {
  return renderToStaticMarkup(EmailSignature(fields));
}
