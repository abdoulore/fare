//! Exact ZEC amount parsing and formatting. No floats anywhere.

use anyhow::{anyhow, bail, Result};

pub const ZATS_PER_ZEC: u64 = 100_000_000;

/// Parses a decimal ZEC amount such as `0.001` into zatoshis.
pub fn parse_zec(s: &str) -> Result<u64> {
    let s = s.trim();
    if s.is_empty() {
        bail!("empty amount");
    }
    let (whole, frac) = match s.split_once('.') {
        Some((w, f)) => (w, f),
        None => (s, ""),
    };
    if whole.is_empty() && frac.is_empty() {
        bail!("invalid amount: {s}");
    }
    if !whole.chars().all(|c| c.is_ascii_digit()) || !frac.chars().all(|c| c.is_ascii_digit()) {
        bail!("invalid amount: {s}");
    }
    if frac.len() > 8 {
        bail!("ZEC has at most 8 decimal places: {s}");
    }
    let whole: u64 = if whole.is_empty() { 0 } else { whole.parse()? };
    let frac_padded = format!("{frac:0<8}");
    let frac: u64 = frac_padded.parse()?;
    let zats = whole
        .checked_mul(ZATS_PER_ZEC)
        .and_then(|w| w.checked_add(frac))
        .ok_or_else(|| anyhow!("amount too large: {s}"))?;
    if zats == 0 {
        bail!("amount must be greater than zero");
    }
    Ok(zats)
}

/// Formats zatoshis as a ZEC decimal with no trailing zeros, e.g. `0.001`.
pub fn format_zec(zats: u64) -> String {
    let whole = zats / ZATS_PER_ZEC;
    let frac = zats % ZATS_PER_ZEC;
    if frac == 0 {
        return whole.to_string();
    }
    let frac = format!("{frac:08}");
    format!("{whole}.{}", frac.trim_end_matches('0'))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips() {
        for (s, z) in [("0.001", 100_000), ("1", 100_000_000), ("0.00000001", 1), ("12.5", 1_250_000_000)] {
            assert_eq!(parse_zec(s).unwrap(), z);
            assert_eq!(format_zec(z), s);
        }
    }

    #[test]
    fn rejects_bad_input() {
        for s in ["", ".", "0", "0.000000001", "1,5", "-1", "abc"] {
            assert!(parse_zec(s).is_err(), "{s} should be rejected");
        }
    }
}
