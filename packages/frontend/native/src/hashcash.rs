//! Self-contained hashcash (proof-of-work) implementation for the Electron
//! native module.
//!
//! Written against the public hashcash specification (Adam Back, 1997,
//! http://hashcash.org/). A stamp is the canonical colon-separated form
//! `version:bits:timestamp:resource:ext:rand:counter`.
//!
//! A stamp is valid when SHA3-256 of the full serialized string has at least
//! `bits` leading zero bits (a true bit-level check, not a hex-digit
//! approximation) and the declared timestamp is within the expiry window.
//!
//! This file intentionally has no dependency on any non-MIT crate in the
//! workspace.

use std::convert::TryFrom;

use chrono::{DateTime, Duration, NaiveDateTime, Utc};
use napi::{Env, Result, Task, bindgen_prelude::AsyncTask};
use napi_derive::napi;
use rand::{
  distr::{Alphanumeric, Distribution},
  rng,
};
use sha3::{Digest, Sha3_256};

const STAMP_VERSION: &str = "1";
const DEFAULT_DIFFICULTY_BITS: u32 = 20;
const SALT_LEN: usize = 16;
const TS_FMT: &str = "%Y%m%d%H%M%S";
const STAMP_LIFETIME_MINUTES: i64 = 5;

#[derive(Debug, Clone)]
pub struct Stamp {
  version: String,
  bits: u32,
  timestamp: String,
  resource: String,
  ext: String,
  salt: String,
  counter: String,
}

impl Stamp {
  /// Serialize to the canonical `v:bits:ts:resource:ext:salt:counter` form.
  pub fn serialize(&self) -> String {
    format!(
      "{}:{}:{}:{}:{}:{}:{}",
      self.version, self.bits, self.timestamp, self.resource, self.ext, self.salt, self.counter,
    )
  }

  /// Mint a fresh stamp for `resource` at the requested difficulty. Blocks
  /// the current thread until the proof-of-work is found; callers should
  /// invoke this from an async worker.
  pub fn mint(resource: String, bits: Option<u32>) -> Self {
    let bits = bits.unwrap_or(DEFAULT_DIFFICULTY_BITS);
    let timestamp = Utc::now().format(TS_FMT).to_string();
    let salt = random_salt(SALT_LEN);

    let mut candidate = Stamp {
      version: STAMP_VERSION.to_string(),
      bits,
      timestamp,
      resource,
      ext: String::new(),
      salt,
      counter: String::from("0"),
    };

    let mut counter: u64 = 0;
    let mut hasher = Sha3_256::new();
    loop {
      candidate.counter = format!("{counter:x}");
      hasher.update(candidate.serialize().as_bytes());
      let digest = hasher.finalize_reset();
      if leading_zero_bits(digest.as_slice()) >= bits {
        return candidate;
      }
      counter = counter.wrapping_add(1);
    }
  }

  /// Verify the stamp meets `required_bits`, binds to `resource`, uses a
  /// known version, and has not expired.
  pub fn verify(&self, required_bits: u32, resource: &str) -> bool {
    if self.version != STAMP_VERSION {
      return false;
    }
    if self.bits < required_bits {
      return false;
    }
    if self.resource != resource {
      return false;
    }
    if !self.within_expiry() {
      return false;
    }
    let mut hasher = Sha3_256::new();
    hasher.update(self.serialize().as_bytes());
    let digest = hasher.finalize();
    leading_zero_bits(digest.as_slice()) >= required_bits
  }

  fn within_expiry(&self) -> bool {
    let Ok(parsed) = NaiveDateTime::parse_from_str(&self.timestamp, TS_FMT) else {
      return false;
    };
    let minted_at = DateTime::<Utc>::from_naive_utc_and_offset(parsed, Utc);
    match minted_at.checked_add_signed(Duration::minutes(STAMP_LIFETIME_MINUTES)) {
      Some(expires_at) => Utc::now() <= expires_at,
      None => false,
    }
  }
}

#[derive(Debug, thiserror::Error)]
pub enum StampParseError {
  #[error("expected 7 colon-separated fields, got {0}")]
  WrongFieldCount(usize),
  #[error("field {0} is unexpectedly empty")]
  EmptyField(usize),
  #[error("bits field is not a valid unsigned integer")]
  InvalidBits,
}

impl TryFrom<&str> for Stamp {
  type Error = StampParseError;

  fn try_from(raw: &str) -> std::result::Result<Self, Self::Error> {
    let parts: Vec<&str> = raw.split(':').collect();
    if parts.len() != 7 {
      return Err(StampParseError::WrongFieldCount(parts.len()));
    }
    // Field index 4 (ext) is permitted to be empty; all others must not be.
    for (index, value) in parts.iter().enumerate() {
      if index != 4 && value.is_empty() {
        return Err(StampParseError::EmptyField(index));
      }
    }
    let bits: u32 = parts[1].parse().map_err(|_| StampParseError::InvalidBits)?;
    Ok(Stamp {
      version: parts[0].to_string(),
      bits,
      timestamp: parts[2].to_string(),
      resource: parts[3].to_string(),
      ext: parts[4].to_string(),
      salt: parts[5].to_string(),
      counter: parts[6].to_string(),
    })
  }
}

fn random_salt(n: usize) -> String {
  Alphanumeric.sample_iter(rng()).take(n).map(char::from).collect()
}

