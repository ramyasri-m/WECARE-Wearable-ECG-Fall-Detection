export function rssiToDistance(rssi: number, txPower: number = -59): number {
  if (rssi === 0) {return -1;}
  const ratio = rssi / txPower;
  return 0.89976 * Math.pow(ratio, 7.7095) + 0.111;
}

export const RSSI_THRESHOLD = -70;

export function isBystanderNearby(rssi: number): boolean {
  return rssi >= RSSI_THRESHOLD;
}

export function signalLabel(rssi: number): string {
  if (rssi >= -50) {return 'Excellent';}
  if (rssi >= -60) {return 'Good';}
  if (rssi >= -70) {return 'Fair';}
  if (rssi >= -80) {return 'Weak';}
  return 'Out of range';
}

export function signalColor(rssi: number): string {
  if (rssi >= -50) {return '#30d158';}
  if (rssi >= -60) {return '#34c759';}
  if (rssi >= -70) {return '#ff9f0a';}
  if (rssi >= -80) {return '#ff6b35';}
  return '#ff3b30';
}

export function formatDistance(meters: number): string {
  if (meters < 0) {return 'Unknown';}
  if (meters < 1) {return `${(meters * 100).toFixed(0)} cm`;}
  return `${meters.toFixed(1)} m`;
}
