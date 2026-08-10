# vscode-ctrmml

VS Code extension + LSP for ctrmml.

If you prefer Zed, see https://github.com/ulalume/zed-ctrmml

> ⚠️ **Early Development**: This project is in active development and features may be incomplete.

## Features

- Tree-sitter syntax highlighting for MML.
- LSP completions: metadata keywords and values (including `#timesig` / `#group`), MML commands, platform values, PCM file paths, and the PCM instrument list at `@N pcm`.
- Chord, dyad, and (opt-in) arpeggio completions on track lines; chord bodies are stacked upward by default.
- Measure fill: typing `|` offers rests to complete the current measure.
- FM instrument completion: auto-scan workspace for instrument files (.dmp, .fui, .fur, .gin, .ginpkg, etc.) and insert FM parameters as MML. Multi-patch files use two-step selection (file → patch). Re-picking a patch replaces the previously inserted parameter block.
- Code Actions: play, play from cursor, stop, export vgm/wav, mdslink, quickrom.

## Usage

- Code Actions: macOS `Cmd + .`, Windows/Linux `Ctrl + .`.
- Run commands from the Code Actions list in an `.mml` file.
- Default keyboard shortcuts:
  - Play: macOS `Cmd + Alt + Shift + P`, Windows/Linux `Ctrl + Alt + Shift + P`.
  - Play from cursor: macOS `Cmd + Alt + P`, Windows/Linux `Ctrl + Alt + P`.
  - Stop: macOS `Cmd + Alt + .`, Windows/Linux `Ctrl + Alt + .`.

## Settings

Settings are read when the language server starts — reload the window after changing them.

| Setting | Default | Description |
| --- | --- | --- |
| `ctrmml.languageServer.path` | `""` | Path to the ctrmml-lsp binary. If empty, the extension downloads it automatically. |
| `ctrmml.languageServer.args` | `[]` | Command-line arguments passed to ctrmml-lsp. |
| `ctrmml.languageServer.env` | `{}` | Extra environment variables passed to ctrmml-lsp. |
| `ctrmml.languageServer.initializationOptions` | `null` | Initialization options for ctrmml-lsp. |
| `ctrmml.completion.arpeggio.enabled` | `false` | Enable arpeggio (broken-chord) completions when typing a note letter on a track line. |
| `ctrmml.completion.arpeggio.pattern` | `"up"` | Traversal pattern for arpeggio completions: `up`, `down`, `updown`, `downup`, or `alberti`. Only used when arpeggio is enabled. |
| `ctrmml.completion.chordStackMode` | `"stack_up"` | How chord and dyad completion bodies are voiced: `stack_up` (octave-carrying) or `plain` (close voicing). |
| `ctrmml.completion.fmPickerHierarchy` | `"auto"` | Style of the FM instrument picker on `@N fm` lines. `auto` lets the server decide (VS Code gets the two-step file → patch picker); `on`/`off` force it. |

`ctrmml.languageServer.initializationOptions` is merged over the `ctrmml.completion.*` settings and wins per field (snake_case or camelCase spelling), and may also carry other server options such as `command_path` / `ym2612_convert_path`.

### Completion changes in language server v0.6.9

- Chord and dyad completion bodies now default to the stacked, octave-carrying form (e.g. `f/a/>c`). Set `ctrmml.completion.chordStackMode` to `plain` to restore the old close voicing (`f/a/c`).
- Meta values (`#platform`, `#option`, `#timesig`, `#group`) insert with an explicit replace range: accepting a suggestion replaces the value token you were typing instead of appending to it.
- Re-picking an FM instrument on an `@N fm` line replaces the previously inserted parameter block instead of leaving a duplicate behind.

## Install

Download the latest VSIX from GitHub Releases:
https://github.com/ulalume/vscode-ctrmml/releases/latest

Install it in VS Code:

```sh
code --install-extension /path/to/vscode-ctrmml-vX.Y.Z.vsix
```

Or use the UI:

- Extensions view -> "..." menu -> Install from VSIX...

## Dependencies

- tree-sitter: https://github.com/ulalume/tree-sitter-ctrmml
- language-server: https://github.com/ulalume/language-server-ctrmml
- cmd: https://github.com/ulalume/ctrmml-cmd
- ym2612_format: https://github.com/ulalume/ym2612_format

## License

MIT
