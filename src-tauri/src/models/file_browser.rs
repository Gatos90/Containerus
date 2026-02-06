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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_file_type_serialization() {
        let json = serde_json::to_string(&FileType::File).unwrap();
        assert_eq!(json, "\"file\"");

        let json = serde_json::to_string(&FileType::Directory).unwrap();
        assert_eq!(json, "\"directory\"");

        let json = serde_json::to_string(&FileType::Symlink).unwrap();
        assert_eq!(json, "\"symlink\"");

        let ft: FileType = serde_json::from_str("\"file\"").unwrap();
        assert_eq!(ft, FileType::File);
    }

    #[test]
    fn test_file_entry_serialization() {
        let entry = FileEntry {
            name: "test.txt".to_string(),
            path: "/home/user/test.txt".to_string(),
            file_type: FileType::File,
            size: 1024,
            permissions: "-rw-r--r--".to_string(),
            owner: "user".to_string(),
            group: "staff".to_string(),
            modified: "2024-01-01T00:00:00Z".to_string(),
            symlink_target: None,
            is_hidden: false,
        };

        let json = serde_json::to_string(&entry).unwrap();
        assert!(json.contains("test.txt"));
        assert!(json.contains("fileType")); // camelCase
        assert!(json.contains("isHidden")); // camelCase

        let deserialized: FileEntry = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized.name, "test.txt");
        assert_eq!(deserialized.size, 1024);
        assert_eq!(deserialized.file_type, FileType::File);
        assert!(!deserialized.is_hidden);
    }

    #[test]
    fn test_directory_listing_serialization() {
        let listing = DirectoryListing {
            path: "/home/user".to_string(),
            entries: vec![
                FileEntry {
                    name: "docs".to_string(),
                    path: "/home/user/docs".to_string(),
                    file_type: FileType::Directory,
                    size: 4096,
                    permissions: "drwxr-xr-x".to_string(),
                    owner: "user".to_string(),
                    group: "staff".to_string(),
                    modified: "2024-01-01T00:00:00Z".to_string(),
                    symlink_target: None,
                    is_hidden: false,
                },
            ],
            parent_path: Some("/home".to_string()),
        };

        let json = serde_json::to_string(&listing).unwrap();
        assert!(json.contains("parentPath")); // camelCase

        let deserialized: DirectoryListing = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized.entries.len(), 1);
        assert_eq!(deserialized.parent_path.as_deref(), Some("/home"));
    }

    #[test]
    fn test_file_content_serialization() {
        let content = FileContent {
            path: "/etc/hosts".to_string(),
            content: "127.0.0.1 localhost".to_string(),
            size: 19,
            is_binary: false,
        };

        let json = serde_json::to_string(&content).unwrap();
        assert!(json.contains("isBinary")); // camelCase

        let deserialized: FileContent = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized.path, "/etc/hosts");
        assert!(!deserialized.is_binary);
    }

    /// Verifies that a `FileEntry` marked as hidden sets the `is_hidden` flag.
    ///
    /// # Examples
    ///
    /// ```
    /// let entry = FileEntry {
    ///     name: ".gitignore".to_string(),
    ///     path: "/home/user/.gitignore".to_string(),
    ///     file_type: FileType::File,
    ///     size: 100,
    ///     permissions: "-rw-r--r--".to_string(),
    ///     owner: "user".to_string(),
    ///     group: "staff".to_string(),
    ///     modified: "2024-01-01T00:00:00Z".to_string(),
    ///     symlink_target: None,
    ///     is_hidden: true,
    /// };
    ///
    /// assert!(entry.is_hidden);
    /// ```
    #[test]
    fn test_hidden_file_entry() {
        let entry = FileEntry {
            name: ".gitignore".to_string(),
            path: "/home/user/.gitignore".to_string(),
            file_type: FileType::File,
            size: 100,
            permissions: "-rw-r--r--".to_string(),
            owner: "user".to_string(),
            group: "staff".to_string(),
            modified: "2024-01-01T00:00:00Z".to_string(),
            symlink_target: None,
            is_hidden: true,
        };

        assert!(entry.is_hidden);
    }

    #[test]
    fn test_symlink_entry() {
        let entry = FileEntry {
            name: "link".to_string(),
            path: "/home/user/link".to_string(),
            file_type: FileType::Symlink,
            size: 0,
            permissions: "lrwxrwxrwx".to_string(),
            owner: "user".to_string(),
            group: "staff".to_string(),
            modified: "2024-01-01T00:00:00Z".to_string(),
            symlink_target: Some("/usr/bin/target".to_string()),
            is_hidden: false,
        };

        assert_eq!(entry.file_type, FileType::Symlink);
        assert_eq!(entry.symlink_target.as_deref(), Some("/usr/bin/target"));
    }
}