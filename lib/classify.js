// chgerType 코드표 (Task 2 fixture로 확정). 키=코드, 값=커넥터 목록.
const CHARGER_TYPES = {
  '01': ['DC차데모'],
  '02': ['AC완속'],
  '03': ['DC차데모', 'AC3상'],
  '04': ['DC콤보'],
  '05': ['DC차데모', 'DC콤보'],
  '06': ['DC차데모', 'AC3상', 'DC콤보'],
  '07': ['AC3상'],
};
const SLOW = new Set(['02']); // 완속으로 분류할 코드 (fixture로 확정)

export function classifyCharger(chgerType) {
  const connectors = CHARGER_TYPES[chgerType] ?? ['기타'];
  const speed = SLOW.has(chgerType) ? '완속' : '급속';
  return { speed, connectors };
}

const STATUS = {
  '1': { available: false, label: '통신이상' },
  '2': { available: true, label: '사용가능' },
  '3': { available: false, label: '충전중' },
  '4': { available: false, label: '운영중지' },
  '5': { available: false, label: '점검중' },
  '9': { available: false, label: '상태미확인' },
};

export function classifyStatus(stat) {
  return STATUS[String(stat)] ?? { available: false, label: '알수없음' };
}
