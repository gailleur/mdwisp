// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 Gailleur Labs

//! Whole-folder work behind "go to file" and "find in folder".
//!
//! The files sidebar never walks the tree; these two do, so they are kept
//! apart from it and held to a budget. Both run on a blocking thread, only
//! when the user asks, look at Markdown files only, and stop at fixed
//! limits, so a huge folder costs a bounded amount of work and the window
//! stays responsive throughout. Nothing is indexed or cached on disk.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use tauri::ipc::Channel;
use tauri::{AppHandle, Runtime, State};
use tauri_plugin_fs::FsExt;

/// Folders that are never worth descending into: dependency trees hold
/// thousands of READMEs nobody wants to jump to. Hidden folders (`.git`,
/// `.venv`…) are skipped as well, as they are in the sidebar.
const SKIPPED_DIRS: [&str; 1] = ["node_modules"];
/// Directory entries looked at before a walk gives up.
const MAX_VISITED: usize = 400_000;
/// Markdown files "go to file" will list.
const MAX_FILES: usize = 20_000;
/// Matching lines a search reports in all, and per file.
const MAX_HITS: usize = 2_000;
const MAX_HITS_PER_FILE: usize = 100;
/// Larger files are not searched; a Markdown document this size is a dump.
const MAX_FILE_BYTES: u64 = 4 * 1024 * 1024;
/// A matching line longer than this is cut to a window around the match.
const MAX_LINE_CHARS: usize = 240;
const LINE_LEAD_CHARS: usize = 60;

/// Calls `visit` for each Markdown file under `root`, a folder's own files
/// first (by name, ignoring case), then its subfolders in the same order.
/// `visit` returns false to stop, and the walk also stops at the next
/// folder once `wanted` says it is no longer needed, so a walk through
/// folders without any Markdown can still be called off. Symbolic links to
/// folders are not followed, so a link cannot make the walk loop. Returns
/// true when the walk was cut short by the entry budget.
fn walk_markdown(
    root: &Path,
    wanted: impl Fn() -> bool,
    mut visit: impl FnMut(&Path) -> bool,
) -> bool {
    let mut visited = 0usize;
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        if !wanted() {
            return false;
        }
        let Ok(entries) = std::fs::read_dir(&dir) else {
            continue;
        };
        let mut files: Vec<(String, PathBuf)> = Vec::new();
        let mut dirs: Vec<(String, PathBuf)> = Vec::new();
        for entry in entries.flatten() {
            visited += 1;
            if visited > MAX_VISITED {
                return true;
            }
            let name = entry.file_name().to_string_lossy().into_owned();
            if name.starts_with('.') {
                continue;
            }
            let Ok(kind) = entry.file_type() else {
                continue;
            };
            let path = entry.path();
            if kind.is_dir() {
                if !SKIPPED_DIRS.contains(&name.as_str()) {
                    dirs.push((name.to_lowercase(), path));
                }
            } else if crate::looks_like_markdown(&path) && (kind.is_file() || path.is_file()) {
                files.push((name.to_lowercase(), path));
            }
        }
        files.sort();
        for (_, path) in &files {
            if !visit(path) {
                return false;
            }
        }
        // The stack pops from the end: push in reverse to walk in order.
        dirs.sort();
        stack.extend(dirs.into_iter().rev().map(|(_, path)| path));
    }
    false
}

/// A folder the webview was granted (an open folder), canonical. Anything
/// else is refused, as in `list_folder`.
fn allowed_folder<R: Runtime>(app: &AppHandle<R>, path: &str) -> Result<PathBuf, String> {
    let dir = std::fs::canonicalize(path).map_err(|e| e.to_string())?;
    if !dir.is_dir() {
        return Err("Not a folder.".into());
    }
    if !app.fs_scope().is_allowed(&dir) {
        return Err("Not an open folder.".into());
    }
    Ok(dir)
}

#[derive(serde::Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Index {
    /// Paths relative to the folder, with the platform's separator.
    files: Vec<String>,
    /// True when the folder holds more than was listed.
    truncated: bool,
}

