# lit-graph

Generate interactive component graphs from Lit web component projects. Scans your source files, extracts component relationships, and outputs a self-contained HTML visualization.

![Example graph showing sr-app routing to child components](https://img.shields.io/badge/components-6-blue) ![Example edges](https://img.shields.io/badge/connections-5-teal)

## What it does

- Parses **Lit 2** and **Lit 3** components (both JS and TS)
- Extracts tag names, properties, internal state, events, and child component usage
- Builds a directed graph of parent → child rendering relationships
- Outputs a single HTML file with an interactive [Cytoscape.js](https://js.cytoscape.org/) visualization

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
git clone <repo-url> lit-graph
cd lit-graph
npm install
```

## Usage

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

### CLI options

| Option | Default | Description |
|---|---|---|
| `[directory]` | `.` | Root directory to scan |
| `-g, --glob <pattern>` | `**/*.{ts,js}` | Glob pattern for source files |
| `-o, --output <file>` | `lit-graph.html` | Output HTML file path |
| `-e, --exclude <patterns...>` | `node_modules`, `dist`, `*.d.ts` | Glob patterns to exclude |
| `-t, --title <title>` | `Lit Component Graph` | Title shown in the HTML page |

## Reading the graph

- **Blue nodes** — root components (render children, not rendered by others)
- **Teal nodes** — container components (render children and are rendered by a parent)
- **Green nodes** — leaf components (rendered by a parent, no children)
- **Edge labels** — show property bindings (`.prop`) and event bindings (`@event`) between components
- **Click a node** to see its properties, state, events, and connections in the sidebar
- **Search** to filter/highlight components by tag name or class name
- **PNG** button exports the graph as an image

## How it works

```
file-scanner     — finds .ts/.js files via fast-glob
       |
lit-parser       — Babel AST extracts component metadata (decorators, static
       |           properties, template literals, dispatchEvent calls)
       |
template-parser  — htmlparser2 extracts child custom elements and bindings
       |           from html`` tagged template literals
       |
graph-builder    — assembles nodes (components) and edges (parent renders child)
       |
html-generator   — produces a self-contained HTML file with Cytoscape.js + Dagre
```

## Limitations

- **Dynamic tag names** (`customElements.define(variable, Class)`) cannot be resolved statically and are skipped.
- **Property types** are extracted from decorator options (`{ type: String }`) but not from TypeScript type annotations.
- **Computed templates** — if a component builds its template string programmatically rather than using `html\`\``, child components won't be detected.
- **Cross-file base classes** — if a component extends a custom base class (not `LitElement` directly), the base class name must contain "Element" or "Lit" to be recognized.

## License

MIT
