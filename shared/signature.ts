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

// SVG icons as data URIs — render in email clients that support them (Gmail, Apple Mail, Outlook web)
const ICONS = {
  phone: `<img src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23888' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.07 10.8 19.79 19.79 0 010 2.18 2 2 0 012 0h3a2 2 0 012 1.72 12.84 12.84 0 00.7 2.81 2 2 0 01-.45 2.11L6.09 7.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45 12.84 12.84 0 002.81.7A2 2 0 0122 14.92z'/%3E%3C/svg%3E" width="12" height="12" style="display:inline-block;vertical-align:middle;margin-right:5px" alt="">`,
  email: `<img src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23888' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z'/%3E%3Cpolyline points='22,6 12,13 2,6'/%3E%3C/svg%3E" width="12" height="12" style="display:inline-block;vertical-align:middle;margin-right:5px" alt="">`,
  web: `<img src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23888' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Ccircle cx='12' cy='12' r='10'/%3E%3Cline x1='2' y1='12' x2='22' y2='12'/%3E%3Cpath d='M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z'/%3E%3C/svg%3E" width="12" height="12" style="display:inline-block;vertical-align:middle;margin-right:5px" alt="">`,
  linkedin: `<img src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='%23888'%3E%3Cpath d='M16 8a6 6 0 016 6v7h-4v-7a2 2 0 00-2-2 2 2 0 00-2 2v7h-4v-7a6 6 0 016-6zM2 9h4v12H2z'/%3E%3Ccircle cx='4' cy='4' r='2' fill='%23888'/%3E%3C/svg%3E" width="12" height="12" style="display:inline-block;vertical-align:middle;margin-right:5px" alt="">`,
};

export function buildSignatureHtml(fields: SignatureFields, avatarUrl?: string): string {
  // Avatar cell
  const avatarCell = avatarUrl
    ? `<td style="padding-right:16px;vertical-align:top;padding-top:2px">
        <img src="${esc(avatarUrl)}" width="48" height="48"
          style="border-radius:50%;object-fit:cover;display:block;border:2px solid #e2e8f0"
          alt="${esc(fields.name)}">
       </td>`
    : "";

  // Name + identity block
  const titleParts = [fields.title, fields.company].filter(Boolean).join(" · ");
  const identityHtml = [
    `<div style="font-size:15px;font-weight:700;color:#0f172a;letter-spacing:-0.01em;line-height:1.2">${esc(fields.name)}</div>`,
    titleParts
      ? `<div style="font-size:12px;color:#64748b;margin-top:3px;font-weight:500">${esc(titleParts)}</div>`
      : "",
    fields.tagline
      ? `<div style="font-size:11px;color:#94a3b8;font-style:italic;margin-top:2px">${esc(fields.tagline)}</div>`
      : "",
  ].filter(Boolean).join("");

  // Contact rows
  const contactItems: string[] = [];
  if (fields.phone)
    contactItems.push(
      `<span style="white-space:nowrap">${ICONS.phone}<a href="tel:${esc(fields.phone)}" style="color:#475569;text-decoration:none;font-size:11px">${esc(fields.phone)}</a></span>`,
    );
  if (fields.email)
    contactItems.push(
      `<span style="white-space:nowrap">${ICONS.email}<a href="mailto:${esc(fields.email)}" style="color:#475569;text-decoration:none;font-size:11px">${esc(fields.email)}</a></span>`,
    );
  if (fields.website)
    contactItems.push(
      `<span style="white-space:nowrap">${ICONS.web}<a href="${esc(fields.website)}" style="color:#475569;text-decoration:none;font-size:11px">${esc(fields.website.replace(/^https?:\/\//, ""))}</a></span>`,
    );
  if (fields.linkedIn)
    contactItems.push(
      `<span style="white-space:nowrap">${ICONS.linkedin}<a href="${esc(fields.linkedIn)}" style="color:#475569;text-decoration:none;font-size:11px">LinkedIn</a></span>`,
    );

  const contactHtml =
    contactItems.length > 0
      ? `<div style="margin-top:7px;display:flex;flex-wrap:wrap;gap:10px;align-items:center">${contactItems.join('<span style="color:#cbd5e1;font-size:10px;margin:0 2px">|</span>')}</div>`
      : "";

  const infoCell = `<td style="vertical-align:top">
    ${identityHtml}
    ${contactHtml}
  </td>`;

  return `<table cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;margin-top:20px">
  <tr>
    <td style="padding-bottom:12px" colspan="3">
      <div style="height:1px;background:linear-gradient(to right,#e2e8f0,transparent)"></div>
    </td>
  </tr>
  <tr>
    <td style="width:3px;background:#3b82f6;border-radius:2px;padding-right:14px" rowspan="2">&nbsp;</td>
    <td style="width:10px"></td>
    <td>
      <table cellpadding="0" cellspacing="0" style="border-collapse:collapse">
        <tr>
          ${avatarCell}
          ${infoCell}
        </tr>
      </table>
    </td>
  </tr>
</table>`;
}
