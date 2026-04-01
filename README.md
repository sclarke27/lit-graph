# lit-graph

Generate interactive component graphs from Lit web component projects. Scans your source files, extracts component relationships, and outputs a self-contained HTML visualization. Optionally uses an LLM to group components into meaningful architectural sections.

## What it does

- Parses **Lit 2** and **Lit 3** components (both JS and TS)
- Extracts tag names, properties, internal state, events, and child component usage
- Builds a directed graph of parent → child rendering relationships
- Outputs a single HTML file with an interactive [Cytoscape.js](https://js.cytoscape.org/) visualization
- Optionally analyzes architecture via LLM to create semantic groupings like "Auth Flow", "Dashboard", "Shared UI Kit"

### Supported patterns

| Feature | Lit 3 (decorators) | Lit 2 (static) |
|---|---|---|
| Tag name | `@customElement('my-tag')` | `customElements.define('my-tag', MyTag)` |
| Properties | `@property({ type: String })` | `static properties = { ... }` / `static get properties()` |
| Internal state | `@state()` | `static properties` with `state: true` |
| Child components | `html\`<child-tag .prop=${x}>\`` | same |
| Events out | `this.dispatchEvent(new CustomEvent('name'))` | same |
| Events in | `@eventName=${handler}` in templates | same |

## Setup

Requires **Node.js 18+**.

```bash
git clone https://github.com/sclarke27/lit-graph.git
cd lit-graph
npm install
```

## Usage

### Basic (no LLM)

```bash
# Point it at a directory containing Lit components
node bin/lit-graph.js ./path/to/src

# Specify output file
node bin/lit-graph.js ./src --output my-graph.html

# Custom glob pattern
node bin/lit-graph.js ./src --glob "**/*.{ts,js,tsx,jsx}"

# Exclude additional patterns
node bin/lit-graph.js ./src --exclude "**/test/**" "**/stories/**"

# Set a custom title
node bin/lit-graph.js ./src --title "My Project Components"
```

Then open the generated HTML file in any browser.

### With LLM analysis

Add `--analyze` to enable AI-powered architectural grouping. This sends your component graph to a local Ollama instance which returns semantically meaningful groups.

```bash
# Analyze with default settings (Ollama on localhost, qwen3:32b model)
node bin/lit-graph.js ./src --analyze

# Specify a different Ollama server
node bin/lit-graph.js ./src --analyze --ollama-url http://192.168.1.100:11434

# Use a different model
node bin/lit-graph.js ./src --analyze --model llama3
```

Results are cached — running the same project again skips the LLM call unless the component graph has changed.

### CLI options

| Option | Default | Description |
|---|---|---|
| `[directory]` | `.` | Root directory to scan |
| `-g, --glob <pattern>` | `**/*.{ts,js}` | Glob pattern for source files |
| `-o, --output <file>` | `lit-graph.html` | Output HTML file path |
| `-e, --exclude <patterns...>` | `node_modules`, `dist`, `*.d.ts` | Glob patterns to exclude |
| `-t, --title <title>` | `Lit Component Graph` | Title shown in the HTML page |
| `-a, --analyze` | off | Enable LLM-powered architectural grouping |
| `--ollama-url <url>` | `http://10.0.0.15:11434` | Ollama server URL |
| `--model <name>` | `qwen3:32b` | Ollama model to use |

## Installing Ollama

The `--analyze` feature requires [Ollama](https://ollama.com) running locally or on your network. Ollama runs LLMs on your own hardware — no data leaves your machine.

### macOS

```bash
# Install via Homebrew
brew install ollama

# Or download from https://ollama.com/download/mac

# Start the server
ollama serve

# Pull a model (in a separate terminal)
ollama pull qwen3:32b     # Recommended: best quality, needs ~20GB VRAM
ollama pull llama3         # Alternative: smaller, works on less hardware
ollama pull qwen3:8b       # Lightweight: runs on most machines
```

### Windows

1. Download the installer from [ollama.com/download/windows](https://ollama.com/download/windows)
2. Run the installer — Ollama starts automatically as a system service
3. Open a terminal and pull a model:

```powershell
ollama pull qwen3:32b
```

Ollama runs on `http://localhost:11434` by default.

**Note for WSL users:** WSL cannot reach Windows `localhost` directly. Use the Windows host IP instead:

```bash
# Find the Windows host IP from inside WSL
ip route show default | awk '{print $3}'
# Example output: 172.22.240.1

# Use that IP with lit-graph
node bin/lit-graph.js ./src --analyze --ollama-url http://172.22.240.1:11434
```

To make Ollama accessible from WSL, ensure it's bound to all interfaces. Set the environment variable `OLLAMA_HOST=0.0.0.0` before starting Ollama, or add it to the Ollama service configuration.

### Linux / WSL

```bash
# One-line install
curl -fsSL https://ollama.com/install.sh | sh

# Start the server
ollama serve

# Pull a model (in a separate terminal)
ollama pull qwen3:32b
```

If running Ollama inside WSL and using lit-graph from the same WSL instance, `http://localhost:11434` works directly.

### Model recommendations

| Model | VRAM needed | Quality | Speed |
|---|---|---|---|
| `qwen3:32b` | ~20 GB | Best grouping accuracy | ~30-60s per analysis |
| `llama3` | ~8 GB | Good | ~15-30s |
| `qwen3:8b` | ~5 GB | Acceptable | ~10-20s |
| `gemma3:12b` | ~8 GB | Good | ~15-30s |

Any model that supports JSON output will work. Larger models produce more accurate architectural groupings.

## Reading the graph

### Nodes
- **Blue nodes** — root components (render children, not rendered by others)
- **Teal nodes** — container components (render children and are rendered by a parent)
- **Green nodes** — leaf components (rendered by a parent, no children)

### Edges
- **Arrow direction** — parent renders child
- **Edge labels** — show property bindings (`.prop`) and event bindings (`@event`)

### Toolbar
- **Clusters** — toggle directory/AI grouping. Groups start collapsed; double-click a group to expand it
- **Focus** — select a component, click Focus (or double-click any component) to isolate its neighborhood. Press Escape to exit
- **Depth** — toggle depth filtering with a slider to show only N levels from roots
- **Search** — filter/highlight components by tag name, class name, or group
- **PNG** — export the graph as an image
- **Fit / Reset** — fit graph to viewport or re-run the layout

### Sidebar
Click any component to see its properties, internal state, dispatched events, and connections (renders / rendered by). Click a group to see its description and component list.

### AI-grouped badge
When `--analyze` is used, an "AI-grouped" badge appears. Cluster names come from the LLM's architectural analysis rather than directory structure.

## How it works

```
file-scanner       finds .ts/.js files via fast-glob
     |
lit-parser         Babel AST extracts component metadata (decorators,
     |             static properties, template literals, dispatchEvent)
     |
template-parser    htmlparser2 extracts child custom elements and
     |             bindings from html`` tagged template literals
     |
graph-builder      assembles nodes and edges, computes depth and groups
     |
     |--- (with --analyze) -----------------------------------------
     |                                                               |
     |  arch-signals    detects routes, service imports, shared      |
     |       |          components, path-based role hints            |
     |       v                                                       |
     |  llm-client      sends graph + signals to Ollama, gets back  |
     |       |          semantic groups, validates and caches result |
     |       v                                                       |
     |  applyLlmGrouping   replaces default groups with LLM groups  |
     |                                                               |
     |---------------------------------------------------------------
     |
html-generator     produces a self-contained HTML with Cytoscape.js
```

## Limitations

- **Dynamic tag names** (`customElements.define(variable, Class)`) cannot be resolved statically and are skipped
- **Property types** are extracted from decorator options (`{ type: String }`) but not from TypeScript type annotations
- **Computed templates** — if a component builds its template string programmatically rather than using `html\`\``, child components won't be detected
- **Cross-file base classes** — if a component extends a custom base class (not `LitElement` directly), the base class name must contain "Element" or "Lit" to be recognized
- **LLM grouping** depends on model quality — larger models produce better results. Results are cached so re-runs are instant

## License

MIT
