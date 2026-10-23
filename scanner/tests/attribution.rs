//! Offline proof of attribution with real note encryption.
//!
//! Every action below is a genuinely encrypted note (Ironwood lead byte 0x03 or Orchard
//! 0x02) wrapped in the same compact block protobuf a lightwalletd server returns. The
//! scanner sees exactly what it would see on mainnet: 52 bytes of ciphertext per action,
//! no memo, no full transaction.

use fare_scanner::keys::{self, PURCHASE_INDEX_BASE};
use fare_scanner::scan::{Detector, Pool};
use fare_scanner::store::{Merchant, Purchase, State, Status};

use orchard::keys::IncomingViewingKey;
use orchard::note::{ExtractedNoteCommitment, Nullifier, RandomSeed, Rho};
use orchard::note_encryption::{IronwoodDomain, IronwoodNoteEncryption, OrchardDomain, OrchardNoteEncryption};
use orchard::value::NoteValue;
use orchard::{Address, Note, NoteVersion};
use zcash_client_backend::proto::compact_formats::{CompactBlock, CompactOrchardAction, CompactTx, CompactTxIn};
use zcash_keys::address::UnifiedAddress;
use zcash_note_encryption::Domain;
use zcash_protocol::consensus::Network;

const NET: Network = Network::TestNetwork;
const PRICE: u64 = 100_000; // 0.001 ZEC

fn ivk_for(seed_byte: u8) -> IncomingViewingKey {
    let ufvk = keys::ufvk_from_seed(&NET, &[seed_byte; 32]).unwrap();
    keys::viewing_keys(&ufvk).unwrap().ivk
}

/// A real encrypted note to `recipient`, in compact form.
fn action(recipient: Address, value: u64, version: NoteVersion, salt: u8) -> CompactOrchardAction {
    let mut nf_bytes = [0u8; 32];
    nf_bytes[0] = salt;
    nf_bytes[1] = 0x5a;
    let nf: Nullifier = Option::from(Nullifier::from_bytes(&nf_bytes)).expect("canonical nullifier");
    let rho: Rho = Option::from(Rho::from_bytes(&nf.to_bytes())).expect("rho");
    let rseed = (0u8..=255)
        .find_map(|i| {
            let mut b = [i; 32];
            b[31] = salt;
            Option::<RandomSeed>::from(RandomSeed::from_bytes(b, &rho))
        })
        .expect("rseed");
    let note: Note =
        Option::from(Note::from_parts(recipient, NoteValue::from_raw(value), rho, rseed, version)).expect("note");
    let cmx = ExtractedNoteCommitment::from(note.commitment());
    let (epk, ciphertext) = if version == NoteVersion::V3 {
        let enc = IronwoodNoteEncryption::new(None, note, [0u8; 512]);
        (IronwoodDomain::epk_bytes(enc.epk()), enc.encrypt_note_plaintext())
    } else {
        let enc = OrchardNoteEncryption::new(None, note, [0u8; 512]);
        (OrchardDomain::epk_bytes(enc.epk()), enc.encrypt_note_plaintext())
    };
    CompactOrchardAction {
        nullifier: nf.to_bytes().to_vec(),
        cmx: cmx.to_bytes().to_vec(),
        ephemeral_key: epk.0.to_vec(),
        ciphertext: ciphertext.as_ref()[..52].to_vec(),
    }
}

fn tx(id: u8, ironwood: Vec<CompactOrchardAction>, orchard: Vec<CompactOrchardAction>) -> CompactTx {
    CompactTx {
        index: id as u64,
        txid: vec![id; 32],
        fee: 10_000,
        spends: vec![],
        outputs: vec![],
        actions: orchard,
        ironwood_actions: ironwood,
        vin: vec![],
        vout: vec![],
    }
}

fn block(height: u64, vtx: Vec<CompactTx>) -> CompactBlock {
    CompactBlock { height, hash: vec![], prev_hash: vec![], time: 0, header: vec![], vtx, chain_metadata: None }
}

