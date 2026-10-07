const BLE_TOPIC   = 'wecare-demo-ble';
const ALERT_TOPIC = 'wecare-demo';
const NTFY_BASE   = 'https://ntfy.sh';

export async function publishBLEScan(
  deviceCount: number,
  nearbyCount: number,
  bestRssi: number,
  bestDistance: number,
): Promise<void> {
  await fetch(`${NTFY_BASE}/${BLE_TOPIC}`, {
    method: 'POST',
    headers: {Title: 'BLE Scan Update', Tags: 'bluetooth'},
    body: `Devices: ${deviceCount} | Nearby: ${nearbyCount} | Best RSSI: ${bestRssi} dBm | Est: ${bestDistance.toFixed(1)} m`,
  });
}

export async function pollForAlert(sinceId?: string): Promise<{
  id: string;
  severity: string;
  instructions: string;
} | null> {
  const url = `${NTFY_BASE}/${ALERT_TOPIC}/json?poll=1&since=${sinceId ?? '30s'}`;
  const res  = await fetch(url);
  if (!res.ok) {return null;}

  const text  = await res.text();
  const lines = text.trim().split('\n').filter(Boolean);
  if (!lines.length) {return null;}

  const latest        = JSON.parse(lines[lines.length - 1]);
  const title: string = latest.title   ?? '';
  const body: string  = latest.message ?? '';

  const severity = title.includes('EMERGENCY')
    ? 'HIGH'
    : title.includes('Alert Pending')
    ? 'MEDIUM'
    : 'NONE';

  if (severity === 'NONE') {return null;}

  const instrIdx     = body.indexOf('INSTRUCTIONS:');
  const instructions = instrIdx !== -1 ? body.substring(instrIdx + 13).trim() : '';

  return {id: latest.id, severity, instructions};
}
