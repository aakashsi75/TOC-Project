# Before You Run

A command playground that parses a documented Bash-style subset and previews its effects on a virtual workspace. Built on the project's existing CFG → simplification → CNF → CYK → parse-tree pipeline.

## Project report

[Download the latest TOC project report](docs/CmdPrelude_TOC_Project_Report.docx), including the architecture diagram and debugging screenshots. The [architecture diagram](docs/CmdPrelude_Architecture.png) is also available separately.

## Run

```text
npm install
npm start
```

Open http://127.0.0.1:3000. **Playground** previews commands; **Command conversions** shows the active command’s grammar, simplification, CNF, CYK and formal tree. Grammar Lab is retired from the interface; its old URL redirects to Command conversions. The underlying CFG/RNA modules and existing API endpoints are retained.

## What it does

- Before/after file trees with created, modified, and deleted paths.
- Sample workspace, browser metadata uploads, and local-folder preview/apply without automatic backup copies.
- Basic mode by default: `ls`, `mkdir`, `cp`, `mv`, `rm`, seven grammar rules, no flags or chains. Advanced mode enables the full subset.
- Plain-language command meaning in Playground; formal transformations in Command conversions.
- Commands: `pwd`, `ls`, `cd`, `mkdir`, `touch`, `cp`, `mv`, `rm`, `echo`, `cat`, and literal-substring `grep`.
- Paths, quoted arguments, selected flags, `--`, `&&`, `||`, pipes and recursively nested parenthesized groups.
- Execution trace with exit statuses, skipped branches, stdout, and stderr.
- Candidate syntax repairs checked using the same CFG pipeline.
- Virtual keep/undo/reset; watched-path warnings.
- Parse-tree-to-token highlighting and playback of actual CYK cells.
- Editable command-specific CFG, full/read-only presets, and a token-class reference. The default grammar checks command arity and command-specific flag positions before interpretation.
- Separate authored, useful-symbol, epsilon-free, simplified, and CNF grammar views. The formal tree is explicitly labeled as a simplified-grammar tree.

## Demo sequence

| Command | Demonstration |
| --- | --- |
| `cp notes.txt backup/` | Preview a copy without changing the original snapshot. Keep virtual changes, then undo. |
| `rm -rf build` | Highlight all proposed deletions, including descendants. |
| `rm -rf src` | Show an advisory warning for the watched `/src` folder. |
| `mkdir archive && cp notes.txt archive/` | Two successful steps, with the second using the first step's directory. |
| `cat missing.txt && rm -rf src` | Failure skips deletion. |
| `cat missing.txt || echo "Recovered"` | A fallback runs after failure; the original error is still shown. |
| `cat notes.txt | grep report` | Standard output passes through a pipeline. |
| `cp notes.txt backup/ &&` | Invalid syntax, candidate connector removal, then successful reparse. |

Use Basic mode for the first copy demo. Switch to Advanced for flags, chains and pipes. Open **Command conversions**, select a tree node, and inspect the highlighted command tokens. CYK playback shows the real recorded cells, not a simulated algorithm animation.

## Real folders

Click **Open a real folder**, then **Browse folders…** (Windows) or paste its absolute path and click **Open folder**. This refers to the computer running the Node server. The path fallback works in the in-app browser without browser filesystem permission. Empty directories are preserved.

Opening reads metadata only, without a folder-size limit. SHA-256 content checks stream only the files involved in a proposed apply operation; contents are not returned to the UI or sent to an external service. The local adapter supports up to 100,000 entries, excluding .git, node_modules and .before-you-run-backups. Links and special files are rejected. Browser upload remains available as a clearly labeled preview-only fallback (1,500 entries). Local folder trees start collapsed and expand on click.

For a real folder, every preview takes a fresh snapshot. One successful Basic command at a time can be applied: create a directory, copy a file, move/rename a file or directory, or remove a file. Directory moves containing excluded folders, recursive deletes/copies, flags, chains and custom-only operations remain preview-only. A listing has no changes to apply. Imported contents remain unavailable to virtual cat/grep.

