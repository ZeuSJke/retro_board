from app.ai.prompts.title_generation import (
    TITLE_GENERATION_PROMPT,
    TITLE_GENERATION_CONFIG,
)
from app.ai.prompts.summary_generation import (
    SUMMARY_GENERATION_PROMPT,
    SUMMARY_GENERATION_CONFIG,
    generate_summary,
    format_board_data,
)
from app.ai.prompts.workspace_insights import (
    WORKSPACE_INSIGHTS_PROMPT,
    WORKSPACE_INSIGHTS_CONFIG,
    generate_workspace_insights,
)

__all__ = [
    "TITLE_GENERATION_PROMPT",
    "TITLE_GENERATION_CONFIG",
    "SUMMARY_GENERATION_PROMPT",
    "SUMMARY_GENERATION_CONFIG",
    "generate_summary",
    "format_board_data",
    "WORKSPACE_INSIGHTS_PROMPT",
    "WORKSPACE_INSIGHTS_CONFIG",
    "generate_workspace_insights",
]
