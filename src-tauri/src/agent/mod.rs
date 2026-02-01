//! AI Agent Module
//!
//! This module provides an AI agent system for the terminal with support for:
//! - Single-turn JSON-based command execution
//! - Multi-turn agentic loops with Anthropic tool_use API
//! - Natural language to shell command translation
//! - Multi-step workflows with command output analysis
//! - Intelligent command execution with safety checks
//! - Conversation memory via input summarization

pub mod events;
pub mod executor;
pub mod providers;
pub mod pty_bridge;
pub mod rig_executor;
pub mod safety;
pub mod session;
pub mod summarizer;
pub mod tools;

// Re-export commonly used types
pub use events::{AgentCommand, AgentEvent};
pub use executor::{run_agent_query, run_agent_simple, run_agentic_loop, ExecutorConfig, ExecutorError};
pub use providers::create_agent;
pub use pty_bridge::{CommandExecution, PtyBridge};
pub use safety::{DangerClassification, DangerClassifier, DangerLevel};
pub use session::{AgentSession, AgentSessionManager, ConversationMessage, TerminalContext};
pub use summarizer::{summarize_user_input, InputSummary};
