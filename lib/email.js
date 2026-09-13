// lib/email.js
// Shared transactional-email sender for the Cloudflare Pages Functions.
//
// Extracted from functions/api/pledge.js so both the pledge double-opt-in flow
// and the admin magic-link login (functions/api/admin/*) send mail through one
// implementation. Three backends are tried in order, falling through on failure:
//   1. Gmail SMTP + App Password (GMAIL_USER / GMAIL_APP_PASSWORD) — no OAuth,
//      no expiry, ~5 min setup. Preferred.
//   2. Gmail API via OAuth refresh token (GMAIL_CLIENT_ID / _SECRET /
//      _REFRESH_TOKEN / _FROM_ADDRESS) — kept for anyone who already completed
//      that setup. NOTE: gmail.send is a Google "sensitive" scope; an unverified
//      app's refresh token expires exactly 7 days after it was issued unless the
//      app passes Google's verification review. SMTP avoids this entirely.
//   3. Resend (RESEND_API_KEY) — needs a verified domain, not a Gmail address.
// If none are configured, sendEmail() returns false and callers degrade
// gracefully (see docs and each caller for the fallback behaviour).

export function escapeHTML(s) {
  return String(s ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

// ── Gmail SMTP sender (App Password) ──────────────────────────────────────────
// Speaks raw SMTP over an implicit-TLS TCP socket to smtp.gmail.com:465,
// authenticating with AUTH LOGIN using a Google Account "App Password" (not the
// account's real password). Requires the Cloudflare TCP Sockets runtime API
// (`cloudflare:sockets`), available in Workers/Pages Functions — imported
// dynamically so a platform without it degrades to "unavailable" instead of
// crashing the whole module at load time.

// btoa() only handles Latin1 — encode UTF-8 bytes first so names/subjects with
// non-ASCII characters (e.g. accented names) don't corrupt the message.
function base64EncodeUTF8(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

// SMTP DATA framing: any line beginning with "." must be escaped to ".." or the
// server reads it as the end-of-message marker.
function smtpDotStuff(text) {
  return text.split('\r\n').map(line => (line.startsWith('.') ? '.' + line : line)).join('\r\n');
}

// Buffers arbitrary-sized reads from the socket into complete CRLF-terminated
// lines — a raw stream reader has no framing of its own, and SMTP responses can
// arrive split across TCP segments or bundled together.
function makeLineReader(readableStream) {
  const reader = readableStream.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  return {
    async readLine() {
      for (;;) {
        const idx = buf.indexOf('\r\n');
        if (idx !== -1) {
          const line = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          return line;
        }
        const { value, done } = await reader.read();
        if (done) return null;
        buf += decoder.decode(value, { stream: true });
      }
    },
    release() { try { reader.releaseLock(); } catch { /* already released */ } },
  };
}

function makeLineWriter(writableStream) {
  const writer = writableStream.getWriter();
  const encoder = new TextEncoder();
  return {
    async writeLine(line) { await writer.write(encoder.encode(line + '\r\n')); },
    release() { try { writer.releaseLock(); } catch { /* already released */ } },
  };
}

// Reads one (possibly multi-line) SMTP response: continuation lines have a "-"
// as the 4th character ("250-..."), the final line has a space ("250 ...").
async function readSmtpResponse(lineReader) {
  let code = null;
  const messageLines = [];
  for (;;) {
    const line = await lineReader.readLine();
    if (line === null) throw new Error('SMTP connection closed unexpectedly');
    const m = /^(\d{3})([ -])(.*)$/.exec(line);
    if (!m) throw new Error('Unexpected SMTP response line: ' + line);
    code = parseInt(m[1], 10);
    messageLines.push(m[3]);
    if (m[2] === ' ') break;
  }
  return { code, text: messageLines.join('\n') };
}

async function sendViaGmailSMTP(gmailUser, appPassword, to, subject, html) {
  let connect;
  try {
    ({ connect } = await import('cloudflare:sockets'));
  } catch {
    console.error('SMTP sender unavailable: cloudflare:sockets not present in this runtime');
    return false;
  }

  // Header values are caller-influenced (to = a form email field) — strip CR/LF
  // defensively even though upstream validation already rejects whitespace in
  // the address, since this is a raw-protocol writer.
  const safeTo      = String(to).replace(/[\r\n]/g, '');
  const safeSubject = String(subject).replace(/[\r\n]/g, '');
  const encodedSubject = `=?UTF-8?B?${base64EncodeUTF8(safeSubject)}?=`;

  const message = smtpDotStuff([
    `From: ASVA <${gmailUser}>`,
    `To: ${safeTo}`,
    `Subject: ${encodedSubject}`,
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset=UTF-8',
    '',
    html,
  ].join('\r\n'));

  const TIMEOUT_MS = 10000;
  let socket, lineReader, lineWriter;
  const withTimeout = promise => Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('SMTP timed out')), TIMEOUT_MS)),
  ]);

  try {
    await withTimeout((async () => {
      socket = connect(
        { hostname: 'smtp.gmail.com', port: 465 },
        { secureTransport: 'on', allowHalfOpen: false }
      );
      lineReader = makeLineReader(socket.readable);
      lineWriter = makeLineWriter(socket.writable);

      let res = await readSmtpResponse(lineReader);
      if (res.code !== 220) throw new Error('No greeting from SMTP server: ' + res.text);

      await lineWriter.writeLine('EHLO asva-scorecard.pages.dev');
      res = await readSmtpResponse(lineReader);
      if (res.code !== 250) throw new Error('EHLO rejected: ' + res.text);

      await lineWriter.writeLine('AUTH LOGIN');
      res = await readSmtpResponse(lineReader);
      if (res.code !== 334) throw new Error('AUTH LOGIN not accepted: ' + res.text);

      await lineWriter.writeLine(base64EncodeUTF8(gmailUser));
      res = await readSmtpResponse(lineReader);
      if (res.code !== 334) throw new Error('Username rejected: ' + res.text);

      await lineWriter.writeLine(base64EncodeUTF8(appPassword));
      res = await readSmtpResponse(lineReader);
      if (res.code !== 235) throw new Error('Authentication failed — check the App Password: ' + res.text);

      await lineWriter.writeLine(`MAIL FROM:<${gmailUser}>`);
      res = await readSmtpResponse(lineReader);
      if (res.code !== 250) throw new Error('MAIL FROM rejected: ' + res.text);

      await lineWriter.writeLine(`RCPT TO:<${safeTo}>`);
      res = await readSmtpResponse(lineReader);
      if (res.code !== 250 && res.code !== 251) throw new Error('RCPT TO rejected: ' + res.text);

      await lineWriter.writeLine('DATA');
      res = await readSmtpResponse(lineReader);
      if (res.code !== 354) throw new Error('DATA not accepted: ' + res.text);

      await lineWriter.writeLine(message + '\r\n.');
      res = await readSmtpResponse(lineReader);
      if (res.code !== 250) throw new Error('Message not accepted: ' + res.text);

      await lineWriter.writeLine('QUIT');
    })());
    return true;
  } catch (e) {
    console.error('Gmail SMTP send failed:', e.message || e);
    return false;
  } finally {
    try { lineReader?.release(); } catch { /* ignore */ }
    try { lineWriter?.release(); } catch { /* ignore */ }
    try { await socket?.close(); } catch { /* ignore — already closed or never opened */ }
  }
}