fn index(root: &Path) -> Index {
    let mut files = Vec::new();
    let mut full = false;
    let cut = walk_markdown(
        root,
        || true,
        |path| {
            if files.len() >= MAX_FILES {
                full = true;
                return false;
            }
            if let Ok(relative) = path.strip_prefix(root) {
                files.push(relative.to_string_lossy().into_owned());
            }
            true
        },
    );
    Index {
        files,
        truncated: cut || full,
    }
}

/// Every Markdown file under an open folder, for "go to file".
#[tauri::command]
pub async fn index_folder<R: Runtime>(app: AppHandle<R>, path: String) -> Result<Index, String> {
    let root = allowed_folder(&app, &path)?;
    tauri::async_runtime::spawn_blocking(move || index(&root))
        .await
        .map_err(|e| e.to_string())
}

/// The search the frontend currently wants. A search stops as soon as it
/// is no longer the current one, so typing does not queue up stale walks.
#[derive(Default)]
pub struct CurrentSearch(Arc<AtomicU64>);

#[derive(serde::Serialize, Clone, Debug, PartialEq)]
pub struct Hit {
    /// 1-based line number.
    line: u32,
    /// The line, trimmed; a long line is cut to a window around the match.
    text: String,
}

#[derive(serde::Serialize, Clone, Debug, PartialEq)]
pub struct FileHits {
    path: String,
    hits: Vec<Hit>,
}

#[derive(serde::Serialize, Debug, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct SearchSummary {
    files: usize,
    hits: usize,
    /// True when a limit stopped the search before the folder was covered.
    truncated: bool,
    /// True when a newer search replaced this one.
    cancelled: bool,
}

/// The matching line as shown in the results: trimmed, and when it is very
/// long, a window that starts a little before the match.
fn snippet(line: &str, match_byte: usize) -> String {
    let trimmed = line.trim();
    if trimmed.chars().count() <= MAX_LINE_CHARS {
        return trimmed.to_string();
    }
    let lead = line.len() - line.trim_start().len();
    let before = line
        .get(lead..match_byte.max(lead))
        .map(|s| s.chars().count())
        .unwrap_or(0);
    let start = before.saturating_sub(LINE_LEAD_CHARS);
    let window: String = trimmed.chars().skip(start).take(MAX_LINE_CHARS).collect();
    let prefix = if start > 0 { "…" } else { "" };
    let suffix = if start + MAX_LINE_CHARS < trimmed.chars().count() {
        "…"
    } else {
        ""
    };
    format!("{prefix}{}{suffix}", window.trim())
}

/// Lines of `text` containing `needle` (already lower-case), ignoring case.
fn matching_lines(text: &str, needle: &str, limit: usize) -> Vec<Hit> {
    let mut hits = Vec::new();
    for (index, line) in text.lines().enumerate() {
        let lower = line.to_lowercase();
        let Some(at) = lower.find(needle) else {
            continue;
        };
        // Lower-casing can change byte lengths; the position is only used
        // to place the window, so it is clamped rather than trusted.
        let mut at = at.min(line.len());
        while !line.is_char_boundary(at) {
            at -= 1;
        }
        hits.push(Hit {
            line: index as u32 + 1,
            text: snippet(line, at),
        });
        if hits.len() >= limit {
            break;
        }
    }
    hits
}

/// Searches every Markdown file under `root` for `query`, literally and
/// ignoring case, reporting each file with matches through `report` as it
/// is found. `current` tells whether this search is still wanted.
fn search(
    root: &Path,
    query: &str,
    current: impl Fn() -> bool,
    mut report: impl FnMut(FileHits),
) -> SearchSummary {
    let needle = query.to_lowercase();
    let mut summary = SearchSummary::default();
    if needle.trim().is_empty() {
        return summary;
    }
    let cut = walk_markdown(root, &current, |path| {
        if !current() {
            return false;
        }
        if std::fs::metadata(path)
            .map(|m| m.len() > MAX_FILE_BYTES)
            .unwrap_or(true)
        {
            return true;
        }
        let Ok(bytes) = std::fs::read(path) else {
            return true;
        };
        let text = String::from_utf8_lossy(&bytes);
        // One pass over the whole file first: most files do not match.
        if !text.to_lowercase().contains(&needle) {
            return true;
        }
        let room = (MAX_HITS - summary.hits).min(MAX_HITS_PER_FILE);
        let hits = matching_lines(&text, &needle, room);
        if hits.is_empty() {
            return true;
        }
        summary.files += 1;
        summary.hits += hits.len();
        // A link is reported as the file it leads to: that is the path
        // the document gets when it is opened.
        let shown = std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
        report(FileHits {
            path: shown.to_string_lossy().into_owned(),
            hits,
        });
        if summary.hits >= MAX_HITS {
            summary.truncated = true;
            return false;
        }
        true
    });
    summary.truncated = summary.truncated || cut;
    summary.cancelled = !current();
    summary
}

