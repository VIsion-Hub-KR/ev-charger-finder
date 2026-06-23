import { haversineKm } from './geo.js';

/**
 * 17개 시도 대략 중심 좌표 및 zcode 매핑.
 * zcode는 공공 API의 2자리 시도코드 문자열.
 */
const SIDO = [
  { zcode: '11', name: '서울',  lat: 37.5665, lng: 126.9780 },
  { zcode: '26', name: '부산',  lat: 35.1796, lng: 129.0756 },
  { zcode: '27', name: '대구',  lat: 35.8714, lng: 128.6014 },
  { zcode: '28', name: '인천',  lat: 37.4563, lng: 126.7052 },
  { zcode: '29', name: '광주',  lat: 35.1595, lng: 126.8526 },
  { zcode: '30', name: '대전',  lat: 36.3504, lng: 127.3845 },
  { zcode: '31', name: '울산',  lat: 35.5384, lng: 129.3114 },
  { zcode: '36', name: '세종',  lat: 36.4800, lng: 127.2890 },
  { zcode: '41', name: '경기',  lat: 37.2752, lng: 127.0095 },
  { zcode: '51', name: '강원',  lat: 37.8228, lng: 128.1555 },
  { zcode: '43', name: '충북',  lat: 36.6358, lng: 127.4913 },
  { zcode: '44', name: '충남',  lat: 36.5184, lng: 126.8000 },
  { zcode: '52', name: '전북',  lat: 35.7175, lng: 127.1530 },
  { zcode: '46', name: '전남',  lat: 34.8679, lng: 126.9910 },
  { zcode: '47', name: '경북',  lat: 36.4919, lng: 128.8889 },
  { zcode: '48', name: '경남',  lat: 35.4606, lng: 128.2132 },
  { zcode: '50', name: '제주',  lat: 33.4996, lng: 126.5312 },
];

/**
 * 위도/경도를 받아 가장 가까운 시도 zcode(2자리 문자열)를 반환한다.
 * @param {number} lat
 * @param {number} lng
 * @returns {string} zcode e.g. '11'
 */
export function regionFor(lat, lng) {
  const point = { lat, lng };
  let best = SIDO[0];
  let bestDist = haversineKm(point, best);
  for (let i = 1; i < SIDO.length; i++) {
    const d = haversineKm(point, SIDO[i]);
    if (d < bestDist) {
      bestDist = d;
      best = SIDO[i];
    }
  }
  return best.zcode;
}