fn merchant_state(purchases: usize) -> State {
    let ufvk = keys::ufvk_from_seed(&NET, &[7u8; 32]).unwrap();
    let mut state = State::new(Merchant {
        network: "test".into(),
        server: "unused".into(),
        ufvk: ufvk.encode(&NET).unwrap(),
        birthday_height: 90,
        next_index: PURCHASE_INDEX_BASE,
        required_confirmations: 1,
    });
    let ivk = keys::viewing_keys(&ufvk).unwrap().ivk;
    for n in 0..purchases {
        let index = state.allocate_index();
        let address = keys::encode_shielded_only(&NET, keys::purchase_address(&ivk, index)).unwrap();
        state.purchases.push(Purchase {
            id: format!("p{n}"),
            index,
            price_zat: PRICE,
            address: address.clone(),
            pay_uri: format!("zcash:{address}?amount=0.001"),
            label: None,
            created_unix: 0,
            created_height: 90,
            payments: vec![],
        });
    }
    state
}

fn addr(ivk: &IncomingViewingKey, index: u64) -> Address {
    keys::purchase_address(ivk, index)
}

#[test]
fn attributes_every_case_from_compact_blocks_alone() {
    let ivk = ivk_for(7);
    let foreign = ivk_for(9);
    let base = PURCHASE_INDEX_BASE;
    let mut state = merchant_state(5);

    let mut leaky = tx(0x07, vec![action(addr(&ivk, base + 3), PRICE, NoteVersion::V3, 7)], vec![]);
    leaky.vin.push(CompactTxIn { prevout_txid: vec![1; 32], prevout_index: 0 });

    let b = block(
        100,
        vec![
            // p0: exact price, Ironwood.
            tx(0xA1, vec![action(addr(&ivk, base), PRICE, NoteVersion::V3, 1)], vec![]),
            // p1: half the price.
            tx(0xB2, vec![action(addr(&ivk, base + 1), PRICE / 2, NoteVersion::V3, 2)], vec![]),
            // p2: paid through the legacy Orchard list with an Orchard-format note.
            tx(0xC3, vec![], vec![action(addr(&ivk, base + 2), PRICE, NoteVersion::V2, 3)]),
            // A payment to someone else's key: invisible to us.
            tx(0xD4, vec![action(addr(&foreign, base), PRICE, NoteVersion::V3, 4)], vec![]),
            // An Orchard-format note smuggled into the Ironwood list: the domain refuses it.
            tx(0xE5, vec![action(addr(&ivk, base + 2), PRICE, NoteVersion::V2, 5)], vec![]),
            // Our key, but index 0: the wallet's own address, not a purchase.
            tx(0xF6, vec![action(addr(&ivk, 0), 70_000, NoteVersion::V3, 6)], vec![]),
            // p3: paid, but the payer spent transparent inputs.
            leaky,
            // p4: our note hidden between two foreign ones; found at action index 1.
            tx(
                0x08,
                vec![
                    action(addr(&foreign, 1), 5, NoteVersion::V3, 8),
                    action(addr(&ivk, base + 4), PRICE, NoteVersion::V3, 9),
                    action(addr(&foreign, 2), 5, NoteVersion::V3, 10),
                ],
                vec![],
            ),
        ],
    );

    let detector = Detector::new(ivk.clone());
    let found = detector.scan_block(&b);
    assert_eq!(found.len(), 6, "A, B, C, F, the leaky tx and the hidden note: {found:#?}");
    assert!(found.iter().all(|d| d.txid != hex::encode([0xD4u8; 32])), "foreign payment must stay invisible");
    assert!(found.iter().all(|d| d.txid != hex::encode([0xE5u8; 32])), "wrong-format note must be refused");

    let applied = state.apply(&found);
    assert_eq!(applied.attributed, 5);
    assert_eq!(applied.unattributed, 1);
    assert_eq!(state.unattributed[0].diversifier_index, "0");

    let tip = 100;
    let s = |n: usize, st: &State| st.purchases[n].status(tip, 1);
    assert_eq!(s(0, &state), Status::Paid { overpaid_zat: 0 });
    assert_eq!(s(1, &state), Status::Underpaid { short_zat: PRICE / 2 });
    assert_eq!(s(2, &state), Status::Paid { overpaid_zat: 0 });
    assert_eq!(state.purchases[2].payments.len(), 1, "only the Orchard-list note counts for p2");
    assert_eq!(state.purchases[2].payments[0].pool, Pool::Orchard);
    assert_eq!(s(3, &state), Status::Paid { overpaid_zat: 0 });
    assert!(state.purchases[3].leaky_funding());
    assert!(!state.purchases[0].leaky_funding());
    assert_eq!(s(4, &state), Status::Paid { overpaid_zat: 0 });
    assert_eq!(state.purchases[4].payments[0].action_index, 1);
    assert_eq!(state.purchases[0].payments[0].pool, Pool::Ironwood);
    assert_eq!(state.purchases[0].payments[0].txid, hex::encode([0xA1u8; 32]));

    // Rescanning the same block changes nothing.
    let again = state.apply(&detector.scan_block(&b));
    assert_eq!(again.attributed, 5);
    assert!(state.purchases.iter().all(|p| p.payments.len() <= 1));
    assert_eq!(state.unattributed.len(), 1);
}

