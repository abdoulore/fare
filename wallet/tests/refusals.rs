//! Every way `fare-wallet pay` says no, checked offline.

use fare_wallet::cache::MemBlockCache;
use fare_wallet::network::testnet_only;
use fare_wallet::request::check_uri;
use fare_wallet::seed::seed_from_phrase;
use fare_wallet::wallet;

use secrecy::ExposeSecret;
use zcash_client_backend::data_api::chain::{scan_cached_blocks, BlockCache, ChainState};
use zcash_client_backend::proto::compact_formats::{ChainMetadata, CompactBlock};
use zcash_client_backend::data_api::{AccountBirthday, WalletWrite};
use zcash_keys::address::Address;
use zcash_keys::keys::{UnifiedAddressRequest, UnifiedSpendingKey};
use zcash_primitives::block::BlockHash;
use zcash_protocol::consensus::{BlockHeight, Network};
use zcash_protocol::value::Zatoshis;

const NET: Network = Network::TestNetwork;
const MAX: u64 = 200_000; // 0.002 ZEC

fn phrase(byte: u8) -> String {
    <bip0039::Mnemonic>::from_entropy(vec![byte; 32]).unwrap().phrase().to_owned()
}

fn orchard_only_address(byte: u8) -> String {
    let usk = UnifiedSpendingKey::from_seed(&NET, &[byte; 32], zip32::AccountId::ZERO).unwrap();
    let (ua, _) = usk.to_unified_full_viewing_key().default_address(UnifiedAddressRequest::ORCHARD).unwrap();
    ua.encode(&NET)
}

fn transparent_address() -> String {
    Address::Transparent(zcash_transparent::address::TransparentAddress::PublicKeyHash([7; 20])).encode(&NET)
}

#[test]
fn accepts_a_fare_uri() {
    let to = orchard_only_address(1);
    let req = check_uri(&NET, &format!("zcash:{to}?amount=0.001"), MAX).unwrap();
    assert_eq!(req.amount, Zatoshis::const_from_u64(100_000));
    assert_eq!(req.recipient_str, to);
}

#[test]
fn accepts_exactly_the_ceiling() {
    let to = orchard_only_address(1);
    assert!(check_uri(&NET, &format!("zcash:{to}?amount=0.002"), MAX).is_ok());
}

#[test]
fn refuses_a_transparent_recipient() {
    let to = transparent_address();
    let err = check_uri(&NET, &format!("zcash:{to}?amount=0.001"), MAX).unwrap_err().to_string();
    assert!(err.contains("no shielded receiver"), "{err}");
}

#[test]
fn refuses_a_memo() {
    let to = orchard_only_address(1);
    // "hi" as base64url, the ZIP-321 memo encoding.
    let err = check_uri(&NET, &format!("zcash:{to}?amount=0.001&memo=aGk"), MAX).unwrap_err().to_string();
    assert!(err.contains("memo"), "{err}");
}

#[test]
fn refuses_an_amount_above_the_ceiling() {
    let to = orchard_only_address(1);
    let err = check_uri(&NET, &format!("zcash:{to}?amount=0.00200001"), MAX).unwrap_err().to_string();
    assert!(err.contains("above --max-zec 0.002"), "{err}");
}

#[test]
fn refuses_malformed_uris() {
    let to = orchard_only_address(1);
    for uri in [
        "bitcoin:1BoatSLRHtKNngkdXEeobR76b53LETtpyT?amount=1".to_owned(),
        "zcash:not-an-address?amount=0.001".to_owned(),
        format!("zcash:{to}?amount=abc"),
        format!("zcash:{to}?amount=0.001&amount=0.002"),
        String::new(),
    ] {
        assert!(check_uri(&NET, &uri, MAX).is_err(), "accepted {uri:?}");
    }
}

#[test]
fn refuses_a_missing_or_zero_amount() {
    let to = orchard_only_address(1);
    let err = check_uri(&NET, &format!("zcash:{to}"), MAX).unwrap_err().to_string();
    assert!(err.contains("no amount"), "{err}");
    assert!(check_uri(&NET, &format!("zcash:{to}?amount=0"), MAX).is_err());
}

