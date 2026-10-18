const counts = new Map();

export function dueVideoAds(ads) {
  return ads.filter(ad => {
    const count = (counts.get(ad.id) || 0) + 1;
    counts.set(ad.id, count);
    return count >= (ad.frequency || 1);
  });
}

export function markAdDelivered(id) {
  counts.set(id, 0);
}