/// Finds `query` in the Markdown files of an open folder. Files with
/// matches arrive on `on_file` while the search runs; the summary is the
/// return value. `id` identifies the search and must be higher than any
/// id used before: starting another search, or `cancel_search`, makes
/// this one stop and report `cancelled`.
#[tauri::command]
pub async fn search_folder<R: Runtime>(
    app: AppHandle<R>,
    current: State<'_, CurrentSearch>,
    path: String,
    query: String,
    id: u64,
    on_file: Channel<FileHits>,
) -> Result<SearchSummary, String> {
    let root = allowed_folder(&app, &path)?;
    let wanted = current.0.clone();
    // Ids only grow. Should two requests be picked up out of order, the
    // older one must not displace the newer: it finds it is not current
    // and stops at once.
    wanted.fetch_max(id, Ordering::SeqCst);
    tauri::async_runtime::spawn_blocking(move || {
        search(
            &root,
            &query,
            || wanted.load(Ordering::SeqCst) == id,
            |file| {
                let _ = on_file.send(file);
            },
        )
    })
    .await
    .map_err(|e| e.to_string())
}

/// Stops the running search, if any. `id` comes from the same counter as
/// the searches' ids and belongs to no search, so making it the current
/// one stops whatever came before and leaves every later search alone.
#[tauri::command]
pub fn cancel_search(current: State<'_, CurrentSearch>, id: u64) {
    current.0.fetch_max(id, Ordering::SeqCst);
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    /// A scratch folder under the system temp directory, removed on drop.
    struct Scratch(PathBuf);

    impl Scratch {
        fn new(name: &str) -> Self {
            // Tests run in parallel: every scratch folder gets its own name.
            static NEXT: AtomicU64 = AtomicU64::new(0);
            let unique = NEXT.fetch_add(1, Ordering::SeqCst);
            let dir = std::env::temp_dir().join(format!(
                "mdwisp-test-{name}-{}-{unique}",
                std::process::id()
            ));
            let _ = fs::remove_dir_all(&dir);
            fs::create_dir_all(&dir).unwrap();
            Scratch(fs::canonicalize(&dir).unwrap())
        }

        fn write(&self, relative: &str, text: &str) {
            let path = self.0.join(relative);
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(path, text).unwrap();
        }
    }

    impl Drop for Scratch {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn sample() -> Scratch {
        let dir = Scratch::new("sample");
        dir.write("readme.md", "# Notes\n\nAn Invoice for March.\n");
        dir.write("Alpha.md", "alpha\n");
        dir.write("logo.png", "invoice");
        dir.write(
            "docs/spec.markdown",
            "first\nthe invoice number\nINVOICE again\n",
        );
        dir.write("docs/deep/note.md", "nothing here\n");
        dir.write(".hidden/secret.md", "invoice\n");
        dir.write("node_modules/pkg/README.md", "invoice\n");
        dir
    }

    fn relative(paths: &[String]) -> Vec<String> {
        paths.iter().map(|p| p.replace('\\', "/")).collect()
    }

    #[test]
    fn index_lists_markdown_only_in_order_and_skips_hidden_and_dependencies() {
        let dir = sample();
        let found = index(&dir.0);
        assert_eq!(
            relative(&found.files),
            [
                "Alpha.md",
                "readme.md",
                "docs/spec.markdown",
                "docs/deep/note.md"
            ]
        );
        assert!(!found.truncated);
    }

    #[test]
    fn search_is_literal_ignores_case_and_reports_lines() {
        let dir = sample();
        let mut files = Vec::new();
        let summary = search(&dir.0, "invoice", || true, |file| files.push(file));
        assert_eq!(
            summary,
            SearchSummary {
                files: 2,
                hits: 3,
                truncated: false,
                cancelled: false
            }
        );
        assert_eq!(files.len(), 2);
        assert!(files[0].path.ends_with("readme.md"));
        assert_eq!(
            files[0].hits,
            [Hit {
                line: 3,
                text: "An Invoice for March.".into()
            }]
        );
        assert!(files[1].path.ends_with("spec.markdown"));
        assert_eq!(
            files[1].hits.iter().map(|h| h.line).collect::<Vec<_>>(),
            [2, 3]
        );
    }

    #[test]
    fn search_treats_the_query_as_text_not_a_pattern() {
        let dir = Scratch::new("literal");
        dir.write("a.md", "price is $5.00 (net)\nprice is 5000\n");
        let mut files = Vec::new();
        let summary = search(&dir.0, "$5.00 (", || true, |file| files.push(file));
        assert_eq!(summary.hits, 1);
        assert_eq!(files[0].hits[0].line, 1);
    }

    #[test]
    fn search_stops_when_it_is_no_longer_current_and_ignores_blank_queries() {
        let dir = sample();
        let mut files = Vec::new();
        let summary = search(&dir.0, "invoice", || false, |file| files.push(file));
        assert!(summary.cancelled);
        assert!(files.is_empty());
        assert_eq!(
            search(&dir.0, "   ", || true, |_| panic!("no search")),
            SearchSummary::default()
        );
    }

    #[test]
    fn a_walk_that_is_no_longer_wanted_stops_without_meeting_a_markdown_file() {
        let dir = Scratch::new("abandon");
        for n in 0..20 {
            dir.write(&format!("d{n:02}/data.txt"), "x");
        }
        let looked = std::cell::Cell::new(0);
        let cut = walk_markdown(
            &dir.0,
            || {
                looked.set(looked.get() + 1);
                looked.get() <= 3
            },
            |_| panic!("no Markdown here"),
        );
        assert!(!cut);
        assert_eq!(looked.get(), 4);
    }

    #[cfg(unix)]
    #[test]
    fn a_linked_file_is_reported_under_the_path_it_opens_as() {
        let dir = Scratch::new("link");
        dir.write("real/target.md", "needle\n");
        std::os::unix::fs::symlink(dir.0.join("real/target.md"), dir.0.join("alias.md")).unwrap();
        let mut files = Vec::new();
        search(&dir.0, "needle", || true, |file| files.push(file));
        let expected = dir.0.join("real/target.md").to_string_lossy().into_owned();
        assert_eq!(
            files.iter().map(|f| f.path.clone()).collect::<Vec<_>>(),
            [expected.clone(), expected]
        );
    }

    #[test]
    fn search_caps_the_hits_of_one_file() {
        let dir = Scratch::new("cap");
        dir.write("big.md", &"needle\n".repeat(MAX_HITS_PER_FILE + 50));
        let mut files = Vec::new();
        let summary = search(&dir.0, "needle", || true, |file| files.push(file));
        assert_eq!(summary.hits, MAX_HITS_PER_FILE);
        assert_eq!(files[0].hits.len(), MAX_HITS_PER_FILE);
    }

    #[test]
    fn long_lines_are_cut_to_a_window_around_the_match() {
        let line = format!("{}needle{}", "a ".repeat(300), " b".repeat(300));
        let hits = matching_lines(&line, "needle", 10);
        let text = &hits[0].text;
        assert!(text.contains("needle"));
        assert!(text.starts_with('…') && text.ends_with('…'));
        assert!(text.chars().count() <= MAX_LINE_CHARS + 2);
        // Multi-byte text around the match must not split a character.
        let accented = format!("{}Ünïcödé needle{}", "é".repeat(400), "ü".repeat(400));
        assert!(matching_lines(&accented, "needle", 10)[0]
            .text
            .contains("needle"));
    }
}
