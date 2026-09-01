use std::fmt;
use std::str::FromStr;

use serde::{Deserialize, Serialize};
use ts_rs::TS;
use ulid::Ulid;

macro_rules! ulid_id {
    ($name:ident) => {
        #[derive(
            Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize, TS,
        )]
        #[ts(export, export_to = "../../../src/types/generated.ts", type = "string")]
        pub struct $name(Ulid);

        impl $name {
            pub fn new() -> Self {
                Self(Ulid::new())
            }

            pub fn as_ulid(self) -> Ulid {
                self.0
            }
        }

        impl Default for $name {
            fn default() -> Self {
                Self::new()
            }
        }

        impl fmt::Display for $name {
            fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
                self.0.fmt(f)
            }
        }

        impl From<Ulid> for $name {
            fn from(id: Ulid) -> Self {
                Self(id)
            }
        }

        impl FromStr for $name {
            type Err = ulid::DecodeError;

            fn from_str(s: &str) -> Result<Self, Self::Err> {
                Ok(Self(Ulid::from_string(s)?))
            }
        }
    };
}

ulid_id!(PhotoId);
ulid_id!(ClipId);
ulid_id!(ActionId);

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_and_displays_ulid() {
        let raw = "01ARZ3NDEKTSV4RRFFQ69G5FAV";
        let id: PhotoId = raw.parse().expect("valid ULID");
        assert_eq!(id.to_string(), raw);
        let json = serde_json::to_string(&id).expect("serialize");
        assert_eq!(json, format!("\"{raw}\""));
    }

    #[test]
    fn rejects_non_ulid() {
        assert!("not-a-ulid".parse::<ClipId>().is_err());
    }
}
