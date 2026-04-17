//! RFC 6238 TOTP (Time-based One-Time Password) + minimal RFC 4648 base32.
//!
//! Authenticator apps (Google Authenticator, 1Password, Authy, …) expect the
//! RFC 6238 default profile: HMAC-SHA1, 30-second step, 6 decimal digits. We
//! hard-code that profile here — supporting every dial is not useful for a
//! self-hosted product and every extra knob is a chance for a user to weaken
//! their own MFA.
//!
//! Secrets are 20 bytes of CSPRNG output (the RFC 4226 recommended length for
//! SHA-1). Verification accepts the current step ±1 to tolerate clock drift
//! between the phone and the server, giving a ~90-second acceptance window.

use hmac::{Hmac, Mac};
use sha1::Sha1;

type HmacSha1 = Hmac<Sha1>;

/// RFC 6238 default period.
const STEP_SECS: u64 = 30;
/// Number of decimal digits in the emitted code.
const DIGITS: u32 = 6;
/// Steps on either side of `now` that we still accept. ±1 = ~90s window.
const SKEW_STEPS: i64 = 1;

/// Length of a freshly generated TOTP secret, in bytes.
pub const SECRET_LEN: usize = 20;

/// Generate a fresh 20-byte TOTP secret.
pub fn generate_secret() -> [u8; SECRET_LEN] {
    use rand::RngCore;
    let mut buf = [0u8; SECRET_LEN];
    rand::thread_rng().fill_bytes(&mut buf);
    buf
}

/// Compute the 6-digit TOTP code for a given secret and unix timestamp.
/// Not currently called in production — the server only needs to verify
/// codes — but exposed for tests and future admin tooling.
#[cfg_attr(not(test), allow(dead_code))]
pub fn compute_code(secret: &[u8], unix_ts: u64) -> String {
    let counter = unix_ts / STEP_SECS;
    hotp(secret, counter)
}

/// Verify a user-supplied TOTP code against the current step, accepting a
/// small skew in either direction. Returns `true` on a match.
///
/// The comparison is constant-time relative to the candidate set so timing
/// does not reveal which step matched.
pub fn verify(secret: &[u8], code: &str, unix_ts: u64) -> bool {
    let trimmed = code.trim();
    if trimmed.len() != DIGITS as usize || !trimmed.chars().all(|c| c.is_ascii_digit()) {
        return false;
    }

    let current = (unix_ts / STEP_SECS) as i64;
    let mut matched = false;
    for offset in -SKEW_STEPS..=SKEW_STEPS {
        let step = (current + offset).max(0) as u64;
        let candidate = hotp(secret, step);
        // Constant-time byte compare; OR the result so we always do every
        // comparison regardless of earlier matches.
        matched |= constant_time_eq(candidate.as_bytes(), trimmed.as_bytes());
    }
    matched
}

/// HOTP (RFC 4226) — the primitive TOTP wraps around a counter derived from
/// the current time.
fn hotp(secret: &[u8], counter: u64) -> String {
    let mut mac = HmacSha1::new_from_slice(secret).expect("HMAC accepts any key length");
    mac.update(&counter.to_be_bytes());
    let digest = mac.finalize().into_bytes();

    // Dynamic truncation per RFC 4226 §5.3
    let offset = (digest[digest.len() - 1] & 0x0f) as usize;
    let bin_code = ((digest[offset] as u32 & 0x7f) << 24)
        | ((digest[offset + 1] as u32) << 16)
        | ((digest[offset + 2] as u32) << 8)
        | (digest[offset + 3] as u32);

    let modulus = 10u32.pow(DIGITS);
    let value = bin_code % modulus;
    format!("{:0width$}", value, width = DIGITS as usize)
}

fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut diff = 0u8;
    for (x, y) in a.iter().zip(b.iter()) {
        diff |= x ^ y;
    }
    diff == 0
}

// ===========================================================================
// RFC 4648 base32 (upper-case, no padding). Used in otpauth:// URIs and when
// rendering the secret to the user so they can type it into apps that don't
// scan QR codes.
// ===========================================================================

const B32_ALPHABET: &[u8; 32] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/// Encode bytes as unpadded RFC 4648 base32.
pub fn base32_encode(bytes: &[u8]) -> String {
    let mut out = String::with_capacity((bytes.len() * 8).div_ceil(5));
    let mut buffer: u32 = 0;
    let mut bits_in_buffer: u32 = 0;
    for &b in bytes {
        buffer = (buffer << 8) | (b as u32);
        bits_in_buffer += 8;
        while bits_in_buffer >= 5 {
            bits_in_buffer -= 5;
            let idx = ((buffer >> bits_in_buffer) & 0x1f) as usize;
            out.push(B32_ALPHABET[idx] as char);
        }
    }
    if bits_in_buffer > 0 {
        let idx = ((buffer << (5 - bits_in_buffer)) & 0x1f) as usize;
        out.push(B32_ALPHABET[idx] as char);
    }
    out
}