/// Count leading zero bits of a big-endian byte slice.
fn leading_zero_bits(bytes: &[u8]) -> u32 {
  let mut count = 0u32;
  for byte in bytes {
    if *byte == 0 {
      count += 8;
    } else {
      count += byte.leading_zeros();
      return count;
    }
  }
  count
}

// ---------------------------------------------------------------------------
// NAPI async wrappers. These preserve the JS-facing API:
//   mintChallengeResponse(resource, bits?)        -> Promise<string>
//   verifyChallengeResponse(response, bits, res)  -> Promise<boolean>
// ---------------------------------------------------------------------------

pub struct AsyncMintChallengeResponse {
  resource: String,
  bits: Option<u32>,
}

#[napi]
impl Task for AsyncMintChallengeResponse {
  type Output = String;
  type JsValue = String;

  fn compute(&mut self) -> Result<Self::Output> {
    Ok(Stamp::mint(self.resource.clone(), self.bits).serialize())
  }

  fn resolve(&mut self, _: Env, output: String) -> Result<Self::JsValue> {
    Ok(output)
  }
}

#[napi]
pub fn mint_challenge_response(resource: String, bits: Option<u32>) -> AsyncTask<AsyncMintChallengeResponse> {
  AsyncTask::new(AsyncMintChallengeResponse { resource, bits })
}

pub struct AsyncVerifyChallengeResponse {
  response: String,
  bits: u32,
  resource: String,
}

#[napi]
impl Task for AsyncVerifyChallengeResponse {
  type Output = bool;
  type JsValue = bool;

  fn compute(&mut self) -> Result<Self::Output> {
    Ok(
      Stamp::try_from(self.response.as_str())
        .map(|stamp| stamp.verify(self.bits, &self.resource))
        .unwrap_or(false),
    )
  }

  fn resolve(&mut self, _: Env, output: bool) -> Result<Self::JsValue> {
    Ok(output)
  }
}

#[napi]
pub fn verify_challenge_response(
  response: String,
  bits: u32,
  resource: String,
) -> AsyncTask<AsyncVerifyChallengeResponse> {
  AsyncTask::new(AsyncVerifyChallengeResponse {
    response,
    bits,
    resource,
  })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn leading_zero_bits_counts_correctly() {
    assert_eq!(leading_zero_bits(&[0x00, 0x00, 0xff]), 16);
    assert_eq!(leading_zero_bits(&[0x00, 0x0f]), 12);
    assert_eq!(leading_zero_bits(&[0x80]), 0);
    assert_eq!(leading_zero_bits(&[0x01]), 7);
    assert_eq!(leading_zero_bits(&[]), 0);
  }

  #[test]
  fn mint_then_verify_roundtrip() {
    let stamp = Stamp::mint("resource-a".to_string(), Some(8));
    assert!(stamp.verify(8, "resource-a"));
  }

  #[test]
  fn verify_rejects_higher_required_bits() {
    let stamp = Stamp::mint("x".to_string(), Some(8));
    assert!(!stamp.verify(12, "x"));
  }

  #[test]
  fn verify_rejects_wrong_resource() {
    let stamp = Stamp::mint("x".to_string(), Some(8));
    assert!(!stamp.verify(8, "y"));
  }

  #[test]
  fn parse_roundtrip() {
    let original = Stamp::mint("round".to_string(), Some(6));
    let serialized = original.serialize();
    let parsed = Stamp::try_from(serialized.as_str()).expect("parse");
    assert!(parsed.verify(6, "round"));
    assert_eq!(parsed.serialize(), serialized);
  }

  #[test]
  fn reject_malformed_stamps() {
    assert!(matches!(
      Stamp::try_from("too:few:fields"),
      Err(StampParseError::WrongFieldCount(3))
    ));
    assert!(matches!(
      Stamp::try_from("1::20250101000000:r:ext:salt:counter"),
      Err(StampParseError::EmptyField(1))
    ));
    // ext (index 4) may be empty.
    assert!(Stamp::try_from("1:8:20250101000000:r::salt:0").is_ok());
    assert!(matches!(
      Stamp::try_from("1:notanumber:20250101000000:r:ext:salt:0"),
      Err(StampParseError::InvalidBits)
    ));
  }

  #[test]
  fn expired_stamps_fail_verify() {
    let mut stamp = Stamp::mint("t".to_string(), Some(4));
    let past = (Utc::now() - Duration::minutes(10)).format(TS_FMT).to_string();
    stamp.timestamp = past;
    assert!(!stamp.verify(4, "t"));
  }

  #[test]
  fn async_mint_task_matches_sync_api() {
    let resource = "async-test".to_string();
    let mut task = AsyncMintChallengeResponse {
      resource: resource.clone(),
      bits: Some(6),
    };
    let serialized = task.compute().expect("compute");
    let parsed = Stamp::try_from(serialized.as_str()).expect("parse");
    assert!(parsed.verify(6, &resource));
  }

  #[test]
  fn async_verify_task_returns_false_for_bad_input() {
    let mut task = AsyncVerifyChallengeResponse {
      response: "not a real stamp".to_string(),
      bits: 8,
      resource: "anything".to_string(),
    };
    assert!(!task.compute().expect("compute"));
  }
}
