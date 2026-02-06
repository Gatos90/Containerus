use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum FileType {
    File,
    Directory,
    Symlink,
    Other,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub file_type: FileType,
    pub size: u64,
    pub permissions: String,
    pub owner: String,
    pub group: String,
    pub modified: String,
    pub symlink_target: Option<String>,
    pub is_hidden: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DirectoryListing {
    pub path: String,
    pub entries: Vec<FileEntry>,
    pub parent_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileContent {
    pub path: String,
    pub content: String,
    pub size: u64,
    pub is_binary: bool,
}
