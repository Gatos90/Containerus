//! Rig-Based Agent Executor
//!
//! Uses the Rig framework's AgentBuilder to create agents with tool support.
//! This properly leverages Rig's built-in provider abstraction and multi-turn
//! tool execution instead of manually implementing tool calling per provider.

use std::sync::Arc;

use futures::StreamExt;
use rig::agent::{AgentBuilder, MultiTurnStreamItem};
use rig::client::{CompletionClient, ProviderClient};
use rig::providers::{anthropic, ollama, openai};
use rig::streaming::{StreamedAssistantContent, StreamingPrompt};
use tokio::sync::{mpsc, RwLock};

use crate::agent::events::{AgentEvent, ChunkType, QueryCompletionStatus};
use crate::agent::session::{ConversationTurn, TerminalContext, TurnToolCall};
use crate::agent::summarizer::{summarize_user_input, InputSummary};
use crate::agent::tools::{HistoryQueryTool, ShellExecuteTool, StateQueryTool};
use crate::ai::{AiProviderType, AiSettings};
use crate::commands::terminal::TerminalSessions;

/// Get the system prompt for agentic terminal assistance
fn get_agentic_preamble(context: &TerminalContext) -> String {
    // Build command history summary and session status
    let history_count = context.command_history.len();
    let (session_status, history_summary) = if history_count == 0 {
        (
            "This is a NEW session - no commands have been executed yet.".to_string(),
            String::new(),
        )
    } else {
        let recent: Vec<String> = context
            .command_history
            .iter()
            .rev()
            .take(5)
            .map(|e| {
                let status = match e.exit_code {
                    Some(0) => "✓",
                    Some(_) => "✗",
                    None => "?",
                };
                format!("  [{}] {}", status, e.command)
            })
            .collect();
        (
            format!(
                "This is a CONTINUING session - {} command(s) have already been executed. \
                Use query_history to recall their outputs instead of re-running them!",
                history_count
            ),
            format!(
                "\n## Command History Available\nThese commands were already run (use query_history tool with query_type=\"get_output\" to see their full output):\n{}\n",
                recent.join("\n")
            ),
        )
    };

    // Build conversation history - prefer detailed turn history if available
    let conversation_history = if !context.conversation_turns.is_empty() {
        context.format_conversation_for_preamble()
    } else {
        context.format_summaries_for_preamble()
    };

    // Build container context warning if inside a container
    let container_context = if context.in_container {
        format!(
            r#"
## CONTAINER ENVIRONMENT ACTIVE
You are currently INSIDE a container shell!
- Container: {} (runtime: {})
- OS: {} (container filesystem)
- Shell: {}

IMPORTANT: Use Linux commands (ls, cat, grep, etc.) NOT Windows commands (dir, type, cls).
The host system commands are NOT available here. When the user types 'exit', the container shell will close and you'll return to the host system.
"#,
            context.container_id.as_deref().unwrap_or("unknown"),
            context.container_runtime.as_deref().unwrap_or("unknown"),
            context.os,
            context.shell
        )
    } else {
        String::new()
    };

    // Build git info string
    let git_info = context
        .git_branch
        .as_ref()
        .map(|b| format!("Git branch: {}\n", b))
        .unwrap_or_default();

    // Build recent output string
    let recent_output = if !context.recent_output.is_empty() {
        format!(
            "Recent terminal output:\n```\n{}\n```\n",
            context.get_recent_output(20)
        )
    } else {
        String::new()
    };

    // Build container suffix for OS line
    let container_suffix = if context.in_container {
        " (container)"
    } else {
        ""
    };

    format!(
        r#"You are Agent Mode, an AI agent running within Containerus, the AI terminal.
Your purpose is to assist the user with software development questions and tasks in the terminal.

IMPORTANT: NEVER assist with tasks that express malicious or harmful intent.
IMPORTANT: Your primary interface with the user is through the terminal, similar to a CLI. You cannot use tools other than those that are available in the terminal.

# Bias Toward Action
Always bias toward executing commands to fulfill the user's request. When in doubt, take action rather than asking for permission or explaining how to do it.

## When to RUN commands (most cases):
- User asks for specific information: "which container is running longest?", "what's using port 8080?", "show me disk usage"
- User asks to perform an action: "restart the nginx container", "delete old images", "check the logs"
- User wants to know the current state of something: "are any containers running?", "what branch am I on?"
- Any query that can be answered by running a command - just run it and report the result

## When to provide instructions ONLY (rare):
- User explicitly asks "how do I..." or "what's the command for..."
- User asks about general concepts or best practices
- User is learning and wants explanation, not execution

## Task complexity:
- **Simple tasks**: Run the command immediately, report the result concisely
- **Complex tasks**: If clarification is truly needed, ask briefly. Otherwise, make reasonable assumptions and proceed
- Don't ask about minor details you can judge yourself (e.g., what "recent" means)

# External context
In certain cases, external context may be provided. Most commonly, this will be file contents or terminal command outputs. Take advantage of external context to inform your response, but only if it's apparent that it's relevant to the task at hand.

# Tools
You have access to the following tools. You must *only* use the provided tools.

When invoking any of the given tools, you must abide by the following rules:
NEVER refer to tool names when speaking to the user. For example, instead of saying 'I need to use the execute_shell tool to run your command', just say 'I will run the command'.

For the `execute_shell` tool:
* NEVER use interactive or fullscreen shell commands. For example, DO NOT request a command to interactively connect to a database.
* Use versions of commands that guarantee non-paginated output where possible. For example, when using git commands that might have paginated output, always use the `--no-pager` option.
* Try to maintain your current working directory throughout the session by using absolute paths and avoiding usage of `cd`. You may use `cd` if the User explicitly requests it or it makes sense to do so. Good examples: `pytest /foo/bar/tests`. Bad example: `cd /foo/bar && pytest tests`
* If you need to fetch the contents of a URL, you can use a command to do so (e.g. curl), only if the URL seems safe.
* Use this tool to read files (via cat/head/tail), search (via grep/find), and edit files (via sed/echo/heredoc).
* When reading files, prefer `cat` for full files or `head`/`tail` for specific portions. For very large files, read in chunks.
* When searching, use `grep` for content search and `find` or `ls` for file discovery.
* When editing files, use `sed` for simple substitutions, or `cat` with heredoc for replacing entire file contents.
* For searches, use the current working directory (`.`) as the path if you haven't built up enough knowledge of the directory structure. Do not try to guess paths.
* Make sure to format grep queries as Extended Regular Expressions (ERE). The characters (,),[,],.,*,?,+,|,^, and $ are special symbols and have to be escaped with a backslash to be treated as literal characters.

For the `query_state` tool:
* Use this to get current terminal state: cwd, env, git_branch, git_status, recent_output
* Prefer this over running commands when you just need context information
* Available query types: 'cwd', 'env', 'git_branch', 'git_status', 'recent_output', 'all'

For the `query_history` tool:
* Use this to recall previously executed commands and their outputs
* Query types: 'list' (recent commands), 'search' (find by term), 'get_output' (full output of a command)
* ALWAYS check history before re-running commands - use query_type="get_output" to retrieve previous results
* This is more efficient than re-running commands when you need data from earlier in the session

# Running terminal commands
Terminal commands are one of the most powerful tools available to you.

Use the `execute_shell` tool to run terminal commands. With the exception of the rules below, you should feel free to use them if it aides in assisting the user.

IMPORTANT: NEVER suggest malicious or harmful commands, full stop.
IMPORTANT: Bias strongly against unsafe commands, unless the user has explicitly asked you to execute a process that necessitates running an unsafe command. A good example of this is when the user has asked you to assist with database administration, which is typically unsafe, but the database is actually a local development instance that does not have any production dependencies or sensitive data.
IMPORTANT: NEVER use the `echo` terminal command to output text for the user to read. You should fully output your response to the user separately from any tool calls.

# Coding
Coding is one of the most important use cases for you, Agent Mode. Here are some guidelines that you should follow for completing coding tasks:
* When modifying existing files, make sure you are aware of the file's contents prior to making an edit. Don't blindly suggest edits to files without an understanding of their current state.
* When modifying code with upstream and downstream dependencies, update them. If you don't know if the code has dependencies, use tools to figure it out.
* When working within an existing codebase, adhere to existing idioms, patterns and best practices that are obviously expressed in existing code, even if they are not universally adopted elsewhere.
* To make code changes, use sed commands via `execute_shell` for targeted edits, or use heredoc syntax to replace entire files when needed.
* For new files, use `cat > filename << 'EOF'` with heredoc syntax.
* When editing, try to include enough context in sed patterns to ensure uniqueness within the file.
* Try to limit edits to be scoped to a specific change while still being unique. Prefer to break up multiple semantic changes into multiple commands.

# Large files
When working with large files (over 1000 lines):
* Use `head -n 500 file` or `tail -n 500 file` to read portions
* Use `sed -n '100,200p' file` to read specific line ranges
* Use `wc -l file` to check file size before reading
* Process large files in chunks rather than reading all at once

# Version control
Most users are using the terminal in the context of a project under version control. You can usually assume that the user is using `git`, unless stated otherwise. If you notice that the user is using a different system, like Mercurial or SVN, then work with those systems.

When a user references "recent changes" or "code they've just written", it's likely that these changes can be inferred from looking at the current version control state. This can be done using the active VCS CLI, whether it's `git`, `hg`, `svn`, or something else.

When using VCS CLIs, you cannot run commands that result in a pager - if you do so, you won't get the full output and an error will occur. You must workaround this by providing pager-disabling options (if they're available for the CLI) or by piping command output to `cat`. With `git`, for example, use the `--no-pager` flag when possible (not every git subcommand supports it).

In addition to using raw VCS CLIs, you can also use CLIs for the repository host, if available (like `gh` for GitHub). For example, you can use the `gh` CLI to fetch information about pull requests and issues. The same guidance regarding avoiding pagers applies to these CLIs as well.

# Secrets and terminal commands
For any terminal commands you provide, NEVER reveal or consume secrets in plain-text. Instead, compute the secret in a prior step using a command and store it as an environment variable.

In subsequent commands, avoid any inline use of the secret, ensuring the secret is managed securely as an environment variable throughout. DO NOT try to read the secret value, via `echo` or equivalent, at any point.
For example (in bash): in a prior step, run `API_KEY=$(secret_manager --secret-name=name)` and then use it later on `api --key=$API_KEY`.

If the user's query contains a stream of asterisks, you should respond letting the user know "It seems like your query includes a redacted secret that I can't access." If that secret seems useful in the suggested command, replace the secret with {{{{secret_name}}}} where `secret_name` is the semantic name of the secret and suggest the user replace the secret when using the suggested command.

# Task completion
Pay special attention to the user queries. Do exactly what was requested by the user, no more and no less!

For example, if a user asks you to fix a bug, once the bug has been fixed, don't automatically commit and push the changes without confirmation. Similarly, don't automatically assume the user wants to run the build right after finishing an initial coding task.
You may suggest the next action to take and ask the user if they want you to proceed, but don't assume you should execute follow-up actions that weren't requested as part of the original task.
The one possible exception here is ensuring that a coding task was completed correctly after the edit has been applied. In such cases, proceed by asking if the user wants to verify the changes, typically ensuring valid compilation (for compiled languages) or by writing and running tests for the new logic. Finally, it is also acceptable to ask the user if they'd like to lint or format the code after the changes have been made.

At the same time, bias toward action to address the user's query. If the user asks you to do something, just do it, and don't ask for confirmation first.

# Output formatting
Always format your responses using markdown for maximum readability:

## Structure your responses:
- Use **headers** (##, ###) to organize different sections
- Use **bullet points** or **numbered lists** for steps, options, or multiple items
- Use **bold** for important terms and **inline code** for commands, file names, and technical values
- Use **code blocks** with language syntax highlighting for code snippets and command examples

## Tables:
- ALWAYS use markdown tables when presenting structured or comparative data
- Use tables for: command outputs, comparisons, configurations, option lists, status information
- Keep table cells concise but readable
- Example scenarios that should use tables: container lists, image lists, process lists, file listings, package versions, environment variables, port mappings

## Code and commands:
- Wrap commands in backticks: `docker ps`
- Use fenced code blocks with language hints for multi-line code:
  ```bash
  docker run -d nginx
  ```

## General guidelines:
- Keep responses concise but well-structured
- Summarize long outputs instead of dumping raw terminal text
- Clean up garbled characters or broken formatting from terminal output
- When explaining steps, number them clearly

## Error analysis and log inspection:
When presenting error details, logs, or diagnostic information:
- **Separate technical data from your analysis** - never mix them on the same line
- Present raw technical info (error messages, log lines, stack traces) in **code blocks** or **blockquotes**
- Put your interpretation/explanation in a separate paragraph AFTER the technical details
- Use a clear structure like:
  1. **Summary** - one-line description of what you found
  2. **Details** - the raw technical information (in a code block or structured format)
  3. **Analysis** - your interpretation of what this means and why it happened
  4. **Recommendations** (if applicable) - what actions to take

Example format for error reports:
```
**Found: TLS handshake timeout error**

> `read tcp 172.18.0.2:80->81.29.142.100:43980: i/o timeout`

This indicates a timeout while reading the TLS ClientHello from a connecting client (IP `81.29.142.100`).

**Likely causes:**
- Client connected but didn't complete the TLS handshake
- Network/latency issues between client and server
```

## Session Status
{session_status}
{conversation_history}{container_context}

## Current Context
Current working directory: {cwd}
Shell: {shell}
OS: {os}{container_suffix}
User: {username}@{hostname}
{git_info}{recent_output}{history_summary}"#,
        session_status = session_status,
        conversation_history = conversation_history,
        container_context = container_context,
        cwd = context.cwd,
        shell = context.shell,
        os = context.os,
        container_suffix = container_suffix,
        username = context.username,
        hostname = context.hostname,
        git_info = git_info,
        recent_output = recent_output,
        history_summary = history_summary
    )
}