#[test]
fn refuses_several_recipients_and_extra_parameters() {
    let (a, b) = (orchard_only_address(1), orchard_only_address(2));
    let err = check_uri(&NET, &format!("zcash:?address={a}&amount=0.001&address.1={b}&amount.1=0.001"), MAX)
        .unwrap_err()
        .to_string();
    assert!(err.contains("exactly one recipient"), "{err}");
    let err = check_uri(&NET, &format!("zcash:{a}?amount=0.001&message=hello"), MAX).unwrap_err().to_string();
    assert!(err.contains("other than address and amount"), "{err}");
}

#[test]
fn refuses_a_mainnet_address() {
    let usk = UnifiedSpendingKey::from_seed(&Network::MainNetwork, &[1; 32], zip32::AccountId::ZERO).unwrap();
    let (ua, _) = usk.to_unified_full_viewing_key().default_address(UnifiedAddressRequest::ORCHARD).unwrap();
    let to = ua.encode(&Network::MainNetwork);
    let err = check_uri(&NET, &format!("zcash:{to}?amount=0.001"), MAX).unwrap_err().to_string();
    assert!(err.contains("not an address for this network"), "{err}");
}

#[test]
fn refuses_mainnet() {
    assert!(testnet_only("test").is_ok());
    assert!(testnet_only("testnet").is_ok());
    for name in ["main", "mainnet"] {
        assert!(testnet_only(name).unwrap_err().to_string().contains("testnet only"));
    }
    assert!(testnet_only("regtest").is_err());
}

#[test]
fn seed_errors_never_quote_the_phrase() {
    let good = phrase(3);
    let seed = seed_from_phrase(&good).unwrap();
    assert_eq!(seed.expose_secret().len(), 64);
    // Extra whitespace is harmless.
    let spaced = format!("  {}  ", good.replace(' ', "   "));
    assert_eq!(seed_from_phrase(&spaced).unwrap().expose_secret(), seed.expose_secret());

    let words: Vec<&str> = good.split(' ').collect();
    let short = words[..12].join(" ");
    let err = seed_from_phrase(&short).err().unwrap().to_string();
    assert!(err.contains("found 12 words"), "{err}");

    // Same words, last two swapped: the checksum fails.
    let mut swapped = words.clone();
    swapped.swap(22, 23);
    let swapped = swapped.join(" ");
    if swapped != good {
        let err = seed_from_phrase(&swapped).err().unwrap().to_string();
        assert!(err.contains("not a valid BIP 39 phrase"), "{err}");
        for w in &words {
            assert!(!err.split_whitespace().any(|e| e == *w), "error quotes a seed word: {err}");
        }
    }

    let unknown = format!("{} notaword", words[..23].join(" "));
    let err = seed_from_phrase(&unknown).err().unwrap().to_string();
    assert!(!err.contains("notaword"), "{err}");
}

/// Empty compact blocks from `start` to `end` inclusive, hash-chained onto `[0; 32]`.
fn empty_blocks(start: u32, end: u32) -> Vec<CompactBlock> {
    let hash = |h: u32| {
        let mut b = [0u8; 32];
        b[..4].copy_from_slice(&h.to_le_bytes());
        b[31] = 1;
        b.to_vec()
    };
    (start..=end)
        .map(|h| CompactBlock {
            height: u64::from(h),
            hash: hash(h),
            prev_hash: if h == start { vec![0; 32] } else { hash(h - 1) },
            chain_metadata: Some(ChainMetadata::default()),
            ..Default::default()
        })
        .collect()
}

#[test]
fn refuses_to_pay_before_the_first_sync() {
    let dir = tempfile::tempdir().unwrap();
    let seed = seed_from_phrase(&phrase(4)).unwrap();
    let usk = wallet::spending_key(&NET, &seed).unwrap();
    let mut db = wallet::open(dir.path(), NET, Some(&seed)).unwrap();
    let chain = ChainState::empty(BlockHeight::from_u32(4_199_999), BlockHash([0; 32]));
    db.import_account_hd("fare-payer", &seed, zip32::AccountId::ZERO, &AccountBirthday::from_parts(chain, None), None)
        .unwrap();

    let account = wallet::ensure_account_matches(&db, &usk).unwrap();
    let req = check_uri(&NET, &format!("zcash:{}?amount=0.001", orchard_only_address(5)), MAX).unwrap();
    let err = wallet::propose(&mut db, &NET, account, &req).unwrap_err().to_string();
    assert!(err.contains("has not synced"), "{err}");
}

