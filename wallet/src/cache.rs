//! In-memory compact block cache for `zcash_client_backend::sync::run`.
//!
//! Sync downloads a batch of blocks, scans it, then deletes it, so nothing needs to
//! outlive one run. `zcash_client_sqlite` 0.23 ships no `BlockCache` implementation;
//! this one keeps blocks in a map keyed by height.

use std::collections::BTreeMap;
use std::fmt;
use std::sync::{Mutex, MutexGuard};

use async_trait::async_trait;
use zcash_client_backend::data_api::chain::{error, BlockCache, BlockSource};
use zcash_client_backend::data_api::scanning::ScanRange;
use zcash_client_backend::proto::compact_formats::CompactBlock;
use zcash_protocol::consensus::BlockHeight;

#[derive(Debug)]
pub struct CacheError(String);

impl fmt::Display for CacheError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "block cache: {}", self.0)
    }
}

impl std::error::Error for CacheError {}

#[derive(Default)]
pub struct MemBlockCache {
    blocks: Mutex<BTreeMap<u32, CompactBlock>>,
}

impl MemBlockCache {
    fn lock(&self) -> Result<MutexGuard<'_, BTreeMap<u32, CompactBlock>>, CacheError> {
        self.blocks.lock().map_err(|_| CacheError("lock poisoned".into()))
    }

    pub fn len(&self) -> usize {
        self.lock().map(|b| b.len()).unwrap_or(0)
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }
}

fn height_of(block: &CompactBlock) -> Result<u32, CacheError> {
    u32::try_from(block.height).map_err(|_| CacheError(format!("block height {} out of range", block.height)))
}

impl BlockSource for MemBlockCache {
    type Error = CacheError;

    /// Calls `with_block` on cached blocks from `from_height` upward, in order. The first
    /// block must be exactly `from_height`, as in `zcash_client_sqlite::BlockDb`.
    fn with_blocks<F, WalletErrT>(
        &self,
        from_height: Option<BlockHeight>,
        limit: Option<usize>,
        mut with_block: F,
    ) -> Result<(), error::Error<WalletErrT, Self::Error>>
    where
        F: FnMut(CompactBlock) -> Result<(), error::Error<WalletErrT, Self::Error>>,
    {
        let selected: Vec<CompactBlock> = {
            let blocks = self.lock().map_err(error::Error::BlockSource)?;
            let start = from_height.map_or(0, u32::from);
            blocks.range(start..).take(limit.unwrap_or(usize::MAX)).map(|(_, b)| b.clone()).collect()
        };
        if let Some(from) = from_height {
            if selected.first().map(|b| b.height) != Some(u64::from(u32::from(from))) {
                return Err(error::Error::BlockSource(CacheError(format!("block {from} is not cached"))));
            }
        }
        for block in selected {
            with_block(block)?;
        }
        Ok(())
    }
}

#[async_trait]
impl BlockCache for MemBlockCache {
    fn get_tip_height(&self, range: Option<&ScanRange>) -> Result<Option<BlockHeight>, Self::Error> {
        let blocks = self.lock()?;
        let tip = match range {
            Some(r) => {
                let (start, end) = (u32::from(r.block_range().start), u32::from(r.block_range().end));
                blocks.range(start..end).next_back().map(|(h, _)| *h)
            }
            None => blocks.keys().next_back().copied(),
        };
        Ok(tip.map(BlockHeight::from_u32))
    }

    /// Contiguous blocks from the start of `range`. A short read stops at the first gap.
    async fn read(&self, range: &ScanRange) -> Result<Vec<CompactBlock>, Self::Error> {
        let blocks = self.lock()?;
        let (start, end) = (u32::from(range.block_range().start), u32::from(range.block_range().end));
        let mut out = Vec::new();
        for h in start..end {
            match blocks.get(&h) {
                Some(b) => out.push(b.clone()),
                None => break,
            }
        }
        if out.is_empty() && start < end {
            return Err(CacheError(format!("block {start} is not cached")));
        }
        Ok(out)
    }

    async fn insert(&self, compact_blocks: Vec<CompactBlock>) -> Result<(), Self::Error> {
        let mut blocks = self.lock()?;
        for block in compact_blocks {
            blocks.insert(height_of(&block)?, block);
        }
        Ok(())
    }

    async fn delete(&self, range: ScanRange) -> Result<(), Self::Error> {
        let mut blocks = self.lock()?;
        let (start, end) = (u32::from(range.block_range().start), u32::from(range.block_range().end));
        let doomed: Vec<u32> = blocks.range(start..end).map(|(h, _)| *h).collect();
        for h in doomed {
            blocks.remove(&h);
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use zcash_client_backend::data_api::scanning::ScanPriority;

    fn block(h: u64) -> CompactBlock {
        CompactBlock { height: h, ..Default::default() }
    }

    fn range(start: u32, end: u32) -> ScanRange {
        ScanRange::from_parts(BlockHeight::from_u32(start)..BlockHeight::from_u32(end), ScanPriority::Historic)
    }

    fn heights(blocks: &[CompactBlock]) -> Vec<u64> {
        blocks.iter().map(|b| b.height).collect()
    }

    #[tokio::test]
    async fn reads_stop_at_the_first_gap_and_deletes_clear_a_range() {
        let cache = MemBlockCache::default();
        cache.insert(vec![block(10), block(11), block(13)]).await.unwrap();
        assert_eq!(heights(&cache.read(&range(10, 14)).await.unwrap()), vec![10, 11]);
        assert!(cache.read(&range(12, 14)).await.is_err(), "missing first block must be an error");
        assert_eq!(cache.get_tip_height(None).unwrap(), Some(BlockHeight::from_u32(13)));
        assert_eq!(cache.get_tip_height(Some(&range(10, 13))).unwrap(), Some(BlockHeight::from_u32(11)));

        cache.delete(range(10, 12)).await.unwrap();
        assert_eq!(cache.len(), 1);
        cache.truncate(BlockHeight::from_u32(12)).await.unwrap();
        assert!(cache.is_empty());
    }

    #[tokio::test]
    async fn with_blocks_starts_exactly_at_the_requested_height() {
        let cache = MemBlockCache::default();
        cache.insert(vec![block(5), block(6), block(7)]).await.unwrap();
        let mut seen = Vec::new();
        cache
            .with_blocks::<_, ()>(Some(BlockHeight::from_u32(6)), Some(1), |b| {
                seen.push(b.height);
                Ok(())
            })
            .unwrap();
        assert_eq!(seen, vec![6]);
        assert!(cache.with_blocks::<_, ()>(Some(BlockHeight::from_u32(4)), None, |_| Ok(())).is_err());
    }
}