/// Run an agent query using Rig's built-in tool execution
///
/// This function:
/// 1. Creates the appropriate Rig client based on provider settings
/// 2. Builds an agent with our ShellExecuteTool and StateQueryTool
/// 3. Lets Rig handle the multi-turn tool execution automatically
/// 4. Emits events for frontend updates
pub async fn run_rig_agent(
    settings: &AiSettings,
    query: &str,
    terminal_session_id: &str,
    agent_session_id: &str,
    query_id: &str,
    terminal_sessions: Arc<TerminalSessions>,
    context: Arc<RwLock<TerminalContext>>,
    event_tx: mpsc::Sender<AgentEvent>,
    confirmation_rx: mpsc::Receiver<bool>,
) -> Result<String, String> {
    // Emit thinking event
    let _ = event_tx
        .send(AgentEvent::Thinking {
            session_id: agent_session_id.to_string(),
            query_id: query_id.to_string(),
        })
        .await;

    // Summarize the user input and store it for conversation memory
    // This happens BEFORE running the agent so the preamble includes the summary
    if settings.memory_enabled {
        let summary_result = summarize_user_input(settings, query).await;
        match summary_result {
            Ok(summary) => {
                tracing::info!(
                    "[Agent] Input summarized: '{}' ({} -> {} chars)",
                    summary.summary,
                    summary.original_length,
                    summary.summary.len()
                );
                // Store the summary in context for future reference
                let mut ctx = context.write().await;
                ctx.add_input_summary(summary);
                drop(ctx);
            }
            Err(e) => {
                tracing::warn!("[Agent] Failed to summarize input: {}", e);
                // Still store a truncated version as fallback
                let fallback_summary = InputSummary {
                    summary: if query.len() > 200 {
                        format!("{}...", &query[..200])
                    } else {
                        query.to_string()
                    },
                    timestamp: chrono::Utc::now().timestamp_millis(),
                    original_length: query.len(),
                };
                let mut ctx = context.write().await;
                ctx.add_input_summary(fallback_summary);
                drop(ctx);
            }
        }
    }

    // Create tools with all required state
    let shell_tool = ShellExecuteTool::new(
        terminal_session_id.to_string(),
        agent_session_id.to_string(),
        terminal_sessions,
        event_tx.clone(),
        confirmation_rx,
        context.clone(),
        true, // auto_execute safe commands
    );

    // Set the query ID so the tool can emit proper events
    shell_tool.set_query_id(query_id.to_string()).await;

    let state_tool = StateQueryTool::new(context.clone());
    let history_tool = HistoryQueryTool::new(context.clone());

    // Build context for system prompt
    let ctx = context.read().await;
    let preamble = get_agentic_preamble(&ctx);

    // Log available tools and history count for debugging
    tracing::info!(
        "[Agent] Tools: execute_shell, query_state, query_history | Command history entries: {}",
        ctx.command_history.len()
    );
    if !ctx.command_history.is_empty() {
        for entry in ctx.command_history.iter().rev().take(3) {
            tracing::debug!(
                "[Agent] History: '{}' -> {} bytes output, exit: {:?}",
                entry.command,
                entry.output.len(),
                entry.exit_code
            );
        }
    }
    drop(ctx);

    // Get initial command history count to detect new commands
    let initial_command_count = {
        let ctx = context.read().await;
        ctx.command_history.len()
    };

    // Helper to process streaming items and emit thinking events
    async fn process_stream_item<R: std::fmt::Debug>(
        item: MultiTurnStreamItem<R>,
        event_tx: &mpsc::Sender<AgentEvent>,
        agent_session_id: &str,
        query_id: &str,
        final_response: &mut String,
    ) {
        match item {
            MultiTurnStreamItem::StreamAssistantItem(content) => {
                // Extract text from streaming content and emit as thinking
                let thinking_text = match &content {
                    StreamedAssistantContent::Text(text) => Some(text.text.clone()),
                    StreamedAssistantContent::Reasoning(reasoning) => {
                        // reasoning.reasoning is Vec<String>, join them
                        Some(reasoning.reasoning.join(" "))
                    }
                    StreamedAssistantContent::ReasoningDelta { reasoning, .. } => {
                        Some(reasoning.clone())
                    }
                    StreamedAssistantContent::ToolCall(tc) => {
                        // Log tool call for debugging
                        tracing::debug!("[Agent] Tool call: {} with args: {:?}", tc.function.name, tc.function.arguments);
                        None
                    }
                    StreamedAssistantContent::ToolCallDelta { .. } => None,
                    StreamedAssistantContent::Final(_) => None,
                };

                if let Some(text) = thinking_text {
                    if !text.is_empty() {
                        let _ = event_tx
                            .send(AgentEvent::ResponseChunk {
                                session_id: agent_session_id.to_string(),
                                query_id: query_id.to_string(),
                                chunk_type: ChunkType::Thinking,
                                content: text,
                                is_final: false,
                            })
                            .await;
                    }
                }
            }
            MultiTurnStreamItem::StreamUserItem(_) => {
                // Tool results - already handled by ShellExecuteTool via command_history
            }
            MultiTurnStreamItem::FinalResponse(response) => {
                *final_response = response.response().to_string();
            }
            _ => {
                // Handle any future variants added to the non-exhaustive enum
            }
        }
    }

    // Create Rig agent based on provider and execute with streaming
    let result: Result<String, String> = match settings.provider {
        AiProviderType::Anthropic => {
            // Create Anthropic client with explicit type annotation for HTTP client
            let client: anthropic::Client = anthropic::Client::new(
                &settings.api_key.clone().unwrap_or_default()
            ).map_err(|e| format!("Failed to create Anthropic client: {}", e))?;
            let model = client.completion_model(&settings.model_name);
            let agent = AgentBuilder::new(model)
                .preamble(&preamble)
                .tool(shell_tool)
                .tool(state_tool)
                .tool(history_tool)
                .build();

            // Use streaming API to capture intermediate reasoning
            // stream_prompt().multi_turn().await returns the stream directly
            let mut stream = agent.stream_prompt(query).multi_turn(10).await;

            let mut final_response = String::new();
            while let Some(item_result) = stream.next().await {
                match item_result {
                    Ok(item) => {
                        process_stream_item(
                            item,
                            &event_tx,
                            agent_session_id,
                            query_id,
                            &mut final_response,
                        )
                        .await;
                    }
                    Err(e) => {
                        return Err(format!("Streaming error: {}", e));
                    }
                }
            }
            Ok(final_response)
        }
        AiProviderType::OpenAi => {
            // Create OpenAI client with explicit type annotation for HTTP client
            let client: openai::Client = openai::Client::new(
                &settings.api_key.clone().unwrap_or_default()
            ).map_err(|e| format!("Failed to create OpenAI client: {}", e))?;
            let model = client.completion_model(&settings.model_name);
            let agent = AgentBuilder::new(model)
                .preamble(&preamble)
                .tool(shell_tool)
                .tool(state_tool)
                .tool(history_tool)
                .build();

            // Use streaming API to capture intermediate reasoning
            let mut stream = agent.stream_prompt(query).multi_turn(10).await;

            let mut final_response = String::new();
            while let Some(item_result) = stream.next().await {
                match item_result {
                    Ok(item) => {
                        process_stream_item(
                            item,
                            &event_tx,
                            agent_session_id,
                            query_id,
                            &mut final_response,
                        )
                        .await;
                    }
                    Err(e) => {
                        return Err(format!("Streaming error: {}", e));
                    }
                }
            }
            Ok(final_response)
        }
        AiProviderType::Ollama => {
            // Ollama is natively supported in rig-core, defaults to localhost:11434
            // Uses ProviderClient::from_env() since Ollama doesn't need an API key
            let client: ollama::Client = ProviderClient::from_env();
            let model = client.completion_model(&settings.model_name);
            let agent = AgentBuilder::new(model)
                .preamble(&preamble)
                .tool(shell_tool)
                .tool(state_tool)
                .tool(history_tool)
                .build();

            // Use streaming API to capture intermediate reasoning
            let mut stream = agent.stream_prompt(query).multi_turn(10).await;

            let mut final_response = String::new();
            while let Some(item_result) = stream.next().await {
                match item_result {
                    Ok(item) => {
                        process_stream_item(
                            item,
                            &event_tx,
                            agent_session_id,
                            query_id,
                            &mut final_response,
                        )
                        .await;
                    }
                    Err(e) => {
                        return Err(format!("Streaming error: {}", e));
                    }
                }
            }
            Ok(final_response)
        }
    };

    // Save conversation turn for context memory
    // Extract tool calls from command history changes during this turn
    {
        let mut ctx = context.write().await;

        // Get commands that were executed during this turn
        let new_commands: Vec<TurnToolCall> = ctx
            .command_history
            .iter()
            .skip(initial_command_count)
            .map(|entry| {
                // Determine success based on exit code and output content
                let success = entry.exit_code.map(|c| c == 0).unwrap_or(true)
                    && !entry.output.to_lowercase().contains("error:")
                    && !entry.output.to_lowercase().contains("no such container")
                    && !entry.output.to_lowercase().contains("not found");

                // Create result summary - for failures, include error message
                let result_summary = if success {
                    if entry.output.is_empty() {
                        "Success (no output)".to_string()
                    } else {
                        format!("Success: {} chars output", entry.output.len())
                    }
                } else {
                    // Extract first line or error message for failed commands
                    let first_line = entry.output.lines().next().unwrap_or("Unknown error");
                    if first_line.len() > 150 {
                        format!("{}...", &first_line[..150])
                    } else {
                        first_line.to_string()
                    }
                };

                TurnToolCall {
                    tool_name: "execute_shell".to_string(),
                    arguments_summary: entry.command.clone(),
                    result_summary,
                    success,
                }
            })
            .collect();

        let turn = ConversationTurn {
            user_input: query.to_string(),
            tool_calls: new_commands,
            ai_response: result.as_ref().ok().cloned(),
            timestamp: chrono::Utc::now().timestamp_millis(),
        };

        let tool_count = turn.tool_calls.len();
        ctx.add_conversation_turn(turn);
        tracing::info!(
            "[Agent] Saved conversation turn with {} tool calls",
            tool_count
        );
    }

    // Emit response events based on result
    match &result {
        Ok(response) => {
            // NOTE: We don't emit a final ResponseChunk here because the content
            // was already streamed via StreamAssistantItem during the agent loop.
            // Emitting it again would cause duplication.

            // Emit completion event
            let _ = event_tx
                .send(AgentEvent::QueryCompleted {
                    session_id: agent_session_id.to_string(),
                    query_id: query_id.to_string(),
                    status: QueryCompletionStatus::Success,
                    summary: Some(response.clone()),
                    blocks_created: vec![],
                })
                .await;
        }
        Err(error) => {
            // Emit error event
            let _ = event_tx
                .send(AgentEvent::Error {
                    session_id: agent_session_id.to_string(),
                    query_id: Some(query_id.to_string()),
                    error_type: crate::agent::events::AgentErrorType::ProviderUnavailable,
                    message: error.clone(),
                    recoverable: true,
                    suggestion: Some("Check your AI provider settings and try again".to_string()),
                })
                .await;

            // Emit failed completion
            let _ = event_tx
                .send(AgentEvent::QueryCompleted {
                    session_id: agent_session_id.to_string(),
                    query_id: query_id.to_string(),
                    status: QueryCompletionStatus::Failed,
                    summary: Some(format!("Error: {}", error)),
                    blocks_created: vec![],
                })
                .await;
        }
    }

    result
}
