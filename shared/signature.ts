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

export function buildSignatureHtml(fields: SignatureFields, avatarUrl?: string): string {
  const contactRows: string[] = [];
  if (fields.phone)
    contactRows.push(
      `<div style="font-size:12px;color:#666;padding:2px 0">📞 <a href="tel:${esc(fields.phone)}" style="color:#555;text-decoration:none">${esc(fields.phone)}</a></div>`,
    );
  if (fields.email)
    contactRows.push(
      `<div style="font-size:12px;color:#666;padding:2px 0">✉ <a href="mailto:${esc(fields.email)}" style="color:#555;text-decoration:none">${esc(fields.email)}</a></div>`,
    );
  if (fields.website)
    contactRows.push(
      `<div style="font-size:12px;color:#666;padding:2px 0">🌐 <a href="${esc(fields.website)}" style="color:#555;text-decoration:none">${esc(fields.website)}</a></div>`,
    );
  if (fields.linkedIn)
    contactRows.push(
      `<div style="font-size:12px;color:#666;padding:2px 0"><a href="${esc(fields.linkedIn)}" style="color:#555;text-decoration:none">LinkedIn</a></div>`,
    );

  const avatarHtml = avatarUrl
    ? `<img src="${esc(avatarUrl)}" width="52" height="52" style="border-radius:50%;object-fit:cover;display:block" alt="${esc(fields.name)}">`
    : "";

  const identity = [
    `<div style="font-weight:700;font-size:14px;color:#111">${esc(fields.name)}</div>`,
    fields.title
      ? `<div style="font-size:12px;color:#555;margin-top:1px">${esc(fields.title)}</div>`
      : "",
    fields.company
      ? `<div style="font-size:12px;color:#555">${esc(fields.company)}</div>`
      : "",
    fields.tagline
      ? `<div style="font-size:11px;color:#888;font-style:italic;margin-top:2px">${esc(fields.tagline)}</div>`
      : "",
  ]
    .filter(Boolean)
    .join("");

  const leftCol = avatarUrl
    ? `<td style="padding-right:14px;vertical-align:top">${avatarHtml}</td>`
    : "";

  return `<table cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-family:Arial,sans-serif;margin-top:16px;border-top:1px solid #e5e7eb;padding-top:12px"><tr>${leftCol}<td style="vertical-align:top">${identity}${contactRows.length > 0 ? `<div style="margin-top:6px">${contactRows.join("")}</div>` : ""}</td></tr></table>`;
}
