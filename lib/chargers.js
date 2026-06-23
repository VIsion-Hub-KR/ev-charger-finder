import { classifyCharger, classifyStatus } from './classify.js';
import { haversineKm } from './geo.js';

/**
 * 평평한 API 응답에서 item 배열을 추출한다.
 * 경로: raw.items.item (raw.response.body.items.item 아님)
 * 단일 객체일 경우 배열로 감싸서 반환.
 */
export function parseItems(raw) {
  const item = raw?.items?.item;
  if (!item) return [];
  return Array.isArray(item) ? item : [item];
}

/**
 * infoItems + statusItems를 statId 기준으로 병합·집계해 Station 배열을 반환한다.
 *
 * Station = {
 *   statId, name, lat, lng, addr, busiNm,
 *   speed, connectors: string[],
 *   totalCount, availableCount, statusLabel,
 *   lastUpdate, distanceKm: number|null, isTesla: false
 * }
 */
export function buildStations(infoItems, statusItems, origin) {
  // statId:chgerId → status item
  const statusByCharger = new Map();
  for (const s of statusItems) {
    statusByCharger.set(`${s.statId}:${s.chgerId}`, s);
  }

  const byStation = new Map();
  for (const it of infoItems) {
    const key = it.statId;
    if (!byStation.has(key)) {
      byStation.set(key, {
        statId: it.statId,
        name: it.statNm,
        lat: Number(it.lat),
        lng: Number(it.lng),
        addr: it.addr,
        busiNm: it.busiNm,
        connectors: new Set(),
        speeds: new Set(),
        totalCount: 0,
        availableCount: 0,
        lastUpdate: null,
      });
    }
    const st = byStation.get(key);
    const cls = classifyCharger(it.chgerType);
    cls.connectors.forEach((c) => st.connectors.add(c));
    st.speeds.add(cls.speed);
    st.totalCount += 1;

    const statusItem = statusByCharger.get(`${it.statId}:${it.chgerId}`);
    if (statusItem) {
      if (classifyStatus(statusItem.stat).available) st.availableCount += 1;
      if (statusItem.statUpdDt && (!st.lastUpdate || statusItem.statUpdDt > st.lastUpdate)) {
        st.lastUpdate = statusItem.statUpdDt;
      }
    }
  }

  return [...byStation.values()].map((st) => ({
    statId: st.statId,
    name: st.name,
    lat: st.lat,
    lng: st.lng,
    addr: st.addr,
    busiNm: st.busiNm,
    speed: st.speeds.has('급속') ? '급속' : '완속',
    connectors: [...st.connectors],
    totalCount: st.totalCount,
    availableCount: st.availableCount,
    statusLabel: st.availableCount > 0 ? '사용가능' : '만차/점검',
    lastUpdate: st.lastUpdate,
    distanceKm: origin
      ? Number(haversineKm(origin, { lat: st.lat, lng: st.lng }).toFixed(1))
      : null,
    isTesla: false,
  }));
}
