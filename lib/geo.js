const R = 6371; // km
const toRad = (d) => (d * Math.PI) / 180;

export function haversineKm(a, b) {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function boundingBox(center, radiusKm) {
  const dLat = radiusKm / 111; // 위도 1도 ≈ 111km
  const dLng = radiusKm / (111 * Math.cos(toRad(center.lat)));
  return {
    minLat: center.lat - dLat, maxLat: center.lat + dLat,
    minLng: center.lng - dLng, maxLng: center.lng + dLng,
  };
}