#[test]
fn mempool_then_confirmation_then_overpayment() {
    let ivk = ivk_for(7);
    let base = PURCHASE_INDEX_BASE;
    let mut state = merchant_state(1);
    state.merchant.required_confirmations = 2;
    let detector = Detector::new(ivk.clone());

    let pay = tx(0x11, vec![action(addr(&ivk, base), PRICE, NoteVersion::V3, 21)], vec![]);

    // Seen in the mempool: visible, but no tokens.
    state.apply(&detector.scan_tx(&pay, None));
    assert_eq!(state.purchases[0].status(100, 2), Status::InMempool { value_zat: PRICE });

    // Mined at 101: one confirmation of two.
    state.apply(&detector.scan_block(&block(101, vec![pay.clone()])));
    assert_eq!(state.purchases[0].payments.len(), 1, "mempool sighting upgraded in place");
    assert_eq!(state.purchases[0].status(101, 2), Status::Confirming { confirmations: 1, required: 2 });

    // Second confirmation.
    assert_eq!(state.purchases[0].status(102, 2), Status::Paid { overpaid_zat: 0 });

    // A second payment to the same address is recorded as overpayment.
    let extra = tx(0x12, vec![action(addr(&ivk, base), 30_000, NoteVersion::V3, 22)], vec![]);
    state.apply(&detector.scan_block(&block(103, vec![extra])));
    assert_eq!(state.purchases[0].status(104, 2), Status::Paid { overpaid_zat: 30_000 });
}

#[test]
fn minted_address_is_shielded_only_and_maps_back_to_its_index() {
    let ufvk = keys::ufvk_from_seed(&NET, &[7u8; 32]).unwrap();
    let ivk = keys::viewing_keys(&ufvk).unwrap().ivk;
    for index in [PURCHASE_INDEX_BASE, PURCHASE_INDEX_BASE + 1, PURCHASE_INDEX_BASE + 999] {
        let encoded = keys::encode_shielded_only(&NET, keys::purchase_address(&ivk, index)).unwrap();
        assert!(encoded.starts_with("utest1"), "testnet unified address: {encoded}");
        let ua = UnifiedAddress::decode(&NET, &encoded).unwrap();
        assert!(ua.transparent().is_none(), "no transparent receiver");
        assert!(ua.sapling().is_none(), "no Sapling receiver");
        let receiver = keys::decode_orchard_receiver(&NET, &encoded).unwrap();
        let j = ivk.diversifier_index(&receiver).expect("derived from this key");
        assert_eq!(u128::from(j), index as u128);
    }
    let main = keys::encode_shielded_only(&Network::MainNetwork, keys::purchase_address(&ivk, PURCHASE_INDEX_BASE)).unwrap();
    assert!(main.starts_with("u1"), "mainnet unified address: {main}");
}

#[test]
fn same_seed_same_keys_and_uivk_cannot_be_mistaken_for_ufvk() {
    let a = keys::ufvk_from_seed(&NET, &[3u8; 32]).unwrap();
    let b = keys::ufvk_from_seed(&NET, &[3u8; 32]).unwrap();
    assert_eq!(a.encode(&NET).unwrap(), b.encode(&NET).unwrap());
    let uivk = keys::encode_uivk(&NET, &a).unwrap();
    assert!(uivk.starts_with("uivktest"), "incoming-only key prefix: {uivk}");
    assert!(keys::decode_ufvk(&NET, &uivk).is_err(), "a published UIVK must not load as a full viewing key");
}

#[test]
fn generated_mnemonic_is_24_words() {
    let m = keys::generate_mnemonic().unwrap();
    assert_eq!(m.phrase().split_whitespace().count(), 24);
}
