# File browser

**Summary**: Shell-based file browser that works on systems, inside containers, and inside K8s pods. No SFTP — russh-sftp requires `^0.49` and the project uses russh `0.46`/`0.57`, so the design is built on `ls -la`, `cat`, `base64 -d`, `tee`, `mkdir`, `rm`, `mv` executed through the existing executor stack.

**Sources**: `src-tauri/src/commands/file_browser.rs`, `src/app/features/file-browser/*`, `src/app/core/services/file-browser.service.ts`, `crates/containerus-core/src/models/file_browser.rs`.

**Last updated**: 2026-04-16

**Parent**: [[frontend-features]]
**See also**: [[dual-path-routing]], [[ssh-subsystem]], [[kubernetes]], [[feature-containers]]

---

## Models

```rust
pub enum FileType { File, Directory, Symlink, Other }

pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub file_type: FileType,
    pub size: u64,
    pub permissions: String,
    pub owner: String,
    pub group: String,
    pub modified: DateTime<Utc>,
    pub symlink_target: Option<String>,
    pub is_hidden: bool,
}

pub struct DirectoryListing { path, entries: Vec<FileEntry>, parent_path: Option<String> }
pub struct FileContent { path, content: String, size: u64, is_binary: bool }
```

## Tauri commands

All take `system_id` plus optional `container_id` + `runtime`. If `container_id` is set, every underlying command is prefixed with `docker exec <cid> ...` (using the system's runtime).

| Command | Shell underneath |
|---|---|
| `list_directory(path)` | `ls -la --time-style=... <path>` (parsed into `FileEntry[]`) |
| `read_file(path)` | `cat <path>` (binary detection on the first 1 KB) |
| `write_file(path, content)` | `printf "%s" <base64> \| base64 -d \| tee <path> > /dev/null` |
| `create_directory(path)` | `mkdir -p <path>` |
| `delete_path(path, recursive)` | `rm [-r] <path>` |
| `rename_path(old, new)` | `mv <old> <new>` |
| `download_file(path)` | `base64 <path>` → returns base64 blob |
| `upload_file(path, content_base64)` | as `write_file` |

Input validation: paths must be absolute and must not contain NUL bytes. Quoting is done via single-quote escaping before interpolation into the shell command.

## Route parameterization

Frontend routes:
- `/files` — system picker
- `/files/:systemId` — browse the host
- `/files/:systemId/:containerId` — browse inside a container

The backend variant routes to `/api/systems/:id/files/*` (and pod variants for K8s). Selection between Tauri and HTTP is the same dual-path pattern — see [[dual-path-routing]].

## Frontend

- `FileBrowserState` — `currentPath`, `listing`, `selectedEntry`, `editorContent`, `editorDirty`, back/forward navigation history.
- `FileBrowserView` — breadcrumb + file list + Monaco editor pane.
- `MonacoEditor` shared component — auto-detects language from file extension.
- Upload/download use the base64 round-trip via the same commands; large files are chunked in the service layer to avoid blowing the Tauri IPC payload cap.

## K8s pods

The server has a parallel set of routes under `/api/clusters/:id/files/*` that do the same thing but through a kube exec channel instead of SSH. `BackendService.listPodDirectoryFor`, `readPodFileFor`, `writePodFileFor`, etc. mirror the container variants.

## Binary handling

The `is_binary` flag on `FileContent` is set via a heuristic on the first 1 KB of output (non-UTF-8 byte → binary). The frontend refuses to open binaries in Monaco and offers a download instead.

## Known limitations

- Large-file reads load into memory (no streaming). A 500 MB file will hang the editor.
- Permissions display is the raw `ls -la` string (`-rwxr-xr-x`), not a parsed mode integer.
- No symlink traversal beyond one hop (symlink target is reported but not followed).
- No rename across filesystems on some systems (just `mv` semantics).

## Related pages

- [[dual-path-routing]]
- [[ssh-subsystem]]
- [[kubernetes]]
- [[frontend-features]]
