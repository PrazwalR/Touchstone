//! Cancun bytecode replay from a complete local state snapshot and ordered mined calls.
use std::{collections::BTreeMap, fs, path::Path};

use revm::{
    Context, ExecuteCommitEvm, MainBuilder, MainContext,
    bytecode::Bytecode,
    context::{BlockEnv, CfgEnv, TxEnv},
    database::InMemoryDB,
    primitives::{Address, B256, Bytes, Log, TxKind, U256, hardfork::SpecId, keccak256},
    state::AccountInfo,
};
use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum ReplayError {
    #[error("read compiled artifact: {0}")]
    Io(#[from] std::io::Error),
    #[error("parse compiled artifact: {0}")]
    Json(#[from] serde_json::Error),
    #[error("{0}")]
    Invalid(String),
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Tape {
    chain_id: u64,
    hook: Address,
    manager: Address,
    snapshot_block: u64,
    accounts: BTreeMap<Address, Account>,
    block_hashes: BTreeMap<u64, B256>,
    calls: Vec<Call>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Account {
    nonce: u64,
    balance: U256,
    code: Bytes,
    storage: BTreeMap<U256, U256>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Call {
    block: u64,
    timestamp: u64,
    beneficiary: Address,
    block_gas_limit: u64,
    base_fee: u64,
    excess_blob_gas: u64,
    prevrandao: B256,
    caller: Address,
    to: Address,
    nonce: u64,
    value: U256,
    data: Bytes,
    gas_limit: u64,
    gas_price: u128,
    priority_fee: Option<u128>,
    expected: Receipt,
}

#[derive(Debug, Deserialize, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Receipt {
    success: bool,
    gas_used: u64,
    logs: Vec<Log>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Artifact {
    deployed_bytecode: Runtime,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Runtime {
    object: Bytes,
    immutable_references: BTreeMap<String, Vec<Span>>,
}

#[derive(Deserialize)]
struct Span {
    start: usize,
    length: usize,
}

/// Rebuild the runtime with its deployed immutable values. Other bytes must match exactly.
fn bind_runtime(runtime: Runtime, deployed: &Bytes) -> Result<Bytes, ReplayError> {
    let mut compiled = runtime.object.to_vec();
    if compiled.is_empty() || compiled.len() != deployed.len() {
        return Err(ReplayError::Invalid("runtime length mismatch".into()));
    }
    for span in runtime.immutable_references.values().flatten() {
        let end = span
            .start
            .checked_add(span.length)
            .filter(|n| *n <= compiled.len())
            .ok_or_else(|| ReplayError::Invalid("invalid immutable reference".into()))?;
        compiled[span.start..end].copy_from_slice(&deployed[span.start..end]);
    }
    if compiled.as_slice() != deployed.as_ref() {
        return Err(ReplayError::Invalid(
            "deployed bytecode differs from artifact".into(),
        ));
    }
    Ok(compiled.into())
}

pub fn replay(out: &Path, mut tape: Tape) -> Result<Vec<Receipt>, ReplayError> {
    if tape.calls.is_empty() || tape.manager == tape.hook {
        return Err(ReplayError::Invalid(
            "expected calls and distinct hook/manager addresses".into(),
        ));
    }
    for (address, name) in [(tape.hook, "TouchstoneHook"), (tape.manager, "PoolManager")] {
        let account = tape
            .accounts
            .get_mut(&address)
            .ok_or_else(|| ReplayError::Invalid(format!("missing {name}")))?;
        let path = out.join(format!("{name}.sol/{name}.json"));
        let artifact: Artifact = serde_json::from_slice(&fs::read(path)?)?;
        account.code = bind_runtime(artifact.deployed_bytecode, &account.code)?;
    }
    let mut db = InMemoryDB::default();
    for (address, account) in tape.accounts {
        let info = AccountInfo {
            nonce: account.nonce,
            balance: account.balance,
            code_hash: keccak256(&account.code),
            code: Some(Bytecode::new_legacy(account.code)),
            ..Default::default()
        };
        db.insert_account_info(address, info);
        for (slot, value) in account.storage {
            let Ok(()) = db.insert_account_storage(address, slot, value);
        }
    }
    db.cache.block_hashes.extend(
        tape.block_hashes
            .into_iter()
            .map(|(n, h)| (U256::from(n), h)),
    );
    let cfg = CfgEnv::new_with_spec(SpecId::CANCUN).with_chain_id(tape.chain_id);
    let mut evm = Context::mainnet().with_db(db).with_cfg(cfg).build_mainnet();
    let mut receipts = Vec::with_capacity(tape.calls.len());
    let mut previous = tape.snapshot_block;
    for (index, call) in tape.calls.into_iter().enumerate() {
        if call.block < previous || call.block <= tape.snapshot_block {
            return Err(ReplayError::Invalid(format!(
                "call {index}: block out of sequence"
            )));
        }
        previous = call.block;
        evm.ctx.block = BlockEnv {
            number: U256::from(call.block),
            timestamp: U256::from(call.timestamp),
            beneficiary: call.beneficiary,
            gas_limit: call.block_gas_limit,
            basefee: call.base_fee,
            prevrandao: Some(call.prevrandao),
            ..Default::default()
        };
        evm.ctx.block.set_blob_excess_gas_and_price(
            call.excess_blob_gas,
            revm::primitives::eip4844::BLOB_BASE_FEE_UPDATE_FRACTION_CANCUN,
        );
        let tx = TxEnv {
            tx_type: if call.priority_fee.is_some() { 2 } else { 0 },
            chain_id: Some(tape.chain_id),
            caller: call.caller,
            kind: TxKind::Call(call.to),
            nonce: call.nonce,
            value: call.value,
            data: call.data,
            gas_limit: call.gas_limit,
            gas_price: call.gas_price,
            gas_priority_fee: call.priority_fee,
            ..Default::default()
        };
        let result = evm
            .transact_commit(tx)
            .map_err(|e| ReplayError::Invalid(format!("call {index}: {e}")))?;
        let receipt = Receipt {
            success: result.is_success(),
            gas_used: result.tx_gas_used(),
            logs: result.logs().to_vec(),
        };
        if receipt != call.expected {
            return Err(ReplayError::Invalid(format!(
                "call {index}: expected {:?}, replayed {:?}",
                call.expected, receipt
            )));
        }
        tracing::info!(
            index,
            block = call.block,
            gas = receipt.gas_used,
            "matched receipt"
        );
        receipts.push(receipt);
    }
    Ok(receipts)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_immutables_can_differ() {
        let artifact = || Runtime {
            object: Bytes::from_static(&[1, 0, 3]),
            immutable_references: BTreeMap::from([(
                "1".into(),
                vec![Span {
                    start: 1,
                    length: 1,
                }],
            )]),
        };
        assert!(bind_runtime(artifact(), &Bytes::from_static(&[1, 2, 3])).is_ok());
        assert!(bind_runtime(artifact(), &Bytes::from_static(&[2, 2, 3])).is_err());
    }
}
