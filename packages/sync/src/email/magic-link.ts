interface MagicLinkEmailParams {
  url: string
  host: string
}

/**
 * Branded HTML email for magic-link sign-in.
 *
 * Design tokens are pulled from the Sync design system (dark purple theme)
 * and inlined for maximum email-client compatibility.  Layout uses tables
 * so it renders correctly in Outlook, Gmail, Yahoo, Apple Mail, etc.
 */
export function html({ url, host }: MagicLinkEmailParams): string {
  const escapedHost = host.replace(/\./g, '&#8203;.')

  // Design-system colours (inlined — email clients ignore <style> blocks)
  const c = {
    bg: '#0a0a12',
    cardBg: '#1a1a2e',
    cardBorder: '#2a2a40',
    primary: '#845ef7',
    primaryHover: '#7048e8',
    text: '#f0eef6',
    textSecondary: '#a8a3b8',
    textMuted: '#6e6880',
    glow: 'rgba(132, 94, 247, 0.12)',
  }

  const fontStack =
    "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="color-scheme" content="dark" />
  <meta name="supported-color-schemes" content="dark" />
  <title>Sign in to Sync</title>
</head>
<body style="margin: 0; padding: 0; background-color: ${c.bg}; font-family: ${fontStack}; -webkit-font-smoothing: antialiased;">

  <!-- Outer wrapper — dark background -->
  <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0"
    style="background-color: ${c.bg}; min-height: 100vh;">
    <tr>
      <td align="center" style="padding: 48px 16px;">

        <!-- Card -->
        <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0"
          style="max-width: 440px; background-color: ${c.cardBg}; border: 1px solid ${c.cardBorder}; border-top: 3px solid ${c.primary}; border-radius: 16px; box-shadow: 0 0 40px 0 ${c.glow}, 0 12px 32px -4px rgba(10, 10, 18, 0.6);">

          <!-- Logo / branding -->
          <tr>
            <td align="center" style="padding: 36px 32px 0 32px;">
              <img src="https://storage.lilnas.io/images/sync/icon.png" alt="Sync" width="48" height="48" style="display: block; border: 0;" />
            </td>
          </tr>

          <!-- Heading -->
          <tr>
            <td align="center" style="padding: 24px 32px 0 32px;">
              <h1 style="margin: 0; font-size: 22px; font-weight: 700; color: ${c.text}; font-family: ${fontStack}; line-height: 1.3;">
                Sign in to Sync
              </h1>
            </td>
          </tr>

          <!-- Description -->
          <tr>
            <td align="center" style="padding: 12px 32px 0 32px;">
              <p style="margin: 0; font-size: 15px; line-height: 1.6; color: ${c.textSecondary}; font-family: ${fontStack};">
                Click the button below to sign in to your account on
                <strong style="color: ${c.text};">${escapedHost}</strong>.
                This link is valid for 24 hours.
              </p>
            </td>
          </tr>

          <!-- CTA button -->
          <tr>
            <td align="center" style="padding: 28px 32px 0 32px;">
              <table role="presentation" border="0" cellspacing="0" cellpadding="0">
                <tr>
                  <td align="center" style="border-radius: 10px; background-color: ${c.primary}; box-shadow: 0 0 16px 0 rgba(132, 94, 247, 0.3);">
                    <a href="${url}" target="_blank"
                      style="display: inline-block; padding: 14px 36px; font-size: 15px; font-weight: 600; color: #0a0a12; font-family: ${fontStack}; text-decoration: none; border-radius: 10px; line-height: 1;">
                      Sign in to Sync
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- URL fallback -->
          <tr>
            <td align="center" style="padding: 24px 32px 0 32px;">
              <p style="margin: 0; font-size: 12px; color: ${c.textMuted}; font-family: ${fontStack}; line-height: 1.5;">
                Or copy and paste this link into your browser:
              </p>
              <p style="margin: 8px 0 0 0; font-size: 12px; word-break: break-all; font-family: ${fontStack};">
                <a href="${url}" target="_blank" style="color: ${c.primary}; text-decoration: underline;">${url}</a>
              </p>
            </td>
          </tr>

          <!-- Bottom padding -->
          <tr>
            <td style="height: 36px;"></td>
          </tr>
        </table>

        <!-- Footer note -->
        <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0"
          style="max-width: 440px;">
          <tr>
            <td align="center" style="padding: 24px 32px 0 32px;">
              <p style="margin: 0; font-size: 12px; color: ${c.textMuted}; font-family: ${fontStack}; line-height: 1.6;">
                If you didn't request this email, you can safely ignore it.
              </p>
            </td>
          </tr>
        </table>

      </td>
    </tr>
  </table>

</body>
</html>
`.trim()
}

/**
 * Plain-text fallback for email clients that don't render HTML.
 */
export function text({ url, host }: MagicLinkEmailParams): string {
  return `Sign in to Sync (${host})\n\n${url}\n\nIf you didn't request this email, you can safely ignore it.\n`
}
