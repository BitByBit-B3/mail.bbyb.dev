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
  "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";

const ACCENT = "#2563eb"; // indigo-600
const TEXT = "#0f172a"; // slate-900
const MUTED = "#475569"; // slate-600
const SUBTLE = "#94a3b8"; // slate-400
const RULE = "#e2e8f0"; // slate-200

// 14×14 phosphor-fill icons, slate-500 (#64748b)
const ICON = {
  phone: `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 256 256'%3E%3Cpath fill='%2364748b' d='M222.37 158.46l-47.11-21.11a16 16 0 0 0-18.59 4.64l-22.05 25.75c-28.35-14.42-52.38-38.46-66.79-66.79l25.75-22a16 16 0 0 0 4.63-18.6L77.08 33.63a16 16 0 0 0-18.38-9.29L22.83 33.37A16 16 0 0 0 8 49c0 109.94 89.06 199 199 199a16 16 0 0 0 15.62-14.84l9.16-35.92a16 16 0 0 0-9.41-18.78Z'/%3E%3C/svg%3E`,
  email: `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 256 256'%3E%3Cpath fill='%2364748b' d='M224 48H32a8 8 0 0 0-8 8v136a16 16 0 0 0 16 16h176a16 16 0 0 0 16-16V56a8 8 0 0 0-8-8Zm-20.57 16L128 133.15 52.57 64ZM216 192H40V75.08l82.31 73.65a8 8 0 0 0 10.67 0L216 75.08Z'/%3E%3C/svg%3E`,
  web: `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 256 256'%3E%3Cpath fill='%2364748b' d='M128 24a104 104 0 1 0 104 104A104.11 104.11 0 0 0 128 24Zm77.73 96h-34.67c-1.25-30.06-10.86-58.37-27.21-80a88.13 88.13 0 0 1 61.88 80Zm-91.2-81.7C131.07 56.32 155.93 83 157.93 120H98.07c2-37 26.86-63.68 14.46-81.7ZM40.27 120a88.13 88.13 0 0 1 61.88-80c-16.35 21.63-26 49.94-27.21 80Zm0 16h34.67c1.25 30.06 10.86 58.37 27.21 80a88.13 88.13 0 0 1-61.88-80Zm91.2 81.7c-12.6-17.38-27.46-44.1-29.4-81.7h59.86c-2 37.6-16.86 64.32-30.46 81.7Zm40.67-1.7c16.35-21.63 26-49.94 27.21-80h34.67a88.13 88.13 0 0 1-61.88 80Z'/%3E%3C/svg%3E`,
  linkedin: `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 256 256'%3E%3Cpath fill='%2364748b' d='M216 24H40a16 16 0 0 0-16 16v176a16 16 0 0 0 16 16h176a16 16 0 0 0 16-16V40a16 16 0 0 0-16-16ZM96 176a8 8 0 0 1-16 0v-64a8 8 0 0 1 16 0Zm-8-84a12 12 0 1 1 12-12 12 12 0 0 1-12 12Zm96 84a8 8 0 0 1-16 0v-36a20 20 0 0 0-40 0v36a8 8 0 0 1-16 0v-64a8 8 0 0 1 15.79-1.78A36 36 0 0 1 184 140Z'/%3E%3C/svg%3E`,
};

function iconImg(src: string): string {
  return `<img src="${src}" width="14" height="14" style="display:block;border:0" alt="">`;
}

interface ContactRow {
  icon: string;
  href: string;
  label: string;
}

function contactCell(row: ContactRow): string {
  return `<table cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse"><tr>
    <td style="padding:0 8px 0 0;vertical-align:middle;line-height:0">${iconImg(row.icon)}</td>
    <td style="vertical-align:middle;font-family:${FONT}">
      <a href="${esc(row.href)}" style="font-size:12px;color:${ACCENT};text-decoration:none;font-weight:500;line-height:1.4;letter-spacing:-0.005em">${esc(row.label)}</a>
    </td>
  </tr></table>`;
}

