//! Agent Tools
//!
//! Tools for the terminal agent, including Rig.rs tools and
//! tool definitions for Anthropic's native tool_use API.

pub mod definitions;
mod history_query;
mod shell_execute;
mod state_query;

pub use definitions::{build_tool_definitions, ExecuteShellInput, QueryHistoryInput, QueryStateInput, ToolDefinition};
pub use history_query::HistoryQueryTool;
pub use shell_execute::ShellExecuteTool;
pub use state_query::StateQueryTool;