// ── Gmail API sender (OAuth) — see the header comment for the 7-day refresh-token
// caveat that makes the SMTP sender above the preferred path. Exchanges the
// long-lived refresh token for a short-lived access token on every send
// (Functions are stateless), then calls users.messages.send.

async function getGmailAccessToken(clientId, clientSecret, refreshToken) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id:     clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type:    'refresh_token',
    }),
  });
  if (!res.ok) {
    console.error('Gmail token refresh error:', res.status, await res.text());
    return null;
  }
  const data = await res.json();
  return data.access_token || null;
}

function base64urlEncodeUTF8(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function sendViaGmail(clientId, clientSecret, refreshToken, fromAddress, to, subject, html) {
  const accessToken = await getGmailAccessToken(clientId, clientSecret, refreshToken);
  if (!accessToken) return false;

  const encodedSubject = `=?UTF-8?B?${btoa(unescape(encodeURIComponent(subject)))}?=`;
  const message = [
    `From: ASVA <${fromAddress}>`,
    `To: ${to}`,
    `Subject: ${encodedSubject}`,
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset=UTF-8',
    '',
    html,
  ].join('\r\n');

  try {
    const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ raw: base64urlEncodeUTF8(message) }),
    });
    if (!res.ok) console.error('Gmail send error:', res.status, await res.text());
    return res.ok;
  } catch (e) {
    console.error('Gmail send request failed:', e);
    return false;
  }
}