#[test]
fn refuses_to_pay_without_funds() {
    let dir = tempfile::tempdir().unwrap();
    let seed = seed_from_phrase(&phrase(4)).unwrap();
    let usk = wallet::spending_key(&NET, &seed).unwrap();
    let mut db = wallet::open(dir.path(), NET, Some(&seed)).unwrap();

    let birthday = 4_200_000u32;
    let tip = birthday + 10;
    let chain = ChainState::empty(BlockHeight::from_u32(birthday - 1), BlockHash([0; 32]));
    db.import_account_hd("fare-payer", &seed, zip32::AccountId::ZERO, &AccountBirthday::from_parts(chain.clone(), None), None)
        .unwrap();
    db.update_chain_tip(BlockHeight::from_u32(tip)).unwrap();

    // Scan empty blocks through the same cache sync uses, so the wallet is synced and empty.
    let cache = MemBlockCache::default();
    tokio::runtime::Runtime::new().unwrap().block_on(cache.insert(empty_blocks(birthday, tip))).unwrap();
    scan_cached_blocks(&NET, &cache, &mut db, BlockHeight::from_u32(birthday), &chain, 11).unwrap();
    assert_eq!(wallet::heights(&db).unwrap(), Some((tip, tip)));
    let pools = wallet::balance(&db).unwrap().unwrap();
    assert!(pools.iter().all(|p| p.spendable_zat == 0 && p.pending_zat == 0));

    let account = wallet::ensure_account_matches(&db, &usk).unwrap();
    let req = check_uri(&NET, &format!("zcash:{}?amount=0.001", orchard_only_address(5)), MAX).unwrap();
    let err = wallet::propose(&mut db, &NET, account, &req).unwrap_err().to_string();
    assert!(err.contains("insufficient funds: 0 ZEC spendable"), "{err}");
}

#[test]
fn refuses_a_seed_that_does_not_own_the_database() {
    let dir = tempfile::tempdir().unwrap();
    let seed = seed_from_phrase(&phrase(4)).unwrap();
    let mut db = wallet::open(dir.path(), NET, Some(&seed)).unwrap();
    let chain = ChainState::empty(BlockHeight::from_u32(4_199_999), BlockHash([0; 32]));
    db.import_account_hd("fare-payer", &seed, zip32::AccountId::ZERO, &AccountBirthday::from_parts(chain, None), None)
        .unwrap();

    let other = wallet::spending_key(&NET, &seed_from_phrase(&phrase(6)).unwrap()).unwrap();
    let err = wallet::ensure_account_matches(&db, &other).unwrap_err().to_string();
    assert!(err.contains("does not match"), "{err}");
}

#[test]
fn database_holds_no_seed() {
    let dir = tempfile::tempdir().unwrap();
    let good = phrase(8);
    let seed = seed_from_phrase(&good).unwrap();
    let mut db = wallet::open(dir.path(), NET, Some(&seed)).unwrap();
    let chain = ChainState::empty(BlockHeight::from_u32(4_199_999), BlockHash([0; 32]));
    db.import_account_hd("fare-payer", &seed, zip32::AccountId::ZERO, &AccountBirthday::from_parts(chain, None), None)
        .unwrap();
    wallet::funding_address(&mut db, &NET).unwrap();
    drop(db);

    let mut bytes = Vec::new();
    for entry in std::fs::read_dir(dir.path()).unwrap() {
        bytes.extend(std::fs::read(entry.unwrap().path()).unwrap());
    }
    let hay = String::from_utf8_lossy(&bytes);
    assert!(!hay.contains(&good), "phrase found on disk");
    let words: Vec<&str> = good.split(' ').collect();
    assert!(!hay.contains(&words[..4].join(" ")), "phrase fragment found on disk");
    let seed_bytes = seed.expose_secret();
    assert!(!bytes.windows(seed_bytes.len()).any(|w| w == seed_bytes.as_slice()), "seed bytes found on disk");
}