**Review & apply to folder** lists the exact command, root and changed paths. **Apply reviewed changes** performs filesystem operations through Node APIs, never by executing the command in a shell. Before changing files, it checks the preview’s metadata and content fingerprints. Changes are applied directly: no backup directory, duplicate originals or recovery manifest is created. There is no real-folder undo or automatic rollback. A failed operation requires a fresh preview. Existing backup folders from earlier versions are excluded and left untouched. Virtual Undo applies only to the sample/upload workspace.

Folder sessions and single-use preview tokens live only in server memory, expire, and are bounded. Local routes require loopback access, a localhost host, a custom header and a matching browser origin. Changes since preview require a new preview. Native picker cancellation/errors are visible and the path field stays available.

## Language boundaries

The **Your command grammar** editor is sent with every preview. `cp notes.txt backup/` is classified as `cp path path`, not three generic words. Keywords are recognized only at command positions; quoted or unquoted argument keywords remain paths/text as appropriate. Flags have per-command classes. Options must precede operands in the default grammar. `--` ends option processing. The lexer bindings are fixed and listed in the editor; changing grammar rules changes acceptance but does not add token classes or executable behavior.

Start with **Copy only (3 rules)** for a small editable grammar: `COPY -> cp SOURCE DESTINATION`, `SOURCE -> path`, `DESTINATION -> path`. The first non-terminal is the start symbol. For another demo, select **Read-only commands**, then preview `rm notes.txt`: its lexical classes are valid but the active grammar rejects deletion. Switch to **Advanced · full subset** to accept it. Or remove `DESTINATION` from the `COPY` production: the parser can then accept a one-operand copy, while the interpreter still rejects it because copy behavior requires two operands. This separates syntax from semantics.

Custom grammars are limited to 8,000 characters, 48 non-terminals, 120 alternatives, and 6 RHS symbols per alternative. Unsupported terminals and nonproductive start symbols are reported as grammar errors. The simplified grammar is limited to 600 alternatives, and the compiled cache retains at most eight grammars. If an input has multiple parses, the first tree is shown but simulation is disabled; unusual connector shapes the interpreter cannot model are also blocked. Custom productions must describe binary connector groups to simulate flow.

- Up to 512 characters and 40 tokens per command; up to 256 KB of sample content.
- `ls`: zero or one path, `-a` includes stored hidden names (not synthesized `.`/`..` entries), `-l` gives a simplified type/size listing rather than Unix permission metadata.
- `cd`: one path; there is no simulated home directory or `cd -`.
- `mkdir`: one path, optional `-p`; `touch`: one path, no clock or timestamps beyond a touched marker.
- `cp`: one source and destination, optional `-r`/`-R`; `mv`: one source and destination. Existing directory merging/replacement is explicitly unsupported. File overwrites are previewed as modifications.
- `rm`: one path, `-r`/`-R` and `-f`; the virtual root and current directory/ancestors cannot be removed.
- `echo`: literal arguments with optional `-n`, no escape-sequence interpretation.
- `cat`: one file or piped input; unconnected stdin is empty.
- `grep`: one literal substring and an optional file, `-i`/`-v`. No regex interpretation; unconnected stdin is empty.
- Pipes bind tighter than `&&` and `||`; AND/OR lists are left associative. Pipeline exit status is the last stage's status, without `pipefail`. Pipeline directory changes do not escape to the outer environment; virtual file writes persist.
- Each failed individual command is atomic in the simulator. This intentionally differs from commands that can partially modify a real filesystem before failing. Successful earlier steps of a command chain remain in the proposed state.
- No variable or wildcard expansion, command substitution, redirects, comments, background jobs, permissions, ownership, or external executable launching. Unsupported shell syntax is rejected. The default grammar also rejects unsupported commands/flags; if a custom grammar admits them, the interpreter still refuses their behavior.
- Repair candidates close one quote or remove one connector, then validate syntax with CYK. They do not infer intent, promise globally minimal edits, or execute automatically without selection.

