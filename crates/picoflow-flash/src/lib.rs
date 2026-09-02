//! Volume detection and POSIX byte-copy flash.

pub mod platform;

mod circuitpy;
mod copy;
mod volume;

pub use circuitpy::{
    read_identity, write_circuitpy, write_circuitpy_with, write_sequence_only, CircuitpyPayload,
};
pub use copy::write_file_bytes;
pub use volume::{
    list_pico_volumes, list_pico_volumes_with, wait_for_volume, wait_for_volume_with,
    DirVolumeSource, HidProfile, PicoVolume, PicoflowIdentity, VolumeKind, VolumeSource,
    LABEL_CIRCUITPY, LABEL_RPI_RP2, VOLUME_POLL_INTERVAL,
};

use sha2::{Digest, Sha256};

/// Lowercase hex SHA-256 of `bytes` (UF2 integrity check).
pub fn sha256_hex(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    digest.iter().map(|b| format!("{b:02x}")).collect()
}

/// True when `bytes` hash equals `expected_hex` (case-insensitive, trimmed).
pub fn sha256_matches(bytes: &[u8], expected_hex: &str) -> bool {
    sha256_hex(bytes).eq_ignore_ascii_case(expected_hex.trim())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sha256_abc_vector() {
        assert_eq!(
            sha256_hex(b"abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
        assert!(sha256_matches(
            b"abc",
            "BA7816BF8F01CFEA414140DE5DAE2223B00361A396177A9CB410FF61F20015AD"
        ));
        assert!(!sha256_matches(b"abc", "deadbeef"));
    }
}
