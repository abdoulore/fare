//! `fare-scanner serve`: the issuer's sidecar. Loopback only, two routes:
//!
//! - `POST /mint {price_zat}` returns `201 {purchase_id, index, address, pay_uri}`
//! - `GET /purchases/{id}` returns `{status, received_zat, payments, ...}`
//!
//! It logs nothing about requests: no addresses, no timing, no purchase ids.

use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;

use anyhow::{bail, Result};
use axum::body::Bytes;
use axum::extract::{Path, State as AxState};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::Deserialize;
use serde_json::{json, Value};
use tokio::sync::Mutex;

use crate::service;
use crate::store::{self, State};

#[derive(Clone)]
pub struct App {
    pub state: Arc<Mutex<State>>,
    pub dir: PathBuf,
}

pub fn router(app: App) -> Router {
    Router::new()
        .route("/mint", post(mint))
        .route("/purchases/{id}", get(purchase))
        .fallback(|| async { error(StatusCode::NOT_FOUND, "not_found") })
        .with_state(app)
}

/// Refuses any address that is not loopback: the sidecar has no authentication.
pub fn check_loopback(addr: &SocketAddr) -> Result<()> {
    if !addr.ip().is_loopback() {
        bail!("serve binds to loopback only (127.0.0.1 or ::1), refusing {addr}");
    }
    Ok(())
}

fn error(code: StatusCode, reason: &str) -> Response {
    (code, Json(json!({ "error": reason }))).into_response()
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct MintRequest {
    price_zat: u64,
}

async fn mint(AxState(app): AxState<App>, body: Bytes) -> Response {
    let Ok(req) = serde_json::from_slice::<MintRequest>(&body) else {
        return error(StatusCode::BAD_REQUEST, "body must be {\"price_zat\": <integer>}");
    };
    if req.price_zat == 0 || req.price_zat > service::MAX_PRICE_ZAT {
        return error(StatusCode::BAD_REQUEST, "price_zat out of range");
    }
    let mut state = app.state.lock().await;
    let created_height = state.last_scanned_height.unwrap_or(state.merchant.birthday_height);
    let purchase = match service::mint(&mut state, req.price_zat, None, created_height) {
        Ok(p) => p,
        Err(_) => return error(StatusCode::INTERNAL_SERVER_ERROR, "mint_failed"),
    };
    if store::save(&app.dir, &state).is_err() {
        // Not persisted, so not handed out: drop it and give the index back.
        state.purchases.pop();
        state.merchant.next_index -= 1;
        return error(StatusCode::INTERNAL_SERVER_ERROR, "state_not_saved");
    }
    (
        StatusCode::CREATED,
        Json(json!({
            "purchase_id": purchase.id,
            "index": purchase.index,
            "address": purchase.address,
            "pay_uri": purchase.pay_uri,
        })),
    )
        .into_response()
}

fn valid_id(id: &str) -> bool {
    // 128-bit ids from serve; 64-bit ids from CLI mints made before serve existed.
    matches!(id.len(), 16 | 32) && id.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

async fn purchase(AxState(app): AxState<App>, Path(id): Path<String>) -> Response {
    if !valid_id(&id) {
        return error(StatusCode::BAD_REQUEST, "malformed_id");
    }
    let state = app.state.lock().await;
    let Some(p) = state.purchases.iter().find(|p| p.id == id) else {
        return error(StatusCode::NOT_FOUND, "unknown_purchase");
    };
    let tip = state.last_scanned_height.unwrap_or(0);
    let required = state.merchant.required_confirmations;
    let payments: Vec<Value> = p
        .payments
        .iter()
        .map(|pay| {
            json!({
                "txid": pay.txid,
                "pool": pay.pool,
                "height": pay.height,
                "value_zat": pay.value_zat,
                "confirmations": pay.height.map(|h| store::confirmations(h, tip)),
                "transparent_inputs": pay.transparent_inputs,
            })
        })
        .collect();
    Json(json!({
        "status": p.status(tip, required).code(),
        "received_zat": p.received_zat(),
        "price_zat": p.price_zat,
        "payments": payments,
        "leaky_funding": p.leaky_funding(),
        "scanned_to": state.last_scanned_height,
        "required_confirmations": required,
    }))
    .into_response()
}