This is an educational preview of an explicitly supported language, **not a full shell or a security guarantee**. Kept state, history (up to 20 entries), and undo are in memory; reloading discards them.

## Architecture

| Module | Responsibility |
| --- | --- |
| `src/core/commandSimulator.js` | Lexer with source spans, command grammar, existing pipeline integration, AST extraction, repair candidates, snapshot validation, virtual interpreter, and diffs. No filesystem/process imports. |
| `src/core/commandGrammar.js` | Authored command grammar, read-only preset, fixed lexer token bindings, bounded custom-grammar compilation, and transformation stages using the existing CFG modules. |
| Existing `src/core/*` CFG modules | Grammar parsing, simplification, CNF, CYK, tree reconstruction. |
| `public/workspaceImport.js` | Build a virtual hierarchy from browser-selected metadata. |
| `public/simulator.js` | Folder selection, preview requests, history, comparisons, trace, tree/token interaction, and CYK playback. |
| `public/simulator.css` | Responsive playground design and reduced-motion support. |
| `src/localWorkspace.js` | Local snapshot, root-constrained filesystem operations, stale-preview checks and direct application. |
| `src/server.js` | Existing APIs plus `GET /api/simulator` and `POST /api/simulate`. |

The CFG determines syntactic grouping. Interpreting paths, command flags, exit statuses, and file changes is a separate semantic stage. Do not claim that CYK itself predicts filesystem behavior.

## Tests

Run `npm run test:local-folder` for Basic grammar, binary file copies, direct overwrite/deletion without backups, directory rename, stale previews, excluded paths and link guards. Run `npm run test:simulator` for simulator, snapshot, syntax recovery, chaining, precedence, immutability, and HTTP integration checks. The existing scripts remain available: `test:parser`, `test:simplifier`, `test:cnf`, `test:cyk`, `test:ambiguity`, `test:trees`, `test:compare`, and `test:rna`.

## References and future work

- [GNU Bash: command lists](https://www.gnu.org/software/bash/manual/html_node/Lists.html)
- [GNU Bash: pipelines](https://www.gnu.org/software/bash/manual/html_node/Pipelines.html)
- [GNU Coreutils](https://www.gnu.org/software/coreutils/manual/coreutils.html)

These define reference behavior; the boundaries above document intentional differences. Future work could add richer command models, file-specific explanations, and a broader repair search. The app applies supported file operations directly; arbitrary shell execution remains outside its scope.

## TOC review: nested groups and error recovery

In Advanced mode, `PIPELINE -> FACTOR | PIPELINE pipe FACTOR` and `FACTOR -> COMMAND | lparen S rparen` express recursive grouping. The existing simplification, CNF and CYK functions accept the normalized `lparen`/`rparen` tokens and reconstruct their nesting. The interpreter obtains its group AST from that tree; there is no second command parser. Simple command signatures can be regular, while unbounded balanced nesting requires more than a finite automaton. The application itself bounds commands to 40 tokens / 512 characters.

Use **Nested groups** on the sample workspace: `mkdir archive && (cp notes.txt archive/ || echo "Copy failed")`. The fallback is skipped when copying succeeds. Parentheses isolate cwd changes, preserve file effects, return the enclosed chain’s exit status and compose with pipelines. For example `(cd src && pwd) && pwd` prints `/src` and then `/`. These advanced operations remain preview-only for real folders.

Use **Recover a group** for a missing closing parenthesis. Candidates balance unmatched parentheses, close unfinished quotes or remove one misplaced delimiter/connector. Every offered candidate must pass CYK and produce an unambiguous supported interpretation under the active grammar. Selecting it retains the original rejection, candidate and reparse result in the UI. Missing `cp`/`mv` operands receive explicit source/destination guidance without guessed paths. Syntax acceptance and runtime success remain separate.
