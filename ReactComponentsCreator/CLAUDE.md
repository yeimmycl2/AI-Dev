# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

UIGen is an AI-powered React component generator with live preview. It uses Claude AI to generate React components through a chat interface, displays them in a virtual file system, and renders them in real-time without writing to disk.

## Development Commands

### Setup
```bash
npm run setup              # Install dependencies, generate Prisma client, run migrations
```

### Running
```bash
npm run dev                # Start dev server with Turbopack
npm run dev:daemon         # Start dev server in background (logs to logs.txt)
npm run build              # Production build
npm run start              # Start production server
```

### Testing & Linting
```bash
npm run test               # Run all tests with Vitest
npm run lint               # Run ESLint
```

### Database
```bash
npx prisma generate        # Regenerate Prisma client (after schema changes)
npx prisma migrate dev     # Create and apply migrations
npm run db:reset           # Reset database (destructive)
```

## Architecture

### Virtual File System (VFS)

The core of UIGen is the in-memory VFS (`src/lib/file-system.ts`). No files are written to disk during component generation.

- **VirtualFileSystem class**: Implements a tree-based file system with Map-based storage
- Files are stored in `Map<string, FileNode>` where paths are keys
- Supports: create, read, update, delete, rename, directory listing
- **Serialization**: `serialize()` and `deserialize()` methods convert VFS to/from JSON for database storage
- **Text editor commands**: `viewFile()`, `createFileWithParents()`, `replaceInFile()`, `insertInFile()` expose editing operations

### AI Tool Integration

The VFS is integrated with Vercel AI SDK tools (`src/app/api/chat/route.ts`):

1. **str_replace_editor** (`src/lib/tools/str-replace.ts`): LLM tool for viewing/creating/editing files
   - Commands: `view`, `create`, `str_replace`, `insert`
   - Directly operates on the VFS instance

2. **file_manager** (`src/lib/tools/file-manager.ts`): LLM tool for file operations
   - Commands: `rename`, `delete`
   - Handles moving files and recursive directory operations

The chat API endpoint:
- Deserializes VFS from JSON (from database or client)
- Passes VFS instance to tools
- LLM generates/edits components using these tools
- Serializes VFS back to database after completion

### JSX Transformation & Preview

Preview system (`src/lib/transform/jsx-transformer.ts`):

1. **transformJSX()**: Uses `@babel/standalone` to transpile JSX/TSX to browser-compatible JS
   - Detects TypeScript via file extension
   - Applies React preset with automatic runtime
   - Extracts imports and CSS imports

2. **createImportMap()**: Builds ES Module import map for browser
   - Transforms all `.jsx/.tsx` files to blob URLs
   - Maps React packages to `esm.sh` CDN
   - Handles `@/` path aliases (maps to root `/`)
   - Detects third-party packages and routes to `esm.sh`
   - Creates placeholder modules for missing imports
   - Collects CSS from `.css` files
   - Returns errors for files with syntax errors

3. **createPreviewHTML()**: Generates complete HTML document
   - Injects import map as `<script type="importmap">`
   - Includes Tailwind CDN
   - Embeds collected CSS in `<style>` tag
   - Shows formatted syntax errors when present
   - Creates React root and renders with ErrorBoundary

Preview flow: VFS → transform all files → create import map → inject into iframe (`src/components/preview/PreviewFrame.tsx`)

### Data Persistence

**Database** (`prisma/schema.prisma`):
- SQLite with Prisma ORM
- Prisma client generated to `src/generated/prisma/` (not default location)
- **User**: email/password authentication with bcrypt
- **Project**: stores VFS state and chat messages as JSON
  - `userId` is optional (supports anonymous users)
  - `messages`: JSON-serialized chat history
  - `data`: JSON-serialized VFS (`fileSystem.serialize()`)

**Anonymous Users** (`src/lib/anon-work-tracker.ts`):
- Uses cookie-based tracking for unauthenticated sessions
- Creates temporary projects tied to session
- Enables preview without signup

### State Management

**FileSystemContext** (`src/lib/contexts/file-system-context.tsx`):
- Client-side VFS state management
- Provides: `files`, `setFiles`, `selectedFile`, `setSelectedFile`
- Used by editor and preview components

**ChatContext** (`src/lib/contexts/chat-context.tsx`):
- Manages chat messages and streaming state
- Integrates with Vercel AI SDK's `useChat` hook

### LLM Provider Abstraction

**Mock Provider** (`src/lib/provider.ts`):
- If `ANTHROPIC_API_KEY` is not set, falls back to `MockLanguageModel`
- Mock generates static Counter/Form/Card components
- Simulates multi-step tool calls for demonstration
- Enables development/testing without API key

**Real Provider**:
- Uses `@ai-sdk/anthropic` with model `claude-haiku-4-5`
- Configured in `getLanguageModel()`

### Component Structure

- `src/app/` - Next.js App Router pages and API routes
- `src/components/` - React components
  - `auth/` - Authentication forms and dialogs
  - `chat/` - Chat interface, message rendering, markdown
  - `editor/` - File tree and Monaco code editor
  - `preview/` - iframe preview component
  - `ui/` - shadcn/ui components
- `src/lib/` - Core libraries and utilities
  - `contexts/` - React contexts
  - `tools/` - AI SDK tool definitions
  - `transform/` - JSX transformation logic
  - `prompts/` - System prompts for LLM

## Important Notes

- Path aliases: `@/*` maps to `src/*` (tsconfig)
- Prisma client is NOT in default location, it's in `src/generated/prisma/`
- VFS uses absolute paths starting with `/`
- File extensions in import map: all variations are added (with/without `.jsx`, with/without leading `/`, with `@/` prefix)
- Preview uses ES Modules with import maps - no bundler in the browser
- Tests use Vitest with jsdom environment
- The `onFinish` callback in chat route handles database persistence for authenticated users only
- Use comments sparingly. Only comment complex code.
- How does the auth system work? @src/components/auth/AuthDialog.tsx @src/hooks/use-auth.ts @src/lib/auth.ts
- The database schema file is defined in the @prisma/schema.prisma file. Reference it anytime you need to understand the structure of data stored in database.
- vitest config is in vitest.config.mts
