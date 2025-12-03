# Copilot Coding Guidelines for Travelr

## Data Design
- **Journal**: Append-only log of commands that compiles to a TripModel (source of truth)
- **Conversation**: Sliding window of chat log entries for GPT context
- The app must work if the chatbot is unavailable (commands still function)
- The chatbot must work if web search is unavailable (graceful degradation)

## Error Handling
- Use `CommandError` for user-facing errors in command handlers, not plain `Error`
- `CommandError` includes a `statusCode` for HTTP responses

## Module Design
- Keep utility modules "pure" - they should not have domain knowledge
- Example: `ClientDataCache` knows nothing about trips or models; `cache-population.ts` knows how to populate it
- Example: `LazyFile` is a generic cached file wrapper; domain-specific files use it

## Comments
- File header or class header explainers are fine
- Not every function needs a comment - the function name should explain it.
- Unexpected nuances or "policies of use" deserve big comments with "WARNING" in them
- Example: LazyFile's requirement to never reassign `data`

## Command Handler Results
- Use `message` for simple text responses to the user
- Use `data` only for structured data the client actually needs
- Use `stopProcessingCommands: true` to halt batch processing on errors
- Don't create special response fields (like `help`, `summary`) when `message` suffices

## LazyFile Pattern
- LazyFile provides in-memory caching with debounced delayed writes
- Always mutate `data` in place, never reassign it
- Call `setDirty(data)` after mutations - it verifies you passed the same object
- The `__dataVerifier` field catches accidental reassignment

## ClientDataCache Pattern
- Server-side: `user.clientDataCache.set("key", value)` to queue data for client
- Automatically included in responses when dirty
- Client completely replaces its cache when receiving new data
- Use `cache-population.ts` helpers to populate common data (trips, models)

## Naming Conventions
- Data directories: `dataTrips/`, `dataUsers/`, `dataUserPrefs/`, `dataConfig/`
- Command handlers: `cmd-*.ts`
- API routers: `api-*.ts`
- One-off data manipulations of any complexity should be done with a `*.ts` of `*.js` script in `/scripts` - try not to make lots of module includes.

## Command Architecture
- Each `cmd-*.ts` file owns its command's parsing and handling
- Exception: `TripModelCompiler` centralizes journal-to-model compilation for easier debugging
- Command handlers return `CommandHandlerResult`, not raw response objects

## TypeScript
- Prefer explicit types over `any`
- Use `type` imports when importing only types
- Run `npx tsc --noEmit` to verify changes compile

## Testing Changes
- Server: `cd server && npx tsc --noEmit`
- Client has some pre-existing errors in `view-plan.ts` - ignore those

## Data Authority
- I generally prefer "single point of authority" for all data
- Copying and caching is acceptable if done carefully, and var naming clearly idnicates the non-authoritative status of, eg "dataCache".

## Code Paths and Early Exit
- I dislike early exit, if the following code will handle the case.
- For example, if array a is [], and that implies no further processing will be done, I would not choose to test for it and return. I'd let it continue, and have one and only one code path, to improve debugging and maintenance

## Web policy
- On web servers, although atomic "get request, read file, write file, respond" is the standard, we are caching data because this is always going to be a single-server, single instance project. And we want to save $ on AWS S3.

## Running Dev Servers
- In this project, I leave the dev servers running pretty much all the time, with auto-restart, so you don't have to start them. They're already up.

## Testing HTTP Endpoints
- Use `scripts/post.ts` for quick HTTP tests against the running dev server
- Because PowerShell mangles JSON quotes, wrap in `cmd /c`:
  - `cmd /c 'npx tsx scripts/post.ts /ping'`
  - `cmd /c 'npx tsx scripts/post.ts /api/mcp "{\"jsonrpc\":\"2.0\",\"method\":\"tools/list\",\"id\":1}"'`
- No body = GET, with body = POST

## Testing
- All test scripts live in ./tests
- They all have "test-*" as their file pattern

## Password Management
- Passwords are hashed with scrypt using a random salt, stored as `salt:hash` in `dataUsers/users.json`
- Use `scripts/hashPassword.ts <password>` to generate a new hash
- Use `scripts/verifyPassword.ts <password> --user <username>` to verify a password matches
- The salt is random per hash, so you can't compare hashes directly - use verifyPassword

## Windows Shell
- If you're trying to accomplish anything in a windows shell, strongly consider writing a js script instead and running that!
- Even inside tools, use node calls instead of CLI, when possible!
