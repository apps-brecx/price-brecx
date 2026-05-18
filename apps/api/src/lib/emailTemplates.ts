/**
 * Outbound email HTML. Kept inline (no external template engine) and styled
 * with table + inline CSS so it renders consistently across mail clients.
 */

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

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