function contactGrid(rows: ContactRow[]): string {
  if (rows.length === 0) return "";
  // Pair rows into 2-column layout for compactness; render single column if odd.
  const pairs: Array<[ContactRow, ContactRow | null]> = [];
  for (let i = 0; i < rows.length; i += 2) {
    pairs.push([rows[i], rows[i + 1] ?? null]);
  }
  return `<table cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;margin-top:14px">
    ${pairs.map(([a, b]) => `<tr>
      <td style="padding:4px 24px 4px 0;vertical-align:middle">${contactCell(a)}</td>
      <td style="padding:4px 0;vertical-align:middle">${b ? contactCell(b) : "&nbsp;"}</td>
    </tr>`).join("")}
  </table>`;
}

export function buildSignatureHtml(fields: SignatureFields, _avatarUrl?: string): string {
  const titleLine = [fields.title, fields.company]
    .filter(Boolean)
    .join(' <span style="color:' + SUBTLE + '">·</span> ');

  const rows: ContactRow[] = [];
  if (fields.email) rows.push({ icon: ICON.email, href: `mailto:${fields.email}`, label: fields.email });
  if (fields.phone) rows.push({ icon: ICON.phone, href: `tel:${fields.phone}`, label: fields.phone });
  if (fields.website) rows.push({ icon: ICON.web, href: fields.website, label: fields.website.replace(/^https?:\/\//, "") });
  if (fields.linkedIn) rows.push({ icon: ICON.linkedin, href: fields.linkedIn, label: "LinkedIn" });

  return `<table cellpadding="0" cellspacing="0" border="0" role="presentation" style="border-collapse:collapse;margin-top:32px;font-family:${FONT};max-width:520px">
  <!-- subtle top hairline -->
  <tr><td colspan="2" style="padding:0 0 22px 0">
    <table cellpadding="0" cellspacing="0" border="0" width="100%"><tr>
      <td height="1" bgcolor="${RULE}" style="font-size:0;line-height:0">&nbsp;</td>
    </tr></table>
  </td></tr>

  <tr>
    <!-- B3 monogram tile -->
    <td valign="top" style="padding:0 18px 0 0;width:64px">
      <table cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;border-radius:10px;background:${TEXT}">
        <tr><td align="center" valign="middle" width="56" height="56" style="width:56px;height:56px;color:#ffffff;font-family:${FONT};font-weight:900;font-size:22px;letter-spacing:-0.04em;line-height:1">B3</td></tr>
      </table>
      <table cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;margin-top:8px"><tr>
        <td align="center" width="56" style="font-family:${FONT};font-size:9px;color:${SUBTLE};letter-spacing:0.18em;text-transform:uppercase;font-weight:700">BitByBit</td>
      </tr></table>
    </td>

    <!-- identity + contacts -->
    <td valign="top" style="border-left:3px solid ${ACCENT};padding:2px 0 2px 20px">
      <div style="font-family:${FONT};font-size:18px;font-weight:800;color:${TEXT};letter-spacing:-0.025em;line-height:1.1">${esc(fields.name || "")}</div>
      ${titleLine ? `<div style="font-family:${FONT};font-size:12.5px;color:${MUTED};font-weight:500;margin-top:5px;line-height:1.4;letter-spacing:-0.005em">${titleLine}</div>` : ""}
      ${fields.tagline ? `<div style="font-family:${FONT};font-size:11.5px;color:${SUBTLE};font-style:italic;margin-top:6px;line-height:1.5">${esc(fields.tagline)}</div>` : ""}
      ${contactGrid(rows)}
    </td>
  </tr>

  <!-- footer microline -->
  <tr><td colspan="2" style="padding:18px 0 0 0">
    <table cellpadding="0" cellspacing="0" border="0" width="100%"><tr>
      <td style="font-family:${FONT};font-size:10px;color:${SUBTLE};letter-spacing:0.04em;line-height:1.5">
        Sent from <span style="color:${MUTED};font-weight:600">B3 Internal Mail</span> · <a href="https://bbyb.dev" style="color:${SUBTLE};text-decoration:none">bbyb.dev</a>
      </td>
    </tr></table>
  </td></tr>
</table>`;
}
