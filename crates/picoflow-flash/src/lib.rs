//! Volume detection and POSIX byte-copy flash.

pub mod platform;

mod copy;
mod volume;

pub use copy::write_file_bytes;
pub use volume::{
    list_pico_volumes, list_pico_volumes_with, DirVolumeSource, HidProfile, PicoVolume,
    PicoflowIdentity, VolumeKind, VolumeSource, LABEL_CIRCUITPY, LABEL_RPI_RP2,
};