async function sendViaResend(resendKey, from, to, subject, html) {
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${resendKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from, to: [to], subject, html }),
    });
    if (!res.ok) console.error('Resend error:', res.status, await res.text());
    return res.ok;
  } catch (e) {
    console.error('Resend request failed:', e);
    return false;
  }
}

// Tries each configured backend in order — SMTP, then OAuth Gmail API, then
// Resend — falling through on failure. Returns true if any reports success.
export async function sendEmail(env, to, subject, html) {
  const gmailUser        = (env.GMAIL_USER || '').trim();
  const gmailAppPassword = (env.GMAIL_APP_PASSWORD || '').replace(/\s+/g, ''); // Google displays it space-separated
  if (gmailUser && gmailAppPassword) {
    const ok = await sendViaGmailSMTP(gmailUser, gmailAppPassword, to, subject, html);
    if (ok) return true;
    console.error('Gmail SMTP send failed — trying next configured backend');
  }

  const gmailClientId     = (env.GMAIL_CLIENT_ID || '').trim();
  const gmailClientSecret = (env.GMAIL_CLIENT_SECRET || '').trim();
  const gmailRefreshToken = (env.GMAIL_REFRESH_TOKEN || '').trim();
  const gmailFrom         = (env.GMAIL_FROM_ADDRESS || '').trim();
  if (gmailClientId && gmailClientSecret && gmailRefreshToken && gmailFrom) {
    const ok = await sendViaGmail(gmailClientId, gmailClientSecret, gmailRefreshToken, gmailFrom, to, subject, html);
    if (ok) return true;
    console.error('Gmail API send failed — trying next configured backend');
  }

  const resendKey = (env.RESEND_API_KEY || '').trim();
  if (resendKey) {
    const emailFrom = (env.EMAIL_FROM || 'ASVA <onboarding@resend.dev>').trim();
    return sendViaResend(resendKey, emailFrom, to, subject, html);
  }

  return false;
}

// True when at least one sender backend is fully configured. Logs which vars
// were detected (booleans only, never values) so Cloudflare's Functions logs
// show exactly why email is/isn't sending on a given deployment.
export function confirmationEnabled(env) {
  const hasGmailUser    = !!(env.GMAIL_USER || '').trim();
  const hasGmailAppPass = !!(env.GMAIL_APP_PASSWORD || '').trim();
  const hasSmtp = hasGmailUser && hasGmailAppPass;
  const hasGmailApi = !!((env.GMAIL_CLIENT_ID || '').trim() && (env.GMAIL_CLIENT_SECRET || '').trim() &&
                          (env.GMAIL_REFRESH_TOKEN || '').trim() && (env.GMAIL_FROM_ADDRESS || '').trim());
  const hasResend = !!(env.RESEND_API_KEY || '').trim();
  console.log('email sender check:', {
    GMAIL_USER: hasGmailUser, GMAIL_APP_PASSWORD: hasGmailAppPass, hasSmtp, hasGmailApi, hasResend,
  });
  return hasSmtp || hasGmailApi || hasResend;
}