/// Build an `otpauth://` provisioning URI that authenticator apps recognise.
/// `issuer` + `account` together form the label; the issuer is also sent as
/// a query parameter so apps can group entries even when the label is
/// user-edited.
pub fn provisioning_uri(issuer: &str, account: &str, secret: &[u8]) -> String {
    let label = format!(
        "{}:{}",
        url_encode(issuer),
        url_encode(account),
    );
    let secret_b32 = base32_encode(secret);
    format!(
        "otpauth://totp/{label}?secret={secret}&issuer={issuer}&algorithm=SHA1&digits={digits}&period={period}",
        label = label,
        secret = secret_b32,
        issuer = url_encode(issuer),
        digits = DIGITS,
        period = STEP_SECS,
    )
}

/// Minimal percent-encoding for the path/query components we emit. Only the
/// characters that actually appear in our issuer/account values need care;
/// we keep the alphabet conservative so QR codes in the field still scan.
fn url_encode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char);
            }
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    // RFC 6238 Appendix B test vectors use a 20-byte ASCII key "12345678901234567890".
    const RFC_SECRET: &[u8] = b"12345678901234567890";

    #[test]
    fn rfc6238_vector_59s() {
        // T = 59s, expected 94287082
        assert_eq!(hotp(RFC_SECRET, 59 / 30), "287082");
    }

    #[test]
    fn rfc6238_vector_1111111109s() {
        // T = 1111111109s, expected 07081804
        assert_eq!(hotp(RFC_SECRET, 1111111109 / 30), "081804");
    }

    #[test]
    fn rfc6238_vector_1234567890s() {
        // T = 1234567890, expected 89005924
        assert_eq!(hotp(RFC_SECRET, 1234567890 / 30), "005924");
    }

    #[test]
    fn verify_accepts_current_step() {
        let now = 1_700_000_000u64;
        let code = compute_code(RFC_SECRET, now);
        assert!(verify(RFC_SECRET, &code, now));
    }

    #[test]
    fn verify_accepts_one_step_of_skew() {
        let now = 1_700_000_000u64;
        let past = compute_code(RFC_SECRET, now - STEP_SECS);
        let future = compute_code(RFC_SECRET, now + STEP_SECS);
        assert!(verify(RFC_SECRET, &past, now));
        assert!(verify(RFC_SECRET, &future, now));
    }

    #[test]
    fn verify_rejects_two_steps_of_skew() {
        let now = 1_700_000_000u64;
        let old = compute_code(RFC_SECRET, now - 3 * STEP_SECS);
        assert!(!verify(RFC_SECRET, &old, now));
    }

    #[test]
    fn verify_rejects_wrong_length_or_nondigit() {
        let now = 1_700_000_000u64;
        assert!(!verify(RFC_SECRET, "12345", now));
        assert!(!verify(RFC_SECRET, "1234567", now));
        assert!(!verify(RFC_SECRET, "12ab56", now));
    }

    #[test]
    fn base32_roundtrip_matches_known_vectors() {
        // RFC 4648 §10 vectors (without padding).
        assert_eq!(base32_encode(b""), "");
        assert_eq!(base32_encode(b"f"), "MY");
        assert_eq!(base32_encode(b"fo"), "MZXQ");
        assert_eq!(base32_encode(b"foo"), "MZXW6");
        assert_eq!(base32_encode(b"foob"), "MZXW6YQ");
        assert_eq!(base32_encode(b"fooba"), "MZXW6YTB");
        assert_eq!(base32_encode(b"foobar"), "MZXW6YTBOI");
    }

    #[test]
    fn provisioning_uri_includes_required_fields() {
        let uri = provisioning_uri("Containerus", "alice@example.com", RFC_SECRET);
        assert!(uri.starts_with("otpauth://totp/Containerus:alice%40example.com?"));
        assert!(uri.contains("secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"));
        assert!(uri.contains("issuer=Containerus"));
        assert!(uri.contains("algorithm=SHA1"));
        assert!(uri.contains("digits=6"));
        assert!(uri.contains("period=30"));
    }

    #[test]
    fn generated_secrets_are_unique() {
        let a = generate_secret();
        let b = generate_secret();
        assert_eq!(a.len(), SECRET_LEN);
        assert_ne!(a, b, "CSPRNG must not repeat");
    }
}
