import * as React from "react";

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

const FONT =
  "-apple-system,BlinkMacSystemFont,'SF Pro Text','Segoe UI',Helvetica,Arial,sans-serif";
const NAME_FONT =
  "-apple-system,BlinkMacSystemFont,'SF Pro Display','Segoe UI',Helvetica,Arial,sans-serif";

const C = {
  ink: "#0b1220",
  text: "#0f172a",
  muted: "#475569",
  subtle: "#94a3b8",
  soft: "#cbd5e1",
  rule: "#e2e8f0",
  accent: "#2563eb",
};

interface ContactItem {
  href: string;
  label: string;
}

function Dot() {
  return <span style={{ color: C.soft, padding: "0 8px", fontWeight: 400 }}>·</span>;
}

// React 19 dropped `bgcolor` from <td> typings but the attribute still
// renders — Outlook needs both `bgcolor=""` and `background-color:` inline
// to render colored fills reliably. Helper preserves both.
function Bar({ width, height, color }: { width: number; height: number; color?: string }) {
  const tdProps = color ? { bgcolor: color } : {};
  return (
    <td
      {...(tdProps as React.TdHTMLAttributes<HTMLTableCellElement>)}
      width={width}
      height={height}
      style={{ fontSize: 0, lineHeight: 0, backgroundColor: color, borderRadius: height >= 2 ? 2 : 0 }}
    >
      &nbsp;
    </td>
  );
}

function Hairline({ width = "100%", color = C.rule }: { width?: string | number; color?: string }) {
  const tdProps = { bgcolor: color } as React.TdHTMLAttributes<HTMLTableCellElement>;
  return (
    <table cellPadding={0} cellSpacing={0} border={0} width={width} style={{ borderCollapse: "collapse" }}>
      <tbody>
        <tr>
          <td
            {...tdProps}
            height={1}
            style={{ fontSize: 0, lineHeight: 0, backgroundColor: color }}
          >
            &nbsp;
          </td>
        </tr>
      </tbody>
    </table>
  );
}

function AccentRule() {
  return (
    <table cellPadding={0} cellSpacing={0} border={0} style={{ borderCollapse: "collapse" }}>
      <tbody>
        <tr>
          <Bar width={36} height={2} color={C.accent} />
          <td width={6} height={2} style={{ fontSize: 0, lineHeight: 0 }}>
            &nbsp;
          </td>
          <Bar width={220} height={1} color={C.rule} />
        </tr>
      </tbody>
    </table>
  );
}

function Contacts({ items }: { items: ContactItem[] }) {
  if (items.length === 0) return null;
  return (
    <div
      style={{
        fontFamily: FONT,
        fontSize: 12.5,
        color: C.muted,
        marginTop: 14,
        lineHeight: 1.5,
        letterSpacing: "-0.005em",
      }}
    >
      {items.map((it, i) => (
        <React.Fragment key={i}>
          {i > 0 && <Dot />}
          <a
            href={it.href}
            style={{
              color: C.text,
              textDecoration: "none",
              fontWeight: 500,
              borderBottom: `1px solid ${C.rule}`,
              paddingBottom: 1,
            }}
          >
            {it.label}
          </a>
        </React.Fragment>
      ))}
    </div>
  );
}

function Role({ title, company }: { title?: string; company?: string }) {
  if (!title && !company) return null;
  if (title && company) {
    return (
      <div
        style={{
          fontFamily: FONT,
          fontSize: 13.5,
          color: C.muted,
          fontWeight: 500,
          marginTop: 6,
          lineHeight: 1.4,
          letterSpacing: "-0.01em",
        }}
      >
        {title} <span style={{ color: C.subtle, fontWeight: 400 }}>at</span>{" "}
        <span style={{ color: C.text, fontWeight: 600 }}>{company}</span>
      </div>
    );
  }
  return (
    <div
      style={{
        fontFamily: FONT,
        fontSize: 13.5,
        color: C.muted,
        fontWeight: 500,
        marginTop: 6,
        lineHeight: 1.4,
      }}
    >
      {title || <span style={{ color: C.text, fontWeight: 600 }}>{company}</span>}
    </div>
  );
}

export function EmailSignature(fields: SignatureFields): React.ReactElement {
  const items: ContactItem[] = [];
  if (fields.email) items.push({ href: `mailto:${fields.email}`, label: fields.email });
  if (fields.phone) items.push({ href: `tel:${fields.phone}`, label: fields.phone });
  if (fields.website)
    items.push({ href: fields.website, label: fields.website.replace(/^https?:\/\//, "") });
  if (fields.linkedIn) items.push({ href: fields.linkedIn, label: "LinkedIn" });

  return (
    <table
      cellPadding={0}
      cellSpacing={0}
      border={0}
      role="presentation"
      style={{
        borderCollapse: "collapse",
        marginTop: 36,
        fontFamily: FONT,
        maxWidth: 560,
      }}
    >
      <tbody>
        <tr>
          <td style={{ padding: "0 0 24px 0" }}>
            <Hairline />
          </td>
        </tr>

        <tr>
          <td>
            <div
              style={{
                fontFamily: NAME_FONT,
                fontSize: 26,
                fontWeight: 800,
                color: C.ink,
                letterSpacing: "-0.045em",
                lineHeight: 1.05,
              }}
            >
              {fields.name || ""}
            </div>
            <Role title={fields.title} company={fields.company} />
            {fields.tagline && (
              <div
                style={{
                  fontFamily: FONT,
                  fontSize: 12,
                  color: C.subtle,
                  fontStyle: "italic",
                  marginTop: 8,
                  lineHeight: 1.5,
                  maxWidth: 480,
                }}
              >
                {fields.tagline}
              </div>
            )}
          </td>
        </tr>

        <tr>
          <td style={{ padding: "18px 0 0 0" }}>
            <AccentRule />
          </td>
        </tr>

        <tr>
          <td>
            <Contacts items={items} />
          </td>
        </tr>

        <tr>
          <td style={{ padding: "22px 0 0 0" }}>
            <div
              style={{
                fontFamily: NAME_FONT,
                fontSize: 10,
                letterSpacing: "0.22em",
                textTransform: "uppercase",
                color: C.subtle,
                fontWeight: 700,
                lineHeight: 1.4,
              }}
            >
              <span
                style={{
                  color: C.ink,
                  fontWeight: 900,
                  letterSpacing: "-0.02em",
                  fontSize: 13,
                  verticalAlign: "-1px",
                }}
              >
                B3
              </span>
              <Dot />
              <a href="https://bbyb.dev" style={{ color: C.muted, textDecoration: "none", fontWeight: 700 }}>
                BitByBit
              </a>
              <Dot />
              <span style={{ color: C.subtle }}>Internal Mail</span>
            </div>
          </td>
        </tr>
      </tbody>
    </table>
  );
}
