export interface SignatureFields {
  name: string;
  title?: string;
  company?: string;
  tagline?: string;
  phone?: string;
  website?: string;
  email?: string;
  linkedIn?: string;
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const FONT =
  "-apple-system,BlinkMacSystemFont,'SF Pro Text','Segoe UI',Helvetica,Arial,sans-serif";

const NAME_FONT =
  "-apple-system,BlinkMacSystemFont,'SF Pro Display','Segoe UI',Helvetica,Arial,sans-serif";

// Palette — slate base + indigo accent
const INK = "#0b1220";
const TEXT = "#0f172a";
const MUTED = "#475569";
const SUBTLE = "#94a3b8";
const SOFT = "#cbd5e1";
const RULE = "#e2e8f0";
const ACCENT = "#2563eb";

interface ContactItem {
  href: string;
  label: string;
}

function inlineDot(): string {
  return `<span style="color:${SOFT};padding:0 8px;font-weight:400">·</span>`;
}

function contactInline(items: ContactItem[]): string {
  if (items.length === 0) return "";
  return `<div style="font-family:${FONT};font-size:12.5px;color:${MUTED};margin-top:14px;line-height:1.5;letter-spacing:-0.005em">
    ${items
      .map(
        (it) =>
          `<a href="${esc(it.href)}" style="color:${TEXT};text-decoration:none;font-weight:500;border-bottom:1px solid ${RULE};padding-bottom:1px">${esc(it.label)}</a>`,
      )
      .join(inlineDot())}
  </div>`;
}

export function buildSignatureHtml(fields: SignatureFields, _avatarUrl?: string): string {
  const role =
    fields.title && fields.company
      ? `${esc(fields.title)} <span style="color:${SUBTLE};font-weight:400">at</span> <span style="color:${TEXT};font-weight:600">${esc(fields.company)}</span>`
      : fields.title
        ? esc(fields.title)
        : fields.company
          ? `<span style="color:${TEXT};font-weight:600">${esc(fields.company)}</span>`
          : "";

  const items: ContactItem[] = [];
  if (fields.email) items.push({ href: `mailto:${fields.email}`, label: fields.email });
  if (fields.phone) items.push({ href: `tel:${fields.phone}`, label: fields.phone });
  if (fields.website)
    items.push({ href: fields.website, label: fields.website.replace(/^https?:\/\//, "") });
  if (fields.linkedIn) items.push({ href: fields.linkedIn, label: "LinkedIn" });

  const safeName = esc(fields.name || "");

  return `<table cellpadding="0" cellspacing="0" border="0" role="presentation" style="border-collapse:collapse;margin-top:36px;font-family:${FONT};max-width:560px">
  <!-- Top hairline -->
  <tr><td style="padding:0 0 24px 0">
    <table cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse"><tr>
      <td height="1" bgcolor="${RULE}" style="font-size:0;line-height:0">&nbsp;</td>
    </tr></table>
  </td></tr>

  <!-- Identity block -->
  <tr><td>
    <div style="font-family:${NAME_FONT};font-size:26px;font-weight:800;color:${INK};letter-spacing:-0.045em;line-height:1.05">${safeName}</div>
    ${role ? `<div style="font-family:${FONT};font-size:13.5px;color:${MUTED};font-weight:500;margin-top:6px;line-height:1.4;letter-spacing:-0.01em">${role}</div>` : ""}
    ${fields.tagline ? `<div style="font-family:${FONT};font-size:12px;color:${SUBTLE};font-style:italic;margin-top:8px;line-height:1.5;max-width:480px">${esc(fields.tagline)}</div>` : ""}
  </td></tr>

  <!-- Accent rule: short indigo bar fading into a long subtle rule -->
  <tr><td style="padding:18px 0 0 0">
    <table cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse"><tr>
      <td width="36" height="2" bgcolor="${ACCENT}" style="font-size:0;line-height:0;border-radius:2px">&nbsp;</td>
      <td width="6" height="2" style="font-size:0;line-height:0">&nbsp;</td>
      <td width="220" height="1" bgcolor="${RULE}" style="font-size:0;line-height:0">&nbsp;</td>
    </tr></table>
  </td></tr>

  <!-- Contacts inline -->
  <tr><td>${contactInline(items)}</td></tr>

  <!-- Brand microline -->
  <tr><td style="padding:22px 0 0 0">
    <div style="font-family:${NAME_FONT};font-size:10px;letter-spacing:0.22em;text-transform:uppercase;color:${SUBTLE};font-weight:700;line-height:1.4">
      <span style="color:${INK};font-weight:900;letter-spacing:-0.02em;font-size:13px;vertical-align:-1px">B3</span>
      <span style="padding:0 8px;color:${SOFT}">·</span>
      <a href="https://bbyb.dev" style="color:${MUTED};text-decoration:none;font-weight:700">BitByBit</a>
      <span style="padding:0 8px;color:${SOFT}">·</span>
      <span style="color:${SUBTLE}">Internal Mail</span>
    </div>
  </td></tr>
</table>`;
}
