//! lightwalletd access. Every call here is wholesale: the latest height, a contiguous
//! block range, or the whole mempool. None of them names a transaction, an address or
//! a key, so the server learns only that this IP is scanning.

use anyhow::{Context, Result};
use tonic::transport::{Channel, ClientTlsConfig, Endpoint};
use zcash_client_backend::proto::compact_formats::{CompactBlock, CompactTx};
use zcash_client_backend::proto::service::compact_tx_streamer_client::CompactTxStreamerClient;
use zcash_client_backend::proto::service::{BlockId, BlockRange, ChainSpec, GetMempoolTxRequest, PoolType};

pub type Client = CompactTxStreamerClient<Channel>;

pub fn default_server(network: &str) -> &'static str {
    match network {
        "test" => "https://testnet.zec.rocks:443",
        _ => "https://lightwalletd.mainnet.cipherscan.app:443",
    }
}

pub async fn connect(url: &str) -> Result<Client> {
    let mut endpoint = Endpoint::from_shared(url.to_owned()).context("bad server URL")?;
    if url.starts_with("https://") {
        endpoint = endpoint
            .tls_config(ClientTlsConfig::new().with_webpki_roots())
            .context("TLS setup")?;
    }
    let channel = endpoint
        .connect()
        .await
        .with_context(|| format!("cannot reach lightwalletd at {url}"))?;
    Ok(CompactTxStreamerClient::new(channel).max_decoding_message_size(32 * 1024 * 1024))
}

pub async fn tip(client: &mut Client) -> Result<u64> {
    Ok(client.get_latest_block(ChainSpec {}).await?.into_inner().height)
}

/// Pool filter. Empty means the server's default (shielded pools only). Asking for
/// transparent data too lets the scanner flag payments funded from transparent inputs;
/// servers that predate pool filters reject it, and the caller falls back.
fn pools(with_transparent: bool) -> Vec<i32> {
    if with_transparent {
        vec![PoolType::Transparent as i32, PoolType::Orchard as i32, PoolType::Ironwood as i32]
    } else {
        Vec::new()
    }
}

pub async fn blocks(
    client: &mut Client,
    start: u64,
    end: u64,
    with_transparent: bool,
) -> Result<tonic::Streaming<CompactBlock>> {
    let range = BlockRange {
        start: Some(BlockId { height: start, hash: Vec::new() }),
        end: Some(BlockId { height: end, hash: Vec::new() }),
        pool_types: pools(with_transparent),
    };
    Ok(client.get_block_range(range).await?.into_inner())
}

pub async fn mempool(client: &mut Client, with_transparent: bool) -> Result<tonic::Streaming<CompactTx>> {
    let req = GetMempoolTxRequest { exclude_txid_suffixes: Vec::new(), pool_types: pools(with_transparent) };
    Ok(client.get_mempool_tx(req).await?.into_inner())
}
