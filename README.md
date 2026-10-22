# CmdPrelude

A web application for understanding supported Bash-style commands before changing files. The interface is called **Before You Run**.

## Run

```sh
npm install
npm start
```

Open http://localhost:3000. Use **Playground** to preview commands and **Command conversions** to inspect their grammar, CNF, parse tree and CYK steps.

## Features

- Basic commands: `ls`, `mkdir`, `cp`, `mv` and `rm`.
- Advanced mode adds `pwd`, `cd`, `touch`, `echo`, `cat`, literal-substring `grep`, selected flags, pipelines, conditional chains and nested groups.
- Before-and-after file trees, output, errors and an execution trace.
- Editable grammar presets and syntax corrections checked through the same parser.
- Sample workspace with virtual keep, undo and reset; browser metadata import for previews.
- Local-folder previews and reviewed application of supported individual Basic operations.

## Architecture

Commands are tokenised and checked using a context-free grammar. The grammar is simplified and converted to Chomsky Normal Form before CYK recognition and tree reconstruction. A separate interpreter follows the supported parse tree to calculate output and proposed file changes.

| Location | Purpose |
| --- | --- |
| `public/` | Command interface, visualisations, workspace import and SVG tree rendering. |
| `src/core/commandGrammar.js` | Grammar presets, validation and compilation. |
| `src/core/commandSimulator.js` | Tokenisation, tree interpretation, syntax recovery and virtual simulation. |
| Other `src/core/` modules | Grammar parsing, simplification, CNF, CYK and parse-tree algorithms. |
| `src/localWorkspace.js` | Local snapshots, preview checks and reviewed filesystem operations. |
| `src/server.js` | Express server and command/local-folder APIs. |
| `docs/` | [Project report](docs/CmdPrelude_TOC_Project_Report.docx) and [architecture diagram](docs/CmdPrelude_Architecture.png). |

## Limits

Inputs are limited to 512 characters and 40 tokens. Variables, wildcard expansion, command substitution, redirection and arbitrary external programs are unsupported. Custom rules change syntax acceptance, not executable behaviour; ambiguous interpretations are not simulated.

Preview does not execute command text in the operating system. Real-folder changes require explicit review and use Node.js file APIs. Only selected single Basic operations can be applied; advanced commands remain preview-only. Preview fingerprints detect stale folder state. Applied changes have no automatic backup or real-folder undo. Virtual undo only affects the virtual workspace.

## Repository versions

- `main`: application and project documentation without test files.
- [with-tests](https://github.com/aakashsi75/TOC-Project/tree/with-tests): the same application with the complete test suite. Run `npm test` on that branch.

## References

- [GNU Bash manual](https://www.gnu.org/software/bash/manual/bash.html)
- [GNU Coreutils manual](https://www.gnu.org/software/coreutils/manual/coreutils.html)
- [Node.js filesystem API](https://nodejs.org/api/fs.html)
