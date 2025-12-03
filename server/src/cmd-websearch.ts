import type { WebSearchCommand } from "./command-types.js";
import { handleGoogleSearch } from "./search.js";
import { registerCommand } from "./command-registry.js";
import { CommandError } from "./errors.js";
import type { CommandContext, CommandHandlerResult } from "./command-context.js";
import { CommandWithArgs } from "./command.js";


function cmdWebsearch()
{
  function parseWebSearch(command: CommandWithArgs): WebSearchCommand {
    const query = command.args.query;
    if (!query || !query.trim()) {
      throw new CommandError("/websearch requires query=\"...\".");
    }
    return { commandId: "websearch", query: query.trim() };
  }

  async function handleWebsearch(
    command: CommandWithArgs,
    _ctx: CommandContext
  ): Promise<CommandHandlerResult> {
    const parsed = parseWebSearch(command);
    const query = parsed.query;

    try {
      console.log("Starting Google Custom Search", { query });
      const { snippets } = await handleGoogleSearch(query);
      console.log("Google Custom Search finished", { query, snippetCount: snippets.length });
      const count = snippets.length;
      const summary = count === 0
        ? `Web search found no results for "${query}".`
        : `Web search found ${count} result${count === 1 ? "" : "s"} for "${query}".`;
      return {
        message: summary,
        data: {
          query,
          searchResults: snippets
        }
      };
    } catch (error) {
      return {
        message: error instanceof Error ? error.message : String(error),
        stopProcessingCommands: true
      };
    }
  }

  return { commandId: "websearch", positionalKey: "query", parser: parseWebSearch, handler: handleWebsearch };
}
registerCommand(cmdWebsearch());
