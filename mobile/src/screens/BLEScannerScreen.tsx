import React, {useCallback, useEffect, useRef, useState} from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Platform,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {BleManager, Device, State} from 'react-native-ble-plx';
import {check, PERMISSIONS, request, RESULTS} from 'react-native-permissions';
import DeviceCard from '../components/DeviceCard';
import {isBystanderNearby, rssiToDistance} from '../utils/bleUtils';
import {pollForAlert, publishBLEScan} from '../services/ntfyService';

const manager = new BleManager();

interface EmergencyAlert {
  id: string;
  severity: string;
  instructions: string;
}

export default function BLEScannerScreen() {
  const [devices, setDevices]   = useState<Map<string, Device>>(new Map());
  const [scanning, setScanning] = useState(false);
  const [bleState, setBleState] = useState<State>(State.Unknown);
  const [error, setError]       = useState<string | null>(null);
  const [alert, setAlert]       = useState<EmergencyAlert | null>(null);

  const scanTimeout  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const deviceMapRef = useRef<Map<string, Device>>(new Map());
  const alertPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastAlertId  = useRef<string | undefined>(undefined);

  useEffect(() => {
    const subscription = manager.onStateChange(state => {
      setBleState(state);
    }, true);
    return () => {
      subscription.remove();
      manager.destroy();
    };
  }, []);

  useEffect(() => {
    alertPollRef.current = setInterval(async () => {
      try {
        const result = await pollForAlert(lastAlertId.current);
        if (result) {
          lastAlertId.current = result.id;
          setAlert(result);
        }
      } catch {
        // silent
      }
    }, 5000);
    return () => {
      if (alertPollRef.current) {clearInterval(alertPollRef.current);}
    };
  }, []);

  const requestPermissions = useCallback(async (): Promise<boolean> => {
    if (Platform.OS !== 'android') {return true;}
    const apiLevel = Platform.Version as number;
    const permissions =
      apiLevel >= 31
        ? [PERMISSIONS.ANDROID.BLUETOOTH_SCAN, PERMISSIONS.ANDROID.BLUETOOTH_CONNECT]
        : [PERMISSIONS.ANDROID.ACCESS_FINE_LOCATION];

    for (const perm of permissions) {
      const status = await check(perm);
      if (status !== RESULTS.GRANTED) {
        const result = await request(perm);
        if (result !== RESULTS.GRANTED) {
          Alert.alert(
            'Permission Required',
            'Bluetooth permission is required to scan for nearby WECARE bystanders.',
          );
          return false;
        }
      }
    }
    return true;
  }, []);

  const stopScanAndPublish = useCallback(() => {
    if (scanTimeout.current) {
      clearTimeout(scanTimeout.current);
      scanTimeout.current = null;
    }
    manager.stopDeviceScan();
    setScanning(false);

    const list = Array.from(deviceMapRef.current.values());
    if (list.length === 0) {
      return;
    }

    const best = list.reduce((a, b) =>
      (a.rssi ?? -100) > (b.rssi ?? -100) ? a : b,
    );
    const bestRssi    = best.rssi ?? -100;
    const nearbyCount = list.filter(d => isBystanderNearby(d.rssi ?? -100)).length;
    publishBLEScan(list.length, nearbyCount, bestRssi, rssiToDistance(bestRssi)).catch(() => {});
  }, []);

  const startScan = useCallback(async () => {
    setError(null);

    if (bleState !== State.PoweredOn) {
      setError('Bluetooth is off. Please enable Bluetooth and try again.');
      return;
    }

    const granted = await requestPermissions();
    if (!granted) {
      return;
    }

    deviceMapRef.current = new Map();
    setDevices(new Map());
    setScanning(true);

    manager.startDeviceScan(null, {allowDuplicates: true}, (err, device) => {
      if (err) {
        setError(err.message);
        setScanning(false);
        return;
      }
      if (device && device.rssi !== null) {
        const existing = deviceMapRef.current.get(device.id);
        if (!existing || device.rssi > (existing.rssi ?? -100)) {
          deviceMapRef.current.set(device.id, device);
          setDevices(new Map(deviceMapRef.current));
        }
      }
    });

    scanTimeout.current = setTimeout(stopScanAndPublish, 15000);
  }, [bleState, requestPermissions, stopScanAndPublish]);

  const sortedDevices = Array.from(devices.values()).sort(
    (a, b) => (b.rssi ?? -100) - (a.rssi ?? -100),
  );
  const nearbyCount = sortedDevices.filter(d => isBystanderNearby(d.rssi ?? -100)).length;

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" backgroundColor="#0a0a0f" />

      <View style={styles.header}>
        <View>
          <Text style={styles.title}>WECARE</Text>
          <Text style={styles.subtitle}>BLE Proximity Scanner</Text>
        </View>
        <View style={styles.bleIndicator}>
          <View
            style={[
              styles.bleDot,
              {backgroundColor: bleState === State.PoweredOn ? '#30d158' : '#ff3b30'},
            ]}
          />
          <Text style={styles.bleLabel}>
            {bleState === State.PoweredOn ? 'BT ON' : 'BT OFF'}
          </Text>
        </View>
      </View>

      <View style={styles.statsBar}>
        <View style={styles.stat}>
          <Text style={styles.statValue}>{sortedDevices.length}</Text>
          <Text style={styles.statLabel}>Detected</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.stat}>
          <Text style={[styles.statValue, {color: '#30d158'}]}>{nearbyCount}</Text>
          <Text style={styles.statLabel}>In Range</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.stat}>
          <Text style={styles.statValue}>−70</Text>
          <Text style={styles.statLabel}>dBm Threshold</Text>
        </View>
      </View>

      {alert && (
        <View style={[styles.alertBanner, alert.severity === 'HIGH' && styles.alertHigh]}>
          <Text style={styles.alertTitle}>
            {alert.severity === 'HIGH' ? '🚨  EMERGENCY DETECTED' : '⚠️  ALERT PENDING'}
          </Text>
          {!!alert.instructions && (
            <ScrollView style={styles.alertScroll} nestedScrollEnabled>
              <Text style={styles.alertInstructions}>{alert.instructions}</Text>
            </ScrollView>
          )}
          <TouchableOpacity onPress={() => setAlert(null)} style={styles.alertDismiss}>
            <Text style={styles.alertDismissText}>DISMISS</Text>
          </TouchableOpacity>
        </View>
      )}

      {error && (
        <View style={styles.errorBar}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      <FlatList
        data={sortedDevices}
        keyExtractor={item => item.id}
        renderItem={({item}) => <DeviceCard device={item} />}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyText}>
              {scanning
                ? 'Scanning for nearby devices...'
                : 'No devices found.\nTap SCAN to start.'}
            </Text>
          </View>
        }
      />

      <View style={styles.footer}>
        {scanning && <ActivityIndicator color="#6b6b8a" style={styles.spinner} />}
        <TouchableOpacity
          style={[styles.scanBtn, scanning && styles.scanBtnStop]}
          onPress={scanning ? stopScanAndPublish : startScan}
          activeOpacity={0.85}>
          <Text style={[styles.scanBtnText, scanning && styles.scanBtnTextStop]}>
            {scanning ? 'STOP' : 'SCAN'}
          </Text>
        </TouchableOpacity>
        <Text style={styles.scanHint}>
          {scanning ? 'Auto-stops in 15 s · publishing to ntfy' : 'Scans for 15 s'}
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {flex: 1, backgroundColor: '#0a0a0f'},
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#1e1e2e',
  },
  title: {color: '#e8e8f0', fontSize: 22, fontWeight: '700', fontFamily: 'monospace', letterSpacing: 2},
  subtitle: {color: '#6b6b8a', fontSize: 12, marginTop: 2},
  bleIndicator: {flexDirection: 'row', alignItems: 'center', gap: 6},
  bleDot: {width: 8, height: 8, borderRadius: 4},
  bleLabel: {color: '#6b6b8a', fontSize: 11, fontFamily: 'monospace'},
  statsBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#1e1e2e',
    backgroundColor: '#13131a',
  },
  stat: {alignItems: 'center'},
  statValue: {color: '#e8e8f0', fontSize: 20, fontWeight: '700', fontFamily: 'monospace'},
  statLabel: {color: '#6b6b8a', fontSize: 10, marginTop: 2, textTransform: 'uppercase', letterSpacing: 0.5},
  statDivider: {width: 1, height: 30, backgroundColor: '#1e1e2e'},
  alertBanner: {
    margin: 12,
    borderRadius: 10,
    padding: 14,
    borderWidth: 1,
    borderColor: '#ff9f0a',
    backgroundColor: 'rgba(255, 159, 10, 0.12)',
  },
  alertHigh: {borderColor: '#ff3b30', backgroundColor: 'rgba(255, 59, 48, 0.12)'},
  alertTitle: {color: '#ff3b30', fontSize: 15, fontWeight: '700', marginBottom: 8},
  alertScroll: {maxHeight: 140, marginBottom: 10},
  alertInstructions: {color: '#e8e8f0', fontSize: 13, lineHeight: 21},
  alertDismiss: {
    alignSelf: 'flex-end',
    borderWidth: 1,
    borderColor: '#ff3b30',
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  alertDismissText: {color: '#ff3b30', fontSize: 11, fontWeight: '700'},
  errorBar: {
    backgroundColor: 'rgba(255, 59, 48, 0.15)',
    borderBottomWidth: 1,
    borderBottomColor: '#ff3b30',
    padding: 10,
    paddingHorizontal: 20,
  },
  errorText: {color: '#ff3b30', fontSize: 13},
  list: {padding: 16, paddingBottom: 20},
  empty: {marginTop: 60, alignItems: 'center'},
  emptyText: {color: '#3d3d5c', fontSize: 14, textAlign: 'center', lineHeight: 22},
  footer: {
    alignItems: 'center',
    paddingBottom: 24,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#1e1e2e',
    gap: 8,
  },
  spinner: {marginBottom: 4},
  scanBtn: {backgroundColor: '#e8e8f0', paddingHorizontal: 56, paddingVertical: 14, borderRadius: 10},
  scanBtnStop: {backgroundColor: '#1e1e2e', borderWidth: 1, borderColor: '#6b6b8a'},
  scanBtnText: {color: '#0a0a0f', fontSize: 15, fontWeight: '700', fontFamily: 'monospace', letterSpacing: 2},
  scanBtnTextStop: {color: '#e8e8f0'},
  scanHint: {color: '#3d3d5c', fontSize: 11},
});
