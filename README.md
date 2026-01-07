# vscode-ctrmml

VS Code extension + LSP for ctrmml.

> ⚠️ **Early Development**: This project is in active development and features may be incomplete.

## Features

- Tree-sitter syntax highlighting for MML.
- LSP completions (metadata, commands, platform values, PCM paths).
- Code Actions: play, play from cursor, stop, export vgm/wav.

## Usage

- Code Actions: macOS `Cmd + .`, Windows/Linux `Ctrl + .`.
- Run commands from the Code Actions list in an `.mml` file.
- Default keyboard shortcuts:
  - Play: macOS `Cmd + Alt + Shift + P`, Windows/Linux `Ctrl + Alt + Shift + P`.
  - Play from cursor: macOS `Cmd + Alt + P`, Windows/Linux `Ctrl + Alt + P`.
  - Stop: macOS `Cmd + Alt + .`, Windows/Linux `Ctrl + Alt + .`.

## Use in VS Code

## Settings

- `ctrmml.languageServer.path`: override the language server binary path.
- `ctrmml.languageServer.env`: extra environment variables for the language server.

## Development (local)

```sh
npm run install
npm run compile

code --extensionDevelopmentPath=path/of/vscode-ctrmml
```

## Dependencies

- tree-sitter: https://github.com/ulalume/tree-sitter-ctrmml
- language-server: https://github.com/ulalume/language-server-ctrmml
- cmd: https://github.com/ulalume/ctrmml-cmd

## License

MIT
