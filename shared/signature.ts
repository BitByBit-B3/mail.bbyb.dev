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

// Phosphor-style filled icons, URL-encoded as SVG data URIs.
// Using %23 for # so they work unquoted inside src="".
// 13×13, fill #64748b (slate-500) — neutral on any background.
const ICON = {
  phone: `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='13' height='13' viewBox='0 0 256 256'%3E%3Cpath fill='%2364748b' d='M222.37 158.46l-47.11-21.11a16 16 0 0 0-18.59 4.64l-22.05 25.75c-28.35-14.42-52.38-38.46-66.79-66.79l25.75-22a16 16 0 0 0 4.63-18.6L77.08 33.63a16 16 0 0 0-18.38-9.29L22.83 33.37A16 16 0 0 0 8 49c0 109.94 89.06 199 199 199a16 16 0 0 0 15.62-14.84l9.16-35.92a16 16 0 0 0-9.41-18.78Z'/%3E%3C/svg%3E`,
  email: `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='13' height='13' viewBox='0 0 256 256'%3E%3Cpath fill='%2364748b' d='M224 48H32a8 8 0 0 0-8 8v136a16 16 0 0 0 16 16h176a16 16 0 0 0 16-16V56a8 8 0 0 0-8-8Zm-20.57 16L128 133.15 52.57 64ZM216 192H40V75.08l82.31 73.65a8 8 0 0 0 10.67 0L216 75.08Z'/%3E%3C/svg%3E`,
  web:   `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='13' height='13' viewBox='0 0 256 256'%3E%3Cpath fill='%2364748b' d='M128 24a104 104 0 1 0 104 104A104.11 104.11 0 0 0 128 24Zm77.73 96h-34.67c-1.25-30.06-10.86-58.37-27.21-80a88.13 88.13 0 0 1 61.88 80Zm-91.2-81.7C131.07 56.32 155.93 83 157.93 120H98.07c2-37 26.86-63.68 14.46-81.7ZM40.27 120a88.13 88.13 0 0 1 61.88-80c-16.35 21.63-26 49.94-27.21 80Zm0 16h34.67c1.25 30.06 10.86 58.37 27.21 80a88.13 88.13 0 0 1-61.88-80Zm91.2 81.7c-12.6-17.38-27.46-44.1-29.4-81.7h59.86c-2 37.6-16.86 64.32-30.46 81.7Zm40.67-1.7c16.35-21.63 26-49.94 27.21-80h34.67a88.13 88.13 0 0 1-61.88 80Z'/%3E%3C/svg%3E`,
  linkedin: `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='13' height='13' viewBox='0 0 256 256'%3E%3Cpath fill='%2364748b' d='M216 24H40a16 16 0 0 0-16 16v176a16 16 0 0 0 16 16h176a16 16 0 0 0 16-16V40a16 16 0 0 0-16-16ZM96 176a8 8 0 0 1-16 0v-64a8 8 0 0 1 16 0Zm-8-84a12 12 0 1 1 12-12 12 12 0 0 1-12 12Zm96 84a8 8 0 0 1-16 0v-36a20 20 0 0 0-40 0v36a8 8 0 0 1-16 0v-64a8 8 0 0 1 15.79-1.78A36 36 0 0 1 184 140Z'/%3E%3C/svg%3E`,
};

function iconImg(src: string): string {
  return `<img src="${src}" width="13" height="13" style="display:block" alt="">`;
}

export function buildSignatureHtml(fields: SignatureFields, _avatarUrl?: string): string {
  // Avatar is intentionally omitted from the signature —
  // the sender avatar is surfaced in the email client's contact/profile UI.

  const titleLine = [fields.title, fields.company]
    .filter(Boolean)
    .join(' <span style="color:#cbd5e1">&middot;</span> ');

  // Contact rows: table-based (no flexbox) for full Outlook/Apple Mail compat
  type Row = { icon: string; href: string; label: string };
  const rows: Row[] = [];
  if (fields.phone)   rows.push({ icon: ICON.phone,    href: `tel:${fields.phone}`,      label: fields.phone });
  if (fields.email)   rows.push({ icon: ICON.email,    href: `mailto:${fields.email}`,   label: fields.email });
  if (fields.website) rows.push({ icon: ICON.web,      href: fields.website,              label: fields.website.replace(/^https?:\/\//, '') });
  if (fields.linkedIn) rows.push({ icon: ICON.linkedin, href: fields.linkedIn,            label: 'LinkedIn' });

  const contactTable = rows.length === 0 ? '' :
    `<table cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-top:10px">
      ${rows.map(({ icon, href, label }) => `
      <tr>
        <td style="padding:2px 8px 2px 0;vertical-align:middle;line-height:0">${iconImg(icon)}</td>
        <td style="padding:2px 0;vertical-align:middle">
          <a href="${esc(href)}" style="font-size:11.5px;color:#3b82f6;text-decoration:none;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;font-weight:400;line-height:1.4">${esc(label)}</a>
        </td>
      </tr>`).join('')}
    </table>`;

  // Logo — absolute URL so external email clients can load it
  const logoHtml =
    `<div style="margin-top:16px;line-height:0">
      <img src="https://mail.bbyb.dev/logo-dark.png" height="18"
           style="display:block;height:18px;width:auto;opacity:0.55;filter:grayscale(0.2)"
           alt="BitByBit">
    </div>`;

  // Branded separator: short blue rule blending into a gray full-width rule
  const separatorHtml =
    `<table cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-top:12px">
      <tr>
        <td width="24" height="2" bgcolor="#3b82f6" style="font-size:0;line-height:0;border-radius:1px">&nbsp;</td>
        <td width="220" height="2" bgcolor="#e2e8f0" style="font-size:0;line-height:0">&nbsp;</td>
      </tr>
    </table>`;

  return `<table cellpadding="0" cellspacing="0" style="border-collapse:collapse;max-width:480px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;margin-top:28px">
  <!-- top hairline -->
  <tr>
    <td style="padding-bottom:20px">
      <table cellpadding="0" cellspacing="0" width="480">
        <tr><td height="1" bgcolor="#e2e8f0" style="font-size:0;line-height:0">&nbsp;</td></tr>
      </table>
    </td>
  </tr>
  <!-- signature body: border-left trick gives reliable full-height accent bar -->
  <tr>
    <td style="border-left:4px solid #3b82f6;padding-left:18px">
      <div style="font-size:15.5px;font-weight:800;color:#0f172a;letter-spacing:-0.03em;line-height:1.15;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif">
        ${esc(fields.name)}
      </div>
      ${titleLine ? `<div style="font-size:12px;color:#475569;font-weight:500;margin-top:4px;line-height:1.4">${titleLine}</div>` : ''}
      ${fields.tagline ? `<div style="font-size:11px;color:#94a3b8;font-style:italic;margin-top:3px;line-height:1.5">${esc(fields.tagline)}</div>` : ''}
      ${separatorHtml}
      ${contactTable}
      ${logoHtml}
    </td>
  </tr>
</table>`;
}
