//! Payment requests the payer accepts: exactly one ZIP-321 payment, to a shielded
//! receiver on this network, with an amount, no memo, nothing else, and no more than
//! the caller's ceiling.

use anyhow::{anyhow, bail, Result};
use zcash_keys::address::Address;
use zcash_protocol::consensus::Parameters;
use zcash_protocol::value::Zatoshis;
use zcash_protocol::{PoolType, ShieldedPool};
use zip321::TransactionRequest;

use fare_scanner::zec::format_zec;

#[derive(Debug)]
pub struct PayRequest {
    pub recipient: Address,
    /// The recipient as written in the URI.
    pub recipient_str: String,
    pub amount: Zatoshis,
}

pub fn check_uri<P: Parameters>(params: &P, uri: &str, max_zat: u64) -> Result<PayRequest> {
    let uri = uri.trim();
    if !uri.starts_with("zcash:") {
        bail!("not a payment URI: it must start with zcash:");
    }
    let request = TransactionRequest::from_uri(uri).map_err(|e| anyhow!("malformed payment URI: {e}"))?;
    let payments = request.payments();
    if payments.len() != 1 {
        bail!("payment URI must name exactly one recipient, found {}", payments.len());
    }
    let payment = payments.values().next().ok_or_else(|| anyhow!("payment URI names no recipient"))?;

    if payment.memo().is_some() {
        bail!("payment URI carries a memo; Fare URIs never do, refusing");
    }
    if payment.label().is_some() || payment.message().is_some() || !payment.other_params().is_empty() {
        bail!("payment URI carries parameters other than address and amount, refusing");
    }

    let amount = payment.amount().ok_or_else(|| anyhow!("payment URI has no amount"))?;
    if amount == Zatoshis::ZERO {
        bail!("payment URI amount is zero");
    }
    if u64::from(amount) > max_zat {
        bail!(
            "amount {} ZEC is above --max-zec {} ZEC, refusing",
            format_zec(u64::from(amount)),
            format_zec(max_zat)
        );
    }

    let zaddr = payment.recipient_address().clone();
    let recipient_str = zaddr.to_string();
    let recipient = Address::try_from_zcash_address(params, zaddr)
        .map_err(|e| anyhow!("recipient is not an address for this network: {e}"))?;
    let shielded = recipient.can_receive_as(PoolType::Shielded(ShieldedPool::Orchard))
        || recipient.can_receive_as(PoolType::Shielded(ShieldedPool::Sapling));
    if !shielded {
        bail!("recipient has no shielded receiver, refusing to pay a transparent address");
    }

    Ok(PayRequest { recipient, recipient_str, amount })
}
