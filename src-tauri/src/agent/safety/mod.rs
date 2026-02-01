//! Command Safety Module
//!
//! Provides dangerous command detection and classification.

mod classifier;

pub use classifier::{DangerClassification, DangerClassifier, DangerLevel};
