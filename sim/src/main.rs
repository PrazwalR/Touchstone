use anyhow::{Context, Result, ensure};
use std::{env, fs, path::PathBuf};
use touchstone_replay::{Tape, replay};

fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_writer(std::io::stderr)
        .init();
    let args: Vec<PathBuf> = env::args_os().skip(1).map(PathBuf::from).collect();
    ensure!(
        args.len() == 2,
        "usage: touchstone-replay CONTRACTS_OUT TAPE.json"
    );
    let tape: Tape =
        serde_json::from_slice(&fs::read(&args[1]).context("read tape")?).context("parse tape")?;
    let receipts = replay(&args[0], tape)?;
    println!("{}", serde_json::to_string_pretty(&receipts)?);
    Ok(())
}
