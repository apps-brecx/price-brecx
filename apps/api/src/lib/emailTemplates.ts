/**
 * Outbound email HTML. Kept inline (no external template engine) and styled
 * with table + inline CSS so it renders consistently across mail clients.
 */

import type { LostBuyboxRow } from "@fbm/shared";

const REASON_LABELS: Record<string, string> = {
  other_seller_winning: "Lost to another seller",
  no_featured_offer: "No featured offer",
  unknown_winner_anonymized: "Winner anonymized",
};

function prettyReason(reason: string): string {
  return REASON_LABELS[reason] ?? reason;
}

function fmtPrice(n: number | null): string {
  return n == null ? "—" : `$${n.toFixed(2)}`;
}

/**
 * Buy Box loss digest. Ported from the Missed-Buy-Box mailer, restyled to the
 * Priceobo card/header so it matches the invite email.
 */
export function buyBoxLossEmailHtml(opts: {
  rows: LostBuyboxRow[];
  marketplaceId: string | null;
  reportUrl: string;
  /** ISO timestamp of the scan the digest is based on (optional). */
  scannedAt?: string | null;
}): string {
  const { rows, marketplaceId, reportUrl, scannedAt } = opts;
  const scannedLabel = scannedAt
    ? new Date(scannedAt).toLocaleString("en-US", {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : null;
  const top = rows.slice(0, 10);
  const bodyRows = top
    .map(
      (r) => `
      <tr>
        <td style="padding:9px 12px;border-bottom:1px solid #f0f1f3;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;font-weight:600;color:#111827;">${escapeHtml(
          r.asin,
        )}</td>
        <td style="padding:9px 12px;border-bottom:1px solid #f0f1f3;font-size:12px;color:#6b7280;">${escapeHtml(
          r.sellerSku ?? "—",
        )}</td>
        <td style="padding:9px 12px;border-bottom:1px solid #f0f1f3;font-size:12px;color:#6b7280;">${escapeHtml(
          prettyReason(r.reason),
        )}</td>
        <td style="padding:9px 12px;border-bottom:1px solid #f0f1f3;font-size:12px;text-align:right;color:#111827;">${fmtPrice(
          r.buyboxPrice,
        )}</td>
        <td style="padding:9px 12px;border-bottom:1px solid #f0f1f3;font-size:12px;text-align:right;color:#111827;">${fmtPrice(
          r.myPrice,
        )}</td>
      </tr>`,
    )
    .join("");

  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f4f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">
      ${rows.length} ASIN${rows.length === 1 ? "" : "s"} lost the Buy Box on Priceobo.
    </div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:32px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e6e8eb;">
            <tr>
              <td style="background:#4f46e5;padding:24px 32px;">
                <span style="color:#ffffff;font-size:18px;font-weight:700;">Priceobo</span>
              </td>
            </tr>
            <tr>
              <td style="padding:32px;">
                <h1 style="margin:0 0 8px;font-size:20px;color:#111827;">Buy Box loss digest</h1>
                <p style="margin:0 0 6px;font-size:14px;line-height:1.6;color:#374151;">
                  <strong>${rows.length}</strong> ASIN${
                    rows.length === 1 ? "" : "s"
                  } currently not winning the Buy Box${
                    marketplaceId
                      ? ` in <code style="font-family:ui-monospace,monospace;font-size:12px;background:#f3f4f6;padding:2px 6px;border-radius:4px;">${escapeHtml(
                          marketplaceId,
                        )}</code>`
                      : ""
                  }.
                </p>
                ${
                  scannedLabel
                    ? `<p style="margin:0 0 20px;font-size:12px;color:#9ca3af;">Based on the latest scan · ${escapeHtml(
                        scannedLabel,
                      )}</p>`
                    : `<div style="height:14px;"></div>`
                }
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e6e8eb;border-radius:8px;overflow:hidden;border-collapse:separate;">
                  <thead>
                    <tr style="background:#f9fafb;">
                      <th style="padding:9px 12px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.07em;color:#9ca3af;font-weight:600;border-bottom:1px solid #e6e8eb;">ASIN</th>
                      <th style="padding:9px 12px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.07em;color:#9ca3af;font-weight:600;border-bottom:1px solid #e6e8eb;">SKU</th>
                      <th style="padding:9px 12px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.07em;color:#9ca3af;font-weight:600;border-bottom:1px solid #e6e8eb;">Reason</th>
                      <th style="padding:9px 12px;text-align:right;font-size:10px;text-transform:uppercase;letter-spacing:.07em;color:#9ca3af;font-weight:600;border-bottom:1px solid #e6e8eb;">Buy Box</th>
                      <th style="padding:9px 12px;text-align:right;font-size:10px;text-transform:uppercase;letter-spacing:.07em;color:#9ca3af;font-weight:600;border-bottom:1px solid #e6e8eb;">My Price</th>
                    </tr>
                  </thead>
                  <tbody>${bodyRows}</tbody>
                </table>
                ${
                  rows.length > 10
                    ? `<p style="margin:12px 0 0;font-size:12px;color:#9ca3af;">+ ${
                        rows.length - 10
                      } more in the report</p>`
                    : ""
                }
                <table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:24px;">
                  <tr>
                    <td style="border-radius:8px;background:#4f46e5;">
                      <a href="${reportUrl}" style="display:inline-block;padding:12px 28px;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;">
                        Open Lost Buy Box report
                      </a>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:16px 32px;background:#f9fafb;border-top:1px solid #e6e8eb;">
                <p style="margin:0;font-size:11px;color:#9ca3af;">
                  You're receiving this because Buy Box alerts are enabled for your workspace. Manage the schedule in Priceobo → Buy Box Alert.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

/** Plain-text counterpart of {@link buyBoxLossEmailHtml}. */
export function buyBoxLossEmailText(opts: {
  rows: LostBuyboxRow[];
  marketplaceId: string | null;
  reportUrl: string;
}): string {
  const { rows, marketplaceId, reportUrl } = opts;
  return [
    `Buy Box lost — ${rows.length} ASIN${rows.length === 1 ? "" : "s"}`,
    "",
    `You are no longer winning the Buy Box${
      marketplaceId ? ` in marketplace ${marketplaceId}` : ""
    }.`,
    "",
    ...rows
      .slice(0, 20)
      .map(
        (r) =>
          `- ${r.asin} (${prettyReason(r.reason)}) — Buy Box ${fmtPrice(
            r.buyboxPrice,
          )} / Mine ${fmtPrice(r.myPrice)}`,
      ),
    rows.length > 20 ? `…and ${rows.length - 20} more` : "",
    "",
    `Open the report: ${reportUrl}`,
    "",
    "— Priceobo",
  ]
    .filter(Boolean)
    .join("\n");
}

interface SalesAlertRowForEmail {
  sku: string;
  asin: string | null;
  reason: "drop" | "stall" | "lowdos";
  stock: number;
  sales7d: number;
  sales30d: number;
  daysOfSupply: number | null;
  message: string;
}

const SALES_REASON_LABEL: Record<string, string> = {
  drop: "Sales drop",
  stall: "No recent sales",
  lowdos: "Low days of supply",
};

/**
 * Sales-alert digest email. Same card/header look as buyBoxLossEmailHtml so
 * recipients recognize Priceobo email style.
 */
export function salesAlertEmailHtml(opts: {
  rows: SalesAlertRowForEmail[];
  reportUrl: string;
  scannedAt?: string | null;
}): string {
  const { rows, reportUrl, scannedAt } = opts;
  const scannedLabel = scannedAt
    ? new Date(scannedAt).toLocaleString("en-US", {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : null;
  const top = rows.slice(0, 15);
  const bodyRows = top
    .map(
      (r) => `
      <tr>
        <td style="padding:9px 12px;border-bottom:1px solid #f0f1f3;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;font-weight:600;color:#111827;">${escapeHtml(
          r.sku,
        )}</td>
        <td style="padding:9px 12px;border-bottom:1px solid #f0f1f3;font-size:12px;color:#6b7280;">${escapeHtml(
          r.asin ?? "—",
        )}</td>
        <td style="padding:9px 12px;border-bottom:1px solid #f0f1f3;font-size:12px;color:#111827;font-weight:600;">${escapeHtml(
          SALES_REASON_LABEL[r.reason] ?? r.reason,
        )}</td>
        <td style="padding:9px 12px;border-bottom:1px solid #f0f1f3;font-size:12px;color:#374151;">${escapeHtml(
          r.message,
        )}</td>
      </tr>`,
    )
    .join("");

  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f4f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">
      ${rows.length} sales alert${rows.length === 1 ? "" : "s"} on Priceobo.
    </div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:32px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="640" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e6e8eb;">
            <tr>
              <td style="background:#4f46e5;padding:24px 32px;">
                <span style="color:#ffffff;font-size:18px;font-weight:700;">Priceobo</span>
              </td>
            </tr>
            <tr>
              <td style="padding:32px;">
                <h1 style="margin:0 0 8px;font-size:20px;color:#111827;">Sales alert digest</h1>
                <p style="margin:0 0 6px;font-size:14px;line-height:1.6;color:#374151;">
                  <strong>${rows.length}</strong> SKU${rows.length === 1 ? "" : "s"} matched your sales-alert thresholds today.
                </p>
                ${
                  scannedLabel
                    ? `<p style="margin:0 0 20px;font-size:12px;color:#9ca3af;">Evaluated · ${escapeHtml(
                        scannedLabel,
                      )}</p>`
                    : `<div style="height:14px;"></div>`
                }
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e6e8eb;border-radius:8px;overflow:hidden;border-collapse:separate;">
                  <thead>
                    <tr style="background:#f9fafb;">
                      <th style="padding:9px 12px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.07em;color:#9ca3af;font-weight:600;border-bottom:1px solid #e6e8eb;">SKU</th>
                      <th style="padding:9px 12px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.07em;color:#9ca3af;font-weight:600;border-bottom:1px solid #e6e8eb;">ASIN</th>
                      <th style="padding:9px 12px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.07em;color:#9ca3af;font-weight:600;border-bottom:1px solid #e6e8eb;">Trigger</th>
                      <th style="padding:9px 12px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.07em;color:#9ca3af;font-weight:600;border-bottom:1px solid #e6e8eb;">Detail</th>
                    </tr>
                  </thead>
                  <tbody>${bodyRows}</tbody>
                </table>
                ${
                  rows.length > 15
                    ? `<p style="margin:12px 0 0;font-size:12px;color:#9ca3af;">+ ${
                        rows.length - 15
                      } more in the report</p>`
                    : ""
                }
                <table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:24px;">
                  <tr>
                    <td style="border-radius:8px;background:#4f46e5;">
                      <a href="${reportUrl}" style="display:inline-block;padding:12px 28px;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;">
                        Open Sales Alerts
                      </a>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:16px 32px;background:#f9fafb;border-top:1px solid #e6e8eb;">
                <p style="margin:0;font-size:11px;color:#9ca3af;">
                  You're receiving this because Sales Alerts are enabled for your workspace. Manage the schedule and thresholds in Priceobo → Sales Alert.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

/** Plain-text counterpart of {@link salesAlertEmailHtml}. */
export function salesAlertEmailText(opts: {
  rows: SalesAlertRowForEmail[];
  reportUrl: string;
}): string {
  const { rows, reportUrl } = opts;
  return [
    `Sales alerts — ${rows.length} SKU${rows.length === 1 ? "" : "s"}`,
    "",
    ...rows
      .slice(0, 30)
      .map(
        (r) =>
          `- ${r.sku} (${SALES_REASON_LABEL[r.reason] ?? r.reason}): ${r.message}`,
      ),
    rows.length > 30 ? `…and ${rows.length - 30} more` : "",
    "",
    `Open the report: ${reportUrl}`,
    "",
    "— Priceobo",
  ]
    .filter(Boolean)
    .join("\n");
}

export function inviteEmailHtml(opts: {
  workspaceName: string;
  inviterName: string;
  acceptUrl: string;
  /** Days until the link stops working — shown to set expectations. */
  expiresInDays: number;
}): string {
  const { workspaceName, inviterName, acceptUrl, expiresInDays } = opts;
  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f4f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">
      ${escapeHtml(inviterName)} invited you to the ${escapeHtml(workspaceName)} workspace on Priceobo.
    </div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:32px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e6e8eb;">
            <tr>
              <td style="background:#4f46e5;padding:24px 32px;">
                <span style="color:#ffffff;font-size:18px;font-weight:700;">Priceobo</span>
              </td>
            </tr>
            <tr>
              <td style="padding:32px;">
                <h1 style="margin:0 0 12px;font-size:20px;color:#111827;">You've been invited</h1>
                <p style="margin:0 0 16px;font-size:14px;line-height:1.6;color:#374151;">
                  <strong>${escapeHtml(inviterName)}</strong> has invited you to join the
                  <strong>${escapeHtml(workspaceName)}</strong> workspace on Priceobo.
                </p>
                <p style="margin:0 0 24px;font-size:14px;line-height:1.6;color:#374151;">
                  Click the button below to set your password and activate your account.
                </p>
                <table role="presentation" cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="border-radius:8px;background:#4f46e5;">
                      <a href="${acceptUrl}"
                         style="display:inline-block;padding:12px 28px;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;">
                        Accept invitation
                      </a>
                    </td>
                  </tr>
                </table>
                <p style="margin:24px 0 0;font-size:12px;line-height:1.6;color:#9ca3af;">
                  This invitation expires in ${expiresInDays} days. If the button doesn't work,
                  copy and paste this link into your browser:<br />
                  <a href="${acceptUrl}" style="color:#4f46e5;word-break:break-all;">${acceptUrl}</a>
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:16px 32px;background:#f9fafb;border-top:1px solid #e6e8eb;">
                <p style="margin:0;font-size:11px;color:#9ca3af;">
                  If you weren't expecting this invitation you can safely ignore this email.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

/**
 * Plain-text counterpart of {@link inviteEmailHtml}. Sent alongside the HTML
 * as the multipart fallback — clients that block HTML still get a usable link,
 * and a text part lifts deliverability past most spam filters.
 */
export function inviteEmailText(opts: {
  workspaceName: string;
  inviterName: string;
  acceptUrl: string;
  expiresInDays: number;
}): string {
  const { workspaceName, inviterName, acceptUrl, expiresInDays } = opts;
  return [
    "You've been invited to Priceobo",
    "",
    `${inviterName} has invited you to join the ${workspaceName} workspace on Priceobo.`,
    "",
    "Accept your invitation and set your password here:",
    acceptUrl,
    "",
    `This invitation expires in ${expiresInDays} days.`,
    "If you weren't expecting this invitation you can safely ignore this email.",
    "",
    "— Priceobo",
  ].join("\n");
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Sign-in OTP email. Renders the 6-digit code in a big monospaced box that
 * Gmail / Outlook auto-detect for their native "Copy code" floating action,
 * so the user never needs to type it. The code itself is also wrapped in
 *   <span data-otp-code> … </span>
 * which several mail clients (Apple Mail, newer Outlook) treat as a copy
 * affordance. We expose the same code in the X-Entity-Ref-ID and a plain
 * "Your code: NNNNNN" subject prefix so password managers (1Password,
 * Bitwarden) and iOS Mail's QuickType keyboard surface it automatically.
 */
export function otpEmailHtml(opts: {
  code: string;
  expiresInMinutes: number;
  ip?: string | null;
  userAgent?: string | null;
}): string {
  const { code, expiresInMinutes, ip, userAgent } = opts;
  const meta = [ip, userAgent].filter(Boolean).join(" · ");
  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f4f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">
      Your Priceobo sign-in code is ${escapeHtml(code)}. It expires in ${expiresInMinutes} minutes.
    </div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:32px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e6e8eb;">
            <tr>
              <td style="background:#4f46e5;padding:24px 32px;">
                <span style="color:#ffffff;font-size:18px;font-weight:700;">Priceobo</span>
              </td>
            </tr>
            <tr>
              <td style="padding:32px;">
                <h1 style="margin:0 0 12px;font-size:20px;color:#111827;">Your sign-in code</h1>
                <p style="margin:0 0 20px;font-size:14px;line-height:1.6;color:#374151;">
                  Use the verification code below to finish signing in. It is valid for
                  <strong>${expiresInMinutes} minutes</strong>.
                </p>

                <!-- OTP block — large, monospaced, selectable. Modern Gmail
                     auto-detects this pattern and renders a "Copy ${escapeHtml(code)}"
                     button next to it. -->
                <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin:0 0 20px;">
                  <tr>
                    <td align="center" style="background:#f3f4f6;border:1px solid #e5e7eb;border-radius:10px;padding:18px 0;">
                      <div data-otp-code style="font-family:'SF Mono',Menlo,Consolas,monospace;font-size:34px;font-weight:700;letter-spacing:10px;color:#111827;user-select:all;-webkit-user-select:all;">
                        ${escapeHtml(code)}
                      </div>
                      <div style="margin-top:6px;font-size:11px;color:#6b7280;">
                        Triple-click or long-press to copy
                      </div>
                    </td>
                  </tr>
                </table>

                ${
                  meta
                    ? `<p style="margin:0 0 8px;font-size:12px;color:#6b7280;">
                         Requested from <strong>${escapeHtml(meta)}</strong>.
                       </p>`
                    : ""
                }
                <p style="margin:0;font-size:12px;line-height:1.6;color:#9ca3af;">
                  If you didn't try to sign in, you can safely ignore this email — without the
                  code, no-one can access your account. Consider changing your password from
                  Settings → Security if you're concerned.
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:16px 32px;background:#f9fafb;border-top:1px solid #e6e8eb;">
                <p style="margin:0;font-size:11px;color:#9ca3af;">
                  Priceobo will never ask you to share this code with anyone.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

/** Plain-text counterpart of {@link otpEmailHtml}. */
export function otpEmailText(opts: {
  code: string;
  expiresInMinutes: number;
}): string {
  const { code, expiresInMinutes } = opts;
  return [
    `Your Priceobo sign-in code is: ${code}`,
    "",
    `It expires in ${expiresInMinutes} minutes.`,
    "",
    "If you didn't try to sign in, you can safely ignore this email.",
    "",
    "— Priceobo",
  ].join("\n");
}
