//! Rune CLI - Generate scaffolded code from .rune specs

use std::io;
use std::path::PathBuf;
use std::process::ExitCode;

use clap::{CommandFactory, Parser, Subcommand, ValueHint};
use clap_complete::{generate, Shell};

use rune_cli::commands;

#[derive(Parser)]
#[command(name = "rune-syntax")]
#[command(about = "Rune syntax tooling (parse/validate/format/render) — internal helper invoked by the `rune` CLI; codegen lives in the rune engine")]
#[command(version)]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Validate a .rune file
    Validate {
        /// Input .rune file
        #[arg(value_hint = ValueHint::FilePath)]
        input: PathBuf,
    },

    /// Format a .rune file
    Format {
        /// Input .rune file
        #[arg(value_hint = ValueHint::FilePath)]
        input: PathBuf,

        /// Check if file is formatted without modifying it
        #[arg(long)]
        check: bool,
    },

    /// Initialize a new rune project
    Init {
        /// Project name
        name: String,

        /// Configuration to use
        #[arg(short, long, default_value = "ts-deno-native-class-validator-esm", value_parser = ["ts-deno-native-class-validator-esm"])]
        config: String,
    },

    /// Install Rune (LSP, parser, editor integration)
    Install {
        /// Skip interactive prompts (defaults to neovim, zsh, yazi)
        #[arg(short = 'y', long = "yes")]
        yes: bool,
    },

    /// Uninstall Rune (remove LSP, parser, editor integration)
    Uninstall {
        /// Editor to unconfigure
        #[arg(short, long, value_parser = ["neovim", "helix", "vscode", "zed", "sublime", "emacs"])]
        editor: Option<String>,
    },

    /// Generate shell completions
    Completions {
        /// Shell to generate completions for
        #[arg(value_enum)]
        shell: Shell,
    },

    /// Render a .rune file as beautiful HTML for embedding
    Render {
        /// Input .rune file
        #[arg(value_hint = ValueHint::FilePath)]
        input: PathBuf,

        /// Output HTML file (defaults to stdout)
        #[arg(short, long, value_hint = ValueHint::FilePath)]
        output: Option<PathBuf>,
    },
}

fn main() -> ExitCode {
    let cli = Cli::parse();

    match cli.command {
        Commands::Validate { input } => {
            match commands::validate(&input) {
                Ok(errors) => {
                    if errors.is_empty() {
                        println!("No errors found");
                        ExitCode::SUCCESS
                    } else {
                        for error in &errors {
                            println!("{}:{}: {}", input.display(), error.line, error.message);
                        }
                        ExitCode::FAILURE
                    }
                }
                Err(e) => {
                    eprintln!("Error: {}", e);
                    ExitCode::FAILURE
                }
            }
        }

        Commands::Format { input, check } => {
            match commands::format(&input, check) {
                Ok(is_formatted) => {
                    if check {
                        if is_formatted {
                            println!("File is properly formatted");
                            ExitCode::SUCCESS
                        } else {
                            println!("File needs formatting");
                            ExitCode::FAILURE
                        }
                    } else {
                        println!("Formatted {}", input.display());
                        ExitCode::SUCCESS
                    }
                }
                Err(e) => {
                    eprintln!("Error: {}", e);
                    ExitCode::FAILURE
                }
            }
        }

        Commands::Init { name, config } => {
            match commands::init(&name, &config) {
                Ok(()) => ExitCode::SUCCESS,
                Err(e) => {
                    eprintln!("Error: {}", e);
                    ExitCode::FAILURE
                }
            }
        }

        Commands::Install { yes } => {
            match commands::install(yes) {
                Ok(()) => ExitCode::SUCCESS,
                Err(e) => {
                    eprintln!("Error: {}", e);
                    ExitCode::FAILURE
                }
            }
        }

        Commands::Uninstall { editor } => {
            let editor = editor.and_then(|e| commands::Editor::from_str(&e));
            match commands::uninstall(editor) {
                Ok(()) => ExitCode::SUCCESS,
                Err(e) => {
                    eprintln!("Error: {}", e);
                    ExitCode::FAILURE
                }
            }
        }

        Commands::Completions { shell } => {
            generate(shell, &mut Cli::command(), "rune-syntax", &mut io::stdout());
            ExitCode::SUCCESS
        }

        Commands::Render { input, output } => {
            match commands::render(&input, output.as_deref()) {
                Ok(()) => ExitCode::SUCCESS,
                Err(e) => {
                    eprintln!("Error: {}", e);
                    ExitCode::FAILURE
                }
            }
        }
    }
}
